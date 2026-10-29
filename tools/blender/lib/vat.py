"""
Vertex animation textures (VAT) for crowds: armature + actions -> per-frame deformed positions and normals.
OWNER: Technical Artist G (TA-07). Format and runtime: docs/adr/0003-crowd-impostor-fx-assets.md,
docs/ARCHITECTURE.md §20.

    ctx = vat.begin(__file__)                         # AssetContext of kind "vat"
    body = ...                                        # mesh skinned to `arm` (lib/rig), clips stashed (lib/anim)
    vat.set_vertex_colors(body, team=..., cloth=..., part=...)   # R team mask, G cloth seed, B part id / 255
    lod1 = vat.decimate_lod(body, arm, 0.3)           # lod.decimate + re-bind + colors copied from LOD0
    ctx.meta.update(vat.bake(ctx, arm, [body, lod1], rest=("idle", 0), parts=["skin", "cloth", ...]))
    ctx.finish()

What bake() does, per LOD:
  1. Builds the export vertex table: one vertex per unique (Blender vertex, corner normal, UVs, color) of the
     triangulated rest mesh - the order written to the GLB IS the VAT column order (gl_VertexID).
  2. Evaluates the depsgraph for every clip at `fps` (15): looping clips sample [0, length) (the runtime
     wraps last -> first), one-shots include the end frame.
  3. Stores positions as offsets from the rest pose (rest = a clip frame, e.g. idle 0, so offsets stay small
     and half floats keep sub-millimetre precision) in RGB16F, normals octahedral in RG8, vertex columns
     wrapped so the texture width stays <= 4096 (rows per frame = ceil(V / width)).
  4. Self-check: rest32 + half(offset) vs the exact evaluated positions for every frame -> max error (mm),
     printed and recorded (fails above `max_error_mm`, default 1 mm); octahedral normal error (deg).
  5. Writes the rest-pose GLB itself (minimal glTF writer: POSITION, NORMAL, TEXCOORD_0/1, COLOR_0, one
     primitive, the runtime proxy material with its binding extras) so no exporter can reorder vertices.
Clip table (manifest): {name, startFrame, frames, fps, loop, strideMeters, speed}; stride and speed are
measured from planted-foot motion for locomotion clips (walk/run/...) unless given explicitly.
Axes: Blender (+Z up, model faces -Y) -> three/glTF (+Y up, faces +Z): (x, y, z) -> (x, z, -y).
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path
from typing import Any, Iterable, Sequence

import bpy
import numpy as np

from . import lod as L
from . import mesh as M
from . import rig as R
from .core import AssetContext, begin as core_begin, log, timer

F = np.float32
MAX_WIDTH = 4096
LOCOMOTION = {"walk", "run", "sprint", "charge", "rout", "strafe_l", "strafe_r"}


def begin(script_file: str, seed: int | None = None, fps: int = 30) -> AssetContext:
    """AssetContext for a `@kind vat` script (lib/core knows the original three kinds only)."""
    ctx = core_begin(script_file, kind="model", seed=seed, fps=fps)
    ctx.kind = "vat"
    return ctx


# ------------------------------------------------------------------------------------- vertex colors
def set_vertex_colors(obj: bpy.types.Object, team: float | Sequence[float] | np.ndarray = 0.0,
                      cloth: float | Sequence[float] | np.ndarray = 0.0, part: int | Sequence[int] | np.ndarray = 0,
                      name: str = "Col") -> None:
    """Point-domain float color attribute: R team mask 0..1, G cloth-variation seed 0..1, B part id / 255."""
    n = len(obj.data.vertices)

    def arr(v: Any) -> np.ndarray:
        a = np.asarray(v, dtype=F)
        return np.full(n, float(a), F) if a.ndim == 0 else a.astype(F)

    col = np.stack([arr(team), arr(cloth), arr(part) / 255.0, np.ones(n, F)], axis=1)
    me = obj.data
    if name in me.color_attributes:
        me.color_attributes.remove(me.color_attributes[name])
    attr = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", col.reshape(-1))
    me.color_attributes.active_color = attr


def _point_colors(obj: bpy.types.Object) -> np.ndarray | None:
    me = obj.data
    attr = me.color_attributes.active_color
    if attr is None:
        return None
    if attr.domain != "POINT":
        raise ValueError(f"{obj.name}: VAT vertex colors must be on the POINT domain")
    col = np.empty(len(me.vertices) * 4, F)
    attr.data.foreach_get("color", col)
    return col.reshape(-1, 4)


def decimate_lod(obj: bpy.types.Object, arm: bpy.types.Object, ratio: float, name: str | None = None) -> bpy.types.Object:
    """LOD for VAT: collapse-decimated copy (vertex groups and point colors interpolated within each
    island), cleaned of degenerate faces, re-bound to `arm`; part ids are snapped back to integers."""
    import bmesh

    out = L.decimate(obj, ratio, name or f"{obj.name.rsplit('_lod', 1)[0]}_lod1")
    # Collapse decimation leaves zero-area triangles (no usable normal): dissolve them, drop loose verts.
    bm = bmesh.new()
    bm.from_mesh(out.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges[:])
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(out.data)
    bm.free()
    out.data.update()
    R.bind(out, arm)
    cols = _point_colors(out)
    if cols is not None:
        set_vertex_colors(out, cols[:, 0], cols[:, 1], np.round(cols[:, 2] * 255.0))
    return out


# ------------------------------------------------------------------------------------- math
def octa_encode(n: np.ndarray) -> np.ndarray:
    """Unit vectors (N, 3) -> octahedral [0, 1]^2 (z = hemisphere axis). Mirrored in src/assets/loaders/vat.ts."""
    n = n / np.maximum(np.abs(n).sum(axis=1, keepdims=True), 1e-12)
    p = n[:, :2].copy()
    neg = n[:, 2] < 0
    sx = np.where(p[:, 0] >= 0, 1.0, -1.0)
    sy = np.where(p[:, 1] >= 0, 1.0, -1.0)
    wx = (1.0 - np.abs(p[:, 1])) * sx
    wy = (1.0 - np.abs(p[:, 0])) * sy
    p[neg, 0] = wx[neg]
    p[neg, 1] = wy[neg]
    return p * 0.5 + 0.5


def octa_decode(e: np.ndarray) -> np.ndarray:
    p = e * 2.0 - 1.0
    z = 1.0 - np.abs(p[:, 0]) - np.abs(p[:, 1])
    t = np.clip(-z, 0.0, None)
    x = p[:, 0] + np.where(p[:, 0] >= 0, -t, t)
    y = p[:, 1] + np.where(p[:, 1] >= 0, -t, t)
    v = np.stack([x, y, z], axis=1)
    return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)


def to_three(v: np.ndarray) -> np.ndarray:
    """Blender (x, y, z) -> three (x, z, -y) for (N, 3) arrays."""
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1).astype(F)


def bounds_of(points: np.ndarray) -> dict[str, Any]:
    lo = points.min(axis=0)
    hi = points.max(axis=0)
    c = (lo + hi) * 0.5
    r = float(np.linalg.norm(points - c, axis=1).max()) if len(points) else 0.0
    return {"min": [round(float(x), 4) for x in lo], "max": [round(float(x), 4) for x in hi],
            "center": [round(float(x), 4) for x in c], "radius": round(r, 4)}


# ------------------------------------------------------------------------------------- clips / poses
def clip_actions(arm: bpy.types.Object) -> list[tuple[str, bpy.types.Action, int, bool]]:
    """(name, action, frames @ scene fps, loop) for every clip stashed on the armature (lib/anim.finish)."""
    out = []
    ad = arm.animation_data
    for t in sorted(ad.nla_tracks, key=lambda t: t.name) if ad else []:
        if not t.strips:
            continue
        act = t.strips[0].action
        out.append((t.name, act, int(act.get("samrajya_frames", int(act.frame_range[1] - act.frame_range[0]))),
                    bool(act.get("samrajya_loop", False))))
    return out


def _use_action(arm: bpy.types.Object, action: bpy.types.Action | None) -> None:
    """Make `action` the evaluated clip. Bones the clip does not animate fall back to rest (otherwise they
    would keep whatever pose the previously evaluated clip left in matrix_basis)."""
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = action
    if action is not None and ad.action_slot is None and len(action.slots):
        ad.action_slot = action.slots[0]


def _set_time(frame: float) -> None:
    scn = bpy.context.scene
    f = math.floor(frame)
    scn.frame_set(int(f), subframe=float(frame - f))


def _evaluate(obj: bpy.types.Object) -> tuple[np.ndarray, np.ndarray]:
    """World-space vertex positions (V, 3) and corner normals (L, 3) of the deformed mesh, Blender axes.
    Degenerate corner normals (zero-area faces left by decimation) fall back to the vertex normal."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    try:
        co = np.empty(len(me.vertices) * 3, F)
        me.vertices.foreach_get("co", co)
        cn = np.empty(len(me.loops) * 3, F)
        me.corner_normals.foreach_get("vector", cn)
        vn = np.empty(len(me.vertices) * 3, F)
        me.vertex_normals.foreach_get("vector", vn)
        lv = np.empty(len(me.loops), np.int64)
        me.loops.foreach_get("vertex_index", lv)
    finally:
        ev.to_mesh_clear()
    mw = np.array(obj.matrix_world, dtype=np.float64)
    co = co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3]
    nm = np.linalg.inv(mw[:3, :3]).T
    cn = cn.reshape(-1, 3).astype(np.float64)
    vn = vn.reshape(-1, 3).astype(np.float64)[lv]
    bad = np.linalg.norm(cn, axis=1) < 0.5
    cn[bad] = vn[bad]
    still = np.linalg.norm(cn, axis=1) < 0.5
    cn[still] = (0.0, 0.0, 1.0)
    cn = cn @ nm.T
    cn /= np.maximum(np.linalg.norm(cn, axis=1, keepdims=True), 1e-12)
    return co, cn


def _sample_frames(frames30: int, loop: bool, scene_fps: int, fps: int) -> list[float]:
    """Scene-frame times of the baked samples (scene frame 1 = clip start)."""
    dur = frames30 / scene_fps
    n = max(1, int(round(dur * fps)))
    count = n if loop else n + 1
    return [1.0 + (k / fps) * scene_fps for k in range(count)]


# ------------------------------------------------------------------------------------- export table
def _export_table(obj: bpy.types.Object) -> dict[str, np.ndarray]:
    """Unique export vertices of the (triangulated) rest mesh: per export vertex its Blender vertex and a
    representative loop; triangle indices into the export vertices."""
    me = obj.data
    if any(p.loop_total != 3 for p in me.polygons):
        raise ValueError(f"{obj.name}: triangulate VAT meshes before baking (lib/mesh.triangulate)")
    nl = len(me.loops)
    lv = np.empty(nl, np.int64)
    me.loops.foreach_get("vertex_index", lv)
    keys = [lv.astype(np.float64)[:, None]]
    uvs = {}
    for name in ("UVMap", "UVLightmap"):
        layer = me.uv_layers.get(name)
        if layer is None:
            continue
        uv = np.empty(nl * 2, F)
        layer.data.foreach_get("uv", uv)
        uvs[name] = uv.reshape(-1, 2)
        keys.append(np.round(uvs[name].astype(np.float64) * 65536.0))
    cn = np.empty(nl * 3, F)
    me.corner_normals.foreach_get("vector", cn)
    cn = cn.reshape(-1, 3)
    keys.append(np.round(cn.astype(np.float64) * 1024.0))
    key = np.concatenate(keys, axis=1)
    _, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    # Order export vertices by first use in the triangle stream (deterministic, cache friendly).
    order = np.argsort(first, kind="stable")
    rank = np.empty_like(order)
    rank[order] = np.arange(len(order))
    rep_loop = first[order]
    tri = rank[inverse.reshape(-1)].reshape(-1, 3)
    out = {"vertex": lv[rep_loop], "loop": rep_loop, "triangles": tri}
    for k, v in uvs.items():
        out[k] = v[rep_loop]
    return out


# ------------------------------------------------------------------------------------- GLB writer
def _pad4(b: bytes, fill: bytes = b"\x00") -> bytes:
    return b + fill * ((4 - len(b) % 4) % 4)


def write_glb(path: Path, positions: np.ndarray, normals: np.ndarray, indices: np.ndarray,
              uv0: np.ndarray | None = None, uv1: np.ndarray | None = None, colors: np.ndarray | None = None,
              material: dict[str, Any] | None = None, name: str = "mesh", extras: dict[str, Any] | None = None) -> int:
    """Minimal glTF 2.0 binary with ONE primitive whose vertex order is exactly the given arrays (three axes).
    UVs are given in Blender convention (v up) and written glTF-style (v down)."""
    blobs: list[bytes] = []
    views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    offset = 0

    def add(data: np.ndarray, comp: int, typ: str, target: int | None, normalized: bool = False,
            minmax: bool = False) -> int:
        nonlocal offset
        raw = np.ascontiguousarray(data).tobytes()
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw), **({"target": target} if target else {})})
        blobs.append(_pad4(raw))
        offset += len(_pad4(raw))
        acc: dict[str, Any] = {"bufferView": len(views) - 1, "componentType": comp, "count": int(data.shape[0]), "type": typ}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = [float(x) for x in data.min(axis=0)]
            acc["max"] = [float(x) for x in data.max(axis=0)]
        accessors.append(acc)
        return len(accessors) - 1

    attrs = {"POSITION": add(positions.astype("<f4"), 5126, "VEC3", 34962, minmax=True),
             "NORMAL": add(normals.astype("<f4"), 5126, "VEC3", 34962)}
    if uv0 is not None:
        attrs["TEXCOORD_0"] = add(np.stack([uv0[:, 0], 1.0 - uv0[:, 1]], axis=1).astype("<f4"), 5126, "VEC2", 34962)
    if uv1 is not None:
        attrs["TEXCOORD_1"] = add(np.stack([uv1[:, 0], 1.0 - uv1[:, 1]], axis=1).astype("<f4"), 5126, "VEC2", 34962)
    if colors is not None:
        c8 = np.clip(np.round(colors * 255.0), 0, 255).astype(np.uint8)
        attrs["COLOR_0"] = add(c8, 5121, "VEC4", 34962, normalized=True)
    idx_type = (np.uint16, 5123) if positions.shape[0] < 65535 else (np.uint32, 5125)
    ind = add(indices.reshape(-1, 1).astype(idx_type[0]), idx_type[1], "SCALAR", 34963)
    accessors[ind]["count"] = int(indices.size)
    mat = material or {"name": "vat", "pbrMetallicRoughness": {"baseColorFactor": [0.6, 0.6, 0.6, 1], "metallicFactor": 0, "roughnessFactor": 0.8}}
    doc = {
        "asset": {"version": "2.0", "generator": "samrajya lib/vat.py"},
        "scene": 0,
        "scenes": [{"nodes": [0], **({"extras": extras} if extras else {})}],
        "nodes": [{"name": name, "mesh": 0}],
        "meshes": [{"name": name, "primitives": [{"attributes": attrs, "indices": ind, "material": 0, "mode": 4}]}],
        "materials": [mat],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": offset}],
    }
    js = _pad4(json.dumps(doc, separators=(",", ":")).encode(), b" ")
    bin_ = b"".join(blobs)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(bin_), 0x004E4942))
        f.write(bin_)
    return total


def proxy_material(name: str, fallback_color: Sequence[float] = (0.6, 0.6, 0.6), roughness: float = 0.8,
                   set_id: str | None = None, tint: str = "#ffffff", uv_scale: Sequence[float] | None = None) -> dict[str, Any]:
    """glTF material dict carrying the runtime binding extras (lib/export.runtime_material contract)."""
    extras: dict[str, Any] = {"samrajya_tint": tint}
    if set_id:
        extras["samrajya_set"] = set_id
    if uv_scale is not None:
        extras["samrajya_uv_scale"] = [float(uv_scale[0]), float(uv_scale[1])]
    return {"name": name, "extras": extras,
            "pbrMetallicRoughness": {"baseColorFactor": [float(fallback_color[0]), float(fallback_color[1]), float(fallback_color[2]), 1.0],
                                     "metallicFactor": 0.0, "roughnessFactor": float(roughness)}}


# ------------------------------------------------------------------------------------- stride
def _measure_stride(frames_pos: list[np.ndarray], fps: int, contact_m: float = 0.035) -> tuple[float | None, float | None]:
    """Planted-foot speed of an in-place locomotion clip (three axes, +Z forward): vertices near the
    ground at two consecutive samples move backwards at the walking speed. Returns (stride m, speed m/s)."""
    n = len(frames_pos)
    if n < 4:
        return None, None
    vel = []
    for k in range(n):
        a = frames_pos[k]
        b = frames_pos[(k + 1) % n]
        floor = min(a[:, 1].min(), b[:, 1].min())
        planted = (a[:, 1] < floor + contact_m) & (b[:, 1] < floor + contact_m)
        if planted.sum() < 3:
            continue
        dz = (b[planted, 2] - a[planted, 2]) * fps
        vel.append(float(np.median(dz)))
    if not vel:
        return None, None
    speed = -float(np.median(vel))
    if speed <= 0.05:
        return None, None
    return speed * n / fps, speed


# ------------------------------------------------------------------------------------- bake
def bake(ctx: AssetContext, arm: bpy.types.Object, lods: Sequence[bpy.types.Object], fps: int = 15,
         clips: Sequence[str] | None = None, rest: tuple[str, float] | None = ("idle", 0), parts: Sequence[str] = (),
         stride: dict[str, float] | None = None, lod_distances: Sequence[float] | None = None,
         material: dict[str, Any] | None = None, material_sets: Sequence[str] = (), max_error_mm: float = 1.0,
         min_lod: dict[str, int] | None = None) -> dict[str, Any]:
    """Bake every LOD (meshes skinned to `arm`) for every stashed clip. Returns the manifest `vat` metadata."""
    scn = bpy.context.scene
    scene_fps = scn.render.fps
    all_clips = clip_actions(arm)
    wanted = list(clips) if clips is not None else [c[0] for c in all_clips]
    table = {c[0]: c for c in all_clips}
    for c in wanted:
        if c not in table:
            raise ValueError(f"clip '{c}' is not stashed on {arm.name} (have {sorted(table)})")
    # ---- clip table (frame blocks are shared by every LOD)
    clip_meta: list[dict[str, Any]] = []
    sample_plan: list[tuple[str, list[float]]] = []
    start = 0
    for name in wanted:
        _, action, f30, loop = table[name]
        times = _sample_frames(f30, loop, scene_fps, fps)
        sample_plan.append((name, times))
        clip_meta.append({"name": name, "startFrame": start, "frames": len(times), "fps": fps, "loop": loop})
        start += len(times)
    total_frames = start
    # ---- rest pose
    _use_action(arm, table[rest[0]][1] if rest is not None else None)
    _set_time(1.0 + rest[1] / fps * scene_fps if rest is not None else 1.0)
    lod_meta: list[dict[str, Any]] = []
    stride_meta: dict[str, tuple[float | None, float | None]] = {}
    anim_lo = np.full(3, 1e18)
    anim_hi = np.full(3, -1e18)
    rest_bounds = None
    for li, obj in enumerate(lods):
        with timer(f"VAT lod{li} ({obj.name})"):
            tbl = _export_table(obj)
            V = len(tbl["vertex"])
            rows = max(1, math.ceil(V / MAX_WIDTH))
            W = math.ceil(V / rows)
            H = total_frames * rows
            if H > MAX_WIDTH:
                raise ValueError(f"{obj.name}: {total_frames} frames x {rows} rows = {H} > {MAX_WIDTH}; split clips")
            # rest (re-applied per LOD: the previous LOD left the last clip frame in the pose)
            _use_action(arm, table[rest[0]][1] if rest is not None else None)
            _set_time(1.0 + rest[1] / fps * scene_fps if rest is not None else 1.0)
            rco, rcn = _evaluate(obj)
            rest_pos = to_three(rco[tbl["vertex"]])
            rest_nrm = to_three(rcn[tbl["loop"]])
            if rest_bounds is None:
                rest_bounds = bounds_of(rest_pos)
            pos = np.zeros((H, W, 3), np.float16)
            nrm = np.zeros((H, W, 2), np.uint8)
            col_idx = np.arange(V) % W
            row_off = np.arange(V) // W
            max_err = 0.0
            max_ang = 0.0
            fidx = 0
            for name, times in sample_plan:
                _use_action(arm, table[name][1])
                frames_pos = []
                for t in times:
                    _set_time(t)
                    co, cn = _evaluate(obj)
                    p = to_three(co[tbl["vertex"]]).astype(np.float64)
                    n = to_three(cn[tbl["loop"]]).astype(np.float64)
                    off = (p - rest_pos.astype(np.float64)).astype(np.float16)
                    rec = rest_pos.astype(np.float64) + off.astype(np.float64)
                    max_err = max(max_err, float(np.abs(rec - p).max()))
                    enc = np.clip(np.round(octa_encode(n) * 255.0), 0, 255).astype(np.uint8)
                    dec = octa_decode(enc.astype(np.float64) / 255.0)
                    cosang = np.clip((dec * n).sum(axis=1), -1.0, 1.0)
                    max_ang = max(max_ang, float(np.degrees(np.arccos(cosang.min()))))
                    rows_ = fidx * rows + row_off
                    pos[rows_, col_idx] = off
                    nrm[rows_, col_idx] = enc
                    anim_lo = np.minimum(anim_lo, p.min(axis=0))
                    anim_hi = np.maximum(anim_hi, p.max(axis=0))
                    if li == 0:
                        frames_pos.append(p)
                    fidx += 1
                if li == 0 and name in LOCOMOTION and table[name][3]:
                    stride_meta[name] = _measure_stride(frames_pos, fps)
            err_mm = max_err * 1000.0
            log(f"VAT lod{li}: {V} vertices, {len(tbl['triangles'])} tris, texture {W}x{H} ({rows} rows/frame), "
                f"{total_frames} frames - max reconstruction error {err_mm:.4f} mm (limit {max_error_mm} mm), "
                f"max normal error {max_ang:.2f} deg")
            if err_mm > max_error_mm:
                raise RuntimeError(f"VAT lod{li}: reconstruction error {err_mm:.3f} mm > {max_error_mm} mm")
            stem = f"{ctx.id}.lod{li}"
            ppath = ctx.path(f"{stem}.pos.bin")
            npath = ctx.path(f"{stem}.nrm.bin")
            ppath.write_bytes(pos.astype("<f2").tobytes())
            npath.write_bytes(nrm.tobytes())
            cols = _point_colors(obj)
            colors = cols[tbl["vertex"]] if cols is not None else None
            glb = ctx.path(f"{stem}.glb")
            write_glb(glb, rest_pos, rest_nrm, tbl["triangles"], tbl.get("UVMap"), tbl.get("UVLightmap"), colors,
                      material or proxy_material(f"{ctx.id}_mat"), name=f"{ctx.id}_lod{li}", extras={"samrajya_id": ctx.id})
            ctx.add_file(f"lod{li}", glb)
            ctx.add_file(f"lod{li}_pos", ppath)
            ctx.add_file(f"lod{li}_nrm", npath)
            lod_meta.append({"lod": li, "vertices": V, "triangles": int(len(tbl["triangles"])), "width": W, "height": H,
                             "rowsPerFrame": rows, "errorMm": round(err_mm, 4), "normalErrorDeg": round(max_ang, 3)})
    _use_action(arm, None)
    for c in clip_meta:
        st = (stride or {}).get(c["name"])
        measured = stride_meta.get(c["name"], (None, None))
        if st is not None:
            if measured[0] is not None and abs(measured[0] - st) > 0.15 * st:
                log(f"WARNING: clip {c['name']}: stride {st:.2f} m given, feet measure {measured[0]:.2f} m (sliding)")
            c["strideMeters"] = st
            c["speed"] = st * c["fps"] / c["frames"]
        elif measured[0] is not None:
            c["strideMeters"], c["speed"] = measured
            log(f"clip {c['name']}: measured stride {measured[0]:.3f} m, speed {measured[1]:.3f} m/s")
        else:
            c["strideMeters"] = None
            c["speed"] = None
    pts = np.stack([anim_lo, anim_hi]) if np.all(anim_hi >= anim_lo) else np.zeros((2, 3))
    meta = {
        "fps": fps,
        "frames": total_frames,
        "clips": clip_meta,
        "lods": lod_meta,
        "bounds": bounds_of(pts),
        "restBounds": rest_bounds,
        "parts": list(parts),
        "vertexColors": True,
        "materialSets": list(material_sets),
        "minLod": min_lod or {"ultra": 0, "high": 0, "mobile": 0},
        "rest": {"clip": rest[0], "frame": rest[1]} if rest is not None else None,
    }
    if lod_distances:
        meta["lodDistances"] = list(lod_distances)
    # The animated-bounds sphere must enclose every frame (instanced culling): use the box half-diagonal.
    b = meta["bounds"]
    b["radius"] = round(float(np.linalg.norm(np.array(b["max"]) - np.array(b["min"])) * 0.5), 4)
    return meta


__all__ = ["begin", "bake", "bounds_of", "clip_actions", "decimate_lod", "octa_decode", "octa_encode", "proxy_material",
           "set_vertex_colors", "to_three", "write_glb"]
