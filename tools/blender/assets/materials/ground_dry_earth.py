"""
@asset ground_dry_earth
@kind material

Dry, dusty earth of the central Indian plains (4 m x 4 m tiling PBR set): ochre-brown soil with
macro mottling, packed and loose patches, scattered pebbles of mixed stone, drying-mud cracks in
low zones and sparse straw / leaf litter. Ground for lookdev, courtyards and as a terrain splat layer
(render/materials/splat.ts). Numpy-only synthesis (no Cycles bake: horizon AO) - builds in ~1 minute.
OWNER: Technical Art Director.
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import bake, core, render, texgen as tg  # noqa: E402

ctx = core.begin(__file__, kind="material")
SIZE = (4.0, 4.0)
N = ctx.res(2048, 512)
TEX = SIZE[0] / N
rng = ctx.rng
x, y = tg.coords(N, N, 1.0, 1.0)


def f(per_m: float) -> int:
    return max(1, int(round(per_m * SIZE[0])))


with core.timer("soil"):
    macro = tg.fbm(x, y, f(0.5), 5, rng)
    mid = tg.fbm(x, y, f(3), 4, rng)
    fine = tg.fbm(x, y, f(40), 3, rng)
    wx, wy = tg.warp(x, y, 0.04, f(1), 3, rng)
    packed = tg.smoothstep(-0.1, 0.25, tg.fbm(wx, wy, f(0.8), 4, rng))  # 1 = packed path-like earth
    h = 0.006 * macro + 0.004 * mid * (1 - 0.6 * packed) + 0.0012 * fine
    clods_f1, _, clod_id = tg.worley(x, y, f(18), rng, jitter=0.9)
    h += 0.0025 * tg.smoothstep(0.55, 0.0, clods_f1) * (clod_id > 0.55) * (1 - packed)

with core.timer("cracks"):
    low = tg.smoothstep(-0.05, 0.3, -tg.fbm(x, y, f(0.6), 4, rng))  # drying puddle zones
    f1c, f2c, cell = tg.worley(*tg.warp(x, y, 0.01, f(6), 2, rng), f(6), rng)
    crack = tg.smoothstep(0.045, 0.0, f2c - f1c) * low
    h -= 0.008 * crack
    plate = low * (1 - crack)
    h += 0.0015 * plate * (cell - 0.5)

with core.timer("pebbles"):
    pebbles = np.zeros_like(h)
    pcol = np.zeros(h.shape + (3,), np.float32)
    stones = [tg.hex_to_linear(c) for c in ("#6f675e", "#5a524a", "#7f6c58", "#6a4134", "#8c7d68", "#4c4642")]
    for cells, size, density, amp in ((f(5), 0.42, 0.05, 0.016), (f(12), 0.4, 0.09, 0.009), (f(28), 0.38, 0.16, 0.004)):
        f1p, _, pid = tg.worley(*tg.warp(x, y, 0.004, f(20), 2, rng), cells, rng, jitter=0.9)
        r = size * (0.55 + 0.45 * ((pid * 7.7) % 1.0))
        m = (f1p < r) & (((pid * 13.1) % 1.0) < density)
        dome = np.sqrt(np.clip(1.0 - (f1p / np.maximum(r, 1e-6)) ** 2, 0.0, 1.0)) * m
        hp = amp * dome ** 0.8 * (0.6 + 0.4 * ((pid * 3.3) % 1.0))
        new = hp > pebbles
        pebbles = np.where(new, hp, pebbles)
        idx = (((pid * 29.3) % 1.0) * len(stones)).astype(np.int64) % len(stones)
        sc = np.stack(stones)[idx] * (0.85 + 0.3 * ((pid * 5.1) % 1.0))[..., None]
        pcol = np.where(new[..., None], sc, pcol)
    # pebbles are half buried: soil climbs their flanks
    h = np.maximum(h, h + pebbles - 0.003)
    pmask = tg.smoothstep(0.002, 0.004, pebbles)

with core.timer("litter"):
    litter = np.zeros_like(h)
    lcol = np.zeros(h.shape + (3,), np.float32)
    straw = tg.hex_to_linear("#b39a63")
    leaf = tg.hex_to_linear("#7a5a33")
    for k in range(3):
        ang = rng.uniform(0, math.pi)
        ca, sa = math.cos(ang), math.sin(ang)
        u = x * ca + y * sa
        v = -x * sa + y * ca
        n = tg.perlin(u * f(60) * 0.15, v * f(60) * 2.2, (f(60), f(60)), rng)  # blade-like streaks
        blades = tg.smoothstep(0.55, 0.75, n) * tg.smoothstep(0.25, 0.6, tg.fbm(x, y, f(4), 3, rng))
        litter = np.maximum(litter, blades * (1 - pmask))
    lf1, _, lid = tg.worley(x, y, f(9), rng)
    leaves = tg.smoothstep(0.32, 0.18, lf1) * (lid > 0.82) * (1 - pmask)
    h += 0.0008 * litter + 0.001 * leaves
    lcol = straw[None, None, :] * (litter[..., None] > 0) + leaf[None, None, :] * (leaves[..., None] > 0)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.35 * macro + 0.18 * mid + 0.08 * fine, 0, 1)
    soil = tg.gradient_map(t, [(0.0, "#4a3523"), (0.35, "#614631"), (0.65, "#76593d"), (1.0, "#8b6c4b")])
    soil = tg.lerp(soil, soil * np.array([1.08, 1.04, 0.98], np.float32), packed[..., None] * 0.6)  # dusty, sun-bleached
    soil = tg.lerp(soil, soil * np.array([0.72, 0.68, 0.66], np.float32), (low * 0.55)[..., None])  # darker damp clay
    ao = tg.horizon_ao(h, TEX, 0.03, 8, 8)
    ao = np.clip(tg.blur(ao, 0.8), 0, 1)
    albedo = soil * (0.75 + 0.25 * ao)[..., None]
    albedo = tg.lerp(albedo, tg.lerp(pcol, soil, 0.35), pmask[..., None])  # dust-coated stones
    albedo = tg.lerp(albedo, lcol, np.clip(litter * 0.8 + leaves, 0, 1)[..., None])
    albedo *= (1 - 0.45 * crack)[..., None]
    albedo = np.clip(albedo, 0.01, 0.8)
    rough = np.clip(0.94 - 0.08 * packed - 0.1 * pmask + 0.04 * fine, 0.6, 1.0)

normal = tg.normal_from_height(h, TEX)
files = {
    "baseColor": tg.write_png(ctx.path(f"{ctx.id}_baseColor.png"), albedo, 8, srgb_encode=True),
    "normal": tg.write_png(ctx.path(f"{ctx.id}_normal.png"), tg.encode_normal(normal), 16),
    "orm": tg.write_png(ctx.path(f"{ctx.id}_orm.png"), bake.pack_orm(ao, rough, np.zeros_like(rough)), 8),
}
for role, p in files.items():
    ctx.add_file(role, p, colorSpace="srgb" if role == "baseColor" else "linear")
ctx.meta.update(
    tileSizeMeters=list(SIZE),
    averageColor=tg.linear_to_hex(albedo.reshape(-1, 3).mean(axis=0)),
    roughness=round(float(rough.mean()), 3),
    metalness=0.0,
    normalScale=1.0,
    trims=[],
    decals=[],
    description="Dry dusty plains earth with pebbles, drying cracks and straw litter (4 m tile).",
)

if ctx.preview:
    import bpy

    core.reset_scene()
    from lib import materials, mesh as M

    mat = materials.texture_set_material("ground", files["baseColor"], files["normal"], files["orm"])
    o = M.from_pydata("ground", [(-12, -12, 0), (12, -12, 0), (12, 12, 0), (-12, 12, 0)], [(0, 1, 2, 3)],
                      [(0, 0), (6, 0), (6, 6), (0, 6)], smooth=False, material=mat)
    render.setup_world(sun_elevation=20, sun_azimuth=240, strength=0.6, aerosol=2.0)
    render.add_sun(20, 240, 4.4, angle_deg=0.6, color="#ffe2bf")
    res = (1280, 720) if not ctx.draft else (640, 360)
    render.look_at_camera((0.0, -6.0, 1.6), (0.0, -1.5, 0.0), lens=35)
    ctx.add_file("preview", render.render(ctx.path("preview.png"), res, ctx.samples(64, 16)))
    del bpy

ctx.finish()
