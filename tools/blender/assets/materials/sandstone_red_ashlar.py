"""
@asset sandstone_red_ashlar
@kind material
@style materials:MATERIAL_PRESETS.sandstone_red_ashlar, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@tiers ultra,high
@fallback sandstone_carved_red

Plain spotted red sandstone ashlar (class C, 3 m x 3 m, seamless; P2 - ultra / high, mobile falls back to
sandstone_carved_red): seven courses of 0.43 m dressed blocks (0.7-1.1 m long, mean ~0.9 m), 4 mm lime joints,
recessed dark joints (4 mm wide, 8 mm deep, AD-7: no white grout), point-tooled faces (rows of chisel pocks, 3-6 mm,
worn), slightly rounded arrises with chips, Sikri-type iron-oxide staining as SOFT RUST BLEEDS and liesegang bands
following the bedding (no spots or droplets), faint cross-bedding, per-block hue / value jitter, grime on lower edges.
Target (MATERIAL_PRESETS.sandstone_red_ashlar): average #a46450, roughness 0.80 (0.66-0.92).

Period notes: city-state walls and gates in Vindhyan red sandstone (Fatehpur Sikri / Mathura type quarries).
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 3.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.sandstone_red_ashlar", family="sandstone",
            saturation_limit="medium")

with core.timer("blocks"):
    b = kit.bond(H / 7.0, (0.7, 1.1), 0.004, stagger=None)
    d, bid = b["d"], b["id"]
    # P2 round 2: 4 mm joints recessed 6 mm with weathered lime mortar; ARRIS WEAR - the block edges are rounded
    # back 10-30 mm, varying along each edge (bruised, chipped), so the joint reads as a soft shadowed groove at
    # 1-3 m instead of a pencil line
    inside = tg.smoothstep(0.0015, 0.0035, d)
    wear_r = 0.015 + 0.025 * tg.smoothstep(-0.4, 0.5, kit.fbm(0.12, 3))
    arris = K.Kit.edge_round(np.maximum(d - 0.002, 0.0), wear_r, 0.004 + 0.005 * tg.smoothstep(-0.3, 0.4, kit.fbm(0.2, 2)))
    # angular spalls off the arrises (planar chips 2-6 cm, on ~8 % of the edge length), not blobs
    fch = kit.facets(0.035, slope=0.25)
    chips = (tg.smoothstep(0.58, 0.75, kit.fbm(0.15, 3) * 0.5 + 0.5) * (fch["id"] > 0.6) * tg.smoothstep(0.04, 0.025, d)).astype(np.float32)
    tilt = 0.0015 * (((bid * 7.7) % 1.0) - 0.5) * (b["lu"] - 0.5) + 0.0012 * (((bid * 3.1) % 1.0) - 0.5)
    pillow = 0.0012 * np.sin(np.pi * np.clip(b["lu"], 0, 1)) ** 0.5 * np.sin(np.pi * np.clip(b["lv"], 0, 1)) ** 0.5
    dress = 0.0003 * kit.fbm(0.006, 2) + 0.0005 * kit.fbm(0.05, 3) + 0.0006 * kit.fbm(0.3, 3) + pillow
    # drafted margin: a 25-35 mm chisel-dressed band round each face (fine parallel batter lines), the field inside
    # point-tooled with pocks 4-8 mm in loose diagonal rows (large enough to survive the 512 px data maps)
    margin = tg.smoothstep(0.03, 0.022, d)
    batter = 0.00025 * np.sin(2 * np.pi * (b["du"] + b["dv"]) / 0.004) * margin

    def pock(lu, lv, e1, e2):
        r = 0.002 + 0.002 * e1
        dd = np.sqrt((lu / 1.4) ** 2 + lv * lv) / r
        return np.where(dd < 1.0, 0.0022 * (0.5 + 0.5 * e2) * np.sqrt(np.clip(1.0 - dd * dd, 0, 1)), -1e9)

    # random punch pits (a point is struck by hand: no lattice), denser and sharper where the face is fresher
    pk = kit.scatter(0.012, pock, density=0.75, jitter=1.0, angle=(0.6, 1.0),
                     density_map=np.clip(0.55 + 0.6 * kit.fbm(0.25, 3), 0.15, 1.0).astype(np.float32))
    tool = tg.blur(pk.height(0.0), 0.6) * (1.0 - margin) * tg.smoothstep(0.02, 0.035, d)
    tool = tool * (0.5 + 0.5 * tg.smoothstep(-0.3, 0.3, kit.fbm(0.4, 2)))  # worn off in places
    h = (dress + arris + tilt + chips * (-0.007 + 0.25 * np.minimum(fch["h"], 0.0)) - tool + batter) * inside - 0.006 * (1.0 - inside)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.12 * kit.fbm(0.25, 3) + 0.06 * kit.fbm(0.03, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#8a4c3a"), (0.4, "#9c5a45"), (0.75, "#ac6a52"), (1.0, "#b9785e")])
    j1 = (bid * 7.137 + 0.21) % 1.0 - 0.5
    j2 = (bid * 3.711 + 0.57) % 1.0 - 0.5
    rock = K.mul(K.hue_rotate(rock, j1 * 0.04), 1.0 + j2 * 0.3)  # each block from its own bed
    # cross-bedding: faint inclined laminae, per block a different dip (block-local, so seamless)
    vl = b["lv"] * (H / 7.0)
    ul = b["lu"] * b["ulen"]
    dip = (((bid * 5.3) % 1.0) - 0.5) * 0.5
    lam = np.sin(2 * np.pi * (vl + dip * ul) / 0.012 + 3.0 * kit.fbm(0.2, 2))
    rock = K.mul(rock, 1.0 + 0.035 * lam)
    # Sikri-type iron staining (AD-7): soft rust bleeds - irregular, blurred, stretched along the bedding and
    # bleeding down a little - plus faint liesegang bands; no discrete spots
    wx, wy = kit.warp(0.12, 0.4, 3)
    bleed = tg.smoothstep(0.58, 0.85, kit.fbm(0.35, 4, x=wx, y=wy, aniso=(2.5, 1.0)) * 0.5 + 0.5)
    bleed = np.clip(tg.blur(bleed, kit.px(0.015)) + 0.5 * tg.directional_blur_down(bleed, int(kit.px(0.12)), 0.96), 0, 1)
    rock = K.tint(rock, "#6e3424", 0.55 * bleed)
    rock = K.tint(rock, "#b77a5c", 0.18 * tg.smoothstep(0.35, 0.15, kit.fbm(0.35, 4, x=wx, y=wy, aniso=(2.5, 1.0)) * 0.5 + 0.5))
    lies = 0.5 + 0.5 * np.sin(2 * np.pi * (kit.fbm(0.8, 3, aniso=(3.0, 1.0)) * 5.0))
    rock = K.mul(rock, 1.0 - 0.06 * lies * tg.smoothstep(0.0, 0.5, kit.fbm(1.0, 2)))
    rock = K.mul(rock, 1.0 - 0.18 * tg.smoothstep(0.0, 0.0015, tool))  # pocks hold shade and dust
    rock = K.mul(rock, 1.0 + 0.04 * margin)  # the smoother drafted margin reads a touch lighter
    weathered = tg.smoothstep(0.45, 0.8, kit.fbm(0.5, 3, aniso=(1.0, 3.0)) * 0.5 + 0.5)  # rain-washed runs
    rock = K.tint(rock, "#9a7a68", 0.18 * weathered)
    rock = K.tint(rock, "#b07e66", 0.15 * chips)  # fresher stone in the spall scar
    grime = tg.smoothstep(0.12, 0.0, b["lv"]) * tg.smoothstep(0.3, 0.7, kit.fbm(0.2, 3) * 0.5 + 0.5)
    rock = K.tint(rock, "#4a3a32", 0.25 * grime)
    patina = tg.smoothstep(0.55, 0.85, kit.fbm(0.6, 3) * 0.5 + 0.5)
    rock = K.tint(rock, "#6e6458", 0.18 * patina)
    # weathered lime mortar, dirtied: mid value (the recess and the worn arrises carry the shadow, not a black line)
    joint = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.03, 2), 0, 1), [(0.0, "#7a6658"), (1.0, "#958271")])
    rock = K.tint(rock, "#5a3a2e", 0.25 * tg.smoothstep(0.012, 0.0, d) * inside)  # grime in the worn arris
    alb = rock * inside[..., None] + joint * (1.0 - inside[..., None])
    alb = K.compress_chroma(alb, 0.8)

with core.timer("roughness"):
    rough = 0.8 + 0.04 * kit.fbm(0.1, 3) - 0.06 * chips + 0.04 * grime + 0.03 * bleed
    rough = rough * inside + 0.9 * (1.0 - inside)

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.02, ao_samples=32,
           description="Red sandstone ashlar (3 m): 0.43 m courses, 4 mm recessed lime joints, worn arrises, drafted "
                       "margins, point-tooled fields, "
                       "soft rust bleeds and liesegang bands, cross-bedding, chipped arrises, grime.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
