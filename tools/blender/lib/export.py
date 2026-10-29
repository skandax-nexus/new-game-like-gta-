"""
glTF 2.0 export for the runtime. OWNER: Technical Art Director.

    info = gltf(path, objects, animations=False, tangents=True)   GLB (+Y up), returns metadata
    model_info(objects)                                           triangles + bounds in glTF/three space
    runtime_material(name, set_id, tint, uv_scale, macro, ...)    texture-less proxy carrying binding extras

Material binding contract (read by src/assets/AssetManager.ts):
    Models do NOT embed textures. Each exported material is a proxy whose glTF `extras` say which texture
    set to bind at runtime for the active quality tier:
        samrajya_set        "<material asset id>" (shared tiling library, e.g. "sandstone_carved_red")
                            or "<model id>:<local set>" (unique bake shipped with the model)
        samrajya_tint       "#rrggbb" multiplied with the set's base color (default "#ffffff")
        samrajya_uv_scale   [su, sv] extra UV scale (default [1, 1])
        samrajya_macro      "<model id>:macro" -> macro map on TEXCOORD_1 (R = AO, G = albedo multiplier)
        samrajya_normal_scale, samrajya_roughness_scale, samrajya_detail_ao (0..1, ORM.r strength)
    The glTF baseColorFactor / roughnessFactor hold the set's average color x tint and roughness, so
    the model still renders plausibly when textures are unavailable (procedural fallback).
UV layers: "UVMap" -> TEXCOORD_0 (texture sets, trims), "UVLightmap" -> TEXCOORD_1 (macro map).
Axes: Blender +Z up / -Y forward -> glTF +Y up / +Z forward (exporter `export_yup`).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Sequence

import bpy
import numpy as np

from . import mesh as M
from .core import log
from .materials import SET_PROP
from .texgen import hex_to_linear

PROXY_PREFIX = "samrajya_"


def runtime_material(name: str, set_id: str | None = None, tint: str = "#ffffff", uv_scale: Sequence[float] = (1, 1),
                     macro: str | None = None, fallback_color: str = "#808080", roughness: float = 0.8,
                     metallic: float = 0.0, normal_scale: float = 1.0, roughness_scale: float = 1.0,
                     detail_ao: float = 1.0, double_sided: bool = False) -> bpy.types.Material:
    """Texture-less proxy material carrying the runtime binding (see module doc)."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    fc = hex_to_linear(fallback_color) * hex_to_linear(tint)
    bsdf.inputs["Base Color"].default_value = (float(fc[0]), float(fc[1]), float(fc[2]), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.use_backface_culling = not double_sided
    if set_id:
        mat[f"{PROXY_PREFIX}set"] = set_id
    mat[f"{PROXY_PREFIX}tint"] = tint
    if tuple(uv_scale) != (1, 1):
        mat[f"{PROXY_PREFIX}uv_scale"] = [float(uv_scale[0]), float(uv_scale[1])]
    if macro:
        mat[f"{PROXY_PREFIX}macro"] = macro
    if normal_scale != 1.0:
        mat[f"{PROXY_PREFIX}normal_scale"] = float(normal_scale)
    if roughness_scale != 1.0:
        mat[f"{PROXY_PREFIX}roughness_scale"] = float(roughness_scale)
    if detail_ao != 1.0:
        mat[f"{PROXY_PREFIX}detail_ao"] = float(detail_ao)
    return mat


def _proxy_for(mat: bpy.types.Material) -> bpy.types.Material | None:
    """Swap a preview material built by materials.from_material_set() for its runtime proxy."""
    set_id = mat.get(SET_PROP)
    if not set_id:
        return None
    return runtime_material(
        f"{mat.name}__rt", set_id=str(set_id), tint=str(mat.get("samrajya_tint", "#ffffff")),
        uv_scale=tuple(mat.get("samrajya_uv_scale", (1, 1))), macro=mat.get("samrajya_macro"),
        fallback_color=str(mat.get("samrajya_fallback_color", "#808080")),
        roughness=float(mat.get("samrajya_fallback_roughness", 0.8)),
    )


def model_info(objects: Iterable[bpy.types.Object]) -> dict[str, Any]:
    objs = [o for o in objects if o.type == "MESH"]
    lo, hi = M.bounds(objs)
    # Blender (x, y, z) -> glTF (x, z, -y)
    gmin = [lo.x, lo.z, -hi.y]
    gmax = [hi.x, hi.z, -lo.y]
    center = [(a + b) * 0.5 for a, b in zip(gmin, gmax)]
    radius = float(np.linalg.norm(np.array(gmax) - np.array(gmin)) * 0.5)
    return {
        "triangles": M.triangle_count(objs),
        "bounds": {"min": [round(v, 4) for v in gmin], "max": [round(v, 4) for v in gmax],
                   "center": [round(v, 4) for v in center], "radius": round(radius, 4)},
    }


def gltf(path: Path | str, objects: Sequence[bpy.types.Object], animations: bool = False, tangents: bool = True,
         vertex_colors: bool = False, extras: dict[str, Any] | None = None, apply_modifiers: bool = True,
         swap_materials: bool = True) -> dict[str, Any]:
    """Export `objects` (+ their armatures when animations=True) to a GLB at `path`."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    objs = list(objects)
    swapped: list[tuple[bpy.types.Object, int, bpy.types.Material]] = []
    if swap_materials:
        for o in objs:
            if o.type != "MESH":
                continue
            for i, m in enumerate(o.data.materials):
                if m is None:
                    continue
                p = _proxy_for(m)
                if p is not None:
                    swapped.append((o, i, m))
                    o.data.materials[i] = p
    # Root extras travel on the scene (glTF scene.extras).
    scn = bpy.context.scene
    for k in [k for k in scn.keys() if k.startswith(PROXY_PREFIX)]:
        del scn[k]
    for k, v in (extras or {}).items():
        scn[f"{PROXY_PREFIX}{k}"] = v
    # Tangents need triangles/quads (MikkTSpace fails on ngons): triangulate through a temporary modifier.
    tri_mods = []
    if tangents:
        for o in objs:
            if o.type == "MESH" and any(p.loop_total > 4 for p in o.data.polygons):
                m = o.modifiers.new("__export_tri", "TRIANGULATE")
                m.quad_method = "FIXED"
                m.ngon_method = "BEAUTY"
                m.keep_custom_normals = True
                tri_mods.append((o, m))
    for o in [x for x in bpy.context.view_layer.objects if x is not None]:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]
    try:
        bpy.ops.export_scene.gltf(
            filepath=str(path),
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=apply_modifiers,
            export_texcoords=True,
            export_normals=True,
            export_tangents=tangents,
            export_vertex_color="ACTIVE" if vertex_colors else "NONE",
            export_all_vertex_colors=False,
            export_materials="EXPORT",
            export_image_format="NONE",
            export_extras=True,
            export_cameras=False,
            export_lights=False,
            export_animations=animations,
            export_animation_mode="ACTIONS",
            export_force_sampling=True,
            export_frame_step=1,
            export_skins=animations,
            export_all_influences=False,
            export_def_bones=True,
            export_leaf_bone=False,
            export_morph=False,
            export_optimize_animation_size=True,
            export_reset_pose_bones=True,
            export_draco_mesh_compression_enable=False,
        )
    finally:
        for o, i, m in swapped:
            o.data.materials[i] = m
        for o, m in tri_mods:
            o.modifiers.remove(m)
    info = model_info(objs)
    info["file"] = path.name
    info["bytes"] = path.stat().st_size
    log(f"exported {path.name}: {info['triangles']} tris, {info['bytes'] / 1024:.0f} KiB")
    return info


__all__ = ["PROXY_PREFIX", "gltf", "model_info", "runtime_material"]
