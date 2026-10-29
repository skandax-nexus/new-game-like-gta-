"""
Flipbooks for particle VFX: numpy curl-noise volumes rendered with Cycles, 2D procedural sprites, atlas
packing, normals from density, contact sheets. OWNER: Technical Artist G (TA-07).
Format and runtime: docs/adr/0003-crowd-impostor-fx-assets.md (kind `flipbook`).

    ctx = flipbook.begin(__file__)
    sim = flipbook.ParticleVolume(grid=64, extent=(2.0, 2.0, 3.0), seed=7)     # meters, z up
    ... sim.emit(...); sim.step(dt) per frame; d, t = sim.fields() ...         # density / temperature grids
    rgba = flipbook.render_volumes(frames, extent, px=128)                      # Cycles, one image per frame
    flipbook.write(ctx, color_frames, cols=8, rows=8, normal_frames=..., fps=24, loop=False, sequences=[...])

Volumes: particles advected through an analytic divergence-free curl-noise field (+ buoyancy, drag,
expansion) are splatted into a density grid (and a temperature grid for fire). The voxel radiance is
precomputed in numpy - single scattering of a key light with transmittance marched slice by slice along
the light direction, an ambient term attenuated by blurred density (multiple-scattering approximation)
and blackbody-style flame emission - then Cycles integrates the emission-absorption volume through an
orthographic camera (the grid is uploaded as a 2D slice atlas sampled in the volume shader). This keeps
the alpha smooth at few samples (no scattering noise) and the look art-directable.
Normals (lit smoke / dust): tangent-space (OpenGL +Y) from the blurred optical depth of each frame, so
the runtime re-lights the sprites with the sun (ART_BIBLE §10: no unlit white puffs).
Atlas layout: row-major frames, frame 0 at the top-left; color = sRGB rgb + linear alpha (straight, or
premultiplied for emissive fire), normal = xyz * 0.5 + 0.5.
Border guard (write() fails the bake): every frame's outer 2 px must carry no coverage / emission above 2/255 in
the encoded atlas, at the source resolution AND after downsampling to the smallest shipped frame size - content
touching a frame edge shows as a hard straight cut on the particle quad. Sequences that legitimately reach an
edge opt out per edge: {"name": "trail", ..., "open_edges": ["left"]} (weapon-trail ribbons, ground-hitting bolts).
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Callable, Sequence

import bpy
import numpy as np

from . import texgen as tg
from .core import AssetContext, begin as core_begin, log, timer

F = np.float32


def begin(script_file: str, seed: int | None = None) -> AssetContext:
    """AssetContext for a `@kind flipbook` script."""
    ctx = core_begin(script_file, kind="model", seed=seed)
    ctx.kind = "flipbook"
    return ctx


# =========================================================================================== curl noise
class CurlNoise:
    """Analytic, divergence-free 3D turbulence: v = curl(psi), psi = sum_i a_i d_i sin(k_i . p + w_i t + phi_i)."""

    def __init__(self, seed: int, octaves: int = 4, base_freq: float = 1.2, waves: int = 6, speed: float = 0.6) -> None:
        rng = np.random.default_rng(seed)
        ks, ds, amps, phs, ws = [], [], [], [], []
        for o in range(octaves):
            f = base_freq * 2.0 ** o
            for _ in range(waves):
                k = rng.normal(0, 1, 3)
                k = k / np.linalg.norm(k) * f
                d = rng.normal(0, 1, 3)
                d -= k * (d @ k) / (k @ k)
                d /= max(np.linalg.norm(d), 1e-9)
                ks.append(k)
                ds.append(d)
                amps.append(0.5 ** o / f)
                phs.append(rng.uniform(0, 2 * math.pi))
                ws.append(rng.uniform(-1, 1) * speed * f)
        self.k = np.array(ks, F)
        self.kxd = np.cross(self.k, np.array(ds, F)).astype(F)
        self.a = np.array(amps, F)
        self.ph = np.array(phs, F)
        self.w = np.array(ws, F)

    def velocity(self, p: np.ndarray, t: float) -> np.ndarray:
        arg = p @ self.k.T + self.w[None, :] * t + self.ph[None, :]
        c = np.cos(arg) * self.a[None, :]
        return (c @ self.kxd).astype(F)


# =========================================================================================== particles
class ParticleVolume:
    """Particles -> density (+ temperature) grids over a box `extent` (x, y, z meters) centered on x/y, z from 0."""

    def __init__(self, grid: int = 64, extent: Sequence[float] = (2.0, 2.0, 3.0), seed: int = 1,
                 turbulence: float = 1.0, curl: CurlNoise | None = None) -> None:
        self.n = grid
        self.extent = np.array(extent, F)
        self.rng = np.random.default_rng(seed)
        self.curl = curl or CurlNoise(seed + 101)
        self.turb = turbulence
        self.t = 0.0
        self.p = np.zeros((0, 3), F)
        self.v = np.zeros((0, 3), F)
        self.age = np.zeros(0, F)
        self.life = np.zeros(0, F)
        self.mass = np.zeros(0, F)
        self.heat = np.zeros(0, F)

    @property
    def count(self) -> int:
        return len(self.p)

    def emit(self, pos: np.ndarray, vel: np.ndarray, life: np.ndarray, mass: np.ndarray, heat: np.ndarray | None = None) -> None:
        self.p = np.concatenate([self.p, pos.astype(F)])
        self.v = np.concatenate([self.v, vel.astype(F)])
        self.age = np.concatenate([self.age, np.zeros(len(pos), F)])
        self.life = np.concatenate([self.life, life.astype(F)])
        self.mass = np.concatenate([self.mass, mass.astype(F)])
        self.heat = np.concatenate([self.heat, (heat if heat is not None else np.zeros(len(pos))).astype(F)])

    def step(self, dt: float, buoyancy: float = 1.0, drag: float = 1.5, wind: Sequence[float] = (0, 0, 0),
             heat_buoyancy: float = 0.0, cooling: float = 1.0, substeps: int = 2) -> None:
        h = dt / substeps
        for _ in range(substeps):
            if not len(self.p):
                break
            fade = np.exp(-self.age / np.maximum(self.life, 1e-3))[:, None]
            turb = self.curl.velocity(self.p * 1.0, self.t) * self.turb
            acc = np.zeros_like(self.p)
            acc[:, 2] += buoyancy * fade[:, 0] + heat_buoyancy * self.heat
            target = turb + np.array(wind, F)[None, :]
            self.v += (acc + (target - self.v) * drag) * h
            self.p += self.v * h
            self.heat *= np.exp(-cooling * h)
            self.age += h
            self.t += h
        alive = self.age < self.life
        for name in ("p", "v", "age", "life", "mass", "heat"):
            setattr(self, name, getattr(self, name)[alive])

    def _deposit(self, w: np.ndarray, sel: np.ndarray) -> np.ndarray:
        n = self.n
        grid = np.zeros((n, n, n), F)
        if not sel.any():
            return grid
        half = self.extent * 0.5
        lo = np.array([-half[0], -half[1], 0.0], F)
        g = (self.p[sel] - lo) / self.extent * (n - 1)
        i0 = np.floor(g).astype(np.int64)
        f = (g - i0).astype(F)
        ws = w[sel]
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    ii = i0 + np.array([dx, dy, dz])
                    ok = np.all((ii >= 0) & (ii < n), axis=1)
                    wt = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                    np.add.at(grid, (ii[ok, 0], ii[ok, 1], ii[ok, 2]), (ws * wt)[ok])
        return grid

    def fields(self, bands: Sequence[tuple[float, float, float]] = ((0.0, 0.35, 1.0), (0.35, 0.7, 2.0), (0.7, 1.01, 3.5)),
               fade_in: float = 0.04, fade_out: float = 0.35) -> tuple[np.ndarray, np.ndarray]:
        """Density and temperature grids. Particles are splatted per age band and blurred more as they
        age (expansion: young puffs are tight, old ones diffuse). Mass fades in over `fade_in` of life
        and out (smoothstep) over the last `fade_out` of life."""
        if not len(self.p):
            z = np.zeros((self.n,) * 3, F)
            return z, z
        x = self.age / np.maximum(self.life, 1e-3)
        t = np.clip((1.0 - x) / max(fade_out, 1e-3), 0, 1)
        m = self.mass * np.clip(x / fade_in, 0, 1) * (t * t * (3 - 2 * t))
        dens = np.zeros((self.n,) * 3, F)
        temp = np.zeros((self.n,) * 3, F)
        for a0, a1, blur_vox in bands:
            sel = (x >= a0) & (x < a1)
            dens += blur3(self._deposit(m, sel), blur_vox)
            if self.heat.any():
                temp += blur3(self._deposit(m * self.heat, sel), blur_vox)
        temp = np.where(dens > 1e-6, temp / np.maximum(dens, 1e-6), 0.0).astype(F)
        return dens, temp


def _box1(a: np.ndarray, r: int, axis: int) -> np.ndarray:
    if r <= 0:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="constant"), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(F)


def blur3(a: np.ndarray, sigma_vox: float) -> np.ndarray:
    """~Gaussian blur (3 box passes per axis) of a 3D grid."""
    if sigma_vox <= 0.3:
        return a.astype(F)
    r = max(1, int(round(math.sqrt(12 * sigma_vox * sigma_vox / 3 + 1) / 2)))
    out = a.astype(F)
    for axis in range(a.ndim):
        for _ in range(3):
            out = _box1(out, r, axis)
    return out


def blur2(a: np.ndarray, sigma_px: float) -> np.ndarray:
    if sigma_px <= 0.3:
        return a.astype(F)
    r = max(1, int(round(math.sqrt(12 * sigma_px * sigma_px / 3 + 1) / 2)))
    out = a.astype(F)
    for axis in (0, 1):
        for _ in range(3):
            out = _box1(out, r, axis)
    return out


# =========================================================================================== lighting
def light_volume(sigma: np.ndarray, voxel_m: float, albedo: Sequence[float], key_dir: Sequence[int] = (0, 0, 1),
                 key: Sequence[float] = (1.0, 0.96, 0.9), ambient: Sequence[float] = (0.42, 0.45, 0.5),
                 ambient_blur: float = 6.0, ambient_k: float = 0.55) -> np.ndarray:
    """Radiance scattered towards the viewer per unit extinction (rgb grid). `key_dir` points TO the light in
    voxel steps (x, y, z in {-1, 0, 1}); transmittance is marched slice by slice from the light side."""
    n = sigma.shape
    step = np.array(key_dir, np.int64)
    ds = voxel_m * float(np.linalg.norm(step))
    T = np.ones(n, F)
    # march along the dominant axis of the light direction
    ax = int(np.argmax(np.abs(step)))
    order = range(n[ax] - 2, -1, -1) if step[ax] > 0 else range(1, n[ax])
    prev_idx = (lambda i: i + 1) if step[ax] > 0 else (lambda i: i - 1)
    for i in order:
        j = prev_idx(i)
        src = np.take(T, j, axis=ax) * np.exp(-np.take(sigma, j, axis=ax) * ds)
        other = [a for a in range(3) if a != ax]
        for k, a in enumerate(other):
            if step[a]:
                src = np.roll(src, int(-step[a]), axis=k)
        idx = [slice(None)] * 3
        idx[ax] = i
        T[tuple(idx)] = src
    occ = np.exp(-ambient_k * blur3(sigma, ambient_blur) * voxel_m * ambient_blur * 2.0)
    alb = np.array(albedo, F)[None, None, None, :]
    rad = alb * (T[..., None] * np.array(key, F) + occ[..., None] * np.array(ambient, F))
    return rad.astype(F)


def blackbody_ramp(t: np.ndarray, stops: Sequence[tuple[float, str]] = ((0.0, "#000000"), (0.25, "#5a1606"),
                   (0.45, "#e2571e"), (0.7, "#ffb040"), (1.0, "#fff2c0"))) -> np.ndarray:
    """Flame color by normalized temperature (ART_BIBLE §10 fire: #fff2c0 -> #ffb040 -> #e2571e), linear rgb."""
    return tg.gradient_map(np.clip(t, 0, 1), list(stops))


# =========================================================================================== Cycles render
class VolumeRenderer:
    """Cycles emission-absorption renderer for numpy volume grids (one scene, re-used for every frame)."""

    def __init__(self, extent: Sequence[float], grid: int, px: tuple[int, int], samples: int = 16,
                 view: str = "front") -> None:
        self.n = grid
        self.tiles = int(math.ceil(math.sqrt(grid)))
        self.px = px
        scn = bpy.context.scene
        for o in list(scn.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        ex = np.array(extent, F)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, float(ex[2]) / 2))
        cube = bpy.context.active_object
        cube.scale = (float(ex[0]), float(ex[1]), float(ex[2]))
        size = self.tiles * grid
        self.image = bpy.data.images.new("flipbook_slices", size, size, alpha=True, float_buffer=True)
        self.image.colorspace_settings.name = "Non-Color"
        self.image.alpha_mode = "STRAIGHT"
        self.mat = self._material()
        cube.data.materials.append(self.mat)
        scn.world = None
        cd = bpy.data.cameras.new("flipbook_cam")
        cd.type = "ORTHO"
        cam = bpy.data.objects.new("flipbook_cam", cd)
        scn.collection.objects.link(cam)
        aspect = px[0] / px[1]
        if view == "top":
            cam.location = (0, 0, float(ex[2]) + 5)
            cam.rotation_euler = (0, 0, 0)
            cd.ortho_scale = float(max(ex[0], ex[1] * aspect))
        else:
            cam.location = (0, -float(ex[1]) - 5, float(ex[2]) / 2)
            cam.rotation_euler = (math.radians(90), 0, 0)
            cd.ortho_scale = float(max(ex[0], ex[2] * aspect))
        cd.clip_start = 0.1
        cd.clip_end = 100
        scn.camera = cam
        r = scn.render
        r.engine = "CYCLES"
        c = scn.cycles
        c.device = "CPU"
        c.samples = samples
        c.use_adaptive_sampling = False
        c.use_denoising = False
        c.max_bounces = 0
        c.volume_bounces = 0
        c.volume_step_rate = 0.5
        c.volume_max_steps = 512
        c.seed = 0
        r.resolution_x, r.resolution_y = px
        r.resolution_percentage = 100
        r.film_transparent = True
        # NOT use_persistent_data: Cycles then keeps the first frame's packed slice atlas and every frame renders
        # the same volume (selftest "frames differ" guards this).
        r.use_persistent_data = False
        scn.view_settings.view_transform = "Standard"
        scn.view_settings.look = "None"
        scn.view_settings.exposure = 0.0

    def _material(self) -> bpy.types.Material:
        n, tiles = self.n, self.tiles
        mat = bpy.data.materials.new("flipbook_volume")
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])

        def m(op: str, a: Any, b: Any = 0.0, c: Any = None) -> Any:
            node = nt.nodes.new("ShaderNodeMath")
            node.operation = op
            for i, v in enumerate((a, b, c)):
                if v is None:
                    continue
                if isinstance(v, (int, float)):
                    node.inputs[i].default_value = float(v)
                else:
                    nt.links.new(v, node.inputs[i])
            return node.outputs[0]

        zs = m("MULTIPLY_ADD", sep.outputs["Z"], n - 1, 0.0)
        z0 = m("FLOOR", zs)
        fr = m("SUBTRACT", zs, z0)
        z1 = m("MINIMUM", m("ADD", z0, 1.0), n - 1)

        def sample(zi: Any) -> Any:
            ty = m("FLOOR", m("DIVIDE", zi, tiles))
            tx = m("SUBTRACT", zi, m("MULTIPLY", ty, tiles))
            u = m("DIVIDE", m("ADD", tx, m("MULTIPLY_ADD", sep.outputs["X"], (n - 1) / n, 0.5 / n)), tiles)
            vt = m("DIVIDE", m("ADD", ty, m("MULTIPLY_ADD", sep.outputs["Y"], (n - 1) / n, 0.5 / n)), tiles)
            v = m("SUBTRACT", 1.0, vt)
            cmb = nt.nodes.new("ShaderNodeCombineXYZ")
            nt.links.new(u, cmb.inputs[0])
            nt.links.new(v, cmb.inputs[1])
            it = nt.nodes.new("ShaderNodeTexImage")
            it.image = self.image
            it.interpolation = "Linear"
            it.extension = "CLIP"
            nt.links.new(cmb.outputs[0], it.inputs[0])
            return it

        s0 = sample(z0)
        s1 = sample(z1)
        mixc = nt.nodes.new("ShaderNodeMix")
        mixc.data_type = "RGBA"
        nt.links.new(fr, mixc.inputs["Factor"])
        nt.links.new(s0.outputs["Color"], mixc.inputs[6])
        nt.links.new(s1.outputs["Color"], mixc.inputs[7])
        mixa = nt.nodes.new("ShaderNodeMix")
        mixa.data_type = "FLOAT"
        nt.links.new(fr, mixa.inputs["Factor"])
        nt.links.new(s0.outputs["Alpha"], mixa.inputs[2])
        nt.links.new(s1.outputs["Alpha"], mixa.inputs[3])
        ab = nt.nodes.new("ShaderNodeVolumeAbsorption")
        ab.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        nt.links.new(mixa.outputs[0], ab.inputs["Density"])
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(mixc.outputs[2], em.inputs["Color"])
        nt.links.new(mixa.outputs[0], em.inputs["Strength"])
        add = nt.nodes.new("ShaderNodeAddShader")
        nt.links.new(ab.outputs[0], add.inputs[0])
        nt.links.new(em.outputs[0], add.inputs[1])
        nt.links.new(add.outputs[0], out.inputs["Volume"])
        return mat

    def render(self, sigma: np.ndarray, radiance: np.ndarray) -> np.ndarray:
        """sigma (n^3, 1/m) + radiance per unit extinction (n^3 x 3) -> RGBA float (premultiplied), top-down."""
        n, tiles = self.n, self.tiles
        size = tiles * n
        atlas = np.zeros((size, size, 4), F)
        for k in range(n):
            ty, tx = divmod(k, tiles)
            # slice k: x along columns, y along rows (row 0 = y index 0), as the shader samples it
            atlas[ty * n:(ty + 1) * n, tx * n:(tx + 1) * n, :3] = np.transpose(radiance[:, :, k, :], (1, 0, 2))
            atlas[ty * n:(ty + 1) * n, tx * n:(tx + 1) * n, 3] = sigma[:, :, k].T
        self.image.pixels.foreach_set(tg.to_blender(atlas))
        self.image.update()
        scn = bpy.context.scene
        bpy.ops.render.render()
        tmp = Path(bpy.app.tempdir or "/tmp") / "samrajya_flipbook_frame.exr"
        s = scn.render.image_settings
        s.file_format = "OPEN_EXR"
        s.color_mode = "RGBA"
        s.color_depth = "32"
        s.exr_codec = "ZIP"
        bpy.data.images["Render Result"].save_render(str(tmp), scene=scn)
        im = bpy.data.images.load(str(tmp))
        arr = tg.image_to_numpy(im).copy()
        bpy.data.images.remove(im)
        tmp.unlink(missing_ok=True)
        return arr


def render_volumes(frames: Sequence[tuple[np.ndarray, np.ndarray]], extent: Sequence[float], px: int | tuple[int, int],
                   samples: int = 16, view: str = "front") -> list[np.ndarray]:
    """Render (sigma, radiance) grid pairs with Cycles -> premultiplied linear RGBA frames."""
    pxy = (px, px) if isinstance(px, int) else px
    vr = VolumeRenderer(extent, frames[0][0].shape[0], pxy, samples, view)
    out = []
    with timer(f"cycles volume frames x{len(frames)} @ {pxy[0]}x{pxy[1]}"):
        for s, r in frames:
            out.append(vr.render(s, r))
    return out


def loop_blend(seq: Sequence[np.ndarray], period: int, blend: int) -> list[np.ndarray]:
    """Seamless loop of `period` frames from a sequence of >= period + blend frames: the first `blend`
    output frames cross-fade from seq[i + period] to seq[i] (out[0] == seq[period], the frame that follows
    out[period - 1] == seq[period - 1], so the wrap is continuous; out[blend] == seq[blend])."""
    if len(seq) < period + blend:
        raise ValueError("loop_blend needs period + blend frames")
    out = []
    for i in range(period):
        if i < blend:
            w = i / blend
            out.append((seq[i + period] * (1 - w) + seq[i] * w).astype(F))
        else:
            out.append(seq[i].astype(F))
    return out


# =========================================================================================== 2D sprites
def grid2(px: int, py: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Centered pixel coordinates in [-1, 1] (x right, y up), shape (py, px)."""
    py = py or px
    x = (np.arange(px) + 0.5) / px * 2 - 1
    y = 1 - (np.arange(py) + 0.5) / py * 2
    return np.meshgrid(x.astype(F), y.astype(F))


def gaussian(x: np.ndarray, y: np.ndarray, cx: float, cy: float, sx: float, sy: float | None = None) -> np.ndarray:
    sy = sy or sx
    return np.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2) * 0.5).astype(F)


def segment_distance(x: np.ndarray, y: np.ndarray, a: Sequence[float], b: Sequence[float]) -> np.ndarray:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = np.clip(((x - ax) * dx + (y - ay) * dy) / max(dx * dx + dy * dy, 1e-12), 0, 1)
    return np.hypot(x - (ax + t * dx), y - (ay + t * dy)).astype(F)


def polygon_sdf(x: np.ndarray, y: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Signed distance to a closed polygon (negative inside)."""
    d = np.full(x.shape, 1e9, F)
    inside = np.zeros(x.shape, bool)
    n = len(pts)
    for i in range(n):
        a = pts[i]
        b = pts[(i + 1) % n]
        d = np.minimum(d, segment_distance(x, y, a, b))
        cond = ((a[1] > y) != (b[1] > y)) & (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1] + 1e-12) + a[0])
        inside ^= cond
    return np.where(inside, -d, d).astype(F)


def normal_from_alpha(alpha: np.ndarray, strength: float = 2.0, blur_px: float = 1.5, bulge: float = 0.6) -> np.ndarray:
    """Tangent-space normal (OpenGL +Y up, image row 0 = top) from a coverage / optical-depth map treated as
    height, plus a soft spherical bulge so thin puffs still shade like volumes. Returns rgb in [0, 1]."""
    h = blur2(np.sqrt(np.clip(alpha, 0, 1)), blur_px) * (1.0 + bulge)
    gy, gx = np.gradient(h)
    nx = -gx * strength * alpha.shape[1] / 64.0
    ny = gy * strength * alpha.shape[0] / 64.0  # rows grow downwards; +Y is up
    nz = np.ones_like(nx)
    n = np.stack([nx, ny, nz], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5).astype(F)


# =========================================================================================== border guard
EDGES = ("top", "bottom", "left", "right")
BORDER_PX = 2
BORDER_LIMIT = 2.0 / 255.0


def border_signal(frame: np.ndarray, blend: str, srgb: bool = True) -> np.ndarray:
    """Per-pixel value that must vanish at the frame border, in the encoded 8-bit domain [0, 1]: coverage alpha for
    'alpha' books, encoded emission for 'additive' (its alpha is dropped at publish), both for 'premultiplied'."""
    a = np.clip(frame[..., 3], 0, 1) if frame.ndim == 3 and frame.shape[-1] > 3 else np.zeros(frame.shape[:2], F)
    if blend == "alpha":
        return a.astype(F)
    rgb = np.clip(frame[..., :3], 0, 1)
    e = (tg.linear_to_srgb(rgb) if srgb else rgb).max(axis=-1)
    return (e if blend == "additive" else np.maximum(a, e)).astype(F)


def border_levels(sig: np.ndarray, px: int = BORDER_PX) -> dict[str, float]:
    """Max of `sig` over the outer `px` rows / columns of each edge."""
    return {"top": float(sig[:px].max()), "bottom": float(sig[-px:].max()),
            "left": float(sig[:, :px].max()), "right": float(sig[:, -px:].max())}


def _open_edges(seq: dict[str, Any]) -> set[str]:
    oe = seq.get("open_edges") or []
    if isinstance(oe, str):
        oe = [oe]
    out = set(EDGES) if "all" in oe else {str(e) for e in oe}
    bad = out - set(EDGES)
    if bad:
        raise ValueError(f"sequence {seq.get('name')}: unknown open_edges {sorted(bad)} (use {', '.join(EDGES)} or all)")
    return out


def check_borders(color: Sequence[np.ndarray], sequences: Sequence[dict[str, Any]] | None, *, blend: str,
                  emissive: Sequence[np.ndarray] | None = None, srgb: bool = True, px: int = BORDER_PX,
                  limit: float = BORDER_LIMIT, published_frame_px: int | None = None) -> tuple[list[str], float]:
    """Frames whose outer `px` pixels exceed `limit` on an edge their sequence does not open. Checked at the
    source resolution and, when `published_frame_px` is smaller, on an area / bilinear downsample to it (the
    smallest shipped tier). Returns (problems, worst closed-edge level)."""
    seqs = list(sequences) if sequences else [{"name": "all", "start": 0, "count": len(color)}]
    owner: dict[int, dict[str, Any]] = {}
    for sq in seqs:
        for k in range(int(sq["start"]), int(sq["start"]) + int(sq["count"])):
            owner[k] = sq
    problems: list[str] = []
    worst = 0.0
    for k, f in enumerate(color):
        sq = owner.get(k, {"name": "?"})
        closed = [e for e in EDGES if e not in _open_edges(sq)]
        if not closed:
            continue
        sigs = [("color", border_signal(f, blend, srgb))]
        if emissive is not None and k < len(emissive):
            sigs.append(("emissive", border_signal(emissive[k], "additive", True)))
        for name, sig in sigs:
            views = [(sig.shape[1], sig)]
            if published_frame_px and published_frame_px < sig.shape[1]:
                ph = max(1, round(published_frame_px * sig.shape[0] / sig.shape[1]))
                views.append((published_frame_px, tg.resize(sig, ph, published_frame_px)))
            for size, v in views:
                lv = border_levels(v, px)
                for e in closed:
                    worst = max(worst, lv[e])
                    if lv[e] > limit:
                        problems.append(f"frame {k} ({sq.get('name')}) {name} {e} edge {lv[e] * 255:.1f}/255 at {size} px")
    return problems, worst


# =========================================================================================== packing / output
def to_straight(rgba: np.ndarray) -> np.ndarray:
    a = np.clip(rgba[..., 3:4], 0, 1)
    rgb = np.where(a > 1e-4, rgba[..., :3] / np.maximum(a, 1e-4), 0.0)
    return np.concatenate([rgb, a], axis=-1).astype(F)


def pack(frames: Sequence[np.ndarray], cols: int, rows: int) -> np.ndarray:
    h, w = frames[0].shape[:2]
    c = frames[0].shape[2] if frames[0].ndim == 3 else 1
    out = np.zeros((rows * h, cols * w, c), F)
    for k, f in enumerate(frames):
        r, cc = divmod(k, cols)
        out[r * h:(r + 1) * h, cc * w:(cc + 1) * w] = f if f.ndim == 3 else f[..., None]
    return out


# 3 x 5 pixel font for contact-sheet labels.
_FONT = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001001001",
    "8": "111101111101111", "9": "111101111001111", " ": "000000000000000", "_": "000000000000111",
    "A": "010101111101101", "B": "110101110101110", "C": "111100100100111", "D": "110101101101110",
    "E": "111100111100111", "F": "111100111100100", "G": "111100101101111", "H": "101101111101101",
    "I": "111010010010111", "J": "001001001101111", "K": "101101110101101", "L": "100100100100111",
    "M": "101111111101101", "N": "111101101101101", "O": "111101101101111", "P": "111101111100100",
    "Q": "111101101111001", "R": "111101110101101", "S": "111100111001111", "T": "111010010010010",
    "U": "101101101101111", "V": "101101101101010", "W": "101101111111101", "X": "101101010101101",
    "Y": "101101111010010", "Z": "111001010100111", "-": "000000111000000", ".": "000000000000010",
}


def draw_text(img: np.ndarray, text: str, x: int, y: int, scale: int = 2, color: Sequence[float] = (1, 1, 1)) -> None:
    for ch in text.upper():
        g = _FONT.get(ch, _FONT[" "])
        for r in range(5):
            for c in range(3):
                if g[r * 3 + c] == "1":
                    y0, x0 = y + r * scale, x + c * scale
                    img[y0:y0 + scale, x0:x0 + scale, :3] = color
        x += 4 * scale


def contact_sheet(color: Sequence[np.ndarray], cols: int, labels: Sequence[str] | None = None,
                  normals: Sequence[np.ndarray] | None = None, premultiplied: bool = False, cell: int = 128,
                  title: str = "") -> np.ndarray:
    """Every frame over a checker (and its normal map beside it when given), numbered: the critique sheet."""
    k = len(color)
    rows = math.ceil(k / cols)
    per = 2 if normals is not None else 1
    pad = 4
    head = 22 if title else 0
    W = cols * per * (cell + pad) + pad
    H = rows * (cell + pad + 12) + pad + head
    sheet = np.full((H, W, 3), 0.11, F)
    if title:
        draw_text(sheet, title, 6, 6, 2, (0.95, 0.85, 0.55))
    yy, xx = np.mgrid[0:cell, 0:cell]
    checker = np.where(((yy // 8) + (xx // 8)) % 2 == 0, 0.2, 0.28).astype(F)[..., None]
    for i, f in enumerate(color):
        r, c = divmod(i, cols)
        fr = tg.resize(f, cell, cell) if f.shape[0] != cell else f
        a = np.clip(fr[..., 3:4], 0, 1)
        rgb = fr[..., :3] + checker * (1 - a) if premultiplied else fr[..., :3] * a + checker * (1 - a)
        y0 = head + pad + r * (cell + pad + 12)
        x0 = pad + c * per * (cell + pad)
        sheet[y0:y0 + cell, x0:x0 + cell] = np.clip(rgb, 0, 1)
        draw_text(sheet, f"{i}" + (f" {labels[i]}" if labels else ""), x0, y0 + cell + 2, 2, (0.8, 0.8, 0.8))
        if normals is not None:
            nf = tg.resize(normals[i], cell, cell) if normals[i].shape[0] != cell else normals[i]
            sheet[y0:y0 + cell, x0 + cell + pad:x0 + 2 * cell + pad] = nf[..., :3] * a + checker * (1 - a)
    return sheet


def write(ctx: AssetContext, color: Sequence[np.ndarray], cols: int, rows: int, *, fps: float = 24.0, loop: bool = True,
          sequences: Sequence[dict[str, Any]] | None = None, normals: Sequence[np.ndarray] | None = None,
          emissive: Sequence[np.ndarray] | None = None, blend: str = "alpha", lit: bool = False,
          emissive_intensity: float = 1.0, soft_fade_m: float = 0.5, size_m: Sequence[float] | None = None,
          atlas_px: dict[str, int] | None = None, description: str = "", labels: Sequence[str] | None = None,
          srgb: bool = True) -> dict[str, Any]:
    """Pack and write the flipbook maps (+ contact sheet preview); returns the manifest metadata.
    `color` frames: linear rgb + alpha (straight, or premultiplied when blend == 'premultiplied').
    Fails (ValueError) when a frame's border carries coverage / emission (see the module doc: border guard);
    sequences opt out per edge with "open_edges"."""
    if len(color) > cols * rows:
        raise ValueError(f"{len(color)} frames do not fit {cols}x{rows}")
    seqs_in = list(sequences) if sequences else None
    min_frame = None
    if atlas_px:
        min_frame = max(1, int(min(atlas_px.values())) // cols)
    problems, worst = check_borders(color, seqs_in, blend=blend, emissive=emissive, srgb=srgb, published_frame_px=min_frame)
    if problems:
        head = "\n  ".join(problems[:16])
        more = f"\n  ... and {len(problems) - 16} more" if len(problems) > 16 else ""
        raise ValueError(f"{ctx.id}: flipbook border guard - {len(problems)} frame edges carry content "
                         f"(> {BORDER_LIMIT * 255:.0f}/255 in the outer {BORDER_PX} px):\n  {head}{more}\n"
                         "Keep the effect inside its frame (fade to 0 before the border) or open the edge on the "
                         "sequence (open_edges) if it must touch it.")
    log(f"flipbook: border guard ok - worst closed edge {worst * 255:.2f}/255 (limit {BORDER_LIMIT * 255:.0f}/255, "
        f"{BORDER_PX} px, checked at {color[0].shape[1]} px{f' and {min_frame} px' if min_frame and min_frame < color[0].shape[1] else ''})")
    atlas = pack(color, cols, rows)
    enc = atlas.copy()
    if srgb:
        enc[..., :3] = tg.linear_to_srgb(np.clip(enc[..., :3], 0, 1))
    pc = tg.write_png(ctx.path("color.png"), enc, 8)
    ctx.add_file("color", pc)
    if normals is not None:
        na = pack(normals, cols, rows)
        if na.shape[2] == 1:
            na = np.repeat(na, 3, axis=2)
        # keep frames outside any sprite flat
        pn = tg.write_png(ctx.path("normal.png"), np.clip(na[..., :3] + (na[..., :3] == 0) * 0.5 * np.array([1, 1, 2], F), 0, 1), 8)
        ctx.add_file("normal", pn)
    if emissive is not None:
        ea = pack(emissive, cols, rows)
        pe = tg.write_png(ctx.path("emissive.png"), tg.linear_to_srgb(np.clip(ea[..., :3], 0, 1)), 8)
        ctx.add_file("emissive", pe)
    if ctx.preview:
        disp = [np.concatenate([tg.linear_to_srgb(np.clip(f[..., :3], 0, 1)) if srgb else f[..., :3], f[..., 3:4]], axis=-1)
                for f in color]
        sheet = contact_sheet(disp, min(cols, 8), labels=labels, normals=normals, premultiplied=blend == "premultiplied",
                              cell=min(128, max(64, color[0].shape[0])), title=f"{ctx.id}  {len(color)} FRAMES  {cols}X{rows}")
        ctx.add_file("preview_contact", tg.write_png(ctx.path("preview_contact.png"), sheet, 8))
    pub_seqs = [{k: v for k, v in sq.items() if k != "open_edges"} for sq in seqs_in] if seqs_in else None
    meta = {
        "cols": cols, "rows": rows, "frames": len(color), "fps": fps, "loop": loop,
        "sequences": pub_seqs or [{"name": "all", "start": 0, "count": len(color), "fps": fps, "loop": loop}],
        "blend": blend, "lit": lit, "emissiveIntensity": emissive_intensity, "softFadeMeters": soft_fade_m,
        "sizeMeters": list(size_m) if size_m else None, "description": description,
    }
    if atlas_px:
        meta["atlasPx"] = atlas_px
    log(f"flipbook: {len(color)} frames in {cols}x{rows} ({atlas.shape[1]}x{atlas.shape[0]} px), blend {blend}, lit {lit}")
    return meta


__all__ = ["BORDER_LIMIT", "BORDER_PX", "CurlNoise", "EDGES", "ParticleVolume", "VolumeRenderer", "begin", "blackbody_ramp",
           "blur2", "blur3", "border_levels", "border_signal", "check_borders", "contact_sheet",
           "draw_text", "gaussian", "grid2", "light_volume", "loop_blend", "normal_from_alpha", "pack", "polygon_sdf",
           "render_volumes", "segment_distance", "to_straight", "write"]
