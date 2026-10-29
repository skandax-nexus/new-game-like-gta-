"""
Indian stone-carving motifs as procedural HEIGHT FIELDS (meters) for trim sheets, carved panels and
tiling materials. OWNER: Technical Art Director.

All motif functions take band-local coordinate arrays:
    u  meters along the band (periodic with the sheet width, e.g. 2.0 m)
    v  meters across the band, 0 = bottom edge, H = top edge
and return float32 height arrays (0 = wall plane, + raised, - recessed). They are pure numpy, so
they also work for unique UV-space carving (torana panels) and for in-engine CPU generation later.

Motifs (historical references: Sanchi / Bharhut vedika medallions, Mauryan-Shunga bead-and-reel,
padma (lotus) mouldings, patra-lata creeper scrolls, dentil courses, dressed ashlar):
    ashlar            coursed dressed blocks: drafted margins, pitched tooling, pillowing, chipped arrises
    medallion_frieze  framed panels with full-blown lotus medallions (vedika crossbar style)
    bead_reel         bead-and-reel astragal
    padma             lotus-petal cyma moulding
    dentil            dentil course over a torus roll
    vine_scroll       running creeper scroll with spirals, leaves and buds
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from . import texgen as tg

F = np.float32


# ------------------------------------------------------------------------------------- primitives
def dome(d: np.ndarray, r: float, h: float, power: float = 0.5) -> np.ndarray:
    """Spherical-ish cap: h at d=0, 0 at d>=r. power 0.5 = sphere, 1 = paraboloid."""
    t = np.clip(1.0 - (d / r) ** 2, 0.0, 1.0)
    return (h * t**power).astype(F)


def smax(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    """Polynomial smooth maximum (soft union of raised elements)."""
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return (np.maximum(a, b) + h * h * k * 0.25).astype(F)


def wrap_delta(x: np.ndarray, period: float) -> np.ndarray:
    """Signed distance to the nearest multiple of `period` (in [-period/2, period/2))."""
    return ((x + 0.5 * period) % period - 0.5 * period).astype(F)


def rounded_rect_inside(dx: np.ndarray, dy: np.ndarray, hx: float, hy: float, rc: float) -> np.ndarray:
    """Distance from the boundary INSIDE a centered rounded rectangle (negative outside)."""
    ix = hx - np.abs(dx)
    iy = hy - np.abs(dy)
    qx = np.maximum(rc - ix, 0.0)
    qy = np.maximum(rc - iy, 0.0)
    corner = (ix < rc) & (iy < rc)
    return np.where(corner, rc - np.hypot(qx, qy), np.minimum(ix, iy)).astype(F)


def arris_profile(d: np.ndarray, gap: float, radius: float, depth: float) -> np.ndarray:
    """Block edge profile from the inside distance d: joint floor (-depth) -> rounded arris -> face (0)."""
    t = np.clip((d - gap * 0.5) / radius, 0.0, 1.0)
    prof = np.sqrt(np.clip(1.0 - (1.0 - t) ** 2, 0.0, 1.0))
    return (-depth + depth * prof).astype(F)


def cut_joint(h: np.ndarray, d: np.ndarray, gap: float, radius: float, depth: float) -> np.ndarray:
    """Cut a stone joint into ANY surface: rounds the surface down to the joint floor near d=0."""
    t = np.clip((d - gap * 0.5) / radius, 0.0, 1.0)
    prof = np.sqrt(np.clip(1.0 - (1.0 - t) ** 2, 0.0, 1.0))
    return (-depth + (h + depth) * prof).astype(F)


def petal(
    x: np.ndarray, y: np.ndarray, width: float = 0.95, p: float = 1.6, q: float = 0.8, base: float = 0.55
) -> tuple[np.ndarray, np.ndarray]:
    """Almond lotus petal in normalized coords: x in [-1,1] across, y in [0,1] base->tip.
    width = max half-width, p = where the taper starts (higher = later), q = tip pointiness
    (0.5 rounded .. 1.0 sharp), base = relative width at y=0. Returns (soft inside mask, cross 0..1)."""
    yc = np.clip(y, 0.0, 1.0)
    w = width * np.clip(1.0 - yc**p, 0.0, 1.0) ** q * (base + (1.0 - base) * tg.smoothstep(0.0, 0.4, yc))
    w = np.maximum(w, 1e-4)
    rel = np.abs(x) / w
    valid = (y >= 0.0) & (y <= 1.0)
    inside = np.where(valid, tg.smoothstep(1.0, 0.9, rel), 0.0)
    cross = np.where(valid, np.sqrt(np.clip(1.0 - rel**2, 0.0, 1.0)), 0.0)
    return inside.astype(F), cross.astype(F)


def petal_ring(
    r: np.ndarray, th: np.ndarray, n: int, r0: float, r1: float, h_base: float, h_peak: float, phase: float = 0.0,
    width: float = 0.98, rib: float = 0.0018, outline: float = 0.0016, p: float = 1.8, q: float = 0.85,
    base: float = 0.35, curl: float = 0.3,
) -> np.ndarray:
    """Ring of n radial petals between radii r0..r1 (polar coordinates). Returns height, -1e3 outside."""
    step = 2.0 * np.pi / n
    k = np.round((th - phase) / step)
    phi = th - phase - k * step
    x = phi / (step * 0.5) * np.clip(r / max(r1, 1e-6), 0.25, 1.0) ** 0.0
    y = (r - r0) / (r1 - r0)
    inside, cross = petal(x, y, width, p, q, base)
    yc = np.clip(y, 0, 1)
    along = 0.55 + 0.45 * np.sin(np.pi * yc * 0.8) + curl * tg.smoothstep(0.7, 1.0, yc)
    h = h_base + (h_peak - h_base) * along * cross**0.5
    w = np.maximum(width * np.clip(1.0 - yc**p, 0.0, 1.0) ** q * (base + (1.0 - base) * tg.smoothstep(0.0, 0.4, yc)), 1e-4)
    rel = np.abs(x) / w
    h -= rib * np.exp(-((x / 0.1) ** 2)) * tg.smoothstep(0.1, 0.5, yc) * (1.0 - tg.smoothstep(0.8, 0.98, yc))
    h -= outline * np.exp(-(((rel - 0.74) / 0.06) ** 2)) * tg.smoothstep(0.08, 0.25, yc)
    return np.where(inside > 0.0, h_base + (h - h_base) * inside, -1e3).astype(F)


# ------------------------------------------------------------------------------------- bands
@dataclass
class BandResult:
    height: np.ndarray
    stone: np.ndarray  # per-stone random id 0..1 (color variation)
    carve: np.ndarray  # 1 = carved ornament, 0 = plain dressed face
    joint: np.ndarray  # distance to the nearest stone joint (m), for grime/mortar masks
    tool: np.ndarray | None = None  # 1 = pitched/tooled centre field of dressed blocks


def _stones_along(u: np.ndarray, length: float, cuts: list[float], rng: np.random.Generator):
    """Stone index and distance to the nearest vertical joint for joints at `cuts` (periodic)."""
    cuts_arr = np.sort(np.array(cuts, F) % length)
    ext = np.concatenate([cuts_arr - length, cuts_arr, cuts_arr + length])
    idx = np.searchsorted(ext, u, side="right") - 1
    left = ext[idx]
    right = ext[np.minimum(idx + 1, len(ext) - 1)]
    dist = np.minimum(u - left, right - u)
    sid = idx % len(cuts_arr)
    ids = rng.uniform(0.0, 1.0, len(cuts_arr)).astype(F)
    return ids[sid], dist.astype(F)


def ashlar(
    u: np.ndarray, v: np.ndarray, length: float, height: float, courses: int, rng: np.random.Generator,
    min_len: float = 0.45, max_len: float = 0.95, gap: float = 0.004, arris: float = 0.012,
    joint_depth: float = 0.012, pillow: float = 0.003, tooling: float = 0.0006, margin: float = 0.03,
) -> BandResult:
    """Coursed dressed ashlar: random block lengths per course (wrapping), drafted margins, pitched
    centre field, rounded/chipped arrises."""
    ch = height / courses
    H = np.zeros_like(u)
    S = np.zeros_like(u)
    J = np.full_like(u, 9.0)
    T = np.zeros_like(u)
    course = np.clip(np.floor(v / ch), 0, courses - 1).astype(np.int64)
    for c in range(courses):
        lens: list[float] = []
        while sum(lens) < length:
            lens.append(float(rng.uniform(min_len, max_len)))
        scale = length / sum(lens)
        cuts = list(np.cumsum([0.0] + [x * scale for x in lens[:-1]]) + rng.uniform(0, length))
        sel = course == c
        if not np.any(sel):
            continue
        uu = u[sel] % length
        vv = v[sel] - c * ch
        sid, dx = _stones_along(uu, length, cuts, rng)
        dy = np.minimum(vv, ch - vv)
        rc = arris * 1.2
        qx = np.maximum(rc - dx, 0.0)
        qy = np.maximum(rc - dy, 0.0)
        d = np.where((dx < rc) & (dy < rc), rc - np.hypot(qx, qy), np.minimum(dx, dy))
        prof = arris_profile(d, gap, arris, joint_depth)
        # block-local normalized coordinates for pillowing
        bl = np.clip(d / (0.5 * ch), 0.0, 1.0)
        pil = pillow * (1.0 - (1.0 - bl) ** 2)
        # drafted margin: fine batter strokes perpendicular to the arris; centre field is pitched
        # (pits are added at sheet level by the material so they stay periodic).
        field_mask = tg.smoothstep(margin, margin + 0.012, d)
        along_edge = np.where(dx < dy, vv, uu)
        jitter = np.sin(along_edge * 37.0 + sid * 11.0) * 0.6
        strokes = np.sin(along_edge * (2 * np.pi / 0.0045) + jitter) * tooling * 0.35
        strokes *= (1.0 - field_mask) * tg.smoothstep(gap, gap + arris, d)
        H[sel] = prof + pil + strokes - 0.0007 * field_mask
        S[sel] = (sid + c * 0.618) % 1.0
        J[sel] = d
        T[sel] = field_mask
    return BandResult(H.astype(F), S.astype(F), np.zeros_like(u), J.astype(F), T.astype(F))


def lotus_medallion(dx: np.ndarray, dy: np.ndarray, R: float, field: float, beads: int = 24,
                    outer: int = 12, inner: int = 8) -> np.ndarray:
    """Full-blown lotus medallion of radius R centred at (0,0): rim, bead ring, two layers of outer
    petals, inner petals, stamen ring and a seed pod. Returns height (-1e3 outside the medallion)."""
    r = np.hypot(dx, dy)
    th = np.arctan2(dy, dx)
    h = np.where(r < R, field, -1e3).astype(F)
    # rim: flat fillet with a torus inside it
    h = np.maximum(h, np.where(r < R, field + 0.004 * tg.smoothstep(R, R - 0.004, r) * tg.smoothstep(R - 0.016, R - 0.012, r), -1e3))
    h = np.maximum(h, field + dome(np.abs(r - (R - 0.019)), 0.0055, 0.014))
    step = 2 * np.pi / beads
    phi = th - np.round(th / step) * step
    br = R - 0.034
    h = np.maximum(h, field + dome(np.hypot(r - br, r * phi), 0.0068, 0.014))
    o1 = br - 0.011
    back = petal_ring(r, th, outer, 0.42 * R, o1, field, field + 0.013, phase=np.pi / outer, width=1.0, base=0.3)
    front = petal_ring(r, th, outer, 0.38 * R, o1 - 0.008, field, field + 0.024, width=0.97, base=0.3)
    h = np.maximum(h, np.maximum(back, front))
    inner_h = petal_ring(r, th, inner, 0.19 * R, 0.43 * R, field + 0.006, field + 0.027, phase=np.pi / inner,
                         width=0.98, base=0.4, outline=0.0012)
    h = np.maximum(h, inner_h)
    st = 0.19 * R
    stamen = field + 0.012 + 0.0025 * np.cos(th * 40.0) * tg.smoothstep(0.15 * R, 0.17 * R, r)
    h = np.where(r < st, np.maximum(h, stamen), h)
    pod_r = 0.15 * R
    pod = field + 0.012 + dome(r, pod_r, 0.014, 0.6)
    seeds = [(0.0, 0.0)] + [(0.58 * pod_r * np.cos(a), 0.58 * pod_r * np.sin(a)) for a in np.arange(6) * np.pi / 3]
    for sx, sy in seeds:
        pod = pod - dome(np.hypot(dx - sx, dy - sy), 0.0042, 0.003)
    h = np.where(r < pod_r, pod, h)
    return h.astype(F)


def medallion_frieze(u: np.ndarray, v: np.ndarray, length: float, height: float, panels: int, rng: np.random.Generator,
                     joints: tuple[float, ...] = (0.0, 1.0)) -> BandResult:
    """Framed panels, each with a full-blown lotus medallion (Sanchi/Bharhut vedika crossbar style)
    and half-lotus fans in the spandrels."""
    pw = length / panels
    cv = height * 0.5
    dx = wrap_delta(u - pw * 0.5, pw)
    dy = v - cv
    field = -0.014
    hx, hy = pw * 0.5 - 0.016, height * 0.5 - 0.022
    inside = rounded_rect_inside(dx, dy, hx, hy, 0.008)
    # frame: raised flat border with a small inner chamfer down to the recessed field
    h = np.where(inside < 0.0, 0.0, field + (0.0 - field) * (1.0 - tg.smoothstep(0.0, 0.005, inside))).astype(F)
    R = min(hx, hy) - 0.004
    h = np.maximum(h, lotus_medallion(dx, dy, R, field))
    for sxn in (-1.0, 1.0):
        for syn in (-1.0, 1.0):
            ex, ey = dx - sxn * hx, dy - syn * hy
            rr = np.hypot(ex, ey)
            loc = np.arctan2(ey, ex) - np.arctan2(-syn, -sxn)
            loc = (loc + np.pi) % (2 * np.pi) - np.pi
            fan = petal_ring(rr, loc, 6, 0.006, 0.07, field, field + 0.012, phase=np.pi / 6, width=0.95, base=0.3)
            fan = np.where((np.abs(loc) < np.pi / 2 - 0.05) & (inside > 0.002), fan, -1e3)
            h = np.maximum(h, fan)
            h = np.maximum(h, np.where(inside > 0.002, field + dome(rr, 0.011, 0.012), -1e3))
    sid, jd = _stones_along(u % length, length, list(joints), rng)
    h = cut_joint(h, jd, 0.003, 0.006, 0.02)
    carve = (inside > 0.004).astype(F)
    return BandResult(h.astype(F), sid, carve, jd)


def bead_reel(u: np.ndarray, v: np.ndarray, length: float, height: float, period: float, rng: np.random.Generator,
              joints: tuple[float, ...] = (0.5, 1.5)) -> BandResult:
    """Bead-and-reel astragal: ellipsoidal beads alternating with paired reel discs on a half-round."""
    x = wrap_delta(u, period)
    y = v - height * 0.5
    base = dome(np.abs(y), height * 0.5, 0.004) - 0.004
    bead = dome(np.hypot(x / (period * 0.27), y / (height * 0.31)), 1.0, 0.017) - 0.003
    xr = wrap_delta(u - period * 0.5, period)
    reel = np.maximum(
        dome(np.hypot((xr - 0.0068) / 0.0045, y / (height * 0.21)), 1.0, 0.011),
        dome(np.hypot((xr + 0.0068) / 0.0045, y / (height * 0.21)), 1.0, 0.011),
    ) - 0.003
    h = np.maximum(base, np.maximum(bead, reel))
    sid, jd = _stones_along(u % length, length, list(joints), rng)
    h = cut_joint(h, jd, 0.003, 0.005, 0.016)
    return BandResult(h.astype(F), sid, np.ones_like(u), jd)


def padma(u: np.ndarray, v: np.ndarray, length: float, height: float, period: float, rng: np.random.Generator,
          joints: tuple[float, ...] = (0.25, 1.25)) -> BandResult:
    """Lotus-petal cyma moulding (padma): broad upright petals with pointed, slightly upturned tips,
    incised double outlines and a back row of petal tips between them."""
    y = v / height
    base = 0.022 * np.sin(np.pi * np.clip(y, 0, 1) * 0.92 + 0.08) ** 0.8 - 0.008
    x = wrap_delta(u - period * 0.5, period) / (period * 0.5)
    ys = (y - 0.04) / 0.92
    ins, cross = petal(x, ys, 0.98, 2.4, 0.62, 0.92)
    yc = np.clip(ys, 0, 1)
    w = np.maximum(0.98 * np.clip(1.0 - yc**2.4, 0, 1) ** 0.62 * (0.92 + 0.08 * tg.smoothstep(0, 0.4, yc)), 1e-4)
    rel = np.abs(x) / w
    p = base + (0.008 * cross**0.5 + 0.004 * tg.smoothstep(0.75, 1.0, yc)) * ins
    p += 0.0022 * np.exp(-(((rel - 0.86) / 0.05) ** 2)) * ins
    p -= 0.0022 * np.exp(-(((rel - 0.72) / 0.045) ** 2)) * ins * tg.smoothstep(0.05, 0.2, yc)
    p -= 0.0016 * np.exp(-(((rel - 0.5) / 0.045) ** 2)) * ins * tg.smoothstep(0.15, 0.3, yc) * (1 - tg.smoothstep(0.7, 0.85, yc))
    xb = wrap_delta(u, period) / (period * 0.5)
    ins2, cross2 = petal(xb, (y - 0.36) / 0.62, 0.7, 2.4, 0.62, 0.9)
    back = base + 0.0035 * cross2 * ins2 - 0.002
    h = np.where(ins > 0.02, p, np.maximum(back, base - 0.006 * tg.smoothstep(0.02, 0.12, y) * (1 - tg.smoothstep(0.9, 1.0, y))))
    sid, jd = _stones_along(u % length, length, list(joints), rng)
    h = cut_joint(h, jd, 0.003, 0.005, 0.02)
    return BandResult(h.astype(F), sid, ins.astype(F), jd)


def dentil(u: np.ndarray, v: np.ndarray, length: float, height: float, period: float, rng: np.random.Generator,
           joints: tuple[float, ...] = (0.75, 1.75)) -> BandResult:
    """Dentil course over a torus roll, with a top fillet."""
    k = height / 0.12
    roll = dome(np.abs(v - 0.0175 * k), 0.0175 * k, 0.013) - 0.004
    fil = np.where((v > 0.038 * k) & (v < 0.05 * k), 0.002, -0.006)
    x = wrap_delta(u, period)
    cy = 0.08 * k
    inside = rounded_rect_inside(x, v - cy, period * 0.3, 0.028 * k, 0.004)
    dent = np.where(inside > 0, 0.004 + 0.016 * tg.smoothstep(0.0, 0.004, inside), -1e3)
    top = np.where(v > 0.112 * k, 0.004, -1e3)
    h = np.maximum(np.maximum(roll, fil), np.maximum(dent, top))
    sid, jd = _stones_along(u % length, length, list(joints), rng)
    h = cut_joint(h, jd, 0.003, 0.005, 0.02)
    return BandResult(h.astype(F), sid, (inside > 0).astype(F), jd)


def _spiral(dx: np.ndarray, dy: np.ndarray, r0: float, r1: float, turns: float, chirality: float, start: float = 0.0):
    """Distance to an Archimedean spiral arm from r0 (centre) to r1 (outer end) and arm parameter 0..1.
    The arm starts at angle `start` (radians) at the centre and winds `turns` times."""
    r = np.hypot(dx, dy)
    th = ((np.arctan2(dy, dx) - start) * chirality) % (2 * np.pi)
    total = turns * 2 * np.pi
    b = (r1 - r0) / total
    best = np.full_like(r, 9.0)
    tpar = np.zeros_like(r)
    for k in range(int(np.ceil(turns)) + 1):
        ang = th + 2 * np.pi * k
        ok = ang <= total
        arm = r0 + b * ang
        d = np.abs(r - arm)
        upd = ok & (d < best)
        best = np.where(upd, d, best)
        tpar = np.where(upd, ang / total, tpar)
    return best.astype(F), tpar.astype(F)


def leaf(dx: np.ndarray, dy: np.ndarray, angle: float, length: float, width: float, field: float,
         height: float = 0.011, veins: int = 5) -> np.ndarray:
    """Pointed leaf from (0,0) along `angle` with midrib groove and side veins. -1e3 outside."""
    ca, sa = np.cos(angle), np.sin(angle)
    px = (dx * ca + dy * sa) / length
    py = (-dx * sa + dy * ca) / width
    m, c = petal(py, px, 0.95, 1.6, 0.9, 0.25)
    h = field + (0.003 + height * c**0.6) * m
    h -= 0.0016 * np.exp(-((py / 0.08) ** 2)) * m
    h -= 0.0009 * np.clip(np.sin((px * veins + np.abs(py) * 1.6) * np.pi * 2), 0, 1) ** 4 * m * (np.abs(py) > 0.12)
    return np.where(m > 0.01, h, -1e3).astype(F)


def vine_scroll(u: np.ndarray, v: np.ndarray, length: float, height: float, period: float, rng: np.random.Generator,
                joints: tuple[float, ...] = (0.125, 1.125)) -> BandResult:
    """Patra-lata creeper: undulating stem; each hollow holds a spiral tendril ending in a rosette bud,
    flanked by veined leaves. Framed by fillets with incised grooves."""
    s = height / 0.24
    field = -0.011
    h = np.full_like(u, field)
    bw = 0.017 * s
    border = (v < bw) | (v > height - bw)
    h = np.where(border, 0.003, h)
    groove = (np.abs(v - bw * 0.55) < 0.0022 * s) | (np.abs(v - (height - bw * 0.55)) < 0.0022 * s)
    h = np.where(groove, -0.003, h)
    mid = height * 0.5
    amp = 0.052 * s
    w = 2 * np.pi / period
    vs = mid + amp * np.sin(w * u)
    slope = amp * w * np.cos(w * u)
    d = np.abs(v - vs) / np.sqrt(1.0 + slope**2)
    stem = field + dome(d, 0.0085 * s, 0.023)
    h = np.maximum(h, stem)
    carve = (d < 0.0085 * s).astype(F)
    inner = (v > bw) & (v < height - bw)
    for uc, chir in ((0.25, 1.0), (0.75, -1.0)):
        cu = uc * period
        cvv = mid - 0.024 * s * chir
        dx = wrap_delta(u - cu, period)
        dy = v - cvv
        start = 0.5 * np.pi * chir
        # the outer end of the spiral meets the stem tangentially at the crest / trough
        dist, t = _spiral(dx, dy, 0.02 * s, 0.064 * s, 1.35, chir, start=-np.pi * 0.2 * chir)
        width = (0.0035 + 0.0065 * t) * s
        rr = np.hypot(dx, dy)
        arm = np.where(rr < 0.072 * s, field + dome(dist, width, 0.022), -1e3)
        h = np.maximum(h, arm)
        carve = np.maximum(carve, (dist < width).astype(F) * (rr < 0.072 * s))
        # rosette bud at the spiral eye
        th = np.arctan2(dy, dx)
        ros = petal_ring(rr, th, 6, 0.004 * s, 0.021 * s, field, field + 0.017, width=0.95, base=0.4, outline=0.0)
        h = np.maximum(h, ros)
        h = np.maximum(h, field + dome(rr, 0.0055 * s, 0.021))
        # leaves sprouting from the stem into the corners of the hollow
        for du, spread in ((-0.082, -1.0), (0.082, 1.0)):
            ub = cu + du * s
            vb = mid + amp * np.sin(w * ub)
            ang = (-0.5 * np.pi + 0.42 * spread) * chir
            ex = wrap_delta(u - ub, period)
            ey = v - vb
            h = np.maximum(h, np.where(inner, leaf(ex, ey, ang, 0.062 * s, 0.021 * s, field, 0.013, veins=6), -1e3))
    h = np.where(inner, h, np.where(border, 0.003, h))
    sid, jd = _stones_along(u % length, length, list(joints), rng)
    h = cut_joint(h, jd, 0.003, 0.005, 0.02)
    return BandResult(h.astype(F), sid, carve, jd)


# ----------------------------------------------------------------------------------- sheet layout
@dataclass
class Band:
    name: str
    v0: float  # meters from the BOTTOM of the sheet
    v1: float
    fn: Callable[..., BandResult]
    kwargs: dict = field(default_factory=dict)


@dataclass
class Sheet:
    height: np.ndarray
    stone: np.ndarray
    carve: np.ndarray
    joint: np.ndarray
    band: np.ndarray  # band index per texel
    tool: np.ndarray  # pitched/tooled centre fields of plain blocks
    size_m: tuple[float, float]
    bands: list[Band]

    def trims(self) -> list[dict]:
        """Trim regions in UV space (v up, 0..1) for modelers / manifest."""
        W, H = self.size_m
        return [
            {"name": b.name, "v0": round(b.v0 / H, 6), "v1": round(b.v1 / H, 6), "heightMeters": round(b.v1 - b.v0, 4)}
            for b in self.bands
        ]


def compose_sheet(w: int, h: int, size_m: tuple[float, float], bands: list[Band], rng: np.random.Generator) -> Sheet:
    """Evaluate each band on its own rows and stitch the sheet (top-down arrays)."""
    W, H = size_m
    u_all, v_all = tg.coords(h, w, W, H)
    out_h = np.zeros((h, w), F)
    out_s = np.zeros((h, w), F)
    out_c = np.zeros((h, w), F)
    out_j = np.full((h, w), 9.0, F)
    out_b = np.zeros((h, w), F)
    out_t = np.zeros((h, w), F)
    for i, b in enumerate(bands):
        rows = np.where((v_all[:, 0] >= b.v0) & (v_all[:, 0] < b.v1))[0]
        if rows.size == 0:
            continue
        u = u_all[rows]
        v = v_all[rows] - b.v0
        res = b.fn(u, v, W, b.v1 - b.v0, rng=rng, **b.kwargs)
        # band seams are stone joints too
        dv = np.minimum(v, (b.v1 - b.v0) - v)
        out_h[rows] = cut_joint(res.height, dv, 0.003, 0.005, 0.018)
        out_s[rows] = (res.stone + i * 0.381966) % 1.0
        out_c[rows] = res.carve
        out_j[rows] = np.minimum(res.joint, dv)
        out_b[rows] = i
        if res.tool is not None:
            out_t[rows] = res.tool
    return Sheet(out_h, out_s, out_c, out_j, out_b, out_t, size_m, bands)


__all__ = [
    "Band",
    "BandResult",
    "Sheet",
    "arris_profile",
    "cut_joint",
    "ashlar",
    "bead_reel",
    "compose_sheet",
    "dentil",
    "dome",
    "leaf",
    "lotus_medallion",
    "medallion_frieze",
    "padma",
    "petal",
    "petal_ring",
    "rounded_rect_inside",
    "smax",
    "vine_scroll",
    "wrap_delta",
]
