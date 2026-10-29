"""
Level-of-detail generation. OWNER: Technical Art Director.

    decimate(obj, ratio, name)                     collapse-decimate a COPY (UV seams and borders kept)
    planar(obj, angle_deg, name)                   planar dissolve a COPY (hard-surface / architecture)
    make_lods(obj, ratios=(1, .5, .25), suffix)    [lod0 (original), lod1, ...] named <name>_lod<N>
    report(objects)                                 {name: triangles}

Naming: every exported LOD object/file is suffixed `_lod0`, `_lod1`, ... (lod0 = full detail).
Prefer *parametric* LODs (re-running the model builder with a lower detail level: fewer segments, no
bevels, merged small parts) for architecture - they hold silhouettes and trim UVs far better than
decimation. Use decimate() for organic meshes and as a last step. The runtime picks LODs by distance
(manifest `lods[i].distance`) and may skip LOD0 on mobile (`minLod`).
Budget guide (triangles): hero landmark LOD0 <= 120k, LOD1 <= 30k; prop LOD0 <= 5k; soldier LOD0
0.3-0.8k (see docs/ARCHITECTURE.md performance budgets).
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

import bpy

from . import mesh as M


def decimate(obj: bpy.types.Object, ratio: float, name: str | None = None, triangulate: bool = True,
             symmetry_axis: str | None = None) -> bpy.types.Object:
    """Collapse decimation of a copy of `obj` to `ratio` of its faces."""
    out = M.duplicate(obj, name or f"{obj.name}_dec")
    m = out.modifiers.new("decimate", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = max(0.001, min(1.0, ratio))
    m.use_collapse_triangulate = triangulate
    if symmetry_axis:
        m.use_symmetry = True
        m.symmetry_axis = symmetry_axis
    # Keep UV islands intact: collapse respects seams/borders through vertex-group-free weighting.
    M.apply_modifier(out, m)
    return out


def planar(obj: bpy.types.Object, angle_deg: float = 2.0, name: str | None = None) -> bpy.types.Object:
    out = M.duplicate(obj, name or f"{obj.name}_planar")
    m = out.modifiers.new("planar", "DECIMATE")
    m.decimate_type = "DISSOLVE"
    m.angle_limit = math.radians(angle_deg)
    m.delimit = {"UV", "MATERIAL", "SHARP"}
    M.apply_modifier(out, m)
    return out


def make_lods(obj: bpy.types.Object, ratios: Sequence[float] = (1.0, 0.5, 0.25), base_name: str | None = None
              ) -> list[bpy.types.Object]:
    base = base_name or obj.name
    lods: list[bpy.types.Object] = []
    for i, r in enumerate(ratios):
        if i == 0 and r >= 1.0:
            obj.name = f"{base}_lod0"
            lods.append(obj)
        else:
            lods.append(decimate(obj, r, f"{base}_lod{i}"))
    return lods


def report(objects: Iterable[bpy.types.Object]) -> dict[str, int]:
    return {o.name: M.triangle_count(o) for o in objects}


__all__ = ["decimate", "make_lods", "planar", "report"]
