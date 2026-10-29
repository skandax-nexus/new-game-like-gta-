"""
Modeling utilities for asset scripts (no operators that need a UI context). OWNER: Technical Art Director.

Objects
    from_pydata(name, verts, faces, uvs=None, smooth=True)      build an object from python/numpy data
    join(objects, name)                                          merge objects into one (keeps materials)
    duplicate(obj, name, linked=False)                           copy (data copied unless linked)
    apply_transform(obj)                                         bake location/rotation/scale into the mesh

Modifiers (all applied immediately through the evaluated depsgraph - deterministic, headless-safe)
    bevel(obj, width, segments, angle_deg, profile, harden)     edge bevel (limit by angle)
    solidify(obj, thickness, offset)                             shell thickness
    array(obj, count, offset_m | relative, merge)               linear array
    subdivide(obj, levels, simple)                               Catmull-Clark / simple subdivision
    displace(obj, image | texture, strength, midlevel, uv)      displacement along normals
    weld(obj, distance)                                          merge by distance
    triangulate(obj)                                             quads/ngons -> triangles
    apply_modifier(obj, mod)                                     generic: apply any configured modifier

Normals / shading
    shade_smooth(obj, angle_deg)                                 smooth + sharp edges above angle
    weighted_normals(obj, weight, keep_sharp)                    face-area weighted custom normals (hard-surface)

UVs (numpy, deterministic)
    box_uv(obj, tile_m, uv_name)                                 world-size box projection (tiling materials)
    cylinder_uv(obj, tile_m, axis, uv_name)                      wrap around the Z axis (u = arc length)
    uv_transform(obj, face_mask, scale, offset, uv_name)         affine edit of a face subset
    smart_uv(obj, angle_deg, margin, uv_name)                    Blender smart project (unique bakes)
    lightmap_uv(obj, uv_name, margin, quality)                   non-overlapping UV2 for macro/AO bakes
    ensure_uv(obj, uv_name)                                      create a UV layer if missing

Queries
    triangle_count(obj | objects), bounds(obj | objects) (Blender space), vertex_array(obj)

Units: meters. Blender is +Z up; author models FACING -Y (Blender front view) so that the glTF
export (+Y up) faces +Z in three.js, which the game treats as the model's forward/"south" side.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

import bpy
import numpy as np
from mathutils import Vector

F = np.float32


# ------------------------------------------------------------------------------------------ objects
def link(obj: bpy.types.Object, collection: bpy.types.Collection | None = None) -> bpy.types.Object:
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def from_pydata(name: str, verts: Sequence, faces: Sequence, uvs: Sequence | None = None, smooth: bool = True,
                uv_name: str = "UVMap", material: bpy.types.Material | None = None) -> bpy.types.Object:
    """Mesh object from vertices (n,3) and faces (lists of vertex indices). `uvs` = per-LOOP uv list
    in face order (same flattening as `faces`), optional."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    if uvs is not None:
        layer = me.uv_layers.new(name=uv_name)
        flat = np.asarray(uvs, dtype=F).reshape(-1)
        layer.data.foreach_set("uv", flat)
    me.validate(clean_customdata=False)
    me.update()
    if smooth:
        me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    link(obj)
    if material is not None:
        me.materials.append(material)
    return obj


def duplicate(obj: bpy.types.Object, name: str | None = None, linked: bool = False) -> bpy.types.Object:
    new = obj.copy()
    if not linked and obj.data is not None:
        new.data = obj.data.copy()
    new.name = name or f"{obj.name}_copy"
    link(new)
    return new


def apply_transform(obj: bpy.types.Object) -> bpy.types.Object:
    """Bake the object's transform into its mesh data (identity transform afterwards)."""
    mw = obj.matrix_world.copy()
    obj.data.transform(mw)
    obj.matrix_world.identity()
    return obj


def join(objects: Sequence[bpy.types.Object], name: str) -> bpy.types.Object:
    """Join meshes (transforms baked in, materials merged by identity, UV layers matched by name).
    Uses bmesh-free data concatenation so it works without an operator context."""
    objects = [o for o in objects if o is not None and o.type == "MESH"]
    if not objects:
        raise ValueError("join(): no mesh objects")
    with bpy.context.temp_override(active_object=objects[0], selected_editable_objects=objects,
                                   selected_objects=objects, object=objects[0]):
        for o in [x for x in bpy.context.view_layer.objects if x is not None]:
            o.select_set(False)
        for o in objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
    out = objects[0]
    out.name = name
    out.data.name = name
    return out


# ---------------------------------------------------------------------------------------- modifiers
def apply_modifier(obj: bpy.types.Object, mod: bpy.types.Modifier) -> bpy.types.Object:
    """Apply one modifier by evaluating the depsgraph (keeps other modifiers untouched)."""
    others = [m for m in obj.modifiers if m != mod]
    states = [(m, m.show_viewport, m.show_render) for m in others]
    for m, _, _ in states:
        m.show_viewport = False
        m.show_render = False
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = obj.evaluated_get(dg)
    new_me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.remove(mod)
    obj.data = new_me
    new_me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    for m, v, r in states:
        m.show_viewport = v
        m.show_render = r
    return obj


def bevel(obj: bpy.types.Object, width: float = 0.01, segments: int = 2, angle_deg: float = 35.0,
          profile: float = 0.5, harden: bool = True, clamp: bool = True) -> bpy.types.Object:
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle_deg)
    m.profile = profile
    m.use_clamp_overlap = clamp
    m.harden_normals = harden
    m.miter_outer = "MITER_ARC"
    return apply_modifier(obj, m)


def solidify(obj: bpy.types.Object, thickness: float, offset: float = -1.0, even: bool = True) -> bpy.types.Object:
    m = obj.modifiers.new("solidify", "SOLIDIFY")
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = even
    m.use_quality_normals = True
    return apply_modifier(obj, m)


def array(obj: bpy.types.Object, count: int, offset_m: Sequence[float] | None = None,
          relative: Sequence[float] | None = None, merge: float | None = None) -> bpy.types.Object:
    m = obj.modifiers.new("array", "ARRAY")
    m.count = count
    if offset_m is not None:
        m.use_relative_offset = False
        m.use_constant_offset = True
        m.constant_offset_displace = tuple(offset_m)
    else:
        m.use_relative_offset = True
        m.relative_offset_displace = tuple(relative or (1.0, 0.0, 0.0))
    if merge is not None:
        m.use_merge_vertices = True
        m.merge_threshold = merge
    return apply_modifier(obj, m)


def subdivide(obj: bpy.types.Object, levels: int = 1, simple: bool = False) -> bpy.types.Object:
    m = obj.modifiers.new("subsurf", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    m.subdivision_type = "SIMPLE" if simple else "CATMULL_CLARK"
    m.uv_smooth = "PRESERVE_BOUNDARIES"
    return apply_modifier(obj, m)


def displace(obj: bpy.types.Object, image: bpy.types.Image | None = None, texture: bpy.types.Texture | None = None,
             strength: float = 0.02, midlevel: float = 0.5, uv_name: str = "") -> bpy.types.Object:
    """Displace along vertex normals by an image (UV mapped) or any bpy texture."""
    if texture is None:
        if image is None:
            raise ValueError("displace(): image or texture required")
        texture = bpy.data.textures.new(f"{obj.name}_disp", "IMAGE")
        texture.image = image
        texture.extension = "REPEAT"
    m = obj.modifiers.new("displace", "DISPLACE")
    m.texture = texture
    m.texture_coords = "UV"
    if uv_name:
        m.uv_layer = uv_name
    m.strength = strength
    m.mid_level = midlevel
    return apply_modifier(obj, m)


def weld(obj: bpy.types.Object, distance: float = 1e-4) -> bpy.types.Object:
    m = obj.modifiers.new("weld", "WELD")
    m.merge_threshold = distance
    return apply_modifier(obj, m)


def triangulate(obj: bpy.types.Object) -> bpy.types.Object:
    m = obj.modifiers.new("tri", "TRIANGULATE")
    m.quad_method = "BEAUTY"
    m.ngon_method = "BEAUTY"
    m.keep_custom_normals = True
    return apply_modifier(obj, m)


# ------------------------------------------------------------------------------------- shading
def shade_smooth(obj: bpy.types.Object, angle_deg: float = 40.0) -> bpy.types.Object:
    """Smooth shading with sharp edges above `angle_deg` (Blender 4.1+ replacement of auto smooth)."""
    me = obj.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle_deg))
    return obj


def shade_flat(obj: bpy.types.Object) -> bpy.types.Object:
    obj.data.shade_flat()
    return obj


def weighted_normals(obj: bpy.types.Object, weight: int = 50, keep_sharp: bool = True) -> bpy.types.Object:
    m = obj.modifiers.new("wnormals", "WEIGHTED_NORMAL")
    m.weight = weight
    m.keep_sharp = keep_sharp
    m.mode = "FACE_AREA"
    return apply_modifier(obj, m)


# -------------------------------------------------------------------------------------------- UVs
def ensure_uv(obj: bpy.types.Object, uv_name: str = "UVMap") -> bpy.types.MeshUVLoopLayer:
    me = obj.data
    layer = me.uv_layers.get(uv_name)
    if layer is None:
        layer = me.uv_layers.new(name=uv_name)
    return layer


def _loop_arrays(obj: bpy.types.Object, world: bool = True):
    me = obj.data
    nv = len(me.vertices)
    co = np.empty(nv * 3, F)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    if world:
        mw = np.array(obj.matrix_world, dtype=F)
        co = co @ mw[:3, :3].T + mw[:3, 3]
    nl = len(me.loops)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get("vertex_index", lv)
    npoly = len(me.polygons)
    pn = np.empty(npoly * 3, F)
    me.polygons.foreach_get("normal", pn)
    pn = pn.reshape(-1, 3)
    if world:
        pn = pn @ mw[:3, :3].T
        pn /= np.maximum(np.linalg.norm(pn, axis=1, keepdims=True), 1e-9)
    ls = np.empty(npoly, np.int32)
    me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(npoly, np.int32)
    me.polygons.foreach_get("loop_total", lt)
    loop_poly = np.repeat(np.arange(npoly), lt)
    return co, lv, pn, loop_poly


def _set_uv(obj: bpy.types.Object, uv: np.ndarray, uv_name: str) -> None:
    layer = ensure_uv(obj, uv_name)
    layer.data.foreach_set("uv", np.asarray(uv, F).reshape(-1))


def get_uv(obj: bpy.types.Object, uv_name: str = "UVMap") -> np.ndarray:
    layer = obj.data.uv_layers.get(uv_name)
    if layer is None:
        raise KeyError(uv_name)
    a = np.empty(len(obj.data.loops) * 2, F)
    layer.data.foreach_get("uv", a)
    return a.reshape(-1, 2)


def box_uv(obj: bpy.types.Object, tile_m: float | Sequence[float] = 2.0, uv_name: str = "UVMap",
           offset: Sequence[float] = (0.0, 0.0)) -> None:
    """World-scale box projection: each face projects along its dominant axis; side faces keep +V = +Z
    (so trim bands stay horizontal and streak/dust directions in the texture match the world)."""
    tw, th = (tile_m, tile_m) if isinstance(tile_m, (int, float)) else tuple(tile_m)
    co, lv, pn, lp = _loop_arrays(obj)
    p = co[lv]
    n = pn[lp]
    ax = np.argmax(np.abs(n), axis=1)
    u = np.where(ax == 0, p[:, 1] * np.sign(n[:, 0]), np.where(ax == 1, -p[:, 0] * np.sign(n[:, 1]), p[:, 0]))
    v = np.where(ax == 2, p[:, 1] * np.sign(n[:, 2] + 1e-9), p[:, 2])
    uv = np.stack([u / tw + offset[0], v / th + offset[1]], axis=1)
    _set_uv(obj, uv, uv_name)


def cylinder_uv(obj: bpy.types.Object, tile_m: float | Sequence[float] = 2.0, radius: float | None = None,
                uv_name: str = "UVMap", v_from: str = "z", seam_angle: float = -math.pi / 2) -> None:
    """Wrap around the object's local Z axis: u = arc length at `radius` (default: per-vertex radius) /
    tile, v = z / tile. Faces crossing the seam are unwrapped continuously (no smeared strip)."""
    tw, th = (tile_m, tile_m) if isinstance(tile_m, (int, float)) else tuple(tile_m)
    co, lv, pn, lp = _loop_arrays(obj, world=False)
    p = co[lv]
    ang = (np.arctan2(p[:, 1], p[:, 0]) - seam_angle) % (2 * np.pi)
    r = np.hypot(p[:, 0], p[:, 1]) if radius is None else np.full(len(p), radius, F)
    # make each face continuous across the seam
    me = obj.data
    npoly = len(me.polygons)
    ls = np.empty(npoly, np.int32)
    me.polygons.foreach_get("loop_start", ls)
    mx = np.maximum.reduceat(ang, ls)
    mn = np.minimum.reduceat(ang, ls)
    wrap = (mx - mn) > np.pi
    fix = wrap[lp] & (ang < np.pi)
    ang = np.where(fix, ang + 2 * np.pi, ang)
    u = ang * r / tw
    v = p[:, 2] / th
    _set_uv(obj, np.stack([u, v], axis=1), uv_name)


def uv_transform(obj: bpy.types.Object, face_mask: np.ndarray | None = None, scale: Sequence[float] = (1.0, 1.0),
                 offset: Sequence[float] = (0.0, 0.0), uv_name: str = "UVMap") -> None:
    """uv' = uv * scale + offset for the loops of the masked faces (all faces when mask is None)."""
    uv = get_uv(obj, uv_name)
    _, _, _, lp = _loop_arrays(obj, world=False)
    sel = np.ones(len(uv), bool) if face_mask is None else np.asarray(face_mask, bool)[lp]
    uv[sel] = uv[sel] * np.asarray(scale, F) + np.asarray(offset, F)
    _set_uv(obj, uv, uv_name)


def _uv_operator(obj: bpy.types.Object, uv_name: str, fn) -> None:
    me = obj.data
    layer = ensure_uv(obj, uv_name)
    # Keep NAMES only: layer references are invalidated by edit-mode toggles (stale pointer -> crash).
    prev_name = me.uv_layers.active.name if me.uv_layers.active is not None else None
    me.uv_layers.active = layer
    for o in [x for x in bpy.context.view_layer.objects if x is not None]:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        fn()
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
        me = obj.data
        if prev_name is not None and prev_name != uv_name and prev_name in me.uv_layers:
            me.uv_layers.active = me.uv_layers[prev_name]


def smart_uv(obj: bpy.types.Object, angle_deg: float = 66.0, margin: float = 0.004, uv_name: str = "UVMap",
             scale_to_bounds: bool = False) -> None:
    """Blender Smart UV Project (unique texture bakes)."""
    _uv_operator(obj, uv_name, lambda: bpy.ops.uv.smart_project(
        angle_limit=math.radians(angle_deg), island_margin=margin, area_weight=0.0,
        correct_aspect=True, scale_to_bounds=scale_to_bounds))


def lightmap_uv(obj: bpy.types.Object, uv_name: str = "UVLightmap", margin: float = 0.004, quality: int = 12) -> None:
    """Non-overlapping second UV set for macro AO / grime bakes (glTF TEXCOORD_1, three.js `uv1`).
    Uses Smart UV Project + island packing (rotation allowed) - better texel use than Lightmap Pack."""
    def run() -> None:
        bpy.ops.uv.smart_project(angle_limit=math.radians(60.0), island_margin=margin, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        try:  # concave packing nests islands inside rings/annuli (domes, copings, paving)
            bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, margin_method="FRACTION", margin=margin,
                                    shape_method="CONCAVE")
        except TypeError:
            bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, margin_method="FRACTION", margin=margin)
    _uv_operator(obj, uv_name, run)


# ------------------------------------------------------------------------------------------ queries
def triangle_count(objs: bpy.types.Object | Iterable[bpy.types.Object]) -> int:
    objs = [objs] if isinstance(objs, bpy.types.Object) else list(objs)
    total = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH":
            continue
        me = o.evaluated_get(dg).data
        lt = np.empty(len(me.polygons), np.int32)
        me.polygons.foreach_get("loop_total", lt)
        total += int(np.sum(lt - 2))
    return total


def vertex_array(obj: bpy.types.Object, world: bool = True) -> np.ndarray:
    co, _, _, _ = _loop_arrays(obj, world)
    return co


def bounds(objs: bpy.types.Object | Iterable[bpy.types.Object]) -> tuple[Vector, Vector]:
    """World-space AABB (Blender axes) of mesh objects."""
    objs = [objs] if isinstance(objs, bpy.types.Object) else list(objs)
    lo = np.full(3, 1e18)
    hi = np.full(3, -1e18)
    for o in objs:
        if o.type != "MESH" or len(o.data.vertices) == 0:
            continue
        co = vertex_array(o, True)
        lo = np.minimum(lo, co.min(axis=0))
        hi = np.maximum(hi, co.max(axis=0))
    return Vector(lo.tolist()), Vector(hi.tolist())


__all__ = [
    "apply_modifier",
    "apply_transform",
    "array",
    "bevel",
    "bounds",
    "box_uv",
    "cylinder_uv",
    "displace",
    "duplicate",
    "ensure_uv",
    "from_pydata",
    "get_uv",
    "join",
    "lightmap_uv",
    "link",
    "shade_flat",
    "shade_smooth",
    "smart_uv",
    "solidify",
    "subdivide",
    "triangle_count",
    "triangulate",
    "uv_transform",
    "vertex_array",
    "weighted_normals",
    "weld",
]
