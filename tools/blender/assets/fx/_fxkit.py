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


__all__ = ["label_sequences", "lit_volume_frames", "peak_density", "puff_frames", "smoothstep", "srgb"]
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
