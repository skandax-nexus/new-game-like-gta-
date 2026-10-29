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


# =========================================================================================== Eulerian fluid
class FluidSim:
    """Eulerian smoke / fire / dust solver ("stable fluids") over a box `extent` (x, y, z meters; x / y centred, z
    from 0), cubic voxels, cell-centred fields indexed [x, y, z] like ParticleVolume:
      vel (3, nx, ny, nz) m/s, dens (soot / dust density), temp (normalized temperature 0..1+).
    Per step: buoyancy (temp lifts, dens sinks) + vorticity confinement (keeps the small curls that make flame
    tongues and cauliflower billows) -> RK2 semi-Lagrangian advection (velocity and scalars, optional uniform wind)
    -> exact spectral pressure projection (divergence-free) -> dissipation and a sponge layer near the open borders.
    Boundaries: periodic in x / y (keep the content inside the sponge margin); `floor=True` makes z = 0 a free-slip
    wall (mirror extension of the projection), else z is periodic too. Deterministic (pure numpy, fixed order).
    Typical cost: ~1 s per step at 96 x 72 x 144 on one CPU."""

    def __init__(self, shape: Sequence[int], extent: Sequence[float], *, floor: bool = False, vorticity: float = 2.0,
                 sponge: float = 0.1, sponge_top: float = 0.12) -> None:
        self.n = tuple(int(v) for v in shape)
        self.extent = np.array(extent, F)
        hs = self.extent / np.array(self.n, F)
        if float(hs.max() - hs.min()) > 1e-4 * float(hs.max()):
            raise ValueError(f"FluidSim needs cubic voxels: extent {tuple(extent)} / shape {self.n}")
        self.h = float(hs[0])
        nx, ny, nz = self.n
        self.floor = floor
        self.eps = vorticity
        self.vel = np.zeros((3, nx, ny, nz), F)
        self.dens = np.zeros(self.n, F)
        self.temp = np.zeros(self.n, F)
        self.t = 0.0
        I, J, K = np.meshgrid(np.arange(nx, dtype=F), np.arange(ny, dtype=F), np.arange(nz, dtype=F), indexing="ij")
        self._I, self._J, self._K = I, J, K
        self._stride = (ny * nz, nz, 1)
        nze = 2 * nz if floor else nz
        kx = (2 * np.pi * np.fft.fftfreq(nx, d=self.h)).astype(F)[:, None, None]
        ky = (2 * np.pi * np.fft.fftfreq(ny, d=self.h)).astype(F)[None, :, None]
        kz = (2 * np.pi * np.fft.rfftfreq(nze, d=self.h)).astype(F)[None, None, :]
        k2 = kx * kx + ky * ky + kz * kz
        k2[0, 0, 0] = 1.0
        self._k = (kx, ky, kz)
        self._ik2 = (1.0 / k2).astype(F)
        self._nze = nze
        # sponge: 1 inside, -> 0 over `sponge` (fraction) of the x / y borders and `sponge_top` of the top
        x, y, z = self.world()
        ex, ey, ez = (float(v) for v in self.extent)

        def ramp(d: np.ndarray, w: float) -> np.ndarray:
            t = np.clip(d / max(w, 1e-6), 0, 1)
            return t * t * (3 - 2 * t)

        m = ramp(ex / 2 - np.abs(x), sponge * ex) * ramp(ey / 2 - np.abs(y), sponge * ey) * ramp(ez - z, sponge_top * ez)
        if not floor:
            m = m * ramp(z, sponge * ez)
        self.sponge = m.astype(F)

    # --------------------------------------------------------------------------------- geometry
    def world(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """World coordinates (meters) of the cell centres."""
        h = self.h
        ex, ey, _ = (float(v) for v in self.extent)
        return ((self._I + 0.5) * h - ex / 2).astype(F), ((self._J + 0.5) * h - ey / 2).astype(F), ((self._K + 0.5) * h).astype(F)

    # --------------------------------------------------------------------------------- interpolation
    def _weights(self, px: np.ndarray, py: np.ndarray, pz: np.ndarray) -> list[tuple[np.ndarray, np.ndarray]]:
        nx, ny, nz = self.n
        px = np.clip(px, 0, nx - 1.0001)
        py = np.clip(py, 0, ny - 1.0001)
        pz = np.clip(pz, 0, nz - 1.0001)
        i0 = px.astype(np.int64)
        j0 = py.astype(np.int64)
        k0 = pz.astype(np.int64)
        fx = (px - i0).astype(F)
        fy = (py - j0).astype(F)
        fz = (pz - k0).astype(F)
        sx, sy, sz = self._stride
        base = (i0 * sx + j0 * sy + k0 * sz).ravel()
        out = []
        for dx in (0, 1):
            wx = fx if dx else 1 - fx
            for dy in (0, 1):
                wy = fy if dy else 1 - fy
                for dz in (0, 1):
                    wz = fz if dz else 1 - fz
                    out.append((base + (dx * sx + dy * sy + dz * sz), (wx * wy * wz).ravel()))
        return out

    def _gather(self, f: np.ndarray, iw: list[tuple[np.ndarray, np.ndarray]]) -> np.ndarray:
        flat = f.ravel()
        acc = np.zeros(flat.shape, F)
        for idx, w in iw:
            acc += flat[idx] * w
        return acc.reshape(self.n)

    # --------------------------------------------------------------------------------- operators
    def project(self, divergence: np.ndarray | None = None) -> None:
        """Make the velocity divergence-free (spectral Helmholtz projection; free-slip floor by mirroring), or give
        it the prescribed `divergence` field (1/s: hot gas expanding - incompressible smoke cannot billow out)."""
        nz = self.n[2]
        u, v, w = self.vel
        dv = divergence
        if self.floor:
            u = np.concatenate([u, u[:, :, ::-1]], axis=2)
            v = np.concatenate([v, v[:, :, ::-1]], axis=2)
            w = np.concatenate([w, -w[:, :, ::-1]], axis=2)
            if dv is not None:
                dv = np.concatenate([dv, dv[:, :, ::-1]], axis=2)
        ax = (0, 1, 2)
        U = np.fft.rfftn(u, axes=ax)
        V = np.fft.rfftn(v, axes=ax)
        W = np.fft.rfftn(w, axes=ax)
        kx, ky, kz = self._k
        d = (kx * U + ky * V + kz * W) * self._ik2
        U -= kx * d
        V -= ky * d
        W -= kz * d
        if dv is not None:
            Dh = np.fft.rfftn(dv.astype(F), axes=ax) * self._ik2 * (-1j)
            U += kx * Dh
            V += ky * Dh
            W += kz * Dh
        U[0, 0, 0] = 0
        V[0, 0, 0] = 0
        W[0, 0, 0] = 0
        shp = (self.n[0], self.n[1], self._nze)
        self.vel[0] = np.fft.irfftn(U, s=shp, axes=ax)[:, :, :nz].astype(F)
        self.vel[1] = np.fft.irfftn(V, s=shp, axes=ax)[:, :, :nz].astype(F)
        self.vel[2] = np.fft.irfftn(W, s=shp, axes=ax)[:, :, :nz].astype(F)

    def vorticity_force(self, eps: float) -> np.ndarray:
        """Vorticity confinement acceleration eps * h * (N x omega), N = normalized grad |omega|."""
        h = self.h
        u, v, w = self.vel
        g = lambda a, i: np.gradient(a, h, axis=i)  # noqa: E731
        ox = g(w, 1) - g(v, 2)
        oy = g(u, 2) - g(w, 0)
        oz = g(v, 0) - g(u, 1)
        mag = np.sqrt(ox * ox + oy * oy + oz * oz)
        nx_, ny_, nz_ = g(mag, 0), g(mag, 1), g(mag, 2)
        nl = np.sqrt(nx_ * nx_ + ny_ * ny_ + nz_ * nz_) + 1e-6
        nx_ /= nl
        ny_ /= nl
        nz_ /= nl
        k = eps * h
        return np.stack([(ny_ * oz - nz_ * oy) * k, (nz_ * ox - nx_ * oz) * k, (nx_ * oy - ny_ * ox) * k]).astype(F)

    def advect(self, dt: float, wind: Sequence[float] = (0.0, 0.0, 0.0)) -> None:
        h = self.h
        u, v, w = self.vel
        wx, wy, wz = (float(c) for c in wind)
        I, J, K = self._I, self._J, self._K
        iw = self._weights(I - 0.5 * dt * (u + wx) / h, J - 0.5 * dt * (v + wy) / h, K - 0.5 * dt * (w + wz) / h)
        um = self._gather(u, iw) + wx
        vm = self._gather(v, iw) + wy
        wm = self._gather(w, iw) + wz
        iw = self._weights(I - dt * um / h, J - dt * vm / h, K - dt * wm / h)
        self.vel = np.stack([self._gather(u, iw), self._gather(v, iw), self._gather(w, iw)])
        self.dens = self._gather(self.dens, iw)
        self.temp = self._gather(self.temp, iw)

    def step(self, dt: float, *, buoyancy: float = 1.0, weight: float = 0.0, vorticity: float | None = None,
             cooling: float = 0.0, dissipation: float = 0.0, damping: float = 0.0, wind: Sequence[float] = (0.0, 0.0, 0.0),
             expansion: float = 0.0, substeps: int = 1) -> None:
        """Advance `dt` seconds: temp lifts (buoyancy m/s^2 per unit temp), dens sinks (weight), vorticity
        confinement, advection (+ uniform wind), projection (divergence = expansion x temp: hot gas expands),
        exponential cooling / dissipation / damping."""
        hdt = dt / substeps
        eps = self.eps if vorticity is None else vorticity
        for _ in range(substeps):
            if buoyancy or weight:
                self.vel[2] += hdt * (buoyancy * self.temp - weight * self.dens)
            if eps > 0:
                self.vel += hdt * self.vorticity_force(eps)
            div = (self.temp * expansion).astype(F) if expansion else None
            self.project(div)
            self.advect(hdt, wind)
            self.project(div)
            if cooling:
                self.temp *= math.exp(-cooling * hdt)
            if dissipation:
                self.dens *= math.exp(-dissipation * hdt)
            if damping:
                self.vel *= math.exp(-damping * hdt)
            self.dens *= self.sponge
            self.temp *= self.sponge
            self.vel *= self.sponge[None]
            np.maximum(self.dens, 0.0, out=self.dens)
            np.maximum(self.temp, 0.0, out=self.temp)
            self.t += hdt


def value_noise3(shape: Sequence[int], cell: float, seed: int, octaves: int = 4, gain: float = 0.5) -> np.ndarray:
    """Smooth fractal value noise on a grid (cell = feature size in voxels), in [0, 1], deterministic."""
    rng = np.random.default_rng(seed)
    out = np.zeros(tuple(shape), F)
    amp, tot, c = 1.0, 0.0, float(cell)
    for _ in range(octaves):
        cs = [max(2, int(math.ceil(n / c)) + 2) for n in shape]
        lat = rng.random(cs).astype(F)
        coords = [np.arange(n, dtype=F) / c for n in shape]
        g = np.meshgrid(*coords, indexing="ij")
        i0 = [np.floor(a).astype(np.int64) for a in g]
        f = [a - b for a, b in zip(g, i0)]
        f = [t * t * (3 - 2 * t) for t in f]
        acc = np.zeros(tuple(shape), F)
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (f[0] if dx else 1 - f[0]) * (f[1] if dy else 1 - f[1]) * (f[2] if dz else 1 - f[2])
                    acc += lat[i0[0] + dx, i0[1] + dy, i0[2] + dz] * w
        out += acc * amp
        tot += amp
        amp *= gain
        c = max(1.0, c / 2)
    return (out / tot).astype(F)


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


# =========================================================================================== exact integration
def integrate_volume(sigma: np.ndarray, radiance: np.ndarray, extent: Sequence[float], px: int, *, view: str = "front",
                     frame: Sequence[float] | None = None, centered: bool = True, supersample: int = 2,
                     normals: np.ndarray | None = None, normal_strength: float = 1.0) -> tuple[np.ndarray, np.ndarray | None]:
    """Noise-free emission-absorption render of a grid (the same integral Cycles estimates, evaluated exactly):
    front-to-back compositing of piecewise-constant voxels along the view axis (`supersample` sub-slices per voxel,
    linear between slices), then bilinear resampling of the composited image to a px x px frame.
      sigma (1/m) and radiance (per unit extinction, rgb) grids indexed [x, y, z]; `centered` = cell-centred
      (FluidSim) vs vertex grids (ParticleVolume); view "front" (camera at -y looking +y, image up = +z) or
      "top" (camera above looking down, image up = +y); `frame` = (centre u, centre v, side) of the square window
      in meters (front: x, z; top: x, y), default = the box like VolumeRenderer.
      normals: optional unit outward normal grid (3, nx, ny, nz) -> also returns the transmittance-weighted
      surface normal per pixel in tangent space (x right, y up, z towards the camera), encoded * 0.5 + 0.5.
    Returns (premultiplied linear rgba (px, px, 4), row 0 = top; encoded normals or None)."""
    ex = np.array(extent, F)
    n = sigma.shape
    if view == "front":
        order = (0, 2, 1)  # -> [x, z, depth], depth index 0 nearest the camera (y min)
        flip_depth = False
    elif view == "top":
        order = (0, 1, 2)  # -> [x, y, depth], camera above: nearest = z max
        flip_depth = True
    else:
        raise ValueError(f"unknown view {view}")
    s = np.transpose(sigma, order)
    r = np.transpose(radiance, order + (3,))
    nm = np.transpose(normals, (0,) + tuple(o + 1 for o in order)) if normals is not None else None
    if flip_depth:
        s = s[:, :, ::-1]
        r = r[:, :, ::-1]
        if nm is not None:
            nm = nm[:, :, :, ::-1]
    depth_axis_len = float(ex[1] if view == "front" else ex[2])
    nd = s.shape[2]
    dz = depth_axis_len / (nd if centered else max(nd - 1, 1)) / supersample
    T = np.ones(s.shape[:2], np.float64)
    C = np.zeros(s.shape[:2] + (3,), np.float64)
    Nacc = np.zeros(s.shape[:2] + (3,), np.float64) if nm is not None else None
    Wacc = np.zeros(s.shape[:2], np.float64)
    for i in range(nd):
        j = min(i + 1, nd - 1)
        for k in range(supersample):
            t = k / supersample
            si = s[:, :, i] * (1 - t) + s[:, :, j] * t
            ri = r[:, :, i] * (1 - t) + r[:, :, j] * t
            a = 1.0 - np.exp(-np.maximum(si, 0.0) * dz)
            wgt = T * a
            C += wgt[..., None] * ri
            if Nacc is not None:
                ni = nm[:, :, :, i] * (1 - t) + nm[:, :, :, j] * t
                Nacc += wgt[..., None] * np.moveaxis(ni, 0, -1)
            Wacc += wgt
            T *= 1.0 - a
    A = 1.0 - T
    # resample the composited [u, v] image to the output frame
    if view == "front":
        u_len, v_len, u0, v0 = float(ex[0]), float(ex[2]), -float(ex[0]) / 2, 0.0
    else:
        u_len, v_len, u0, v0 = float(ex[0]), float(ex[1]), -float(ex[0]) / 2, -float(ex[1]) / 2
    if frame is None:
        side = max(u_len, v_len)
        frame = (u0 + u_len / 2, v0 + v_len / 2, side)
    cu, cv, side = (float(v) for v in frame)
    pc = (np.arange(px, dtype=np.float64) + 0.5) / px
    wu = cu - side / 2 + pc * side  # columns
    wv = cv + side / 2 - pc * side  # rows (top = high v)
    nu, nv = s.shape[0], s.shape[1]
    if centered:
        gu = (wu - u0) / (u_len / nu) - 0.5
        gv = (wv - v0) / (v_len / nv) - 0.5
    else:
        gu = (wu - u0) / u_len * (nu - 1)
        gv = (wv - v0) / v_len * (nv - 1)

    def sample(img: np.ndarray) -> np.ndarray:
        """Bilinear sample img[u, v, ...] at (gv rows, gu cols); zero outside the grid."""
        U, V = np.meshgrid(gu, gv)
        inside = (U >= -0.5) & (U <= nu - 0.5) & (V >= -0.5) & (V <= nv - 0.5)
        Uc = np.clip(U, 0, nu - 1.0001)
        Vc = np.clip(V, 0, nv - 1.0001)
        u0i = Uc.astype(np.int64)
        v0i = Vc.astype(np.int64)
        fu = Uc - u0i
        fv = Vc - v0i
        if img.ndim == 3:
            fu = fu[..., None]
            fv = fv[..., None]
        out = (img[u0i, v0i] * (1 - fu) * (1 - fv) + img[u0i + 1, v0i] * fu * (1 - fv)
               + img[u0i, v0i + 1] * (1 - fu) * fv + img[u0i + 1, v0i + 1] * fu * fv)
        m = inside[..., None] if img.ndim == 3 else inside
        return np.where(m, out, 0.0)

    rgba = np.concatenate([sample(C), sample(A)[..., None]], axis=-1).astype(F)
    nrm_out = None
    if Nacc is not None:
        Nw = Nacc / np.maximum(Wacc, 1e-9)[..., None]
        # world -> tangent: front (right +x, up +z, towards camera -y); top (right +x, up +y, towards camera +z)
        if view == "front":
            tn = np.stack([Nw[..., 0], Nw[..., 2], -Nw[..., 1]], axis=-1)
        else:
            tn = np.stack([Nw[..., 0], Nw[..., 1], Nw[..., 2]], axis=-1)
        img = sample(tn)
        wimg = sample(Wacc)
        flat = np.array([0.0, 0.0, 1.0])
        k = np.clip(wimg / 0.02, 0, 1)[..., None] * normal_strength
        img = img * k + flat * (1 - k)
        img /= np.maximum(np.linalg.norm(img, axis=-1, keepdims=True), 1e-9)
        nrm_out = (img * 0.5 + 0.5).astype(F)
    return rgba, nrm_out


def density_normals(sigma: np.ndarray, blur_vox: float = 1.5) -> np.ndarray:
    """Outward unit normals of a density field (-grad of the blurred density), shape (3, nx, ny, nz); 0 where flat."""
    b = blur3(sigma, blur_vox) if blur_vox > 0 else sigma.astype(F)
    g = np.stack(np.gradient(b))
    l = np.sqrt((g * g).sum(axis=0)) + 1e-12
    return (-g / l[None]).astype(F)


def frame_window(px: int, margin: float = 0.03, fade: float = 0.08) -> np.ndarray:
    """Safety window for a square frame: exactly 0 within `margin` (fraction of the frame) of every border,
    smooth to 1 over the next `fade` - multiply coverage / emission by it so no frame can touch its border."""
    c = (np.arange(px, dtype=F) + 0.5) / px
    d = np.minimum(c, 1 - c)
    t = np.clip((d - margin) / max(fade, 1e-6), 0, 1)
    w = t * t * (3 - 2 * t)
    return (w[:, None] * w[None, :]).astype(F)


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


__all__ = ["BORDER_LIMIT", "BORDER_PX", "CurlNoise", "EDGES", "FluidSim", "ParticleVolume", "VolumeRenderer", "begin",
           "blackbody_ramp", "blur2", "blur3", "border_levels", "border_signal", "check_borders", "contact_sheet",
           "density_normals", "frame_window", "integrate_volume", "value_noise3",
           "draw_text", "gaussian", "grid2", "light_volume", "loop_blend", "normal_from_alpha", "pack", "polygon_sdf",
           "render_volumes", "segment_distance", "to_straight", "write"]
