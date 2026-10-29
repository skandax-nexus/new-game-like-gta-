"""
@asset banner_cloth
@kind model
@style emblems:BANNER_SHAPES, factions:BANNER_DIMENSIONS.infantryStandard, factions:BANNER_DIMENSIONS.cloth

Banner meshes for the six `BannerShape`s (ASSET_LIST WP7-18): one shared pole + crossbar + finial + crossbar
tassels and one cloth node per shape (`cloth_<shape>`, plus `fringe_fringed` strips), published with named nodes
kept (variants pick the shape). Authored at BANNER_DIMENSIONS.infantryStandard (pole 4.2 m, cloth 1.1 x 1.6 m);
the runtime scales the cloth by (clothW / 1.1, clothH / 1.6) and the pole by poleM / 4.2 for the other standards.

Cloth contract (render/fx/banners, cloth shader BANNER_DIMENSIONS.cloth):
  - UV = SVG viewBox 0 0 100 150 of `bannerSvg()` (u = x / 100, v = y / 150, v = 0 at the crossbar / texture
    top, flipY false) - the runtime-generated banner texture maps 1:1, emblem placement included.
  - COLOR_0.r = cloth weight: 0 at the crossbar (pinned), rising with the distance below it to 1 at the free
    edge; COLOR_0.g = 1 on secondary hanging parts (fringe strips, tassel cords) that swing more loosely, else 0;
    COLOR_0.b = 0. Data, not albedo (`meta.vertexColors = 'data'`); pole / crossbar carry weight 0.
  - Tessellated on a ~5 cm lattice clipped to the outline (constrained Delaunay) so the wave deformation is smooth.
Materials: `banner_cloth` (white, double-sided, roughness 0.85: the runtime binds the banner texture),
`banner_wood` (pole) and `banner_brass` (finial, tassel caps), factor-only. OWNER: Technical Artist G (TA-07).
"""
import json
import math
import os
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import bpy  # noqa: E402  (before bmesh / mathutils: initializes the module)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector, geometry  # noqa: E402

from lib import core, export, mesh as M, render  # noqa: E402

ctx = core.begin(__file__, kind="model")


def style(ref: str):
    env = os.environ.get("SAMRAJYA_STYLE")
    if env:
        values = json.loads(env)
        if ref in values:
            return values[ref]
    out = subprocess.check_output(["node", str(core.REPO_ROOT / "tools/assets/build.mjs"), "--style", ref], cwd=core.REPO_ROOT)
    return json.loads(out)[ref]


SHAPES: dict[str, str] = style("emblems:BANNER_SHAPES")
DIM = style("factions:BANNER_DIMENSIONS.infantryStandard")
CLOTH = style("factions:BANNER_DIMENSIONS.cloth")
POLE_M = float(DIM["poleM"])
CLOTH_W = float(DIM["clothW"])
CLOTH_H = float(DIM["clothH"])
SX = CLOTH_W / 100.0  # viewBox units -> meters
SY = CLOTH_H / 150.0
CROSSBAR_Z = POLE_M - 0.22  # crossbar height (Blender Z up)
CLOTH_Y = -0.035  # cloth hangs just in front of the pole (Blender -Y = glTF +Z = front)
LATTICE = 5.0  # viewBox units (~5.5 cm)


def parse_path(d: str) -> list[tuple[float, float]]:
    """Absolute M/L/H/V/Z path -> polygon (viewBox units)."""
    toks = re.findall(r"[MLHVZ]|-?\d+(?:\.\d+)?", d)
    pts: list[tuple[float, float]] = []
    i = 0
    cmd = ""
    cx = cy = 0.0
    while i < len(toks):
        t = toks[i]
        if t in "MLHVZ":
            cmd = t
            i += 1
            if cmd == "Z":
                continue
            continue
        if cmd in ("M", "L"):
            cx, cy = float(toks[i]), float(toks[i + 1])
            i += 2
        elif cmd == "H":
            cx = float(t)
            i += 1
        elif cmd == "V":
            cy = float(t)
            i += 1
        pts.append((cx, cy))
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return pts


def resample(poly: list[tuple[float, float]], step: float) -> list[tuple[float, float]]:
    out = []
    for a, b in zip(poly, poly[1:] + poly[:1]):
        n = max(1, int(math.ceil(math.dist(a, b) / step)))
        for k in range(n):
            out.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    return out


def inside(poly: list[tuple[float, float]], p: tuple[float, float]) -> bool:
    x, y = p
    c = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0 + 1e-12) + x0:
            c = not c
    return c


def edge_dist(poly: list[tuple[float, float]], p: tuple[float, float]) -> float:
    best = 1e9
    for a, b in zip(poly, poly[1:] + poly[:1]):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / max(dx * dx + dy * dy, 1e-12)))
        best = min(best, math.dist(p, (ax + t * dx, ay + t * dy)))
    return best


def sheet(name: str, poly: list[tuple[float, float]], mat: bpy.types.Material, secondary: float = 0.0,
          weight_range: tuple[float, float] | None = None) -> bpy.types.Object:
    """Constrained-Delaunay cloth sheet inside `poly` (viewBox units) with UVs and cloth weights."""
    boundary = resample(poly, LATTICE)
    interior = []
    ys = [p[1] for p in poly]
    xs = [p[0] for p in poly]
    y = min(ys) + LATTICE * 0.5
    row = 0
    while y < max(ys):
        x = min(xs) + (LATTICE * 0.5 if row % 2 else 0.0)
        while x <= max(xs):
            if inside(poly, (x, y)) and edge_dist(poly, (x, y)) > LATTICE * 0.45:
                interior.append((x, y))
            x += LATTICE
        y += LATTICE * 0.87
        row += 1
    verts2 = [Vector((p[0], p[1])) for p in boundary + interior]
    nb = len(boundary)
    edges = [(k, (k + 1) % nb) for k in range(nb)]
    out = geometry.delaunay_2d_cdt(verts2, edges, [list(range(nb))], 1, 1e-6)
    vco, _, faces = out[0], out[1], out[2]
    y0 = min(ys)
    y1 = max(ys)
    lo, hi = weight_range if weight_range else (y0, y1)
    verts, uvs, cols = [], [], []
    for v in vco:
        vx, vy = float(v[0]), float(v[1])
        verts.append(((vx - 50.0) * SX, CLOTH_Y, CROSSBAR_Z - vy * SY))
    loop_uv = []
    for f in faces:
        for vi in f:
            vx, vy = float(vco[vi][0]), float(vco[vi][1])
            loop_uv.append((vx / 100.0, 1.0 - vy / 150.0))  # Blender v up; the exporter flips to glTF v down
    # faces from CDT are CCW in viewBox (y down) -> flip so the normal faces -Y (front, glTF +Z)
    faces_f = [list(reversed(f)) for f in faces]
    loop_uv_f = []
    k = 0
    for f in faces:
        uv = loop_uv[k:k + len(f)]
        loop_uv_f += list(reversed(uv))
        k += len(f)
    obj = M.from_pydata(name, verts, faces_f, uvs=loop_uv_f, smooth=True, material=mat)
    me = obj.data
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, v in enumerate(vco):
        w = min(1.0, max(0.0, (float(v[1]) - lo) / max(hi - lo, 1e-6)))
        attr.data[i].color = (w, secondary, 0.0, 1.0)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0
    # consistent normals facing front (-Y)
    if sum(p.normal.y for p in me.polygons) > 0:
        for p in me.polygons:
            p.flip()
    return obj


def cylinder(name: str, r: float, z0: float, z1: float, mat: bpy.types.Material, seg: int = 10, axis: str = "z",
             center: tuple[float, float, float] = (0.0, 0.0, 0.0), taper: float = 1.0, weight: float = 0.0,
             secondary: float = 0.0) -> bpy.types.Object:
    bm = bmesh.new()
    rings = []
    for z, rr in ((z0, r), (z1, r * taper)):
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            c, s = math.cos(a) * rr, math.sin(a) * rr
            if axis == "z":
                co = (center[0] + c, center[1] + s, center[2] + z)
            else:  # along x
                co = (center[0] + z, center[1] + c, center[2] + s)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    for k in range(seg):
        bm.faces.new((rings[0][k], rings[0][(k + 1) % seg], rings[1][(k + 1) % seg], rings[1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    M.link(obj)
    me.materials.append(mat)
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i in range(len(me.vertices)):
        attr.data[i].color = (weight, secondary, 0.0, 1.0)
    me.color_attributes.active_color = attr
    M.ensure_uv(obj)
    M.shade_smooth(obj, 50)
    return obj


cloth_mat = export.runtime_material("banner_cloth", fallback_color="#ffffff", roughness=0.85, double_sided=True)
wood_mat = export.runtime_material("banner_wood", fallback_color="#6b4a2f", roughness=0.7)
brass_mat = export.runtime_material("banner_brass", fallback_color="#c9a227", roughness=0.35, metallic=1.0)

parts: list[bpy.types.Object] = []
pole = cylinder("pole", 0.024, 0.0, POLE_M, wood_mat, seg=10, taper=0.8)
half = CLOTH_W / 2 + 0.06
crossbar = cylinder("crossbar", 0.014, -half, half, wood_mat, seg=8, axis="x", center=(0.0, 0.0, CROSSBAR_Z + 0.012))
finial = cylinder("finial", 0.03, POLE_M, POLE_M + 0.22, brass_mat, seg=8, taper=0.05)
# tassels at the crossbar ends: cap + cord bundle (secondary motion)
tassel_parts = []
for sx in (-1, 1):
    cx = sx * half
    tassel_parts.append(cylinder(f"tassel_cap_{sx}", 0.02, -0.04, 0.0, brass_mat, seg=8, center=(cx, 0.0, CROSSBAR_Z), taper=0.6))
    tassel_parts.append(cylinder(f"tassel_cord_{sx}", 0.022, -0.3, -0.04, cloth_mat, seg=8, center=(cx, 0.0, CROSSBAR_Z),
                                 taper=0.45, weight=1.0, secondary=1.0))
tassels = M.join(tassel_parts, "tassels")
for p in tassels.data.polygons:
    p.use_smooth = True
parts += [pole, crossbar, finial, tassels]

variants = []
cloth_nodes: dict[str, list[str]] = {}
for shape, d in SHAPES.items():
    poly = parse_path(d)
    obj = sheet(f"cloth_{shape}", poly, cloth_mat)
    nodes = [obj.name]
    parts.append(obj)
    if shape == "fringed":
        # fringe strips under the cloth, matching bannerSvg(): 12 rects x = 2 + 8.3 i, w 4, y 128 -> 146 / 150
        strips = []
        for i in range(12):
            x0 = 2 + i * 8.3
            h = 18 if i % 2 else 22
            s = sheet(f"fringe_{i}", [(x0, 127.0), (x0 + 4, 127.0), (x0 + 4, 128 + h), (x0, 128 + h)], cloth_mat,
                      secondary=1.0, weight_range=(0.0, 150.0))
            strips.append(s)
        fr = M.join(strips, "fringe_fringed")
        parts.append(fr)
        nodes.append(fr.name)
    cloth_nodes[shape] = nodes
    variants.append({"name": shape, "kind": "shape", "nodes": nodes})

info = export.gltf(ctx.path(f"{ctx.id}.lod0.glb"), parts, vertex_colors=True, extras={"id": ctx.id})
ctx.add_file("lod0", ctx.path(f"{ctx.id}.lod0.glb"), keepNodes=True)
tris = {o.name: M.triangle_count(o) for o in parts}
ctx.meta.update({
    "description": "Banner pole + crossbar + finial + tassels and the six BannerShape cloths (variants), cloth weights in COLOR_0.r.",
    "bounds": info["bounds"],
    "lodDistances": [0],
    "triangles": [info["triangles"]],
    "variants": variants,
    "sockets": {
        "finial": {"bone": None, "position": [0.0, round(POLE_M, 4), 0.0], "rotation": [0, 0, 0, 1]},
        "grip": {"bone": None, "position": [0.0, 1.15, 0.0], "rotation": [0, 0, 0, 1]},
        "crossbar": {"bone": None, "position": [0.0, round(CROSSBAR_Z, 4), 0.0], "rotation": [0, 0, 0, 1]},
    },
    "meta": {
        "vertexColors": "data",
        "authoredFor": "infantryStandard",
        "dimensions": {"poleM": POLE_M, "clothW": CLOTH_W, "clothH": CLOTH_H, "crossbarY": round(CROSSBAR_Z, 4)},
        "uv": "bannerSvg viewBox 0 0 100 150, u = x / 100, v = y / 150 (v = 0 at the crossbar), flipY false",
        "clothWeight": "COLOR_0.r: 0 pinned at the crossbar -> 1 at the free edge; COLOR_0.g: 1 = loose secondary parts",
        "cloth": CLOTH,
        "nodeTriangles": tris,
    },
})
if ctx.preview:
    # preview: every shape side by side; cloth shaded by its weight (saffron pinned -> deep red free edge)
    pm = bpy.data.materials.new("banner_preview_weight")
    pm.use_nodes = True
    nt = pm.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    attr_node = nt.nodes.new("ShaderNodeAttribute")
    attr_node.attribute_name = "Col"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.82, 0.3, 0.03, 1)
    ramp.color_ramp.elements[1].color = (0.35, 0.02, 0.03, 1)
    nt.links.new(attr_node.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Red"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    shown = []
    for k, shape in enumerate(SHAPES):
        group = [pole, crossbar, finial, tassels] + [bpy.data.objects[n] for n in cloth_nodes[shape]]
        for o in group:
            c = o.copy()
            c.data = o.data
            c.location.x += (k - 2.5) * 1.6
            M.link(c)
            for slot in c.material_slots:
                if slot.material is cloth_mat:
                    slot.link = "OBJECT"
                    slot.material = pm
            shown.append(c)
    for o in parts:
        o.hide_render = True
    p = render.preview(ctx.path("preview.png"), shown, azimuth=180, elevation=6, lens=50, sun_elevation=30,
                       sun_azimuth=150, res=(1600, 800), samples=ctx.samples(64, 8), margin=1.04, ground_color="#7a6a55")
    ctx.add_file("preview", p)
ctx.finish()
