"""
@asset thatch_palm
@kind material
@style materials:MATERIAL_PRESETS.thatch_palm, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@tiers ultra,high
@fallback thatch_grass

Palm-leaf (cadjan) shingle thatch (class C, 2 m x 2 m, seamless; P2 - ultra / high, mobile falls back to
thatch_grass): seven courses (0.286 m rhythm), u along the ridge, v UP the slope. Each course is a row of frond
TUFTS tied at a wandering line: 5-12 leaflets fanning from each tie point, every leaflet with its own width
(12-45 mm), length (0.22-0.6 m), lean, droop and taper, so tips land at all heights over the course below (no
aligned tip row, no comb); higher courses overlap lower ones; dark gaps show the old mat; midribs, bleached tips,
shaded damp tie lines.
Target (MATERIAL_PRESETS.thatch_palm): average #9c8a5c, roughness 0.90 (0.80-0.98).

Period notes: coast and forest houses (Malabar, Konkan, Bengal) - plaited coconut / palmyra fronds; no corrugated
or modern sheeting.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.thatch_palm", family="soilDry",
            saturation_limit="medium", internal=1024)
NC = 7
CH = H / NC  # 0.286 m shingle rhythm
N = kit.N
TX = W / N
rng = kit.rng

with core.timer("leaflets"):
    # P2 round 2 (AD-7): irregular overlapping leaflet TUFTS, not a comb. Each course is a row of frond leaflets tied
    # at its attachment line (wandering +-2 cm); every leaflet has its own width (12-45 mm), length (0.22-0.6 m, so
    # tips land at all heights over the course below - no aligned tip row), lean (+-14 deg), droop curve and
    # twist; leaflets bunch into tufts (a frond = 5-12 leaflets fanning from one point). Visibility: the leaflet tied
    # HIGHEST (largest drop below its attachment) lies on top - higher courses overlap lower ones, cyclic over the tile.
    pri = np.full((N, N), -1.0, np.float32)  # drop below attachment of the visible leaflet (m)
    lid = np.zeros((N, N), np.float32)
    lt = np.zeros((N, N), np.float32)  # 0 attachment .. 1 tip along the leaflet
    lx = np.zeros((N, N), np.float32)  # -1..1 across the leaflet
    lay = np.zeros((N, N), np.float32)  # leaflet's own height offset (overlap stack)
    attach_wander = kit.fbm(0.5, 3, x=kit.x[0:1, :], y=np.zeros((1, N), np.float32))[0] * 0.02
    for c in range(NC):
        va = (c + 0.5) * CH + float(rng.uniform(-0.03, 0.03))
        u = 0.0
        while u < W:
            # one frond: a tuft of leaflets fanning from a tie point
            nleaf = int(rng.integers(5, 13))
            u_tie = u + float(rng.uniform(0.0, 0.03))
            fan = float(rng.uniform(0.25, 0.6))
            base_len = float(rng.uniform(0.25, 0.5))
            for k in range(nleaf):
                ww = float(rng.uniform(0.012, 0.045))
                L = base_len * float(rng.uniform(0.7, 1.25))
                lean = (k / max(nleaf - 1, 1) - 0.5) * fan + float(rng.uniform(-0.08, 0.08))
                droop = float(rng.uniform(-0.25, 0.25))
                u0 = u_tie + (k - nleaf / 2) * ww * 0.35
                ca = attach_wander[int((u0 % W) / TX) % N]
                r_a = int(round((1.0 - (va + ca) / H) * N))
                nr = int(L / TX)
                dv = np.arange(nr, dtype=np.float32) * TX
                uc = u0 + lean * dv + droop * dv * dv  # centre line, m
                t = dv / L
                hw = 0.5 * ww * np.clip(1.0 - t ** 1.6, 0.0, 1.0) ** 0.6 * np.clip(dv / 0.02, 0.3, 1.0)
                c_lo = int(np.floor((uc - hw).min() / TX)) - 1
                c_hi = int(np.ceil((uc + hw).max() / TX)) + 1
                cols = np.arange(c_lo, c_hi)
                um = (cols + 0.5) * TX
                q = (um[None, :] - uc[:, None]) / np.maximum(hw[:, None], 1e-5)
                inside = np.abs(q) < 1.0
                rows = (r_a + np.arange(nr)) % N
                cc = cols % N
                R, C = np.meshgrid(rows, cc, indexing="ij")
                cur = pri[R, C]
                prio = dv[:, None] + 0.004 * float(rng.uniform(0, 1))
                win = inside & (prio > cur)
                if not win.any():
                    continue
                rr, ccw = R[win], C[win]
                pri[rr, ccw] = np.broadcast_to(prio, win.shape)[win]
                lid[rr, ccw] = float(rng.uniform(0, 1))
                lt[rr, ccw] = np.broadcast_to(t[:, None], win.shape)[win]
                lx[rr, ccw] = q[win]
                lay[rr, ccw] = float(rng.uniform(0, 1))
            u += float(rng.uniform(0.07, 0.15))
    covered = pri >= 0.0
    gap = ~covered

with core.timer("relief"):
    # height: courses step up (leaflets tied higher sit on more layers), leaflet profile (midrib crease, cupped
    # edges), tips lift a little and curl, gaps fall to the old dark mat below
    prof = np.sqrt(np.clip(1.0 - lx * lx, 0.0, 1.0))
    rib = tg.smoothstep(0.12, 0.0, np.abs(lx)) * covered
    h = np.where(covered, 0.03 * pri / CH + 0.003 * prof - 0.0006 * rib + 0.002 * lay + 0.003 * lt ** 3 * (lid > 0.6), -0.012)
    h = h.astype(np.float32) + 0.0004 * kit.fbm(0.02, 2, aniso=(1.0, 6.0))

with core.timer("albedo"):
    t = np.clip(0.5 + 0.3 * (lid - 0.5) + 0.12 * kit.fbm(0.2, 3) + 0.06 * kit.fbm(0.03, 2, aniso=(1.0, 5.0)), 0, 1)
    leaf = K.ramp(t, [(0.0, "#7a6a44"), (0.4, "#8f7e52"), (0.75, "#a39261"), (1.0, "#b4a273")])
    old = tg.smoothstep(0.35, 0.75, kit.fbm(0.45, 3) * 0.5 + 0.5)
    patchy = tg.smoothstep(0.55, 0.8, kit.fbm(0.6, 3, aniso=(1.5, 0.6)) * 0.5 + 0.5)  # re-thatched patches
    leaf = K.tint(leaf, "#a89a5e", 0.35 * patchy * (1.0 - old))
    leaf = K.tint(leaf, "#8a8270", 0.5 * old)  # sun-bleached grey fronds
    leaf = K.tint(leaf, "#b8ab88", 0.35 * tg.smoothstep(0.6, 1.0, lt) * covered)  # bleached tips
    leaf = K.mul(leaf, 1.0 + 0.08 * rib - 0.1 * (np.abs(lx) > 0.85))
    # shaded and damp near the tie line (under the overlapping course above)
    leaf = K.mul(leaf, 1.0 - 0.22 * tg.smoothstep(0.06, 0.0, pri) * covered)
    # through a gap the older, darker mat of the course below shows (not a black void)
    gapc = K.mul(K.tint(leaf, "#4e432e", 0.7), 0.65)
    alb = np.where(gap[..., None], gapc, leaf)
    alb = K.compress_chroma(alb, 0.75)

with core.timer("roughness"):
    rough = 0.88 + 0.04 * kit.fbm(0.1, 2) + 0.06 * gap + 0.03 * old - 0.04 * rib
    core.log(f"gap share {float(gap.mean()):.3f}")

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.04, ao_samples=32,
           description="Palm-leaf (cadjan) thatch (2 m, u along the ridge, v up-slope): courses every 0.286 m of "
                       "frond tufts - overlapping drooping leaflets of random width, length, lean and droop, tips at all "
                       "heights, dark gaps to the old mat, bleached tips.",
           extra_meta=dict(slopeAxis="v"),
           preview="roof", preview_opts=dict(samples=64, pitch=35.0))
