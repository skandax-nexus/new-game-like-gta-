"""
@asset timber_teak_carved
@kind material
@style materials:MATERIAL_PRESETS.timber_teak_carved, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Carved, oiled teak as a TRIM SHEET (class S, 2 m x 2 m, seamless in u; grain runs along u). Bands, bottom -> top
(UV v ranges in metadata.trims / the manifest; band seams are cut as 3 mm grooves so bands never bleed):
    plain_beam      0.00-0.32 m   adzed plank / beam face, two plank seams
    bead_row        0.32-0.40     bead-and-reel astragal
    creeper_scroll  0.40-0.64     patra-lata running scroll (vine, spirals, leaves, buds)
    lotus_bracket   0.64-0.88     upright lotus-petal (padma) moulding for bracket faces and lintels
    bell_capital    0.88-1.08     inverted lotus petals to wrap a bell capital (u around the capital)
    fluted_shaft    1.08-1.50     10 flutes running along u: map u up a column, v around it (16 cm diameter
                                  at 1:1; scale v for thicker shafts)
    door_panel      1.50-2.00     stiles, rails and fielded panels with rows of bronze studs (metal, ORM.b = 1)
Teak #6b4a2e +-6 %, darker grain lines, raised weathered grain, grime in the carving, worn and oiled arrises
(#7d5636, roughness ~0.45). Target (MATERIAL_PRESETS.timber_teak_carved): average #6b4a2e, roughness 0.62 (0.45-0.80).

Period notes: Mauryan Pataliputra's palace and walls were timber (excavated sal / teak beams at Bulandibagh);
timber carving vocabulary is the one the stone toranas copy (bead-and-reel, padma, patra-lata, fluted shafts with
bell capitals). Bronze / copper studs on doors are attested in later texts; kept sparse.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, ornament as orn, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="S", size=(W, H), target="materials:MATERIAL_PRESETS.timber_teak_carved", family="timber",
            saturation_limit="medium")
F = np.float32


def beam(u, v, length, height, rng):
    """Adzed plank face: shallow overlapping adze scallops along u, two plank seams."""
    seams = [0.37, 1.41]
    sid, jd = orn._stones_along(u % length, length, seams, rng)
    ph = 0.0006 * np.sin(2 * np.pi * (u / 0.07 + 0.3 * np.sin(v * 9.0)))  # adze strokes ~7 cm
    scal = np.abs(np.sin(np.pi * (u / 0.07 + 0.2 * np.sin(v * 7.0 + sid * 9.0)))) ** 0.5
    h = 0.0005 * scal + 0.0002 * ph
    h = orn.cut_joint(h, jd, 0.003, 0.004, 0.01)
    return orn.BandResult(h.astype(F), sid, np.zeros_like(u), jd)


def bead(u, v, length, height, rng):
    return orn.bead_reel(u, v, length, height, 0.06, rng, joints=(0.37,))


def scroll(u, v, length, height, rng):
    return orn.vine_scroll(u, v, length, height, 0.5, rng, joints=(1.41,))


def bracket(u, v, length, height, rng):
    return orn.padma(u, v, length, height, 0.16, rng, joints=(0.37,))


def bell(u, v, length, height, rng):
    r = orn.padma(u, height - v, length, height, 0.1, rng, joints=(1.41,))
    return r


def flutes(u, v, length, height, rng, n=10):
    """Concave flutes along u separated by flat fillets; v = around the shaft."""
    fv = (v / height * n) % 1.0
    c = np.abs(fv - 0.5) / 0.42
    ch = np.where(c < 1.0, -0.0065 * np.sqrt(np.clip(1.0 - c * c, 0.0, 1.0)), 0.0)
    sid, jd = orn._stones_along(u % length, length, [0.37], rng)
    # soften the fillet arrises (worn by hands)
    h = ch - 0.0008 * tg.smoothstep(0.9, 1.0, c) * (c < 1.0)
    return orn.BandResult(h.astype(F), sid, (c < 1.0).astype(F), jd)


def door(u, v, length, height, rng):
    """Four fielded panels between stiles and rails; bronze stud domes along rails and stiles (tool mask)."""
    pw = length / 4.0
    lu = u % pw
    stile, rail = 0.085, 0.075
    dx = np.minimum(lu, pw - lu)
    dy = np.minimum(v, height - v)
    d = np.minimum(dx - stile, dy - rail)  # >0 inside the panel
    field = np.clip(d / 0.03, 0.0, 1.0)  # fielded bevel 3 cm wide
    h = np.where(d > 0, -0.009 + 0.006 * field, 0.0)
    h += np.where(d <= 0, -0.0015 * tg.smoothstep(-0.004, 0.0, d), 0.0)  # moulded inner edge of the frame
    # bronze studs: along both rails every 0.1 m and down the stiles every 0.1 m
    studs = np.zeros_like(u)
    sh = np.zeros_like(u)
    R = 0.011
    for yc in (rail * 0.5, height - rail * 0.5):
        cxs = (np.round((lu - pw * 0.05) / (pw * 0.2)) * (pw * 0.2) + pw * 0.05)
        r = np.hypot(lu - cxs, v - yc)
        dome = np.sqrt(np.clip(1.0 - (r / R) ** 2, 0.0, 1.0))
        sh = np.maximum(sh, 0.007 * dome)
        studs = np.maximum(studs, (r < R).astype(F))
    for xc in (stile * 0.5, pw - stile * 0.5):
        cys = np.clip(np.round((v - 0.05) / 0.1) * 0.1 + 0.05, rail, height - rail)
        r = np.hypot(lu - xc, v - cys)
        dome = np.sqrt(np.clip(1.0 - (r / R) ** 2, 0.0, 1.0))
        sh = np.maximum(sh, 0.007 * dome)
        studs = np.maximum(studs, (r < R).astype(F))
    h = np.maximum(h, sh)
    sid = np.floor(u / pw).astype(F) * 0.27 % 1.0
    joint = np.minimum(np.abs(dx - stile), np.abs(dy - rail))
    return orn.BandResult(h.astype(F), sid.astype(F), (d > 0).astype(F), joint.astype(F), tool=studs.astype(F))


BANDS = [
    orn.Band("plain_beam", 0.00, 0.32, beam),
    orn.Band("bead_row", 0.32, 0.40, bead),
    orn.Band("creeper_scroll", 0.40, 0.64, scroll),
    orn.Band("lotus_bracket", 0.64, 0.88, bracket),
    orn.Band("bell_capital", 0.88, 1.08, bell),
    orn.Band("fluted_shaft", 1.08, 1.50, flutes),
    orn.Band("door_panel", 1.50, 2.00, door),
]

with core.timer("compose"):
    sheet = orn.compose_sheet(kit.N, kit.N, (W, H), BANDS, kit.rng)
x, y = kit.x, kit.y
door_rows = (y * H) >= 1.5
studs = np.where(door_rows, sheet.tool, 0.0).astype(F)
carve = sheet.carve

with core.timer("grain"):
    # straight teak grain along u (vertical in the door stiles): irregular growth lines 3-12 mm apart, broad colour
    # streaks, open pores, raised weathered grain on plain wood
    lu_d = (x * W) % 0.5
    dx_d = np.minimum(lu_d, 0.5 - lu_d)
    stile = door_rows & (dx_d < 0.085)
    wx, wy = kit.warp(0.02, 0.4, 3)
    ph_h = wy * H / 0.0075 + 5.0 * kit.fbm(0.3, 4, x=wx, y=wy, aniso=(10.0, 1.0)) + 1.2 * kit.fbm(0.04, 3, aniso=(15.0, 1.0))
    ph_v = wx * W / 0.0075 + 5.0 * kit.fbm(0.3, 4, x=wx, y=wy, aniso=(1.0, 10.0)) + 1.2 * kit.fbm(0.04, 3, aniso=(1.0, 15.0))
    rings = np.sin(2 * np.pi * np.where(stile, ph_v, ph_h))
    lines = tg.smoothstep(0.55, 1.0, rings) * (0.6 + 0.4 * tg.smoothstep(-0.3, 0.5, kit.fbm(0.15, 3, aniso=(6.0, 1.0))))
    pores = np.where(stile, kit.fbm(0.002, 2, aniso=(1.0, 25.0)), kit.fbm(0.002, 2, aniso=(25.0, 1.0)))
    streak = np.where(stile, kit.fbm(0.05, 3, aniso=(1.0, 20.0)), kit.fbm(0.05, 3, aniso=(20.0, 1.0)))
    h = sheet.height + 0.0002 * lines + 0.00008 * pores
    h = h + 0.00012 * streak * (1.0 - carve)

with core.timer("albedo"):
    plank = np.where(stile, 0.71, sheet.stone)
    t = np.clip(0.5 + 0.35 * streak + 0.3 * (plank - 0.5) + 0.1 * kit.fbm(0.3, 3), 0, 1)
    alb = K.ramp(t, [(0.0, "#46301f"), (0.3, "#5a3d27"), (0.6, "#6e4c30"), (1.0, "#8c6440")])
    alb = K.mul(alb, 1.0 - 0.28 * lines - 0.08 * (pores > 0.4))
    # grime in carving recesses, worn / oiled lighter arrises
    curv = tg.curvature(h, kit.texel, 1.0)
    cav = np.clip(-tg.cavity(h, 6.0) / 0.002, 0.0, 1.0)
    worn = tg.smoothstep(0.0, 10.0, curv)
    alb = K.tint(alb, "#2a1c12", 0.6 * cav)
    alb = K.tint(alb, "#7d5636", 0.55 * worn)
    # door: fielded panels a shade lighter (sun on the panel faces), dark oil-grime line around them
    panel = door_rows & (carve > 0.5)
    alb = K.tint(alb, "#7a5839", 0.18 * panel)
    # grey sun-weathering on the plain beam band (exposed wood), patchy
    beam_rows = (y * H) < 0.32
    alb = K.tint(alb, "#7a6c5c", 0.22 * beam_rows * tg.smoothstep(0.1, 0.6, kit.fbm(0.4, 3)))
    # bronze studs: aged bronze, dark green-brown in the crevice ring
    bronze = K.ramp(np.clip(0.5 + 0.4 * kit.fbm(0.01, 2), 0, 1), [(0.0, "#5e4a33"), (0.6, "#8c6a45"), (1.0, "#a8865a")])
    alb = alb * (1.0 - studs[..., None]) + bronze * studs[..., None]

with core.timer("roughness"):
    rough = 0.66 + 0.05 * streak + 0.1 * cav - 0.2 * worn + 0.03 * lines
    rough = rough * (1.0 - studs) + studs * (0.42 + 0.1 * kit.fbm(0.01, 2))
metal = studs

trims = sheet.trims()
kit.finish(height=h, albedo=alb, rough=rough, metal=metal, ao="cycles", ao_distance=0.03, ao_samples=48, trims=trims,
           decals=sheet.decals(),
           description="Carved oiled teak trim sheet (2 m, grain along u): plain beam, bead row, creeper scroll, "
                       "lotus bracket, bell capital, fluted shaft, studded door panel.",
           preview="trim", preview_opts=dict(floor_band=(0.0, 0.16), samples=64))
