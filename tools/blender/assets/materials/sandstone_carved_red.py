"""
@asset sandstone_carved_red
@kind material

Carved red sandstone TRIM SHEET (tiling PBR set). 2 m x 2 m per tile, horizontally and vertically
seamless. Bands (bottom -> top, see metadata.trims for UV ranges):
    ashlar_base 0.32 m | vine_scroll 0.24 | dentil 0.12 | padma 0.20 | bead_reel 0.08 |
    medallion_frieze 0.40 | ashlar 0.64 (two courses)
Map a face's V range onto a band to "trim" it (cornices, plinths, railing bars); use the whole sheet
as a richly carved wall. OWNER: Technical Art Director.

Pipeline: numpy ornament height fields (lib/ornament) -> weathering (lib/stone) -> Cycles ray-traced
AO of the displaced heightfield (lib/bake) -> albedo/roughness synthesis -> normal from height ->
PNG set (baseColor sRGB, normal 16-bit, ORM, height 16-bit) -> Cycles preview of the shipped maps.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import bake, core, materials, ornament as orn, render, stone, texgen as tg  # noqa: E402

ctx = core.begin(__file__, kind="material")
SIZE = (2.0, 2.0)
N = ctx.res(2048, 512)
TEXEL = SIZE[0] / N
rng = ctx.rng

BANDS = [
    orn.Band("ashlar_base", 0.00, 0.32, orn.ashlar, dict(courses=1, min_len=0.6, max_len=1.1)),
    orn.Band("vine_scroll", 0.32, 0.56, orn.vine_scroll, dict(period=0.5)),
    orn.Band("dentil", 0.56, 0.68, orn.dentil, dict(period=0.1)),
    orn.Band("padma", 0.68, 0.88, orn.padma, dict(period=0.125)),
    orn.Band("bead_reel", 0.88, 0.96, orn.bead_reel, dict(period=0.08)),
    orn.Band("medallion_frieze", 0.96, 1.36, orn.medallion_frieze, dict(panels=4)),
    orn.Band("ashlar", 1.36, 2.00, orn.ashlar, dict(courses=2)),
]

with core.timer("compose sheet"):
    sheet = orn.compose_sheet(N, N, SIZE, BANDS, rng)
masks = {"stone": sheet.stone, "tool": sheet.tool, "carve": sheet.carve, "joint": sheet.joint}
with core.timer("weathering"):
    height, wm = stone.weather_height(sheet.height, masks, SIZE, rng, amount=1.0)

ao = bake.bake_heightfield_ao(height, SIZE, N, samples=ctx.samples(96, 16), distance=0.06,
                              mesh_verts=min(N, 1280))
ao = tg.blur(ao, 0.6)
normal = tg.normal_from_height(height, TEXEL)
with core.timer("surface"):
    albedo, rough = stone.surface(height, ao, masks, wm, SIZE, rng, stone.RED_SANDSTONE, normal)
metal = np.zeros_like(rough)

hmin, hmax = float(height.min()), float(height.max())
files = {
    "baseColor": tg.write_png(ctx.path(f"{ctx.id}_baseColor.png"), albedo, 8, srgb_encode=True),
    "normal": tg.write_png(ctx.path(f"{ctx.id}_normal.png"), tg.encode_normal(normal), 16),
    "orm": tg.write_png(ctx.path(f"{ctx.id}_orm.png"), bake.pack_orm(ao, rough, metal), 8),
    "height": tg.write_png(ctx.path(f"{ctx.id}_height.png"), (height - hmin) / (hmax - hmin), 16),
}
ctx.add_file("baseColor", files["baseColor"], colorSpace="srgb")
ctx.add_file("normal", files["normal"], colorSpace="linear")
ctx.add_file("orm", files["orm"], colorSpace="linear")
ctx.add_file("height", files["height"], colorSpace="linear")
ctx.meta.update(
    tileSizeMeters=list(SIZE),
    averageColor=tg.linear_to_hex(albedo.reshape(-1, 3).mean(axis=0)),
    roughness=round(float(rough.mean()), 3),
    metalness=0.0,
    normalScale=1.0,
    heightRangeMeters=[round(hmin, 5), round(hmax, 5)],
    trims=sheet.trims(),
    description="Weathered carved red sandstone trim sheet: ashlar, creeper scroll, dentils, padma, bead-and-reel, lotus medallion frieze.",
)

# ------------------------------------------------------------------ preview of the SHIPPED maps
if ctx.preview:
    import bpy

    core.reset_scene()
    mat_wall = materials.texture_set_material("wall", files["baseColor"], files["normal"], files["orm"], uv_scale=(2.0, 1.0))
    mat_col = materials.texture_set_material("column", files["baseColor"], files["normal"], files["orm"])
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    wall = bpy.context.active_object
    wall.scale = (4.0, 2.0, 1.0)
    wall.rotation_euler = (core.deg(90), 0, 0)
    wall.location = (0, 0.0, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    materials.assign(wall, mat_wall)
    r = SIZE[0] / (2 * np.pi)
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=r, depth=2.0, location=(1.15, -1.0, 1.0))
    col = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    # cylinder UVs: u around (one tile), v up
    me = col.data
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            ang = (np.arctan2(co.y, co.x) / (2 * np.pi)) % 1.0
            uv[li].uv = (ang, (co.z + 1.0) / 2.0)
    # fix the seam wrap on side faces
    for poly in me.polygons:
        us = [uv[li].uv[0] for li in poly.loop_indices]
        if max(us) - min(us) > 0.5:
            for li in poly.loop_indices:
                if uv[li].uv[0] < 0.5:
                    uv[li].uv = (uv[li].uv[0] + 1.0, uv[li].uv[1])
    materials.assign(col, mat_col)
    render.setup_world(sun_elevation=24, sun_azimuth=235, strength=0.3)
    render.add_sun(24, 235, 4.2)
    render.add_ground(color="#5c4b3b")
    render.look_at_camera((-0.6, -4.6, 1.55), (0.25, 0.0, 1.0), lens=32)
    prev = render.render(ctx.path("preview.png"), (1280, 720) if not ctx.draft else (640, 360), ctx.samples(96, 16))
    ctx.add_file("preview", prev)
    render.look_at_camera((0.9, -1.25, 1.25), (0.55, 0.0, 1.1), lens=50)
    prev2 = render.render(ctx.path("preview_closeup.png"), (1280, 720) if not ctx.draft else (640, 360), ctx.samples(96, 16))
    ctx.add_file("preview_closeup", prev2)

ctx.finish()
