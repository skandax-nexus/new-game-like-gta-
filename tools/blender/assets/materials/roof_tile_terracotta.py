"""
@asset roof_tile_terracotta
@kind material
@style materials:MATERIAL_PRESETS.roof_tile_terracotta, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Flat grooved terracotta roof tiles with hooked lips (class S, 2 m x 2 m tile, seamless). Map u along the eave and
v UP the slope: 6 courses of 0.333 m exposure (0.43 m tiles, 0.10 m overlap), 7 tiles of 0.286 m per course,
half-bond. Each tile lies tilted on the one below (18 mm step at its lower edge), carries three water channels
running down-slope, a thickened drip rim and a nib, rounded clay edges, random roll / lift; ~3 % broken tiles
(lost corners showing the tile underneath). Lichen in rows along the wet lower edges, grey crustose spots,
dirt in the channels and the overlap shadow, sun-bleached upper faces.
Target (MATERIAL_PRESETS.roof_tile_terracotta): average #a65a3c, roughness 0.72 (0.55-0.88).

Period notes: flat, flanged / grooved fired-clay roof tiles with nail holes or hooks are excavated at Mauryan-Shunga
sites (Kausambi, Sonkh, Taxila Bhir Mound); NOT curved Mediterranean pan-and-cover tiles, not glazed.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="S", size=(W, H), target="materials:MATERIAL_PRESETS.roof_tile_terracotta",
            family="brickTerracotta")
T = 0.018  # tile thickness = step at each course

with core.timer("layout"):
    b = kit.bond(H / 6.0, (W / 7.0, W / 7.0), 0.004, stagger=0.5)
    lu, lv, tid = b["lu"], b["lv"], b["id"]
    du = b["du"]  # distance to the side joints (m)
    vexp = lv * (H / 6.0)  # meters up from this tile's exposed lower edge
    broken = ((tid * 17.31) % 1.0) < 0.03
    # broken corner: lower-left or lower-right corner lost along an irregular fracture line
    side = ((tid * 5.77) % 1.0) < 0.5
    cu = np.where(side, lu, 1.0 - lu)
    frac = cu * 1.6 + lv * 1.1 + 0.12 * kit.fbm(0.02, 3)
    lost = broken & (frac < 0.55 + 0.2 * ((tid * 3.3) % 1.0))

with core.timer("relief"):
    # tilted tile: lower edge lifted by one tile thickness, descending to the covered upper part
    h = T * (1.0 - lv) ** 1.15
    # per-tile roll (side to side) and lift - hand-laid
    r1 = ((tid * 7.13) % 1.0) - 0.5
    r2 = ((tid * 2.71) % 1.0) - 0.5
    h += 0.005 * r1 * (lu - 0.5) * 2.0 + 0.003 * r2 * (1.0 - lv)
    # three water channels per tile running down-slope (along v), shallow U troughs
    ch = np.abs(((lu * 3.0) % 1.0) - 0.5) * 2.0  # 0 at channel centre, 1 at the ridges between
    h -= 0.0028 * (1.0 - tg.smoothstep(0.0, 0.62, ch)) * tg.smoothstep(0.0, 0.08, lv)
    # thickened drip rim + central nib at the lower edge
    rim = tg.smoothstep(0.045, 0.01, vexp)
    h += 0.0015 * rim
    # rounded clay edges along the side joints and the lower edge
    h += K.Kit.edge_round(np.maximum(du - 0.002, 0.0), 0.007, 0.004)
    h += K.Kit.edge_round(vexp, 0.006, 0.003)
    # side joint gap: the tile underneath shows ~10 mm lower
    gap = tg.smoothstep(0.0028, 0.0018, du)
    h = h * (1.0 - gap) + gap * (h - 0.01)
    # hand-made clay surface: finger smoothing, pits, firing ripples
    h += 0.0005 * kit.fbm(0.06, 3) + 0.0002 * kit.fbm(0.008, 2)
    pf1, _, pid = kit.worley(0.012, 1.0)
    pits = tg.smoothstep(0.3, 0.08, pf1) * (pid > 0.82)
    h -= 0.0005 * pits
    # broken corners: the lower tile (flat, ~T lower) shows through, fracture edge rough
    lower = 0.001 * kit.fbm(0.03, 2) - 0.002
    edge_b = tg.smoothstep(0.02, 0.0, np.abs(frac - (0.55 + 0.2 * ((tid * 3.3) % 1.0)))) * broken
    h = np.where(lost, lower, h - 0.002 * edge_b)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.5 * (tid - 0.5) + 0.12 * kit.fbm(0.1, 3) + 0.05 * kit.fbm(0.012, 2), 0, 1)
    alb = K.ramp(t, [(0.0, "#83442e"), (0.35, "#9a5237"), (0.65, "#ab603f"), (1.0, "#bc7350")])
    alb = K.mul(alb, 1.0 + 0.14 * (((tid * 9.1) % 1.0) - 0.5))  # +-7 % per tile
    # ~15 % older replacement-era tiles: weathered darker brown, ~10 % newer ones: fresher orange
    old = ((tid * 11.7) % 1.0) < 0.15
    new = (((tid * 19.3) % 1.0) < 0.10) & ~old
    alb = np.where(old[..., None], K.tint(K.mul(alb, 0.78), "#6a4a3a", 0.25), alb)
    alb = np.where(new[..., None], K.tint(alb, "#c06a44", 0.3), alb)
    alb = K.hue_rotate(alb, 0.025 * (((tid * 4.4) % 1.0) - 0.5))
    # firing flash: darker smudges on some tiles
    alb = K.mul(alb, 1.0 - 0.18 * tg.smoothstep(0.55, 0.85, kit.fbm(0.15, 3) * 0.5 + 0.5) * (((tid * 6.6) % 1.0) < 0.4))
    # sun-bleached upper faces, dark wet lower edges and the overlap shadow line
    alb = K.tint(alb, "#c79a7c", 0.18 * tg.smoothstep(0.3, 0.9, lv))
    wet = tg.smoothstep(0.08, 0.0, vexp)
    alb = K.mul(alb, 1.0 - 0.25 * wet)
    # dirt in the channels (washed silt) and in side joints
    grime = (1.0 - tg.smoothstep(0.0, 0.5, ch)) * tg.smoothstep(0.1, 0.6, lv)
    grime = grime * (0.5 + 0.5 * tg.smoothstep(0.4, 0.8, kit.fbm(0.05, 3, aniso=(1.0, 8.0)) * 0.5 + 0.5))
    alb = K.tint(alb, "#4e3e31", 0.45 * grime)
    # moss / lichen colonies: patchy, denser on some areas of the roof (shade side, under overhanging trees)
    colony = tg.smoothstep(0.3, 0.7, kit.fbm(0.35, 4) * 0.5 + 0.5)
    alb = K.tint(alb, "#2e2620", 0.7 * gap)
    # lichen in rows along the lower edges (moisture held under the overlap) + grey crustose spots everywhere
    lrow = tg.smoothstep(0.12, 0.02, vexp) + 0.4 * tg.smoothstep(0.03, 0.0, du)
    lf1, _, lid = kit.worley(0.02, 1.0)
    dots = tg.smoothstep(0.45, 0.2, lf1) * (lid > 0.45)
    lichen = np.clip((lrow + 0.6 * colony) * dots * tg.smoothstep(-0.2, 0.3, kit.fbm(0.4, 3)), 0, 1)
    alb = K.tint(alb, "#8a8a5a", 0.75 * lichen)
    cf1, _, cid = kit.worley(0.035, 1.0)
    crust = tg.smoothstep(0.4, 0.25, cf1 + 0.1 * kit.fbm(0.01, 2)) * (cid > 0.86) * tg.smoothstep(0.0, 0.4, kit.fbm(0.5, 3))
    alb = K.tint(alb, "#b9b2a2", 0.55 * crust)
    alb = K.mul(alb, 1.0 - 0.25 * pits)
    # broken corners: shadowed lower tile, fresh fracture paler
    alb = np.where(lost[..., None], K.mul(alb, 0.55), alb)
    alb = K.tint(alb, "#c27b58", 0.4 * edge_b)
    alb = K.compress_chroma(alb, 0.65)

with core.timer("roughness"):
    rough = 0.7 + 0.05 * kit.fbm(0.1, 3) - 0.08 * tg.smoothstep(0.4, 1.0, lv) + 0.1 * lichen + 0.08 * crust + 0.08 * wet
    rough = rough + 0.06 * (1.0 - tg.smoothstep(0.0, 0.5, ch)) + 0.05 * gap

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.05, ao_samples=48,
           description="Flat grooved terracotta roof tiles with hooked lips (2 m): 6 courses x 7 tiles, half bond, "
                       "channels, drip rims, 3 % broken, lichen rows. u = along the eave, v = up the slope.",
           extra_meta=dict(vUp="v points UP the roof slope (tile lips face -v)"),
           preview="roof", preview_opts=dict(samples=64))
