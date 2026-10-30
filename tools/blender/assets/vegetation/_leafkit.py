"""
WP4 card painter (package-local helper, not an asset): procedural leaves, sprays, compound leaves, flowers, fronds,
grass blades and stalks rasterized in numpy into atlas regions. OWNER: Technical Artist D (TA-04).

No scans, no downloaded textures: every leaf is an analytic outline (Bible §14: peepal heart + drip tip, mango
lanceolate, neem pinnate ...) evaluated per pixel with analytic anti-aliasing, a vein network, a folded / bent blade
surface (-> tangent-space normal), translucency from blade thickness and painter's-order ambient occlusion.

    cv = Canvas(px_w, px_h, size_m=(w, h), ss=2)          # one atlas region (card), metres, y up, origin bottom-left
    cv.stroke((x0, y0), (x1, y1), r0, r1, color)          # twig / petiole / rachis (tapered capsule)
    cv.leaf(base, angle, length, outline=PEEPAL, ...)      # one blade
    cv.blossom(...), cv.ball(...), cv.panicle(...), cv.raceme(...)
    maps = cv.resolve()                                    # downsampled color/alpha/normal/orm at px_w x px_h

Conventions (match lib/texgen): arrays TOP-DOWN (row 0 = top = v 1), colours LINEAR rgb, normals tangent space
OpenGL (+X = +U right, +Y = +V up). Card space: x right, y up, origin at the bottom-left of the region; cards attach
to the branch at the BOTTOM edge centre (v = 0) so the wind flutter mask grows towards v = 1.

ORM for foliage (ART_BIBLE §7.2 / §14): R = ambient occlusion inside the spray, G = roughness, B = translucency
(1 = thin blade lets light through, 0 = opaque twig); the runtime uses ORM.b x the species translucency (0.35).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Sequence

import numpy as np

from lib import texgen as tg

F = np.float32


# ----------------------------------------------------------------------------------------------- outlines
def outline(points: Sequence[tuple[float, float]], samples: int = 256) -> np.ndarray:
    """Leaf half-width profile from control points (s along the midrib 0..1, half width as a fraction of the
    length), smoothed with a Catmull-Rom spline. Returns (samples, 2) [s, w] for np.interp."""
    p = np.asarray(points, np.float64)
    pp = np.vstack([p[0] * 2 - p[1], p, p[-1] * 2 - p[-2]])
    out = []
    for i in range(1, len(pp) - 2):
        p0, p1, p2, p3 = pp[i - 1], pp[i], pp[i + 1], pp[i + 2]
        n = max(2, samples // (len(p) - 1))
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(p[-1])
    a = np.array(out)
    a[:, 1] = np.maximum(a[:, 1], 0.0)
    order = np.argsort(a[:, 0], kind="stable")
    return a[order]


# Species outlines (s from the petiole junction 0 to the tip 1; negative s = basal lobes beyond the junction).
PEEPAL = outline([(-0.07, 0.0), (-0.065, 0.10), (-0.04, 0.22), (0.02, 0.36), (0.12, 0.45), (0.25, 0.47), (0.38, 0.42),
                  (0.50, 0.31), (0.60, 0.18), (0.68, 0.085), (0.76, 0.045), (0.88, 0.022), (1.0, 0.0)])
BANYAN = outline([(-0.01, 0.0), (0.03, 0.17), (0.15, 0.29), (0.35, 0.335), (0.58, 0.32), (0.78, 0.25), (0.92, 0.13),
                  (0.985, 0.04), (1.0, 0.0)])
MANGO = outline([(0.0, 0.0), (0.05, 0.05), (0.18, 0.105), (0.40, 0.13), (0.62, 0.115), (0.82, 0.07), (0.94, 0.03), (1.0, 0.0)])
NEEM_LEAFLET = outline([(0.0, 0.0), (0.06, 0.08), (0.25, 0.15), (0.50, 0.14), (0.75, 0.09), (0.92, 0.035), (1.0, 0.0)])
SAL = outline([(-0.03, 0.0), (-0.02, 0.10), (0.06, 0.24), (0.22, 0.31), (0.45, 0.315), (0.70, 0.25), (0.88, 0.13),
               (0.97, 0.04), (1.0, 0.0)])
TEAK = outline([(0.0, 0.0), (0.06, 0.16), (0.22, 0.33), (0.48, 0.40), (0.72, 0.36), (0.88, 0.25), (0.97, 0.10), (1.0, 0.0)])
PALASH_LEAFLET = outline([(0.0, 0.0), (0.08, 0.14), (0.30, 0.31), (0.58, 0.42), (0.80, 0.40), (0.93, 0.26), (0.99, 0.08), (1.0, 0.0)])
AMALTAS_LEAFLET = outline([(0.0, 0.0), (0.07, 0.17), (0.30, 0.29), (0.60, 0.27), (0.85, 0.17), (0.97, 0.06), (1.0, 0.0)])
BABUL_PINNULE = outline([(0.0, 0.0), (0.15, 0.20), (0.5, 0.24), (0.85, 0.18), (1.0, 0.0)])
BAMBOO = outline([(0.0, 0.0), (0.03, 0.035), (0.15, 0.075), (0.45, 0.08), (0.75, 0.055), (0.92, 0.022), (1.0, 0.0)])
BER = outline([(0.0, 0.0), (0.06, 0.2), (0.3, 0.36), (0.6, 0.35), (0.85, 0.24), (0.98, 0.08), (1.0, 0.0)])
AAK = outline([(0.0, 0.0), (0.04, 0.10), (0.25, 0.26), (0.55, 0.38), (0.80, 0.36), (0.95, 0.22), (1.0, 0.0)])
GENERIC = outline([(0.0, 0.0), (0.06, 0.13), (0.3, 0.24), (0.6, 0.23), (0.86, 0.13), (1.0, 0.0)])
GRASS = outline([(0.0, 0.0), (0.02, 0.5), (0.5, 0.45), (0.85, 0.28), (1.0, 0.0)])  # width relative, see blade()
LOTUS_PETAL = outline([(0.0, 0.0), (0.12, 0.22), (0.45, 0.36), (0.75, 0.30), (0.93, 0.16), (1.0, 0.0)])


@dataclass
class Venation:
    """Pinnate vein network in leaf space: secondaries leave the midrib every `spacing` (fraction of the length)
    at `angle` deg towards the tip and arch towards the margin."""
    spacing: float = 0.085
    angle: float = 50.0
    width: float = 0.006
    midrib: float = 0.012
    strength: float = 1.0
    palmate_base: int = 0  # extra veins fanning from the base (peepal / sal / teak)


@dataclass
class LeafLook:
    color: np.ndarray            # linear rgb mean of the blade
    vein_light: float = 0.18     # veins lighter than the blade (front)
    margin_light: float = 0.05
    value_jitter: float = 0.10
    hue_jitter: float = 0.03
    yellow_tips: float = 0.0     # fraction of leaves with a yellowed tip
    spots: float = 0.0           # brown spot density
    holes: float = 0.0           # insect holes (alpha) density
    rough: float = 0.55
    transl: float = 0.85
    fold: float = 0.06           # V fold along the midrib (height per unit half width, x length)
    bulge: float = 0.0035        # blade bulging between veins (m x length)
    gloss_veins: float = 0.0
    underside: bool = False      # lighter, greyer, veins raised (back of the leaf)


# ----------------------------------------------------------------------------------------------- canvas
def _box_blur(img: np.ndarray, k: int) -> np.ndarray:
    """Separable box blur (radius k, zero padded, two passes ~ Gaussian) of a 2-D window."""
    out = img.astype(F)
    for _ in range(2):
        for axis in (0, 1):
            pad = [(0, 0), (0, 0)]
            pad[axis] = (k + 1, k)
            c = np.cumsum(np.pad(out, pad), axis=axis, dtype=np.float64)
            if axis == 0:
                out = ((c[2 * k + 1:, :] - c[:-2 * k - 1, :]) / (2 * k + 1)).astype(F)
            else:
                out = ((c[:, 2 * k + 1:] - c[:, :-2 * k - 1]) / (2 * k + 1)).astype(F)
    return out


class Canvas:
    """Supersampled painter's-order canvas for one atlas region. Coordinates in metres of the card (x right,
    y up, origin bottom-left), pixels TOP-DOWN."""

    def __init__(self, px_w: int, px_h: int, size_m: tuple[float, float], ss: int = 2, seed: int = 0,
                 margin: float = 0.03) -> None:
        self.W, self.H = px_w * ss, px_h * ss
        self.px_w, self.px_h, self.ss = px_w, px_h, ss
        self.size = size_m
        self.mpp = size_m[0] / self.W  # metres per (supersampled) pixel
        if abs(size_m[1] / self.H - self.mpp) > 1e-6 * max(1.0, self.mpp):
            raise ValueError(f"Canvas: region {px_w}x{px_h} px must match the card aspect {size_m}")
        self.rng = np.random.default_rng(seed)
        self.margin = margin  # fraction of the region kept transparent at the border (mip bleeding)
        H, W = self.H, self.W
        self.rgb = np.zeros((H, W, 3), F)
        self.a = np.zeros((H, W), F)
        self.n = np.zeros((H, W, 3), F)
        self.n[..., 2] = 1.0
        self.rough = np.full((H, W), 0.6, F)
        self.transl = np.zeros((H, W), F)
        self.z = np.zeros((H, W), F)      # stacking height (m) for the spray AO
        self.occ = np.ones((H, W), F)     # contact occlusion cast by upper layers onto lower ones
        self.occ_sigma_m = 0.012 * max(size_m)
        self.occ_strength = 0.55
        self.layer = 0

    # ---------------------------------------------------------------- coordinates
    def _bbox(self, xmin: float, ymin: float, xmax: float, ymax: float):
        """Pixel window (rows top-down) covering a metric box, clipped to the canvas minus the margin."""
        m = self.margin
        x0 = max(int(math.floor(xmin / self.mpp)) - 1, int(m * self.W))
        x1 = min(int(math.ceil(xmax / self.mpp)) + 2, int(math.ceil((1 - m) * self.W)))
        r0 = max(int(math.floor((self.size[1] - ymax) / self.mpp)) - 1, int(m * self.H))
        r1 = min(int(math.ceil((self.size[1] - ymin) / self.mpp)) + 2, int(math.ceil((1 - m) * self.H)))
        if x1 <= x0 or r1 <= r0:
            return None
        xs = (np.arange(x0, x1, dtype=F) + 0.5) * self.mpp
        ys = self.size[1] - (np.arange(r0, r1, dtype=F) + 0.5) * self.mpp
        X, Y = np.meshgrid(xs, ys)
        return (slice(r0, r1), slice(x0, x1)), X, Y

    def _composite(self, win, cov, rgb, nrm, rough, transl, zlocal) -> None:
        """'Over' composite of one primitive (coverage cov in [0,1]) onto the canvas window."""
        sl = win
        c = np.clip(cov, 0.0, 1.0)[..., None]
        # contact shadow of this primitive on what lies below it (soft, offset slightly down: light from above)
        k = max(1, int(round(self.occ_sigma_m / self.mpp)))
        sh = _box_blur(np.clip(cov, 0.0, 1.0), k)
        sh = np.roll(sh, max(1, k // 2), axis=0)
        self.occ[sl] = self.occ[sl] * (1.0 - self.occ_strength * sh * (1.0 - c[..., 0]))
        self.occ[sl] = self.occ[sl] * (1.0 - c[..., 0]) + c[..., 0]
        self.rgb[sl] = self.rgb[sl] * (1 - c) + rgb * c
        self.n[sl] = self.n[sl] * (1 - c) + nrm * c
        c1 = c[..., 0]
        self.rough[sl] = self.rough[sl] * (1 - c1) + rough * c1
        self.transl[sl] = self.transl[sl] * (1 - c1) + transl * c1
        zl = self.layer * 0.004 + zlocal
        self.z[sl] = np.where(c1 > 0.5, np.maximum(self.z[sl], zl), self.z[sl])
        self.a[sl] = self.a[sl] + c1 * (1 - self.a[sl])
        self.layer += 1

    def aa(self, d: np.ndarray) -> np.ndarray:
        """Analytic anti-aliasing: signed distance (m, >0 inside) -> coverage over ~1 supersampled pixel."""
        return np.clip(d / self.mpp + 0.5, 0.0, 1.0).astype(F)

    # ---------------------------------------------------------------- primitives
    def stroke(self, p0: Sequence[float], p1: Sequence[float], r0: float, r1: float, color: np.ndarray,
               rough: float = 0.8, transl: float = 0.0, bend: float = 0.0, z: float = 0.0) -> None:
        """Tapered capsule from p0 (radius r0) to p1 (radius r1), cylinder-shaded normal across it. `bend` bows the
        axis sideways (fraction of the length) - twigs and rachises are never straight."""
        p0 = np.asarray(p0, F)
        p1 = np.asarray(p1, F)
        L = float(np.linalg.norm(p1 - p0))
        if L < 1e-6:
            return
        d = (p1 - p0) / L
        perp = np.array([-d[1], d[0]], F)
        rmax = max(r0, r1) + abs(bend) * L
        lo = np.minimum(p0, p1) - rmax
        hi = np.maximum(p0, p1) + rmax
        bb = self._bbox(lo[0], lo[1], hi[0], hi[1])
        if bb is None:
            return
        win, X, Y = bb
        dx, dy = X - p0[0], Y - p0[1]
        s = (dx * d[0] + dy * d[1]) / L
        sc = np.clip(s, 0.0, 1.0)
        t = dx * perp[0] + dy * perp[1] - bend * L * 4.0 * sc * (1 - sc)
        r = r0 + (r1 - r0) * sc
        along = np.where(s < 0, -s * L, np.where(s > 1, (s - 1) * L, 0.0))
        dist = np.sqrt(t * t + along * along)
        cov = self.aa(r - dist) * (r > 1e-5)
        u = np.clip(t / np.maximum(r, 1e-6), -1, 1)
        nz = np.sqrt(np.clip(1 - u * u, 0, 1))
        nx = u * perp[0]
        ny = u * perp[1]
        nrm = np.stack([nx, ny, nz + 0.25], axis=-1)
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
        shade = (0.88 + 0.12 * nz)[..., None]
        rgb = np.broadcast_to(np.asarray(color, F), X.shape + (3,)) * shade
        self._composite(win, cov, rgb, nrm, rough, transl, z + r * nz)

    def leaf(self, base: Sequence[float], angle: float, length: float, prof: np.ndarray, look: LeafLook,
             ven: Venation | None = None, roll: float = 0.0, droop: float = 0.0, curve: float = 0.0,
             serration: tuple[int, float] = (0, 0.0), width: float = 1.0, petiole: float = 0.0,
             petiole_color: np.ndarray | None = None, rng: np.random.Generator | None = None, z: float = 0.0,
             notch: float = 0.0) -> None:
        """One leaf blade. `angle` = direction of the midrib (rad, 0 = +x, pi/2 = up); `roll` rotates the blade
        about its midrib (foreshortened width, tilted normal); `droop` tilts it about the across axis (tip away
        from the viewer); `curve` bends the midrib sideways (falcate); `petiole` = stalk length (m) drawn first."""
        rng = rng or self.rng
        ven = ven or Venation()
        b = np.asarray(base, F)
        d = np.array([math.cos(angle), math.sin(angle)], F)
        perp = np.array([-d[1], d[0]], F)
        if petiole > 0:
            pc = petiole_color if petiole_color is not None else look.color * 0.8
            self.stroke(b, b + d * petiole, length * 0.012 + 0.0008, length * 0.009 + 0.0006, pc, rough=0.7,
                        transl=0.15, z=z)
            b = b + d * petiole
        cr = max(abs(math.cos(roll)), 0.12)
        cd = max(math.cos(droop), 0.2)
        Lp = length * cd  # projected length
        wmax = float(prof[:, 1].max()) * length * width
        smin = float(prof[0, 0])
        lo = np.minimum(b + d * Lp * smin, b + d * Lp) - wmax - abs(curve) * length - 2 * self.mpp
        hi = np.maximum(b + d * Lp * smin, b + d * Lp) + wmax + abs(curve) * length + 2 * self.mpp
        bb = self._bbox(lo[0], lo[1], hi[0], hi[1])
        if bb is None:
            return
        win, X, Y = bb
        dx, dy = X - b[0], Y - b[1]
        s = (dx * d[0] + dy * d[1]) / Lp
        sc = np.clip(s, 0, 1)
        t_proj = dx * perp[0] + dy * perp[1] - curve * length * sc * sc
        t = t_proj / cr  # un-foreshortened across coordinate (m)
        tn = t / length  # fraction of the length
        w = np.interp(s, prof[:, 0], prof[:, 1], left=0.0, right=0.0).astype(F) * width
        if serration[0] > 0:
            ph = (s * serration[0]) % 1.0
            w = w * (1.0 - serration[1] * ph * (s > 0.08) * (s < 0.97))
        # signed distance to the margin (approx., m, in the projected frame)
        inside = (w - np.abs(tn)) * length * cr
        # along-axis clamp: tip and base
        inside = np.minimum(inside, (1.0 - s) * Lp * 0.5 + 0.0 * s)
        inside = np.minimum(inside, (s - smin) * Lp + 1e-4)
        if notch > 0:  # cordate base: cut the gap between the basal lobes around the petiole
            notch_w = notch * np.clip(-s / max(-smin, 1e-4), 0, 1)
            inside = np.where(s < 0, np.minimum(inside, (np.abs(tn) - notch_w) * length * cr), inside)
        cov = self.aa(inside)
        if look.holes > 0:
            hole = self._holes(X, Y, look.holes, length, rng)
            cov = cov * (1 - hole)
        if not np.any(cov > 1e-3):
            return
        # ---- veins: midrib + pinnate secondaries arching to the margin (+ palmate basal fan)
        aw = np.abs(tn) / np.maximum(w, 1e-4)  # 0 midrib .. 1 margin
        mid = np.exp(-((tn / (ven.midrib * (1.4 - 0.9 * sc))) ** 2))
        slope = math.tan(math.radians(90 - ven.angle))
        vphase = (s - np.abs(tn) * slope * (1.0 + 0.6 * aw)) / ven.spacing
        vd = np.abs(vphase - np.round(vphase)) * ven.spacing
        sec = np.exp(-((vd / ven.width) ** 2)) * np.clip(1.1 - aw, 0, 1) * (s > 0.02)
        if ven.palmate_base > 0:
            ang = np.arctan2(np.abs(tn), np.maximum(s + 0.02, 1e-3))
            k = ven.palmate_base
            pd = np.abs(((ang / (math.pi / 2)) * (k + 0.5)) % 1.0 - 0.5)
            fan = np.exp(-((pd / 0.06) ** 2)) * np.clip(1 - s / 0.45, 0, 1) * np.clip(1 - aw, 0, 1)
            sec = np.maximum(sec, fan * 0.8)
        veins = np.clip(np.maximum(mid, sec * 0.8) * ven.strength, 0, 1)
        # ---- surface height (leaf space, m): V fold, bulging blade between veins, edge wave, tip curl
        tw = np.clip(aw, 0, 1)
        h = look.fold * np.abs(tn) * length
        h += look.bulge * length * (1 - veins) * np.sin(np.clip(tw, 0, 1) * math.pi) * 0.5
        h -= 0.012 * length * (sc ** 2) * 0.5
        wave = 0.004 * length * np.sin(s * 23.0 + float(rng.uniform(0, 6.28))) * tw ** 2
        h += wave
        if look.underside:
            h += veins * look.bulge * length * 0.6
        else:
            h -= veins * look.bulge * length * 0.35
        gy, gx = np.gradient(h, self.mpp)  # rows top-down: gy = dh/d(row) -> -dh/dy
        dhdx, dhdy = gx, -gy
        # blade tilt from roll / droop (rotate the blade plane relative to the card)
        tilt = np.array([math.sin(roll) * perp[0] + math.sin(droop) * d[0] * 0.6,
                         math.sin(roll) * perp[1] + math.sin(droop) * d[1] * 0.6], F)
        nx = -dhdx * 0.9 + tilt[0]
        ny = -dhdy * 0.9 + tilt[1]
        nrm = np.stack([nx, ny, np.ones_like(nx)], axis=-1)
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
        # ---- colour
        val = 1.0 + rng.uniform(-look.value_jitter, look.value_jitter)
        hue = rng.uniform(-look.hue_jitter, look.hue_jitter)
        base_col = np.asarray(look.color, F) * val
        base_col = base_col * np.array([1 + hue * 1.5, 1.0, 1 - hue * 2.0], F)
        if look.underside:
            lum = float(tg.luminance(base_col[None, :])[0])
            base_col = (base_col * 0.72 + lum * 0.28) * 1.22
        col = np.broadcast_to(base_col, X.shape + (3,)).copy()
        vl = look.vein_light * (1.6 if look.underside else 1.0)
        vein_col = base_col * (1 + vl) * np.array([1.08, 1.05, 0.82], F)
        col = col * (1 - veins[..., None]) + vein_col * veins[..., None]
        col *= (1 + look.margin_light * tw ** 6)[..., None]
        # blade shading variation: slightly darker toward the base, mottling
        mott = 1.0 + 0.06 * np.sin(X * 91.0 / max(length, 0.05) + Y * 57.0 / max(length, 0.05) + float(rng.uniform(0, 6)))
        col *= (mott * (0.93 + 0.07 * sc))[..., None]
        if look.yellow_tips > 0 and rng.uniform() < look.yellow_tips:
            yt = tg.smoothstep(0.65, 1.0, s)[..., None]
            col = col * (1 - 0.55 * yt) + np.array([0.33, 0.24, 0.05], F) * 0.55 * yt
        if look.spots > 0:
            sp = self._spots(X, Y, look.spots, length, rng)
            col = col * (1 - sp[..., None] * 0.8) + np.array([0.09, 0.055, 0.025], F) * sp[..., None] * 0.8
        rough = look.rough + 0.12 * veins + (0.12 if look.underside else 0.0)
        transl = look.transl * (1 - 0.55 * veins) * (1 - 0.3 * tg.smoothstep(0.85, 1.0, aw))
        self._composite(win, cov, col, nrm, rough, transl, z + h + 0.002)

    def _spots(self, X, Y, density, length, rng) -> np.ndarray:
        n = rng.poisson(density * 6)
        out = np.zeros_like(X)
        for _ in range(n):
            cx = float(rng.uniform(X.min(), X.max()))
            cy = float(rng.uniform(Y.min(), Y.max()))
            r = length * float(rng.uniform(0.01, 0.035))
            out = np.maximum(out, np.clip(1 - np.hypot(X - cx, Y - cy) / r, 0, 1) ** 0.6)
        return out

    def _holes(self, X, Y, density, length, rng) -> np.ndarray:
        n = rng.poisson(density * 3)
        out = np.zeros_like(X)
        for _ in range(n):
            cx = float(rng.uniform(X.min(), X.max()))
            cy = float(rng.uniform(Y.min(), Y.max()))
            r = length * float(rng.uniform(0.02, 0.06))
            ang = np.arctan2(Y - cy, X - cx)
            rr = r * (1 + 0.3 * np.sin(ang * 3 + float(rng.uniform(0, 6))))
            out = np.maximum(out, self.aa(rr - np.hypot(X - cx, Y - cy)))
        return out

    def disc(self, c: Sequence[float], r: float, color: np.ndarray, rough: float = 0.6, transl: float = 0.5,
             petals: int = 0, petal_depth: float = 0.35, phase: float = 0.0, center_color: np.ndarray | None = None,
             center_r: float = 0.3, dome: float = 0.4, fuzz: float = 0.0, z: float = 0.0,
             rng: np.random.Generator | None = None) -> None:
        """Flower / bud / ball: a disc (optionally `petals`-lobed, `fuzz` = filament noise on the rim) with a
        domed normal and an optional centre colour."""
        rng = rng or self.rng
        c = np.asarray(c, F)
        bb = self._bbox(c[0] - r * 1.3, c[1] - r * 1.3, c[0] + r * 1.3, c[1] + r * 1.3)
        if bb is None:
            return
        win, X, Y = bb
        dx, dy = X - c[0], Y - c[1]
        rho = np.hypot(dx, dy)
        ang = np.arctan2(dy, dx)
        rr = np.full_like(rho, r)
        if petals > 0:
            rr = r * (1 - petal_depth * (0.5 - 0.5 * np.cos(petals * (ang - phase))) ** 1.5)
        if fuzz > 0:
            f = np.zeros_like(rho)
            for k in (13, 29, 47):
                f += np.sin(ang * k + float(rng.uniform(0, 6.28))) / 3
            rr = rr * (1 + fuzz * f)
        cov = self.aa(rr - rho)
        q = np.clip(rho / np.maximum(rr, 1e-6), 0, 1)
        nz = np.sqrt(np.clip(1 - (q * dome) ** 2, 0, 1))
        nrm = np.stack([dx / np.maximum(rho, 1e-6) * q * dome, dy / np.maximum(rho, 1e-6) * q * dome, nz], axis=-1)
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
        col = np.broadcast_to(np.asarray(color, F), X.shape + (3,)).copy()
        col *= (0.85 + 0.15 * q)[..., None] if fuzz > 0 else (1.0 - 0.08 * q)[..., None]
        if center_color is not None:
            cm = tg.smoothstep(center_r * 1.1, center_r * 0.7, q)[..., None]
            col = col * (1 - cm) + np.asarray(center_color, F) * cm
        self._composite(win, cov, col, nrm, rough, transl * (1 - 0.5 * (1 - q)), z + r * 0.5 * nz)

    def petal(self, base: Sequence[float], angle: float, length: float, width: float, color: np.ndarray,
              curve: float = 0.0, rough: float = 0.5, transl: float = 0.7, prof: np.ndarray | None = None,
              tip_color: np.ndarray | None = None, z: float = 0.0) -> None:
        """A single petal / bract / plume tuft (leaf-like outline without veins)."""
        look = LeafLook(color=np.asarray(color, F), vein_light=0.0, margin_light=0.0, value_jitter=0.06, hue_jitter=0.01,
                        rough=rough, transl=transl, fold=0.02, bulge=0.002)
        self.leaf(base, angle, length, prof if prof is not None else LOTUS_PETAL, look, Venation(strength=0.15),
                  width=width, curve=curve, z=z)

    # ---------------------------------------------------------------- resolve
    def resolve(self, ao_radius_m: float | None = None, ao_strength: float = 0.75) -> dict[str, np.ndarray]:
        """Downsample to the region size: colour (alpha-weighted, LINEAR), alpha, normal (alpha-weighted, encoded
        0..1), ORM (AO, roughness, translucency). AO = horizon occlusion of the spray's stacking height field."""
        ss = self.ss
        a = self.a
        r = ao_radius_m if ao_radius_m is not None else self.size[0] * 0.035
        zz = np.where(a > 0.5, self.z, 0.0)
        ao = tg.horizon_ao(zz * 6.0, self.mpp, r, directions=8, steps=8)
        ao = 1.0 - ao_strength * (1.0 - ao)
        ao = ao * self.occ
        ao = np.where(a > 0.02, ao, 1.0)

        def down(img):
            h, w = self.px_h, self.px_w
            return img.reshape(h, ss, w, ss, *img.shape[2:]).mean(axis=(1, 3))

        aw = a[..., None]
        A = down(a)
        safe = np.maximum(A, 1e-5)[..., None]
        rgb = down(self.rgb * aw) / safe
        n = down(self.n * aw) / safe
        n = np.where(A[..., None] > 1e-4, n, np.array([0, 0, 1], F))
        n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
        rough = down(self.rough * a) / np.maximum(A, 1e-5)
        transl = down(self.transl * a) / np.maximum(A, 1e-5)
        aod = down(ao * a) / np.maximum(A, 1e-5)
        empty = A < 1e-4
        rough[empty] = 0.6
        transl[empty] = 0.0
        aod[empty] = 1.0
        return {"rgb": rgb.astype(F), "a": A.astype(F), "n": tg.encode_normal(n.astype(F)),
                "orm": np.stack([aod, rough, transl], axis=-1).astype(F)}


# ----------------------------------------------------------------------------------------------- composers
def hexlin(h: str) -> np.ndarray:
    return tg.hex_to_linear(h).astype(F)


def spray(cv: Canvas, prof: np.ndarray, look: LeafLook, ven: Venation, *, n_leaves: int, leaf_len: tuple[float, float],
          twig_color: np.ndarray, phyllotaxis: str = "alternate", spread: float = 55.0, petiole: float = 0.0,
          twig_len: float = 0.85, twig_r: tuple[float, float] = (0.006, 0.0015), droop: float = 0.3,
          tip_cluster: int = 0, notch: float = 0.0, width: float = 1.0, curve: float = 0.0, gradient: float = 0.25,
          start: float = 0.12, base_x: float = 0.5, lean: float = 0.0, serration: tuple[int, float] = (0, 0.0),
          back_fraction: float = 0.0, back_look: LeafLook | None = None, rng: np.random.Generator | None = None) -> None:
    """A twig with leaves, attached at the bottom-centre of the card and growing up. `phyllotaxis` alternate |
    opposite | whorl (mango: leaves crowded into a rosette at the tip); `tip_cluster` extra leaves fanned at the
    tip; `back_fraction` of leaves show their (lighter) underside."""
    rng = rng or cv.rng
    W, H = cv.size
    b = np.array([W * base_x, H * cv.margin * 1.2], F)
    ang0 = math.pi / 2 + lean
    tip = b + np.array([math.cos(ang0), math.sin(ang0)], F) * H * twig_len * 0.92
    bend = float(rng.uniform(-0.05, 0.05))
    # leaves behind the twig first (painter's order: random depth), twig in the middle, front leaves after
    leaves = []
    for i in range(n_leaves):
        f = start + (1 - start) * (i + 0.5) / n_leaves
        if phyllotaxis == "whorl":
            f = 0.55 + 0.4 * (i + 0.5) / n_leaves
        side = 1 if (i % 2 == 0) else -1
        if phyllotaxis == "opposite":
            side = 1 if (i % 2 == 0) else -1
            f = start + (1 - start) * ((i // 2) + 0.5) / max(1, (n_leaves + 1) // 2)
        p = b + (tip - b) * f
        p = p + np.array([-(tip - b)[1], (tip - b)[0]], F) / max(np.linalg.norm(tip - b), 1e-6) * bend * H * 4 * f * (1 - f)
        sp = math.radians(spread * (0.7 + 0.5 * rng.uniform()))
        a = ang0 + side * sp * (1.0 - 0.45 * f) + float(rng.normal(0, 0.12))
        if phyllotaxis == "whorl":
            a = ang0 + (rng.uniform(-1, 1)) * math.radians(spread * 1.6)
        size = rng.uniform(*leaf_len) * (1.0 - gradient * f + gradient * 0.5)
        depth = float(rng.uniform(-1, 1))
        leaves.append((depth, p, a, size))
    for k in range(tip_cluster):
        a = ang0 + (k - (tip_cluster - 1) / 2) * math.radians(spread * 0.7) + float(rng.normal(0, 0.08))
        leaves.append((float(rng.uniform(-1, 1)), tip.copy(), a, rng.uniform(*leaf_len) * (0.75 - gradient * 0.3)))
    leaves.sort(key=lambda x: x[0])
    twig_drawn = False
    for depth, p, a, size in leaves:
        if not twig_drawn and depth > -0.15:
            cv.stroke(b, tip, H * twig_r[0], H * twig_r[1], twig_color, rough=0.82, bend=bend, z=0.0)
            twig_drawn = True
        lk = back_look if (back_look is not None and rng.uniform() < back_fraction) else look
        cv.leaf(p, a, size, prof, lk, ven, roll=float(rng.normal(0, 0.45)), droop=float(rng.uniform(0, droop)),
                curve=curve * float(rng.choice([-1, 1])), petiole=petiole * size, petiole_color=twig_color * 1.3,
                width=width * float(rng.uniform(0.9, 1.1)), notch=notch, serration=serration, rng=rng,
                z=0.01 * (depth + 1))
    if not twig_drawn:
        cv.stroke(b, tip, H * twig_r[0], H * twig_r[1], twig_color, rough=0.82, bend=bend)


@dataclass
class Twig:
    p0: np.ndarray
    p1: np.ndarray
    r0: float
    r1: float
    bend: float
    order: int


def twig_tree(cv: Canvas, *, main_len: float = 0.88, side: int = 4, side_len: tuple[float, float] = (0.32, 0.5),
              side_angle: tuple[float, float] = (28.0, 58.0), sub: int = 1, r: float = 0.008, lean: float = 0.0,
              spread_x: float = 1.0, rng: np.random.Generator | None = None) -> list[Twig]:
    """Branching twig system of one card: a main twig from the attachment point (bottom centre) towards the top
    plus `side` alternating side twigs (and `sub` twiglets on each). Lengths are fractions of the card height."""
    rng = rng or cv.rng
    W, H = cv.size
    b = np.array([W * 0.5, H * cv.margin * 1.05], F)
    a0 = math.pi / 2 + lean + float(rng.normal(0, 0.06))
    tip = b + np.array([math.cos(a0), math.sin(a0)], F) * H * main_len
    out = [Twig(b, tip, H * r, H * r * 0.3, float(rng.uniform(-0.05, 0.05)), 0)]
    for i in range(side):
        f = 0.18 + 0.62 * (i + rng.uniform(0.2, 0.8)) / side
        sgn = 1 if i % 2 == 0 else -1
        p = b + (tip - b) * f
        a = a0 + sgn * math.radians(rng.uniform(*side_angle))
        ln = H * rng.uniform(*side_len) * (1.0 - 0.35 * f)
        q = p + np.array([math.cos(a) * spread_x, math.sin(a)], F) * ln
        out.append(Twig(p, q, H * r * (0.75 - 0.3 * f), H * r * 0.25, float(rng.uniform(-0.08, 0.08)), 1))
        for j in range(sub):
            g = rng.uniform(0.35, 0.7)
            pp = p + (q - p) * g
            aa = a - sgn * math.radians(rng.uniform(25, 50))
            qq = pp + np.array([math.cos(aa) * spread_x, math.sin(aa)], F) * ln * rng.uniform(0.35, 0.55)
            out.append(Twig(pp, qq, H * r * 0.35, H * r * 0.18, float(rng.uniform(-0.1, 0.1)), 2))
    return out


def cluster(cv: Canvas, twigs: list[Twig], draw_leaf: Callable[[np.ndarray, float, float, float], None], *,
            per_m: float, twig_color: np.ndarray, spread: tuple[float, float] = (35.0, 75.0), start: float = 0.15,
            tip_leaves: int = 2, envelope: tuple[float, float] = (0.46, 0.47), rng: np.random.Generator | None = None,
            size_gradient: float = 0.25, whorl: bool = False, leaf_len: float = 0.0) -> int:
    """Leafy card: leaves attached alternately along every twig (`per_m` leaves per metre of twig), `tip_leaves`
    fanned at each tip, culled to an elliptical envelope (fractions of the card) so the card silhouette is a soft
    lumpy oval that never touches the region border. `draw_leaf(base, angle, size_scale, depth)` paints one leaf.
    Painter's order: leaves behind the twigs, twigs, leaves in front. Returns the number of leaves drawn."""
    rng = rng or cv.rng
    W, H = cv.size
    cx, cy = W * 0.5, H * 0.52
    ex, ey = W * envelope[0], H * envelope[1]
    items = []
    for tw in twigs:
        L = float(np.linalg.norm(tw.p1 - tw.p0))
        d = (tw.p1 - tw.p0) / max(L, 1e-6)
        base_a = math.atan2(d[1], d[0])
        n = int(round(L * per_m)) if not whorl else 0
        for i in range(n):
            f = start + (1 - start) * (i + rng.uniform(0.2, 0.8)) / max(n, 1)
            p = tw.p0 + (tw.p1 - tw.p0) * f
            sgn = 1 if i % 2 == 0 else -1
            a = base_a + sgn * math.radians(rng.uniform(*spread)) * (1.0 - 0.3 * f)
            items.append((p, a, 1.0 - size_gradient * f + size_gradient * 0.5))
        k = tip_leaves if not whorl else max(tip_leaves, 5)
        for j in range(k):
            a = base_a + (j - (k - 1) / 2) * math.radians(spread[1] * (1.4 if whorl else 0.7) / max(k - 1, 1)) + rng.normal(0, 0.1)
            items.append((tw.p1 - d * L * (0.04 if whorl else 0.0), a, (1.05 if whorl else 0.8) - size_gradient * 0.4))
    leaves = []

    def inside(pt: np.ndarray) -> float:
        q = np.array([(pt[0] - cx) / ex, (pt[1] - cy) / ey])
        return float(q @ q)

    for p, a, sc in items:
        if inside(p) > 1.0:
            continue
        if leaf_len > 0:  # shrink leaves whose tip would leave the envelope (never clipped by the region border)
            d = np.array([math.cos(a), math.sin(a)])
            for _ in range(4):
                if inside(p + d * leaf_len * sc) <= 1.0:
                    break
                sc *= 0.8
            else:
                continue
        leaves.append((float(rng.uniform(-1, 1)), p, a, sc))
    leaves.sort(key=lambda x: x[0])
    drawn = False
    for depth, p, a, sc in leaves:
        if not drawn and depth > -0.25:
            for tw in sorted(twigs, key=lambda t: t.order):
                cv.stroke(tw.p0, tw.p1, tw.r0, tw.r1, twig_color * (1.0 + 0.15 * tw.order), rough=0.82, bend=tw.bend)
            drawn = True
        draw_leaf(p, a, sc, depth)
    if not drawn:
        for tw in twigs:
            cv.stroke(tw.p0, tw.p1, tw.r0, tw.r1, twig_color, rough=0.82, bend=tw.bend)
    return len(leaves)


def pinnate(cv: Canvas, base: Sequence[float], angle: float, length: float, prof: np.ndarray, look: LeafLook,
            ven: Venation, *, pairs: int, leaflet_len: tuple[float, float], rachis_color: np.ndarray,
            terminal: bool = True, leaflet_angle: float = 60.0, curve: float = 0.0, droop: float = 0.4,
            serration: tuple[int, float] = (0, 0.0), alternate: float = 0.0, width: float = 1.0,
            rng: np.random.Generator | None = None, z: float = 0.0, rachis_r: float = 0.0025,
            taper: float = 0.35) -> None:
    """Pinnately compound leaf (neem, amaltas, palash trifoliate with pairs=1, date / coconut leaflets): a rachis
    with `pairs` leaflet pairs (+ a terminal leaflet)."""
    rng = rng or cv.rng
    b = np.asarray(base, F)
    d = np.array([math.cos(angle), math.sin(angle)], F)
    perp = np.array([-d[1], d[0]], F)
    bend = float(rng.uniform(-0.06, 0.06))
    tip = b + d * length
    cv.stroke(b, tip, rachis_r * 1.2, rachis_r * 0.5, rachis_color, rough=0.75, bend=bend, z=z)
    for i in range(pairs):
        f = 0.12 + 0.82 * (i + 0.5) / pairs
        for side in (-1, 1):
            ff = f + (alternate * 0.5 / pairs if side > 0 else 0.0)
            p = b + d * length * ff + perp * bend * length * 4 * ff * (1 - ff)
            a = angle + side * math.radians(leaflet_angle * (0.85 + 0.3 * rng.uniform()))
            size = rng.uniform(*leaflet_len) * (1 - taper * abs(ff - 0.45))
            cv.leaf(p, a, size, prof, look, ven, roll=float(rng.normal(0, 0.35)), droop=float(rng.uniform(0, droop)),
                    curve=curve * side, serration=serration, width=width, rng=rng, z=z + 0.002)
    if terminal:
        cv.leaf(tip, angle + float(rng.normal(0, 0.1)), rng.uniform(*leaflet_len) * 0.9, prof, look, ven,
                roll=float(rng.normal(0, 0.3)), droop=float(rng.uniform(0, droop)), serration=serration, width=width,
                rng=rng, z=z + 0.003)


def panicle(cv: Canvas, base: Sequence[float], angle: float, length: float, color: np.ndarray, stem: np.ndarray, *,
            branches: int = 7, flower_r: float = 0.004, density: int = 10, cone: float = 0.45, petals: int = 5,
            rng: np.random.Generator | None = None, z: float = 0.02) -> None:
    """Branched inflorescence (mango / neem / sal / teak): a main axis with side branches shortening towards the
    tip, each carrying small flowers - reads as a cone / plume of tiny blossoms."""
    rng = rng or cv.rng
    b = np.asarray(base, F)
    d = np.array([math.cos(angle), math.sin(angle)], F)
    perp = np.array([-d[1], d[0]], F)
    tip = b + d * length
    cv.stroke(b, tip, flower_r * 0.6, flower_r * 0.25, stem, rough=0.7, z=z)
    for i in range(branches):
        f = 0.1 + 0.85 * (i + 0.5) / branches
        side = 1 if i % 2 == 0 else -1
        bl = length * cone * (1 - f) + length * 0.04
        p = b + d * length * f
        a = angle + side * math.radians(rng.uniform(45, 70))
        q = p + np.array([math.cos(a), math.sin(a)], F) * bl
        cv.stroke(p, q, flower_r * 0.35, flower_r * 0.2, stem, rough=0.7, z=z)
        for k in range(max(2, int(density * (1 - f * 0.6)))):
            g = rng.uniform(0.15, 1.0)
            c = p + (q - p) * g + np.asarray(rng.normal(0, flower_r * 0.9, 2), F)
            cv.disc(c, flower_r * rng.uniform(0.7, 1.15), color * rng.uniform(0.9, 1.08), petals=petals,
                    petal_depth=0.4, phase=float(rng.uniform(0, 6.28)), center_color=color * np.array([1.0, 0.85, 0.5], F),
                    center_r=0.35, transl=0.6, rough=0.55, z=z + 0.003, rng=rng)
    for k in range(int(density * 0.6)):
        c = tip - d * length * rng.uniform(0, 0.12) + perp * rng.normal(0, flower_r)
        cv.disc(c, flower_r * rng.uniform(0.6, 1.0), color, petals=petals, petal_depth=0.4, transl=0.6, z=z + 0.004, rng=rng)


def raceme(cv: Canvas, top: Sequence[float], length: float, color: np.ndarray, stem: np.ndarray, *, flowers: int = 18,
           flower_r: float = 0.012, sway: float = 0.06, rng: np.random.Generator | None = None, z: float = 0.03) -> None:
    """Hanging flower chain (amaltas): a pendulous stalk, open five-petalled flowers along it, buds at the tip."""
    rng = rng or cv.rng
    t = np.asarray(top, F)
    bot = t + np.array([rng.normal(0, sway) * length, -length], F)
    cv.stroke(t, bot, flower_r * 0.18, flower_r * 0.1, stem, bend=float(rng.uniform(-0.04, 0.04)), rough=0.7, z=z)
    for i in range(flowers):
        f = (i + 0.5) / flowers
        p = t + (bot - t) * f + np.asarray(rng.normal(0, flower_r * 0.6, 2), F)
        bud = f > 0.8
        r = flower_r * (0.45 if bud else rng.uniform(0.8, 1.15)) * (1 - 0.3 * f)
        cv.disc(p, r, color * rng.uniform(0.92, 1.06) * (0.85 if bud else 1.0), petals=0 if bud else 5, petal_depth=0.3,
                phase=float(rng.uniform(0, 6.28)), center_color=color * np.array([0.9, 0.7, 0.3], F), center_r=0.25,
                transl=0.7, rough=0.5, dome=0.6 if bud else 0.35, z=z + 0.002 + 0.001 * i, rng=rng)


def blade(cv: Canvas, base: Sequence[float], angle: float, length: float, width: float, color_base: np.ndarray,
          color_tip: np.ndarray, *, curl: float = 0.0, rough: float = 0.6, transl: float = 0.8, fold: float = 0.08,
          tip_dry: float = 0.0, rng: np.random.Generator | None = None, z: float = 0.0, ao_base: float = 0.55) -> None:
    """Grass / cereal blade: a long narrow leaf (`width` = max width in m) bent by `curl` (fraction of the length,
    sideways at the tip), darker base (AO) to lighter tip, optional dry brown tip."""
    rng = rng or cv.rng
    look = LeafLook(color=np.asarray(color_base, F), vein_light=0.08, margin_light=0.0, value_jitter=0.08,
                    hue_jitter=0.02, rough=rough, transl=transl, fold=fold, bulge=0.0)
    # draw with a GRASS outline scaled to the blade width
    prof = GRASS.copy()
    prof[:, 1] = prof[:, 1] * (width / max(length, 1e-6)) * 2.0
    cv_layer_before = cv.layer
    cv.leaf(base, angle, length, prof, look, Venation(spacing=1.0, midrib=0.004, strength=0.6), curve=curl, rng=rng, z=z,
            roll=float(rng.normal(0, 0.3)))
    if cv.layer == cv_layer_before:
        return
    # recolour the blade along its length (base -> tip) + dry tip: done on the composited window
    b = np.asarray(base, F)
    d = np.array([math.cos(angle), math.sin(angle)], F)
    bb = cv._bbox(min(b[0], b[0] + d[0] * length) - width - abs(curl) * length, min(b[1], b[1] + d[1] * length) - width,
                  max(b[0], b[0] + d[0] * length) + width + abs(curl) * length, max(b[1], b[1] + d[1] * length) + width)
    if bb is None:
        return
    win, X, Y = bb
    s = np.clip(((X - b[0]) * d[0] + (Y - b[1]) * d[1]) / length, 0, 1)
    grad = np.asarray(color_base, F) + (np.asarray(color_tip, F) - np.asarray(color_base, F)) * s[..., None]
    grad *= (ao_base + (1 - ao_base) * tg.smoothstep(0.0, 0.45, s))[..., None]
    if tip_dry > 0:
        dry = tg.smoothstep(1 - tip_dry, 1.0, s)[..., None]
        grad = grad * (1 - dry) + hexlin("#9a8a5c") * dry
    # only where this blade is the top layer: approximate with the blade's own coverage recomputed cheaply
    lum_old = tg.luminance(cv.rgb[win])
    mask = (cv.a[win] > 0.01) & (np.abs(lum_old - float(tg.luminance(np.asarray(color_base, F)[None])[0])) < 0.2)
    cv.rgb[win] = np.where(mask[..., None], grad * (cv.rgb[win] / np.maximum(np.asarray(color_base, F), 1e-4)).mean(axis=-1, keepdims=True), cv.rgb[win])


# ----------------------------------------------------------------------------------------------- atlas pages
@dataclass
class RegionSpec:
    """One atlas region of a species block: `cells` = (col, row, ncols, nrows) in the block's 4 x 2 cell grid, row 0
    at the BOTTOM (v up). `size_m` = card size at LOD0. `paint(canvas, rng, alt)` draws it; `alt` (cells of the
    seasonal alternate, same size) is painted by the same function with alt=True and the same seed, so the alternate
    shows the same spray with flowers / new leaves. `klass` = card class (see _vegkit)."""
    name: str
    cells: tuple[int, int, int, int]
    size_m: tuple[float, float]
    paint: Callable[["Canvas", np.random.Generator, bool], None]
    alt: tuple[int, int, int, int] | None = None
    klass: float = 0.0
    weight: float = 1.0       # relative frequency on the tree
    use: str = "crown"        # crown | root | frond | twig | bark | flower | thread ...
    margin: float = 0.03
    ao_strength: float = 0.75


class Page:
    """Leaf atlas page (A class): `px` square, an 8 x 8 grid of cells holding 8 species blocks of 4 x 2 cells
    (block b at cell column (b % 2) * 4, cell row (b // 2) * 2, rows counted from the BOTTOM). Accumulates LINEAR
    colour, alpha, encoded normal and ORM at the final resolution; regions are painted supersampled and resolved."""

    GRID = 8      # cells per page side
    BLOCK = (4, 2)

    def __init__(self, px: int = 2048, ss: int = 2) -> None:
        self.px, self.ss = px, ss
        self.cell = px // self.GRID
        self.rgb = np.zeros((px, px, 3), F)
        self.a = np.zeros((px, px), F)
        self.n = np.zeros((px, px, 3), F)
        self.n[...] = (0.5, 0.5, 1.0)
        self.orm = np.zeros((px, px, 3), F)
        self.orm[...] = (1.0, 0.6, 0.0)
        self.regions: dict[str, dict] = {}

    def uv_rect(self, block: int, cells: tuple[int, int, int, int]) -> tuple[float, float, float, float]:
        bw, bh = self.BLOCK
        bx, by = (block % 2) * bw, (block // 2) * bh
        c, r, nc, nr = cells
        if c + nc > bw or r + nr > bh:
            raise ValueError(f"region cells {cells} outside the {bw} x {bh} block")
        g = float(self.GRID)
        return ((bx + c) / g, (by + r) / g, (bx + c + nc) / g, (by + r + nr) / g)

    def _paste(self, rect: tuple[float, float, float, float], m: dict[str, np.ndarray]) -> None:
        u0, v0, u1, v1 = rect
        x0, x1 = int(round(u0 * self.px)), int(round(u1 * self.px))
        r0, r1 = int(round((1 - v1) * self.px)), int(round((1 - v0) * self.px))
        self.rgb[r0:r1, x0:x1] = m["rgb"]
        self.a[r0:r1, x0:x1] = m["a"]
        self.n[r0:r1, x0:x1] = m["n"]
        self.orm[r0:r1, x0:x1] = m["orm"]

    def paint(self, species: str, block: int, spec: RegionSpec, seed: int) -> None:
        c, r, nc, nr = spec.cells
        w_px, h_px = nc * self.cell, nr * self.cell
        size = spec.size_m
        for alt in ([False, True] if spec.alt else [False]):
            cv = Canvas(w_px, h_px, size, ss=self.ss, seed=seed, margin=spec.margin)
            spec.paint(cv, cv.rng, alt)
            m = cv.resolve(ao_strength=spec.ao_strength)
            self._paste(self.uv_rect(block, spec.alt if alt else spec.cells), m)
        rect = self.uv_rect(block, spec.cells)
        self.regions[f"{species}.{spec.name}"] = {
            "species": species, "name": spec.name, "rect": [round(x, 6) for x in rect],
            "alt": [round(x, 6) for x in self.uv_rect(block, spec.alt)] if spec.alt else None,
            "sizeM": [round(float(size[0]), 4), round(float(size[1]), 4)], "klass": spec.klass, "weight": spec.weight,
            "use": spec.use,
        }

    def stats(self, species_rects: list[tuple[float, float, float, float]]) -> dict[str, float]:
        """Alpha-weighted mean linear colour and coverage over the given rects (QA vs TREE_SPECIES.leaf)."""
        acc = np.zeros(3)
        wsum = 0.0
        cov = []
        for u0, v0, u1, v1 in species_rects:
            x0, x1 = int(round(u0 * self.px)), int(round(u1 * self.px))
            r0, r1 = int(round((1 - v1) * self.px)), int(round((1 - v0) * self.px))
            a = self.a[r0:r1, x0:x1]
            acc += (self.rgb[r0:r1, x0:x1] * a[..., None]).sum(axis=(0, 1))
            wsum += float(a.sum())
            cov.append(float(a.mean()))
        mean = acc / max(wsum, 1e-6)
        return {"meanLinear": [round(float(x), 5) for x in mean], "coverage": round(float(np.mean(cov)), 4) if cov else 0.0}


def page_images(page: Page) -> dict[str, np.ndarray]:
    """Final maps: colour (sRGB-encoded rgb + linear alpha), normal (encoded), ORM - top-down float [0, 1]. Transparent
    colour texels are push-pull filled and alpha floored at 10/255 (see _vegkit.push_pull_fill)."""
    from _vegkit import ALPHA_FLOOR, push_pull_fill  # noqa: PLC0415
    srgb = tg.linear_to_srgb(np.clip(page.rgb, 0, 1))
    srgb = push_pull_fill(srgb, page.a)
    col = np.concatenate([srgb, np.maximum(page.a, ALPHA_FLOOR)[..., None]], axis=-1)
    return {"color": col.astype(F), "normal": page.n.astype(F), "orm": page.orm.astype(F)}


__all__ = [
    "AAK", "AMALTAS_LEAFLET", "Page", "RegionSpec", "page_images", "Twig", "cluster", "twig_tree", "BABUL_PINNULE", "BAMBOO", "BANYAN", "BER", "Canvas", "GENERIC", "GRASS", "LOTUS_PETAL",
    "LeafLook", "MANGO", "NEEM_LEAFLET", "PALASH_LEAFLET", "PEEPAL", "SAL", "TEAK", "Venation", "blade", "hexlin",
    "outline", "panicle", "pinnate", "raceme", "spray",
]
