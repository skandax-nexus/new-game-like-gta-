"""
Package-local helper (hdri): WP7 time-of-day / weather skies from the lighting presets. OWNER: Technical Artist G (TA-07).

    import _skykit
    _skykit.build(__file__, "dawn")          # reads LIGHTING_PRESETS.dawn (@style lighting:LIGHTING_PRESETS.dawn)

Pipeline per sky:
  1. lib/sky.bake_sky() with the preset's Nishita parameters at the master resolution (2048 x 1024) - the sun disc
     is integrated and removed exactly as for sky_day / sky_golden.
  2. Re-load the master and apply the weather / time-of-day treatment in numpy:
       night     moonlit dome (sky baked with the sun at the MOON position, desaturated towards a Purkinje blue),
                 ~4000 stars (magnitude-distributed, extinction near the horizon), a faint Milky Way band, thin
                 moonlit clouds that occlude the stars; the moon disc is NOT in the map - it is the manifest 'sun'
       overcast  CIE overcast dome (L ~ (1 + 2 sin(elevation)) / 3) in the preset fog tones over a 95 % cloud deck
       dusk      warm afterglow band over the sun's azimuth (preset fog inscatter color), clouds lit from below
       haze/fog  blend towards the preset fog color: a floor everywhere + more at the horizon, desaturated
  3. Calibration (ART_BIBLE §4.4): the map is scaled so its ambientIrradiance (cos-weighted upper-hemisphere
     luminance, same definition as lib/sky.py) equals the preset's sky.irradiance -> environmentIntensity = 1
     for the matching preset. The manifest `sun` carries the preset's light (direction of the baked sun / moon,
     preset color and intensity) so the DirectionalLight and the map agree; the physically integrated disc
     intensity is kept in `baked.sunIntensity` for reference.
  4. Tiers re-encoded as half-float DWAB EXR with a tuned DWA quality (lib/sky uses 90: ~600 KB at 2048; the WP7
     budget needs ~250 KB) - smooth skies show no DWA artifacts at these settings (checked in the previews).
"""
from __future__ import annotations

import json
import math
import os
import subprocess
from pathlib import Path
from typing import Any

import bpy
import numpy as np

from lib import core, sky as S, texgen as tg
from lib.core import AssetContext, log, timer

F = np.float32
TIERS = {"ultra": 2048, "high": 1024, "mobile": 512}
# DWA quality per tier (lower = smaller). Mobile (512 px) sees the sky through a small, blurry PMREM; the WP7 0.6 MB mobile budget wins.
DWA_QUALITY = {"ultra": 40, "high": 45, "mobile": 42}


def style(ref: str) -> Any:
    env = os.environ.get("SAMRAJYA_STYLE")
    if env:
        values = json.loads(env)
        if ref in values:
            return values[ref]
    out = subprocess.check_output(["node", str(core.REPO_ROOT / "tools/assets/build.mjs"), "--style", ref], cwd=core.REPO_ROOT)
    return json.loads(out)[ref]


def hex_linear(h: str) -> np.ndarray:
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def save_exr(arr: np.ndarray, path: Path, quality: int) -> Path:
    h, w = arr.shape[:2]
    im = bpy.data.images.new(path.stem, w, h, alpha=False, float_buffer=True)
    im.colorspace_settings.name = "Linear Rec.709"
    im.pixels.foreach_set(tg.to_blender(arr.astype(F)))
    s = bpy.context.scene.render.image_settings
    s.file_format = "OPEN_EXR"
    s.color_mode = "RGB"
    s.color_depth = "16"
    s.exr_codec = "DWAB"
    s.quality = int(quality)
    im.save_render(str(path), scene=bpy.context.scene)
    bpy.data.images.remove(im)
    return path


def load_exr(path: Path) -> np.ndarray:
    im = bpy.data.images.load(str(path))
    arr = tg.image_to_numpy(im)[..., :3].astype(F).copy()
    bpy.data.images.remove(im)
    return arr


def latlon(H: int, W: int) -> tuple[np.ndarray, np.ndarray]:
    """Per-pixel latitude (rad, +up) and azimuth phi (rad, Blender: from +X towards +Y), lib/sky.py layout."""
    lat = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
    phi = (0.5 - (np.arange(W) + 0.5) / W) * 2 * math.pi
    return np.meshgrid(lat, phi, indexing="ij")


def ambient_irradiance(sky: np.ndarray) -> float:
    """Cos-weighted upper-hemisphere luminance (lib/sky.py `ambientIrradiance`)."""
    H, W = sky.shape[:2]
    v_lat = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
    dO = (2 * math.pi / W) * (math.pi / H) * np.cos(v_lat)
    up = v_lat > 0
    e = (sky[up] * (dO[up] * np.sin(v_lat[up]))[:, None, None]).sum(axis=(0, 1))
    return float(tg.luminance(e[None, None, :])[0, 0])


def luminance(a: np.ndarray) -> np.ndarray:
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def sun_dir_bl(elevation: float, azimuth: float) -> tuple[float, float, float]:
    el = math.radians(elevation)
    rot = math.radians(90.0 - azimuth)
    return (math.cos(el) * math.cos(rot), math.cos(el) * math.sin(rot), math.sin(el))


# ============================================================================================ treatments
def add_stars(sky: np.ndarray, rng: np.random.Generator, count: int = 4200, milky_way: float = 0.5) -> np.ndarray:
    H, W = sky.shape[:2]
    out = sky.copy()
    # uniform directions on the upper hemisphere
    z = rng.uniform(0.0, 1.0, count)
    ph = rng.uniform(-math.pi, math.pi, count)
    lat = np.arcsin(z)
    # magnitudes: N(m) ~ 10^(0.45 m) between 0 and 6.2 (inverse-CDF sampling)
    u = rng.uniform(0, 1, count)
    a = 0.45 * math.log(10)
    m = np.log(1 + u * (np.exp(a * 6.2) - 1)) / a
    flux = 10 ** (-0.4 * m)  # relative
    # atmospheric extinction near the horizon (airmass ~ 1/sin(el)) + haze
    airmass = 1.0 / np.maximum(np.sin(lat), 0.035)
    flux *= np.exp(-0.28 * (airmass - 1.0))
    # colors: mostly white, some blue-white and orange-red
    t = rng.uniform(0, 1, count)
    col = np.where(t[:, None] < 0.18, np.array([0.75, 0.85, 1.0]), np.where(t[:, None] > 0.86, np.array([1.0, 0.78, 0.55]), np.array([1.0, 0.97, 0.92])))
    # radiance of a star pixel at the master resolution: brightest (m = 0) ~ 6, i.e. clearly above the dome
    px_sr = (2 * math.pi / W) * (math.pi / H)
    peak = 6.0 * ((2 * math.pi / 2048) * (math.pi / 1024)) / px_sr
    fy = (0.5 - lat / math.pi) * H - 0.5
    fx = (0.5 - ph / (2 * math.pi)) * W - 0.5
    x0 = np.floor(fx).astype(int)
    y0 = np.floor(fy).astype(int)
    wx = fx - x0
    wy = fy - y0
    for dy, dx, w in ((0, 0, (1 - wx) * (1 - wy)), (0, 1, wx * (1 - wy)), (1, 0, (1 - wx) * wy), (1, 1, wx * wy)):
        yy = np.clip(y0 + dy, 0, H - 1)
        xx = (x0 + dx) % W
        np.add.at(out, (yy, xx), (col * (flux * w * peak)[:, None]).astype(F))
    if milky_way > 0:
        LAT, PHI = latlon(H, W)
        d = np.stack([np.cos(LAT) * np.cos(PHI), np.cos(LAT) * np.sin(PHI), np.sin(LAT)], axis=-1)
        n = np.array([0.35, -0.55, 0.76])
        n /= np.linalg.norm(n)
        band = np.exp(-((d @ n) / 0.12) ** 2)
        nz = tg.perlin(PHI * 3.0, LAT * 6.0, (4096, 4096), rng) * 0.5 + 0.5
        glow = band * (0.4 + 0.9 * nz) * (LAT > 0) * np.clip(np.sin(LAT) * 4, 0, 1)
        dome = float(np.median(luminance(sky[: H // 2])))
        out += (glow[..., None] * dome * 0.9 * milky_way * np.array([0.9, 0.92, 1.0])).astype(F)
    return out


def horizon_blend(sky: np.ndarray, color: np.ndarray, width_deg: float, amount: float, desat: float = 0.0,
                  floor: float = 0.0, gain: float = 1.0) -> np.ndarray:
    """Blend towards the fog color: `floor` everywhere + `amount` more at the horizon (e-folding width_deg)."""
    H, W = sky.shape[:2]
    LAT, _ = latlon(H, W)
    w = (floor + amount * np.exp(-np.clip(LAT, 0, None) / math.radians(width_deg)))[..., None]
    w = np.clip(np.where(LAT[..., None] > 0, w, floor + amount), 0, 1)
    lum = luminance(sky)[..., None]
    horizon_lum = float(np.median(luminance(sky[int(H * 0.47):int(H * 0.5)])))
    tint = color / max(float(luminance(color[None, None, :])[0, 0]), 1e-6) * horizon_lum * gain
    s = sky * (1 - desat) + lum * desat
    return (s * (1 - w) + tint[None, None, :] * w).astype(F)


def afterglow(sky: np.ndarray, glow: np.ndarray, sun_az: float, clouds: float, cloud_scale: float,
              rng: np.random.Generator) -> np.ndarray:
    """Dusk: warm afterglow band over the sun's azimuth + clouds lit from below by it (virtual sun 1 deg up)."""
    H, W = sky.shape[:2]
    LAT, PHI = latlon(H, W)
    d = sun_dir_bl(1.0, sun_az)
    cosd = np.cos(PHI - math.atan2(d[1], d[0]))
    hl = float(np.median(luminance(sky[int(H * 0.46):int(H * 0.5)])))
    g = glow / max(float(luminance(glow[None, None, :])[0, 0]), 1e-6)
    band = np.exp(-np.clip(LAT, 0, None) / math.radians(8.0)) * (0.25 + 0.75 * ((cosd + 1) / 2) ** 3) * (LAT > 0)
    out = (sky + band[..., None] * g[None, None, :] * hl * 1.6).astype(F)
    if clouds > 0:
        out = S.add_clouds(out, d, (g * hl * 5.0).astype(F), clouds, rng, cloud_scale)
    return out


def overcast(sky: np.ndarray, fog_color: np.ndarray, rng: np.random.Generator, d_bl: tuple[float, float, float]) -> np.ndarray:
    H, W = sky.shape[:2]
    LAT, _ = latlon(H, W)
    zen = float(np.median(luminance(sky[: H // 8])))
    base = (1 + 2 * np.sin(np.clip(LAT, 0, None))) / 3.0
    gray = fog_color / max(float(luminance(fog_color[None, None, :])[0, 0]), 1e-6)
    dome = (base[..., None] * gray[None, None, :] * zen * 1.6).astype(F)
    up = (LAT > 0)[..., None]
    out = np.where(up, sky * 0.12 + dome * 0.88, sky).astype(F)
    # heavy cloud deck structure (dark bases, brighter breaks), lit diffusely; faded out towards the horizon where
    # the flat-layer projection compresses the noise into specks
    clouded = S.add_clouds(out, d_bl, gray.astype(F) * zen * 2.2, 0.95, rng, 0.7)
    w = tg.smoothstep(math.radians(3.0), math.radians(18.0), LAT)[..., None]
    return (out * (1 - w) + clouded * w).astype(F)


def recompress(ctx: AssetContext) -> None:
    """Re-encode the tier EXRs written by lib/sky.bake_sky (DWA quality 90) at DWA_QUALITY - same look, ~1/3 size."""
    for f in list(ctx.files):
        if not f["role"].startswith("hdri_"):
            continue
        tier = f["role"][len("hdri_"):]
        path = ctx.path(f["path"])
        arr = load_exr(path)
        save_exr(arr, path, DWA_QUALITY.get(tier, 50))
    log(f"{ctx.id}: tier EXRs re-encoded at DWA quality {DWA_QUALITY}")


# ============================================================================================ build
def build(script_file: str, preset_name: str, *, treatment: str = "clear", stars: bool = False,
          tiers: dict[str, int] | None = None, description: str = "") -> AssetContext:
    tiers = tiers or TIERS
    ctx = core.begin(script_file, kind="hdri")
    p = style(f"lighting:LIGHTING_PRESETS.{preset_name}")
    n = p["sky"]["nishita"]
    sun = p["sun"]
    night = treatment == "night"
    # Night: bake the dome lit from the moon's position (the preset's light) - a moonlit sky.
    el, az = (float(sun["elevationDeg"]), float(sun["azimuthDeg"])) if night else (float(n["sunElevationDeg"]), float(n["sunAzimuthDeg"]))
    master = {"ultra": max(tiers.values())}
    # clouds are composited by the treatment for these (occluding stars, afterglow-lit, hidden in fog)
    clouds = 0.0 if treatment in ("night", "overcast", "dusk", "fog") else float(n["clouds"])
    baked = S.bake_sky(ctx, sun_elevation=el, sun_azimuth=az, tiers=master, altitude=float(n.get("altitude", 0)),
                       air=float(n["air"]), aerosol=float(n["aerosol"]), ozone=float(n["ozone"]),
                       ground_albedo=tuple(n["groundAlbedo"]), clouds=clouds, cloud_scale=float(n.get("cloudScale", 1.0)))
    sky = load_exr(ctx.path(f"{ctx.id}.ultra.exr"))
    d_bl = sun_dir_bl(el, az)
    fog = hex_linear(p["fog"]["color"])
    rng = np.random.default_rng(ctx.seed % (2 ** 32))
    with timer(f"treatment {treatment}"):
        if night:
            lum = luminance(sky)[..., None]
            blue = np.array([0.42, 0.56, 1.0])
            blue = blue / float(luminance(blue[None, None, :])[0, 0])
            sky = (sky * 0.35 + lum * blue[None, None, :] * 0.65).astype(F)
            # deepen the zenith relative to the horizon glow (reads as night at any exposure)
            LAT, _ = latlon(*sky.shape[:2])
            zen = 0.5 + 0.5 * np.exp(-np.clip(LAT, 0, None) / math.radians(22.0))
            sky = (sky * np.where(LAT > 0, zen, 1.0)[..., None]).astype(F)
        elif treatment == "overcast":
            sky = overcast(sky, fog, rng, d_bl)
        elif treatment == "haze":
            # pale, bright dusty dome: the fog tone lifted halfway to white, brighter than the clear horizon
            sky = horizon_blend(sky, fog * 0.5 + 0.5 * float(fog.max()), 20.0, 0.35, desat=0.3, floor=0.5, gain=1.8)
        elif treatment == "fog":
            sky = horizon_blend(sky, fog, 25.0, 0.33, desat=0.5, floor=0.62)
        elif treatment == "dusk":
            sky = afterglow(sky, hex_linear(p["fog"]["inscatter"]), az, float(n["clouds"]), float(n.get("cloudScale", 1.0)), rng)
    # calibrate to the preset irradiance (upper hemisphere; the ground-bounce rows scale along)
    target = float(p["sky"]["irradiance"])
    amb0 = ambient_irradiance(sky)
    k = target / max(amb0, 1e-9)
    sky = (sky * k).astype(F)
    if night:
        with timer("stars + moonlit clouds"):
            sky = add_stars(sky, rng)
            # thin, dim moonlit clouds (a quarter of the moon's light: grey-blue, never daylight-white)
            moon = hex_linear(sun["color"])
            sky = S.add_clouds(sky, d_bl, (moon / moon.max() * float(sun["intensity"]) * 0.25).astype(F), float(n["clouds"]), rng, 1.0)
        # stars / clouds shift the irradiance slightly: re-calibrate exactly
        k2 = target / max(ambient_irradiance(sky), 1e-9)
        sky = (sky * k2).astype(F)
        k *= k2
    amb = ambient_irradiance(sky)
    files: dict[str, dict[str, int]] = {}
    for tier, tw in sorted(tiers.items(), key=lambda kv: -kv[1]):
        arr = sky if tw == sky.shape[1] else tg.resize(sky, tw // 2, tw)
        path = save_exr(arr, ctx.path(f"{ctx.id}.{tier}.exr"), DWA_QUALITY.get(tier, 50))
        ctx.add_file(f"hdri_{tier}", path, tier=tier, width=tw, height=tw // 2)
        files[tier] = {"width": tw, "height": tw // 2}
    # preview (same filmic curve as lib/sky.py, exposure from the preset)
    prev = tg.resize(sky, 512, 1024) * float(p.get("exposure", 1.0)) / max(target, 0.05) * 0.45
    mapped = (prev * (2.51 * prev + 0.03)) / (prev * (2.43 * prev + 0.59) + 0.14)
    ctx.add_file("preview", tg.write_png(ctx.path("preview.png"), np.clip(mapped, 0, 1), 8, srgb_encode=True))
    sc = hex_linear(sun["color"])
    meta = dict(baked)
    meta.update({
        "sun": {"direction": [round(v, 5) for v in S.blender_to_three(d_bl)], "color": [round(float(c), 4) for c in sc / sc.max()],
                "intensity": float(sun["intensity"]), "elevationDeg": el, "azimuthDeg": az},
        "ambientIrradiance": round(amb, 4),
        "scale": float(baked["scale"]) * k,
        "clouds": float(n["clouds"]),
        "tiers": files,
        "preset": preset_name,
        "treatment": treatment,
        "baked": {"sunIntensity": baked["sun"]["intensity"], "ambientIrradiance": baked["ambientIrradiance"],
                  "calibration": round(k, 5)},
        "description": description,
    })
    ctx.meta.update(meta)
    log(f"{ctx.id}: preset {preset_name} sun el {el} az {az} -> ambient {amb:.4f} (target {target}), calibration x{k:.4f}")
    return ctx


__all__ = ["DWA_QUALITY", "TIERS", "add_stars", "afterglow", "ambient_irradiance", "build", "horizon_blend", "overcast", "recompress", "style"]
