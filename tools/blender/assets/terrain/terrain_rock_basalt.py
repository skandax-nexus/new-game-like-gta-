"""
@asset terrain_rock_basalt
@kind material
@style terrain:TERRAIN_LAYERS.rock_basalt, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Deccan Trap basalt splat layer for TRIPLANAR projection (class T, 10 m x 10 m, seamless; v = world up on the side
projections). It must read as a STEPPED TRAP ESCARPMENT at 10-50 m (ART_BIBLE §5 rock_basalt; review B4): one lava
flow per tile, bottom to top
- LOWER COLONNADE (~4.5-6 m, its top wandering +-0.8 m along u): broad columns 0.55-1.3 m wide that run
  CONTINUOUSLY through the colonnade. Each column is a prism seen side-on (a planar centre face between two oblique
  faces that meet the neighbours in sharp creases, or a ridge where two faces meet); its light and dark come from
  the NORMAL only - no albedo seam marks a joint. Sparse, CURVED cross-joints every 2-4 m per column, each at its own
  height and sag (never lining up into courses); the segments between them sit at slightly different depths; a
  few segments fell out (recessed planar back face).
- ENTABLATURE (to 0.5-1.1 m below the flow top): a hackly zone of thin columnettes (0.15-0.4 m) that FAN and curve
  (tilt varies smoothly along u, curvature per columnette), chopped by dense irregular planar fracture chips;
  barely darker than the colonnade (the change of texture carries the zone, not a dark band).
- ONE RECESSED FLOW TOP (0.3-1.1 m, pinching along u): vesicular rubbly crust set 0.3 m back under the next flow's
  colonnade foot, with a talus apron of fallen blocks and soil at its base; same grey as the rock (value within
  -10 / +8 % of #5a5650; no pale salt or orange band).
Weathering: large-scale brown rind patches on the column faces, dark water streaks under the flow-top lip, sparse
grey and orange crustose lichen on the lip, fine vesicles and grain on every face.
Target (TERRAIN_LAYERS.rock_basalt): average #5a5650, roughness 0.78.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, _cuts, finish_terrain  # noqa: E402

F = np.float32
S = 10.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.rock_basalt", family="soilWet",
            rough_spread=0.09)
x, y = kit.x, kit.y
rng = kit.rng
u = x * S
yc = np.zeros_like(y)


def column_field(sel: np.ndarray, vloc: np.ndarray, spacing: tuple[float, float], tilt_fn, curv: float,
                 wander_m: float, wander_feature: float) -> dict[str, np.ndarray]:
    """Vertical (tilting, curving) column joints over the selected texels. vloc = m above the zone reference.
    tilt_fn(cuts) -> per-joint tilt (m/m). Returns per-texel left / right distance (m), column index, column rand."""
    cuts = np.array(_cuts(rng, S, spacing), F)
    nj = len(cuts)
    tilts = np.asarray(tilt_fn(cuts), F)
    curvs = rng.uniform(-curv, curv, nj).astype(F)
    wscale = rng.uniform(0.5, 1.0, nj).astype(F)
    nv = kit.fbm(wander_feature, 3, x=yc + 0.37, y=y)  # one wander curve along v, shared (columns stay parallel)
    uu, vv, ww = u[sel], vloc[sel], nv[sel]
    pos = cuts[:, None] + tilts[:, None] * vv[None, :] + curvs[:, None] * vv[None, :] ** 2 + wander_m * wscale[:, None] * ww[None, :]
    e = (uu[None, :] - pos) % S
    jl = np.argmin(e, axis=0)
    left = np.take_along_axis(e, jl[None, :], 0)[0]
    er = (pos - uu[None, :]) % S
    right = np.min(er, axis=0)
    out = {k: np.zeros(u.shape, F) for k in ("left", "right", "width", "lu")}
    out["col"] = np.full(u.shape, -1, np.int32)
    out["left"][sel] = left
    out["right"][sel] = right
    out["width"][sel] = left + right
    out["lu"][sel] = left / np.maximum(left + right, 1e-4)
    out["col"][sel] = jl
    out["n"] = nj
    return out


def prism(cf: dict, sel: np.ndarray, depth: tuple[float, float]) -> np.ndarray:
    """Side-on prism profile per column: oblique faces of random slope left / right, a planar centre face (or a
    ridge), each column at its own depth and with a small face tilt. Planar facets -> crisp normal-map light/dark."""
    n = cf["n"]
    a = rng.uniform(0.15, 0.45, n).astype(F)
    b = rng.uniform(0.15, 0.45, n).astype(F)
    frac = np.where(rng.uniform(0, 1, n) < 0.3, 0.5, rng.uniform(0.2, 0.36, n))  # broad facets, no narrow lit strips.astype(F)  # 25 % show a ridge
    dep = rng.uniform(depth[0], depth[1], n).astype(F)
    ftilt = rng.uniform(-0.08, 0.08, n).astype(F)
    c = np.clip(cf["col"], 0, n - 1)
    w = cf["width"]
    left, right = cf["left"], cf["right"]
    plateau = np.minimum(a[c] * frac[c] * w, b[c] * frac[c] * w)
    h = np.minimum(np.minimum(a[c] * left, b[c] * right), plateau)
    h = h + ftilt[c] * (left - 0.5 * w) * (h >= plateau - 1e-4) + dep[c]
    return np.where(sel, h, 0.0).astype(F)


with core.timer("flow"):
    # one flow per tile: its top contact wanders +-0.4 m along u; fb = m above the flow base
    off = float(rng.uniform(0, S))
    c_top = off + 0.38 * kit.fbm(3.3, 3, x=x, y=yc) + 0.12 * kit.fbm(0.8, 2, x=x, y=yc + 0.5)
    fb = ((y * S - c_top) % S).astype(F)
    top_thick = np.clip(0.55 + 0.45 * kit.fbm(3.3, 3, x=x, y=yc + 0.21) + 0.15 * kit.fbm(0.6, 2, x=x, y=yc + 0.29), 0.15, 1.2)
    # talus aprons: fallen blocks spill 0-1 m down over the entablature top in places (breaks the band)
    apron = np.clip(1.5 * (kit.fbm(2.5, 3, x=x, y=yc + 0.41) * 0.5 + 0.5) - 0.55, 0.0, 1.0) + 0.15 * kit.fbm(0.3, 2) * 0.5
    ent_thick = np.clip(2.6 + 0.6 * kit.fbm(5.0, 2, x=x, y=yc + 0.13) + 0.2 * kit.fbm(1.0, 2, x=x, y=yc + 0.17), 1.6, 3.6)
    ent_top = S - top_thick
    col_top = ent_top - ent_thick + 0.35 * kit.fbm(0.5, 3)  # ragged transition, no line
    r0 = ent_top - np.maximum(apron, 0.0)
    top_zone = tg.smoothstep(r0 - 0.06, r0 + 0.06, fb)
    ent_zone = tg.smoothstep(col_top - 0.2, col_top + 0.2, fb) * (1.0 - top_zone)
    col_zone = (1.0 - tg.smoothstep(col_top - 0.2, col_top + 0.2, fb)) * (1.0 - top_zone)

with core.timer("colonnade"):
    sel_c = col_zone > 0.0
    cc = column_field(sel_c, fb, (0.6, 1.7), lambda cuts: rng.uniform(-0.035, 0.035, len(cuts)), 0.004, 0.08, 2.2)
    col_h = prism(cc, sel_c, (0.0, 0.12))
    # sparse curved cross-joints per column, 2-4 m apart, each at its own height (never a course)
    ncol = cc["n"]
    cross = np.zeros(u.shape, F)
    seg_off = np.zeros(u.shape, F)
    fell = np.zeros(u.shape, F)
    for j in range(ncol):
        m = sel_c & (cc["col"] == j)
        if not m.any():
            continue
        vv = fb[m]
        lu = cc["lu"][m]
        pos = float(rng.uniform(0.3, 2.6))
        dmin = np.full(vv.shape, 9.0, F)
        seg = np.zeros(vv.shape, np.int32)
        k = 0
        while pos < S:
            sag = float(rng.uniform(-0.14, 0.14))
            tl = float(rng.uniform(-0.08, 0.08))
            curve = pos + sag * (1.0 - (2.0 * lu - 1.0) ** 2) + tl * (lu - 0.5)
            dmin = np.minimum(dmin, np.abs(vv - curve))
            seg += (vv > curve).astype(np.int32)
            pos += float(rng.uniform(2.0, 4.0))
            k += 1
        sr = rng.uniform(0, 1, k + 2).astype(F)
        cross[m] = tg.smoothstep(0.028, 0.0, dmin)
        seg_off[m] = 0.06 * (sr[seg] - 0.5)
        fell[m] = (sr[seg] > 0.94).astype(F) * tg.smoothstep(0.0, 0.04, dmin)
    col_h = col_h + seg_off - 0.03 * cross - 0.12 * fell
    # open hairline crack in every column crease (normal + AO only)
    crease = tg.smoothstep(0.012, 0.0, np.minimum(cc["left"], cc["right"])) * sel_c
    col_h = col_h - 0.025 * crease
    # weathering rounds the facets in broad zones (crisp prisms elsewhere): no uniform striping across the face
    wround = tg.smoothstep(-0.1, 0.5, kit.fbm(2.2, 3))
    col_h = col_h * (1.0 - wround) + kit.blur(col_h, 0.12) * wround
    # faces: slight conchoidal undulation, grain
    col_h = col_h + 0.008 * kit.fbm(0.5, 3) + 0.003 * kit.fbm(0.12, 3) + 0.001 * kit.fbm(0.03, 2)

with core.timer("entablature"):
    sel_e = ent_zone > 0.0
    vmid = fb - (col_top + 0.5 * ent_thick)
    fan_k = 2.0 * np.pi * float(rng.integers(1, 3)) / S
    fan_ph = float(rng.uniform(0, 2 * np.pi))
    ce = column_field(sel_e, vmid, (0.15, 0.5), lambda cuts: 0.22 * np.sin(fan_k * cuts + fan_ph) + rng.uniform(-0.2, 0.2, len(cuts)),
                      0.08, 0.06, 0.9)
    ent_h = prism(ce, sel_e, (-0.04, 0.04)) * 0.5
    # hackly: dense irregular planar fracture chips cut across the columnettes
    f1 = kit.facets(0.2, slope=0.45)
    f2 = kit.facets(0.07, slope=0.3)
    ent_h = ent_h + 0.85 * f1["h"] + 0.25 * f2["h"] * (f2["id"] > 0.5) - 0.012 * tg.smoothstep(0.01, 0.0, f1["d"])
    ent_h = ent_h - 0.02 * tg.smoothstep(0.01, 0.0, np.minimum(ce["left"], ce["right"])) * sel_e
    ent_h = ent_h + 0.003 * kit.fbm(0.05, 2) - 0.02

with core.timer("flow top"):
    # recessed rubbly vesicular crust + a talus apron of fallen blocks with soil at its base
    tz = np.clip((fb - r0) / np.maximum(S - r0, 1e-3), 0.0, 1.0)  # 0 bottom .. 1 contact with next flow
    rub = kit.scatter(0.11, K.shape_pebble(0.065, 0.05, 0.045, power=0.6, lump=0.35), density=0.95)
    tal = kit.scatter(0.3, K.shape_pebble(0.17, 0.12, 0.11, power=0.55, lump=0.3), density=0.55,
                      density_map=tg.smoothstep(0.65, 0.2, tz))
    vf1, _, vid = kit.worley(0.012, 1.0)
    ves = tg.smoothstep(0.35, 0.12, vf1) * (vid > 0.5)
    soil = tg.smoothstep(0.55, 0.2, tz + 0.25 * kit.fbm(0.3, 3)) * (tal.h < -1e5)
    top_h = -0.3 + 0.25 * (1.0 - tz) * tg.smoothstep(0.05, 0.3, apron) + 0.55 * rub.height(0.0) - 0.004 * ves
    top_h = np.maximum(top_h, np.where(tal.h > -1e5, -0.3 + tal.h, -1e9))
    top_h = top_h + soil * 0.02 * kit.fbm(0.08, 3) + 0.03 * kit.fbm(0.5, 3)

with core.timer("compose"):
    h = col_h * col_zone + ent_h * ent_zone + top_h * top_zone
    h = tg.blur(h, 0.5)

with core.timer("albedo"):
    cr = rng.uniform(0, 1, max(ncol, 1)).astype(F)
    ctone = np.where(sel_c, cr[np.clip(cc["col"], 0, ncol - 1)] - 0.5, 0.0)
    t = np.clip(0.5 + 0.1 * kit.fbm(1.2, 3) + 0.08 * ctone * col_zone + 0.05 * kit.fbm(0.08, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#474542"), (0.5, "#565350"), (1.0, "#66625c")])
    # brown weathering rind in broad patches on the column faces (fresh grey-black where it has spalled)
    rind = tg.smoothstep(-0.05, 0.45, kit.fbm(1.6, 4)) * (col_zone + 0.6 * ent_zone)
    rock = K.tint(rock, "#6a6157", 0.45 * rind)
    rock = K.tint(rock, "#3c3c3d", 0.35 * fell)
    rock = K.mul(rock, 1.0 - 0.06 * ent_zone)  # entablature a touch glassier / darker; texture carries the zone
    # flow top: the same basalt grey, rubble a little browner, soil dark brown-grey; vesicles darker
    topc = K.ramp(np.clip(0.5 + 0.25 * kit.fbm(0.1, 3) + 0.25 * (rub.id - 0.5), 0, 1),
                  [(0.0, "#4a4744"), (0.5, "#585450"), (1.0, "#66605a")])
    topc = K.mul(topc, 1.0 - 0.25 * ves)
    topc = K.tint(topc, "#57493e", 0.45 * soil)
    rock = rock * (1.0 - top_zone[..., None]) + topc * top_zone[..., None]
    # dark water streaks running down from the flow-top lip over the entablature (dark only, no salt)
    lip = tg.smoothstep(r0 - 0.25, r0 - 0.02, fb) * (1.0 - top_zone)
    src = lip * tg.smoothstep(0.5, 0.8, kit.fbm(0.25, 3, aniso=(0.3, 6.0)) * 0.5 + 0.5)
    streak = tg.directional_blur_down(src, int(kit.px(2.6)), 0.992)
    streak = np.clip(tg.blur(streak, 1.5) * 1.3, 0, 1) * (1.0 - top_zone)
    rock = K.tint(rock, "#2e2d2c", 0.4 * streak)
    # sparse lichen on the lip and on top of fallen talus blocks
    zone = np.clip(lip + 0.6 * top_zone * (tal.h > -1e5), 0, 1)
    lic = kit.lichen(zone, coverage=0.03, patch_m=0.3, rosette_m=0.03, rosette_density=0.35)
    rock = K.tint(rock, "#7f7d72", 0.4 * lic["crust"])
    rock = K.tint(rock, "#93734e", 0.35 * lic["rosette"] * (kit.white(0.08) > 0.6))
    h = h + lic["h"]
    alb = K.compress_chroma(rock, 0.85)

with core.timer("roughness"):
    rough = 0.78 + 0.03 * kit.fbm(0.2, 3) + 0.06 * top_zone - 0.05 * ent_zone - 0.06 * streak + 0.04 * lic["crust"] - 0.04 * fell

finish_terrain(kit, h, alb, rough, macro_sigma=2.5, macro_amount=0.45, height_hp=0.2, ao_distance=0.4,
               ao_height_mix=0.35, preview="cliff",
               description="Deccan Trap basalt for triplanar projection (10 m, v = up): one flow per tile - lower "
                           "colonnade of continuous prismatic columns 0.55-1.3 m with sparse curved cross-joints "
                           "(normal-only facets), a hackly fanning entablature, one recessed vesicular flow top "
                           "with talus; rind patches, water streaks, sparse lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
