"""
WP4 asset entry points (package-local helper, not an asset): leaf-atlas pages (image kind x 3 maps), bark sets
(material kind), tree models (model kind, one shape variant per asset) and tree impostors (impostor kind), with QA
metadata and the Cycles critique previews. OWNER: Technical Artist D (TA-04).

Each asset script is three lines, e.g. tools/blender/assets/vegetation/tree_peepal.py:

    import _vegassets
    _vegassets.tree_model(__file__, "peepal", "a")

Runtime contract (GFX-03): see the model's manifest `meta` (written by tree_model) - atlas ids, regions, crown centre /
axes, card classes, seasonal rule, LOD distances, impostor id. Formats: docs/sprint1/ta-04/README.md.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import bpy
import numpy as np

import _leafkit as K
import _species as SP
import _trees as T
import _vegkit as V
from lib import core, export, impostor as IMP, render, texgen as tg
from lib.core import log, timer

F = np.float32
ATLAS_PX = 2048
ATLAS_SS = 2
LEAF_TRANSLUCENCY = 0.35   # ART_BIBLE §7.2
ALPHA_CUT = 0.5
PREVIEW_EV = -0.6  # previews: sunlit dry earth ~70 % on screen (ART_BIBLE §3.1)
SEASON_RULE = ("card visible = showAlt || r < foliage[season]; showAlt = flowering(season) && r < flowering.coverage "
               "&& UVAlt != UVMap; class 0.25 (structural) always visible; class 0.5 (seasonal) only when showAlt; "
               "class 0.75 (bare twigs) visible when foliage[season] < 0.6; base regions tinted leaf[season] / "
               "leaf.sharad, alternate regions untinted")


def _image_ctx(script: str) -> core.AssetContext:
    ctx = core.begin(script, kind="model")
    ctx.kind = "image"
    return ctx


def _style_species(sp: str) -> dict:
    return V.style(f"vegetation:TREE_SPECIES.{sp}")


# ================================================================================================ atlas pages
def atlas_page(script: str, page_id: str) -> None:
    """`veg_leaves_<p>`: the colour + alpha page (image, sRGB, A class 2048 / 1024 / 512). Also writes the page's
    normal.png / orm.png / regions.json into the cache for the _normal / _orm image assets and the tree builders."""
    ctx = _image_ctx(script)
    px = ctx.res(ATLAS_PX, 512)
    page = K.Page(px, ss=ATLAS_SS)
    qa: dict[str, Any] = {}
    for sp in SP.PAGES[page_id]:
        spec = SP.SPECIES[sp]
        st = _style_species(sp)
        with timer(f"paint {sp}"):
            for rs in spec.regions:
                page.paint(sp, spec.block, rs, seed=core.stable_seed("leaf", sp, rs.name))
        _calibrate_species(page, spec, st, qa)
    im = K.page_images(page)
    pc = tg.write_png(ctx.path("color.png"), im["color"], 8)
    tg.write_png(ctx.path("normal.png"), im["normal"], 8)
    tg.write_png(ctx.path("orm.png"), im["orm"], 8)
    ctx.path("regions.json").write_text(json.dumps(page.regions, indent=1, sort_keys=True))
    ctx.add_file("image", pc)
    if ctx.preview:
        a = im["color"][..., 3:4]
        chk = _checker(px)[..., None]
        prev = im["color"][..., :3] * a + chk * (1 - a)
        ctx.add_file("preview", tg.write_png(ctx.path("preview.png"), prev, 8))
    ctx.meta.update({
        "alpha": True, "colorSpace": "srgb", "hdrScale": 1.0,
        "usage": f"Leaf-card atlas page {page_id} (A class): {', '.join(SP.PAGES[page_id])}. sRGB colour + coverage alpha "
                 f"(alpha test {ALPHA_CUT}); regions and UVs: tree_* model meta. Maps: {ctx.id}_normal, {ctx.id}_orm.",
        "description": f"WP4 leaf atlas page {page_id}: procedural leaf clusters, flowers and bark swatches "
                       f"({', '.join(SP.PAGES[page_id])}).",
        "qa": qa,
    })
    ctx.finish()


def _checker(px: int) -> np.ndarray:
    y, x = np.mgrid[0:px, 0:px]
    return np.where(((y // 32) + (x // 32)) % 2 == 0, 0.30, 0.38).astype(F)


def _calibrate_species(page: K.Page, spec: SP.TreeSpec, st: dict, qa: dict) -> None:
    """Scale the species' crown regions so the alpha-weighted mean leaf colour hits TREE_SPECIES.leaf.sharad
    (ASSET_LIST §0.4: average within +-6 %); alternates get the same gain (their own season colours stay relative)."""
    crown = [page.regions[f"{spec.id}.{rs.name}"] for rs in spec.regions if rs.use == "crown"]
    if not crown:
        return
    target = V.hexlin(st["leaf"][V.REF_SEASON])
    s = page.stats([tuple(r["rect"]) for r in crown])
    mean = np.array(s["meanLinear"], np.float64)
    gain = np.clip(target / np.maximum(mean, 1e-5), 0.5, 2.0)
    for r in crown:
        for rect in [r["rect"]] + ([r["alt"]] if r["alt"] else []):
            u0, v0, u1, v1 = rect
            x0, x1 = int(round(u0 * page.px)), int(round(u1 * page.px))
            r0, r1 = int(round((1 - v1) * page.px)), int(round((1 - v0) * page.px))
            page.rgb[r0:r1, x0:x1] *= gain.astype(F)
    after = page.stats([tuple(r["rect"]) for r in crown])
    m = np.array(after["meanLinear"])
    lum = float(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2])
    qa[spec.id] = {"target": st["leaf"][V.REF_SEASON], "mean": tg.linear_to_hex(m), "gain": [round(float(g), 3) for g in gain],
                   "coverage": after["coverage"], "albedoLuminance": round(lum, 4)}
    log(f"atlas QA {spec.id}: target {st['leaf'][V.REF_SEASON]} mean {tg.linear_to_hex(m)} gain {np.round(gain, 3)} "
        f"coverage {after['coverage']:.3f} lum {lum:.3f}")


def atlas_map(script: str, page_id: str, role: str) -> None:
    """`veg_leaves_<p>_normal` / `_orm`: the page's tangent-space normal (vein relief, leaf fold / tilt) or ORM
    (R AO, G roughness, B translucency) as a linear image at half the colour resolution."""
    ctx = _image_ctx(script)
    dep = ctx.dep(f"veg_leaves_{page_id}")
    src = dep.dir / f"{role}.png"
    out = ctx.path(f"{role}.png")
    out.write_bytes(src.read_bytes())
    ctx.add_file("image", out)
    half = {"ultra": 1024, "high": 512, "mobile": 256}
    ctx.meta.update({
        "alpha": False, "colorSpace": "linear", "hdrScale": 1.0, "tierPx": half,
        "usage": (f"Leaf atlas page {page_id} {'tangent-space normal (OpenGL +Y), vein relief + leaf tilt' if role == 'normal' else 'ORM: R spray AO, G roughness, B translucency (x 0.35)'}"
                  f"; same UVs as veg_leaves_{page_id}."),
        "description": f"WP4 leaf atlas page {page_id}: {role} map (half resolution).",
    })
    ctx.finish()


# ================================================================================================ bark sets
BARK_FAMILIES = {
    # family: base colour (brightest member, species tint <= 1), tile (m), look
    "fig": dict(color="#8a8276", tile=1.6, desc="smooth grey fig bark (banyan, peepal): horizontal lenticels, wrinkled collars, lichen"),
    "furrowed": dict(color="#5d5146", tile=1.0, desc="dark deeply fissured bark (neem, mango, sal, babul, palash)"),
    "fibrous": dict(color="#7a6a58", tile=1.0, desc="light grey-brown fibrous strips (teak, amaltas)"),
    "palm": dict(color="#7a6e60", tile=1.2, desc="ringed palm trunk with leaf-base scars (palmyra, date, coconut)"),
}


def bark_set(script: str, family: str) -> None:
    """`veg_bark_<family>`: C-class tiling bark set (albedo 1024, normal / ORM 512; publish tierScale 0.5)."""
    from _bark import bark_maps  # noqa: PLC0415 - heavy numpy, only for bark scripts
    ctx = core.begin(script, kind="material")
    fam = BARK_FAMILIES[family]
    res = ctx.res(1024, 256)
    maps = bark_maps(family, res, fam["tile"], V.hexlin(fam["color"]), ctx.rng)
    pa = tg.write_png(ctx.path(f"{ctx.id}_baseColor.png"), maps["albedo"], 8, srgb_encode=True)
    data_res = max(64, res // 2)
    pn = tg.write_png(ctx.path(f"{ctx.id}_normal.png"), tg.resize(maps["normal"], data_res, data_res), 16)
    po = tg.write_png(ctx.path(f"{ctx.id}_orm.png"), tg.resize(maps["orm"], data_res, data_res), 8)
    ph = tg.write_png(ctx.path(f"{ctx.id}_height.png"), tg.normalize01(maps["height"]), 16)
    ctx.add_file("baseColor", pa, colorSpace="srgb", tierScale=0.5)
    ctx.add_file("normal", pn, colorSpace="linear", tierScale=0.5)
    ctx.add_file("orm", po, colorSpace="linear", tierScale=0.5)
    ctx.add_file("height", ph, colorSpace="linear", ship=False)
    mean = maps["albedo"].reshape(-1, 3).mean(axis=0)
    ctx.meta.update({
        "tileSizeMeters": [fam["tile"], fam["tile"]], "averageColor": tg.linear_to_hex(mean),
        "roughness": round(float(maps["orm"][..., 1].mean()), 3), "metalness": 0.0, "normalScale": 1.0, "trims": [],
        "description": f"WP4 bark set ({family}): {fam['desc']}. C class, {fam['tile']} m tile; species tint via samrajya_tint.",
    })
    if ctx.preview:
        ctx.add_file("preview", _bark_preview(ctx, pa, pn, po, fam["tile"]))
    ctx.finish()


def _bark_preview(ctx: core.AssetContext, pa: Path, pn: Path, po: Path, tile: float) -> Path:
    from lib import materials as MAT  # noqa: PLC0415
    V.limit_threads(2)
    mat = MAT.texture_set_material("bark", pa, pn, po)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.45, depth=3.0, location=(0, 0, 1.5))
    col = bpy.context.active_object
    from lib import mesh as M  # noqa: PLC0415
    M.apply_transform(col)
    bpy.ops.object.shade_smooth()
    M.cylinder_uv(col, (tile, tile), radius=0.45)
    col.data.materials.append(mat)
    render.setup_world(14, 250, 0.35)
    render.add_sun(14, 250, 3.6, color="#ffcf9a")
    render.add_ground(color="#6b5a46")
    render.look_at_camera((1.7, -2.2, 1.6), (0, 0, 1.4), lens=50)
    return render.render(ctx.path("preview.png"), (960, 720), samples=ctx.samples(48, 8), exposure=PREVIEW_EV)


# ================================================================================================ trees
def _deps(ctx: core.AssetContext, spec: SP.TreeSpec) -> tuple[dict, dict[str, Path | None]]:
    page = ctx.dep(f"veg_leaves_{spec.page}")
    regions = json.loads((page.dir / "regions.json").read_text())
    files = {"color": page.dir / "color.png", "normal": page.dir / "normal.png", "orm": page.dir / "orm.png"}
    bark = ctx.cache_dir / spec.bark_set
    for m in ("baseColor", "normal", "orm"):
        p = bark / f"{spec.bark_set}_{m}.png"
        files[f"bark_{m}"] = p if p.exists() else None
    return regions, files


def _materials(spec: SP.TreeSpec, st: dict, files: dict[str, Path | None], tint_bark: str) -> dict[str, bpy.types.Material]:
    bark_region = next((rs for rs in spec.regions if rs.use == "bark"), None)
    leaves = V.leaf_material(f"{spec.id}_leaves", files["color"], files["normal"], files["orm"], fallback=st["leaf"][V.REF_SEASON],
                             atlas=f"veg_leaves_{spec.page}", translucency=LEAF_TRANSLUCENCY, alpha_cut=ALPHA_CUT)
    fam = spec.bark_set.replace("veg_bark_", "")
    tile = BARK_FAMILIES.get(fam, {"tile": 1.0})["tile"]
    bark = V.bark_material(f"{spec.id}_bark", spec.bark_set, files.get("bark_baseColor"), files.get("bark_normal"),
                           files.get("bark_orm"), fallback=st["trunk"]["bark"])
    bark["samrajya_tint"] = tint_bark
    bark["samrajya_uv_scale"] = [round(64.0 / tile, 4), round(64.0 / tile, 4)]
    _uv_scale_nodes(bark, 64.0 / tile)
    stone = V.bark_material(f"{spec.id}_stone", "sandstone_buff", None, None, None, fallback="#c2a985", roughness=0.8)
    stone["samrajya_uv_scale"] = [64.0, 64.0]
    _ = bark_region
    return {"leaves": leaves, "wood": bark, "stone": stone}


def _uv_scale_nodes(mat: bpy.types.Material, scale: float) -> None:
    """Lookdev: apply the runtime uv_scale to the preview graph (UV map -> x scale -> textures)."""
    nt = mat.node_tree
    uv = next((n for n in nt.nodes if n.type == "UVMAP"), None)
    if uv is None:
        return
    targets = [link.to_socket for link in uv.outputs[0].links]  # collect first: relinking invalidates link handles
    mul = nt.nodes.new("ShaderNodeVectorMath")
    mul.operation = "SCALE"
    mul.inputs["Scale"].default_value = scale
    for sock in targets:
        nt.links.new(mul.outputs[0], sock)
    nt.links.new(uv.outputs[0], mul.inputs[0])


def bark_tint(spec: SP.TreeSpec, st: dict) -> str:
    fam = spec.bark_set.replace("veg_bark_", "")
    base = V.hexlin(BARK_FAMILIES.get(fam, {"color": st["trunk"]["bark"]})["color"])
    t = np.clip(V.hexlin(st["trunk"]["bark"]) / np.maximum(base, 1e-4), 0, 1.0)
    return tg.linear_to_hex(t)


def tree_model(script: str, species: str, variant: str, *, levels: tuple[int, ...] = (0, 1, 2), lineup: bool = True) -> None:
    """`tree_<species>` (variant a) / `veg_tree_<species>_<v>`: GLB per LOD (texture-less proxies: bark set, leaf atlas,
    stone), wind vertex data, manifest meta (runtime contract), Cycles critique previews."""
    ctx = core.begin(script, kind="model")
    V.limit_threads(2)
    spec = SP.SPECIES[species]
    st = _style_species(species)
    regions, files = _deps(ctx, spec)
    tris = tuple(int(x) for x in st["tris"])
    tb = T.build_tree(species, variant, st, regions, tris)
    mats = _materials(spec, st, files, bark_tint(spec, st))
    infos = []
    lods_objs = []
    for out_i, lvl in enumerate(levels):
        objs = []
        for key, md in tb.lods[lvl].items():
            o = V.to_object(md, f"{species}_{variant}_lod{lvl}_{key}", mats[key])
            objs.append(o)
        lods_objs.append(objs)
        p = ctx.path(f"{ctx.id}.lod{out_i}.glb")
        info = export.gltf(p, objs, tangents=False, vertex_colors=True, extras={"id": ctx.id, "species": species, "variant": variant})
        ctx.add_file(f"lod{out_i}", p)
        infos.append(info)
        for o in objs:
            o.hide_render = True
            o.hide_set(True)
    bark_region = next((rs for rs in spec.regions if rs.use == "bark"), None)
    region_meta = {k.split(".", 1)[1]: {"rect": v["rect"], "alt": v["alt"], "sizeM": v["sizeM"], "klass": v["klass"], "use": v["use"]}
                   for k, v in regions.items() if v["species"] == species}
    c3 = [float(tb.center[0]), float(tb.center[2]), -float(tb.center[1])]
    a3 = [float(tb.axes[0]), float(tb.axes[2]), float(tb.axes[1])]
    dist = [0.0, T.LOD_FADE[0], T.LOD_FADE[1]][: len(levels)] if levels[0] == 0 else [0.0, T.LOD_FADE[1]][: len(levels)]
    ctx.meta.update({
        "description": f"WP4 {st['label']} ({st['botanical']}), shape variant {variant}: LOD{'/'.join(map(str, levels))} "
                       f"{'/'.join(str(i['triangles']) for i in infos)} tris, leaf atlas veg_leaves_{spec.page}, bark {spec.bark_set}.",
        "bounds": infos[0]["bounds"],
        "lodDistances": dist,
        "triangles": [i["triangles"] for i in infos],
        "minLod": {"ultra": 0, "high": 0, "mobile": 0},
        "meta": {
            "vertexColors": "data",
            "species": species, "variant": variant, "levels": list(levels),
            "atlas": {"color": f"veg_leaves_{spec.page}", "normal": f"veg_leaves_{spec.page}_normal", "orm": f"veg_leaves_{spec.page}_orm"},
            "barkSet": spec.bark_set, "barkTint": bark_tint(spec, st),
            "barkRect": region_meta[bark_region.name]["rect"] if bark_region else None,
            "alphaCut": ALPHA_CUT, "translucency": LEAF_TRANSLUCENCY, "refSeason": V.REF_SEASON, "flutter": spec.flutter,
            "crownCenter": [round(x, 3) for x in c3], "crownAxes": [round(x, 3) for x in a3],
            "regions": region_meta,
            "lodFadeM": list(T.LOD_FADE), "crossFadeM": 6,
            "impostor": f"veg_tree_{species}_impostor",
            "attributes": {"TEXCOORD_0": "atlas uv (wood LOD0: bark set uv / 64)", "TEXCOORD_1": "seasonal alternate atlas uv",
                           "TEXCOORD_2": "x card random r, y class (0 foliage, 0.25 structural, 0.5 seasonal, 0.75 bare twig, 1 wood)",
                           "COLOR_0": "R hierarchy, G phase, B flutter, A AO (data, not colour)"},
            "seasonRule": SEASON_RULE,
            "build": tb.info,
        },
    })
    if ctx.preview:
        previews(ctx, tb, lods_objs, mats, st, lineup=lineup and variant == "a")
    ctx.finish()


# ---------------------------------------------------------------------------------------------------- previews
def _show(objs: list[bpy.types.Object], on: bool) -> None:
    for o in objs:
        o.hide_render = not on
        o.hide_set(not on)


def previews(ctx: core.AssetContext, tb: T.TreeBuild, lods_objs: list[list[bpy.types.Object]], mats: dict, st: dict,
             lineup: bool = True) -> None:
    """Critique sheet (Bible §7, ticket W14): rows front-lit / back-lit (sun 14 deg, contre-jour), columns hero
    (under the crown, looking up), 30 m and 220 m (game framing, 3x crop), plus the LOD0/1/2 strip at 30 m."""
    scn = bpy.context.scene
    H = tb.height
    lo0 = lods_objs[0]
    _show(lo0, True)
    ground = render.add_ground(size=2000, color="#7a6550")
    render.setup_world(30, 200, 0.35)
    sun = render.add_sun(30, 200, 4.0)
    shots = []
    res = (480, 360)
    spp = ctx.samples(28, 6)
    for lit, (sel, saz) in (("front", (34, 200)), ("back", (14, 20))):
        render.setup_world(sel, saz, 0.35)
        d = render._dir(sel, saz)
        sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        sun.data.energy = 4.0 if lit == "front" else 3.4
        row = []
        # hero: 5.5 m from the trunk, eye 1.7 m, looking up into the crown (towards the sun for back-lit)
        az = math.radians(200 if lit == "front" else 20)
        cam_pos = (math.sin(az) * 5.5, math.cos(az) * 5.5, 1.7)
        render.look_at_camera(cam_pos, (0, 0, min(H * 0.55, 9.0)), lens=24)
        row.append(render.render(ctx.path(f"_h_{lit}.png"), res, samples=spp, exposure=PREVIEW_EV))
        # 30 m
        render.look_at_camera((math.sin(az) * 30, math.cos(az) * 30, 2.0), (0, 0, H * 0.48), lens=35)
        row.append(render.render(ctx.path(f"_m_{lit}.png"), res, samples=spp, exposure=PREVIEW_EV))
        # 220 m: tactical 46 deg pitch would show the crown top; use 15 deg so the silhouette reads, long lens crop 3x
        el = math.radians(15)
        dist = 220.0
        render.look_at_camera((math.sin(az) * dist * math.cos(el), math.cos(az) * dist * math.cos(el), dist * math.sin(el)),
                              (0, 0, H * 0.45), lens=36 * 3)
        row.append(render.render(ctx.path(f"_f_{lit}.png"), res, samples=spp, exposure=PREVIEW_EV))
        shots.append(row)
    sheet = _compose([[_load(p) for p in row] for row in shots])
    ctx.add_file("preview", tg.write_png(ctx.path("preview.png"), sheet, 8))
    # LOD strip at 30 m (front-lit)
    render.setup_world(34, 200, 0.35)
    d = render._dir(34, 200)
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    strip = []
    for objs in lods_objs:
        for other in lods_objs:
            _show(other, False)
        _show(objs, True)
        az = math.radians(200)
        render.look_at_camera((math.sin(az) * 30, math.cos(az) * 30, 2.0), (0, 0, H * 0.48), lens=35)
        strip.append(_load(render.render(ctx.path("_lod.png"), res, samples=spp, exposure=PREVIEW_EV)))
    ctx.add_file("preview_lods", tg.write_png(ctx.path("preview_lods.png"), _compose([strip]), 8))
    for objs in lods_objs:
        _show(objs, False)
    _ = (ground, mats, st, lineup, scn)
    for p in ctx.out_dir.glob("_*.png"):
        p.unlink()


def _load(p: Path) -> np.ndarray:
    im = bpy.data.images.load(str(p))
    a = tg.image_to_numpy(im)[..., :3]
    bpy.data.images.remove(im)
    return a


def _compose(rows: list[list[np.ndarray]], gap: int = 4) -> np.ndarray:
    h = max(i.shape[0] for r in rows for i in r)
    w = max(i.shape[1] for r in rows for i in r)
    ncol = max(len(r) for r in rows)
    out = np.full((len(rows) * (h + gap) - gap, ncol * (w + gap) - gap, 3), 0.08, F)
    for ri, r in enumerate(rows):
        for ci, im in enumerate(r):
            out[ri * (h + gap):ri * (h + gap) + im.shape[0], ci * (w + gap):ci * (w + gap) + im.shape[1]] = im
    return out


# ================================================================================================ impostors
def tree_impostor(script: str, species: str, variant: str = "a", *, source_lod: int = 0, frame_px: int = 256,
                  normal_scale: float = 0.25) -> None:
    """`veg_tree_<species>_impostor`: hemi-octahedral 8 x 8 capture (lib/impostor render_views) of the variant's
    LOD`source_lod` with the leaf atlas (alpha cut 0.5), vertex AO in the albedo and bent normals, PREFILTERED for the
    distance it is shown at (>= 220 m, ~1 frame px per screen px at 1080p): coverage is closed (holes < 2 px filled,
    specks removed) and re-thresholded with a 1 px anti-aliased edge, albedo is alpha-weighted box filtered (5 x 5) -
    leaf-level detail is sub-pixel there, and this cuts the encoded atlas ~2-3x. Normal + depth at `normal_scale`."""
    ctx = IMP.begin(script)
    V.limit_threads(2)
    spec = SP.SPECIES[species]
    st = _style_species(species)
    regions, files = _deps(ctx, spec)
    tris = tuple(int(x) for x in st["tris"])
    tb = T.build_tree(species, variant, st, regions, tris)
    mats = _materials(spec, st, files, bark_tint(spec, st))
    objs = [V.to_object(md, f"{species}_{key}", mats[key]) for key, md in tb.lods[source_lod].items()]
    for m in mats.values():  # crown-scale normals only: per-leaf normal-map detail is noise at >= 220 m
        _drop_normal_map(m)
    grid = 8
    px = ctx.res(frame_px, max(32, frame_px // 4))
    center, radius = IMP.bounding_sphere(objs)
    dirs = [IMP.hemi_octa_decode(i / (grid - 1), j / (grid - 1)) for j in range(grid) for i in range(grid)]
    with timer(f"impostor capture {grid}x{grid} @ {px}px"):
        alb, nrm = IMP.render_views(objs, dirs, px, center, radius, samples=ctx.samples(12, 4))
    alb = [prefilter_albedo(a) for a in alb]
    nrm = [prefilter_normal(n, a[..., 3]) for n, a in zip(nrm, alb)]
    A = IMP.pack(alb, grid, grid)
    N = IMP.pack(nrm, grid, grid)
    # transparent texels: smooth push-pull extension + alpha / depth floor (the publisher's streaky bleed never runs)
    cov = A[..., 3]
    A = np.concatenate([V.push_pull_fill(A[..., :3], cov), np.maximum(cov, V.ALPHA_FLOOR)[..., None]], axis=-1)
    nf = V.push_pull_fill(N, (cov > 0.02).astype(F))
    N = np.concatenate([nf[..., :3], np.maximum(nf[..., 3:4], V.ALPHA_FLOOR)], axis=-1).astype(F)
    ctx.add_file("albedo", tg.write_png(ctx.path("albedo.png"), A, 8))
    ctx.add_file("normal", tg.write_png(ctx.path("normal.png"), N, 8))
    if ctx.preview:
        ctx.add_file("preview", IMP._preview_sheet(A, N, ctx.path("preview.png")))
    sw = T.LOD_FADE[2]
    src = ("tree_" + species) if variant == "a" else f"veg_tree_{species}_{variant}"
    ctx.meta.update({
        "layout": "hemi-octahedral", "grid": grid, "radius": round(radius, 4), "center": [round(float(x), 4) for x in center],
        "switchDistance": sw, "depthRange": round(2 * radius, 4), "source": src,
        "framePx": {"ultra": frame_px, "high": int(frame_px * 0.75), "mobile": frame_px // 2}, "aoBaked": 0.0,
        "normalScale": normal_scale,
        "description": (f"WP4 {st['label']} impostor (variant {variant}, captured from LOD{source_lod}): hemi-octahedral 8 x 8, "
                        f"{frame_px} / {int(frame_px * 0.75)} / {frame_px // 2} px frames (normal + depth x{normal_scale}); "
                        f"prefiltered for >= {sw:.0f} m."),
    })
    log(f"impostor {species}/{variant}: radius {radius:.2f} m, centre {np.round(center, 2).tolist()}")
    ctx.finish()


def _drop_normal_map(mat: bpy.types.Material) -> None:
    nt = mat.node_tree
    for n in nt.nodes:
        if n.type == "BSDF_PRINCIPLED" and n.inputs["Normal"].links:
            nt.links.remove(n.inputs["Normal"].links[0])


def _morph(m: np.ndarray, k: int, fn) -> np.ndarray:
    out = m.copy()
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            if dx * dx + dy * dy > k * k + k:
                continue
            out = fn(out, np.roll(np.roll(m, dy, 0), dx, 1))
    return out


def _box(x: np.ndarray, k: int) -> np.ndarray:
    return K._box_blur(x, k) if x.ndim == 2 else np.stack([K._box_blur(x[..., c], k) for c in range(x.shape[-1])], axis=-1)


def prefilter_albedo(a: np.ndarray, close_px: int = 3) -> np.ndarray:
    """One impostor frame (rgb sRGB-encoded + coverage): closed binary coverage with a 1 px AA edge, alpha-weighted
    5 x 5 colour filter (frames are bordered by empty space, so np.roll wrap-around is harmless)."""
    cov = (a[..., 3] > 0.5).astype(F)
    cov = _morph(_morph(cov, close_px, np.maximum), close_px, np.minimum)     # close holes
    cov = _morph(_morph(cov, 1, np.minimum), 1, np.maximum)                   # remove specks
    soft = np.clip(_box(cov, 1) * 1.15 - 0.075, 0, 1)
    w = a[..., 3:4]
    rgb = _box(a[..., :3] * w, 2) / np.maximum(_box(w, 2), 1e-4)
    # where the closing added coverage, colour from a wider neighbourhood
    rgb2 = _box(a[..., :3] * w, 4) / np.maximum(_box(w, 4), 1e-4)
    rgb = np.where(w > 0.02, rgb, rgb2)
    return np.concatenate([np.clip(rgb, 0, 1), soft[..., None]], axis=-1).astype(F)


def prefilter_normal(n: np.ndarray, cov: np.ndarray) -> np.ndarray:
    """Normal + depth frame: alpha-weighted 3 x 3 smoothing of the encoded normal and depth (inside the coverage)."""
    w = (n[..., 3:4] > 0).astype(F)
    w1, w4 = _box(w, 1), _box(w, 4)
    w2 = _box(w, 2)
    nn = np.where(w2 > 1e-3, _box(n[..., :3] * w, 2) / np.maximum(w2, 1e-4), _box(n[..., :3] * w, 4) / np.maximum(w4, 1e-4))
    d = np.where(w2 > 1e-3, _box(n[..., 3:4] * w, 3) / np.maximum(_box(w, 3), 1e-4), _box(n[..., 3:4] * w, 4) / np.maximum(w4, 1e-4))
    m = (cov[..., None] > 0.02) & (w4 > 1e-3)
    nn = np.where(m, nn, 0.5)
    d = np.where(m, d, 0.0)
    return np.concatenate([np.clip(nn, 0, 1), np.clip(d, 0, 1)], axis=-1).astype(F)


__all__ = ["atlas_map", "atlas_page", "bark_set", "tree_impostor", "tree_model"]
