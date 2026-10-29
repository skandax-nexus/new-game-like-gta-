"""
Cycles CPU preview renders for the self-critique loop (render -> PNG -> inspect with the Read tool ->
iterate). OWNER: Technical Art Director.

    setup_world(sun_elevation=28, sun_azimuth=225, strength=1.0)   physical sky (no sun disc) for IBL
    add_sun(elevation, azimuth, strength, angle)                    matching sun lamp (crisp shadows)
    add_ground(size, color, roughness)                              neutral ground plane
    frame_camera(objects | bounds, azimuth, elevation, lens)        camera that frames the bounds
    render(path, res=(1280,720), samples=64)                        denoised PNG (AgX view)
    preview(path, objects, ...)                                     all of the above in one call

Angles in degrees. Azimuth is measured from +Y (north) towards +X (east), i.e. compass bearing.
Blender is +Z up; the asset is assumed to sit on Z=0.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Iterable, Sequence

import bpy
from mathutils import Vector

from .core import log, timer
from .texgen import hex_to_linear


def _dir(elevation: float, azimuth: float) -> Vector:
    el = math.radians(elevation)
    az = math.radians(azimuth)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


def setup_world(sun_elevation: float = 28.0, sun_azimuth: float = 225.0, strength: float = 0.35,
                ground_albedo: float = 0.25, aerosol: float = 1.4, sky_type: str = "MULTIPLE_SCATTERING"):
    """Physical sky world WITHOUT the sun disc (the sun comes from add_sun for clean shadows)."""
    scn = bpy.context.scene
    world = scn.world or bpy.data.worlds.new("preview_world")
    scn.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = sky_type
    sky.sun_disc = False
    sky.sun_elevation = math.radians(sun_elevation)
    # Calibrated: Blender's sky sun_rotation equals the compass bearing (0 = +Y north, 90 = +X east).
    sky.sun_rotation = math.radians(sun_azimuth)
    if hasattr(sky, "aerosol_density"):
        sky.aerosol_density = aerosol
    if hasattr(sky, "ground_albedo"):
        sky.ground_albedo = ground_albedo
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    return world


def add_sun(elevation: float = 28.0, azimuth: float = 225.0, strength: float = 4.0, angle_deg: float = 0.55,
            color: str = "#fff1dc") -> bpy.types.Object:
    light = bpy.data.lights.new("preview_sun", "SUN")
    light.energy = strength
    light.angle = math.radians(angle_deg)
    c = hex_to_linear(color)
    light.color = (float(c[0]), float(c[1]), float(c[2]))
    obj = bpy.data.objects.new("preview_sun", light)
    bpy.context.scene.collection.objects.link(obj)
    d = _dir(elevation, azimuth)
    obj.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    return obj


def add_ground(size: float = 200.0, color: str = "#6b5a46", roughness: float = 0.95, z: float = 0.0) -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    g = bpy.context.active_object
    g.name = "preview_ground"
    mat = bpy.data.materials.new("preview_ground")
    mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    c = hex_to_linear(color)
    b.inputs["Base Color"].default_value = (float(c[0]), float(c[1]), float(c[2]), 1.0)
    b.inputs["Roughness"].default_value = roughness
    g.data.materials.append(mat)
    return g


def bounds_of(objects: Iterable[bpy.types.Object]) -> tuple[Vector, Vector]:
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objects:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        for c in ev.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def frame_camera(objects: Sequence[bpy.types.Object] | None = None, bounds: tuple[Vector, Vector] | None = None,
                 azimuth: float = 200.0, elevation: float = 18.0, lens: float = 50.0, margin: float = 1.08,
                 target: Vector | None = None, aspect: float = 16 / 9) -> bpy.types.Object:
    """Place a perspective camera so the bounding sphere of `objects` fills the frame."""
    scn = bpy.context.scene
    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.lens = lens
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.sensor_width = 36.0
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    lo, hi = bounds if bounds is not None else bounds_of(objects or [])
    center = (lo + hi) * 0.5 if target is None else target
    radius = (hi - lo).length * 0.5
    hfov = 2.0 * math.atan(18.0 / lens)
    vfov = 2.0 * math.atan(math.tan(hfov / 2.0) / aspect)
    dist = radius * margin / math.sin(min(hfov, vfov) / 2.0)
    d = _dir(elevation, azimuth)
    cam.location = center + d * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_start = max(0.01, dist * 0.01)
    cam_data.clip_end = dist * 50.0
    return cam


def look_at_camera(location: Sequence[float], target: Sequence[float], lens: float = 35.0) -> bpy.types.Object:
    scn = bpy.context.scene
    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.lens = lens
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.location = Vector(location)
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_start = 0.05
    cam_data.clip_end = 5000.0
    return cam


def render(path: Path | str, res: tuple[int, int] = (1280, 720), samples: int = 64, exposure: float = 0.0,
           look: str = "AgX - Medium High Contrast", denoise: bool = True) -> Path:
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    c = scn.cycles
    c.device = "CPU"
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02
    c.use_denoising = denoise
    c.max_bounces = 6
    c.diffuse_bounces = 3
    c.glossy_bounces = 2
    c.transparent_max_bounces = 4
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.seed = 1
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = False
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = look
    scn.view_settings.exposure = exposure
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGB"
    scn.render.image_settings.color_depth = "8"
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    scn.render.filepath = str(path)
    with timer(f"render {res[0]}x{res[1]} @{samples}spp -> {path.name}"):
        bpy.ops.render.render(write_still=True)
    return path


def preview(path: Path | str, objects: Sequence[bpy.types.Object], azimuth: float = 200.0, elevation: float = 15.0,
            lens: float = 50.0, sun_elevation: float = 30.0, sun_azimuth: float = 240.0, sun_strength: float = 4.0,
            sky_strength: float = 0.35, res: tuple[int, int] = (1280, 720), samples: int = 64, ground: bool = True,
            ground_color: str = "#6b5a46", margin: float = 1.05, exposure: float = 0.0) -> Path:
    setup_world(sun_elevation, sun_azimuth, sky_strength)
    add_sun(sun_elevation, sun_azimuth, sun_strength)
    if ground:
        lo, _ = bounds_of(objects)
        add_ground(color=ground_color, z=min(0.0, lo.z))
    frame_camera(objects, azimuth=azimuth, elevation=elevation, lens=lens, margin=margin, aspect=res[0] / res[1])
    log(f"preview -> {path}")
    return render(path, res, samples, exposure)


__all__ = [
    "add_ground",
    "add_sun",
    "bounds_of",
    "frame_camera",
    "look_at_camera",
    "preview",
    "render",
    "setup_world",
]
