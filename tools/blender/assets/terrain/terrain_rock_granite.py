"""
@asset terrain_rock_granite
@kind material
@style terrain:TERRAIN_LAYERS.rock_granite, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Granite outcrop splat layer for TRIPLANAR projection (class T, 8 m x 8 m, seamless; v = world up on the side
projections). A Deccan tor face is a JOINT-BOUNDED body of rock, not a lattice of pillows (B3):
- hierarchical joints: large sheet-jointed blocks (~2.4 m, elongated along the sheets); about half of them split
  into ~1.1 m blocks and a fifth of those into ~0.55 m blocks (decided per parent block), on a domain-warped
  plane, so block sizes vary ~5x across the tile and no cell size dominates the 3 x 3 repeat;
- joint openness varies ALONG every joint: OPEN stretches are dark clefts up to 0.3 m deep with grus fill and
  corestone-rounded shoulders (radius up to 0.4 x block size), CLOSED stretches are tight hairlines, so
  neighbouring blocks merge into larger whalebacks; the large joints open more than the small ones;
- low crowns (whaleback bulges) of different height per block, a gentle per-block tilt;
- exfoliation: at most one or two broad sheet steps per block (3-6 cm, warped, broken off along part of the
  crown) that follow the dome surface, never concentric rings; fresher pinker rock where the sheet has gone;
- angular spall scars (planar chips) and grain-scale pitting, speckled grain (pink feldspar, white quartz,
  black biotite);
- black water streaks running down from the block shoulders and joint lips, orange and grey-green crustose
  lichen with lobed rosettes on the upward-facing shoulders.
Target (TERRAIN_LAYERS.rock_granite): average #87827a, roughness 0.80.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, rock_blocks  # noqa: E402

S = 8.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.rock_granite", family="sandstone",
            rough_spread=0.08)
x, y = kit.x, kit.y
rng = kit.rng

with core.timer("blocks"):
    # B3: a jointed tor face, not a lattice of equal pillows. Hierarchical joints: large sheet-jointed blocks
    # (2.4 m, elongated along the sheets), about half of them split into 1.1 m blocks, a third of those into
    # 0.5 m blocks - so block sizes vary ~5x across the tile and no single cell dominates.
    rb = rock_blocks(kit, [dict(cell=2.4, aniso=(1.5, 0.75)), dict(cell=1.1, split=0.5, aniso=(1.2, 0.85)),
                           dict(cell=0.55, split=0.22)], warp_m=0.35, warp_feature=1.8)
    d, size, lvl, bid = rb["d"], rb["size"], rb["level"], rb["id"]
    # joint openness varies ALONG each joint (open clefts, closed hairlines); big (level-0) joints open more
    openness = np.clip(tg.smoothstep(-0.35, 0.35, kit.fbm(1.3, 3)) * (1.0 - 0.38 * lvl) + 0.25 * (lvl < 0.5), 0.0, 1.0)
    # corestone rounding: flat-ish block faces with rounded shoulders; radius scales with block size and openness
    r_round = size * (0.1 + 0.3 * openness) * (0.7 + 0.6 * bid)
    tq = np.clip(d / np.maximum(r_round, 1e-3), 0.0, 1.0)
    prof = np.sqrt(np.clip(1.0 - (1.0 - tq) ** 2, 0.0, 1.0))  # quarter circle 0 (joint) -> 1 (face)
    # open clefts read dark but not as bottomless wedges (a single salient black wedge repeats at 3 x 3)
    depth = (0.02 + 0.13 * openness * openness) * np.clip(size / 2.4, 0.3, 1.0)
    h = depth * (prof - 1.0)
    # each block at its own depth and with a gentle crown / tilt (whaleback faces of different height)
    h += 0.08 * (bid - 0.5) * np.clip(size / 2.4, 0.3, 1.0)
    crown = tg.smoothstep(0.0, 0.6, d / np.maximum(size, 1e-3))
    h += 0.09 * crown * np.clip(size / 2.4, 0.25, 1.0) * (0.5 + bid)
    # hairline for closed joints, a dark cleft for open ones, grus fill at the bottom of the open clefts
    hair = tg.smoothstep(0.01, 0.0, d) * (1.0 - openness) * (0.5 + 0.5 * tg.smoothstep(-0.2, 0.2, kit.fbm(0.6, 2)))
    open_cleft = tg.smoothstep(0.08, 0.0, d) * tg.smoothstep(0.35, 0.7, openness)
    h -= 0.012 * hair
    # rock-surface undulation at several scales (domes are not smooth spheres)
    h += 0.03 * (kit.fbm(1.6, 3, ridged=True) - 0.5) + 0.012 * kit.fbm(0.35, 3)
    crest = np.clip(prof * crown, 0.0, 1.0)

with core.timer("exfoliation"):
    # a handful of broad, broken exfoliation sheets: thin plates (2-4 cm) whose edge follows the block's own
    # rounded surface (an iso-line of the shoulder profile, warped), present on only part of the big blocks
    big = tg.smoothstep(0.9, 1.6, size)
    cw = crown + 0.18 * kit.fbm(0.9, 3) + 0.05 * kit.fbm(0.2, 2)
    t1 = 0.25 + 0.3 * ((bid * 13.7) % 1.0)
    gate = big * tg.smoothstep(0.1, 0.4, kit.fbm(2.2, 2) * 0.5 + 0.5)
    # the sheet edge is a BROKEN arc: it shows only along part of its length (never a closed outline)
    arc = tg.smoothstep(0.0, 0.3, kit.fbm(0.7, 3, aniso=(1.6, 0.6)))
    sheet = tg.smoothstep(t1, t1 + 0.02, cw) * gate * arc
    lip = tg.smoothstep(0.0, 0.25, sheet) * tg.smoothstep(1.0, 0.75, sheet) * gate
    peel = gate * (1.0 - sheet) * tg.smoothstep(t1 - 0.25, t1 - 0.02, cw)
    h += (0.02 + 0.02 * bid) * sheet
    prof = tg.smoothstep(0.0, 0.25, crest)

with core.timer("spalls and grain"):
    fc = kit.facets(0.22, slope=0.18)
    chip_gate = tg.smoothstep(0.62, 0.7, kit.fbm(0.5, 3) * 0.5 + 0.5) * (fc["id"] > 0.45) * prof
    chip = chip_gate * tg.smoothstep(0.0, 0.006, fc["d"])
    h += chip * (-0.012 + 0.6 * fc["h"] * 0.05)
    # grain: feldspar phenocrysts, quartz, biotite (2-12 mm), weathering pits
    g1, g2, gid = kit.worley(0.006, 1.0)
    pits = tg.smoothstep(0.35, 0.1, g1) * (gid > 0.86)
    h += 0.0012 * kit.fbm(0.02, 3) + 0.0005 * kit.fbm(0.006, 2) - 0.0015 * pits
    # grus (granular fill) in open clefts: rough loose grit at the bottom of the joints
    grus = open_cleft * tg.smoothstep(0.3, 0.6, kit.fbm(0.1, 3) * 0.5 + 0.5 + 0.3 * open_cleft)
    h += grus * (0.004 * kit.fbm(0.01, 3) + 0.012 * kit.fbm(0.04, 2))

with core.timer("albedo"):
    t = np.clip(0.52 + 0.14 * kit.fbm(0.7, 3) + 0.08 * (bid - 0.5) + 0.06 * kit.fbm(0.05, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#6f6a63"), (0.45, "#857f77"), (0.75, "#99928a"), (1.0, "#a9a197")])
    # speckled grain: pink K-feldspar laths, white quartz, black biotite
    rock = K.tint(rock, "#b89a8c", 0.45 * (gid < 0.18))
    rock = K.tint(rock, "#c9c4bb", 0.35 * ((gid > 0.18) & (gid < 0.3)))
    rock = K.tint(rock, "#2c2a28", 0.6 * ((gid > 0.93) & (g1 < 0.4)))
    rock = K.mul(rock, 1.0 - 0.25 * pits)
    rock = K.tint(rock, "#ab9585", 0.35 * peel)  # fresher, pinker rock where the sheet peeled
    rock = K.tint(rock, "#9a9187", 0.25 * chip)
    rock = K.tint(rock, "#4a423a", 0.08 * lip)  # faint grime under the sheet edge (relief carries the step)
    rock = K.tint(rock, "#4a443d", 0.5 * hair)
    rock = K.tint(rock, "#6e5d4b", 0.5 * grus)
    # black water streaks from the block shoulders and joint lips, running down v
    gyy = np.gradient(tg.blur(h, kit.px(0.1)), axis=0) / kit.texel  # row 0 = v 1: > 0 means the surface falls with v
    shoulder = tg.smoothstep(0.05, 0.4, gyy) * tg.smoothstep(0.05, 0.4, crest)
    src = np.clip(shoulder + 0.6 * lip, 0, 1) * tg.smoothstep(0.55, 0.8, kit.fbm(0.15, 3, aniso=(0.3, 6.0)) * 0.5 + 0.5)
    streak = tg.directional_blur_down(src, int(kit.px(1.4)), 0.988)
    streak = np.clip(tg.blur(streak, 1.5) * 1.6, 0, 1) * (0.6 + 0.4 * tg.smoothstep(-0.3, 0.3, kit.fbm(0.8, 2)))
    rock = K.tint(rock, "#2b2a28", 0.6 * streak)
    # lichen on the upward-facing shoulders (dh/dv > 0 seen on a wall = surface facing the sky)
    gy = np.gradient(tg.blur(h, kit.px(0.05)), axis=0) * -1.0 / kit.texel  # +v slope
    up = tg.smoothstep(0.0, 0.25, -gy) * prof * (1.0 - streak)
    lic = kit.lichen(up, coverage=0.07, patch_m=0.3, rosette_m=0.03, rosette_density=0.45)
    sp_ = kit.fbm(0.6, 2) > 0.15  # orange Caloplaca only in some patches, grey-green elsewhere
    sr_ = kit.white(0.07) > 0.6
    orange = np.clip(lic["crust"] * sp_ + lic["rosette"] * sr_, 0, 1)
    green = np.clip(lic["crust"] * ~sp_ + lic["rosette"] * ~sr_, 0, 1)
    rock = K.tint(rock, "#a8784a", 0.45 * orange)
    rock = K.tint(rock, "#8c8e78", 0.55 * green)
    rock = K.tint(rock, "#b0aa98", 0.1 * lic["centre"])
    h += lic["h"]
    alb = K.compress_chroma(rock, 0.9)

with core.timer("roughness"):
    rough = 0.8 + 0.04 * kit.fbm(0.2, 3) - 0.1 * streak + 0.07 * (orange + green) + 0.06 * grus - 0.04 * peel

finish_terrain(kit, h, alb, rough, macro_sigma=2.0, macro_amount=0.55, height_hp=0.25, ao_distance=0.35,
               ao_height_mix=0.35, preview="cliff",
               description="Granite tor for triplanar projection (8 m, v = up): hierarchically jointed blocks 0.5-3 m "
                           "(no lattice) with open clefts and closed hairlines, corestone rounding, broad exfoliation steps, spall chips, "
                           "speckled grain, black water streaks, orange and grey-green crustose lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
