"""
PBR materials in Blender for previews, baking and glTF export. OWNER: Technical Art Director.

    principled(name, base_color, roughness, metallic)            plain Principled BSDF material
    texture_set_material(name, base_color=, normal=, orm=, ...)   material from a baked texture set (paths)
    from_material_set(dep, name)                                  material from another asset's texture set
                                                                  (tools/blender/assets/materials/*), tagged
                                                                  so export swaps it for a runtime-bound proxy
    assign(obj, mat, slot)                                        set / append a material slot

Material-set binding (shared tiling libraries instead of embedding textures in every model):
a material created by from_material_set() carries the custom property
`samrajya_material_set = "<set id>"`. lib/export.py replaces it by a texture-less proxy with the same
custom property (exported as glTF material `extras`) and the set's average colour / roughness as
factors. At runtime src/assets/AssetManager.ts sees `material.userData.samrajya_material_set` and
binds the shared, tier-appropriate textures (src/render/materials/pbr.ts). The proxy factors are the
graceful fallback if the set fails to load.
"""
from __future__ import annotations

from pathlib import Path

import bpy

from .core import Dependency
from .nodes import NodeBuilder
from .texgen import hex_to_linear

SET_PROP = "samrajya_material_set"


def _color(c) -> tuple[float, float, float, float]:
    if isinstance(c, str):
        v = hex_to_linear(c)
        return (float(v[0]), float(v[1]), float(v[2]), 1.0)
    return (c[0], c[1], c[2], 1.0)


def principled(name: str, base_color="#808080", roughness: float = 0.8, metallic: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    nb.principled(base_color=_color(base_color), roughness=roughness, metallic=metallic)
    return mat


def _load(path: Path | str, non_color: bool) -> bpy.types.Image:
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def texture_set_material(
    name: str,
    base_color: Path | str | None = None,
    normal: Path | str | None = None,
    orm: Path | str | None = None,
    uv_scale: tuple[float, float] = (1.0, 1.0),
    normal_strength: float = 1.0,
    uv_map: str = "",
    vertex_color: str | None = None,
    roughness_scale: float = 1.0,
) -> bpy.types.Material:
    """Principled material from texture files (PNG). `vertex_color` multiplies base colour by a colour
    attribute (macro AO / grime baked per vertex), matching three.js vertexColors."""
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    uv = nb.uv(uv_map)
    if uv_scale != (1.0, 1.0):
        uv = nb.vmath("MULTIPLY", uv, (uv_scale[0], uv_scale[1], 1.0)).outputs[0]
    bc = None
    if base_color:
        bc = nb.image(_load(base_color, False), uv, non_color=False).outputs["Color"]
        if vertex_color:
            bc = nb.mix(bc, nb.attribute(vertex_color), 1.0, blend="MULTIPLY")
    rough = 0.8
    metal = 0.0
    if orm:
        sep = nb.separate(nb.image(_load(orm, True), uv).outputs["Color"])
        rough = sep.outputs[1] if roughness_scale == 1.0 else nb.math("MULTIPLY", sep.outputs[1], roughness_scale)
        metal = sep.outputs[2]
    nrm = None
    if normal:
        nrm = nb.normal_map(nb.image(_load(normal, True), uv).outputs["Color"], normal_strength, uv_map)
    nb.principled(base_color=bc if bc is not None else (0.5, 0.5, 0.5), roughness=rough, metallic=metal, normal=nrm)
    return mat


def from_material_set(dep: Dependency, name: str | None = None, uv_scale: tuple[float, float] = (1.0, 1.0),
                      uv_map: str = "", vertex_color: str | None = None) -> bpy.types.Material:
    """Material from another asset's baked texture set (roles baseColor / normal / orm), tagged for
    runtime binding (see module doc)."""
    mat = texture_set_material(
        name or dep.id,
        base_color=dep.file("baseColor") if dep.has("baseColor") else None,
        normal=dep.file("normal") if dep.has("normal") else None,
        orm=dep.file("orm") if dep.has("orm") else None,
        uv_scale=uv_scale,
        uv_map=uv_map,
        vertex_color=vertex_color,
    )
    mat[SET_PROP] = dep.id
    meta = dep.meta.get("material", {})
    mat["samrajya_fallback_color"] = meta.get("averageColor", "#808080")
    mat["samrajya_fallback_roughness"] = float(meta.get("roughness", 0.8))
    return mat


def assign(obj: bpy.types.Object, mat: bpy.types.Material, slot: int | None = None) -> int:
    mats = obj.data.materials
    if slot is None:
        if len(mats) == 0:
            mats.append(mat)
            return 0
        mats[0] = mat
        return 0
    while len(mats) <= slot:
        mats.append(None)
    mats[slot] = mat
    return slot


__all__ = ["SET_PROP", "assign", "from_material_set", "principled", "texture_set_material"]
