"""
@asset stone_slab_roof
@kind material
@style materials:MATERIAL_PRESETS.stone_slab_roof, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@tiers ultra,high
@fallback granite_rubble

Overlapping granite slab roof (class C, 3 m x 3 m, seamless; P2 - ultra / high, mobile falls back to granite_rubble):
eight courses of split granite slabs (0.375 m exposed, 0.45-0.85 m wide, 35 mm thick) laid like shingles, u along
the ridge, v UP the slope (slab lower edges point down-slope = -v). Irregular broken lower edges, side joints,
slabs rocked and tilted by hand-laying, speckled grey granite (feldspar / biotite), weathering rind, moss cushions
in the overlaps and joints, grey-green and orange lichen rosettes on the exposed faces.
Target (MATERIAL_PRESETS.stone_slab_roof): average #7c7770, roughness 0.85 (0.72-0.95).

Period notes: highland (Deccan / western ghats) houses roofed with split stone slabs on timber; no cut tiles.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 3.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.stone_slab_roof", family="soilDry")
T = 0.05
CH = H / 8.0

with core.timer("layout"):
    # wobbly course lines: the broken lower edges wander +-4 cm
    by = kit.y + (0.05 * kit.fbm(0.3, 3) + 0.02 * kit.fbm(0.08, 2)) / H
    bx = kit.x + 0.03 * kit.fbm(0.25, 3) / W  # side joints not quite vertical
    b = kit.bond(CH, (0.35, 0.95), 0.012, stagger=None, x=bx, y=by)
    lu, lv, sid = b["lu"], b["lv"], b["id"]
    du = b["du"]
    vexp = lv * CH

with core.timer("relief"):
    h = T * (1.0 - lv) ** 1.3
    r1 = ((sid * 7.13) % 1.0) - 0.5
    r2 = ((sid * 2.71) % 1.0) - 0.5
    h += 0.012 * r1 * (lu - 0.5) + 0.008 * r2 * (1.0 - lv)
    # split-face relief: undulating cleavage planes and fine grain
    h += 0.004 * kit.fbm(0.25, 3) + 0.0015 * kit.fbm(0.05, 3) + 0.0003 * kit.fbm(0.006, 2)
    # broken lower edge: chipped arris
    chip = tg.smoothstep(0.0, 0.5, kit.fbm(0.04, 3)) * tg.smoothstep(0.03, 0.0, vexp)
    h -= 0.008 * chip
    h += K.Kit.edge_round(np.maximum(du - 0.006, 0.0), 0.01, 0.006)
    gap = tg.smoothstep(0.008, 0.004, du)
    h = h * (1.0 - gap) + gap * (h - 0.025)
    # moss cushions: in the side joints and tucked under the next course's lower edge (top of this course)
    mz = tg.smoothstep(0.25, 0.6, kit.fbm(0.4, 3) * 0.5 + 0.5)
    moss_zone = np.maximum(tg.smoothstep(0.012, 0.004, du), tg.smoothstep(0.72, 0.92, lv)) * mz
    moss_tex = 0.5 + 0.5 * kit.fbm(0.008, 2)
    moss = moss_zone * tg.smoothstep(0.3, 0.6, moss_tex + 0.3 * mz)
    h = np.maximum(h, h * (1.0 - moss) + moss * (h + 0.006 * moss_tex))

with core.timer("albedo"):
    t = np.clip(0.5 + 0.45 * (sid - 0.5) + 0.15 * kit.fbm(0.3, 3) + 0.06 * kit.fbm(0.03, 2), 0, 1)
    stone = K.ramp(t, [(0.0, "#605c57"), (0.4, "#75706a"), (0.75, "#8a857d"), (1.0, "#9c968c")])
    g1, _, gid = kit.worley(0.004, 1.0)  # grain: biotite flecks and feldspar laths of varied size, not dots
    stone = K.tint(stone, "#2e2c2a", 0.5 * ((gid > 0.9) & (g1 < 0.5)))
    stone = K.tint(stone, "#b9b3a6", 0.3 * (gid < 0.18))
    rind = tg.smoothstep(0.4, 0.75, kit.fbm(0.5, 3) * 0.5 + 0.5)
    stone = K.tint(stone, "#8c8476", 0.25 * rind)
    stone = K.tint(stone, "#a9a296", 0.4 * chip)  # fresh breaks
    stain = tg.smoothstep(0.55, 0.85, kit.fbm(0.06, 3, aniso=(1.0, 6.0)) * 0.5 + 0.5) * (1.0 - lv)
    stone = K.tint(stone, "#3a3834", 0.3 * stain)  # water streaks below each edge
    # AD-5: lichen as crustose patches with lobed rosettes, clustered on the exposed upper slab and the drip
    # lines under each lower edge (never round discs on a grid)
    zone = np.clip(tg.smoothstep(0.2, 0.7, lv) * 0.7 + 0.6 * stain, 0, 1) * (1.0 - moss_zone)
    lic = kit.lichen(zone, coverage=0.07, patch_m=0.3, rosette_m=0.03, rosette_density=0.45)
    lichen = np.clip(lic["crust"] + lic["rosette"], 0, 1) * (1.0 - moss_zone)
    orange_sel = (kit.fbm(0.7, 2) > 0.2).astype(np.float32)
    stone = K.tint(stone, "#a87a48", 0.55 * lichen * orange_sel)
    stone = K.tint(stone, "#959582", 0.5 * lichen * (1.0 - orange_sel))
    stone = K.tint(stone, "#b8b2a2", 0.25 * lic["centre"])
    h = h + lic["h"]
    stone = K.mul(stone, 1.0 - 0.55 * gap)
    moss_col = K.ramp(np.clip(moss_tex, 0, 1), [(0.0, "#3c4128"), (1.0, "#66693e")])
    alb = stone * (1.0 - moss[..., None]) + moss_col * moss[..., None]
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = 0.84 + 0.04 * kit.fbm(0.2, 3) + 0.06 * rind - 0.08 * chip + 0.08 * moss + 0.04 * lichen

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.05, ao_samples=32,
           description="Overlapping split-granite slab roof (3 m, u along the ridge, v up-slope): broken lower edges, "
                       "hand-laid tilt, speckled granite, moss in overlaps and joints, lichen rosettes.",
           extra_meta=dict(slopeAxis="v"),
           preview="roof", preview_opts=dict(samples=64, pitch=28.0))
