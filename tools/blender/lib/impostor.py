"""
Impostor captures: orthographic Cycles renders of an object from many directions, packed into atlases.
OWNER: Technical Artist G (TA-07). Format and runtime: docs/adr/0003-crowd-impostor-fx-assets.md.

    ctx = impostor.begin(__file__)
    objs = build_tree(...)                                       # the same builder as the model asset
    ctx.meta.update(impostor.capture(ctx, objs, grid=8, frame_px=256, source="model_test_tree"))
    ctx.finish()

    sheet = impostor.capture_yaw_sheet(objs_at_each_key_frame, directions=8, frame_px=128)   # VAT far LOD

Layout ("hemi-octahedral", ground objects): frame (col i, row j) of an N x N grid (row 0 at the top of the
image) shows the object seen from direction d = hemi_octa_decode(i / (N - 1), j / (N - 1)) (three.js axes,
unit vector from the object center towards the camera). Decode: p = uv * 2 - 1, x = (p.x + p.y) / 2,
z = (p.x - p.y) / 2, y = 1 - |x| - |z|. Frame basis: right = normalize(cross(-d, +Y)), up = cross(right, -d)
(the straight-down view uses -Z as up). The runtime (src/assets/loaders/impostor.ts) mirrors these formulas.
Maps (8-bit RGBA PNG at the ultra frame size; the publisher derives 192 / 128 px tiers frame by frame):
    albedo  sRGB base color (emission override, no lighting) + coverage alpha
    normal  object-space normal * 0.5 + 0.5 (three axes) + depth alpha: 1 = sphere front (towards the
            camera), 0.5 = center plane, 0 = back; depthRange = 2 * radius meters
Renders: one emission-override pass per map (base color / normal / depth taken from each material's
Principled BSDF inputs, so texture-mapped and alpha-cutout materials capture correctly), film transparent,
orthographic camera framing the bounding sphere, few samples (anti-aliasing only, no light transport).
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Callable, Sequence

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import texgen as tg
from .core import AssetContext, begin as core_begin, log, timer

F = np.float32


def begin(script_file: str, seed: int | None = None) -> AssetContext:
    """AssetContext for a `@kind impostor` script."""
    ctx = core_begin(script_file, kind="model", seed=seed)
    ctx.kind = "impostor"
    return ctx


# ------------------------------------------------------------------------------------- math (three axes)
def hemi_octa_decode(u: float, v: float) -> np.ndarray:
    px, py = u * 2.0 - 1.0, v * 2.0 - 1.0
    x, z = (px + py) * 0.5, (px - py) * 0.5
    y = max(0.0, 1.0 - abs(x) - abs(z))
    d = np.array([x, y, z], np.float64)
    return d / max(np.linalg.norm(d), 1e-12)


def hemi_octa_encode(d: Sequence[float]) -> tuple[float, float]:
    x, y, z = float(d[0]), max(0.0, float(d[1])), float(d[2])
    s = abs(x) + y + abs(z)
    x, z = x / s, z / s
    return ((x + z) * 0.5 + 0.5, (x - z) * 0.5 + 0.5)


def frame_basis(d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(right, up) of the capture camera looking along -d (three axes)."""
    fwd = -np.asarray(d, np.float64)
    ref = np.array([0.0, 1.0, 0.0]) if abs(fwd[1]) < 0.9999 else np.array([0.0, 0.0, -1.0])
    right = np.cross(fwd, ref)
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    return right, up


def three_to_blender(v: Sequence[float]) -> Vector:
    return Vector((float(v[0]), -float(v[2]), float(v[1])))


def blender_to_three(v: Sequence[float]) -> list[float]:
    return [float(v[0]), float(v[2]), -float(v[1])]


def bounding_sphere(objects: Sequence[bpy.types.Object]) -> tuple[np.ndarray, float]:
    """Center (three axes) and radius of the evaluated meshes (AABB center, max vertex distance)."""
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objects:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3, F)
        me.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
        mw = np.array(o.matrix_world, np.float64)
        co = co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3]
        pts.append(np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1))
    p = np.concatenate(pts)
    c = (p.min(axis=0) + p.max(axis=0)) * 0.5
    return c, float(np.linalg.norm(p - c, axis=1).max())


# ------------------------------------------------------------------------------------- material override
class _Override:
    """Temporarily rewires every material of `objects` to an emission of one quantity (albedo / normal /
    depth) mixed with transparency by the material's alpha, then restores the original node links."""

    def __init__(self, objects: Sequence[bpy.types.Object]) -> None:
        self.mats: list[bpy.types.Material] = []
        for o in objects:
            if o.type != "MESH":
                continue
            for slot in o.material_slots:
                if slot.material is not None and slot.material not in self.mats:
                    self.mats.append(slot.material)
        self.saved: list[tuple[bpy.types.Material, Any, list[bpy.types.Node]]] = []
        self.depth_inputs: list[tuple[Any, Any]] = []

    def apply(self, mode: str, center_bl: Vector, view_bl: Vector, radius: float) -> None:
        self.restore()
        for mat in self.mats:
            nt = mat.node_tree
            out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or next(
                (n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            if out is None:
                continue
            prev = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            added: list[bpy.types.Node] = []

            def node(kind: str) -> bpy.types.Node:
                n = nt.nodes.new(kind)
                added.append(n)
                return n

            def src(inp_name: str, default: Any) -> Any:
                if bsdf is not None:
                    inp = bsdf.inputs[inp_name]
                    if inp.links:
                        return inp.links[0].from_socket
                    return inp.default_value
                return default

            em = node("ShaderNodeEmission")
            em.inputs["Strength"].default_value = 1.0
            if mode == "albedo":
                col = src("Base Color", (0.5, 0.5, 0.5, 1.0))
                if isinstance(col, bpy.types.NodeSocket):
                    nt.links.new(col, em.inputs["Color"])
                else:
                    em.inputs["Color"].default_value = tuple(col)
            elif mode == "normal":
                nsrc = src("Normal", None) if bsdf is not None and bsdf.inputs["Normal"].links else None
                if nsrc is None:
                    geo = node("ShaderNodeNewGeometry")
                    nsrc = geo.outputs["Normal"]
                sep = node("ShaderNodeSeparateXYZ")
                nt.links.new(nsrc, sep.inputs[0])
                comb = node("ShaderNodeCombineXYZ")
                neg = node("ShaderNodeMath")
                neg.operation = "MULTIPLY"
                neg.inputs[1].default_value = -1.0
                nt.links.new(sep.outputs["X"], comb.inputs["X"])
                nt.links.new(sep.outputs["Z"], comb.inputs["Y"])
                nt.links.new(sep.outputs["Y"], neg.inputs[0])
                nt.links.new(neg.outputs[0], comb.inputs["Z"])
                enc = node("ShaderNodeVectorMath")
                enc.operation = "MULTIPLY_ADD"
                enc.inputs[1].default_value = (0.5, 0.5, 0.5)
                enc.inputs[2].default_value = (0.5, 0.5, 0.5)
                nt.links.new(comb.outputs[0], enc.inputs[0])
                nt.links.new(enc.outputs[0], em.inputs["Color"])
            else:  # depth: 0.5 + dot(P - C, d) / (2 r)
                geo = node("ShaderNodeNewGeometry")
                sub = node("ShaderNodeVectorMath")
                sub.operation = "SUBTRACT"
                sub.inputs[1].default_value = tuple(center_bl)
                nt.links.new(geo.outputs["Position"], sub.inputs[0])
                dot = node("ShaderNodeVectorMath")
                dot.operation = "DOT_PRODUCT"
                dot.inputs[1].default_value = tuple(view_bl)
                nt.links.new(sub.outputs[0], dot.inputs[0])
                ma = node("ShaderNodeMath")
                ma.operation = "MULTIPLY_ADD"
                ma.inputs[1].default_value = 1.0 / (2.0 * radius)
                ma.inputs[2].default_value = 0.5
                nt.links.new(dot.outputs["Value"], ma.inputs[0])
                nt.links.new(ma.outputs[0], em.inputs["Color"])
                self.depth_inputs.append((sub.inputs[1], dot.inputs[1]))
            shader_out = em.outputs[0]
            alpha = src("Alpha", 1.0)
            if isinstance(alpha, bpy.types.NodeSocket) or (isinstance(alpha, float) and alpha < 1.0):
                tr = node("ShaderNodeBsdfTransparent")
                mix = node("ShaderNodeMixShader")
                if isinstance(alpha, bpy.types.NodeSocket):
                    nt.links.new(alpha, mix.inputs[0])
                else:
                    mix.inputs[0].default_value = float(alpha)
                nt.links.new(tr.outputs[0], mix.inputs[1])
                nt.links.new(em.outputs[0], mix.inputs[2])
                shader_out = mix.outputs[0]
            nt.links.new(shader_out, out.inputs["Surface"])
            self.saved.append((mat, prev, added))

    def restore(self) -> None:
        for mat, prev, added in self.saved:
            nt = mat.node_tree
            out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or next(
                (n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            for n in added:
                nt.nodes.remove(n)
            if out is not None and prev is not None:
                nt.links.new(prev, out.inputs["Surface"])
        self.saved = []
        self.depth_inputs = []


# ------------------------------------------------------------------------------------- rendering
def _camera(name: str = "impostor_cam") -> bpy.types.Object:
    scn = bpy.context.scene
    cd = bpy.data.cameras.get(name) or bpy.data.cameras.new(name)
    cd.type = "ORTHO"
    cam = bpy.data.objects.get(name) or bpy.data.objects.new(name, cd)
    if cam.name not in scn.collection.objects:
        scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def _place(cam: bpy.types.Object, center3: np.ndarray, d3: np.ndarray, radius: float, margin: float) -> None:
    right, up = frame_basis(d3)
    fwd = -d3
    # Blender camera looks down its local -Z with +Y up: columns = right, up, -fwd (= back).
    R = Matrix((tuple(three_to_blender(right)), tuple(three_to_blender(up)), tuple(three_to_blender(-fwd)))).transposed()
    loc = three_to_blender(center3 + d3 * radius * 3.0)
    cam.matrix_world = Matrix.Translation(loc) @ R.to_4x4()
    cam.data.ortho_scale = 2.0 * radius * margin
    cam.data.clip_start = 0.01
    cam.data.clip_end = radius * 8.0


def _render_rgba(px: int, samples: int) -> np.ndarray:
    """Render the active camera to float RGBA (linear, premultiplied alpha), top-down."""
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    c = scn.cycles
    c.device = "CPU"
    c.samples = samples
    c.use_adaptive_sampling = False
    c.use_denoising = False
    c.max_bounces = 0
    c.transparent_max_bounces = 16
    c.seed = 0
    c.pixel_filter_type = "BLACKMAN_HARRIS"
    c.filter_width = 1.5
    scn.render.resolution_x = px
    scn.render.resolution_y = px
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = True
    scn.view_settings.view_transform = "Standard"
    scn.view_settings.look = "None"
    scn.view_settings.exposure = 0.0
    bpy.ops.render.render()
    tmp = Path(bpy.app.tempdir or "/tmp") / f"samrajya_impostor_{px}.exr"
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


def _hide_others(objects: Sequence[bpy.types.Object]) -> list[tuple[bpy.types.Object, bool]]:
    keep = set(objects)
    saved = []
    for o in bpy.context.scene.objects:
        if o.type in {"MESH", "CURVES", "VOLUME", "LIGHT"} and o not in keep:
            saved.append((o, o.hide_render))
            o.hide_render = True
    return saved


def render_views(objects: Sequence[bpy.types.Object], dirs: Sequence[np.ndarray], frame_px: int, center: np.ndarray,
                 radius: float, samples: int = 16, margin: float = 1.0,
                 before_view: Callable[[int], None] | None = None) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Albedo (sRGB rgb + alpha) and normal (rgb + depth alpha) frames, float [0, 1], one per direction."""
    scn = bpy.context.scene
    world = scn.world
    scn.world = None
    hidden = _hide_others(objects)
    cam = _camera()
    ov = _Override(objects)
    albedo_frames, normal_frames = [], []
    try:
        for k, d in enumerate(dirs):
            if before_view is not None:
                before_view(k)
            _place(cam, center, d, radius, margin)
            c_bl = three_to_blender(center)
            d_bl = three_to_blender(d)
            ov.apply("albedo", c_bl, d_bl, radius)
            a = _render_rgba(frame_px, samples)
            ov.apply("normal", c_bl, d_bl, radius)
            n = _render_rgba(frame_px, samples)
            ov.apply("depth", c_bl, d_bl, radius)
            z = _render_rgba(frame_px, max(4, samples // 2))
            alpha = np.clip(a[..., 3], 0.0, 1.0)
            inv = np.where(alpha > 1e-4, 1.0 / np.maximum(alpha, 1e-4), 0.0)[..., None]
            rgb = tg.linear_to_srgb(np.clip(a[..., :3] * inv, 0.0, 1.0))
            nalpha = np.clip(n[..., 3], 0.0, 1.0)
            ninv = np.where(nalpha > 1e-4, 1.0 / np.maximum(nalpha, 1e-4), 0.0)[..., None]
            nrm = np.clip(n[..., :3] * ninv, 0.0, 1.0)
            zalpha = np.clip(z[..., 3], 0.0, 1.0)
            depth = np.clip(z[..., 0] / np.maximum(zalpha, 1e-4), 0.0, 1.0) * (zalpha > 1e-4)
            albedo_frames.append(np.concatenate([rgb, alpha[..., None]], axis=-1).astype(F))
            normal_frames.append(np.concatenate([nrm, depth[..., None]], axis=-1).astype(F))
    finally:
        ov.restore()
        for o, h in hidden:
            o.hide_render = h
        scn.world = world
    return albedo_frames, normal_frames


def pack(frames: Sequence[np.ndarray], cols: int, rows: int) -> np.ndarray:
    h, w, c = frames[0].shape
    out = np.zeros((rows * h, cols * w, c), F)
    for k, f in enumerate(frames):
        r, cc = divmod(k, cols)
        out[r * h:(r + 1) * h, cc * w:(cc + 1) * w] = f
    return out


def _preview_sheet(albedo: np.ndarray, normal: np.ndarray, path: Path) -> Path:
    """Albedo over a checker (left) and normal (right), side by side, for the critique loop."""
    h, w = albedo.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    checker = np.where(((yy // 16) + (xx // 16)) % 2 == 0, 0.32, 0.42)[..., None].astype(F)
    a = albedo[..., 3:4]
    left = albedo[..., :3] * a + checker * (1 - a)
    right = normal[..., :3] * a + checker * (1 - a)
    tg.write_png(path, np.concatenate([left, right], axis=1), 8)
    return path


def capture(ctx: AssetContext, objects: Sequence[bpy.types.Object], grid: int = 8, frame_px: int = 256,
            samples: int = 16, switch_distance: float | None = None, source: str | None = None,
            margin: float = 1.0) -> dict[str, Any]:
    """Hemi-octahedral impostor of `objects` -> albedo.png + normal.png (+ preview) and manifest metadata."""
    px = ctx.res(frame_px, max(32, frame_px // 4))
    center, radius = bounding_sphere(objects)
    radius *= margin
    dirs = [hemi_octa_decode(i / (grid - 1), j / (grid - 1)) for j in range(grid) for i in range(grid)]
    with timer(f"impostor capture {grid}x{grid} @ {px}px"):
        alb, nrm = render_views(objects, dirs, px, center, radius, samples=ctx.samples(samples, 4))
    A = pack(alb, grid, grid)
    N = pack(nrm, grid, grid)
    pa = tg.write_png(ctx.path("albedo.png"), A, 8)
    pn = tg.write_png(ctx.path("normal.png"), N, 8)
    ctx.add_file("albedo", pa)
    ctx.add_file("normal", pn)
    if ctx.preview:
        ctx.add_file("preview", _preview_sheet(A, N, ctx.path("preview.png")))
    sw = switch_distance if switch_distance is not None else round(max(40.0, radius * 18.0), 1)
    log(f"impostor: radius {radius:.3f} m, center {np.round(center, 3).tolist()}, switch {sw} m")
    return {"layout": "hemi-octahedral", "grid": grid, "radius": round(radius, 4),
            "center": [round(float(x), 4) for x in center], "switchDistance": sw, "depthRange": round(2 * radius, 4),
            "source": source, "framePx": {"ultra": frame_px, "high": int(frame_px * 0.75), "mobile": frame_px // 2}}


def yaw_dirs(directions: int = 8, elevation_deg: float = 30.0) -> list[np.ndarray]:
    """Directions around +Y starting at the model front (+Z), counter-clockwise seen from above."""
    el = math.radians(elevation_deg)
    out = []
    for k in range(directions):
        a = 2 * math.pi * k / directions
        out.append(np.array([math.sin(a) * math.cos(el), math.sin(el), math.cos(a) * math.cos(el)]))
    return out


__all__ = ["begin", "blender_to_three", "bounding_sphere", "capture", "frame_basis", "hemi_octa_decode",
           "hemi_octa_encode", "pack", "render_views", "three_to_blender", "yaw_dirs"]
