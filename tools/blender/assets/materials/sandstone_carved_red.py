"""
@asset sandstone_carved_red
@kind material

Carved red sandstone TRIM SHEET (tiling PBR set), 2 m x 2 m per tile, seamless in U and V.
Bands (bottom -> top; UV v ranges are written to metadata.trims and the generated manifest):
    ashlar_base 0.32 m | vine_scroll 0.24 | dentil 0.12 | padma 0.20 | bead_reel 0.08 |
    medallion_frieze 0.40 | ashlar 0.64 (two 0.32 m courses)
Map a face's V range onto a band to "trim" it (plinths, cornices, railing bars, copings); map whole
faces to the sheet for a richly carved wall; map courses of a dome / floor to the ashlar band.
Look: Fatehpur Sikri / Mathura red sandstone - brick-red to purple-brown, buff beds, reduction spots,
weathered (eroded relief, spalls, honeycomb, chipped arrises, hairline cracks, grime, dust, streaks).
OWNER: Technical Art Director.

Pipeline: numpy ornament height fields (lib/ornament) -> weathering (lib/stone) -> Cycles ray-traced AO
of the displaced heightfield (lib/bake) -> albedo/roughness synthesis -> normal from height ->
PNG set (baseColor sRGB 8-bit, normal 16-bit, ORM 8-bit, height 16-bit) -> Cycles lookdev previews of
the shipped maps (wall corner + column + paved floor, raking light; close-up with depth of field).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import bake, core, ornament as orn, render, stone, texgen as tg  # noqa: E402

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

ao = bake.bake_heightfield_ao(height, SIZE, N, samples=ctx.samples(64, 16), distance=0.06,
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
ctx.add_file("height", files["height"], colorSpace="linear", ship=False)
ctx.meta.update(
    tileSizeMeters=list(SIZE),
    averageColor=tg.linear_to_hex(albedo.reshape(-1, 3).mean(axis=0)),
    roughness=round(float(rough.mean()), 3),
    metalness=0.0,
    normalScale=1.0,
    heightRangeMeters=[round(hmin, 5), round(hmax, 5)],
    trims=sheet.trims(),
    decals=sheet.decals(),
    description="Weathered carved red sandstone trim sheet: ashlar, creeper scroll, dentils, padma, "
                "bead-and-reel, lotus medallion frieze.",
)

# ------------------------------------------------------------------ previews of the SHIPPED maps
if ctx.preview:
    core.reset_scene()
    render.lookdev_trim_scene(files["baseColor"], files["normal"], files["orm"], SIZE, floor_band=(0.68, 1.0))
    render.setup_world(sun_elevation=22, sun_azimuth=245, strength=0.55, aerosol=2.0)
    render.add_sun(22, 245, 4.6, angle_deg=0.6, color="#ffe2bf")
    res = (1280, 720) if not ctx.draft else (640, 360)
    render.look_at_camera((-5.3, -6.4, 1.75), (-1.2, 0.4, 0.95), lens=30)
    ctx.add_file("preview", render.render(ctx.path("preview.png"), res, ctx.samples(128, 16)))
    # close-up: medallion frieze + padma at grazing light with shallow depth of field
    render.look_at_camera((-0.3, -1.05, 1.3), (-0.95, 0.0, 1.12), lens=55, fstop=4.0)
    ctx.add_file("preview_closeup", render.render(ctx.path("preview_closeup.png"), res, ctx.samples(128, 16)))

ctx.finish()
