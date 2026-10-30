"""
@asset terrain_rock_basalt
@kind material
@style terrain:TERRAIN_LAYERS.rock_basalt, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Deccan Trap basalt splat layer for TRIPLANAR projection (class T, 10 m x 10 m, seamless; v = world up on the side
projections). It must read as a trap escarpment at 10-50 m: stepped flows of clearly UNEQUAL thickness (one thick,
one medium, one thin per tile, boundaries undulating +-0.25 m), each flow
- a COLONNADE of flat-faced, angular columns (prisms seen side-on: a broad planar face between two narrow oblique
  faces meeting in sharp creases; widths 0.4-1.6 m; joints tilt, wander, and many stop or start at hairline
  cross-joints so columns branch and merge; single columns recessed where they fell out);
- a HACKLY ENTABLATURE above it (chaotic small planar fracture chips, darker, glassier), thickness varying per flow;
- a RECESSED RUBBLY FLOW TOP (vesicular, red-brown weathered, 0.3 m back) holding a soil and talus ledge, with a
  thin red bole at the flow contact;
plus black water streaks and pale salt bloom running down from the ledges, sparse grey-white and orange lichen on
the ledge lips, and fine vesicles / grain on every face.
Target (TERRAIN_LAYERS.rock_basalt): average #5a5650, roughness 0.78.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, joint_bands  # noqa: E402

S = 10.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.rock_basalt", family="soilWet",
            rough_spread=0.09)
x, y = kit.x, kit.y
rng = kit.rng
v = y * S

with core.timer("flows"):
    # three flows of clearly unequal thickness (~48 / 32 / 20 % of the tile, order shuffled), undulating contacts
    # two flows per 10 m tile, clearly unequal (~64 / 36 %): real trap flows are 5-30 m thick, three per tile
    # read as stripes
    fr = np.array([0.64, 0.36]) * rng.uniform(0.95, 1.05, 2)
    fr = fr / fr.sum() * S
    NF = 2
    off = float(rng.uniform(0, S))
    starts = (np.cumsum(np.concatenate([[0.0], fr[:-1]])) + off) % S
    yc = np.zeros_like(y)
    curves = [starts[k] + 0.35 * kit.fbm(3.3, 3, x=x, y=yc + 0.21 * k) + 0.08 * kit.fbm(0.7, 2, x=x, y=yc + 0.5 + 0.21 * k)
              for k in range(NF)]
    dks = np.stack([(v - c) % S for c in curves])
    flow = np.argmin(dks, axis=0)
    fb = np.min(dks, axis=0)  # m above the flow base
    ft = np.min(np.stack([(c - v) % S for c in curves]), axis=0)  # m below the flow top
    fthick = fb + ft
    fl = fb / np.maximum(fthick, 1e-3)  # 0 base .. 1 top
    # per-flow zone fractions: colonnade top / entablature top (the rest is the rubbly flow top)
    col_top = np.array([0.62, 0.52])[flow] + 0.06 * kit.fbm(1.5, 2)
    ent_top = np.array([0.9, 0.84])[flow] + 0.025 * kit.fbm(1.0, 2)
    top_zone = tg.smoothstep(ent_top - 0.015, ent_top + 0.015, fl)  # rubbly vesicular flow top
    ent_zone = tg.smoothstep(col_top - 0.03, col_top + 0.03, fl) * (1.0 - top_zone)
    col_zone = 1.0 - tg.smoothstep(col_top - 0.03, col_top + 0.03, fl)

with core.timer("colonnade"):
    # columns: vertical joints with branching / stopping across hairline cross-joints every 0.6-2.2 m
    jb = joint_bands(kit, spacing=(1.2, 3.5), amp=0.15, feature=1.0, vspacing=(0.45, 1.6), carry=0.6, tilt=0.12,
                     wander=0.1, vfeature=1.2)
    left, width = jb["left"], jb["width"]
    right = width - left
    a = 0.5 + 1.3 * jb["rand1"]  # oblique face slopes (m/m) left and right: crisp prism facets
    b = 0.5 + 1.3 * jb["rand2"]
    plateau = (0.02 + 0.1 * jb["rand3"] ** 2) * np.clip(width, 0.4, 1.6)  # most columns show a crease
    prism = np.minimum(np.minimum(a * left, b * right), plateau)
    # joints that STOP: a column joint fades out along v in places (two columns merge, the crease disappears)
    jpres = tg.smoothstep(-0.25, 0.25, kit.fbm(1.6, 3, aniso=(0.35, 1.0)))
    prism = plateau - (plateau - prism) * jpres
    # broad face: planar with a small random tilt per column segment (no convex bulge)
    face_tilt = 0.04 * (jb["block"] - 0.5)
    prism = prism + face_tilt * (left - 0.5 * width) * (prism >= plateau - 1e-4)
    # cross-joints: hairline step at each segment boundary (segments sit at slightly different depths)
    fell = (jb["block"] > 0.93).astype(np.float32)  # a few column segments fell out (planar back face)
    seg_off = 0.01 * (jb["rand3"] - 0.5) - 0.06 * fell
    cross = tg.smoothstep(0.006, 0.0, np.minimum(jb["below"], jb["above"])) * (kit.fbm(0.5, 2) > 0.3)
    col_h = prism + seg_off - 0.008 * cross
    col_h += 0.012 * kit.fbm(0.4, 3) + 0.006 * kit.fbm(0.12, 3) + 0.0015 * kit.fbm(0.03, 2)
    joint_line = tg.smoothstep(0.025, 0.0, jb["side"]) * jpres

with core.timer("entablature"):
    # hackly: chaotic small planar chips, steep, elongated a little in v, two scales
    e1 = kit.facets(0.2, slope=0.35, aniso=(0.45, 4.5))  # curved, fanning columnettes  # chaotic, thin, steep fractured columnettes
    e2 = kit.facets(0.1, slope=0.3, aniso=(0.7, 2.0))
    ent_h = e1["h"] * 0.6 + 0.35 * e2["h"] * (e2["id"] > 0.4)
    ent_h = np.clip(ent_h, -0.12, 0.12) - 0.02 * tg.smoothstep(0.02, 0.0, e1["d"]) - 0.01 * tg.smoothstep(0.008, 0.0, e2["d"])
    ent_h += 0.08 * (jb["rand1"] - 0.5)  # still loosely organised into irregular columns
    ent_h += 0.003 * kit.fbm(0.03, 2)
    ent_crack = tg.smoothstep(0.02, 0.0, e1["d"])

with core.timer("flow tops"):
    # recessed 0.3 m, rubbly and vesicular, with a soil / talus ledge at the foot of the flow above
    rub = kit.scatter(0.12, K.shape_pebble(0.07, 0.05, 0.05, power=0.6, lump=0.35), density=0.9)
    rub_h = rub.height(0.0)
    vf1, _, vid = kit.worley(0.012, 1.0)
    ves = tg.smoothstep(0.35, 0.12, vf1) * (vid > 0.55)
    soil = tg.smoothstep(0.55, 0.85, (fl - ent_top) / np.maximum(1.0 - ent_top, 1e-3) + 0.25 * kit.fbm(0.4, 3))
    top_h = -0.3 + 0.6 * rub_h - 0.004 * ves + soil * (0.05 + 0.02 * kit.fbm(0.08, 3))
    top_h += 0.04 * kit.fbm(0.5, 3)
    bole = tg.smoothstep(0.0, 0.03, ft) * tg.smoothstep(0.18, 0.06, ft)  # thin red bole below the contact

with core.timer("compose"):
    h = col_h * col_zone + ent_h * ent_zone + top_h * top_zone
    # weathered, slightly rounded transition below the recessed top (the cliff lip of the step)
    h = tg.blur(h, 0.6)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.1 * kit.fbm(0.8, 3) + 0.22 * (jb["rand2"] - 0.5) + 0.05 * kit.fbm(0.05, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#3f3e3d"), (0.5, "#545250"), (1.0, "#69655f")])
    rock = K.tint(rock, "#6e655a", 0.4 * tg.smoothstep(-0.1, 0.4, kit.fbm(1.2, 3)) * col_zone)  # brown weathering rind
    rock = K.mul(rock, 1.0 - 0.18 * ent_zone)  # entablature darker, glassier
    rock = K.tint(rock, "#2c2b2a", 0.5 * joint_line * col_zone + 0.22 * ent_crack * ent_zone + 0.3 * cross * col_zone)
    fresh = fell * col_zone
    rock = K.tint(rock, "#3a3a3c", 0.4 * fresh)
    topc = K.ramp(0.5 + 0.3 * kit.fbm(0.1, 3), [(0.0, "#4e4842"), (0.5, "#5b534b"), (1.0, "#686056")])
    topc = K.mul(topc, 1.0 - 0.35 * ves)
    topc = K.tint(topc, "#51483f", 0.6 * soil)
    rock = rock * (1.0 - top_zone[..., None]) + topc * top_zone[..., None]
    rock = K.tint(rock, "#6c5244", 0.25 * bole * (1.0 - top_zone))
    # white zeolite / calcite amygdales (clustered, size-varied, sparse)
    zeo = kit.specks(0.05, coverage=0.004, size=(0.002, 0.012), cluster_m=0.6) * (ent_zone + top_zone)
    rock = K.tint(rock, "#b8b3a6", 0.7 * zeo)
    # water streaks (dark) and salt bloom (pale) running down from the ledges and joints
    lip = tg.smoothstep(0.0, 0.06, ft) * tg.smoothstep(0.35, 0.1, ft)
    src = (lip + 0.4 * joint_line * col_zone) * tg.smoothstep(0.5, 0.8, kit.fbm(0.2, 3, aniso=(0.3, 6.0)) * 0.5 + 0.5)
    streak = tg.directional_blur_down(src, int(kit.px(2.2)), 0.99)
    streak = np.clip(tg.blur(streak, 1.5) * 1.5, 0, 1) * (1.0 - top_zone)
    salt = streak * tg.smoothstep(0.55, 0.75, kit.fbm(0.5, 3) * 0.5 + 0.5)
    rock = K.tint(rock, "#262524", 0.5 * streak * (1.0 - salt))
    rock = K.tint(rock, "#8e8a82", 0.35 * salt)
    # lichen on the ledge lips (upper edge of each flow's cliff, just below the recess)
    zone = tg.smoothstep(ent_top - 0.12, ent_top - 0.02, fl) * (1.0 - top_zone)
    lic = kit.lichen(zone, coverage=0.04, patch_m=0.3, rosette_m=0.03, rosette_density=0.4)
    rock = K.tint(rock, "#8f8d80", 0.5 * lic["crust"])
    rock = K.tint(rock, "#a2794a", 0.45 * lic["rosette"] * (kit.white(0.08) > 0.6))
    h = h + lic["h"]
    alb = K.compress_chroma(rock, 0.9)

with core.timer("roughness"):
    rough = 0.76 + 0.04 * kit.fbm(0.2, 3) + 0.1 * top_zone - 0.06 * ent_zone - 0.08 * streak + 0.05 * lic["crust"]

finish_terrain(kit, h, alb, rough, macro_sigma=2.5, macro_amount=0.45, height_hp=0.2, ao_distance=0.4,
               ao_height_mix=0.35, preview="cliff",
               description="Deccan Trap basalt for triplanar projection (10 m, v = up): three flows of unequal "
                           "thickness, flat-faced angular columns 0.4-1.6 m with branching joints, hackly "
                           "entablature, recessed rubbly flow tops with soil ledges and red bole, streaks, lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
