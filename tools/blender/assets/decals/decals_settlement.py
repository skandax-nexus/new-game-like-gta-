"""
@asset decals_settlement
@kind material
@style palette:MATERIALS, palette:MURAL, palette:ALBEDO_LIMITS
@inputs tools/blender/assets/materials/_matkit.py, tools/blender/assets/terrain/_terrainkit.py

Settlement decal atlas (class A, 4 m x 4 m atlas, 1024 ultra / 512 high / 256 mobile): plaster cracks, damp
stains (rising damp strip + roof leak), soot plume, charring, mandana borders (ochre / white, tile in u), rice-paste
kolam (4), cart-rut end-cap, puddle masks (3) and a footprint / hoof trail (tiles in u). Opacity in ORM.b
(`orm.blue = decalOpacity`), albedo = the decal colour across its whole region, normal / AO / roughness per region.
Regions (UV rects, sizes in meters, surface wall/ground, tileU) are listed in metadata.decals.

Layout (atlas meters, v up; every rect on a 0.5 m grid so the tiers never mix two regions):
    y 3.5-4.0  mandana_border_ochre (2 x 0.5, tileU) | mandana_border_white (2 x 0.5, tileU)
    y 2.5-3.5  kolam_pulli | kolam_lotus | kolam_star | kolam_interlace (1 x 1 each)
    y 1.5-2.5  plaster_crack_corner | plaster_crack_craze | soot_plume | charring (1 x 1 each)
    y 0.5-1.5  damp_rising (2 x 1, tileU) | damp_leak (1 x 1) | puddle_large (1 x 1)
    y 0.0-0.5  rut_endcap (1 x 0.5) | footprint_trail (2 x 0.5, tileU) | puddle_small_a | puddle_small_b (0.5 each)

Period notes: mandana (Rajasthan / Malwa) wall and floor painting in geru-ochre with khadiya / lime white; kolam
(south) and alpana / aripan (east) drawn in rice-paste powder at thresholds every morning - dot-grid (pulli),
lotus and star motifs; no modern motifs or synthetic pigments.
OWNER: Technical Artist A (TA-01).
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _decalkit import Atlas, K, dist_line, dots, iso_line, shape_foot, shape_hoof  # noqa: E402

F = np.float32
S = 4.0
kit = K.Kit(__file__, cls="A", size=(S, S))
atlas = Atlas(kit)
TEX = kit.texel

OCHRE = "#c08a3e"  # MATERIALS.ochreWash
GERU = "#9c3b23"  # MURAL.redOchre
RICE = "#ece5d4"  # MATERIALS.ricePaste
LIME_W = "#e9e2d0"  # MURAL.kaolin
SOOT = "#2a2622"  # MURAL.lampBlack


def solid(rk, hexcol: str) -> np.ndarray:
    return np.zeros(rk.x.shape + (3,), F) + K.hexlin(hexcol)[None, None, :]


def powder(rk, lines: np.ndarray, gap: float = 0.35) -> np.ndarray:
    """Rice-paste powder line: grainy density, dribble beads, gaps where the hand lifted / feet scuffed."""
    grain = 0.6 + 0.4 * tg.smoothstep(-0.4, 0.5, rk.fbm(0.006, 2))
    beads = 1.0 + 0.25 * tg.smoothstep(0.3, 0.7, rk.fbm(0.03, 2))
    gaps = tg.smoothstep(-gap - 0.15, -gap + 0.05, rk.fbm(0.09, 3))
    scuff = 1.0 - 0.7 * tg.smoothstep(0.55, 0.8, rk.fbm(0.3, 3) * 0.5 + 0.5)
    return np.clip(lines * grain * beads * gaps * scuff, 0.0, 1.0).astype(F)


def kolam_finish(rk, lines: np.ndarray, wash: float) -> None:
    """Rice-paste lines over an optional swept, cow-dung-washed earth disc (village thresholds)."""
    p = powder(rk, lines)
    cu, cv = rk.lu - 0.5, rk.lv - 0.5
    r = np.sqrt(cu * cu + cv * cv)
    disc = tg.smoothstep(0.49, 0.4, r + 0.025 * rk.fbm(0.15, 3)) * wash
    op = np.maximum(p * 0.95, disc * 0.45)
    alb = K.tint(solid(rk, "#6e5a44"), RICE, np.clip(p * 1.6, 0.0, 1.0))
    h = 0.0005 * p + 0.0002 * rk.fbm(0.01, 2) * disc
    rough = 0.9 + 0.06 * p - 0.06 * disc * (1 - p)
    atlas.put(rk, op, h, alb, rough, ao_radius=0.006)


# ================================================================ mandana borders (tile in u)
with core.timer("mandana"):
    # ochre band with white line work: border lines, zigzag triangles, dots, 4-petal flowers every 0.25 m
    rk = atlas.region("mandana_border_ochre", "mandana", (0.0, 3.5, 2.0, 0.5), "wall", tile_u=True,
                      notes="Ochre wash band 0.3 m with white lime line work; v 0.1-0.4 m of the region.")
    u, v = rk.lu, rk.lv
    wob = 0.006 * rk.fbm(0.2, 3)
    band = tg.smoothstep(0.095, 0.11, v + wob) * tg.smoothstep(0.405, 0.39, v - wob)
    dry = tg.smoothstep(-0.55, -0.3, rk.fbm(0.04, 3))  # dry-brush breakup
    flake = 1.0 - tg.smoothstep(0.62, 0.72, rk.fbm(0.12, 3) * 0.5 + 0.5)
    band = band * dry * flake
    lw = 0.006
    lines = np.maximum(dist_line(np.abs(v + 0.4 * wob - 0.13), lw), dist_line(np.abs(v + 0.4 * wob - 0.37), lw))
    P = 2.0 / 8.0
    t = (u % P) / P
    tri = 0.16 + 0.07 * (1.0 - np.abs(2.0 * t - 1.0))  # zigzag up to v 0.23
    lines = np.maximum(lines, dist_line(np.abs(v - tri - 0.3 * wob), lw))
    tri2 = 0.34 - 0.07 * (1.0 - np.abs(2.0 * ((u + P / 2) % P) / P - 1.0))
    lines = np.maximum(lines, dist_line(np.abs(v - tri2 - 0.3 * wob), lw))
    cx = (np.floor(u / P) + 0.5) * P
    du, dv = u - cx, v - 0.25
    rr = np.sqrt(du * du + dv * dv)
    ang = np.arctan2(dv, du)
    petal = 0.035 * np.abs(np.cos(2 * ang)) ** 0.7 + 0.008
    lines = np.maximum(lines, dist_line(np.abs(rr - petal), 0.004))
    lines = np.maximum(lines, dots(du, dv, [(0.0, 0.0)], 0.007))
    lines = np.maximum(lines, dots(((u + P / 2) % P) - P / 2, v - 0.25, [(0.0, 0.0)], 0.009))
    lines = lines * tg.smoothstep(-0.6, -0.35, rk.fbm(0.05, 3)) * flake
    op = np.maximum(band * 0.92, lines)
    alb = K.tint(solid(rk, OCHRE), "#a9763a", 0.4 * tg.smoothstep(-0.2, 0.6, rk.fbm(0.08, 3)))
    alb = K.tint(alb, LIME_W, lines)
    rough = 0.86 + 0.06 * lines
    atlas.put(rk, op, 0.0003 * lines, alb, rough, ao_radius=0.004)

    rk = atlas.region("mandana_border_white", "mandana", (2.0, 3.5, 2.0, 0.5), "wall", tile_u=True,
                      notes="White lime line work only (braided chain, dots, border lines) for plain mud walls.")
    u, v = rk.lu, rk.lv
    wob = 0.005 * rk.fbm(0.25, 3)
    P = 2.0 / 10.0
    s1 = 0.25 + 0.06 * np.sin(2 * np.pi * u / P)
    s2 = 0.25 - 0.06 * np.sin(2 * np.pi * u / P)
    lw = 0.0055
    lines = np.maximum(dist_line(np.abs(v - s1 - wob), lw), dist_line(np.abs(v - s2 - wob), lw))
    lines = np.maximum(lines, dist_line(np.abs(v - 0.13 - 0.5 * wob), lw))
    lines = np.maximum(lines, dist_line(np.abs(v - 0.37 - 0.5 * wob), lw))
    eye = ((u + P / 4) % (P / 2)) - P / 4  # dots in the eyes of the braid
    lines = np.maximum(lines, dots(eye, v - 0.25, [(0.0, 0.0)], 0.01))
    tick = ((u % (P / 4)) - P / 8)  # short ticks hanging under the lower border line
    lines = np.maximum(lines, dist_line(np.abs(tick), 0.004) * tg.smoothstep(0.13, 0.125, v) * tg.smoothstep(0.085, 0.095, v))
    lines = lines * tg.smoothstep(-0.6, -0.35, rk.fbm(0.05, 3)) * (1.0 - tg.smoothstep(0.62, 0.72, rk.fbm(0.12, 3) * 0.5 + 0.5))
    alb = K.tint(solid(rk, LIME_W), "#d8d0bc", 0.5 * tg.smoothstep(-0.2, 0.6, rk.fbm(0.05, 2)))
    atlas.put(rk, lines * 0.95, 0.0003 * lines, alb, 0.9 + 0.0 * lines, ao_radius=0.004)

# ================================================================ kolam (1 x 1 m each)
with core.timer("kolam"):
    # 1) pulli (dot-grid) kolam: diamond of 25 dots, rounded loops around each dot, double diamond border with
    #    curled corner loops
    rk = atlas.region("kolam_pulli", "kolam", (0.0, 2.5, 1.0, 1.0), "ground",
                      notes="Dot-grid kolam on a swept earth disc (thresholds, courtyards); 1 m.")
    x, y = rk.lu - 0.5, rk.lv - 0.5
    s = 0.075
    g = np.cos(np.pi * x / s) * np.cos(np.pi * y / s)
    inside = tg.smoothstep(3.55 * s, 3.3 * s, np.abs(x) + np.abs(y))
    lines = iso_line(np.abs(g), 0.22, 0.0045, TEX) * inside
    dset = [(i * s, j * s) for i in range(-3, 4) for j in range(-3, 4) if abs(i) + abs(j) <= 3]
    lines = np.maximum(lines, dots(x, y, dset, 0.008))
    dia = np.abs(x) + np.abs(y)
    lines = np.maximum(lines, dist_line(np.abs(dia - 4.0 * s), 0.0045))
    lines = np.maximum(lines, dist_line(np.abs(dia - 4.45 * s), 0.0045))
    for cx_, cy_ in ((4.9 * s, 0), (-4.9 * s, 0), (0, 4.9 * s), (0, -4.9 * s)):
        rr = np.sqrt((x - cx_) ** 2 + (y - cy_) ** 2)
        lines = np.maximum(lines, dist_line(np.abs(rr - 0.03), 0.0045))
        lines = np.maximum(lines, dots(x, y, [(cx_, cy_)], 0.007))
    kolam_finish(rk, lines, wash=1.0)

    # 2) lotus kolam: 8 + 8 petals, centre rings, dot ring, scalloped outer ring
    rk = atlas.region("kolam_lotus", "kolam", (1.0, 2.5, 1.0, 1.0), "ground",
                      notes="Lotus (padma) kolam, no wash disc (stone / plaster floors); 1 m.")
    x, y = rk.lu - 0.5, rk.lv - 0.5
    r = np.sqrt(x * x + y * y)
    a = np.arctan2(y, x)
    lines = np.maximum(dist_line(np.abs(r - 0.04), 0.0045), dist_line(np.abs(r - 0.075), 0.0045))
    p1 = 0.075 + 0.13 * np.abs(np.cos(4 * a)) ** 0.55
    lines = np.maximum(lines, dist_line(np.abs(r - p1), 0.005) * (r > 0.07))
    p2 = 0.11 + 0.17 * np.abs(np.cos(4 * a + np.pi / 2)) ** 0.55
    lines = np.maximum(lines, dist_line(np.abs(r - p2), 0.005) * (r > p1 + 0.008))
    lines = np.maximum(lines, dist_line(np.abs(r - 0.34), 0.0045))
    scal = 0.39 + 0.018 * np.cos(24 * a)
    lines = np.maximum(lines, dist_line(np.abs(r - scal), 0.0045))
    ring = [(0.315 * math.cos(2 * math.pi * k / 16 + math.pi / 16), 0.315 * math.sin(2 * math.pi * k / 16 + math.pi / 16)) for k in range(16)]
    ring += [(0.43 * math.cos(2 * math.pi * k / 24), 0.43 * math.sin(2 * math.pi * k / 24)) for k in range(24)]
    lines = np.maximum(lines, dots(x, y, ring + [(0.0, 0.0)], 0.008))
    kolam_finish(rk, lines, wash=0.0)

    # 3) star kolam: two interlaced squares (8-point star), spokes, ring of small loops, dots at the tips
    rk = atlas.region("kolam_star", "kolam", (2.0, 2.5, 1.0, 1.0), "ground",
                      notes="Eight-point star kolam on a swept earth disc; 1 m.")
    x, y = rk.lu - 0.5, rk.lv - 0.5
    sq1 = np.maximum(np.abs(x), np.abs(y))
    sq2 = (np.abs(x) + np.abs(y)) / math.sqrt(2.0)
    lines = np.maximum(dist_line(np.abs(sq1 - 0.24), 0.0048), dist_line(np.abs(sq2 - 0.24), 0.0048))
    lines = np.maximum(lines, dist_line(np.abs(sq1 - 0.2), 0.0042) * (sq2 < 0.2))
    lines = np.maximum(lines, dist_line(np.abs(sq2 - 0.2), 0.0042) * (sq1 < 0.2))
    r = np.sqrt(x * x + y * y)
    a = np.arctan2(y, x)
    lines = np.maximum(lines, dist_line(np.abs(r - 0.1), 0.0045))
    spoke = np.abs(((a + np.pi / 8) % (np.pi / 4)) - np.pi / 8) * r
    lines = np.maximum(lines, dist_line(spoke, 0.004) * (r < 0.1))
    loops = [(0.405 * math.cos(2 * math.pi * k / 16), 0.405 * math.sin(2 * math.pi * k / 16)) for k in range(16)]
    for cx_, cy_ in loops:
        rr = np.sqrt((x - cx_) ** 2 + (y - cy_) ** 2)
        lines = np.maximum(lines, dist_line(np.abs(rr - 0.035), 0.0042))
    tips = [(0.24 * 1.25 * math.cos(math.pi / 4 * k), 0.24 * 1.25 * math.sin(math.pi / 4 * k)) for k in range(8)]
    lines = np.maximum(lines, dots(x, y, loops + tips + [(0.0, 0.0)], 0.008))
    kolam_finish(rk, lines, wash=1.0)

    # 4) interlace kolam: overlapping circles on a square lattice inside a double ring
    rk = atlas.region("kolam_interlace", "kolam", (3.0, 2.5, 1.0, 1.0), "ground",
                      notes="Interlaced-circle kolam, no wash disc; 1 m.")
    x, y = rk.lu - 0.5, rk.lv - 0.5
    r = np.sqrt(x * x + y * y)
    s = 0.1
    lines = np.zeros_like(x)
    for i in range(-3, 4):
        for j in range(-3, 4):
            cx_, cy_ = i * s, j * s
            if math.hypot(cx_, cy_) > 0.27:
                continue
            rr = np.sqrt((x - cx_) ** 2 + (y - cy_) ** 2)
            lines = np.maximum(lines, dist_line(np.abs(rr - s * 0.72), 0.0042))
    lines = lines * tg.smoothstep(0.36, 0.35, r)
    lines = np.maximum(lines, dist_line(np.abs(r - 0.37), 0.0045))
    lines = np.maximum(lines, dist_line(np.abs(r - 0.41), 0.0045))
    pet = [(0.39 * math.cos(2 * math.pi * k / 20), 0.39 * math.sin(2 * math.pi * k / 20)) for k in range(20)]
    cen = [(i * s + s / 2, j * s + s / 2) for i in range(-3, 3) for j in range(-3, 3) if math.hypot(i * s + s / 2, j * s + s / 2) < 0.3]
    lines = np.maximum(lines, dots(x, y, pet + cen, 0.0075))
    kolam_finish(rk, lines, wash=0.0)

# ================================================================ cracks, soot, charring (1 x 1 m each)
with core.timer("cracks"):
    rk = atlas.region("plaster_crack_corner", "crack", (0.0, 1.5, 1.0, 1.0), "wall",
                      notes="Diagonal settlement crack from the top-left corner (place at window / door corners).")
    x, y = rk.lu, rk.lv
    # main crack along the diagonal from (0.06, 0.94) to (0.92, 0.08), meandering
    pa = (x - y) / math.sqrt(2.0)  # along
    qa = (x + y - 1.0) / math.sqrt(2.0)  # across
    t_along = np.clip((pa + 0.61) / 1.22, 0.0, 1.0)
    mean = 0.03 * rk.fbm(0.25, 4) + 0.008 * rk.fbm(0.05, 2)
    d_main = np.abs(qa - mean)
    width = 0.0035 * (1.0 - 0.85 * t_along) + 0.0005
    live = tg.smoothstep(0.0, 0.04, t_along) * tg.smoothstep(1.0, 0.85, t_along)
    crack = dist_line(d_main, width) * live
    # branches: cellular edges in a band around the main crack
    c1, c2, _ = rk.worley(0.12, 1.0, x=rk.warp(0.02, 0.1, 2)[0])
    br = tg.smoothstep(0.03, 0.0, c2 - c1) * np.exp(-d_main / 0.06) * live * tg.smoothstep(0.2, 0.6, rk.fbm(0.15, 3) * 0.5 + 0.5)
    spall = tg.smoothstep(0.012, 0.004, d_main) * tg.smoothstep(0.6, 0.8, rk.fbm(0.04, 3) * 0.5 + 0.5) * live
    halo = np.exp(-d_main / 0.02) * live
    op = np.clip(np.maximum.reduce([crack, br * 0.85, spall * 0.8, halo * 0.35]), 0, 1)
    alb = K.tint(solid(rk, "#6d6356"), "#2f2a24", np.clip(crack + br, 0, 1))
    alb = K.tint(alb, "#9a8c78", spall * (1 - crack))
    h = -0.003 * crack - 0.0012 * br - 0.0015 * spall
    atlas.put(rk, op, h, alb, 0.92 + 0.0 * op, ao_radius=0.008)

    rk = atlas.region("plaster_crack_craze", "crack", (1.0, 1.5, 1.0, 1.0), "wall",
                      notes="Craze / map-crack patch with a few curled plaster flakes; any wall.")
    x, y = rk.lu - 0.5, rk.lv - 0.5
    r = np.sqrt(x * x + y * y) + 0.06 * rk.fbm(0.2, 3)
    blob = tg.smoothstep(0.46, 0.25, r)
    wx_, wy_ = rk.warp(0.01, 0.06, 2)
    c1, c2, cid = rk.worley(0.07, 1.0, x=wx_, y=wy_)
    craze = tg.smoothstep(0.035, 0.0, c2 - c1) * blob
    d1, d2, _ = rk.worley(0.3, 1.0, x=rk.warp(0.03, 0.2, 2)[0])
    big = tg.smoothstep(0.02, 0.0, d2 - d1) * tg.smoothstep(0.5, 0.3, r)
    curl = (cid > 0.82) * blob * tg.smoothstep(0.0, 0.3, c2 - c1)
    op = np.clip(np.maximum.reduce([craze * 0.85, big, curl * 0.6, blob * 0.18]), 0, 1)
    alb = K.tint(solid(rk, "#7a705f"), "#2f2a24", np.clip(craze + big, 0, 1))
    alb = K.tint(alb, "#a89a84", curl * (1 - craze))
    h = -0.0015 * craze - 0.0025 * big + 0.0012 * curl
    atlas.put(rk, op, h, alb, 0.92 + 0.0 * op, ao_radius=0.008)

with core.timer("soot"):
    rk = atlas.region("soot_plume", "soot", (2.0, 1.5, 1.0, 1.0), "wall",
                      notes="Soot plume rising from an opening / hearth; the opening top sits at v 0.12 of the region.")
    x, y = rk.lu - 0.5, rk.lv
    hgt = np.clip((y - 0.12) / 0.88, 0.0, 1.0)
    wid = 0.12 + 0.42 * hgt ** 0.7
    streak = 0.75 + 0.25 * rk.fbm(0.06, 3, aniso=(0.25, 3.0))
    x_w = x + 0.05 * rk.fbm(0.25, 3) * hgt
    dens = np.exp(-(x_w / wid) ** 2 * 2.2) * (1.0 - hgt) ** 0.5 * tg.smoothstep(0.1, 0.16, y) * streak
    dens = dens * (0.8 + 0.2 * tg.smoothstep(-0.3, 0.5, rk.fbm(0.1, 3)))
    op = np.clip(dens * 1.3, 0, 0.97)
    tar = tg.smoothstep(0.75, 0.95, dens)  # glossy tar glaze near the source
    alb = K.tint(solid(rk, "#4a3d32"), SOOT, tg.smoothstep(0.2, 0.7, dens))
    rough = 0.95 - 0.35 * tar
    atlas.put(rk, op, 0.0 * op, alb, rough)

    rk = atlas.region("charring", "charring", (3.0, 1.5, 1.0, 1.0), "any",
                      notes="Burn patch: charcoal with alligator cracking, scorched brown rim, ash; damage stage decals.")
    x, y = rk.lu - 0.5, rk.lv - 0.5
    r = np.sqrt(x * x + y * y) + 0.07 * rk.fbm(0.25, 4)
    core_ = tg.smoothstep(0.3, 0.15, r)
    rim = tg.smoothstep(0.46, 0.3, r)
    c1, c2, cid = rk.worley(0.035, 0.9, x=rk.warp(0.005, 0.04, 2)[0])
    alli = tg.smoothstep(0.08, 0.0, c2 - c1) * core_
    plate = 0.0025 * np.clip(c2 - c1, 0, 0.4) / 0.4 * core_
    ash = tg.smoothstep(0.6, 0.8, rk.fbm(0.06, 3) * 0.5 + 0.5) * rim * (1 - core_ * 0.5)
    op = np.clip(rim * (0.85 + 0.15 * rk.fbm(0.05, 2)), 0, 1)
    alb = K.tint(solid(rk, "#5a3a24"), "#1e1c1a", core_)
    alb = K.tint(alb, "#7a5a3e", tg.smoothstep(0.3, 0.42, r) * 0.6)
    alb = K.mul(alb, 1.0 - 0.4 * alli)
    alb = K.tint(alb, "#8a857c", ash * 0.7)
    h = plate - 0.002 * alli
    rough = 0.9 - 0.2 * core_ * (1 - alli) + 0.05 * ash
    atlas.put(rk, op, h, alb, rough, ao_radius=0.01)

# ================================================================ damp (rising damp strip tiles in u) + leak
with core.timer("damp"):
    rk = atlas.region("damp_rising", "damp", (0.0, 0.5, 2.0, 1.0), "wall", tile_u=True,
                      notes="Rising damp along a wall foot: darker green-grey band to a wavy tide line 0.5-0.8 m "
                            "with a white salt fringe; the region bottom is the ground line. Tiles in u.")
    x, y = rk.lu, rk.lv
    tide = 0.62 + 0.1 * rk.fbm(0.5, 3) + 0.03 * rk.fbm(0.08, 2)
    wet = tg.smoothstep(tide + 0.01, tide - 0.12, y)
    fringe = tg.smoothstep(0.035, 0.0, np.abs(y - tide - 0.012)) * tg.smoothstep(0.35, 0.65, rk.fbm(0.06, 3) * 0.5 + 0.5)
    algae = tg.smoothstep(0.3, 0.0, y) * tg.smoothstep(0.45, 0.7, rk.fbm(0.05, 3) * 0.5 + 0.5)
    splash = tg.smoothstep(0.18, 0.0, y) * tg.smoothstep(0.4, 0.7, rk.fbm(0.03, 2) * 0.5 + 0.5)
    op = np.clip(np.maximum.reduce([wet * (0.55 + 0.25 * (1 - y)), fringe * 0.8, algae * 0.85, splash * 0.7]), 0, 0.95)
    alb = K.tint(solid(rk, "#5e5a4c"), "#3e4436", algae)
    alb = K.tint(alb, "#4a3e32", splash * 0.6)
    alb = K.tint(alb, "#d9d4c6", fringe)
    h = 0.0006 * fringe * rk.fbm(0.01, 2) + 0.0004 * algae * rk.fbm(0.008, 2)
    rough = 0.82 - 0.1 * wet + 0.12 * fringe
    atlas.put(rk, op, h, alb, rough, ao_radius=0.004)

    rk = atlas.region("damp_leak", "damp", (2.0, 0.5, 1.0, 1.0), "wall",
                      notes="Roof-leak / gutter stain running down from the top edge (eave line at v 1.0).")
    x, y = rk.lu - 0.5, rk.lv
    drop = 1.0 - y
    wid = 0.05 + 0.2 * drop ** 0.7 + 0.05 * rk.fbm(0.15, 3)
    fingers = 0.5 + 0.5 * rk.fbm(0.05, 3, aniso=(0.3, 4.0))
    length = 0.55 + 0.35 * fingers
    stain = tg.smoothstep(wid, wid * 0.5, np.abs(x + 0.05 * rk.fbm(0.3, 2) * drop)) * tg.smoothstep(length, length - 0.3, drop)
    stain = stain * (0.75 + 0.25 * rk.fbm(0.04, 3, aniso=(0.3, 3.0)))
    edge = tg.smoothstep(0.03, 0.0, np.abs(drop - length + 0.12)) * stain
    algae = tg.smoothstep(0.25, 0.0, drop) * tg.smoothstep(0.4, 0.7, rk.fbm(0.04, 3) * 0.5 + 0.5) * stain
    op = np.clip(stain * 0.7 + edge * 0.25 + algae * 0.3, 0, 0.95)
    alb = K.tint(solid(rk, "#5c584b"), "#3a3f33", algae)
    alb = K.tint(alb, "#4b4236", edge)
    rough = 0.78 + 0.0 * op
    atlas.put(rk, op, 0.0 * op, alb, rough)

# ================================================================ puddles (masks), rut end-cap, footprint trail
def puddle(rk, radius: float, name_seed: float) -> None:
    x, y = rk.lu - rk.size[0] / 2, rk.lv - rk.size[1] / 2
    r = np.sqrt((x / 1.25) ** 2 + y * y) + radius * 0.35 * rk.fbm(radius * 0.7, 4) + radius * 0.1 * rk.fbm(radius * 0.2, 2)
    water = tg.smoothstep(radius, radius * 0.92, r)
    wet = tg.smoothstep(radius * 1.25, radius, r)
    op = np.clip(np.maximum(water, wet * 0.65), 0, 1)
    deep = tg.smoothstep(radius, radius * 0.55, r)  # shallow muddy margin, darker deep water
    alb = K.tint(solid(rk, "#5a4834"), "#4e4334", water)
    alb = K.tint(alb, "#36322a", water * deep)
    h = -0.002 * water + 0.0004 * rk.fbm(0.02, 2) * (1 - water) * wet
    rough = 0.05 + 0.3 * (1 - water) * wet + 0.6 * (1 - wet)
    del name_seed
    atlas.put(rk, op, h, alb, rough, ao_radius=0.01)


with core.timer("puddles"):
    puddle(atlas.region("puddle_large", "puddle", (3.0, 0.5, 1.0, 1.0), "ground",
                        notes="Puddle mask: opacity = water (1) + wet rim (0.65); roughness 0.05 in the water."), 0.36, 1)
    puddle(atlas.region("puddle_small_a", "puddle", (3.0, 0.0, 0.5, 0.5), "ground", notes="Small puddle mask."), 0.17, 2)
    puddle(atlas.region("puddle_small_b", "puddle", (3.5, 0.0, 0.5, 0.5), "ground", notes="Small puddle mask."), 0.15, 3)

with core.timer("ruts"):
    rk = atlas.region("rut_endcap", "rut", (0.0, 0.0, 1.0, 0.5), "ground",
                      notes="One cart-rut end: groove 0.22 m wide along +u (toward the road), fading out at u 0.1-0.5; "
                            "place one per wheel track where terrain_road_earth ruts end (track gauge 1.4 m).")
    x, y = rk.lu, rk.lv - 0.25
    yw = y - 0.02 * rk.fbm(0.3, 2)
    fade = tg.smoothstep(0.08, 0.6, x) * tg.smoothstep(1.0, 0.92, x)
    groove = tg.smoothstep(0.11, 0.06, np.abs(yw)) * fade
    berm = tg.smoothstep(0.17, 0.12, np.abs(yw)) * (1 - groove) * fade
    depth = -0.03 * groove * (0.8 + 0.2 * rk.fbm(0.1, 2)) + 0.006 * berm
    track = tg.smoothstep(0.035, 0.01, np.abs(np.abs(yw) - 0.05)) * groove  # wheel-polished lines in the groove
    op = np.clip(np.maximum(groove, berm * 0.7) * tg.smoothstep(0.2, 0.17, np.abs(yw)), 0, 1)
    alb = K.tint(solid(rk, "#7e6650"), "#5e4c3a", groove * 0.7)
    alb = K.mul(alb, 1.0 - 0.1 * track)
    rough = 0.9 - 0.15 * track
    atlas.put(rk, op, depth + 0.002 * rk.fbm(0.02, 2) * op, alb, rough, ao_radius=0.05)

with core.timer("footprints"):
    rk = atlas.region("footprint_trail", "footprints", (1.0, 0.0, 2.0, 0.5), "ground", tile_u=True,
                      notes="Bare footprints walking +u (v 0.12-0.24) and a cattle hoof trail (v 0.32-0.42); tiles in u.")
    x, y = rk.lu, rk.lv
    foot = shape_foot(0.008)
    hoof = shape_hoof(0.012, 0.07)
    dep = np.zeros_like(x)
    W2 = 2.0
    for k in range(3):  # 3 strides of 0.667 m per 2 m
        for side, off in ((0, -0.05), (1, 0.05)):
            cx_ = k * (W2 / 3) + side * (W2 / 6) + 0.1
            cy_ = 0.18 + off
            ang = 0.08 * (1 if side else -1)
            for wrap in (-W2, 0.0, W2):
                du = x - cx_ - wrap
                dv = y - cy_
                lu_ = du * math.cos(ang) + dv * math.sin(ang)
                lv_ = -du * math.sin(ang) + dv * math.cos(ang)
                e1 = np.full_like(x, ((k * 7 + side * 3) % 10) / 10.0)
                e2 = np.full_like(x, 0.2 if side == 0 else 0.8)
                dep = np.maximum(dep, np.clip(foot(lu_, lv_, e1, e2), 0, None))
    for k in range(8):  # hooves: 4 pairs of fore/hind every 0.5 m, slightly staggered
        cx_ = k * 0.25 + 0.06
        cy_ = 0.37 + (0.04 if k % 2 else -0.04)
        for wrap in (-W2, 0.0, W2):
            du = x - cx_ - wrap
            dv = y - cy_
            e1 = np.full_like(x, (k * 0.37) % 1.0)
            dep = np.maximum(dep, np.clip(hoof(du, dv, e1, e1), 0, None))
    dep = dep * (0.85 + 0.15 * rk.fbm(0.02, 2))
    halo = tg.smoothstep(0.0, 0.004, rk.blur(dep, 0.02))
    op = np.clip(np.maximum(tg.smoothstep(0.0, 0.002, dep), halo * 0.4), 0, 1)
    alb = K.tint(solid(rk, "#7a6450"), "#5a4836", tg.smoothstep(0.0, 0.004, dep))
    rough = 0.88 - 0.1 * tg.smoothstep(0.0, 0.004, dep)
    atlas.put(rk, op, -dep, alb, rough, ao_radius=0.015)

kit.finish(**atlas.finish_args(),
           description="Settlement decal atlas (4 m): plaster cracks, damp stains, soot, charring, mandana borders, "
                       "rice-paste kolam x4, cart-rut end-cap, puddle masks, footprint / hoof trail. Opacity in ORM.b.",
           extra_meta=dict(decalAtlas=dict(sizeMeters=[S, S], opacity="orm.b", regions=len(atlas.regions))),
           preview="atlas", preview_opts=dict(samples=48, tiling=False))
