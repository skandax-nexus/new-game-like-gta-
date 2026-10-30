"""
@asset terrain_rock_granite
@kind material
@style terrain:TERRAIN_LAYERS.rock_granite, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Granite outcrop splat layer for TRIPLANAR projection (class T, 8 m x 8 m, seamless; v = world up on the side
projections). A Deccan tor face is a JOINT-BOUNDED body of rock, not a lattice of pillows:
- 3-4 wavy sheet joints (sub-horizontal, 0.9-3.4 m apart) and, per sheet, 1-3 vertical joints (0.8-4 m apart,
  tilted and wandering; some continue across sheets, most stop), so blocks range from 0.8 m to over 3 m;
- every joint segment is either OPEN (a dark cleft 0.15-0.45 m deep with grus fill, block edges rounded into
  corestones with radii up to 1 m) or CLOSED (a tight hairline 1-3 cm deep, edges barely broken), varying along
  the joint, so neighbouring blocks merge into larger whalebacks;
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
from _terrainkit import K, finish_terrain  # noqa: E402

S = 8.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.rock_granite", family="sandstone",
            rough_spread=0.08)
x, y = kit.x, kit.y
rng = kit.rng

with core.timer("domes"):
    # whaleback domes of very different size (0.6-3.6 m radius, more small than large), flattened and mostly
    # elongated along the sheet direction; placed by dart throwing with overlap, so their union is a lumpy tor:
    # where two domes meet high up the crease is a CLOSED joint, where both have fallen away it is an OPEN cleft.
    domes: list[tuple[float, ...]] = []
    radii = sorted((0.8 + 1.9 * float(rng.uniform()) ** 1.5 for _ in range(90)), reverse=True)
    for r in radii:  # large domes first; smaller ones fill the gaps and merge into their flanks
        for _try in range(40):
            cx_, cy_ = float(rng.uniform(0, S)), float(rng.uniform(0, S))
            ok = True
            for (ox, oy, orr, *_rest) in domes:
                dx = ((cx_ - ox + S / 2) % S) - S / 2
                dy = ((cy_ - oy + S / 2) % S) - S / 2
                dd = float(np.hypot(dx, dy))
                if dd < 0.38 * (r + orr) or dd < 0.55 * max(r, orr):
                    ok = False
                    break
            if ok:
                domes.append((cx_, cy_, r, float(rng.uniform(1.0, 1.6)), float(rng.uniform(-0.4, 0.4)),
                              float(rng.uniform(0.16, 0.28)), float(rng.uniform()), float(rng.uniform()), float(rng.uniform())))
                break
    core.log(f"granite domes: {len(domes)}, radii {sorted(round(d[2], 2) for d in domes)}")
    N = kit.N
    px = S / N
    h = np.full((N, N), -0.45, np.float32)  # joint floor where no dome reaches
    q_best = np.full((N, N), 9.0, np.float32)
    did = np.zeros((N, N), np.float32)
    dr1 = np.zeros((N, N), np.float32)
    dr2 = np.zeros((N, N), np.float32)
    dsize = np.zeros((N, N), np.float32)
    for (cx_, cy_, r, ax, rot, k, r1, r2, r3) in domes:
        a_ = min(r * ax, 0.45 * S)  # the dome's box must stay inside one tile (no wrapped duplicate indices)
        b_ = r / ax
        ext = int(np.ceil(1.05 * max(a_, b_) / px))
        ci = int(round(cx_ / px))
        cj = int(round((S - cy_) / px))  # row 0 = v 1
        cols = (np.arange(ci - ext, ci + ext + 1)) % N
        rows = (np.arange(cj - ext, cj + ext + 1)) % N
        du_ = (np.arange(-ext, ext + 1) * px)[None, :]
        dv_ = -(np.arange(-ext, ext + 1) * px)[:, None]
        cr, sr = np.cos(rot), np.sin(rot)
        lu_ = du_ * cr + dv_ * sr
        lv_ = -du_ * sr + dv_ * cr
        q = np.sqrt((lu_ / a_) ** 2 + (lv_ / b_) ** 2)
        z = np.where(q < 1.0, k * r * np.clip(1.0 - q * q, 0.0, 1.0) ** 0.8, -9.0).astype(np.float32)
        sub = np.ix_(rows, cols)
        cur = h[sub]
        better = z > cur
        # smooth union (k = 0.18 m): where domes meet high up they merge into one whaleback (closed joint); only
        # where both flanks have fallen away does a cleft remain
        kk = 0.12
        hh_ = np.clip(kk - np.abs(cur - z), 0.0, None) / kk
        h[sub] = np.maximum(cur, z) + 0.25 * kk * hh_ * hh_
        q_best[sub] = np.where(better, q, q_best[sub])
        did[sub] = np.where(better, r3, did[sub])
        dr1[sub] = np.where(better, r1, dr1[sub])
        dr2[sub] = np.where(better, r2, dr2[sub])
        dsize[sub] = np.where(better, r, dsize[sub])
    crest = np.clip(1.0 - q_best, 0.0, 1.0)  # 1 on a dome's crown .. 0 at its edge
    # the deeper a crease between domes, the more open the joint: soften the valley floors into rounded clefts
    floor_ = tg.blur(h, kit.px(0.05))
    h = np.maximum(h, floor_ - 0.01)
    # major OPEN joints: two sub-horizontal sheet joints and two steep cross joints - wavy clefts 4-12 cm wide with
    # rounded shoulders (r 0.25 m), open over part of their length and closing to hairlines elsewhere
    yc = np.zeros_like(x)
    hair = np.zeros_like(x)
    cleft = np.zeros_like(x)
    step_side = np.zeros_like(x)
    # 3 open joints (one sub-horizontal sheet joint and a conjugate pair of +-45 deg joints - integer slopes keep
    # them seamless), strongly wavy, never a grid; 3 hairline joints with a small step
    for k, slope in enumerate((0.0, 1.0, -1.0, 0.0, 1.0, -1.0)):
        pos = float(rng.uniform(0, S))
        wav = 0.55 * kit.fbm(4.0, 2, x=x, y=yc + 0.37 * k) + 0.08 * kit.fbm(0.8, 2, x=x, y=yc + 0.11 * k)
        if slope != 0.0:  # wander measured across the joint, as a function of the position along it
            wav = 0.55 * kit.fbm(4.0, 2, x=(x + slope * y) % 1.0, y=yc + 0.37 * k)
        dist = np.abs(((((y - slope * x) * S - pos - wav) + S / 2) % S) - S / 2) * (0.7071 if slope else 1.0)
        if k < 3:
            opening = tg.smoothstep(-0.25, 0.35, kit.fbm(2.2, 2)) * tg.smoothstep(-0.3, 0.1, kit.fbm(3.0, 2))
            w = 0.02 + 0.05 * opening
            shoulder = 0.3 * opening + 0.02
            t = np.clip((dist - w) / shoulder, 0.0, 1.0)
            prof = np.where(dist < w, 1.0, 1.0 - np.sqrt(np.clip(1.0 - (1.0 - t) ** 2, 0.0, 1.0)))
            cleft = np.maximum(cleft, prof * (0.05 + 0.3 * opening))
            hair = np.maximum(hair, tg.smoothstep(0.012, 0.0, dist) * (1.0 - opening))
        else:  # hairline joints with a small step across the crowns
            on = tg.smoothstep(-0.1, 0.25, kit.fbm(2.0, 2))
            hair = np.maximum(hair, tg.smoothstep(0.01, 0.0, dist) * on)
            step_side += 0.01 * (((((y - slope * x) * S - pos - wav) + S / 2) % S) > S / 2) * on
    h -= cleft
    h += -0.015 * hair + step_side * (crest > 0.05)
    open_cleft = np.clip(tg.smoothstep(0.06, 0.2, cleft) + tg.smoothstep(-0.05, -0.3, h), 0.0, 1.0)  # deep clefts
    # broad surface undulation of the rock itself
    h += 0.03 * kit.fbm(1.2, 3) + 0.01 * kit.fbm(0.3, 3)

with core.timer("exfoliation"):
    # one broad, broken sheet step on the larger domes (3-6 cm), following the dome surface
    cw = crest + 0.14 * kit.fbm(0.7, 3) + 0.04 * kit.fbm(0.15, 2)
    t1 = 0.3 + 0.35 * dr1
    gate = tg.smoothstep(0.0, 0.35, kit.fbm(1.6, 3) * 0.5 + 0.6 * dr2 - 0.1) * tg.smoothstep(1.0, 1.6, dsize)
    sheet = tg.smoothstep(t1, t1 + 0.015, cw) * gate
    lip = tg.smoothstep(0.0, 0.3, sheet) * tg.smoothstep(1.0, 0.7, sheet) * gate
    peel = gate * (1.0 - sheet) * tg.smoothstep(t1 - 0.3, t1 - 0.03, cw)
    h += (0.03 + 0.03 * dr1) * sheet
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
    h += grus * (0.004 * kit.fbm(0.01, 3) + 0.03 * kit.fbm(0.04, 2))

with core.timer("albedo"):
    t = np.clip(0.52 + 0.14 * kit.fbm(0.7, 3) + 0.1 * (did - 0.5) + 0.06 * kit.fbm(0.05, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#6f6a63"), (0.45, "#857f77"), (0.75, "#99928a"), (1.0, "#a9a197")])
    # speckled grain: pink K-feldspar laths, white quartz, black biotite
    rock = K.tint(rock, "#b89a8c", 0.45 * (gid < 0.18))
    rock = K.tint(rock, "#c9c4bb", 0.35 * ((gid > 0.18) & (gid < 0.3)))
    rock = K.tint(rock, "#2c2a28", 0.6 * ((gid > 0.93) & (g1 < 0.4)))
    rock = K.mul(rock, 1.0 - 0.25 * pits)
    rock = K.tint(rock, "#ab9585", 0.35 * peel)  # fresher, pinker rock where the sheet peeled
    rock = K.tint(rock, "#9a9187", 0.25 * chip)
    rock = K.tint(rock, "#4a423a", 0.35 * lip)  # undercut shadow line of the sheet edge
    rock = K.tint(rock, "#4a443d", 0.5 * hair)
    rock = K.tint(rock, "#6e5d4b", 0.75 * grus)
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
    lic = kit.lichen(up, coverage=0.1, patch_m=0.45, rosette_m=0.035, rosette_density=0.45)
    orange = np.clip(lic["crust"] * (kit.fbm(1.0, 2) > -0.1) + lic["rosette"] * (kit.white(0.07) > 0.55), 0, 1)
    green = np.clip(lic["crust"] * (kit.fbm(1.0, 2) <= -0.1) + lic["rosette"] * (kit.white(0.07) <= 0.55), 0, 1)
    rock = K.tint(rock, "#b07a45", 0.6 * orange)
    rock = K.tint(rock, "#8c8e78", 0.55 * green)
    rock = K.tint(rock, "#c2bba8", 0.3 * lic["centre"])
    h += lic["h"]
    alb = K.compress_chroma(rock, 0.9)

with core.timer("roughness"):
    rough = 0.8 + 0.04 * kit.fbm(0.2, 3) - 0.1 * streak + 0.07 * (orange + green) + 0.06 * grus - 0.04 * peel

finish_terrain(kit, h, alb, rough, macro_sigma=2.0, macro_amount=0.55, height_hp=0.25, ao_distance=0.35,
               ao_height_mix=0.35, preview="cliff",
               description="Granite tor for triplanar projection (8 m, v = up): joint-bounded blocks 0.8-3 m with open "
                           "clefts and closed hairlines, corestone rounding, broad exfoliation steps, spall chips, "
                           "speckled grain, black water streaks, orange and grey-green crustose lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
