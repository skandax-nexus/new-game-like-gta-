"""
Self-test of the tools/blender/lib helpers (run after changing the library or upgrading Blender):

    /root/.venvs/blender/bin/python tools/blender/selftest.py          (or: npm run assets -- --selftest)

Builds a tiny skinned mannequin with standard clips, exports it, re-reads the GLB and checks skins,
animations, UV sets, tangents and binding extras; checks decimation, a high->low normal bake and a
procedural texture-set bake. TA-07 cases: VAT bake (reconstruction error, texture layout, GLB vertex order,
octahedral normals, stride), impostor capture (hemi-octahedral math, coverage, normals, depth), flipbook
volumes (curl-noise divergence, Cycles volume render, loop blend, normals from density, packing), the Eulerian
solver (projection, buoyancy, free-slip floor), the exact integrator against Cycles, the flipbook border guard
(frames touching their border fail the bake unless the sequence opens that edge) and, rework round 2, lit-medium
normals (alpha-faded tilt, the min_normal_z guard) and gradient-mapped books (ramp fit / authored ramp, dithered
encode, R = G = B, ramp rules).
Writes to .asset-cache/_selftest/. Exit code 1 on failure.
OWNER: Technical Art Director (TA-07 adds the vat / impostor / flipbook cases).
"""
from __future__ import annotations

import json
import math
import struct
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import anim, bake, core, export, flipbook, impostor, lod, materials, mesh as M, nodes, rig, texgen as tg, vat  # noqa: E402

OUT = core.REPO_ROOT / ".asset-cache" / "_selftest"
OUT.mkdir(parents=True, exist_ok=True)
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    core.log(("PASS " if ok else "FAIL ") + name + (f" - {detail}" if detail else ""))


def read_glb_json(path: Path) -> dict:
    data = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    clen, ctype = struct.unpack_from("<II", data, 12)
    assert ctype == 0x4E4F534A
    return json.loads(data[20:20 + clen])


def test_skinned_export() -> None:
    core.reset_scene()
    bones = rig.humanoid(1.75)
    arm = rig.create_armature("mannequin_rig", bones)
    parts = []
    for b in bones:
        if not b.deform:
            continue
        h, t = np.array(b.head), np.array(b.tail)
        L = float(np.linalg.norm(t - h))
        r = 0.11 if b.name in ("hips", "spine", "chest") else 0.075 if "head" in b.name else 0.05
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=r, depth=max(L, 0.02), location=tuple((h + t) / 2))
        o = bpy.context.active_object
        d = (t - h) / max(L, 1e-6)
        o.rotation_mode = "QUATERNION"
        from mathutils import Vector
        o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(tuple(d)))
        M.apply_transform(o)
        parts.append(o)
    body = M.join(parts, "mannequin")
    M.shade_smooth(body, 50)
    M.box_uv(body, 1.0)
    M.lightmap_uv(body)
    mat = export.runtime_material("mannequin_skin", set_id="selftest_set", tint="#c08060", macro="mannequin:macro",
                                  fallback_color="#a07050")
    body.data.materials.append(mat)
    rig.skin_proximity(body, arm, blend=0.05)
    check("skin: vertex groups", len(body.vertex_groups) >= 15, f"{len(body.vertex_groups)} groups")

    def walk(ph: float) -> dict:
        s = math.sin(ph * 2 * math.pi)
        return {"thigh.L": {"rot": (25 * s, 0, 0)}, "thigh.R": {"rot": (-25 * s, 0, 0)},
                "upper_arm.L": {"rot": (0, -20 * s, 0)}, "upper_arm.R": {"rot": (0, -20 * s, 0)},
                "hips": {"loc": (0, 0, 0.02 * abs(s))}}

    anim.cycle(arm, "walk", 32, walk, samples=8)
    anim.cycle(arm, "idle", 60, lambda ph: {"chest": {"rot": (2 * math.sin(ph * 2 * math.pi), 0, 0)}}, samples=4)
    clip = anim.new_clip(arm, "attack", 24)
    anim.key(clip, arm, 1, "upper_arm.R", rot=(0, 0, 0))
    anim.key(clip, arm, 10, "upper_arm.R", rot=(-80, 0, 0))
    anim.key(clip, arm, 24, "upper_arm.R", rot=(0, 0, 0))
    anim.finish(clip, arm)
    try:
        anim.new_clip(arm, "wiggle", 10)
        check("anim: rejects non-standard names", False)
    except ValueError:
        check("anim: rejects non-standard names", True)
    check("anim: clips stashed", anim.clips_of(arm) == ["attack", "idle", "walk"], str(anim.clips_of(arm)))
    anim.rest(arm)
    info = export.gltf(OUT / "mannequin.glb", [body, arm], animations=True, extras={"id": "mannequin"})
    j = read_glb_json(OUT / "mannequin.glb")
    names = sorted(a["name"] for a in j.get("animations", []))
    check("export: animations", names == ["attack", "idle", "walk"], str(names))
    check("export: skin", len(j.get("skins", [])) == 1 and len(j["skins"][0]["joints"]) >= 15)
    prim = j["meshes"][0]["primitives"][0]["attributes"]
    check("export: TEXCOORD_0 + TEXCOORD_1", "TEXCOORD_0" in prim and "TEXCOORD_1" in prim, str(sorted(prim)))
    check("export: TANGENT", "TANGENT" in prim)
    check("export: JOINTS/WEIGHTS", "JOINTS_0" in prim and "WEIGHTS_0" in prim)
    ex = j["materials"][0].get("extras", {})
    check("export: binding extras", ex.get("samrajya_set") == "selftest_set" and ex.get("samrajya_macro") == "mannequin:macro", str(ex))
    check("export: no images", not j.get("images"))
    check("export: scene extras", j["scenes"][0].get("extras", {}).get("samrajya_id") == "mannequin", str(j["scenes"][0].get("extras")))
    b = info["bounds"]
    check("export: +Y up bounds", abs(b["max"][1] - 1.75) < 0.12 and b["min"][1] > -0.1, str(b))


def test_lod() -> None:
    core.reset_scene()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1)
    s = bpy.context.active_object
    M.smart_uv(s)
    base = M.triangle_count(s)
    lods = lod.make_lods(s, (1.0, 0.5, 0.2), "sphere")
    counts = [M.triangle_count(o) for o in lods]
    check("lod: decimate ratios", counts[1] < base * 0.6 and counts[2] < base * 0.25, f"{base} -> {counts}")
    check("lod: names", [o.name for o in lods] == ["sphere_lod0", "sphere_lod1", "sphere_lod2"])


def test_normal_bake() -> None:
    core.reset_scene()
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    high = bpy.context.active_object
    high.name = "high"
    M.bevel(high, width=0.12, segments=4, angle_deg=30)
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    low = bpy.context.active_object
    low.name = "low"
    M.smart_uv(low, margin=0.02)
    bake.configure(samples=1, margin=4)
    img = bake.new_image("nrm", 128, 128)
    arr = bake.bake(low, "NORMAL", img, selected=[high], cage_extrusion=0.1, max_ray_distance=0.3)
    n = tg.decode_normal(arr[..., :3])
    tilt = float(np.mean(n[..., 2] < 0.98))
    tg.write_png(OUT / "bevel_normal.png", tg.encode_normal(n), 8)
    check("bake: high->low normals carry the bevel", 0.05 < tilt < 0.9, f"tilted fraction {tilt:.2f}")


def test_texture_set_bake() -> None:
    core.reset_scene()
    bpy.ops.mesh.primitive_plane_add(size=2.0)
    p = bpy.context.active_object
    mat = bpy.data.materials.new("proc")
    nb = nodes.NodeBuilder(mat)
    vec, w = nb.torus4d(nb.uv(), scale=6)
    nz = nb.noise(vec, w=w, detail=5)
    col = nb.ramp(nz.outputs["Fac"], [(0.3, "#5a2a20"), (0.7, "#c08a6a")])
    nb.principled(base_color=col, roughness=nb.map_range(nz.outputs["Fac"], 0, 1, 0.5, 0.95))
    materials.assign(p, mat)
    out = bake.bake_texture_set(p, 128, maps=("baseColor", "roughness", "metallic", "ao"), ao_samples=8)
    ok = out["baseColor"].shape == (128, 128, 3) and float(out["baseColor"].std()) > 0.01 and "orm" in out
    tile = out["baseColor"]
    seam = float(np.abs(tile[:, 0] - tile[:, -1]).mean())
    tg.write_png(OUT / "procedural_baseColor.png", tile, 8, srgb_encode=True)
    check("bake: procedural texture set", ok, f"std {float(out['baseColor'].std()):.3f}")
    check("bake: torus4d mapping tiles seamlessly", seam < 0.03, f"edge delta {seam:.4f}")


def _two_bone_tube() -> tuple:
    """A vertical tube skinned to a 2-bone chain with a looping bend clip and a one-shot."""
    import os
    bones = [rig.BoneSpec("root", (0, 0, 0), (0, 0.2, 0), None, deform=False),
             rig.BoneSpec("hips", (0, 0, 0), (0, 0, 0.6), "root"),
             rig.BoneSpec("spine", (0, 0, 0.6), (0, 0, 1.2), "hips", connect=True)]
    arm = rig.create_armature("tube_rig", bones)
    sides, rings = 12, 8
    verts = [(0.1 * math.cos(2 * math.pi * i / sides), 0.1 * math.sin(2 * math.pi * i / sides), 1.2 * k / (rings - 1))
             for k in range(rings) for i in range(sides)]
    faces = [(k * sides + i, k * sides + (i + 1) % sides, (k + 1) * sides + (i + 1) % sides, (k + 1) * sides + i)
             for k in range(rings - 1) for i in range(sides)]
    tube = M.from_pydata("tube_lod0", verts, faces)
    M.triangulate(tube)
    rig.skin_proximity(tube, arm, blend=0.25)
    anim.cycle(arm, "walk", 16, lambda ph: {"spine": {"rot": (40 * math.sin(ph * 2 * math.pi), 0, 0)},
                                           "hips": {"rot": (0, 0, 10 * math.sin(ph * 2 * math.pi))}}, samples=8)
    clip = anim.new_clip(arm, "attack", 12)
    anim.key(clip, arm, 1, "spine", rot=(0, 0, 0))
    anim.key(clip, arm, 12, "spine", rot=(-70, 0, 0))
    anim.finish(clip, arm)
    del os
    return arm, tube


def test_vat() -> None:
    import os
    os.environ["SAMRAJYA_ASSET_OUT"] = str(OUT / "vat")
    os.environ["SAMRAJYA_ASSET_ID"] = "selftest_vat"
    try:
        ctx = vat.begin(__file__)
    finally:
        del os.environ["SAMRAJYA_ASSET_OUT"]
        del os.environ["SAMRAJYA_ASSET_ID"]
    arm, tube = _two_bone_tube()
    n = len(tube.data.vertices)
    vat.set_vertex_colors(tube, team=np.linspace(0, 1, n), cloth=0.5, part=3)
    lod1 = vat.decimate_lod(tube, arm, 0.5, "tube_lod1")
    meta = vat.bake(ctx, arm, [tube, lod1], fps=15, rest=None, parts=["a", "b", "c", "d"])
    l0 = meta["lods"][0]
    check("vat: reconstruction error <= 1 mm", l0["errorMm"] <= 1.0 and meta["lods"][1]["errorMm"] <= 1.0,
          f"{l0['errorMm']} / {meta['lods'][1]['errorMm']} mm")
    clips = {c["name"]: c for c in meta["clips"]}
    check("vat: clip table (loop excludes the end frame, one-shot includes it)",
          clips["walk"]["frames"] == 8 and clips["attack"]["frames"] == 7 and clips["attack"]["startFrame"] == 0
          and clips["walk"]["startFrame"] == 7 and meta["frames"] == 15, str(meta["clips"]))
    pos = np.frombuffer((ctx.out_dir / "selftest_vat.lod0.pos.bin").read_bytes(), "<f2").reshape(l0["height"], l0["width"], 3)
    nrm = np.frombuffer((ctx.out_dir / "selftest_vat.lod0.nrm.bin").read_bytes(), np.uint8).reshape(l0["height"], l0["width"], 2)
    check("vat: texture layout", pos.shape == (15 * l0["rowsPerFrame"], l0["width"], 3) and l0["width"] <= 4096)
    j = read_glb_json(ctx.out_dir / "selftest_vat.lod0.glb")
    prim = j["meshes"][0]["primitives"][0]
    nv = j["accessors"][prim["attributes"]["POSITION"]]["count"]
    check("vat: GLB vertex count == VAT columns", nv == l0["vertices"] and "COLOR_0" in prim["attributes"], f"{nv} vs {l0['vertices']}")
    # Reconstruct attack frame 6 (last) of LOD0 from the files and compare with Blender's evaluation.
    data = (ctx.out_dir / "selftest_vat.lod0.glb").read_bytes()
    clen = struct.unpack_from("<I", data, 12)[0]
    bin_off = 20 + clen + 8
    acc = j["accessors"][prim["attributes"]["POSITION"]]
    bv = j["bufferViews"][acc["bufferView"]]
    rest = np.frombuffer(data, "<f4", count=nv * 3, offset=bin_off + bv["byteOffset"]).reshape(nv, 3)
    w = l0["width"]
    rows = l0["rowsPerFrame"]
    f = clips["attack"]["startFrame"] + 6
    idx = np.arange(nv)
    off = pos[f * rows + idx // w, idx % w].astype(np.float64)
    acts = {name: a for name, a, _, _ in vat.clip_actions(arm)}
    vat._use_action(arm, acts["attack"])
    vat._set_time(1 + 6 * 2)
    co, _ = vat._evaluate(tube)
    tbl = vat._export_table(tube)
    exact = vat.to_three(co[tbl["vertex"]]).astype(np.float64)
    err = float(np.abs(rest + off - exact).max()) * 1000
    check("vat: decoded files reproduce the deformed mesh", err < 1.0, f"{err:.3f} mm")
    e = np.random.default_rng(1).normal(size=(2000, 3))
    e /= np.linalg.norm(e, axis=1, keepdims=True)
    dec = vat.octa_decode(np.round(vat.octa_encode(e) * 255) / 255)
    ang = float(np.degrees(np.arccos(np.clip((dec * e).sum(axis=1), -1, 1))).max())
    check("vat: octahedral RG8 normals < 1.5 deg", ang < 1.5, f"{ang:.2f} deg")
    del nrm
    vat._use_action(arm, None)


def test_impostor() -> None:
    import os
    for u, v in ((0.0, 0.0), (0.3, 0.8), (1.0, 0.5), (0.5, 0.5)):
        d = impostor.hemi_octa_decode(u, v)
        uu, vv = impostor.hemi_octa_encode(d)
        assert abs(uu - u) < 1e-6 and abs(vv - v) < 1e-6, (u, v, uu, vv)
    check("impostor: hemi-octahedral encode(decode(uv)) == uv", True)
    core.reset_scene()
    os.environ["SAMRAJYA_ASSET_OUT"] = str(OUT / "impostor")
    os.environ["SAMRAJYA_ASSET_ID"] = "selftest_impostor"
    try:
        ctx = impostor.begin(__file__)
    finally:
        del os.environ["SAMRAJYA_ASSET_OUT"]
        del os.environ["SAMRAJYA_ASSET_ID"]
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
    cube = bpy.context.active_object
    mat = export.runtime_material("imp_red", fallback_color="#c04020")
    cube.data.materials.append(mat)
    meta = impostor.capture(ctx, [cube], grid=4, frame_px=32, samples=4)
    A = tg.image_to_numpy(bpy.data.images.load(str(ctx.path("albedo.png"))))
    N = tg.image_to_numpy(bpy.data.images.load(str(ctx.path("normal.png"))))
    check("impostor: atlas size", A.shape[:2] == (128, 128) and N.shape[:2] == (128, 128), str(A.shape))
    cover = float(A[..., 3].mean())
    check("impostor: coverage", 0.1 < cover < 0.9, f"{cover:.2f}")
    # frame (col 1, row 1) of a 4x4 grid looks from high above: the top face (+Y) dominates its normals.
    fr = N[32:64, 32:64]
    a = A[32:64, 32:64, 3] > 0.5
    ny = float((fr[..., 1][a] * 2 - 1).mean())
    check("impostor: object-space normals (top face +Y seen from above)", ny > 0.45, f"mean n.y {ny:.2f}")
    alb = A[..., :3][A[..., 3] > 0.9].mean(axis=0)
    check("impostor: albedo is the base color (no lighting)", abs(alb[0] - 0.753) < 0.05 and abs(alb[2] - 0.125) < 0.05,
          str(np.round(alb, 3)))
    check("impostor: radius / switch distance", meta["radius"] > 0.8 and meta["switchDistance"] > 0, str(meta["radius"]))


def test_flipbook() -> None:
    import os
    curl = flipbook.CurlNoise(3)
    p = np.random.default_rng(2).uniform(-1, 1, (64, 3)).astype(np.float32)
    h = 1e-3
    div = np.zeros(64)
    for ax in range(3):
        dp = np.zeros(3, np.float32)
        dp[ax] = h
        div += (curl.velocity(p + dp, 0.3)[:, ax] - curl.velocity(p - dp, 0.3)[:, ax]) / (2 * h)
    mag = float(np.abs(curl.velocity(p, 0.3)).mean())
    check("flipbook: curl noise is divergence-free", float(np.abs(div).max()) < 0.02 * max(mag, 1e-3) * 50,
          f"max |div| {np.abs(div).max():.4f}, mean |v| {mag:.3f}")
    core.reset_scene()
    os.environ["SAMRAJYA_ASSET_OUT"] = str(OUT / "flipbook")
    os.environ["SAMRAJYA_ASSET_ID"] = "selftest_flipbook"
    try:
        ctx = flipbook.begin(__file__)
    finally:
        del os.environ["SAMRAJYA_ASSET_OUT"]
        del os.environ["SAMRAJYA_ASSET_ID"]
    sim = flipbook.ParticleVolume(24, (2, 2, 2), 5)
    rng = np.random.default_rng(5)
    # centred in the 2 m box (the border guard rejects a puff cut by the frame edge)
    sim.emit(rng.normal(0, 0.15, (400, 3)) + [0, 0, 1.0], rng.normal(0, 0.2, (400, 3)), np.full(400, 2.0), np.ones(400))
    frames = []
    for _ in range(3):
        sim.step(0.1)
        d, _ = sim.fields()
        s = d * (3.0 / max(float(d.sum(axis=1).max()) * (2 / 23), 1e-6))
        frames.append((s, flipbook.light_volume(s, 2 / 23, (0.6, 0.6, 0.6))))
    rgba = flipbook.render_volumes(frames, (2, 2, 2), 32, samples=4)
    a = [float(f[..., 3].max()) for f in rgba]
    check("flipbook: Cycles renders the numpy volume (alpha)", min(a) > 0.3, str(np.round(a, 2)))
    # every frame must render its own volume (regression: persistent render data kept the first atlas)
    s0, r0 = frames[0]
    moved = flipbook.render_volumes([(s0, r0), (np.roll(s0, 6, axis=0), np.roll(r0, 6, axis=0))], (2, 2, 2), 32, samples=4)
    cx = []
    for f in moved:
        w = f[..., 3]
        cx.append(float((w * np.arange(w.shape[1])[None, :]).sum() / max(float(w.sum()), 1e-6)))
    check("flipbook: each frame renders its own volume", abs(cx[1] - cx[0]) > 2.0, f"alpha centroid x {cx[0]:.1f} -> {cx[1]:.1f} px")
    straight = [flipbook.to_straight(f) for f in rgba]
    nrm = [flipbook.normal_from_alpha(f[..., 3]) for f in straight]
    check("flipbook: normals from density are unit vectors", all(abs(float(np.linalg.norm(n * 2 - 1, axis=-1).mean()) - 1) < 0.02 for n in nrm))
    seq = [np.full((4, 4, 4), float(i), np.float32) for i in range(12)]
    lp = flipbook.loop_blend(seq, 8, 4)
    check("flipbook: loop blend is continuous across the wrap", abs(float(lp[0][0, 0, 0]) - 8.0) < 1e-4
          and abs(float(lp[7][0, 0, 0]) - 7.0) < 1e-4 and len(lp) == 8, str([float(x[0, 0, 0]) for x in lp]))
    meta = flipbook.write(ctx, straight, 2, 2, normals=nrm, fps=12, loop=False, lit=True)
    check("flipbook: atlas files + metadata", ctx.path("color.png").exists() and ctx.path("normal.png").exists()
          and meta["cols"] == 2 and meta["frames"] == 3)


def test_fluid_and_integrator() -> None:
    """FluidSim (projection, buoyancy, floor) and the exact emission-absorption integrator vs Cycles."""
    sim = flipbook.FluidSim((24, 24, 24), (1.2, 1.2, 1.2), floor=False, vorticity=0.0)
    # a smooth PERIODIC random field (low Fourier modes) - the solver's domain is periodic in x / y / z here
    rng = np.random.default_rng(4)
    xs, ys, zs = sim.world()
    L = 1.2
    for a in range(3):
        f = np.zeros(sim.n, np.float32)
        for _ in range(6):
            k = rng.integers(-2, 3, 3)
            f += rng.normal() * np.sin(2 * np.pi * (k[0] * xs + k[1] * ys + k[2] * zs) / L + rng.uniform(0, 6.28)).astype(np.float32)
        sim.vel[a] = f
    h = sim.h

    def div_ratio(v: np.ndarray) -> float:
        """Spectral divergence norm relative to the gradient norm: |k . U| / (|k| |U|) (exact derivatives)."""
        kx = (2 * np.pi * np.fft.fftfreq(v.shape[1], d=h))[:, None, None]
        ky = (2 * np.pi * np.fft.fftfreq(v.shape[2], d=h))[None, :, None]
        kz = (2 * np.pi * np.fft.fftfreq(v.shape[3], d=h))[None, None, :]
        U, V, W = (np.fft.fftn(v[i]) for i in range(3))
        dv = np.abs(kx * U + ky * V + kz * W)
        km = np.sqrt(kx ** 2 + ky ** 2 + kz ** 2) * np.sqrt(np.abs(U) ** 2 + np.abs(V) ** 2 + np.abs(W) ** 2)
        return float(np.sqrt((dv ** 2).sum()) / max(float(np.sqrt((km ** 2).sum())), 1e-9))

    before = div_ratio(sim.vel)
    sim.project()
    after = div_ratio(sim.vel)
    check("fluid: pressure projection removes the divergence", after < 1e-3 * before, f"|k.U| / (|k| |U|) {before:.3f} -> {after:.2e}")
    # a hot blob rises (buoyancy) and expands with a prescribed divergence
    sim = flipbook.FluidSim((24, 24, 32), (1.2, 1.2, 1.6), floor=True, vorticity=2.0)
    x, y, z = sim.world()
    blob = np.clip((0.22 - np.sqrt(x ** 2 + y ** 2 + (z - 0.35) ** 2)) / 0.06, 0, 1).astype(np.float32)
    sim.dens = blob.copy()
    sim.temp = blob.copy()
    cz0 = float((sim.dens * z).sum() / sim.dens.sum())
    for _ in range(6):
        sim.step(0.05, buoyancy=3.0, expansion=1.0, substeps=2)
    cz1 = float((sim.dens * z).sum() / max(float(sim.dens.sum()), 1e-9))
    check("fluid: buoyant hot blob rises", cz1 > cz0 + 0.05, f"density centroid z {cz0:.3f} -> {cz1:.3f} m")
    # free-slip floor: no flow through z = 0 after projection (mirror-symmetric pressure)
    sim2 = flipbook.FluidSim((16, 16, 16), (1.0, 1.0, 1.0), floor=True, vorticity=0.0)
    sim2.vel[2][:] = -1.0
    sim2.project()
    check("fluid: free-slip floor stops flow into the ground", float(np.abs(sim2.vel[2][:, :, 0]).mean()) < 0.2,
          f"mean |w| in the first cell {float(np.abs(sim2.vel[2][:, :, 0]).mean()):.3f} (was 1.0)")
    # exact integration of a uniform sphere vs Cycles (64 samples) on the same vertex grid
    n = 32
    g = (np.arange(n) / (n - 1) * 2 - 1).astype(np.float32)
    X, Y, Z = np.meshgrid(g, g, g, indexing="ij")
    sig = (np.sqrt(X ** 2 + Y ** 2 + Z ** 2) < 0.6).astype(np.float32) * 2.0
    rad = np.zeros(sig.shape + (3,), np.float32) + np.array([0.8, 0.5, 0.2], np.float32)
    core.reset_scene()
    cyc = flipbook.render_volumes([(sig, rad)], (2.0, 2.0, 2.0), 32, samples=64)[0]
    ex, _ = flipbook.integrate_volume(sig, rad, (2.0, 2.0, 2.0), 32, view="front", centered=False)
    da = float(np.abs(cyc[..., 3] - ex[..., 3]).mean())
    dc = float(np.abs(cyc[..., :3] - ex[..., :3]).mean())
    check("integrator: exact emission-absorption matches Cycles (uniform sphere)", da < 0.03 and dc < 0.03,
          f"mean |alpha diff| {da:.4f}, mean |rgb diff| {dc:.4f}; centre alpha cycles {float(cyc[16, 16, 3]):.3f} exact {float(ex[16, 16, 3]):.3f}")
    nrm = flipbook.density_normals(sig, 1.0)
    _, tn = flipbook.integrate_volume(sig, rad, (2.0, 2.0, 2.0), 32, view="front", centered=False, normals=nrm)
    right = tn[16, 24] * 2 - 1
    top = tn[8, 16] * 2 - 1
    check("integrator: density-gradient normals point outward (right edge +x, top +y)", right[0] > 0.3 and top[1] > 0.3,
          f"right {np.round(right, 2)}, top {np.round(top, 2)}")


def test_flipbook_border_guard() -> None:
    """lib/flipbook.write() fails the bake when content touches a frame border (TA-07 rework: fx_smoke / sparks)."""
    import os
    core.reset_scene()
    os.environ["SAMRAJYA_ASSET_OUT"] = str(OUT / "flipbook_border")
    os.environ["SAMRAJYA_ASSET_ID"] = "selftest_flipbook_border"
    try:
        ctx = flipbook.begin(__file__)
    finally:
        del os.environ["SAMRAJYA_ASSET_OUT"]
        del os.environ["SAMRAJYA_ASSET_ID"]
    ctx.preview = False
    x, y = flipbook.grid2(128)

    def blob(cx: float, cy: float, r: float) -> np.ndarray:
        a = flipbook.gaussian(x, y, cx, cy, r)
        return np.stack([np.full_like(a, 0.6), np.full_like(a, 0.6), np.full_like(a, 0.6), a], axis=-1).astype(np.float32)

    good = blob(0.0, 0.0, 0.2)
    bad = blob(0.92, 0.0, 0.18)  # bleeds over the right edge
    probs, worst = flipbook.check_borders([good], None, blend="alpha")
    check("flipbook border guard: centred puff passes", not probs and worst < flipbook.BORDER_LIMIT, f"worst {worst * 255:.3f}/255")
    probs, _ = flipbook.check_borders([good, bad], None, blend="alpha")
    check("flipbook border guard: puff cut by the right edge fails", len(probs) == 1 and "frame 1" in probs[0] and "right" in probs[0],
          "; ".join(probs))
    seqs = [{"name": "ok", "start": 0, "count": 1, "fps": 1, "loop": False},
            {"name": "ribbon", "start": 1, "count": 1, "fps": 1, "loop": False, "open_edges": ["right"]}]
    probs, _ = flipbook.check_borders([good, bad], seqs, blend="alpha")
    check("flipbook border guard: open_edges opts a sequence out per edge", not probs, "; ".join(probs))
    # additive books are judged on their (encoded) emission, not alpha
    hot = bad.copy()
    hot[..., 3] = 0.0
    hot[..., :3] *= bad[..., 3:4]
    probs, _ = flipbook.check_borders([hot], None, blend="additive")
    check("flipbook border guard: additive emission at the edge fails", len(probs) >= 1, "; ".join(probs[:2]))
    # a thin line 4 px inside the border is clean at 128 px but reaches the border once shipped at 32 px frames
    line = np.zeros((128, 128, 4), np.float32)
    line[24:104, 4:6] = (0.5, 0.5, 0.5, 1.0)
    probs_src, _ = flipbook.check_borders([line], None, blend="alpha")
    probs_pub, _ = flipbook.check_borders([line], None, blend="alpha", published_frame_px=32)
    check("flipbook border guard: also checked at the smallest shipped frame size", not probs_src and any("32 px" in p for p in probs_pub),
          f"source {len(probs_src)} / 32 px {len(probs_pub)}")
    try:
        flipbook.write(ctx, [good, bad], 2, 1, fps=8, loop=False)
        raised = ""
    except ValueError as e:
        raised = str(e)
    check("flipbook border guard: write() fails the bake", "border guard" in raised and "frame 1" in raised, raised.splitlines()[0] if raised else "no error")
    meta = flipbook.write(ctx, [good, bad], 2, 1, fps=8, loop=False, sequences=seqs)
    pub = {sq["name"]: sq for sq in meta["sequences"]}
    check("flipbook border guard: open edges published as openEdges (the runner re-checks encoded atlases)",
          all("open_edges" not in sq for sq in meta["sequences"]) and pub["ribbon"].get("openEdges") == ["right"]
          and "openEdges" not in pub["ok"], str([(n, sq.get("openEdges")) for n, sq in pub.items()]))


def test_flipbook_medium_and_ramp() -> None:
    """Rework round 2: lit smoke / dust normals fade with alpha (lit-medium guard) and gradient-mapped books (fire,
    weapon trail) store one dithered channel + a monotone ramp."""
    import os
    core.reset_scene()
    os.environ["SAMRAJYA_ASSET_OUT"] = str(OUT / "flipbook_ramp")
    os.environ["SAMRAJYA_ASSET_ID"] = "selftest_flipbook_ramp"
    try:
        ctx = flipbook.begin(__file__)
    finally:
        del os.environ["SAMRAJYA_ASSET_OUT"]
        del os.environ["SAMRAJYA_ASSET_ID"]
    ctx.preview = False
    x, y = flipbook.grid2(64)
    a = flipbook.gaussian(x, y, 0.0, 0.0, 0.35) * flipbook.frame_window(64, 0.04, 0.1)
    # a steep "solid" normal everywhere (x tilt 0.9) -> faded: flat where alpha is thin, full tilt where it is thick
    steep = np.zeros((64, 64, 3), np.float32)
    steep[..., 0] = 0.9
    steep[..., 2] = math.sqrt(1 - 0.81)
    enc = steep * 0.5 + 0.5
    soft = flipbook.soften_normals(enc, a, 0.1, 0.7)
    dec = soft * 2 - 1
    thin = a < 0.1
    thick = a > 0.7
    check("medium: soften_normals - thin fringe faces the camera, thick core keeps its tilt",
          float(np.abs(dec[..., 2][thin] - 1).max()) < 1e-3 and float(np.abs(dec[..., 0][thick] - 0.9).max()) < 1e-3,
          f"thin z {float(dec[..., 2][thin].min()):.4f}, thick x {float(dec[..., 0][thick].mean()):.3f}")
    st_steep = flipbook.normal_stats([enc], [a])
    st_soft = flipbook.normal_stats([soft], [a])
    check("medium: normal_stats mean z rises when the tilt fades", st_soft["mean_z"] > st_steep["mean_z"] + 0.2,
          f"{st_steep['mean_z']:.3f} -> {st_soft['mean_z']:.3f}")
    col = np.concatenate([np.full((64, 64, 3), 0.6, np.float32), a[..., None]], axis=-1).astype(np.float32)
    try:
        flipbook.write(ctx, [col], 1, 1, fps=1, loop=True, normals=[enc], blend="alpha", lit=True, min_normal_z=0.8)
        raised = ""
    except ValueError as e:
        raised = str(e)
    check("medium: write(min_normal_z) fails a solid-looking lit book", "lit-medium guard" in raised, raised[:120] or "no error")
    flat = np.broadcast_to(np.array([0.5, 0.5, 1.0], np.float32), (64, 64, 3)).copy()
    meta = flipbook.write(ctx, [col], 1, 1, fps=1, loop=True, normals=[flat], blend="alpha", lit=True, min_normal_z=0.8)
    check("medium: flat normals pass the guard", meta["lit"] is True)
    # ---------------------------------------------------------------- gradient map
    rgb = np.stack([np.clip(a * 1.2, 0, 1), np.clip(a * 0.7, 0, 1) ** 1.4, np.clip(a * 0.3, 0, 1) ** 2], axis=-1).astype(np.float32)
    Y = flipbook.luminance(rgb)
    ramp = flipbook.ramp_fit([rgb], [tg.linear_to_srgb(Y)], stops=17)
    ok_mono = all(c[0] >= c[1] - 1e-9 and c[1] >= c[2] - 1e-9 for c in ramp) and ramp[0] == [0.0, 0.0, 0.0]
    check("ramp: ramp_fit is black at 0 and R >= G >= B", ok_mono and not flipbook.ramp_problems(ramp), str(flipbook.ramp_problems(ramp)))
    shaded = flipbook.ramp_apply(ramp, tg.linear_to_srgb(Y))
    err = float(np.abs(tg.linear_to_srgb(shaded) - tg.linear_to_srgb(rgb))[Y > 0.01].mean())
    check("ramp: ramp(v) reproduces a colour that is a function of luminance", err < 0.03, f"mean encoded error {err * 255:.2f}/255")
    v = flipbook.ramp_encode(np.linspace(0, 0.05, 4096, dtype=np.float32).reshape(64, 64), dither=True, seed=3)
    v0 = flipbook.ramp_encode(np.linspace(0, 0.05, 4096, dtype=np.float32).reshape(64, 64), dither=False)
    on_grid = float(np.abs(v * 255 - np.round(v * 255)).max())
    runs = lambda img: float(np.mean([len(r) for row in img for r in np.split(row, np.nonzero(np.diff(row))[0] + 1)]))  # noqa: E731
    check("ramp: ramp_encode quantises to 8 bit and the dither breaks flat runs", on_grid < 1e-4 and runs(v) < runs(v0) * 0.6,
          f"mean flat run {runs(v0):.1f} -> {runs(v):.1f} px")
    trail = flipbook.ramp_from_hues([(0.0, "#8f2a0c"), (0.5, "#e8892b"), (1.0, "#fff2c0")], stops=33)
    lum = flipbook.luminance(np.array(trail, np.float32))
    check("ramp: ramp_from_hues is monotone in hue order and luminance", not flipbook.ramp_problems(trail)
          and bool(np.all(np.diff(lum) >= -1e-6)), str(flipbook.ramp_problems(trail)))
    vv = np.repeat(flipbook.ramp_encode(Y, dither=True, seed=1)[..., None], 3, axis=-1)
    meta = flipbook.write(ctx, [np.concatenate([vv, a[..., None]], -1).astype(np.float32)], 1, 1, fps=1, loop=True,
                          blend="premultiplied", ramp=ramp)
    check("ramp: write(ramp) publishes the ramp", meta.get("ramp") is not None and len(meta["ramp"]) == 17)
    try:
        flipbook.write(ctx, [np.concatenate([rgb, a[..., None]], -1)], 1, 1, fps=1, loop=True, blend="premultiplied", ramp=ramp)
        raised = ""
    except ValueError as e:
        raised = str(e)
    check("ramp: write(ramp) rejects colour frames (R = G = B required)", "R = G = B" in raised, raised[:120] or "no error")
    bad = [[0, 0, 0], [0.5, 0.6, 0.1]]
    check("ramp: ramp_problems rejects green drift", any("R >= G >= B" in q for q in flipbook.ramp_problems(bad)))


for t in (test_skinned_export, test_lod, test_normal_bake, test_texture_set_bake, test_vat, test_impostor, test_flipbook,
          test_fluid_and_integrator, test_flipbook_border_guard, test_flipbook_medium_and_ramp):
    try:
        t()
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        check(t.__name__, False, repr(e))

failed = [r for r in results if not r[1]]
core.log(f"selftest: {len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
