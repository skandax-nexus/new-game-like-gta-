"""
WP1 material kit (package-local helper, not an asset): texture-set builder for tiling PBR sets, seamless noise
in METERS, vectorized shape scatter, bonds / stones layouts, calibration to the Art Director's targets, QA
statistics, set classes (ASSET_LIST §0.2), 256 px swatch and Cycles previews (lookdev + 3x3 tiling under
raking golden light). OWNER: Technical Artist A (TA-01). Used by materials/, terrain/ and decals/ scripts
(terrain/ and decals/ import it through their sibling `_terrainkit` / `_decalkit` shims and list this file
in `@inputs`, because the runner hashes sibling helpers only).

    kit = Kit(__file__, cls="S", size=(2.0, 2.0), target="materials:MATERIAL_PRESETS.brick_fired_old")
    x, y = kit.x, kit.y                          # tile-unit coords (top-down, periodic), internal resolution
    h = kit.fbm(0.5, 4) * 0.002                  # seamless fBm with 0.5 m features, 2 mm amplitude
    ...
    kit.finish(height=h, albedo=alb, rough=r, preview="wall", description="...")

Conventions: images are TOP-DOWN float32 arrays (row 0 = v 1), albedo is LINEAR rgb, heights in meters,
normals OpenGL (+Y = +V). Everything is periodic over the tile so 3x3 repeats are seamless.

Pipeline of finish():
    internal-res height/albedo/roughness  ->  normal from height (internal res, box-filtered to the data res,
    Toksvig roughness for the lost normal variance)  ->  AO (Cycles heightfield bake or horizon AO, data res)
    ->  albedo calibrated to the target (linear mean per channel, luminance clamped to ALBEDO_LIMITS)  ->
    roughness remapped so its 5th..95th percentiles span the preset range and its mean hits the preset  ->
    PNGs (baseColor 8-bit sRGB [+ alpha], normal 16-bit, ORM 8-bit, height 16-bit cache-only, swatch 256 px)
    ->  QA statistics in asset.json (material.qa)  ->  Cycles previews (lookdev + 3x3 tiling).

Set classes (ASSET_LIST §0.2) -> source sizes and publish `tierScale` (publish.mjs: size = min(src, tier max x
tierScale), tier max 2048 / 1024 / 512):
    H  2048 all maps                      -> 2048 / 1024 / 512
    S  1024 albedo, 1024 normal/ORM x0.5  -> albedo 1024 / 1024 / 512, normal+ORM 1024 / 512 / 256
    C  1024 albedo x0.5, 512 data x0.5    -> albedo 1024 / 512 / 256, normal+ORM 512 / 512 / 256
    T  as C (spec asks albedo 512 on mobile: needs a per-tier size map in publish.mjs, requested from the CTO)
    A  1024 all maps x0.5                 -> 1024 / 512 / 256 (decal atlas: opacity in ORM.b needs the albedo res)
"""
from __future__ import annotations

import json
import math
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

from lib import bake, core, render, texgen as tg

F = np.float32

CLASSES: dict[str, dict[str, Any]] = {
    "H": dict(albedo=2048, data=2048, albedo_scale=1.0, data_scale=1.0, internal=2048),
    "S": dict(albedo=1024, data=1024, albedo_scale=1.0, data_scale=0.5, internal=2048),
    "C": dict(albedo=1024, data=512, albedo_scale=0.5, data_scale=0.5, internal=2048),
    "T": dict(albedo=1024, data=512, albedo_scale=0.5, data_scale=0.5, internal=2048),
    "A": dict(albedo=1024, data=1024, albedo_scale=0.5, data_scale=0.5, internal=2048),
}

# Golden-hour raking light for the 3x3 tiling shot and golden lookdev (sun elevation in degrees).
GOLDEN_SUN = dict(elevation=11.0, azimuth=252.0, strength=3.6, color="#ffbf80")
DAY_SUN = dict(elevation=38.0, azimuth=215.0, strength=4.4, color="#fff0dc")
# The tiling shot is lit almost only by the low sun (weak sky) so relief and repetition read hardest.
TILING_SUN = dict(strength=9.0)
TILING_SKY = 0.16
# One exposure for every set (judge albedo across the library: lime plaster bright, basalt dark, nothing clipped).
PREVIEW_EXPOSURE = -1.0
# The raking tiling shot receives little light on a horizontal plane: expose it ~1 stop brighter.
TILING_EXPOSURE = -0.2
PREVIEW_SPP_CAP = 40


# Art Director desk rulings that land in src/render/style after this republish (docs/art/reviews/ta-01.md, AD-8:
# roofs and ground are the largest RTS areas and sit next to the enemy colour #e0533d and saffron). Applied only while
# the preset still holds the old value, so the AD's own preset change makes them no-ops. scripts/shots/ta-01.cjs
# measures against the same table.
AD_RULINGS: dict[str, tuple[str, str]] = {
    "materials:MATERIAL_PRESETS.roof_tile_terracotta": ("#a65a3c", "#a6644a"),
    "terrain:TERRAIN_LAYERS.laterite_soil": ("#8e5038", "#8e5a44"),
    "materials:MATERIAL_PRESETS.laterite_block": ("#8f4a34", "#8f5240"),
}


# ------------------------------------------------------------------------------------------- style values
def style(ref: str) -> Any:
    """A src/render/style value (`module:EXPORT.path`): from SAMRAJYA_STYLE (runner, declared via @style) or
    evaluated with `node tools/assets/build.mjs --style` for direct runs."""
    env = os.environ.get("SAMRAJYA_STYLE")
    if env:
        values = json.loads(env)
        if ref in values:
            return values[ref]
    out = subprocess.check_output(["node", str(core.REPO_ROOT / "tools/assets/build.mjs"), "--style", ref], cwd=core.REPO_ROOT)
    return json.loads(out)[ref]


def hexlin(h: str) -> np.ndarray:
    return tg.hex_to_linear(h).astype(F)


def srgb8(lin: np.ndarray) -> np.ndarray:
    """Linear -> sRGB 0..255 floats (what an 8-bit encode stores, before rounding)."""
    return tg.linear_to_srgb(np.clip(lin, 0.0, 1.0)) * 255.0


# ------------------------------------------------------------------------------------------- color ops
def hsv_saturation(rgb_srgb01: np.ndarray) -> np.ndarray:
    mx = rgb_srgb01.max(axis=-1)
    mn = rgb_srgb01.min(axis=-1)
    return np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0).astype(F)


def hue_rotate(lin: np.ndarray, turns: np.ndarray | float) -> np.ndarray:
    """Rotate hue (in sRGB-ish YIQ chroma plane, luminance kept) by `turns` of the hue circle per pixel."""
    s = tg.linear_to_srgb(np.clip(lin, 0, 1))
    yiq = np.einsum("...c,dc->...d", s, np.array([[0.299, 0.587, 0.114], [0.596, -0.274, -0.322], [0.211, -0.523, 0.312]], F))
    a = np.asarray(turns, F) * (2.0 * np.pi)
    ca, sa = np.cos(a), np.sin(a)
    i2 = yiq[..., 1] * ca - yiq[..., 2] * sa
    q2 = yiq[..., 1] * sa + yiq[..., 2] * ca
    yiq = np.stack([yiq[..., 0], i2, q2], axis=-1)
    back = np.einsum("...c,dc->...d", yiq, np.array([[1.0, 0.956, 0.621], [1.0, -0.272, -0.647], [1.0, -1.106, 1.703]], F))
    return tg.srgb_to_linear(np.clip(back, 0, 1)).astype(F)


def saturate_by(lin: np.ndarray, k: np.ndarray | float) -> np.ndarray:
    """Scale chroma around the pixel's luminance (k < 1 desaturates)."""
    lum = tg.luminance(lin)[..., None]
    k = np.asarray(k, F)
    if k.ndim == lin.ndim - 1:
        k = k[..., None]
    return np.clip(lum + (lin - lum) * k, 0.0, None).astype(F)


def compress_chroma(lin: np.ndarray, keep: float) -> np.ndarray:
    """Keep only `keep` of each pixel's chroma deviation from the set's mean chroma (value variation untouched):
    pixel = lum-scaled mean colour + keep x (pixel - lum-scaled mean colour). Tames hue / saturation noise."""
    m = lin.reshape(-1, 3).mean(axis=0, dtype=np.float64)
    lm = float(tg.luminance(m[None, None, :])[0, 0])
    base = tg.luminance(lin)[..., None] / max(lm, 1e-6) * m[None, None, :]
    return np.clip(base + (lin - base) * keep, 0.0, None).astype(F)


def tint(lin: np.ndarray, hexcol: str, amount: np.ndarray | float) -> np.ndarray:
    """Lerp toward a color (amount per pixel)."""
    a = np.asarray(amount, F)
    if a.ndim == lin.ndim - 1:
        a = a[..., None]
    return (lin + (hexlin(hexcol)[None, None, :] - lin) * a).astype(F)


def mul(lin: np.ndarray, factor: np.ndarray | float) -> np.ndarray:
    f = np.asarray(factor, F)
    if f.ndim == lin.ndim - 1:
        f = f[..., None]
    return (lin * f).astype(F)


def ramp(t: np.ndarray, stops: list[tuple[float, str]]) -> np.ndarray:
    return tg.gradient_map(np.clip(t, 0.0, 1.0), stops).astype(F)


# ------------------------------------------------------------------------------------------- scatter
@dataclass
class Scatter:
    """Max-composited scattered shapes: height (m, -inf where empty), the winner's id 0..1, its local
    coordinates (m, rotated frame), angle (rad), per-seed extra randoms e1/e2, and coverage mask."""
    h: np.ndarray
    id: np.ndarray
    lu: np.ndarray
    lv: np.ndarray
    ang: np.ndarray
    e1: np.ndarray
    e2: np.ndarray

    @property
    def mask(self) -> np.ndarray:
        return (self.h > -1e5).astype(F)

    def height(self, floor: float = 0.0) -> np.ndarray:
        return np.where(self.h > -1e5, self.h, floor).astype(F)


# Shape functions: (lu, lv, e1, e2) in METERS (rotated, already divided by the seed scale) -> height (m) or -1e9.
def shape_pebble(rx: float, ry: float, h: float, power: float = 0.7, lump: float = 0.18) -> Callable:
    def fn(lu, lv, e1, e2):
        a = rx * (0.8 + 0.4 * e1)
        b = ry * (0.8 + 0.4 * e2)
        ang = np.arctan2(lv, lu)
        r = np.sqrt((lu / a) ** 2 + (lv / b) ** 2) * (1.0 + lump * (np.sin(3 * ang + e1 * 6.28) * 0.5 + np.sin(5 * ang + e2 * 6.28) * 0.3) * 0.5)
        t = np.clip(1.0 - r * r, 0.0, 1.0)
        return np.where(r < 1.0, h * (0.7 + 0.6 * e2) * t**power, -1e9)
    return fn


def shape_blade(length: float, width: float, h: float, bend: float = 0.25) -> Callable:
    """Tapered grass blade / straw along +u from the seed (root at lu=0), bent sideways by `bend`."""
    def fn(lu, lv, e1, e2):
        L = length * (0.6 + 0.8 * e1)
        t = lu / L
        cv = lv - bend * L * (e2 - 0.5) * 2.0 * t * t
        w = width * (0.6 + 0.6 * e2) * np.clip(1.0 - t, 0.0, 1.0) ** 0.6
        inside = (t >= 0.0) & (t <= 1.0) & (np.abs(cv) < w)
        prof = np.sqrt(np.clip(1.0 - (cv / np.maximum(w, 1e-6)) ** 2, 0.0, 1.0))
        return np.where(inside, h * (0.5 + 0.5 * e1) * (0.35 + 0.65 * prof) * (1.0 - 0.5 * t), -1e9)
    return fn


def shape_leaf(length: float, width: float, h: float, tip: float = 1.4) -> Callable:
    """Lanceolate leaf with a midrib groove and lateral veins, petiole at lu=-L/2."""
    def fn(lu, lv, e1, e2):
        L = length * (0.7 + 0.6 * e1)
        W = width * (0.75 + 0.5 * e2)
        t = lu / L + 0.5
        half = W * np.clip(np.sin(np.pi * np.clip(t, 0, 1)) ** 0.8 * (1.0 - 0.25 * t), 0, 1) * np.where(t > 0.6, (1 - (t - 0.6) / 0.4) ** (tip - 1.0) + 0.0, 1.0)
        inside = (t > 0.0) & (t < 1.0) & (np.abs(lv) < half)
        rel = np.abs(lv) / np.maximum(half, 1e-6)
        curl = 0.4 * rel * rel  # edges curl up (dry leaves)
        rib = -0.25 * np.exp(-(lv / (0.07 * W)) ** 2)
        vein = -0.08 * (np.sin((t * 9.0 - rel * 3.0) * np.pi) > 0.92)
        return np.where(inside, h * (0.45 + 0.55 * e1) * (0.6 + curl + rib + vein), -1e9)
    return fn


def shape_disc(r: float, h: float, edge: float = 0.25) -> Callable:
    def fn(lu, lv, e1, e2):
        rr = r * (0.7 + 0.6 * e1)
        d = np.sqrt(lu * lu + lv * lv) / rr
        return np.where(d < 1.0, h * (0.6 + 0.4 * e2) * tg.smoothstep(1.0, 1.0 - edge, d), -1e9)
    return fn


def shape_rosette(r: float, h: float = 0.0006, lobes: tuple[int, int] = (7, 13)) -> Callable:
    """Foliose / crustose lichen rosette: lobed margin (radius r +-60 %, 7-13 lobes, irregular), a slightly
    raised rim of young lobes and an older, flatter centre. Returns height (m) inside, -1e9 outside; the scatter's
    lu/lv let callers shade the paler centre."""
    def fn(lu, lv, e1, e2):
        rr = r * (0.4 + 1.2 * e1 * e1)
        ang = np.arctan2(lv, lu)
        k = lobes[0] + np.floor(e2 * (lobes[1] - lobes[0] + 1))
        edge = rr * (1.0 + 0.18 * np.sin(k * ang + 6.28 * e2) + 0.1 * np.sin((k + 3) * ang + 3.1 * e1)
                     + 0.08 * np.sin(2 * ang + 9.0 * e1))
        d = np.sqrt(lu * lu + lv * lv) / np.maximum(edge, 1e-6)
        prof = 0.55 + 0.45 * tg.smoothstep(0.45, 0.85, d)  # raised young rim, flatter old centre
        return np.where(d < 1.0, h * prof, -1e9)
    return fn


# ------------------------------------------------------------------------------------------- kit
class Kit:
    def __init__(self, script: str, cls: str, size: tuple[float, float], target: str | None = None,
                 internal: int | None = None, rough_range: tuple[float, float] | None = None,
                 rough_spread: float = 0.05, family: str | None = None, saturation_limit: str = "large",
                 channel_max_srgb: int | None = None, sat_cap: float | None = None,
                 value_cap: float | None = None) -> None:
        """`target` = style ref of the preset (materials:MATERIAL_PRESETS.<id> or terrain:TERRAIN_LAYERS.<id>)."""
        self.ctx = core.begin(script, kind="material")
        if cls not in CLASSES:
            raise ValueError(f"set class {cls} not in {list(CLASSES)}")
        self.cls = cls
        self.spec = dict(CLASSES[cls])
        self.size = (float(size[0]), float(size[1]))
        W, H = self.size
        self.rng = self.ctx.rng
        full_internal = internal or self.spec["internal"]
        self.N = self.ctx.res(full_internal, max(256, full_internal // 4))
        self.albedo_res = self.ctx.res(self.spec["albedo"], max(128, self.spec["albedo"] // 4))
        self.data_res = self.ctx.res(self.spec["data"], max(128, self.spec["data"] // 4))
        self.texel = W / self.N
        self.x, self.y = tg.coords(self.N, self.N, 1.0, 1.0)
        self.target_ref = target
        self.preset: dict[str, Any] = dict(style(target)) if target else {}
        ruling = AD_RULINGS.get(target or "")
        if ruling and str(self.preset.get("baseColor", "")).lower() == ruling[0]:
            core.log(f"AD-8 ruling: {target} baseColor {ruling[0]} -> {ruling[1]}")
            self.preset["baseColor"] = ruling[1]
        self.limits: dict[str, Any] = style("palette:ALBEDO_LIMITS")
        self.sat_limits: dict[str, float] = style("palette:SATURATION_LIMITS")
        self.family = family
        # per-texel HSV caps enforced inside the calibration loop (AD-4: grass blades never lime)
        self.sat_cap = sat_cap
        self.value_cap = value_cap
        self.saturation_limit = saturation_limit
        # per-channel ceiling (e.g. lime plaster "never above sRGB 236"); None = luminance limit only
        self.channel_max = float(tg.srgb_to_linear(np.array(channel_max_srgb / 255.0, F))) if channel_max_srgb else 0.98
        if rough_range is not None:
            self.rough_range = (float(rough_range[0]), float(rough_range[1]))
        elif "roughnessRange" in self.preset:
            rr = self.preset["roughnessRange"]
            self.rough_range = (float(rr[0]), float(rr[1]))
        else:
            r0 = float(self.preset.get("roughness", 0.85))
            self.rough_range = (max(0.02, r0 - rough_spread), min(1.0, r0 + rough_spread))
        core.log(f"kit class={cls} size={self.size} internal={self.N} albedo={self.albedo_res} data={self.data_res} "
                 f"target={self.preset.get('baseColor')} rough={self.preset.get('roughness')} range={self.rough_range}")

    # ------------------------------------------------------------------ units
    def cells(self, feature_m: float) -> tuple[int, int]:
        """Integer (periodic) lattice cells per tile for features of ~feature_m meters."""
        W, H = self.size
        return max(1, int(round(W / feature_m))), max(1, int(round(H / feature_m)))

    def px(self, meters: float) -> float:
        return meters / self.texel

    # ------------------------------------------------------------------ noise (periodic, meters)
    def fbm(self, feature_m: float, octaves: int = 4, gain: float = 0.5, ridged: bool = False,
            x: np.ndarray | None = None, y: np.ndarray | None = None, aniso: tuple[float, float] = (1.0, 1.0)) -> np.ndarray:
        """Seamless fBm, first octave ~feature_m; aniso (sx, sy) stretches features (e.g. (1, 8) = streaks
        8x longer along x... values are feature multipliers per axis). Range ~[-1, 1] ([0, 1] ridged)."""
        W, H = self.size
        bx = max(1, int(round(W / (feature_m * aniso[0]))))
        by = max(1, int(round(H / (feature_m * aniso[1]))))
        return tg.fbm(self.x if x is None else x, self.y if y is None else y, (bx, by), octaves, self.rng, gain=gain, ridged=ridged)

    def worley(self, cell_m: float, jitter: float = 1.0, x: np.ndarray | None = None, y: np.ndarray | None = None,
               aniso: tuple[float, float] = (1.0, 1.0)):
        W, H = self.size
        cx = max(1, int(round(W / (cell_m * aniso[0]))))
        cy = max(1, int(round(H / (cell_m * aniso[1]))))
        return tg.worley(self.x if x is None else x, self.y if y is None else y, (cx, cy), self.rng, jitter)

    def warp(self, amount_m: float, feature_m: float, octaves: int = 3, x: np.ndarray | None = None,
             y: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
        W, H = self.size
        xx = self.x if x is None else x
        yy = self.y if y is None else y
        wx = self.fbm(feature_m, octaves, x=xx, y=yy)
        wy = self.fbm(feature_m, octaves, x=xx, y=yy)
        return (xx + wx * amount_m / W).astype(F), (yy + wy * amount_m / H).astype(F)

    def blur(self, img: np.ndarray, sigma_m: float) -> np.ndarray:
        return tg.blur(img, sigma_m / self.texel)

    def white(self, cells_m: float | None = None) -> np.ndarray:
        """Per-texel (or per-cell, nearest) white noise 0..1."""
        if cells_m is None:
            return self.rng.uniform(0.0, 1.0, (self.N, self.N)).astype(F)
        cx, cy = self.cells(cells_m)
        g = self.rng.uniform(0.0, 1.0, (cy, cx)).astype(F)
        ix = np.floor(self.x * cx).astype(np.int64) % cx
        iy = np.floor(self.y * cy).astype(np.int64) % cy
        return g[iy, ix]

    # ------------------------------------------------------------------ scatter
    def scatter(self, cell_m: float | tuple[float, float], shape: Callable, density: float = 1.0, jitter: float = 1.0,
                angle: tuple[float, float] | None = (0.0, 2 * math.pi), scale: tuple[float, float] = (1.0, 1.0),
                x: np.ndarray | None = None, y: np.ndarray | None = None, density_map: np.ndarray | None = None,
                angle_map: np.ndarray | None = None) -> Scatter:
        """One shape per lattice cell (jittered seed), evaluated for the 3x3 neighbour seeds and max-composited.
        Shapes may extend up to ~1 cell from their seed. density_map (0..1 per texel) gates seeds by the value
        at the texel (soft placement); angle_map adds a per-texel angle (flow-aligned ripples, wind)."""
        W, H = self.size
        cm = (cell_m, cell_m) if isinstance(cell_m, (int, float)) else cell_m
        cx = max(1, int(round(W / cm[0])))
        cy = max(1, int(round(H / cm[1])))
        sx, sy = W / cx, H / cy
        xx = self.x if x is None else x
        yy = self.y if y is None else y
        X = xx * cx
        Y = yy * cy
        ix = np.floor(X).astype(np.int64)
        iy = np.floor(Y).astype(np.int64)
        r = self.rng
        jx = r.uniform(0.5 - 0.5 * jitter, 0.5 + 0.5 * jitter, (cy, cx)).astype(F)
        jy = r.uniform(0.5 - 0.5 * jitter, 0.5 + 0.5 * jitter, (cy, cx)).astype(F)
        ang = (r.uniform(angle[0], angle[1], (cy, cx)) if angle is not None else np.zeros((cy, cx))).astype(F)
        scl = r.uniform(scale[0], scale[1], (cy, cx)).astype(F)
        pres = r.uniform(0.0, 1.0, (cy, cx)).astype(F)
        rid = r.uniform(0.0, 1.0, (cy, cx)).astype(F)
        e1 = r.uniform(0.0, 1.0, (cy, cx)).astype(F)
        e2 = r.uniform(0.0, 1.0, (cy, cx)).astype(F)
        best = np.full(X.shape, -1e9, F)
        out = {k: np.zeros(X.shape, F) for k in ("id", "lu", "lv", "ang", "e1", "e2")}
        for oy in (-1, 0, 1):
            for ox in (-1, 0, 1):
                nx = ix + ox
                ny = iy + oy
                wx = nx % cx
                wy = ny % cy
                dx = (X - (nx + jx[wy, wx])) * sx
                dy = (Y - (ny + jy[wy, wx])) * sy
                a = ang[wy, wx]
                if angle_map is not None:
                    a = a + angle_map
                ca, sa = np.cos(a), np.sin(a)
                s = scl[wy, wx]
                lu = (dx * ca + dy * sa) / s
                lv = (-dx * sa + dy * ca) / s
                hh = shape(lu, lv, e1[wy, wx], e2[wy, wx]) * s
                gate = pres[wy, wx] < (density if density_map is None else density * density_map)
                hh = np.where(gate, hh, -1e9)
                better = hh > best
                best = np.where(better, hh, best)
                for k, v in (("id", rid[wy, wx]), ("lu", lu * s), ("lv", lv * s), ("ang", a), ("e1", e1[wy, wx]), ("e2", e2[wy, wx])):
                    out[k] = np.where(better, v, out[k])
        best = np.where(best > -1e5, best, -1e9).astype(F)
        return Scatter(best, out["id"], out["lu"], out["lv"], out["ang"], out["e1"], out["e2"])

    def facets(self, cell_m: float, slope: float = 0.3, jitter: float = 0.95, x: np.ndarray | None = None,
               y: np.ndarray | None = None, aniso: tuple[float, float] = (1.0, 1.0)) -> dict[str, np.ndarray]:
        """Angular fracture facets: periodic Voronoi cells, each a random plane through its seed (gradient up to
        `slope` m/m), so neighbouring chips meet in sharp steps and creases instead of round pillows. Returns h (m,
        the nearest cell's plane), id (0..1), d (m, ~distance to the cell border), f1 (m from the seed)."""
        W, H = self.size
        cx = max(1, int(round(W / (cell_m * aniso[0]))))
        cy = max(1, int(round(H / (cell_m * aniso[1]))))
        sx, sy = W / cx, H / cy
        r = self.rng
        jx = r.uniform(0.5 - 0.5 * jitter, 0.5 + 0.5 * jitter, (cy, cx)).astype(F)
        jy = r.uniform(0.5 - 0.5 * jitter, 0.5 + 0.5 * jitter, (cy, cx)).astype(F)
        ga = r.uniform(0.0, 2 * math.pi, (cy, cx)).astype(F)
        gm = (slope * np.sqrt(r.uniform(0.0, 1.0, (cy, cx)))).astype(F)
        gx, gy = gm * np.cos(ga), gm * np.sin(ga)
        rid = r.uniform(0.0, 1.0, (cy, cx)).astype(F)
        xx = self.x if x is None else x
        yy = self.y if y is None else y
        X, Y = xx * cx, yy * cy
        ix = np.floor(X).astype(np.int64)
        iy = np.floor(Y).astype(np.int64)
        f1 = np.full(X.shape, 1e9, F)
        f2 = np.full(X.shape, 1e9, F)
        hh = np.zeros(X.shape, F)
        idv = np.zeros(X.shape, F)
        for oy in (-1, 0, 1):
            for ox in (-1, 0, 1):
                nx, ny = ix + ox, iy + oy
                wx, wy = nx % cx, ny % cy
                dx = (X - (nx + jx[wy, wx])) * sx
                dy = (Y - (ny + jy[wy, wx])) * sy
                d = np.sqrt(dx * dx + dy * dy).astype(F)
                closer = d < f1
                f2 = np.where(closer, f1, np.minimum(f2, d))
                hh = np.where(closer, gx[wy, wx] * dx + gy[wy, wx] * dy, hh)
                idv = np.where(closer, rid[wy, wx], idv)
                f1 = np.where(closer, d, f1)
        return {"h": hh.astype(F), "id": idv, "d": ((f2 - f1) * 0.5).astype(F), "f1": f1}

    def lichen(self, zone: np.ndarray, coverage: float = 0.12, patch_m: float = 0.35,
               rosette_m: float = 0.03, rosette_density: float = 0.5) -> dict[str, np.ndarray]:
        """Lichen as nature grows it (AD-5: no round discs): crustose patches with fractal, domain-warped margins
        that follow `zone` (0..1, e.g. upward faces and drip lines), plus clustered lobed rosettes of very varied
        size (rosette_m +-60 %) inside and around the patches. Returns crust (0..1), rosette (0..1), centre (old,
        paler rosette centres 0..1) and height (m)."""
        wx, wy = self.warp(patch_m * 0.5, patch_m, 3)
        n = (self.fbm(patch_m, 5, gain=0.55, x=wx, y=wy) * 0.5 + 0.5) + 0.55 * (zone - 0.5)
        thr = float(np.percentile(n, 100.0 * (1.0 - coverage)))
        crust = tg.smoothstep(thr, thr + 0.02, n + 0.04 * self.fbm(patch_m * 0.08, 2))
        dens = np.clip(tg.smoothstep(thr - 0.12, thr + 0.02, n) * (0.4 + 0.6 * zone), 0.0, 1.0)
        sc = self.scatter(rosette_m * 1.6, shape_rosette(rosette_m), density=rosette_density, density_map=dens)
        ros = sc.mask
        rel = np.sqrt(sc.lu ** 2 + sc.lv ** 2) / max(rosette_m, 1e-6)
        centre = ros * tg.smoothstep(0.5, 0.1, rel * (0.6 + 0.8 * (1.0 - sc.e1)))
        hgt = 0.0003 * crust + sc.height(0.0)
        return {"crust": crust.astype(F), "rosette": ros, "centre": centre.astype(F), "h": hgt.astype(F)}

    def specks(self, cell_m: float, coverage: float = 0.008, size: tuple[float, float] = (0.002, 0.012),
               cluster_m: float = 0.4) -> np.ndarray:
        """Clustered, size-varied specks (calcrete / salt / grit; AD-5: never an even polka-dot grid): angular
        grains whose sizes follow a power law, seeded in fbm clusters. Mask 0..1 with ~`coverage` of the area."""
        clus = tg.smoothstep(0.1, 0.7, self.fbm(cluster_m, 4) * 0.5 + 0.5)
        lo, hi = size

        def grain(lu, lv, e1, e2):
            rr = lo + (hi - lo) * e1 ** 3
            ang = np.arctan2(lv, lu)
            edge = rr * (1.0 + 0.3 * np.sin(3 * ang + 6.28 * e2) + 0.15 * np.sin(5 * ang + 2.0 * e1))
            return np.where(np.sqrt(lu * lu + lv * lv) < edge, 1.0, -1e9)

        dens = 1.0
        m = self.scatter(cell_m, grain, density=dens, density_map=clus).mask
        for _ in range(6):  # density solved so the coverage target holds whatever the cluster map does
            cov = float(m.mean(dtype=np.float64))
            if abs(cov - coverage) < 0.15 * coverage or dens <= 0.02:
                break
            dens = float(np.clip(dens * coverage / max(cov, 1e-6), 0.02, 1.0))
            m = self.scatter(cell_m, grain, density=dens, density_map=clus).mask
        return m

    # ------------------------------------------------------------------ layouts
    def bond(self, course_h: float, length: tuple[float, float], joint: float, stagger: float | None = 0.5,
             x: np.ndarray | None = None, y: np.ndarray | None = None, course_jitter: float = 0.0,
             choices: list[float] | None = None, choice_jitter: float = 0.0) -> dict[str, np.ndarray]:
        """Coursed units (bricks, ashlar, tiles, planks) wrapping in u and v. Per course: random unit lengths in
        `length` (scaled to fill the tile width exactly), offset by `stagger` x mean length on odd courses (None =
        random offset). `choices` picks unit lengths from a list instead (e.g. stretchers 0.42 + headers 0.26), each
        +-choice_jitter. Returns id (0..1 per unit), d (distance to the nearest unit edge, m), du/dv (edge distance
        along u / v), lu, lv (0..1 position inside the unit), course (index), ulen (unit length, m)."""
        W, H = self.size
        xx = self.x if x is None else x
        yy = self.y if y is None else y
        courses = max(1, int(round(H / course_h)))
        ch = H / courses
        u = (xx % 1.0) * W
        v = (yy % 1.0) * H
        if course_jitter > 0:
            v = v + 0.0
        c = np.clip(np.floor(v / ch), 0, courses - 1).astype(np.int64)
        vv = v - c * ch
        out = {k: np.zeros(u.shape, F) for k in ("id", "d", "du", "dv", "lu", "lv", "ulen")}
        out["course"] = c.astype(F)
        mean_len = 0.5 * (length[0] + length[1])
        for k in range(courses):
            lens: list[float] = []
            while sum(lens) < W - 1e-6:
                if choices:
                    L = float(choices[int(self.rng.integers(0, len(choices)))])
                    lens.append(L * (1.0 + float(self.rng.uniform(-choice_jitter, choice_jitter))))
                else:
                    lens.append(float(self.rng.uniform(length[0], length[1])))
            if not choices and length[0] == length[1]:
                n = max(1, int(round(W / mean_len)))
                lens = [W / n] * n
            sc = W / sum(lens)
            lens = [L * sc for L in lens]
            if stagger is None:
                off = float(self.rng.uniform(0, W))
            else:
                off = (k % 2) * stagger * mean_len * sc
            cuts = np.cumsum([0.0] + lens[:-1]) + off
            cuts = np.sort(cuts % W)
            ext = np.concatenate([cuts - W, cuts, cuts + W])
            sel = c == k
            if not np.any(sel):
                continue
            uu = u[sel]
            idx = np.searchsorted(ext, uu, side="right") - 1
            left = ext[idx]
            right = ext[np.minimum(idx + 1, len(ext) - 1)]
            ids = self.rng.uniform(0, 1, len(cuts)).astype(F)
            du = np.minimum(uu - left, right - uu)
            dv = np.minimum(vv[sel], ch - vv[sel])
            out["id"][sel] = ids[idx % len(cuts)]
            out["du"][sel] = du
            out["dv"][sel] = dv
            out["d"][sel] = np.minimum(du, dv)
            out["lu"][sel] = (uu - left) / np.maximum(right - left, 1e-6)
            out["lv"][sel] = vv[sel] / ch
            out["ulen"][sel] = right - left
        return out

    def stones(self, cell_m: float, warp_m: float = 0.0, jitter: float = 0.9, x: np.ndarray | None = None,
               y: np.ndarray | None = None, aniso: tuple[float, float] = (1.0, 1.0)) -> dict[str, np.ndarray]:
        """Irregular polygonal stones (flagstones, rubble, crust plates): Voronoi cells with an optionally warped
        domain. Returns id, d (approx. distance to the cell border in m), f1 (m from the cell centre)."""
        xx, yy = (self.x, self.y) if x is None else (x, y)
        if warp_m > 0:
            xx, yy = self.warp(warp_m, cell_m * 0.7, 3, x=xx, y=yy)
        f1, f2, cid = self.worley(cell_m, jitter, x=xx, y=yy, aniso=aniso)
        cm = cell_m * math.sqrt(aniso[0] * aniso[1])
        return {"id": cid, "d": ((f2 - f1) * 0.5 * cm).astype(F), "f1": (f1 * cm).astype(F)}

    # ------------------------------------------------------------------ relief helpers
    @staticmethod
    def edge_round(d: np.ndarray, radius: float, depth: float) -> np.ndarray:
        """Rounded arris profile: -depth at the edge (d=0) rising to 0 at d >= radius (quarter circle)."""
        t = np.clip(d / np.maximum(radius, 1e-6), 0.0, 1.0)  # radius may be a per-texel array
        return (-depth * (1.0 - np.sqrt(np.clip(1.0 - (1.0 - t) ** 2, 0.0, 1.0)))).astype(F)

    def macro_flatten(self, albedo: np.ndarray, sigma_m: float = 0.5, amount: float = 0.85) -> np.ndarray:
        """Macro-neutral terrain layers: divide out luminance variation at wavelengths >> sigma_m (the splat's
        macro map supplies it at world scale; inside a 3-4 m tile it would read as repetition)."""
        lum = tg.luminance(albedo)
        lb = self.blur(lum, sigma_m)
        g = (float(lum.mean(dtype=np.float64)) / np.maximum(lb, 1e-4)) ** amount
        return (albedo * g[..., None]).astype(F)

    def height_highpass(self, h: np.ndarray, sigma_m: float = 0.6, amount: float = 0.8) -> np.ndarray:
        return (h - amount * self.blur(h, sigma_m)).astype(F)

    # ------------------------------------------------------------------ height-blend proxy
    def height_proxy(self, ao: np.ndarray, h: np.ndarray, mix: float, span_min: float | None) -> np.ndarray:
        """ORM.r = AO x lerp(1, hn, mix). hn is the height made half rank-equalized (order kept: stones bright,
        cavities dark) so a few tall stones cannot squash the rest of the layer into one grey; the mix rises in
        steps (max 0.75) until the 5th..95th percentile span of ORM.r reaches span_min. The splat shader blends
        layers by w * (1 + ORM.r) with a 0.2 sharpness window, so a span >= 0.3 interlocks layer borders."""
        hb = tg.blur(h, 0.8).astype(np.float64)
        lo, hi = np.percentile(hb, [1, 99])
        lin = np.clip((hb - lo) / max(hi - lo, 1e-12), 0.0, 1.0)
        order = np.argsort(hb, axis=None, kind="stable")
        rank = np.empty(hb.size, np.float64)
        rank[order] = np.linspace(0.0, 1.0, hb.size)
        hn = 0.5 * lin + 0.5 * rank.reshape(hb.shape)

        def make(m: float) -> np.ndarray:
            return np.clip(ao * (1.0 - m + m * hn), 0.0, 1.0).astype(F)

        m = float(mix)
        out = make(m)
        if span_min:
            while m < 0.75:
                p5, p95 = np.percentile(out, [5, 95])
                if p95 - p5 >= span_min:
                    break
                m = min(0.75, m + 0.05)
                out = make(m)
        p5, p95 = np.percentile(out, [5, 95])
        self.orm_r_stats = dict(heightMix=round(m, 3), ormRP5=round(float(p5), 3), ormRP95=round(float(p95), 3),
                                ormRSpan=round(float(p95 - p5), 3), ormRMean=round(float(out.mean(dtype=np.float64)), 3))
        core.log(f"height proxy {self.orm_r_stats}")
        return out

    # ------------------------------------------------------------------ output
    def _down(self, img: np.ndarray, res: int) -> np.ndarray:
        if img.shape[0] == res:
            return img.astype(F)
        return tg.resize(img, res, res)

    def calibrate(self, albedo: np.ndarray, target_hex: str, iters: int = 6) -> np.ndarray:
        """Hit the target's LINEAR mean per channel (the manifest averageColor / fallback color definition) while
        keeping every pixel's luminance inside ALBEDO_LIMITS."""
        t = hexlin(target_hex)
        lo, hi = float(self.limits["min"]), float(self.limits["max"])
        a = np.clip(albedo.astype(F), 1e-4, None)
        for _ in range(iters):
            m = a.reshape(-1, 3).mean(axis=0, dtype=np.float64)
            a = a * (t / np.maximum(m, 1e-6))[None, None, :]
            lum = tg.luminance(a)
            k = np.where(lum < lo, lo / np.maximum(lum, 1e-6), np.where(lum > hi, hi / lum, 1.0))
            a = np.clip(a * k[..., None], 0.0, self.channel_max)
            if self.sat_cap is not None or self.value_cap is not None:
                a = self.cap_hsv(a)
        return a.astype(F)

    def cap_hsv(self, lin: np.ndarray) -> np.ndarray:
        """Pull texels above the HSV saturation cap toward their own max channel (value kept, chroma reduced) and
        scale texels above the value cap down (hue kept)."""
        s = tg.linear_to_srgb(np.clip(lin, 0.0, 1.0)).astype(F)
        mx = s.max(axis=-1, keepdims=True)
        mn = s.min(axis=-1, keepdims=True)
        if self.sat_cap is not None:
            sat = (mx - mn) / np.maximum(mx, 1e-6)
            t = np.where(sat > self.sat_cap, self.sat_cap / np.maximum(sat, 1e-6), 1.0)
            s = mx - (mx - s) * t
        if self.value_cap is not None:
            s = s * np.where(mx > self.value_cap, self.value_cap / np.maximum(mx, 1e-6), 1.0)
        return tg.srgb_to_linear(np.clip(s, 0.0, 1.0)).astype(F)

    def clamp_limits(self, albedo: np.ndarray) -> np.ndarray:
        """Per-pixel luminance clamp to ALBEDO_LIMITS without a target mean (decals, uncalibrated sets)."""
        lo, hi = float(self.limits["min"]), float(self.limits["max"])
        a = np.clip(albedo.astype(F), 1e-4, None)
        lum = tg.luminance(a)
        k = np.where(lum < lo, lo / np.maximum(lum, 1e-6), np.where(lum > hi, hi / lum, 1.0))
        return np.clip(a * k[..., None], 0.0, self.channel_max).astype(F)

    def remap_roughness(self, rough: np.ndarray, mean_t: float, rng_t: tuple[float, float]) -> np.ndarray:
        """Monotone remap: 5th..95th percentiles -> rng_t, gamma solved so the mean hits mean_t."""
        p5, p95 = np.percentile(rough, [5, 95])
        t = (rough - p5) / max(float(p95 - p5), 1e-5)
        r0, r1 = rng_t

        def apply(g: float) -> np.ndarray:
            tc = np.clip(t, 0.0, 1.0)
            core_ = tc**g
            ext = np.where(t < 0, t * 0.5, np.where(t > 1, (t - 1.0) * 0.5, 0.0))
            return np.clip(r0 + (r1 - r0) * (core_ + ext), 0.02, 1.0)

        lo_g, hi_g = 0.15, 6.0
        for _ in range(40):
            mid = math.sqrt(lo_g * hi_g)
            if float(apply(mid).mean(dtype=np.float64)) > mean_t:
                lo_g = mid
            else:
                hi_g = mid
        return apply(math.sqrt(lo_g * hi_g)).astype(F)

    def qa(self, albedo: np.ndarray, rough: np.ndarray, target_hex: str | None) -> dict[str, Any]:
        s = srgb8(albedo)
        mean_lin = albedo.reshape(-1, 3).mean(axis=0, dtype=np.float64)
        mean_srgb = srgb8(mean_lin[None, None, :])[0, 0]
        lum = tg.luminance(albedo)
        sat = hsv_saturation(s / 255.0)
        out: dict[str, Any] = {
            "meanColor": tg.linear_to_hex(mean_lin),
            "lumMean": round(float(lum.mean(dtype=np.float64)), 4),
            "lumP2": round(float(np.percentile(lum, 2)), 4),
            "lumP98": round(float(np.percentile(lum, 98)), 4),
            "satMean": round(float(sat.mean(dtype=np.float64)), 3),
            "satP95": round(float(np.percentile(sat, 95)), 3),
            "satP98": round(float(np.percentile(sat, 98)), 3),
            "valueP98": round(float(np.percentile(s.max(axis=-1) / 255.0, 98)), 3),
            "roughMean": round(float(rough.mean(dtype=np.float64)), 3),
            "roughP5": round(float(np.percentile(rough, 5)), 3),
            "roughP95": round(float(np.percentile(rough, 95)), 3),
            "roughTarget": [round(self.rough_range[0], 3), round(self.rough_range[1], 3)],
            "albedoLimits": [self.limits["min"], self.limits["max"]],
        }
        if target_hex:
            t = srgb8(hexlin(target_hex)[None, None, :])[0, 0]
            rel = (mean_srgb - t) / np.maximum(t, 1.0)
            tl = float(tg.luminance(hexlin(target_hex)[None, None, :])[0, 0])
            out.update(target=target_hex, deltaRgbPct=[round(float(v) * 100, 2) for v in rel],
                       deltaLumPct=round((float(lum.mean(dtype=np.float64)) / tl - 1.0) * 100, 2))
        if self.family:
            fr = self.limits["ranges"][self.family]
            out["family"] = self.family
            out["familyRange"] = fr
        out["saturationLimit"] = self.sat_limits.get(self.saturation_limit)
        return out

    def finish(
        self,
        height: np.ndarray,
        albedo: np.ndarray,
        rough: np.ndarray,
        metal: np.ndarray | None = None,
        ao: str | np.ndarray = "cycles",
        ao_distance: float = 0.05,
        ao_samples: int = 48,
        ao_height_mix: float = 0.0,
        alpha: np.ndarray | None = None,
        alpha_usage: str | None = None,
        orm_b: np.ndarray | None = None,
        orm_b_usage: str | None = None,
        description: str = "",
        trims: list | None = None,
        decals: list | None = None,
        extra_meta: dict | None = None,
        preview: str | None = "wall",
        preview_opts: dict | None = None,
        calibrate: bool = True,
        normal_detail: np.ndarray | None = None,
        rough_blur_px: float = 0.8,
        height_soften_px: float | None = None,
        remap_rough: bool = True,
        normal: np.ndarray | None = None,
        orm_span_min: float | None = None,
    ) -> None:
        """Write the set. `ao`: 'cycles' (ray-traced heightfield AO), 'horizon' (numpy), or an array.
        `ao_height_mix` (terrain): ORM.r = AO x lerp(1, normalized height, mix) so the splat's height blend
        (ORM.r as height proxy) lets stones poke through and soil fill cracks; `orm_span_min` raises the mix until
        ORM.r spans at least that much between its 5th and 95th percentiles (crisp height-blend borders). `orm_b` overrides the metalness
        channel with data (decal opacity); `alpha` adds a baseColor alpha channel (puddle mask)."""
        ctx = self.ctx
        W, H = self.size
        target = self.preset.get("baseColor")
        # Payload: texel-level noise in normals / roughness costs a lot of WebP bytes and reads as aliasing at
        # distance anyway. Soften the height a touch before the normals (H sets: 0.5 px) and roughness by 0.8 px.
        soften = (0.5 if self.cls == "H" else 0.0) if height_soften_px is None else height_soften_px
        with core.timer("normals"):
            if normal is not None:  # assembled per region (decal atlas: each region's own wrap, no cross-region slopes)
                n_int = normal.astype(F)
            else:
                n_int = tg.normal_from_height(tg.blur(height, soften) if soften > 0 else height, self.texel)
            if normal_detail is not None:
                n_int = tg.blend_normals(n_int, normal_detail)
            n = self._down(n_int, self.data_res)
            nlen = np.linalg.norm(n, axis=-1)
            n = (n / np.maximum(nlen[..., None], 1e-6)).astype(F)
            del n_int
        alb = self._down(albedo, self.albedo_res)
        r_data = self._down(rough, self.data_res)
        # Toksvig: normal variance lost in the box filter becomes micro-roughness (no sparkly speculars at distance)
        var = np.clip(1.0 - nlen, 0.0, 1.0)
        r_data = np.sqrt(np.clip(r_data * r_data + 0.6 * var, 0.0, 1.0)).astype(F)
        h_alb = self._down(height, self.albedo_res)
        h_data = self._down(height, self.data_res)
        with core.timer("ao"):
            if isinstance(ao, np.ndarray):
                ao_map = self._down(ao, self.data_res)
            elif ao == "cycles":
                ao_map = bake.bake_heightfield_ao(h_data, self.size, self.data_res, samples=ctx.samples(ao_samples, 8),
                                                  distance=ao_distance, mesh_verts=min(self.data_res, 1280))
                ao_map = tg.blur(ao_map, 0.6)
            else:
                ao_map = tg.horizon_ao(h_data, W / self.data_res, ao_distance, 8, 10)
                ao_map = tg.blur(ao_map, 0.7)
            ao_map = np.clip(ao_map, 0.0, 1.0).astype(F)
            if ao_height_mix > 0 or orm_span_min:
                ao_map = self.height_proxy(ao_map, h_data, ao_height_mix, orm_span_min)
        if calibrate and target:
            alb = self.calibrate(alb, target)
        else:
            alb = self.clamp_limits(alb)
        if rough_blur_px > 0:
            r_data = tg.blur(r_data, rough_blur_px)
        if remap_rough:
            mean_r = float(self.preset.get("roughness", float(r_data.mean(dtype=np.float64))))
            r_data = self.remap_roughness(r_data, mean_r, self.rough_range)
        else:  # authored absolute roughness (decal atlas: puddles 0.05 next to soot 0.95)
            r_data = np.clip(r_data, 0.02, 1.0).astype(F)
        m_data = np.zeros_like(r_data) if metal is None else self._down(metal, self.data_res)
        if orm_b is not None:
            m_data = self._down(orm_b, self.data_res)
        qa = self.qa(alb, r_data, target)
        o5, o95 = np.percentile(ao_map, [5, 95])
        qa.update(getattr(self, "orm_r_stats", None) or dict(ormRP5=round(float(o5), 3), ormRP95=round(float(o95), 3),
                                                             ormRSpan=round(float(o95 - o5), 3)))
        core.log("QA " + json.dumps(qa))
        # ---- files
        cs = self.spec
        if alpha is not None:
            a_out = self._down(alpha, self.albedo_res)
            rgba = np.concatenate([tg.linear_to_srgb(alb), a_out[..., None]], axis=-1)
            bc_path = tg.write_png(ctx.path(f"{ctx.id}_baseColor.png"), rgba, 8)
        else:
            bc_path = tg.write_png(ctx.path(f"{ctx.id}_baseColor.png"), alb, 8, srgb_encode=True)
        files = {
            "baseColor": bc_path,
            "normal": tg.write_png(ctx.path(f"{ctx.id}_normal.png"), tg.encode_normal(n), 16),
            "orm": tg.write_png(ctx.path(f"{ctx.id}_orm.png"), bake.pack_orm(ao_map, r_data, m_data), 8),
        }
        hmin, hmax = float(h_alb.min()), float(h_alb.max())
        files["height"] = tg.write_png(ctx.path(f"{ctx.id}_height.png"), (h_alb - hmin) / max(hmax - hmin, 1e-9), 16)
        bc_info: dict[str, Any] = dict(colorSpace="srgb", tierScale=cs["albedo_scale"])
        if alpha is not None:
            bc_info.update(alpha=alpha_usage or "mask")
        ctx.add_file("baseColor", files["baseColor"], **bc_info)
        ctx.add_file("normal", files["normal"], colorSpace="linear", tierScale=cs["data_scale"])
        orm_info: dict[str, Any] = dict(colorSpace="linear", tierScale=cs["data_scale"])
        if orm_b_usage:
            orm_info.update(blue=orm_b_usage)
        ctx.add_file("orm", files["orm"], **orm_info)
        ctx.add_file("height", files["height"], colorSpace="linear", ship=False)
        sw = tg.resize(alb, 256, 256) if alb.shape[0] % 256 == 0 else alb
        files["swatch"] = tg.write_png(ctx.path("swatch.png"), sw, 8, srgb_encode=True)
        ctx.add_file("swatch", files["swatch"], ship=False)
        ctx.meta.update(
            tileSizeMeters=[W, H],
            averageColor=tg.linear_to_hex(alb.reshape(-1, 3).mean(axis=0, dtype=np.float64)),
            roughness=round(float(r_data.mean(dtype=np.float64)), 3),
            metalness=0.0,
            normalScale=float(self.preset.get("normalScale", 1.0)),
            heightRangeMeters=[round(hmin, 5), round(hmax, 5)],
            trims=trims or [],
            decals=decals or [],
            setClass=self.cls,
            description=description,
            qa=qa,
        )
        if extra_meta:
            ctx.meta.update(extra_meta)
        # ---- previews of the SHIPPED maps
        if ctx.preview and preview:
            po = dict(preview_opts or {})
            self.preview_scene(preview, files, po)
            if po.get("tiling", True):  # atlases are not tiling sets
                self.preview_tiling(files, po)
        ctx.finish()

    # ------------------------------------------------------------------ previews (Cycles)
    def _render(self, path: Path, res: tuple[int, int], samples: int, exposure: float = 0.0) -> Path:
        """lib.render.render with the Khronos PBR Neutral view transform: material lookdev keeps base-colour hue and
        saturation (AgX desaturates light buff / plaster albedos towards grey, which hides the calibration)."""
        import bpy

        scn = bpy.context.scene
        c = scn.cycles
        scn.render.engine = "CYCLES"
        c.device = "CPU"
        # 40 spp cap + OIDN: the lookdev reads the same as 96 spp and a full WP1 republish stays affordable on the
        # shared 4-CPU machine (a 96 spp 1280 x 720 frame took 7 min under load)
        c.samples = min(int(samples), PREVIEW_SPP_CAP)
        c.use_adaptive_sampling = True
        c.adaptive_threshold = 0.03
        c.use_denoising = True
        c.max_bounces = 6
        c.diffuse_bounces = 3
        c.glossy_bounces = 2
        c.caustics_reflective = False
        c.caustics_refractive = False
        c.seed = 1
        scn.render.resolution_x, scn.render.resolution_y = res
        scn.render.resolution_percentage = 100
        scn.render.film_transparent = False
        scn.view_settings.view_transform = "Khronos PBR Neutral"
        scn.view_settings.look = "None"
        scn.view_settings.exposure = exposure
        scn.render.image_settings.file_format = "PNG"
        scn.render.image_settings.color_mode = "RGB"
        scn.render.image_settings.color_depth = "8"
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        scn.render.filepath = str(path)
        with core.timer(f"render {res[0]}x{res[1]} @{samples}spp -> {path.name}"):
            bpy.ops.render.render(write_still=True)
        return path

    def _material(self, files: dict[str, Path], uv_scale=(1.0, 1.0), ao_strength: float = 0.6, alpha_cut: bool = False):
        from lib import materials

        mat = materials.texture_set_material(f"{self.ctx.id}_lookdev", files["baseColor"], files["normal"], files["orm"],
                                             uv_scale=uv_scale, normal_strength=float(self.preset.get("normalScale", 1.0)),
                                             ao_strength=ao_strength)
        return mat

    def _lights(self, sun: dict, sky_strength: float = 0.5, aerosol: float = 2.2) -> None:
        render.setup_world(sun_elevation=max(sun["elevation"], 3.0), sun_azimuth=sun["azimuth"], strength=sky_strength, aerosol=aerosol)
        render.add_sun(sun["elevation"], sun["azimuth"], sun["strength"], angle_deg=0.6, color=sun["color"])

    def _quad(self, name: str, corners: list, uvs: list, mat) -> Any:
        from lib import mesh as M

        return M.from_pydata(name, corners, [(0, 1, 2, 3)], uvs, smooth=False, material=mat)

    def preview_scene(self, kind: str, files: dict[str, Path], po: dict) -> None:
        import bpy

        ctx = self.ctx
        core.reset_scene()
        W, H = self.size
        res = (1280, 720) if not ctx.draft else (640, 360)
        spp = ctx.samples(po.get("samples", 64), 12)
        ev = float(po.get("exposure", PREVIEW_EXPOSURE))
        golden = dict(GOLDEN_SUN)
        golden.update(po.get("sun", {}))
        if kind in ("wall", "trim"):
            band = po.get("floor_band", (0.0, 1.0))
            render.lookdev_trim_scene(files["baseColor"], files["normal"], files["orm"], (W, H), floor_band=band,
                                      column=po.get("column", True))
            self._lights(dict(elevation=22.0, azimuth=245.0, strength=4.4, color="#ffe2bf"), 0.55)
            s = W / 2.0
            render.look_at_camera((-5.3 * s, -6.4 * s, 1.75 * s), (-1.2 * s, 0.4 * s, 0.95 * s), lens=30)
            ctx.add_file("preview", self._render(ctx.path("preview.png"), res, spp, ev))
            render.look_at_camera((-0.25 * s - 0.4, -1.1, 0.55 * H + 0.25), (-1.0 * s, 0.0, 0.45 * H), lens=50, fstop=5.6)
            ctx.add_file("preview_closeup", self._render(ctx.path("preview_closeup.png"), res, spp, ev))
        elif kind == "roof":
            self._roof_scene(files, po)
            self._lights(dict(elevation=24.0, azimuth=235.0, strength=4.4, color="#ffe2bf"), 0.55)
            ctx.add_file("preview", self._render(ctx.path("preview.png"), res, spp, ev))
            g = self._roof_geo
            ty = -0.45 * g["ey"]
            tz = g["ridge_z"] - (0.45 * g["ey"]) * math.tan(math.radians(po.get("pitch", 30.0)))
            render.look_at_camera((0.35, ty - 2.1, tz + 1.5), (0.0, ty, tz), lens=45, fstop=7.0)
            ctx.add_file("preview_closeup", self._render(ctx.path("preview_closeup.png"), res, spp, ev))
        elif kind == "ground":
            reps = po.get("repeats", 8)
            mat = self._material(files, uv_scale=(1.0, 1.0), ao_strength=0.5)
            ext = reps * W / 2
            self._quad("ground", [(-ext, -ext, 0), (ext, -ext, 0), (ext, ext, 0), (-ext, ext, 0)],
                       [(0, 0), (reps, 0), (reps, reps), (0, reps)], mat)
            self._lights(golden, 0.45)
            render.look_at_camera((0.0, -ext * 0.42, 1.65), (0.0, -ext * 0.42 + 4.5, 0.0), lens=32)
            ctx.add_file("preview", self._render(ctx.path("preview.png"), res, spp, ev))
            core.reset_scene()
            mat = self._material(files, ao_strength=0.5)
            self._quad("ground", [(-ext, -ext, 0), (ext, -ext, 0), (ext, ext, 0), (-ext, ext, 0)],
                       [(0, 0), (reps, 0), (reps, reps), (0, reps)], mat)
            self._lights(DAY_SUN, 0.55)
            render.look_at_camera((0.35, -0.75, 0.95), (0.0, 0.1, 0.0), lens=45, fstop=8.0)
            ctx.add_file("preview_closeup", self._render(ctx.path("preview_closeup.png"), res, spp, ev))
        elif kind == "cliff":
            self._cliff_scene(files, po)
            self._lights(golden, 0.45)
            ctx.add_file("preview", self._render(ctx.path("preview.png"), res, spp, ev))
            # 1.5-2.5 m close-up of the left face under a raking day sun (AD-8/AD-9: rock close-ups)
            core.reset_scene()
            self._cliff_scene(files, po)
            self._lights(dict(elevation=28.0, azimuth=262.0, strength=4.4, color="#fff0dc"), 0.5)
            render.look_at_camera((-0.62 * W, -2.3, 1.55), (-0.5 * W, 0.0, 1.35), lens=32, fstop=8.0)
            ctx.add_file("preview_closeup", self._render(ctx.path("preview_closeup.png"), res, spp, ev))
        elif kind == "atlas":
            self._atlas_scene(files, po)
            ctx.add_file("preview", self._render(ctx.path("preview.png"), (1024, 1024) if not ctx.draft else (512, 512), spp, ev))
        elif kind == "pole":
            self._pole_scene(files, po)
            self._lights(dict(elevation=24.0, azimuth=235.0, strength=4.4, color="#ffe2bf"), 0.55)
            ctx.add_file("preview", self._render(ctx.path("preview.png"), res, spp, ev))
            # close-up of the woven panel, the lashing and a pole at ~1 m (AD-9: bamboo close-up)
            pv0, pv1 = po.get("panel_band", (0.0, 1.0))
            ph = (pv1 - pv0) * H
            render.look_at_camera((-0.3, -1.25, ph + 0.05), (0.05, 0.0, 0.62 * ph + 0.05), lens=40, fstop=6.0)
            ctx.add_file("preview_closeup", self._render(ctx.path("preview_closeup.png"), res, spp, ev))
        else:
            raise ValueError(f"unknown preview kind {kind}")
        del bpy

    def _roof_scene(self, files, po) -> None:
        """Gable roof (pitch 30 deg, 0.35 m eave overhang) on plain mud-plaster walls; u runs along the ridge,
        v UP the slope (roof sets author tile lips / thatch ends pointing down-slope = -v)."""
        import bpy

        W, H = self.size
        mat = self._material(files)
        pitch = math.radians(po.get("pitch", 30.0))
        L = 2.0 * W  # ridge length
        S = 1.25 * H + 0.35  # slope length incl. overhang
        eave_wall = 2.6
        run = 1.25 * H * math.cos(pitch)  # wall half-depth
        ridge_z = eave_wall + 1.25 * H * math.sin(pitch)
        ey = S * math.cos(pitch)
        ez = ridge_z - S * math.sin(pitch)
        uvs = [(0, 0), (L / W, 0), (L / W, S / H), (0, S / H)]
        # -y slope: eave edge at y=-ey; corners CCW seen from outside (normal -y / +z)
        self._quad("roof_s", [(-L / 2, -ey, ez), (L / 2, -ey, ez), (L / 2, 0.0, ridge_z), (-L / 2, 0.0, ridge_z)], uvs, mat)
        self._quad("roof_n", [(L / 2, ey, ez), (-L / 2, ey, ez), (-L / 2, 0.0, ridge_z), (L / 2, 0.0, ridge_z)], uvs, mat)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, eave_wall / 2))
        box = bpy.context.active_object
        box.scale = (L - 0.5, 2 * run - 0.1, eave_wall)
        wm = bpy.data.materials.new("walls")
        wm.use_nodes = True
        b = wm.node_tree.nodes.get("Principled BSDF")
        c = hexlin("#a8835f")
        b.inputs["Base Color"].default_value = (float(c[0]), float(c[1]), float(c[2]), 1.0)
        b.inputs["Roughness"].default_value = 0.95
        box.data.materials.append(wm)
        render.add_ground(200.0, "#7a6550", 0.95, z=0.0)
        self._roof_geo = dict(ridge_z=ridge_z, ey=ey, ez=ez, L=L)
        render.look_at_camera((-1.35 * L, -2.0 * L, 0.9 * ridge_z), (0.0, -0.2 * ey, 0.8 * ridge_z), lens=32)

    def _cliff_scene(self, files, po) -> None:
        """Two vertical rock faces (an outside corner, 2 x 1 tiles each) above a ground strip of the same set."""
        W, H = self.size
        mat = self._material(files)
        hgt = H
        self._quad("face_a", [(-2 * W, 0, 0), (0, 0, 0), (0, 0, hgt), (-2 * W, 0, hgt)], [(0, 0), (2, 0), (2, 1), (0, 1)], mat)
        self._quad("face_b", [(0, 0, 0), (0, 2 * W, 0), (0, 2 * W, hgt), (0, 0, hgt)], [(0, 0), (2, 0), (2, 1), (0, 1)], mat)
        import bpy

        bpy.data.objects["face_b"].data.flip_normals()
        self._quad("ledge", [(-2 * W, -W, 0), (W, -W, 0), (W, 2 * W, 0), (-2 * W, 2 * W, 0)], [(0, 0), (3, 0), (3, 3), (0, 3)], mat)
        render.add_ground(400.0, "#7a6550", 0.95, z=-0.02)
        render.look_at_camera((-2.1 * W, -1.9 * W, 0.35 * H), (-0.5 * W, 0.4 * W, 0.42 * H), lens=24)

    def _pole_scene(self, files, po) -> None:
        """Trim-sheet lookdev for pole materials: a woven panel (po['panel_band'] v range, repeating in u), three
        free-standing poles whose surface maps onto po['pole_band'] (u along the pole, v around it) and a lashing
        wrap (po['lash_band']) at the panel's top corner."""
        import bpy

        W, H = self.size
        mat = self._material(files)
        pv0, pv1 = po.get("panel_band", (0.0, 1.0))
        ph = (pv1 - pv0) * H  # panel height = one band
        self._quad("panel", [(-2 * W, 0, 0.05), (0, 0, 0.05), (0, 0, 0.05 + ph), (-2 * W, 0, 0.05 + ph)],
                   [(0, pv0), (2, pv0), (2, pv1), (0, pv1)], mat)

        def pole(name, x0, y0, length, radius, band, z0=0.0, axis="z"):
            b0, b1 = band
            seg = 24
            verts, faces, uvs = [], [], []
            for i in range(seg + 1):
                a = 2 * math.pi * i / seg
                c, sn = math.cos(a) * radius, math.sin(a) * radius
                if axis == "z":
                    verts += [(x0 + c, y0 + sn, z0), (x0 + c, y0 + sn, z0 + length)]
                else:
                    verts += [(x0, y0 + c, z0 + sn), (x0 + length, y0 + c, z0 + sn)]
            for i in range(seg):
                k = 2 * i
                faces.append((k, k + 2, k + 3, k + 1))
                v_a = b0 + (b1 - b0) * i / seg
                v_b = b0 + (b1 - b0) * (i + 1) / seg
                uvs += [(0, v_a), (0, v_b), (length / W, v_b), (length / W, v_a)]
            from lib import mesh as M

            M.from_pydata(name, verts, faces, uvs, smooth=True, material=mat)

        band = po.get("pole_band", (0.0, 0.1))
        circ = (band[1] - band[0]) * H
        r = circ / (2 * math.pi)
        pole("pole_1", -2 * W - 0.2, -0.15, 2.4, r, band)
        pole("pole_2", 0.2, -0.15, 2.4, r, band)
        pole("pole_3", -W, -0.9, 2.0, r, band)
        pole("rail", -2 * W - 0.25, -0.15 - 2 * r, 2 * W + 0.7, r, band, z0=ph + 0.1, axis="x")
        lash = po.get("lash_band")
        if lash:
            lr = r * 1.18
            pole("lash_1", -2 * W - 0.2, -0.15, 0.09, lr, lash, z0=ph + 0.06)
            pole("lash_2", 0.2, -0.15, 0.09, lr, lash, z0=ph + 0.06)
        render.add_ground(400.0, "#7a6550", 0.95, z=-0.01)
        render.look_at_camera((-3.9 * W, -4.6 * W, 1.25), (-1.1 * W, 0.0, 0.7), lens=32)
        del bpy

    def _atlas_scene(self, files, po) -> None:
        """Top-down orthographic view of the atlas: emission-free PBR quad over a neutral backdrop, coverage from
        ORM.b (decal opacity) mixing the decal over plaster-white and earth halves."""
        import bpy
        from lib.nodes import NodeBuilder

        W, H = self.size
        mat = bpy.data.materials.new("atlas")
        nb = NodeBuilder(mat)
        uv = nb.uv()
        img = bpy.data.images.load(str(files["baseColor"]))
        img.colorspace_settings.name = "sRGB"
        orm = bpy.data.images.load(str(files["orm"]))
        orm.colorspace_settings.name = "Non-Color"
        nrm = bpy.data.images.load(str(files["normal"]))
        nrm.colorspace_settings.name = "Non-Color"
        col = nb.image(img, uv, non_color=False).outputs["Color"]
        sep = nb.separate(nb.image(orm, uv).outputs["Color"])
        u_sep = nb.separate(uv)  # U (red) picks the backdrop: plaster-white left half, earth right half
        half = nb.math("GREATER_THAN", u_sep.outputs[0], 0.5)
        back = nb.mix((0.74, 0.70, 0.62, 1.0), (0.30, 0.22, 0.15, 1.0), half)
        c = nb.mix(back, col, sep.outputs[2])
        rough = nb.mix(0.9, sep.outputs[1], sep.outputs[2], data_type="FLOAT")
        nm = nb.normal_map(nb.image(nrm, uv).outputs["Color"], 1.0)
        nb.principled(base_color=c, roughness=rough, normal=nm)
        self._quad("atlas", [(0, 0, 0), (W, 0, 0), (W, H, 0), (0, H, 0)], [(0, 0), (1, 0), (1, 1), (0, 1)], mat)
        self._lights(dict(elevation=35.0, azimuth=225.0, strength=4.0, color="#fff0dc"), 0.6)
        cam_data = bpy.data.cameras.new("ortho")
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = max(W, H) * 1.02
        cam = bpy.data.objects.new("ortho", cam_data)
        bpy.context.scene.collection.objects.link(cam)
        bpy.context.scene.camera = cam
        cam.location = (W / 2, H / 2, 5.0)
        cam.rotation_euler = (0.0, 0.0, 0.0)

    def preview_tiling(self, files: dict[str, Path], po: dict) -> None:
        """3 x 3 repeats seen straight down (orthographic) under raking golden light (sun 11 deg): the tiling and
        relief check (ASSET_LIST WP1 acceptance)."""
        import bpy

        ctx = self.ctx
        core.reset_scene()
        W, H = self.size
        mat = self._material(files, ao_strength=0.6)
        self._quad("tiles", [(0, 0, 0), (3 * W, 0, 0), (3 * W, 3 * H, 0), (0, 3 * H, 0)], [(0, 0), (3, 0), (3, 3), (0, 3)], mat)
        sun = dict(GOLDEN_SUN)
        sun.update(TILING_SUN)
        sun.update(po.get("sun", {}))
        self._lights(sun, TILING_SKY)
        cam_data = bpy.data.cameras.new("ortho")
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = 3 * max(W, H)
        cam = bpy.data.objects.new("ortho", cam_data)
        bpy.context.scene.collection.objects.link(cam)
        bpy.context.scene.camera = cam
        cam.location = (1.5 * W, 1.5 * H, 10.0)
        cam.rotation_euler = (0.0, 0.0, 0.0)
        res = (1024, 1024) if not ctx.draft else (512, 512)
        ctx.add_file("preview_tiling", self._render(ctx.path("preview_tiling.png"), res, ctx.samples(po.get("tiling_samples", 32), 8),
                                                   float(po.get("tiling_exposure", TILING_EXPOSURE))))

    # ------------------------------------------------------------------ fast numpy look (iteration only)
    def quicklook(self, height: np.ndarray, albedo: np.ndarray, name: str = "quicklook.png", res: int = 768,
                  light: tuple[float, float] = (14.0, 250.0)) -> Path:
        """Seconds-fast 2 x 2 repeat relief render (Lambert, raking light) for the critique loop."""
        k = max(1, height.shape[0] // (res // 2))
        h = tg.resize(height, height.shape[0] // k, height.shape[0] // k)
        a = tg.resize(albedo, h.shape[0], h.shape[0])
        img = tg.shade(h, self.size[0] / h.shape[0], a, light_deg=light, ambient=0.3)
        img = np.concatenate([np.concatenate([img, img], 1), np.concatenate([img, img], 1)], 0)
        return tg.write_png(self.ctx.path(name), img, 8)


__all__ = [
    "AD_RULINGS",
    "CLASSES",
    "Kit",
    "Scatter",
    "hexlin",
    "hsv_saturation",
    "hue_rotate",
    "mul",
    "ramp",
    "saturate_by",
    "shape_blade",
    "shape_disc",
    "shape_leaf",
    "shape_pebble",
    "shape_rosette",
    "srgb8",
    "style",
    "tint",
]
