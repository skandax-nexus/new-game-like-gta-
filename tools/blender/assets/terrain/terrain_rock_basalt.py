"""
@asset terrain_rock_basalt
@kind material
@style terrain:TERRAIN_LAYERS.rock_basalt, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Deccan Trap basalt splat layer for TRIPLANAR projection (class T, 10 m x 10 m, seamless; v = world up on the side
projections). It must read as a STEPPED TRAP ESCARPMENT at 10-50 m (ART_BIBLE §5 rock_basalt; review B4 round 2):
one lava flow per tile, bottom to top
- COLONNADE (~4.5-6 m): columns 0.45-1.5 m wide whose joints run unbroken through the whole colonnade (each joint
  wanders on its own and opens / closes along its length, so no two columns are the same strip). Every column is a
  weathered prism seen side-on - a planar centre face between two low oblique faces - and the facets are
  re-dealt at each CROSS-JOINT (sparse, curved, 2-4 m apart, each column on its own heights: never a course), so the
  light / dark of a column changes along it like real segment stacks instead of running as a plank. Light and dark
  come from the NORMAL only (low facet slopes, rounded arrises in broad weathered zones); no albedo seam marks a
  joint. A few segments fell out (recessed back face, AO shadow under the one above).
- ENTABLATURE (2-3.5 m): a HACKLY zone of thin curved columnettes 0.12-0.4 m that FAN (tilt swings smoothly along
  u), chopped by close curved cross-fractures and conchoidal chips - a finer, more chaotic texture with the same
  grey (the change of texture carries the zone, not a band of colour).
- AT MOST ONE RECESSED FLOW TOP: a vesicular rubbly crust 0-0.9 m thick that PINCHES OUT over ~40 % of the tile
  width (there only a crisp contact joint), set back under the next flow's colonnade foot, with a talus apron of
  fallen blocks spilling down in places. Same grey as the rock (value within -10 / +8 % of #5a5650).
Weathering: broad brown-grey rind patches, dark water streaks of very different lengths under the contact, sparse
grey and orange crustose lichen on the lip, vesicles and grain on every face.
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
TAU = 2.0 * np.pi


def wander_1d(nj: int, vv: np.ndarray, amp: float, kmax: int) -> np.ndarray:
    """Per-joint periodic wander along v (sum of integer-frequency sinusoids over the tile, 1/k falloff):
    each joint bends on its own, so neighbouring columns never stay parallel strips. Returns (nj, len(vv))."""
    out = np.zeros((nj, vv.size), F)
    ks = np.arange(1, kmax + 1)
    for k in ks:
        a = (amp / k ** 0.9) * rng.uniform(0.3, 1.0, nj).astype(F)
        ph = rng.uniform(0.0, TAU, nj).astype(F)
        out += a[:, None] * np.sin((TAU * k / S) * vv[None, :] + ph[:, None])
    return out


def column_field(sel: np.ndarray, vloc: np.ndarray, spacing: tuple[float, float], tilt: np.ndarray, curv: float,
                 wander_m: float, wander_k: int) -> dict:
    """Column joints over the selected texels (vloc = m from the zone reference). tilt = per-joint lean (m/m).
    Returns left / right distance to the bounding joints (m), column index, width, lu (0..1 across), plus the
    distance to the nearest joint and that joint's index (for per-joint openness)."""
    cuts = np.array(_cuts(rng, S, spacing), F)
    nj = len(cuts)
    tilt = np.asarray(tilt(cuts), F)
    curvs = rng.uniform(-curv, curv, nj).astype(F)
    uu, vv = u[sel], vloc[sel]
    pos = cuts[:, None] + tilt[:, None] * vv[None, :] + curvs[:, None] * vv[None, :] ** 2 + wander_1d(nj, y[sel] * S, wander_m, wander_k)
    e = (uu[None, :] - pos) % S
    jl = np.argmin(e, axis=0)
    left = np.take_along_axis(e, jl[None, :], 0)[0]
    er = (pos - uu[None, :]) % S
    jr = np.argmin(er, axis=0)
    right = np.take_along_axis(er, jr[None, :], 0)[0]
    del e, er, pos
    out = {k: np.zeros(u.shape, F) for k in ("left", "right", "width", "lu")}
    out["col"] = np.full(u.shape, -1, np.int32)
    out["jn"] = np.full(u.shape, -1, np.int32)
    out["left"][sel] = left
    out["right"][sel] = right
    out["width"][sel] = left + right
    out["lu"][sel] = left / np.maximum(left + right, 1e-4)
    out["col"][sel] = jl
    out["jn"][sel] = np.where(left < right, jl, jr)
    out["n"] = nj
    return out


def segmented_prisms(cf: dict, sel: np.ndarray, vloc: np.ndarray, seg_step: tuple[float, float], slope: tuple[float, float],
                     sag: float, depth: float, fell_p: float, groove: float) -> dict:
    """Side-on prism relief per column: oblique facet slopes a / b and a plateau fraction per COLUMN that drift
    slowly along it (the column twists a little - no block-by-block re-dealing, which reads as masonry), cut by
    sparse curved cross-joints at the column's own heights; each segment sits at a slightly different depth and a
    fraction fell_p of segments is recessed (fallen). Returns h, cross (0..1 cross-joint line), fell (0..1), seg id."""
    n = cf["n"]
    h = np.zeros(u.shape, F)
    cross = np.zeros(u.shape, F)
    fell = np.zeros(u.shape, F)
    sid = np.zeros(u.shape, F)
    for j in range(n):
        m = sel & (cf["col"] == j)
        if not m.any():
            continue
        vv = vloc[m]
        vw = y[m] * S  # world v (periodic drift)
        lu = cf["lu"][m]
        left, right, w = cf["left"][m], cf["right"][m], cf["width"][m]
        lo = float(vv.min()) - 0.01
        hi = float(vv.max())
        pos = lo + float(rng.uniform(0.2, 1.0)) * seg_step[0]
        dmin = np.full(vv.shape, 9.0, F)
        seg = np.zeros(vv.shape, np.int32)
        k = 0
        while pos < hi:
            sg = float(rng.uniform(-sag, sag))
            tl = float(rng.uniform(-0.6, 0.6)) * sag
            curve = pos + sg * (1.0 - (2.0 * lu - 1.0) ** 2) + tl * (lu - 0.5)
            dmin = np.minimum(dmin, np.abs(vv - curve))
            seg += (vv > curve).astype(np.int32)
            pos += float(rng.uniform(seg_step[0], seg_step[1]))
            k += 1
        ns = k + 1
        # per-column facets with a slow periodic drift along v (integer cycles per tile)
        kk = float(rng.integers(1, 3))
        ph = float(rng.uniform(0, TAU))
        drift = np.sin(TAU * kk * vw / S + ph).astype(F)
        a = np.clip(rng.uniform(slope[0], slope[1]) + 0.35 * (slope[1] - slope[0]) * drift, 0.02, None)
        b = np.clip(rng.uniform(slope[0], slope[1]) - 0.35 * (slope[1] - slope[0]) * drift, 0.02, None)
        frac = 0.5 if rng.uniform() < 0.25 else float(rng.uniform(0.18, 0.34))  # 25 %: a ridge
        ftu = float(rng.uniform(-0.04, 0.04))
        dep0 = float(rng.uniform(-0.5, 0.5)) * depth
        dseg = rng.uniform(-0.5, 0.5, ns).astype(F) * 0.03
        gone = (rng.uniform(0, 1, ns) < fell_p).astype(F)
        rs = rng.uniform(0, 1, ns).astype(F)
        plateau = np.minimum(a, b) * frac * w
        hh = np.minimum(np.minimum(a * left, b * right), plateau)
        hh = hh + ftu * (left - 0.5 * w) + dep0 + dseg[seg]
        cr = tg.smoothstep(groove, 0.0, dmin)
        fl = gone[seg] * tg.smoothstep(0.0, 0.05, dmin)
        h[m] = hh - 0.6 * groove * cr - 0.08 * fl
        cross[m] = cr
        fell[m] = fl
        sid[m] = rs[seg] * 0.3 + float(rng.uniform()) * 0.7
    return {"h": h, "cross": cross, "fell": fell, "sid": sid}


with core.timer("flow"):
    # fb = m above this flow's base (the contact with the crust of the flow below), wandering +-0.35 m along u
    off = float(rng.uniform(0, S))
    c_base = off + 0.3 * kit.fbm(3.3, 3, x=x, y=yc) + 0.1 * kit.fbm(0.8, 2, x=x, y=yc + 0.5)
    fb = ((y * S - c_base) % S).astype(F)
    # flow-top crust: pinches out over ~40 % of the width (only a contact joint there)
    pn = kit.fbm(3.0, 3, x=x, y=yc + 0.21) + 0.25 * kit.fbm(0.9, 2, x=x, y=yc + 0.27)
    thr = float(np.percentile(pn, 40))
    top_thick = (0.9 * np.clip((pn - thr) / max(float(pn.max()) - thr, 1e-3), 0.0, 1.0) ** 0.7).astype(F)
    ent_thick = np.clip(2.8 + 0.5 * kit.fbm(4.5, 2, x=x, y=yc + 0.13) + 0.25 * kit.fbm(1.1, 2, x=x, y=yc + 0.17), 2.0, 3.6)
    crust0 = S - top_thick  # crust from crust0 to S (the next flow's base)
    col_top = crust0 - ent_thick + 0.4 * kit.fbm(2.2, 2, x=x, y=yc + 0.71)  # wandering transition along u, no teeth
    in_crust = fb >= crust0
    top_zone = (tg.smoothstep(crust0 - 0.04, crust0 + 0.04, fb) * (top_thick > 0.03)).astype(F)
    ent_zone = (tg.smoothstep(col_top - 0.2, col_top + 0.2, fb) * (1.0 - top_zone)).astype(F)
    col_zone = ((1.0 - tg.smoothstep(col_top - 0.2, col_top + 0.2, fb)) * (1.0 - top_zone)).astype(F)

with core.timer("colonnade"):
    sel_c = col_zone > 0.0
    cc = column_field(sel_c, fb, (0.45, 1.5), lambda cuts: rng.uniform(-0.03, 0.03, len(cuts)), 0.003, 0.05, 3)
    pr = segmented_prisms(cc, sel_c, fb, (2.0, 4.0), (0.05, 0.2), 0.16, 0.07, 0.025, 0.022)
    col_h = pr["h"]
    # joints: open / closed along their length and per joint (hairline in places, a dark slot in others)
    nj = cc["n"]
    jopen = rng.uniform(0.2, 1.0, max(nj, 1)).astype(F)
    jvar = np.clip(0.5 + 0.7 * kit.fbm(1.4, 3, aniso=(0.2, 1.0)), 0.0, 1.0)
    jd = np.minimum(cc["left"], cc["right"])
    jw = 0.012 + 0.025 * jopen[np.clip(cc["jn"], 0, nj - 1)] * jvar
    slot = tg.smoothstep(jw, 0.0, jd) * sel_c
    col_h = col_h - 0.018 * slot * jvar  # shallow: a deep slot's lit wall reads as a pale seam
    # weathering rounds the arrises in broad zones (crisp prisms elsewhere); spheroidal rounding at segment corners
    wround = tg.smoothstep(-0.2, 0.5, kit.fbm(2.4, 3))
    col_h = col_h * (1.0 - wround) + kit.blur(col_h, 0.07) * wround
    col_h = kit.blur(col_h, 0.012)
    # faces: conchoidal undulation, shallow spalls, grain
    # weathered skin: shallow conchoidal undulation, rough pitted grain (no outlined chips)
    col_h = (col_h + 0.012 * kit.fbm(0.3, 3) + 0.006 * (kit.fbm(0.12, 3, ridged=True) - 0.5)
             + 0.0025 * kit.fbm(0.05, 3) + 0.0008 * kit.fbm(0.015, 2))

with core.timer("entablature"):
    sel_e = ent_zone > 0.0
    vmid = (fb - col_top - 1.4).astype(F)
    # fan: the columnette lean drifts smoothly and irregularly along u (random periodic walk, no regular scallops)
    fan_a = [(float(rng.uniform(0.04, 0.12)) / kq, float(rng.uniform(0, TAU))) for kq in (1, 2, 3, 5)]

    def fan(cuts):
        t_ = np.zeros(len(cuts), F)
        for kq, (amp_, ph_) in zip((1, 2, 3, 5), fan_a):
            t_ += amp_ * np.sin(TAU * kq * cuts / S + ph_)
        return t_ * 1.6 + rng.uniform(-0.05, 0.05, len(cuts))

    ce = column_field(sel_e, vmid, (0.16, 0.45), fan, 0.04, 0.04, 4)
    pe = segmented_prisms(ce, sel_e, vmid, (0.15, 0.55), (0.06, 0.22), 0.06, 0.03, 0.04, 0.012)
    ent_h = pe["h"] * 0.8
    # hackly conchoidal chips (planar, irregular) across the columnettes
    f1 = kit.facets(0.22, slope=0.25)
    f2 = kit.facets(0.09, slope=0.2)
    ent_h = ent_h + 0.3 * f1["h"] + 0.12 * f2["h"] * (f2["id"] > 0.4) - 0.006 * tg.smoothstep(0.006, 0.0, f1["d"])
    ent_h = ent_h - 0.012 * tg.smoothstep(0.008, 0.0, np.minimum(ce["left"], ce["right"])) * sel_e
    ent_h = ent_h + 0.002 * kit.fbm(0.05, 2)
    # same mean face plane as the colonnade (no step outlining the zone): the texture change carries it
    ent_h = ent_h - float(ent_h[sel_e].mean(dtype=np.float64)) + float(col_h[sel_c].mean(dtype=np.float64)) - 0.01

with core.timer("flow top"):
    # recessed vesicular rubbly crust, a talus apron spilling down over the entablature top in places
    tz = np.clip((fb - crust0) / np.maximum(top_thick, 1e-3), 0.0, 1.0)
    rub = kit.scatter(0.11, K.shape_pebble(0.06, 0.045, 0.04, power=0.6, lump=0.35), density=0.95)
    vf1, _, vid = kit.worley(0.014, 1.0)
    ves = tg.smoothstep(0.35, 0.12, vf1) * (vid > 0.45)
    top_h = -0.28 + 0.5 * rub.height(0.0) - 0.004 * ves + 0.02 * kit.fbm(0.4, 3)
    # talus: blocks below the crust, only where the crust is thick, density falling off downward over 0-1.2 m
    apron_len = 1.2 * tg.smoothstep(0.15, 0.8, top_thick) * (0.4 + 0.6 * (kit.fbm(1.8, 2, x=x, y=yc + 0.61) * 0.5 + 0.5))
    below = crust0 - fb
    tal_d = np.where((below > 0) & (below < apron_len + 0.3), 1.0 - below / np.maximum(apron_len, 0.05), 0.0)
    tal = kit.scatter(0.26, K.shape_pebble(0.15, 0.11, 0.1, power=0.55, lump=0.3), density=0.75,
                      density_map=np.clip(tal_d, 0, 1).astype(F))
    soil = tg.smoothstep(0.3, 0.0, below) * (below > 0) * tg.smoothstep(0.1, 0.5, top_thick) * (tal.h < -1e5)

with core.timer("compose"):
    h = col_h * col_zone + ent_h * ent_zone + top_h * top_zone
    # contact joint where the crust pinches out: a crisp open line at the flow base
    pinched = top_thick <= 0.03
    h = h - 0.035 * tg.smoothstep(0.025, 0.0, np.abs(fb - crust0)) * pinched
    # the next flow's colonnade foot overhangs the crust a little (lip shadow) - it is the tile bottom wrapping
    h = h + 0.05 * tg.smoothstep(0.25, 0.0, fb) * (1.0 - top_zone)
    tal_top = np.where(tal.h > -1e5, -0.1 + 0.9 * tal.h, -1e9)
    h = np.where(tal_top > h, tal_top, h)
    h = h + soil * (0.01 * kit.fbm(0.08, 3) - 0.04)
    h = tg.blur(h, 0.5)

with core.timer("albedo"):
    # one basalt grey; per-segment tone +-2.5 % only (the normal carries the facets)
    seg_t = np.where(sel_c, pr["sid"] - 0.5, np.where(sel_e, pe["sid"] - 0.5, 0.0))
    t = np.clip(0.5 + 0.12 * kit.fbm(1.3, 3) + 0.05 * seg_t + 0.05 * kit.fbm(0.07, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#4a4845"), (0.5, "#575451"), (1.0, "#64605a")])
    # brown-grey weathering rind in broad patches; fresh darker grey where segments fell out
    rind = tg.smoothstep(-0.05, 0.5, kit.fbm(1.7, 4)) * (col_zone + 0.6 * ent_zone)
    rock = K.tint(rock, "#675e55", 0.4 * rind)
    rock = K.tint(rock, "#403f3f", 0.3 * pr["fell"])
    # flow top: the same grey, rubble a touch browner, soil dark brown-grey; vesicles darker
    topc = K.ramp(np.clip(0.5 + 0.22 * kit.fbm(0.1, 3) + 0.22 * (rub.id - 0.5), 0, 1),
                  [(0.0, "#4c4946"), (0.5, "#585450"), (1.0, "#635e58")])
    topc = K.mul(topc, 1.0 - 0.2 * ves)
    rock = rock * (1.0 - top_zone[..., None]) + topc * top_zone[..., None]
    rock = K.tint(rock, "#55493f", 0.45 * soil)
    # dark water streaks of very different lengths from the contact / crust lip downward (dark only, no salt)
    lip = np.clip(tg.smoothstep(crust0 - 0.2, crust0, fb) * (1.0 - top_zone), 0, 1)
    src = lip * tg.smoothstep(0.55, 0.85, kit.fbm(0.22, 3, aniso=(0.3, 6.0)) * 0.5 + 0.5)
    s_long = tg.directional_blur_down(src * (kit.white(0.6) > 0.55), int(kit.px(4.5)), 0.996)
    s_short = tg.directional_blur_down(src, int(kit.px(1.2)), 0.99)
    streak = np.clip(tg.blur(np.maximum(s_long * 0.8, s_short), 1.5) * 1.2, 0, 1) * (1.0 - top_zone)
    rock = K.tint(rock, "#2f2e2d", 0.35 * streak)
    # sparse lichen on the lip and on fallen talus blocks
    # reviewer R2: the lip band is ~2 % of the tile, so a solid lip zone made the 2.5 % lichen fill it end to end
    # as one pale line along the contact; lichen now holds only in sparse patches along the lip (u-only noise)
    lip_patch = tg.smoothstep(0.62, 0.8, kit.fbm(1.6, 3, x=x, y=yc + 0.47) * 0.5 + 0.5)
    zone = np.clip(0.8 * lip * lip_patch + 0.6 * (tal.h > -1e5), 0, 1)
    lic = kit.lichen(zone, coverage=0.025, patch_m=0.3, rosette_m=0.03, rosette_density=0.3)
    rock = K.tint(rock, "#7a786e", 0.35 * lic["crust"])
    rock = K.tint(rock, "#8d7150", 0.3 * lic["rosette"] * (kit.white(0.08) > 0.6))
    h = h + lic["h"]
    alb = K.compress_chroma(rock, 0.85)

with core.timer("roughness"):
    rough = (0.78 + 0.03 * kit.fbm(0.2, 3) + 0.05 * top_zone - 0.04 * ent_zone - 0.06 * streak + 0.04 * lic["crust"]
             - 0.03 * pr["fell"])

finish_terrain(kit, h, alb, rough, macro_sigma=2.5, macro_amount=0.45, height_hp=0.2, ao_distance=0.4,
               ao_height_mix=0.35, preview="cliff",
               description="Deccan Trap basalt for triplanar projection (10 m, v = up): one flow per tile - colonnade "
                           "of unbroken columns 0.45-1.5 m whose prism facets are re-dealt at sparse curved "
                           "cross-joints (normal-only light / dark), a hackly fanning entablature of curved "
                           "columnettes, one recessed vesicular flow top that pinches out, talus; rind, streaks, lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
