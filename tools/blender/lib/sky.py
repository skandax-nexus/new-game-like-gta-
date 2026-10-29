"""
Physical sky -> equirectangular HDR environment maps (Blender multiple-scattering sky, Cycles CPU).
OWNER: Technical Art Director.

    meta = bake_sky(ctx, sun_elevation=35, sun_azimuth=135, tiers={"ultra": 2048, "high": 1024, "mobile": 512})

Outputs (in ctx.out_dir): <id>.<tier>.exr (half float, DWAB, 2:1 equirect, NO sun disc) + a tone-mapped
preview PNG. Metadata (manifest `hdri` entry):
    sun.direction  unit vector TOWARDS the sun in three.js space (+Y up, +Z south)
    sun.color      linear RGB, max component 1
    sun.intensity  irradiance for a three.js DirectionalLight (same units as the env map, which is
                   loaded with envMapIntensity 1) -> the sun disc is removed from the map and given to
                   the light so shadows are crisp and specular highlights are not double counted
    scale          factor applied to Blender's radiance so that sun.intensity == SUN_TARGET (3.4, the
                   game's daylight sun intensity)
Orientation: the equirect matches three.js `EquirectangularReflectionMapping` (u = 0.5 -> +X,
u = 0.75 -> +Z, top row = +Y); calibrated with the pano camera at rotation (90, 0, -90) deg.
Azimuth convention: compass bearing in degrees, 0 = north (-Z in three / +Y in Blender), 90 = east (+X).
The lower hemisphere is replaced by a ground bounce (albedo x irradiance / pi) so IBL undersides are lit.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import bpy
import numpy as np

from . import texgen as tg
from .core import AssetContext, log, timer

F = np.float32
SUN_TARGET = 3.4


def _world(sun_elevation: float, sun_azimuth: float, sun_disc: bool, altitude: float, air: float, aerosol: float,
           ozone: float, sun_size_deg: float) -> None:
    scn = bpy.context.scene
    world = scn.world or bpy.data.worlds.new("sky")
    scn.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = sun_disc
    sky.sun_size = math.radians(sun_size_deg)
    sky.sun_intensity = 1.0
    sky.sun_elevation = math.radians(sun_elevation)
    # Blender sun_rotation (calibrated): sun azimuth from +X towards +Y = 90 deg - rotation, i.e. the
    # rotation IS the compass bearing (0 = north = Blender +Y, 90 = east = +X).
    sky.sun_rotation = math.radians(sun_azimuth)
    sky.altitude = altitude
    sky.air_density = air
    sky.aerosol_density = aerosol
    sky.ozone_density = ozone
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])


def _pano_camera(lon: tuple[float, float] = (-math.pi, math.pi), lat: tuple[float, float] = (-math.pi / 2, math.pi / 2)):
    scn = bpy.context.scene
    cd = bpy.data.cameras.get("sky_pano") or bpy.data.cameras.new("sky_pano")
    cd.type = "PANO"
    cd.panorama_type = "EQUIRECTANGULAR"
    cd.longitude_min, cd.longitude_max = lon
    cd.latitude_min, cd.latitude_max = lat
    cam = bpy.data.objects.get("sky_pano") or bpy.data.objects.new("sky_pano", cd)
    if cam.name not in scn.collection.objects:
        scn.collection.objects.link(cam)
    cam.location = (0, 0, 0)
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    scn.camera = cam
    return cam


def _render_float(w: int, h: int, samples: int) -> np.ndarray:
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    c = scn.cycles
    c.device = "CPU"
    c.samples = samples
    c.use_denoising = False
    c.use_adaptive_sampling = False
    c.seed = 0
    scn.render.resolution_x = w
    scn.render.resolution_y = h
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = False
    scn.view_settings.view_transform = "Standard"
    scn.view_settings.look = "None"
    scn.view_settings.exposure = 0.0
    bpy.ops.render.render()
    img = bpy.data.images["Render Result"]
    # Render Result pixels are only readable after saving; use a viewer-free path: save to EXR, reload.
    tmp = Path(bpy.app.tempdir or "/tmp") / f"samrajya_sky_{w}x{h}.exr"
    scn.render.image_settings.file_format = "OPEN_EXR"
    scn.render.image_settings.color_depth = "32"
    scn.render.image_settings.exr_codec = "ZIP"
    img.save_render(str(tmp), scene=scn)
    loaded = bpy.data.images.load(str(tmp))
    arr = tg.image_to_numpy(loaded)[..., :3].copy()
    bpy.data.images.remove(loaded)
    tmp.unlink(missing_ok=True)
    return arr


def _save_exr(arr: np.ndarray, path: Path, codec: str = "DWAB") -> Path:
    h, w = arr.shape[:2]
    im = bpy.data.images.new(path.stem, w, h, alpha=False, float_buffer=True)
    im.colorspace_settings.name = "Linear Rec.709"
    im.pixels.foreach_set(tg.to_blender(arr))
    scn = bpy.context.scene
    s = scn.render.image_settings
    s.file_format = "OPEN_EXR"
    s.color_mode = "RGB"
    s.color_depth = "16"
    s.exr_codec = codec
    if hasattr(s, "quality"):
        s.quality = 90
    im.save_render(str(path), scene=scn)
    bpy.data.images.remove(im)
    return path


def blender_to_three(v: tuple[float, float, float]) -> list[float]:
    return [v[0], v[2], -v[1]]


def bake_sky(ctx: AssetContext, sun_elevation: float = 35.0, sun_azimuth: float = 135.0,
             tiers: dict[str, int] | None = None, altitude: float = 300.0, air: float = 1.0, aerosol: float = 1.6,
             ozone: float = 1.0, ground_albedo: tuple[float, float, float] = (0.22, 0.18, 0.13),
             sun_size_deg: float = 0.545, samples: int = 16, sun_target: float = SUN_TARGET) -> dict[str, Any]:
    tiers = tiers or {"ultra": 2048, "high": 1024, "mobile": 512}
    W = max(tiers.values())
    if ctx.draft:
        W = min(W, 1024)
    H = W // 2
    with timer("sky radiance"):
        _world(sun_elevation, sun_azimuth, False, altitude, air, aerosol, ozone, sun_size_deg)
        _pano_camera()
        sky = _render_float(W, H, samples)
    # --- sun: integrate (disc - no disc) over a small window around the sun direction
    el = math.radians(sun_elevation)
    rot = math.radians(90.0 - sun_azimuth)
    d_bl = (math.cos(el) * math.cos(rot), math.cos(el) * math.sin(rot), math.sin(el))
    # camera longitude range is mirrored w.r.t. the world azimuth phi (from +X towards +Y): lon = -phi
    sun_lon = -math.atan2(d_bl[1], d_bl[0])
    win = math.radians(max(1.2, sun_size_deg * 2.2))
    lon = (sun_lon - win, sun_lon + win)
    lat = (max(-math.pi / 2, el - win), min(math.pi / 2, el + win))
    n = 192
    with timer("sun disc integration"):
        _world(sun_elevation, sun_azimuth, True, altitude, air, aerosol, ozone, sun_size_deg)
        _pano_camera(lon, lat)
        with_disc = _render_float(n, n, 4)
        _world(sun_elevation, sun_azimuth, False, altitude, air, aerosol, ozone, sun_size_deg)
        no_disc = _render_float(n, n, 4)
    diff = np.clip(with_disc - no_disc, 0.0, None)
    lats = lat[1] - (np.arange(n) + 0.5) / n * (lat[1] - lat[0])
    d_omega = ((lon[1] - lon[0]) / n) * ((lat[1] - lat[0]) / n) * np.cos(lats)[:, None]
    e_sun = (diff * d_omega[..., None]).sum(axis=(0, 1))
    lum = float(tg.luminance(e_sun[None, None, :])[0, 0])
    if lum <= 1e-6:
        log("WARNING: sun below horizon or not found - using sky-only lighting")
        scale = 1.0
        sun_color = [1.0, 1.0, 1.0]
        sun_intensity = 0.0
    else:
        scale = sun_target / lum
        sun_color = (e_sun / max(float(e_sun.max()), 1e-9)).tolist()
        # color (max component 1) * intensity == scaled sun irradiance
        sun_intensity = float(e_sun.max() * scale)
    sky = sky * scale
    # --- ground bounce below the horizon
    v_lat = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
    lat_w = np.cos(v_lat)[:, None]
    dO = (2 * math.pi / W) * (math.pi / H) * lat_w
    upper = v_lat > 0
    e_sky_down = (sky[upper] * (dO[upper] * np.sin(v_lat[upper])[:, None])[..., None]).sum(axis=(0, 1))
    e_ground = e_sky_down + np.array(sun_color) * sun_intensity * max(0.0, math.sin(el))
    ground = np.array(ground_albedo, F) * e_ground / math.pi
    t = tg.smoothstep(0.0, math.radians(4.0), -v_lat)[:, None, None]
    sky = (sky * (1 - t) + ground[None, None, :] * t).astype(F)
    ambient = float(tg.luminance(e_sky_down[None, None, :])[0, 0])
    files: dict[str, dict[str, Any]] = {}
    for tier, tw in sorted(tiers.items(), key=lambda kv: -kv[1]):
        tw = min(tw, W)
        arr = sky if tw == W else tg.resize(sky, tw // 2, tw)
        p = _save_exr(arr, ctx.path(f"{ctx.id}.{tier}.exr"))
        ctx.add_file(f"hdri_{tier}", p, tier=tier, width=tw, height=tw // 2)
        files[tier] = {"width": tw, "height": tw // 2}
    # tone-mapped preview (simple filmic curve) for the critique loop
    prev = tg.resize(sky, 256, 512)
    x = prev * 0.6
    mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
    pp = tg.write_png(ctx.path("preview.png"), np.clip(mapped, 0, 1), 8, srgb_encode=True)
    ctx.add_file("preview", pp)
    sun_dir = blender_to_three(d_bl)
    meta = {
        "sun": {"direction": [round(v, 5) for v in sun_dir], "color": [round(float(c), 4) for c in sun_color],
                "intensity": round(sun_intensity, 4), "elevationDeg": sun_elevation, "azimuthDeg": sun_azimuth},
        "ambientIrradiance": round(ambient, 4),
        "scale": scale,
        "groundAlbedo": list(ground_albedo),
        "tiers": files,
    }
    log(f"sky: sun {sun_dir} intensity {sun_intensity:.3f} color {np.round(sun_color, 3)} ambient {ambient:.3f}")
    return meta


__all__ = ["SUN_TARGET", "bake_sky", "blender_to_three"]
