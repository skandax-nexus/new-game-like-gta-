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
    bed_color: str = "#c8b294"  # pale sedimentary beds (buff/cream layers)
    beds: float = 0.0


RED_SANDSTONE = StoneStyle(
    "red_sandstone",
    # Fatehpur Sikri / Mathura (Vindhyan) red sandstone: brick-red to purple-brown with buff beds.
    stops=[(0.0, "#5a3025"), (0.25, "#6b392b"), (0.5, "#7b4433"), (0.72, "#8b503d"), (1.0, "#9e6853")],
    tints=["#ffffff", "#f6ddd2", "#e6cdca", "#ffe9d8", "#dcc9c4", "#fff3ea", "#f0d6c4"],
    spot_color="#a88d78",
    dirt_color="#2a1d19",
    dust_color="#9c8574",
    lichen_color="#5c5c4a",
    streak_dark=0.12,
    spots=0.35,
    roughness=0.9,
    bed_color="#b2876d",
    beds=1.0,
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
    f1, _, cid = tg.worley(x, y, _f(75, W), rng)
    h += -0.0007 * tg.smoothstep(0.5, 0.05, f1) * (0.3 + cid) * tool * (cid > 0.25)
    # mineral grain ("sugary" sandstone surface, 2-8 mm)
    h += 0.0006 * tg.fbm(x, y, _f(130, W), 3, rng) + 0.0003 * tg.fbm(x, y, _f(330, W), 2, rng)
    # granular disintegration: sparse, irregular pits on exposed surfaces (relief included)
    f1p, _, cp = tg.worley(x, y, _f(80, W), rng, jitter=1.0)
    pz = tg.smoothstep(-0.1, 0.45, tg.fbm(x, y, _f(3, W), 4, rng)) * amount
    pit_edge = 0.25 + 0.12 * tg.fbm(x, y, _f(200, W), 2, rng)
    h -= 0.0007 * tg.smoothstep(pit_edge, 0.06, f1p) * (cp > 0.62) * pz
    # erosion: softened detail where exposed
    ero = tg.smoothstep(-0.2, 0.4, tg.fbm(x, y, _f(1.25, W), 5, rng)) * amount
    hb = tg.blur(h, 0.0032 / texel)
    h = tg.lerp(h, hb, 0.8 * ero)
    h -= 0.0016 * ero * tg.smoothstep(0.0, 0.012, h)
    # spalling: thin flakes lost from the surface (sharp-edged shallow patches)
    sp = tg.fbm(x, y, _f(1.5, W), 6, rng)
    spall = tg.smoothstep(0.30, 0.33, sp) * amount * (1.0 - 0.6 * carve)
    h -= 0.0028 * spall
    # honeycomb (alveolar) weathering in some zones of plain faces
    zone = tg.smoothstep(0.36, 0.62, tg.fbm(x, y, _f(0.9, W), 4, rng)) * (1.0 - 0.75 * carve) * amount
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
    t = (0.5 + 0.2 * tg.fbm(x, y, _f(0.8, W), 5, rng) + 0.36 * (stone - 0.5)
         + 0.07 * tg.fbm(x, y, _f(12, W), 3, rng) + 0.06 * tg.fbm(x, y, _f(45, W), 3, rng)
         + 0.05 * tg.fbm(x, y, _f(160, W), 2, rng))
    bed = np.sin(2 * np.pi * (y * _f(6.5, W) + 1.4 * tg.fbm(x, y, _f(0.6, W), 3, rng)))  # integer cycles: seamless
    t += 0.035 * bed * style.banding
    col = tg.gradient_map(np.clip(t, 0.0, 1.0), style.stops)
    # hue mottling independent of value: purple-brown vs orange-red zones (5-30 cm), like real Vindhyan stone
    hue = tg.fbm(x, y, _f(3.0, W), 4, rng) * 0.7 + tg.fbm(x, y, _f(11, W), 3, rng) * 0.3
    warm = np.array([1.10, 0.96, 0.84], F)
    cool = np.array([0.88, 0.90, 1.06], F)
    hmix = tg.smoothstep(-0.35, 0.35, hue)[..., None]
    col *= cool * (1 - hmix) + warm * hmix
    tints = np.stack([tg.hex_to_linear(c) for c in style.tints])
    tidx = np.clip((stone * 7.31 % 1.0) * len(style.tints), 0, len(style.tints) - 1).astype(np.int64)
    col *= tints[tidx]
    # iron banding: broad tone waves + a few thin, faint liesegang lines (parallel, warped). The wave vector is
    # integer cycles per tile (2.4 / m in v, 1.05 / m in u, rounded: 5 and 2 on a 2 m tile, as
    # materials/_sandstone.iron_banding), so the bands meet themselves across the tile border.
    wx, wy = tg.warp(x, y, 0.08, _f(0.5, W), 3, rng)
    phase = wy * _f(2.4, W) + wx * int(round(1.05 * W))
    col *= (1.0 + 0.06 * np.sin(2 * np.pi * phase) * style.banding)[..., None]
    lines = tg.smoothstep(0.965, 0.995, np.sin(2 * np.pi * phase * 2.0)) * style.banding
    lines *= tg.smoothstep(-0.1, 0.4, tg.fbm(x, y, _f(0.7, W), 3, rng))
    col *= (1.0 - 0.14 * lines)[..., None]
    # pale reduction spots (sparse, irregular)
    f1s, _, cs = tg.worley(x, y, _f(5, W), rng)
    edge = 0.06 * tg.fbm(x, y, _f(50, W), 3, rng)
    size = 0.05 + 0.12 * (cs * 13.7 % 1.0)
    spot = tg.smoothstep(size, size * 0.35, f1s + edge) * (cs < 0.09) * style.spots
    spot = tg.blur(spot, 1.5)
    col = tg.lerp(col, tg.hex_to_linear(style.spot_color)[None, None, :], (0.32 * spot)[..., None])
    # pale sedimentary beds running through the blocks (warped, thin, intermittent)
    if style.beds > 0:
        bx, by = tg.warp(x, y, 0.03, _f(1.0, W), 3, rng)
        bed = np.sin(2 * np.pi * (by * W * 2.3 + 0.15 * tg.fbm(bx, by, _f(2, W), 3, rng)))
        bed = tg.smoothstep(0.88, 0.985, bed) * tg.smoothstep(-0.05, 0.35, tg.fbm(x, y, (_f(1.5, W), _f(4, W)), 3, rng))
        bed *= 0.55 + 0.45 * tg.fbm(x, y, _f(25, W), 2, rng)
        col = tg.lerp(col, tg.hex_to_linear(style.bed_color)[None, None, :], np.clip(0.24 * bed * style.beds, 0, 1)[..., None])
    # specks: dark mineral grains + light mica
    sp = tg.perlin(x * _f(220, W), y * _f(220, W), (_f(220, W), _f(220, W)), rng)
    col *= (1.0 - 0.35 * tg.smoothstep(0.5, 0.75, sp))[..., None]
    col *= (1.0 + 0.18 * tg.smoothstep(0.55, 0.8, -sp))[..., None]
    # fresh stone where spalled (paler, pinker), worn convex edges
    fresh = wm.get("spall", 0.0) + 0.6 * wm.get("chip", 0.0)
    col = tg.lerp(col, col * np.array([1.08, 1.06, 1.04], F), np.clip(fresh, 0, 1)[..., None] * 0.7)
    convex = tg.smoothstep(0.0, 6.0, curv)
    col *= (1.0 + 0.16 * convex)[..., None]
    # grime in recesses (AO), joints, cracks and honeycomb - soft-edged, deeper where more occluded
    g = np.clip((1.0 - ao) * 2.1, 0.0, 1.0) ** 1.05
    g = np.clip(g + 0.6 * wm.get("crack", 0.0) + 0.35 * wm.get("honey", 0.0) + 0.45 * tg.smoothstep(0.005, 0.0, joint), 0, 1)
    g = np.clip(tg.blur(g, 1.2) * 1.1, 0, 1)
    grime_var = 0.75 + 0.25 * tg.fbm(x, y, _f(8, W), 3, rng)
    col = tg.lerp(col, tg.hex_to_linear(style.dirt_color)[None, None, :], (0.68 * g * grime_var)[..., None])
    # pit interiors collect dirt (granular disintegration)
    cav = np.clip(-tg.cavity(h, 2.0) / 0.0006, 0.0, 1.0)
    col *= (1.0 - 0.25 * cav)[..., None]
    # macro weathering: darker, greyer patches (soot / biological crust) and sun-bleached zones
    macro = tg.fbm(x, y, _f(0.6, W), 5, rng)
    crust = tg.smoothstep(0.0, 0.4, macro) * (0.5 + 0.5 * tg.smoothstep(0.0, 0.3, 1.0 - ao))
    lum = tg.luminance(col)[..., None]
    col = tg.lerp(col, lum * np.array([0.78, 0.74, 0.72], F), (0.35 * crust)[..., None]) * (1.0 - 0.18 * crust)[..., None]
    bleach = tg.smoothstep(-0.1, -0.45, macro)
    col = tg.lerp(col, col * np.array([1.12, 1.1, 1.08], F) + 0.01, (0.5 * bleach)[..., None])
    # dust settles on upward-facing ledges inside recesses
    up = tg.smoothstep(0.25, 0.7, nrm[..., 1]) * tg.smoothstep(0.02, 0.25, 1.0 - ao)
    col = tg.lerp(col, tg.hex_to_linear(style.dust_color)[None, None, :], (0.22 * up)[..., None])
    # water streaks running down from drip edges (downward-facing undersides)
    src = tg.smoothstep(0.25, 0.65, -nrm[..., 1])
    streak_noise = tg.smoothstep(0.1, 0.6, tg.fbm(x, y, (_f(22, W), _f(1.5, W)), 3, rng))
    streak = tg.directional_blur_down(src * streak_noise, int(0.16 / texel), 0.988)
    streak = tg.blur(streak, 0.8)
    st = np.clip(streak, 0, 1)
    lum = tg.luminance(col)[..., None]
    col = tg.lerp(col, lum * np.array([0.85, 0.8, 0.78], F), (0.25 * st)[..., None]) * (1.0 - style.streak_dark * st)[..., None]
    # sparse lichen patches
    lz = tg.smoothstep(0.66, 0.8, tg.fbm(x, y, _f(0.9, W), 5, rng) * 0.5 + 0.5)
    lz *= tg.smoothstep(-0.2, 0.5, tg.fbm(x, y, _f(40, W), 3, rng)) * style.lichen
    col = tg.lerp(col, tg.hex_to_linear(style.lichen_color)[None, None, :], (0.4 * lz)[..., None])
    col = np.clip(col, 0.005, 0.9)
    # ---- roughness
    r = style.roughness + 0.05 * tg.fbm(x, y, _f(6, W), 3, rng) + 0.03 * tg.fbm(x, y, _f(60, W), 2, rng)
    r += 0.05 * g + 0.05 * lz - 0.08 * convex - 0.04 * np.clip(fresh, 0, 1)
    r -= 0.18 * tg.smoothstep(0.62, 0.85, -sp)  # mica glints
    return col.astype(F), np.clip(r, 0.42, 0.98).astype(F)


__all__ = ["BUFF_SANDSTONE", "RED_SANDSTONE", "StoneStyle", "surface", "weather_height"]
