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
    # single motifs usable as decals: (name, u_m, v_m, radius_m) in band-local meters
    decals: list | None = None


def _stones_along(u: np.ndarray, length: float, cuts: list[float], rng: np.random.Generator, extent: bool = False):
    """Stone random id and distance to the nearest vertical joint for joints at `cuts` (periodic).
    extent=True also returns the signed position relative to the block centre, normalized to [-1, 1]."""
    cuts_arr = np.sort(np.array(cuts, F) % length)
    ext = np.concatenate([cuts_arr - length, cuts_arr, cuts_arr + length])
    idx = np.searchsorted(ext, u, side="right") - 1
    left = ext[idx]
    right = ext[np.minimum(idx + 1, len(ext) - 1)]
    dist = np.minimum(u - left, right - u)
    sid = idx % len(cuts_arr)
    ids = rng.uniform(0.0, 1.0, len(cuts_arr)).astype(F)
    if extent:
        rel = ((u - left) / np.maximum(right - left, 1e-6)) * 2.0 - 1.0
        return ids[sid], dist.astype(F), rel.astype(F)
    return ids[sid], dist.astype(F)


def ashlar(
    u: np.ndarray, v: np.ndarray, length: float, height: float, courses: int, rng: np.random.Generator,
    min_len: float = 0.45, max_len: float = 0.95, gap: float = 0.004, arris: float = 0.012,
    joint_depth: float = 0.012, pillow: float = 0.003, tooling: float = 0.0006, margin: float = 0.03,
    tilt_amp: float = 0.0022,
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
        sid, dx, relu = _stones_along(uu, length, cuts, rng, extent=True)
        dy = np.minimum(vv, ch - vv)
        relv = vv / ch * 2.0 - 1.0
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
        # every block is set slightly out of plane (tilt + twist): breaks up the wall in raking light
        ta = ((sid * 7.31) % 1.0 - 0.5) * 2.0
        tb = ((sid * 3.17 + 0.37) % 1.0 - 0.5) * 2.0
        tilt = (ta * relu * 0.6 + tb * relv * 0.45 + 0.35 * ta * tb * relu * relv) * tilt_amp
        H[sel] = prof + pil + strokes - 0.0007 * field_mask + tilt * tg.smoothstep(gap, gap + arris * 2, d)
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
    decals = [("lotus_medallion", pw * (k + 0.5), cv, R) for k in range(int(round(length / pw)))]
    return BandResult(h.astype(F), sid, carve, jd, decals=decals)


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


class Canvas:
    """Windowed stamping onto a regular band grid (u right, v up, meters), periodic in u.

    Stroke and shape primitives only evaluate the pixels inside their bounding box, so hundreds of
    segments cost milliseconds. Heights composite with max() (carving raised from the field)."""

    def __init__(self, u: np.ndarray, v: np.ndarray, length: float, field: float) -> None:
        self.u, self.v = u, v
        self.length = length
        self.texel = float(u[0, 1] - u[0, 0]) if u.shape[1] > 1 else 1.0
        self.u0 = float(u[0, 0])
        self.v0 = float(v[0, 0])  # top row (largest v)
        self.h = np.full(u.shape, field, F)
        self.mask = np.zeros(u.shape, F)
        self.field = field

    def _windows(self, umin: float, umax: float, vmin: float, vmax: float):
        t = self.texel
        r0 = int(np.floor((self.v0 - vmax) / t)) - 1
        r1 = int(np.ceil((self.v0 - vmin) / t)) + 2
        r0, r1 = max(0, r0), min(self.u.shape[0], r1)
        if r0 >= r1:
            return
        for off in (-self.length, 0.0, self.length):
            c0 = int(np.floor((umin + off - self.u0) / t)) - 1
            c1 = int(np.ceil((umax + off - self.u0) / t)) + 2
            c0, c1 = max(0, c0), min(self.u.shape[1], c1)
            if c0 < c1:
                yield (slice(r0, r1), slice(c0, c1)), off

    def stroke(self, pts: np.ndarray, widths: np.ndarray, heights: np.ndarray, groove: float = 0.0) -> None:
        """Round-profile tube along a polyline. widths = half-widths per point, heights above field.
        groove > 0 cuts a shallow incised line along the stroke centre (carved stems). The distance field
        of the whole polyline is resolved first (min over segments), so joints are seamless."""
        pts = np.asarray(pts, F)
        widths = np.asarray(widths, F)
        heights = np.asarray(heights, F)
        rel_buf = np.full(self.u.shape, np.inf, F)
        hh_buf = np.zeros(self.u.shape, F)
        touched = np.zeros(self.u.shape, bool)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            wmax = float(max(widths[i], widths[i + 1]))
            for (rs, cs), off in self._windows(min(a[0], b[0]) - wmax, max(a[0], b[0]) + wmax,
                                               min(a[1], b[1]) - wmax, max(a[1], b[1]) + wmax):
                qu = self.u[rs, cs] - off
                qv = self.v[rs, cs]
                ab = b - a
                L2 = float(ab @ ab) or 1e-12
                t = np.clip(((qu - a[0]) * ab[0] + (qv - a[1]) * ab[1]) / L2, 0.0, 1.0)
                d = np.hypot(qu - (a[0] + t * ab[0]), qv - (a[1] + t * ab[1]))
                w = widths[i] + (widths[i + 1] - widths[i]) * t
                rel = d / np.maximum(w, 1e-6)
                better = rel < rel_buf[rs, cs]
                rel_buf[rs, cs] = np.where(better, rel, rel_buf[rs, cs])
                hh_buf[rs, cs] = np.where(better, heights[i] + (heights[i + 1] - heights[i]) * t, hh_buf[rs, cs])
                touched[rs, cs] = True
        rows = np.where(touched.any(axis=1))[0]
        cols = np.where(touched.any(axis=0))[0]
        if not len(rows):
            return
        rs, cs = slice(rows[0], rows[-1] + 1), slice(cols[0], cols[-1] + 1)
        rel = rel_buf[rs, cs]
        prof = np.sqrt(np.clip(1.0 - rel * rel, 0.0, 1.0)) ** 0.8
        if groove > 0:
            prof = prof - groove * np.exp(-((rel / 0.16) ** 2))
        inside = rel < 1.0
        val = np.where(inside, self.field + hh_buf[rs, cs] * prof, -1e3)
        self.h[rs, cs] = np.maximum(self.h[rs, cs], val)
        self.mask[rs, cs] = np.maximum(self.mask[rs, cs], inside.astype(F))

    def shape(self, cx: float, cy: float, radius: float, fn) -> None:
        """Stamp fn(dx, dy) -> height (absolute, -1e3 outside) inside a square window around (cx, cy)."""
        for (rs, cs), off in self._windows(cx - radius, cx + radius, cy - radius, cy + radius):
            dx = self.u[rs, cs] - off - cx
            dy = self.v[rs, cs] - cy
            val = fn(dx, dy)
            self.h[rs, cs] = np.maximum(self.h[rs, cs], val)
            self.mask[rs, cs] = np.maximum(self.mask[rs, cs], (val > self.field + 1e-5).astype(F))


def log_spiral(center: tuple[float, float], start: tuple[float, float], turns: float, r_end: float,
               clockwise: bool, n: int = 120) -> np.ndarray:
    """Points of a logarithmic spiral from `start` (outer end) winding `turns` times into radius r_end."""
    cx, cy = center
    r0 = float(np.hypot(start[0] - cx, start[1] - cy))
    phi0 = float(np.arctan2(start[1] - cy, start[0] - cx))
    total = turns * 2 * np.pi
    k = np.log(max(r0, 1e-6) / max(r_end, 1e-6)) / total
    th = np.linspace(0.0, total, n)
    r = r0 * np.exp(-k * th)
    ang = phi0 - th if clockwise else phi0 + th
    return np.stack([cx + r * np.cos(ang), cy + r * np.sin(ang)], axis=1).astype(F)


def leaf(dx: np.ndarray, dy: np.ndarray, angle: float, length: float, width: float, field: float,
         height: float = 0.011, veins: int = 5, bend: float = 0.0, lobes: int = 0) -> np.ndarray:
    """Pointed leaf from (0,0) along `angle` with midrib groove, side veins, optional bend (curl of the
    tip, +-1) and serrated lobes. Returns absolute height, -1e3 outside."""
    ca, sa = np.cos(angle), np.sin(angle)
    px = (dx * ca + dy * sa) / length
    py = (-dx * sa + dy * ca) / width
    py = py - bend * 1.6 * px * px
    if lobes:
        py = py * (1.0 + 0.18 * np.abs(np.sin(px * np.pi * lobes)))
    m, c = petal(py, px, 0.95, 1.6, 0.9, 0.25)
    h = field + (0.003 + height * c**0.6 * (0.7 + 0.3 * np.sin(np.clip(px, 0, 1) * np.pi))) * m
    h -= 0.0016 * np.exp(-((py / 0.08) ** 2)) * m * tg.smoothstep(0.05, 0.2, px)
    h -= 0.0009 * np.clip(np.sin((px * veins + np.abs(py) * 1.6) * np.pi * 2), 0, 1) ** 4 * m * (np.abs(py) > 0.12)
    return np.where(m > 0.01, h, -1e3).astype(F)


def rosette(dx: np.ndarray, dy: np.ndarray, R: float, field: float, petals: int = 10, height: float = 0.016
            ) -> np.ndarray:
    """Round open flower (8-12 petals) with a domed, dotted centre boss. -1e3 outside."""
    r = np.hypot(dx, dy)
    th = np.arctan2(dy, dx)
    h = petal_ring(r, th, petals, 0.32 * R, R, field + 0.002, field + height, width=1.0, base=0.55,
                   p=1.4, q=0.6, outline=0.0012, curl=0.15)
    h = np.maximum(h, petal_ring(r, th, petals, 0.28 * R, 0.72 * R, field + 0.004, field + height * 1.05,
                                 phase=np.pi / petals, width=0.9, base=0.5, p=1.4, q=0.6, outline=0.0))
    boss = field + height * 0.85 + dome(r, 0.34 * R, height * 0.45, 0.7)
    boss -= 0.0012 * (np.cos(th * 12) > 0.6) * tg.smoothstep(0.15 * R, 0.25 * R, r)
    h = np.where(r < 0.34 * R, np.maximum(h, boss), h)
    return np.where(r < R, h, -1e3).astype(F)


def vine_scroll(u: np.ndarray, v: np.ndarray, length: float, height: float, period: float, rng: np.random.Generator,
                joints: tuple[float, ...] = (0.125, 1.125)) -> BandResult:
    """Patra-lata running scroll (Sanchi / Bharhut coping style): an undulating, grooved main stem; in
    every hollow a tendril leaves the stem tangentially and curls into a log spiral ending in an open
    rosette; lush curled leaves fill the spaces (horror vacui). Framed by grooved fillets."""
    s = height / 0.24
    field = -0.011
    cv = Canvas(u, v, length, field)
    bw = 0.017 * s
    h = cv.h
    border = (v < bw) | (v > height - bw)
    groove = (np.abs(v - bw * 0.55) < 0.0022 * s) | (np.abs(v - (height - bw * 0.55)) < 0.0022 * s)
    mid = height * 0.5
    A = 0.048 * s
    w = 2 * np.pi / period
    n_per = 96
    # main stem: one polyline per period copy (Canvas wraps periodically)
    us = np.linspace(0.0, length, int(n_per * length / period) + 1, dtype=F)
    stem = np.stack([us, mid + A * np.sin(w * us)], axis=1)
    cv.stroke(stem, np.full(len(us), 0.0072 * s), np.full(len(us), 0.021), groove=0.22)
    nper = int(round(length / period))
    decals: list = []

    def stem_pt(uu: float) -> tuple[float, float]:
        return (uu, mid + A * np.sin(w * uu))

    def put_leaf(q, ang, L, W, bend, lobes=3, hgt=0.013):
        cv.shape(float(q[0]), float(q[1]), L * 1.05,
                 lambda dx, dy: leaf(dx, dy, ang, L, W, field, hgt, 6, bend, lobes))

    for k in range(nper):
        base_u = k * period
        for crest in (True, False):
            uc = base_u + (0.25 if crest else 0.75) * period
            sgn = -1.0 if crest else 1.0  # hollow below the crest, above the trough
            us0 = uc + 0.07 * s
            p0 = stem_pt(us0)
            slope = A * w * np.cos(w * us0)
            t = np.array([1.0, slope], F)
            t /= np.linalg.norm(t)
            r0 = 0.05 * s
            # tangent-continuous branch: clockwise at crests, counter-clockwise at troughs
            if crest:
                phi0 = np.arctan2(t[0], -t[1])
            else:
                phi0 = np.arctan2(-t[0], t[1])
            centre = (p0[0] - r0 * np.cos(phi0), p0[1] - r0 * np.sin(phi0))
            sp = log_spiral(centre, p0, 1.2, 0.021 * s, clockwise=crest, n=150)
            tpar = np.linspace(0, 1, len(sp))
            cv.stroke(sp, (0.0064 - 0.0024 * tpar) * s, 0.020 - 0.003 * tpar, groove=0.18)
            R = 0.02 * s
            cv.shape(centre[0], centre[1], R * 1.05, lambda dx, dy, R=R: rosette(dx, dy, R, field, 10, 0.018))
            decals.append(("spiral_rosette", float(centre[0] % length), float(centre[1]), float(r0 * 1.15)))
            # lush leaves curling around the outside of the spiral
            for tt, ln, wd, bend in ((0.16, 0.085, 0.30, 0.55), (0.40, 0.07, 0.30, 0.5), (0.62, 0.05, 0.32, 0.45)):
                i = int(tt * (len(sp) - 1))
                q = sp[i]
                tan = sp[min(i + 2, len(sp) - 1)] - sp[max(i - 2, 0)]
                nrm = np.array([q[0] - centre[0], q[1] - centre[1]], F)
                nrm /= np.linalg.norm(nrm) + 1e-9
                tan /= np.linalg.norm(tan) + 1e-9
                d = nrm * 0.55 + tan * 0.85
                put_leaf(q, float(np.arctan2(d[1], d[0])), ln * s, ln * wd * s, bend if crest else -bend, 4)
            # leaf pair on the main stem before the crest/trough, reaching into the opposite hollow
            ul = uc - 0.06 * s
            q = stem_pt(ul)
            put_leaf(q, float(np.arctan2(-sgn * 0.95, -0.3)), 0.075 * s, 0.026 * s, 0.5 * sgn, 4, 0.014)
            put_leaf(q, float(np.arctan2(-sgn * 0.6, 0.8)), 0.055 * s, 0.02 * s, -0.4 * sgn, 3, 0.012)
            # lotus bud on a curved stalk rising from the stem between the spirals
            ub = uc + 0.17 * period
            vb = stem_pt(ub)[1]
            stalk = np.array([[ub, vb], [ub + 0.006 * s, vb - sgn * 0.022 * s], [ub - 0.004 * s, vb - sgn * 0.042 * s]], F)
            cv.stroke(stalk, np.array([0.004, 0.0034, 0.003]) * s, np.array([0.017, 0.016, 0.015]))
            bx, by = float(stalk[-1, 0]), float(stalk[-1, 1] - sgn * 0.012 * s)

            def bud(dx, dy, sg=sgn):
                yy = -sg * dy / (0.026 * s) + 0.5
                m, c = petal(dx / (0.013 * s), yy, 0.95, 1.5, 0.75, 0.75)
                hb = field + (0.004 + 0.016 * c**0.5) * m
                hb -= 0.0014 * np.exp(-(((np.abs(dx) / (0.013 * s)) - 0.45) / 0.08) ** 2) * m * (yy < 0.75)
                return np.where(m > 0.02, hb, -1e3)

            cv.shape(bx, by, 0.03 * s, bud)
    inner = (v > bw) & (v < height - bw)
    h = np.where(inner, cv.h, np.where(groove, -0.003, 0.003))
    carve = cv.mask * inner
    sid, jd = _stones_along(u % length, length, list(joints), rng)
    h = cut_joint(h, jd, 0.003, 0.005, 0.02)
    return BandResult(h.astype(F), sid, carve.astype(F), jd, decals=decals)


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
    decal_list: list = field(default_factory=list)  # (name, u_m, v_m sheet, r_m)

    def decals(self) -> list[dict]:
        """Decal regions in sheet UV space (u right, v up): centre + radii, for single-motif mapping."""
        W, H = self.size_m
        return [
            {"name": n, "u": round(u / W, 6), "v": round(v / H, 6), "r": round(r / W, 6), "r_v": round(r / H, 6)}
            for n, u, v, r in self.decal_list
        ]

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
    decal_list: list = []
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
        for name, du, dv, dr in res.decals or []:
            decal_list.append((name, du % W, b.v0 + dv, dr))
    return Sheet(out_h, out_s, out_c, out_j, out_b, out_t, size_m, bands, decal_list)


__all__ = [
    "Band",
    "Canvas",
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
    "log_spiral",
    "lotus_medallion",
    "medallion_frieze",
    "padma",
    "petal",
    "petal_ring",
    "rosette",
    "rounded_rect_inside",
    "smax",
    "vine_scroll",
    "wrap_delta",
]
