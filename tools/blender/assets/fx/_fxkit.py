"""
Package-local helper (fx): shared recipes for the WP7 volume flipbooks (puffs, plumes, flames) on top of
lib/flipbook.py. OWNER: Technical Artist G (TA-07). Not an asset (leading underscore).
"""
from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np

from lib import flipbook as fb
from lib import texgen as tg

F = np.float32


def puff_frames(seed: int, frames: int, duration: float, extent: Sequence[float], *, grid: int = 64, count: int = 2400,
                origin: Sequence[float] = (0.0, 0.0, 0.5), radius: float = 0.35, clusters: int = 14, burst: float = 0.7,
                direction: Sequence[float] = (0.0, 0.0, 0.0), rise: float = 0.35, drag: float = 0.9, turbulence: float = 0.35,
                curl_freq: float = 2.0, life: tuple[float, float] = (0.95, 1.08), ground: float | None = None,
                flatten: float = 1.0, fade_out: float = 0.6,
                bands: Sequence[tuple[float, float, float]] = ((0.0, 0.25, 1.0), (0.25, 0.55, 1.8), (0.55, 1.01, 2.8))
                ) -> list[np.ndarray]:
    """One-shot billowing puff: `clusters` sub-puffs (cauliflower lobes) bursting outwards, slowing down,
    rising and expanding, thinning out over the last `fade_out` of their life. Density grid per frame."""
    rng = np.random.default_rng(seed)
    sim = fb.ParticleVolume(grid, extent, seed, turbulence=turbulence,
                            curl=fb.CurlNoise(seed + 7, octaves=3, base_freq=curl_freq, speed=0.4))
    sim_fade = fade_out
    centers = rng.normal(0, 1, (clusters, 3))
    centers /= np.linalg.norm(centers, axis=1, keepdims=True)
    cdir = centers.copy()
    centers = centers * radius * rng.uniform(0.35, 0.85, (clusters, 1))
    per = max(1, count // clusters)
    pos, vel = [], []
    for k in range(clusters):
        p = centers[k] + rng.normal(0, radius * 0.38, (per, 3))
        v = cdir[k] * burst * rng.uniform(0.6, 1.2) + rng.normal(0, burst * 0.12, (per, 3)) + np.array(direction, F)
        pos.append(p + np.array(origin, F))
        vel.append(v)
    pos = np.concatenate(pos).astype(F)
    vel = np.concatenate(vel).astype(F)
    vel[:, 2] *= flatten
    pos[:, 2] = np.maximum(pos[:, 2], 0.03)
    n = len(pos)
    lf = rng.uniform(life[0], life[1], n) * duration
    mass = rng.uniform(0.6, 1.0, n)
    sim.emit(pos, vel, lf, mass)
    out = []
    dt = duration / frames
    for _ in range(frames):
        sim.step(dt, buoyancy=rise, drag=drag)
        if ground is not None:
            below = sim.p[:, 2] < ground
            sim.p[below, 2] = ground
            sim.v[below, 2] = np.abs(sim.v[below, 2]) * 0.2
        dens, _ = sim.fields(bands=bands, fade_out=sim_fade)
        out.append(dens)
    return out


def lit_volume_frames(dens_frames: Sequence[np.ndarray], extent: Sequence[float], px: int, *, k_ext: float,
                      albedo: Sequence[float] = (0.62, 0.6, 0.58), samples: int = 16, view: str = "front",
                      ambient_blur: float = 5.0, flatten: float = 0.0) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Cycles-render density frames as an occlusion-only (ambient) albedo for runtime lighting.
    `flatten` (0..1) compresses the opacity range over the sequence: each frame is scaled by
    (peak column density / its own peak) ** flatten, so an expanding puff stays readable until its fade-out
    instead of thinning to nothing at mid-life. Returns (straight-alpha linear rgba frames, normal frames)."""
    n = dens_frames[0].shape[0]
    vox = float(max(extent)) / (n - 1)
    axis = 2 if view == "top" else 1
    peaks = [float((d.sum(axis=axis) * vox).max()) for d in dens_frames]
    top = max(peaks) if peaks else 1.0
    pairs = []
    for d, pk in zip(dens_frames, peaks):
        boost = (top / max(pk, top * 1e-3)) ** flatten if flatten > 0 else 1.0
        sigma = (d * k_ext * boost).astype(F)
        rad = fb.light_volume(sigma, vox, albedo, key=(0.0, 0.0, 0.0), ambient=(1.0, 1.0, 1.0), ambient_blur=ambient_blur,
                              ambient_k=0.35)
        pairs.append((sigma, rad))
    rgba = fb.render_volumes(pairs, extent, px, samples=samples, view=view)
    color, normals = [], []
    for f in rgba:
        s = fb.to_straight(f)
        color.append(s)
        normals.append(fb.normal_from_alpha(s[..., 3], strength=2.2, blur_px=max(1.0, px / 96)))
    return color, normals


# ============================================================================================ Eulerian helpers
def sim_box(extent: Sequence[float], h: float) -> tuple[tuple[int, int, int], tuple[float, float, float]]:
    """Grid shape and extent snapped to cubic voxels of size h (FluidSim needs exact cubes)."""
    shape = tuple(max(8, int(round(float(e) / h))) for e in extent)
    return shape, tuple(n * h for n in shape)  # type: ignore[return-value]


def smooth01(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def life_fade(n: int, fade_in: float = 0.05, fade_out: float = 0.3, floor_in: float = 0.35) -> list[float]:
    """Per-frame opacity multiplier of a one-shot sequence: quick fade-in from `floor_in`, smooth fade-out over the
    last `fade_out` of life (the last frame ends near 0 so the particle can die on it)."""
    out = []
    for i in range(n):
        x = i / max(n - 1, 1)
        a = float(smooth01(np.array((1.0 - x) / max(fade_out, 1e-6))))
        b = float(floor_in + (1 - floor_in) * smooth01(np.array(x / max(fade_in, 1e-6))))
        out.append(a * b)
    return out


def lit_frames(dens: Sequence[np.ndarray], extent: Sequence[float], h: float, px: int, *, view: str = "front",
               frame: Sequence[float], depth: float = 4.5, albedo: Sequence[float] = (0.6, 0.585, 0.565),
               flatten: float = 0.45, fades: Sequence[float] | None = None, normal_blur: float = 2.0,
               normal_strength: float = 0.8, ambient_blur: float = 4.0, ground_fade: float | np.ndarray = 0.0,
               ground_soft: float = 0.12, normal_blur_frac: float | None = None,
               normal_fade: tuple[float, float] | None = None,
               window: tuple[float, float] = (0.02, 0.06)) -> tuple[list[np.ndarray], list[np.ndarray], float]:
    """Density frames (FluidSim grids) -> straight-alpha linear rgba frames + tangent normals, noise-free
    (flipbook.integrate_volume). Color = occlusion-only (ambient) albedo; directional light comes from the normals at
    runtime. `depth` = peak optical depth; `flatten` keeps late (expanded, thinner) frames readable; `fades` = per-frame
    opacity; `ground_fade` softens the contact with the floor: a scalar fade height (m), or an (nx, ny) map of
    ground-line offsets g0 (m) -> density x smooth((z - g0) / ground_soft), a ragged, soft base that is never a
    straight line; `window` = safety window
    (zero margin, fade) so no frame can touch its border.
    Lit-medium normals (Art Director TA-07 R2-B1): `normal_blur_frac` takes the density gradient from a density blurred
    by that fraction of the frame side (~0.035: the puff's big rounded forms, no internal creases; overrides
    `normal_blur`, in voxels) and `normal_fade` = (lo, hi) fades the tilt with the final alpha
    (flipbook.soften_normals), so thin fringes face the camera instead of carrying a hard silhouette.
    Returns (color, normals, worst pre-window border alpha)."""
    axis = 2 if view == "top" else 1
    peaks = [float((d.sum(axis=axis) * h).max()) for d in dens]
    top = max(max(peaks), 1e-9)
    win = fb.frame_window(px, *window)
    color, normals = [], []
    worst = 0.0
    z = None
    nblur = normal_blur if normal_blur_frac is None else float(normal_blur_frac) * float(frame[2]) / h
    gf = np.asarray(ground_fade, dtype=F)
    if gf.ndim == 2 or float(gf.max()) > 0:
        zc = ((np.arange(dens[0].shape[2], dtype=F) + 0.5) * h)[None, None, :]
        if gf.ndim == 2:
            z = smooth01((zc - gf[..., None]) / max(ground_soft, 1e-3)).astype(F)
        else:
            z = smooth01(zc / max(float(gf), 1e-3)).astype(F)
    for i, (d, pk) in enumerate(zip(dens, peaks)):
        boost = (top / max(pk, top * 1e-3)) ** flatten if flatten > 0 else 1.0
        f = fades[i] if fades is not None else 1.0
        sig = (d * (depth / top) * boost * f).astype(F)
        if z is not None:
            sig = (sig * z).astype(F)
        rad = fb.light_volume(sig, h, albedo, key=(0.0, 0.0, 0.0), ambient=(1.0, 1.0, 1.0), ambient_blur=ambient_blur, ambient_k=0.35)
        nrm = fb.density_normals(sig, nblur)
        rgba, nm = fb.integrate_volume(sig, rad, extent, px, view=view, frame=frame, normals=nrm, normal_strength=normal_strength)
        s = fb.to_straight(rgba)
        a = s[..., 3]
        worst = max(worst, float(max(a[:2].max(), a[-2:].max(), a[:, :2].max(), a[:, -2:].max())))
        s[..., 3] = a * win
        if normal_fade is not None:
            nm = fb.soften_normals(nm, s[..., 3], *normal_fade)
        color.append(s)
        normals.append(nm)
    return color, normals, worst


def fire_frames(temps: Sequence[np.ndarray], extent: Sequence[float], h: float, px: int, *, frame: Sequence[float],
                t0: float = 0.42, t1: float = 0.8, t_max: float = 1.35, alpha: float = 2.0, base_fade: float | np.ndarray = 0.16,
                stops: Sequence[tuple[float, str]] = ((0.0, "#000000"), (0.4, "#a8300e"), (0.5, "#e2571e"), (0.68, "#ff8a2a"),
                                                      (0.88, "#ffb040"), (1.1, "#ffc860"), (1.35, "#fff2c0")),
                window: tuple[float, float] = (0.02, 0.06)) -> tuple[list[np.ndarray], float]:
    """Temperature frames -> premultiplied linear rgba flame frames (ART_BIBLE §10 ramp #fff2c0 core -> #ffb040
    body -> #e2571e tongues). Emission only above `t0` with a steep ramp to `t1` (crisp flame edges = tongues);
    no soot (fire is emission + slight occlusion; smoke comes from fx_smoke). Unnormalized HDR; see normalize_fire."""
    win = fb.frame_window(px, *window)
    zf = None
    out = []
    worst = 0.0
    for T in temps:
        Tn = np.clip(T, 0, t_max)
        bf = np.asarray(base_fade, dtype=F)
        if bf.ndim == 2 or float(bf.max()) > 0:
            # the flame root fades in over `base_fade` meters by temperature (darker / redder, never a dim grey core);
            # an (nx, ny) map gives every column its own root height (a ragged base, never one flat glowing line)
            if zf is None:
                zc = ((np.arange(T.shape[2], dtype=F) + 0.5) * h)[None, None, :]
                zf = smooth01(zc / (bf[..., None] if bf.ndim == 2 else float(bf))).astype(F)
                if zf.ndim == 3 and zf.shape[:2] == (1, 1):
                    zf = zf
            Tn = Tn * (0.6 + 0.4 * zf)
        col = tg.gradient_map(Tn / t_max, [(a / t_max, c) for a, c in stops])
        e = smooth01((Tn - t0) / (t1 - t0))
        inten = e ** 1.3 * (0.35 + 0.65 * Tn / t_max)
        if zf is not None:
            inten = inten * zf
        sig = (alpha * inten).astype(F) + 1e-3
        rad = (col * (inten * 30.0)[..., None]) / sig[..., None]
        rgba, _ = fb.integrate_volume(sig, rad.astype(F), extent, px, view="front", frame=frame)
        lv = rgba[..., :3].max(-1)
        worst = max(worst, float(max(lv[:2].max(), lv[-2:].max(), lv[:, :2].max(), lv[:, -2:].max())))
        out.append((rgba * win[..., None]).astype(F))
    return out, worst


def straight_base_fraction(alpha: np.ndarray, thr: float = 0.1, tol: int = 1) -> float:
    """Longest run of columns whose lowest covered pixel (alpha > thr) sits on the same row (+-tol), as a fraction
    of the frame width - the Art Director's "straight base edge" measure (target <= 0.2)."""
    cov = alpha > thr
    cols = np.nonzero(cov.any(axis=0))[0]
    if not len(cols):
        return 0.0
    bottom = np.array([np.nonzero(cov[:, c])[0].max() for c in cols])
    best = run = 1
    for i in range(1, len(cols)):
        if cols[i] == cols[i - 1] + 1 and abs(int(bottom[i]) - int(bottom[i - run])) <= tol:
            run += 1
        else:
            run = 1
        best = max(best, run)
    return best / alpha.shape[1]


def peak_density(frames: Sequence[np.ndarray], vox: float) -> float:
    """Max column density (sum along the view axis, y) over frames - to normalize extinction."""
    return float(max((f.sum(axis=1) * vox).max() for f in frames))


def label_sequences(seqs: Sequence[dict[str, Any]]) -> list[str]:
    out = []
    for s in seqs:
        for i in range(s["count"]):
            out.append(f"{s['name'][:6]}{i}" if s["count"] > 1 else s["name"][:8])
    return out


def srgb(hexstr: str) -> np.ndarray:
    return tg.hex_to_linear(hexstr)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


__all__ = ["fire_frames", "label_sequences", "life_fade", "lit_frames", "lit_volume_frames", "peak_density", "puff_frames",
           "sim_box", "smooth01", "smoothstep", "srgb"]
del math


# ============================================================================================ 2D sprite helpers
def canvas(px: int) -> np.ndarray:
    return np.zeros((px, px, 4), F)


def coords(px: int, py: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Pixel-center coordinates in [-1, 1] (x right, y up)."""
    return fb.grid2(px, py)


def glow(x: np.ndarray, y: np.ndarray, cx: float, cy: float, r: float, power: float = 2.0) -> np.ndarray:
    d = np.hypot(x - cx, y - cy) / max(r, 1e-6)
    return (1.0 / (1.0 + d ** power)).astype(F) * np.clip(1.4 - d * 0.35, 0, 1)


def streak(x: np.ndarray, y: np.ndarray, a: Sequence[float], b: Sequence[float], width: float, soft: float = 1.0) -> np.ndarray:
    """Soft line segment a -> b, brightest at b (the head); returns (intensity, t along)."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = max(dx * dx + dy * dy, 1e-12)
    t = np.clip(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1)
    d = np.hypot(x - (ax + t * dx), y - (ay + t * dy))
    core = np.exp(-(d / max(width, 1e-6)) ** 2 * soft)
    return (core * (0.25 + 0.75 * t)).astype(F)


def emissive_frame(intensity: np.ndarray, color_hot: str, color_cool: str, white_core: float = 0.85) -> np.ndarray:
    """Additive spark color: hot cores go white, the rest graded from cool to hot; alpha = intensity."""
    i = np.clip(intensity, 0, None)
    hot = srgb(color_hot)
    cool = srgb(color_cool)
    t = np.clip(i, 0, 1)[..., None]
    rgb = cool * (1 - t) + hot * t
    core = np.clip((i - white_core) / max(1 - white_core, 1e-3), 0, 1)[..., None]
    rgb = rgb * (1 - core) + np.ones(3, F) * core
    a = np.clip(i, 0, 1)[..., None]
    return np.concatenate([rgb * a, a], axis=-1).astype(F)


def spark_emission(intensity: np.ndarray, gold: str = "#e9b949", saffron: str = "#e8892b", core_hex: str = "#fff2c0",
                   gain: float = 1.0, core: float = 0.9, window: np.ndarray | None = None) -> np.ndarray:
    """Premultiplied additive spark emission (ART_BIBLE §10 melee VFX): intensity is soft-saturated
    (v = 1 - exp(-gain i), never a flat clip), colored from saffron (dim, cooling) to gold (bright), and only the
    hottest v > `core` blends towards the warm-white core (#fff2c0, never pure white). Alpha = v (tooling only:
    additive books drop it at publish). `window` (frame_window) forces the border to exactly 0."""
    v = 1.0 - np.exp(-np.clip(intensity, 0, None) * gain)
    if window is not None:
        v = v * window
    g = srgb(gold)
    sf = srgb(saffron)
    t = smoothstep(0.15, 0.85, v)[..., None]
    rgb = sf * (1 - t) + g * t
    c = smoothstep(core, 1.0, v)[..., None]
    rgb = rgb * (1 - c) + srgb(core_hex) * c
    return np.concatenate([rgb * v[..., None], v[..., None]], axis=-1).astype(F)


def fbm2(x: np.ndarray, y: np.ndarray, seed: int, octaves: int = 5, freq: float = 2.0) -> np.ndarray:
    """Smooth 2D fbm from sums of rotated sines (deterministic, seamless enough for sprites)."""
    rng = np.random.default_rng(seed)
    out = np.zeros_like(x, dtype=F)
    amp = 1.0
    tot = 0.0
    f = freq
    for _ in range(octaves):
        for _ in range(3):
            ang = rng.uniform(0, np.pi)
            ph = rng.uniform(0, 2 * np.pi)
            out += amp * np.sin((x * np.cos(ang) + y * np.sin(ang)) * f * np.pi + ph)
            tot += amp
        amp *= 0.55
        f *= 2.03
    return (out / tot * 0.5 + 0.5).astype(F)


# ============================================================================================ artifact checks
def regions(mask: np.ndarray) -> list[np.ndarray]:
    """4-connected components of a boolean image: a list of (k, 2) [row, col] index arrays, largest first."""
    from collections import deque

    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out: list[np.ndarray] = []
    for r0, c0 in zip(*np.nonzero(mask)):
        if seen[r0, c0]:
            continue
        q = deque([(int(r0), int(c0))])
        seen[r0, c0] = True
        pix = []
        while q:
            r, c = q.popleft()
            pix.append((r, c))
            for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= rr < h and 0 <= cc < w and mask[rr, cc] and not seen[rr, cc]:
                    seen[rr, cc] = True
                    q.append((rr, cc))
        out.append(np.array(pix, np.int64))
    out.sort(key=len, reverse=True)
    return out


def flat_top_fraction(pix: np.ndarray, width: int, tol: int = 1) -> float:
    """Longest run of adjacent columns whose TOP pixel sits on the same row (+-tol) in one region, as a fraction of
    the frame width - a flat-topped block reads as a glowing rectangle (Art Director TA-07 R2-B2a, target <= 0.1)."""
    cols = np.unique(pix[:, 1])
    if len(cols) < 2:
        return len(cols) / width
    top = np.array([pix[pix[:, 1] == c, 0].min() for c in cols])
    best = run = 1
    for i in range(1, len(cols)):
        if cols[i] == cols[i - 1] + 1 and abs(int(top[i]) - int(top[i - run])) <= tol:
            run += 1
        else:
            run = 1
        best = max(best, run)
    return best / width


def flat_tops(v: np.ndarray, thresholds: Sequence[float] = (0.15, 0.3), min_px: int = 12, tol: int = 2) -> tuple[float, str]:
    """Worst flat-top fraction over every emissive region of one frame's intensity image `v` (encoded [0, 1]) at each
    threshold - detached blobs and lobes joined to the body only through the dim base alike (the column-wise top
    profile of a joined block is still its flat top). Returns (fraction of the frame width, description)."""
    worst, what = 0.0, "none"
    for thr in thresholds:
        for k, pix in enumerate(regions(v > thr)):
            if len(pix) < min_px:
                continue
            f = flat_top_fraction(pix, v.shape[1], tol)
            if f > worst:
                worst = f
                what = f"region {k} ({len(pix)} px) at v > {thr}: top {int(pix[:, 0].min())}, cols {int(pix[:, 1].min())}-{int(pix[:, 1].max())}"
    return worst, what


def straight_top_edge(v: np.ndarray, thr: float = 0.2, spread: float = 1.0, min_px: int = 12,
                      detached_only: bool = False) -> tuple[float, str]:
    """Longest FLAT top edge of an emissive shape in one frame's intensity image `v` (encoded [0, 1], row 0 = top), as
    a fraction of the frame width (Art Director TA-07 R2-B2a: a flat-topped glowing block, target <= 10 %).
    For each region of v > thr (4-connected, >= min_px) and each of its columns, the top edge is located at sub-pixel
    precision (where v crosses thr between the first covered pixel and the one above it); the longest run of adjacent
    columns whose top positions stay within `spread` px of each other is the flat top. A rounded crest of radius R px
    stays within 1 px only over ~2 sqrt(2R) columns (a 30 px dome: ~15 px); a block's top stays flat over its whole
    width. `detached_only` skips the largest region (the flame body). Returns (fraction, description)."""
    regs = regions(v > thr)
    best, where = 0.0, "none"
    for k, pix in enumerate(regs):
        if (detached_only and k == 0) or len(pix) < min_px:
            continue
        cols = np.unique(pix[:, 1])
        tops = []
        for c in cols:
            r = int(pix[pix[:, 1] == c, 0].min())
            a, b = (float(v[r - 1, c]) if r > 0 else 0.0), float(v[r, c])
            tops.append(r - (b - thr) / max(b - a, 1e-6))  # sub-pixel crossing between rows r - 1 and r
        tops = np.array(tops)
        i0 = 0
        for i in range(len(cols)):
            if i > 0 and cols[i] != cols[i - 1] + 1:
                i0 = i
            while tops[i0:i + 1].max() - tops[i0:i + 1].min() > spread:
                i0 += 1
            run = i - i0 + 1
            if run / v.shape[1] > best:
                best = run / v.shape[1]
                where = f"region {k} ({len(pix)} px), top row ~{tops[i0:i + 1].mean():.1f}, cols {int(cols[i0])}-{int(cols[i])}"
    return best, where
