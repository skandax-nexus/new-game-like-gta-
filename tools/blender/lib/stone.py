"""
Stone surfacing: physically plausible weathering of carved height fields and sandstone albedo /
roughness synthesis. Shared by tiling material sets and unique (UV-space) bakes.
OWNER: Technical Art Director.

    style = stone.RED_SANDSTONE | stone.BUFF_SANDSTONE | StoneStyle(...)
    h2, wm = stone.weather_height(h, masks, size_m, rng, amount)     -> weathered height + masks
    col, rough = stone.surface(h2, ao, masks, wm, size_m, rng, style) -> LINEAR albedo, roughness

All arrays are top-down, periodic (tile units), heights in meters. `masks` is a dict with optional
'stone' (per-block random id), 'tool' (tooled centre field), 'carve' (ornament), 'joint' (distance to
the nearest joint, m).

Look targets (Mathura / Sikri red sandstone, Sanchi buff sandstone): per-block tone shifts, iron
banding (liesegang lines), pale reduction spots, dark mineral specks; erosion-softened carving,
spalling flakes, honeycomb (alveolar) weathering, chipped arrises, hairline cracks; grime in
recesses, dust on upward ledges, water streaks under drip edges, sparse lichen, edge wear.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import texgen as tg

F = np.float32


@dataclass
class StoneStyle:
    name: str
    stops: list = field(default_factory=list)  # (t, sRGB hex) albedo ramp
    tints: list = field(default_factory=lambda: ["#ffffff"])  # per-block multiplicative tints (sRGB hex)
    spot_color: str = "#c4a688"
    dirt_color: str = "#3b2a22"
    dust_color: str = "#b49a7e"
    lichen_color: str = "#6f705a"
    streak_dark: float = 0.22
    spots: float = 1.0
    lichen: float = 1.0
    banding: float = 1.0
    roughness: float = 0.84


RED_SANDSTONE = StoneStyle(
    "red_sandstone",
    stops=[(0.0, "#5f281d"), (0.25, "#723224"), (0.5, "#843e2b"), (0.72, "#954d36"), (1.0, "#a86449")],
    tints=["#ffffff", "#ffd9c4", "#f2c6c0", "#ffe3cf", "#e8c9c4", "#fff0e0"],
    spot_color="#b39275",
    dirt_color="#2c1e19",
    dust_color="#a08670",
    lichen_color="#5f5e4c",
    spots=0.6,
)

BUFF_SANDSTONE = StoneStyle(
    "buff_sandstone",
    stops=[(0.0, "#8b7a63"), (0.3, "#a08b70"), (0.55, "#b39d80"), (0.78, "#c2ad91"), (1.0, "#d0bea4")],
    spot_color="#d8cbb4",
    dirt_color="#3b342b",
    dust_color="#c4b39a",
    lichen_color="#5f6152",
    streak_dark=0.3,
    spots=0.4,
)


def _f(per_meter: float, size: float) -> int:
    return max(1, int(round(per_meter * size)))


def weather_height(h: np.ndarray, masks: dict, size_m: tuple[float, float], rng: np.random.Generator,
                   amount: float = 1.0) -> tuple[np.ndarray, dict]:
    n = h.shape[0]
    W = size_m[0]
    texel = W / n
    x, y = tg.coords(n, n, 1.0, 1.0)
    tool = masks.get("tool", np.zeros_like(h))
    carve = masks.get("carve", np.zeros_like(h))
    joint = masks.get("joint", np.full_like(h, 9.0))
    h = h.copy()
    # pitched point-chisel tooling in the centre fields of dressed blocks
    f1, _, cid = tg.worley(x, y, _f(90, W), rng)
    h += -0.0009 * tg.smoothstep(0.5, 0.05, f1) * (0.4 + cid) * tool
    # mineral grain
    h += 0.00022 * tg.fbm(x, y, _f(150, W), 3, rng)
    # erosion: softened detail where exposed
    ero = tg.smoothstep(-0.15, 0.45, tg.fbm(x, y, _f(1.25, W), 5, rng)) * amount
    hb = tg.blur(h, 0.0028 / texel)
    h = tg.lerp(h, hb, 0.75 * ero)
    h -= 0.0016 * ero * tg.smoothstep(0.0, 0.012, h)
    # spalling: thin flakes lost from the surface (sharp-edged shallow patches)
    sp = tg.fbm(x, y, _f(1.5, W), 6, rng)
    spall = tg.smoothstep(0.30, 0.33, sp) * amount * (1.0 - 0.6 * carve)
    h -= 0.0028 * spall
    # honeycomb (alveolar) weathering in some zones of plain faces
    zone = tg.smoothstep(0.28, 0.55, tg.fbm(x, y, _f(0.9, W), 4, rng)) * (1.0 - 0.75 * carve) * amount
    f1h, _, cidh = tg.worley(x, y, _f(32, W), rng, jitter=0.85)
    bowl = np.clip(1.0 - (f1h / (0.45 + 0.2 * cidh)) ** 2, 0.0, 1.0)
    honey = zone * bowl**1.3
    h -= 0.0055 * honey
    # chipped arrises
    near = tg.smoothstep(0.035, 0.006, joint)
    chipn = tg.fbm(x, y, _f(14, W), 4, rng)
    chip = tg.smoothstep(0.12, 0.42, chipn) * near * amount
    h = tg.lerp(h, np.minimum(h, -0.007 - 0.004 * chipn), chip)
    # hairline cracks (sparse cell borders)
    f1c, f2c, cc = tg.worley(x, y, _f(1.2, W), rng)
    gate = tg.smoothstep(0.15, 0.45, tg.fbm(x, y, _f(3, W), 3, rng)) * (cc > 0.35)
    crack = tg.smoothstep(0.010, 0.0, f2c - f1c) * gate * amount
    h -= 0.004 * crack
    return h.astype(F), {"erosion": ero, "spall": spall, "honey": honey, "chip": chip, "crack": crack}


def surface(h: np.ndarray, ao: np.ndarray, masks: dict, wm: dict, size_m: tuple[float, float],
            rng: np.random.Generator, style: StoneStyle = RED_SANDSTONE,
            normal: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """LINEAR albedo (h,w,3) and roughness (h,w) for weathered sandstone."""
    n = h.shape[0]
    W = size_m[0]
    texel = W / n
    x, y = tg.coords(n, n, 1.0, 1.0)
    stone = masks.get("stone", np.zeros_like(h))
    joint = masks.get("joint", np.full_like(h, 9.0))
    nrm = tg.normal_from_height(h, texel) if normal is None else normal
    curv = tg.curvature(h, texel, 1.2)
    # ---- base tone: macro mottling + per-block tone and tint
    t = (0.5 + 0.2 * tg.fbm(x, y, _f(0.8, W), 5, rng) + 0.26 * (stone - 0.5)
         + 0.05 * tg.fbm(x, y, _f(30, W), 3, rng))
    bed = np.sin(2 * np.pi * (y * W * 6.5 + 1.4 * tg.fbm(x, y, _f(0.6, W), 3, rng)))
    t += 0.035 * bed * style.banding
    col = tg.gradient_map(np.clip(t, 0.0, 1.0), style.stops)
    tints = np.stack([tg.hex_to_linear(c) for c in style.tints])
    tidx = np.clip((stone * 7.31 % 1.0) * len(style.tints), 0, len(style.tints) - 1).astype(np.int64)
    col *= tints[tidx]
    # iron banding: broad tone waves + a few thin, faint liesegang lines (parallel, warped)
    wx, wy = tg.warp(x, y, 0.08, _f(0.5, W), 3, rng)
    phase = (wy * 0.8 + wx * 0.35) * W * 3.0
    col *= (1.0 + 0.06 * np.sin(2 * np.pi * phase) * style.banding)[..., None]
    lines = tg.smoothstep(0.965, 0.995, np.sin(2 * np.pi * phase * 2.0)) * style.banding
    lines *= tg.smoothstep(-0.1, 0.4, tg.fbm(x, y, _f(0.7, W), 3, rng))
    col *= (1.0 - 0.14 * lines)[..., None]
    # pale reduction spots (sparse, irregular)
    f1s, _, cs = tg.worley(x, y, _f(7, W), rng)
    edge = 0.05 * tg.fbm(x, y, _f(60, W), 2, rng)
    spot = tg.smoothstep(0.13, 0.06, f1s + edge) * (cs < 0.12) * style.spots
    col = tg.lerp(col, tg.hex_to_linear(style.spot_color)[None, None, :], (0.45 * spot)[..., None])
    # specks: dark mineral grains + light mica
    sp = tg.perlin(x * _f(220, W), y * _f(220, W), (_f(220, W), _f(220, W)), rng)
    col *= (1.0 - 0.35 * tg.smoothstep(0.5, 0.75, sp))[..., None]
    col *= (1.0 + 0.18 * tg.smoothstep(0.55, 0.8, -sp))[..., None]
    # fresh stone where spalled (paler, pinker), worn convex edges
    fresh = wm.get("spall", 0.0) + 0.6 * wm.get("chip", 0.0)
    col = tg.lerp(col, col * np.array([1.16, 1.12, 1.08], F), np.clip(fresh, 0, 1)[..., None] * 0.8)
    convex = tg.smoothstep(0.0, 6.0, curv)
    col *= (1.0 + 0.12 * convex)[..., None]
    # grime in recesses (AO), joints, cracks and honeycomb
    g = np.clip((1.0 - ao) * 1.7, 0.0, 1.0) ** 1.15
    g = np.clip(g + 0.6 * wm.get("crack", 0.0) + 0.35 * wm.get("honey", 0.0) + 0.4 * tg.smoothstep(0.004, 0.0, joint), 0, 1)
    col = tg.lerp(col, tg.hex_to_linear(style.dirt_color)[None, None, :], (0.55 * g)[..., None])
    # macro weathering: darker, greyer patches (soot / biological crust) and sun-bleached zones
    macro = tg.fbm(x, y, _f(0.6, W), 5, rng)
    crust = tg.smoothstep(0.05, 0.45, macro) * (0.5 + 0.5 * tg.smoothstep(0.0, 0.3, 1.0 - ao))
    lum = tg.luminance(col)[..., None]
    col = tg.lerp(col, lum * np.array([0.78, 0.74, 0.72], F), (0.35 * crust)[..., None]) * (1.0 - 0.18 * crust)[..., None]
    bleach = tg.smoothstep(-0.1, -0.45, macro)
    col = tg.lerp(col, col * np.array([1.12, 1.1, 1.08], F) + 0.01, (0.5 * bleach)[..., None])
    # dust settles on upward-facing ledges inside recesses
    up = tg.smoothstep(0.25, 0.7, nrm[..., 1]) * tg.smoothstep(0.02, 0.25, 1.0 - ao)
    col = tg.lerp(col, tg.hex_to_linear(style.dust_color)[None, None, :], (0.35 * up)[..., None])
    # water streaks running down from drip edges (downward-facing undersides)
    src = tg.smoothstep(0.25, 0.65, -nrm[..., 1])
    streak_noise = tg.smoothstep(-0.1, 0.5, tg.fbm(x, y, (_f(28, W), _f(1.5, W)), 3, rng))
    streak = tg.directional_blur_down(src * streak_noise, int(0.16 / texel), 0.988)
    streak = tg.blur(streak, 0.8)
    st = np.clip(streak, 0, 1)
    lum = tg.luminance(col)[..., None]
    col = tg.lerp(col, lum * np.array([0.85, 0.8, 0.78], F), (0.4 * st)[..., None]) * (1.0 - style.streak_dark * st)[..., None]
    # sparse lichen patches
    lz = tg.smoothstep(0.66, 0.8, tg.fbm(x, y, _f(0.9, W), 5, rng) * 0.5 + 0.5)
    lz *= tg.smoothstep(-0.2, 0.5, tg.fbm(x, y, _f(40, W), 3, rng)) * style.lichen
    col = tg.lerp(col, tg.hex_to_linear(style.lichen_color)[None, None, :], (0.4 * lz)[..., None])
    col = np.clip(col, 0.005, 0.9)
    # ---- roughness
    r = style.roughness + 0.05 * tg.fbm(x, y, _f(6, W), 3, rng)
    r += 0.06 * g + 0.05 * lz - 0.12 * convex - 0.04 * np.clip(fresh, 0, 1)
    r -= 0.18 * tg.smoothstep(0.62, 0.85, -sp)  # mica glints
    return col.astype(F), np.clip(r, 0.42, 0.98).astype(F)


__all__ = ["BUFF_SANDSTONE", "RED_SANDSTONE", "StoneStyle", "surface", "weather_height"]
