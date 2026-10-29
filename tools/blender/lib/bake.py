"""
Cycles CPU baking. OWNER: Technical Art Director.

    configure(samples, margin)                      Cycles bake settings (CPU, deterministic seed)
    new_image(name, w, h, float_buffer, non_color)  bake target image
    bake(obj, 'AO'|'NORMAL'|'EMIT'|..., image, selected=[high...], cage_extrusion, max_ray_distance)
                                                    -> top-down float RGBA numpy array
    bake_channel(obj, image, 'Base Color'|'Roughness'|'Metallic'|..., selected=[...])
                                                    bake ONE Principled BSDF input via an emission rewire
    bake_texture_set(low, res, highs=[...])         baseColor / normal / roughness / metallic / ao (+ ORM pack)
    pack_orm(ao, roughness, metallic)               glTF ORM: R=occlusion, G=roughness, B=metalness
    heightfield_mesh(height, size_m, verts)         displaced high-poly grid with a periodic margin
    bake_heightfield_ao(height, size_m, res, ...)   ray-traced AO of a tiling height map (seamless)

Notes
    * Tangent-space normals are MikkTSpace / OpenGL (+Y), same as glTF + three.js when the mesh is
      exported WITH tangents (export.gltf(..., tangents=True)).
    * Float bake targets store LINEAR values; texgen.write_png(..., srgb_encode=True) for base color.
    * The low-poly must have a UV map; every material slot of the low gets a temporary active image
      node that is removed after the bake.
"""
from __future__ import annotations

from typing import Iterable, Sequence

import bpy
import numpy as np

from . import texgen as tg
from .core import log, timer

F = np.float32


def configure(samples: int = 16, margin: int = 16, seed: int = 0) -> None:
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    c = scn.cycles
    c.device = "CPU"
    c.samples = samples
    c.seed = seed
    c.use_animated_seed = False
    c.use_denoising = False
    c.use_adaptive_sampling = False
    b = scn.render.bake
    b.margin = margin
    b.margin_type = "EXTEND"
    b.target = "IMAGE_TEXTURES"
    b.use_clear = True


def new_image(name: str, w: int, h: int | None = None, float_buffer: bool = True, non_color: bool = True):
    h = h or w
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=float_buffer)
    img.colorspace_settings.name = "Non-Color" if non_color else "Linear Rec.709"
    return img


def _attach_target(obj: bpy.types.Object, image) -> list[tuple]:
    """Add an active Image Texture node holding `image` to every material of obj."""
    if not obj.data.materials:
        mat = bpy.data.materials.new(f"{obj.name}_bake")
        obj.data.materials.append(mat)
    added = []
    for mat in obj.data.materials:
        if mat is None:
            continue
        nt = mat.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = image
        node.interpolation = "Closest"
        nt.nodes.active = node
        node.select = True
        added.append((mat, node))
    return added


def _detach(added: list[tuple]) -> None:
    for mat, node in added:
        mat.node_tree.nodes.remove(node)


def _select_only(objs: Iterable[bpy.types.Object], active: bpy.types.Object) -> None:
    for o in [x for x in bpy.context.view_layer.objects if x is not None]:
        o.select_set(False)
    for o in objs:
        o.hide_render = False
        o.hide_set(False)
        o.select_set(True)
    active.select_set(True)
    bpy.context.view_layer.objects.active = active


def bake(
    obj: bpy.types.Object,
    bake_type: str,
    image,
    selected: Sequence[bpy.types.Object] = (),
    cage_extrusion: float = 0.0,
    max_ray_distance: float = 0.0,
    samples: int | None = None,
    normal_space: str = "TANGENT",
    pass_filter: set[str] | None = None,
    uv_layer: str = "",
) -> np.ndarray:
    """Bake into `image` and return it as a top-down float RGBA array."""
    scn = bpy.context.scene
    if samples is not None:
        scn.cycles.samples = samples
    b = scn.render.bake
    b.use_selected_to_active = bool(selected)
    b.cage_extrusion = cage_extrusion
    b.max_ray_distance = max_ray_distance
    b.normal_space = normal_space
    b.normal_r, b.normal_g, b.normal_b = "POS_X", "POS_Y", "POS_Z"
    added = _attach_target(obj, image)
    _select_only(list(selected) + [obj], obj)
    kwargs = dict(type=bake_type, use_selected_to_active=bool(selected), cage_extrusion=cage_extrusion,
                  max_ray_distance=max_ray_distance, normal_space=normal_space, margin=b.margin,
                  margin_type=b.margin_type, use_clear=True, target="IMAGE_TEXTURES", uv_layer=uv_layer)
    if pass_filter is not None:
        kwargs["pass_filter"] = pass_filter
    try:
        with timer(f"bake {bake_type} {image.size[0]}x{image.size[1]} on {obj.name} (+{len(selected)} high)"):
            bpy.ops.object.bake(**kwargs)
    finally:
        _detach(added)
    return tg.image_to_numpy(image)


# Principled BSDF inputs that can be baked through an emission rewire.
CHANNEL_INPUTS = {
    "baseColor": "Base Color",
    "roughness": "Roughness",
    "metallic": "Metallic",
    "alpha": "Alpha",
    "emission": "Emission Color",
}


def _principled_rewire(mats: Iterable[bpy.types.Material], input_name: str) -> list[tuple]:
    """Temporarily route `input_name` of each material's Principled BSDF to an Emission output."""
    saved = []
    for mat in mats:
        if mat is None or not mat.use_nodes:
            continue
        nt = mat.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if out is None or bsdf is None:
            continue
        surf = out.inputs["Surface"]
        prev = surf.links[0].from_socket if surf.links else None
        emit = nt.nodes.new("ShaderNodeEmission")
        emit.inputs["Strength"].default_value = 1.0
        src = bsdf.inputs[input_name]
        if src.links:
            nt.links.new(src.links[0].from_socket, emit.inputs["Color"])
        else:
            dv = src.default_value
            emit.inputs["Color"].default_value = (dv[0], dv[1], dv[2], 1.0) if hasattr(dv, "__len__") else (dv, dv, dv, 1.0)
        nt.links.new(emit.outputs["Emission"], surf)
        saved.append((mat, emit, prev, surf))
    return saved


def _principled_restore(saved: list[tuple]) -> None:
    for mat, emit, prev, surf in saved:
        nt = mat.node_tree
        nt.nodes.remove(emit)
        if prev is not None:
            nt.links.new(prev, surf)


def bake_channel(
    obj: bpy.types.Object, image, channel: str, selected: Sequence[bpy.types.Object] = (), **kw
) -> np.ndarray:
    """Bake one Principled input (channel key of CHANNEL_INPUTS) as emission. Returns RGBA array."""
    src_objs = list(selected) if selected else [obj]
    mats = {m for o in src_objs for m in o.data.materials if m is not None}
    saved = _principled_rewire(mats, CHANNEL_INPUTS[channel])
    try:
        return bake(obj, "EMIT", image, selected=selected, samples=kw.pop("samples", 1), **kw)
    finally:
        _principled_restore(saved)


def pack_orm(ao: np.ndarray, roughness: np.ndarray, metallic: np.ndarray) -> np.ndarray:
    return np.stack([ao, roughness, metallic], axis=-1).astype(F)


def bake_texture_set(
    low: bpy.types.Object,
    res: int,
    highs: Sequence[bpy.types.Object] = (),
    maps: Sequence[str] = ("baseColor", "normal", "roughness", "metallic", "ao"),
    ao_samples: int = 64,
    ao_distance: float = 0.5,
    normal_samples: int = 8,
    cage_extrusion: float = 0.05,
    max_ray_distance: float = 0.2,
    margin: int = 16,
    uv_layer: str = "",
) -> dict[str, np.ndarray]:
    """Bake a PBR texture set from the low-poly's own node material (or from `highs` selected-to-active).
    Returns top-down arrays: baseColor (linear RGB), normal (encoded RGB 0..1), roughness, metallic, ao,
    and 'orm' when ao/roughness/metallic are all present."""
    configure(samples=1, margin=margin)
    out: dict[str, np.ndarray] = {}
    sel_kw = dict(selected=highs, cage_extrusion=cage_extrusion if highs else 0.0,
                  max_ray_distance=max_ray_distance if highs else 0.0, uv_layer=uv_layer)
    for m in maps:
        img = new_image(f"__bake_{m}", res, res, float_buffer=True, non_color=True)
        if m in CHANNEL_INPUTS:
            arr = bake_channel(low, img, m, **sel_kw)
            out[m] = arr[..., :3] if m in ("baseColor", "emission") else arr[..., 0]
        elif m == "normal":
            out[m] = bake(low, "NORMAL", img, samples=normal_samples, **sel_kw)[..., :3]
        elif m == "ao":
            bpy.context.scene.world = bpy.context.scene.world or bpy.data.worlds.new("bake_world")
            bpy.context.scene.world.light_settings.distance = ao_distance
            out[m] = bake(low, "AO", img, samples=ao_samples, **sel_kw)[..., 0]
        else:
            raise ValueError(f"unknown map {m}")
        bpy.data.images.remove(img)
    if all(k in out for k in ("ao", "roughness", "metallic")):
        out["orm"] = pack_orm(out["ao"], out["roughness"], out["metallic"])
    return out


# ------------------------------------------------------------------------------- heightfield tiles
def _sample_periodic(img: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Bilinear periodic sample of a top-down image at UV (v up)."""
    h, w = img.shape
    x = u * w - 0.5
    y = (1.0 - v) * h - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    tx = (x - x0).astype(F)
    ty = (y - y0).astype(F)
    x0m, x1m = x0 % w, (x0 + 1) % w
    y0m, y1m = y0 % h, (y0 + 1) % h
    a = img[y0m, x0m]
    b = img[y0m, x1m]
    c = img[y1m, x0m]
    d = img[y1m, x1m]
    return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty).astype(F)


def grid_mesh(name: str, nx: int, ny: int, x0: float, y0: float, x1: float, y1: float,
              z: np.ndarray | None = None, uv: tuple[float, float, float, float] | None = None) -> bpy.types.Object:
    """Fast numpy grid mesh (nx*ny vertices) with optional per-vertex heights and a UV map."""
    xs = np.linspace(x0, x1, nx, dtype=F)
    ys = np.linspace(y0, y1, ny, dtype=F)
    X, Y = np.meshgrid(xs, ys)
    Z = np.zeros_like(X) if z is None else z.reshape(ny, nx).astype(F)
    co = np.stack([X, Y, Z], axis=-1).reshape(-1)
    me = bpy.data.meshes.new(name)
    me.vertices.add(nx * ny)
    me.vertices.foreach_set("co", co)
    ix = np.arange(nx - 1)
    iy = np.arange(ny - 1)
    IX, IY = np.meshgrid(ix, iy)
    v0 = (IY * nx + IX).reshape(-1)
    quads = np.stack([v0, v0 + 1, v0 + nx + 1, v0 + nx], axis=-1).reshape(-1).astype(np.int32)
    nq = (nx - 1) * (ny - 1)
    me.loops.add(nq * 4)
    me.loops.foreach_set("vertex_index", quads)
    me.polygons.add(nq)
    me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.update(calc_edges=True)
    if uv is not None:
        u0, v0_, u1, v1 = uv
        U = (X - x0) / (x1 - x0) * (u1 - u0) + u0
        V = (Y - y0) / (y1 - y0) * (v1 - v0_) + v0_
        uvs = np.stack([U, V], axis=-1).reshape(-1, 2)
        layer = me.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", uvs[quads].reshape(-1))
    me.validate()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def heightfield_mesh(height: np.ndarray, size_m: tuple[float, float], verts: int, margin: float = 0.08,
                     name: str = "heightfield_high") -> bpy.types.Object:
    """Displaced grid covering [-margin, 1+margin] of the tile (periodic sampling), Z = height (m)."""
    W, H = size_m
    n = int(verts * (1 + 2 * margin))
    u = np.linspace(-margin, 1 + margin, n, dtype=F)
    U, V = np.meshgrid(u, u)
    Z = _sample_periodic(height, U % 1.0, V % 1.0)
    obj = grid_mesh(name, n, n, -margin * W, -margin * H, (1 + margin) * W, (1 + margin) * H, Z,
                    uv=(-margin, -margin, 1 + margin, 1 + margin))
    obj.data.shade_smooth() if hasattr(obj.data, "shade_smooth") else None
    return obj


def bake_heightfield_ao(height: np.ndarray, size_m: tuple[float, float], res: int, samples: int = 64,
                        distance: float = 0.06, mesh_verts: int = 1024, margin: float = 0.08) -> np.ndarray:
    """Ray-traced ambient occlusion of a tiling height map (meters), seamless thanks to the periodic
    margin. Returns a top-down (res, res) array in [0,1]."""
    W, H = size_m
    hmin, hmax = float(height.min()), float(height.max())
    with timer(f"heightfield mesh {mesh_verts}^2"):
        high = heightfield_mesh(height, size_m, mesh_verts, margin)
    low = grid_mesh("heightfield_low", 2, 2, 0.0, 0.0, W, H, np.full(4, hmax + 0.002, F), uv=(0, 0, 1, 1))
    mat = bpy.data.materials.new("hf_low")
    low.data.materials.append(mat)
    hmat = bpy.data.materials.new("hf_high")
    high.data.materials.append(hmat)
    configure(samples=samples, margin=0)
    scn = bpy.context.scene
    if scn.world is None:
        scn.world = bpy.data.worlds.new("bake_world")
    scn.world.light_settings.distance = distance
    img = new_image("__hf_ao", res, res)
    rng = hmax - hmin
    arr = bake(low, "AO", img, selected=[high], cage_extrusion=0.0, max_ray_distance=rng + 0.01, samples=samples)
    ao = arr[..., 0]
    bpy.data.images.remove(img)
    for o in (high, low):
        me = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)
    log(f"heightfield AO mean={float(ao.mean()):.3f} min={float(ao.min()):.3f}")
    return ao.astype(F)


__all__ = [
    "CHANNEL_INPUTS",
    "bake",
    "bake_channel",
    "bake_heightfield_ao",
    "bake_texture_set",
    "configure",
    "grid_mesh",
    "heightfield_mesh",
    "new_image",
    "pack_orm",
]
