"""
@asset terrain_rock_basalt
@kind material
@style terrain:TERRAIN_LAYERS.rock_basalt, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Deccan Trap basalt splat layer for TRIPLANAR projection (class T, 10 m x 10 m, seamless; v = world up on the side
projections): the escarpment's stepped flows - massive dark flow cores 2.4-5 m thick with vertical columnar
joints, separated by rubbly, vesicular, red-brown weathered flow tops (the "steps" recess), spheroidal weathering of
the joint blocks, brown weathering rind, white zeolite / calcite specks, pale salt streaks and dark water streaks
running down the faces, lichen on the ledges.
Target (TERRAIN_LAYERS.rock_basalt): average #5a5650, roughness 0.78.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain  # noqa: E402

S = 10.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.rock_basalt", family="soilWet",
            rough_spread=0.09)
x, y = kit.x, kit.y

with core.timer("flows"):
    thick: list[float] = []
    while sum(thick) < S:
        thick.append(float(kit.rng.uniform(2.4, 5.2)))
    sc = S / sum(thick)
    tops = np.cumsum([t * sc for t in thick])
    bottoms = np.concatenate([[0.0], tops[:-1]])
    undul = 0.12 * kit.fbm(2.0, 3, aniso=(3.0, 1.0)) + 0.04 * kit.fbm(0.4, 3)
    vm = (y * S + undul) % S
    flow = np.searchsorted(tops, vm, side="right").clip(0, len(tops) - 1)
    lv = (vm - bottoms[flow]) / (tops[flow] - bottoms[flow])
    # rubbly vesicular top (upper 8-22 % of each flow, ragged boundary) recessed, massive core protruding
    top_frac = (np.array([kit.rng.uniform(0.08, 0.22) for _ in thick], np.float32))[flow]
    tf = np.clip(top_frac + 0.06 * kit.fbm(0.6, 3) + 0.03 * kit.fbm(0.15, 2), 0.03, 0.4)
    rubble = tg.smoothstep(1.0 - tf - 0.03, 1.0 - tf + 0.03, lv)
    core_p = np.sin(np.pi * np.clip(lv / (1.0 - tf), 0, 1)) ** 0.4
    h = 0.25 * core_p * (1.0 - rubble) - 0.1 * rubble
    # irregular columnar joints: per flow random column widths 0.5-1.6 m, wavy, some stopping short
    dj = np.full(h.shape, 9.0, np.float32)
    colid = np.zeros(h.shape, np.float32)
    wav = 0.15 * kit.fbm(1.2, 3, aniso=(0.3, 1.0)) + 0.04 * kit.fbm(0.3, 2)
    u = (x * S + wav) % S
    for i in range(len(thick)):
        sel = flow == i
        if not np.any(sel):
            continue
        cuts: list[float] = []
        while sum(cuts) < S:
            cuts.append(float(kit.rng.uniform(0.5, 1.6)))
        pos = np.cumsum([0.0] + [c * S / sum(cuts) for c in cuts[:-1]]) + kit.rng.uniform(0, S)
        pos = np.sort(pos % S)
        ext = np.concatenate([pos - S, pos, pos + S])
        uu = u[sel]
        k = np.searchsorted(ext, uu, side="right") - 1
        dj[sel] = np.minimum(uu - ext[k], ext[np.minimum(k + 1, len(ext) - 1)] - uu)
        ids = kit.rng.uniform(0, 1, len(pos)).astype(np.float32)
        colid[sel] = ids[k % len(pos)]
    stop = tg.smoothstep(-0.2, 0.2, kit.fbm(0.9, 2, aniso=(0.3, 1.0)))
    vjoint = tg.smoothstep(0.05, 0.0, dj) * (1.0 - rubble) * stop
    cj = tg.smoothstep(0.03, 0.0, np.abs(((lv * 5.0 + 0.4 * kit.fbm(0.8, 2)) % 1.0) - 0.5) - 0.47)
    cross = cj * (1.0 - rubble) * tg.smoothstep(0.45, 0.75, kit.fbm(0.7, 2) * 0.5 + 0.5)
    h -= 0.12 * vjoint + 0.05 * cross
    # spheroidal weathering: column faces rounded near joints
    h += 0.05 * np.clip(dj / 0.5, 0, 1) ** 0.5 * (1.0 - rubble) + 0.04 * (colid - 0.5) * (1.0 - rubble)
    # vesicles + rubble clasts on flow tops
    vf1, _, vid = kit.worley(0.03, 1.0)
    ves = tg.smoothstep(0.4, 0.15, vf1) * (vid > 0.4) * rubble
    clast = kit.scatter(0.2, K.shape_pebble(0.09, 0.07, 0.05, 0.5, 0.5), density=0.8, density_map=rubble)
    h = np.maximum(h, h + clast.height(0.0) * 0.8) - 0.01 * ves
    h += 0.02 * kit.fbm(0.5, 4) + 0.006 * kit.fbm(0.08, 3) + 0.0015 * kit.fbm(0.012, 2)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.2 * (colid - 0.5) + 0.12 * kit.fbm(0.8, 3) + 0.08 * kit.fbm(0.05, 3), 0, 1)
    rock = K.ramp(t, [(0.0, "#3a3835"), (0.4, "#4a4743"), (0.75, "#5a5651"), (1.0, "#6c6760")])
    rind = K.ramp(t, [(0.0, "#4e4237"), (1.0, "#6a5646")])  # oxidized rubbly tops (with soil and dry grass)
    rock = rock * (1.0 - rubble[..., None] * 0.6) + rind * (rubble[..., None] * 0.6)
    rock = K.tint(rock, "#6e5a48", 0.2 * tg.smoothstep(0.2, 0.7, kit.fbm(0.4, 3)))  # brown weathering rind
    rock = K.mul(rock, 1.0 - 0.35 * vjoint - 0.2 * cross - 0.3 * ves)
    # white zeolite / calcite specks in the vesicular tops
    zeo = tg.smoothstep(0.7, 0.9, kit.fbm(0.006, 2) * 0.5 + 0.5) * rubble
    rock = K.tint(rock, "#d8d2c4", 0.5 * zeo)
    # streaks: pale salt and dark water running down from the flow tops
    src = rubble * tg.smoothstep(0.4, 0.7, kit.fbm(0.25, 3, aniso=(0.2, 1.0)) * 0.5 + 0.5)
    streak = np.clip(tg.blur(tg.directional_blur_down(src, int(kit.px(1.5)), 0.99), 2.0), 0, 1) * (1.0 - rubble)
    salt = streak * tg.smoothstep(0.0, 0.4, kit.fbm(1.5, 2))
    rock = K.tint(rock, "#2a2826", 0.4 * streak * (1.0 - salt))
    rock = K.tint(rock, "#9a968c", 0.3 * salt)
    ledge = tg.smoothstep(0.02, 0.1, lv - (1.0 - tf)) * tg.smoothstep(0.5, 0.75, kit.fbm(0.1, 3) * 0.5 + 0.5)
    rock = K.tint(rock, "#6f7458", 0.4 * ledge)
    alb = K.compress_chroma(rock, 0.9)

with core.timer("roughness"):
    rough = 0.76 + 0.05 * kit.fbm(0.2, 3) + 0.1 * rubble - 0.08 * streak + 0.05 * ledge

finish_terrain(kit, h, alb, rough, macro_sigma=2.5, macro_amount=0.5, height_hp=0.3, ao_distance=0.4,
               ao_height_mix=0.35, preview="cliff",
               description="Deccan Trap basalt for triplanar projection (10 m, v = up): stepped flows, massive cores "
                           "with columnar joints, rubbly vesicular red-brown tops, salt and water streaks, lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
