"""
@asset stupa_sanchi
@kind model
@depends sandstone_carved_red

Sanchi-style stupa (after Sanchi Stupas 1 and 3, 3rd-1st c. BCE) with a carved torana gateway, built
entirely from the carved red sandstone trim sheet (runtime-bound shared textures) plus a baked macro map
(UV2: AO + grime / rising damp / rain streaks). LOD0 (hero, close-up) and LOD1 (parametric, distance).
OWNER: Technical Art Director.

Anatomy (meters; Blender +Z up, model faces -Y = three.js +Z / south):
    paved pradakshina path r 11.4 | ground vedika (railing) r 10.6: posts, three lens crossbars per bay,
    rounded coping with creeper scroll, opening at the south | torana: two pillars (medallion panels,
    climbing creepers), inverted-lotus bell capitals, three gently curved architraves with spiral volute
    ends, dies, struts, dharmachakra + triratna finials | medhi (drum) r 7.6 with plinth, ashlar, lotus
    frieze, bead-and-reel and padma cornice, terrace + upper railing, double stairway (sopana) |
    anda (dome) truncated ellipsoid r 6.4 in staggered ashlar courses | harmika railing | yashti with
    three chhatras (lotus-carved umbrellas).
Footprint 22.8 m, height ~11.7 m. Origin at the ground centre.
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import bake, core, export, materials, mesh as M, render, texgen as tg, trim  # noqa: E402
from lib.trim import Run, lens, rect  # noqa: E402

ctx = core.begin(__file__, kind="model")
dep = ctx.dep("sandstone_carved_red")
SHEET = trim.Sheet.from_dependency(dep)
rng = ctx.rng
TAU = 2 * math.pi
SOUTH = -math.pi / 2  # gateway direction (Blender -Y)

# ------------------------------------------------------------------------------------- dimensions
GROUND = 0.25  # top of the paved path
R_PAVE = 11.4
R_VED = 10.6
VED_H = 1.75
R_DRUM = 7.6
DRUM_TOP = 2.01
R_DOME = 6.4
DOME_H = 5.3
R_DOME_TOP = 1.55
GATE_HALF = 1.5  # torana pillar offset from the axis
COURSE = 0.32  # ashlar course height of the trim sheet

COURSE_BANDS = [(SHEET.trims["ashlar"][0], (SHEET.trims["ashlar"][0] + SHEET.trims["ashlar"][1]) / 2),
                ((SHEET.trims["ashlar"][0] + SHEET.trims["ashlar"][1]) / 2, SHEET.trims["ashlar"][1])]


def courses(r_out: float, r_in: float, z: float, start: int = 0) -> list[Run]:
    """Horizontal paving rings (outer -> inner), one ashlar course each, staggered joints."""
    runs = []
    n = max(1, int(round((r_out - r_in) / COURSE)))
    for k in range(n):
        a = r_out - (r_out - r_in) * k / n
        b = r_out - (r_out - r_in) * (k + 1) / n
        runs.append(Run([(a, z), (b, z)], COURSE_BANDS[(k + start) % 2], u_offset=float(rng.uniform(0, 1))))
    return runs


def dome_profile(detail: float) -> list[Run]:
    """Truncated ellipsoid split into ashlar courses (two segments per course; merged pairs on LOD1)."""
    phi_top = math.acos(R_DOME_TOP / R_DOME)
    ph = np.linspace(0.0, phi_top, 600)
    pts = np.stack([R_DOME * np.cos(ph), DRUM_TOP + DOME_H * np.sin(ph)], axis=1)
    s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    per = COURSE if detail >= 0.75 else 2 * COURSE
    n = max(2, int(round(s[-1] / per)))
    runs = []
    for k in range(n):
        sub = np.linspace(s[-1] * k / n, s[-1] * (k + 1) / n, 3 if detail >= 0.75 else 2)
        p = np.stack([np.interp(sub, s, pts[:, 0]), np.interp(sub, s, pts[:, 1])], axis=1)
        band = COURSE_BANDS[k % 2] if per == COURSE else "ashlar"
        runs.append(Run(p.tolist(), band, u_offset=float(rng.uniform(0, 1))))
    return runs


# ------------------------------------------------------------------------------------- builders
def vedika(tm: trim.TrimMesh, mat: str, radius: float, z0: float, height: float, a0: float, a1: float, detail: float,
           post_w: float = 0.30, post_d: float = 0.24, bay: float = 1.05, bars: int = 3, coping_h: float = 0.32,
           coping_d: float = 0.34, small: bool = False) -> None:
    """Stone railing along an arc: posts, lens crossbars, rounded coping (caps at open ends)."""
    span = a1 - a0
    n_bays = max(1, int(round(span * radius / bay)))
    ch = 0.03 if detail >= 0.75 else 0.0
    post_top = z0 + height - coping_h
    bar_h = min(0.34, (post_top - z0) / (bars + 0.6) * 0.8)
    for i in range(n_bays + 1):
        th = a0 + span * i / n_bays
        c, s = math.cos(th), math.sin(th)
        base = (radius * c, radius * s)
        tm.path(
            [Run(rect(post_w, post_d, ch, -post_d / 2)[k:k + 2], band) for k, band in _post_bands(ch, small)],
            [(base[0], base[1], z0), (base[0], base[1], post_top + 0.02)],
            up=(c, s, 0.0), mat=mat, caps=False, u_start=-0.0625,
        )
        if i == n_bays:
            break
        th2 = a0 + span * (i + 1) / n_bays
        c2, s2 = math.cos(th2), math.sin(th2)
        p0 = np.array([radius * c, radius * s])
        p1 = np.array([radius * c2, radius * s2])
        d = (p1 - p0) / np.linalg.norm(p1 - p0)
        q0 = p0 + d * post_w * 0.45
        q1 = p1 - d * post_w * 0.45
        seg_len = float(np.linalg.norm(q1 - q0))
        gap = (post_top - z0 - bars * bar_h) / (bars + 1)
        prof = lens(0.12 if not small else 0.08, bar_h, 4 if detail >= 0.75 else 2)
        half = len(prof) // 2
        for b in range(bars):
            zb = z0 + gap * (b + 1) + bar_h * b
            # centre one medallion panel (0.5 m) on each crossbar face
            u0 = 0.375 - (seg_len / 2) / SHEET.tile[0]
            tm.path([Run(prof[:half + 1], "medallion_frieze"), Run(prof[half:], "medallion_frieze")],
                    [(q0[0], q0[1], zb), (q1[0], q1[1], zb)], up=(0, 0, 1), mat=mat, caps=False, u_start=u0)
    # rounded coping (ushnisha) with a running creeper on both faces
    ro, ri = radius + coping_d / 2, radius - coping_d / 2
    zc = post_top
    top = [(ro, zc + coping_h)] + [(radius + coping_d / 2 * math.cos(t), zc + coping_h + coping_d * 0.32 * math.sin(t))
                                   for t in np.linspace(0, math.pi, 7 if detail >= 0.75 else 3)][1:-1] + [(ri, zc + coping_h)]
    seg = max(12, int(abs(span) * radius / (0.28 if detail >= 0.75 else 0.7)))
    tm.ring([
        Run([(ro, zc), (ro, zc + coping_h)], "vine_scroll" if not small else "bead_reel"),
        Run(top, "ashlar"),
        Run([(ri, zc + coping_h), (ri, zc)], "vine_scroll" if not small else "bead_reel"),
        Run([(ri, zc), (ro, zc)], "ashlar"),
    ], seg, mat, a0=a0, a1=a1, caps=None if abs(span - TAU) < 1e-6 else "both", integer_tiles=False)


def _post_bands(ch: float, small: bool) -> list[tuple[int, str]]:
    """Profile segment index -> band for a (chamfered) rect post profile."""
    face_out = "medallion_frieze" if not small else "bead_reel"
    if ch <= 0:
        # rect: right(+side), top(+up = outer face), left, bottom(inner face)
        return [(0, "ashlar"), (1, face_out), (2, "ashlar"), (3, face_out)]
    return [(0, "ashlar"), (1, "bead_reel"), (2, face_out), (3, "bead_reel"), (4, "ashlar"), (5, "bead_reel"),
            (6, face_out), (7, "bead_reel")]


def torana(tm: trim.TrimMesh, mat: str, detail: float) -> None:
    y = -R_VED
    hi = detail >= 0.75
    ch = 0.03 if hi else 0.0
    pillar_top = GROUND + 4.0
    for sx in (-1, 1):
        x = sx * GATE_HALF
        tm.box(mat, (x, y, GROUND + 0.15), (0.66, 0.66, 0.3), bands={"+x": "ashlar_base", "-x": "ashlar_base",
                                                                     "+y": "ashlar_base", "-y": "ashlar_base"})
        prof = rect(0.44, 0.44, ch, -0.22)
        bands = ([(0, "vine_scroll"), (1, "medallion_frieze"), (2, "vine_scroll"), (3, "medallion_frieze")] if ch <= 0 else
                 [(0, "vine_scroll"), (1, "bead_reel"), (2, "medallion_frieze"), (3, "bead_reel"), (4, "vine_scroll"),
                  (5, "bead_reel"), (6, "medallion_frieze"), (7, "bead_reel")])
        tm.path([Run(prof[k:k + 2], b) for k, b in bands], [(x, y, GROUND + 0.3), (x, y, pillar_top)], up=(0, 1, 0),
                mat=mat, caps=False, u_start=0.05)
        # inverted lotus bell capital + abacus + capital block (where Sanchi has its elephant/lion groups)
        tm.ring([Run([(0.25, pillar_top), (0.31, pillar_top + 0.18), (0.37, pillar_top + 0.36)], "padma", flip=True),
                 Run([(0.37, pillar_top + 0.36), (0.0, pillar_top + 0.36)], "ashlar")],
                24 if hi else 12, mat, center=(x, y, 0.0))
        tm.box(mat, (x, y, pillar_top + 0.47), (0.82, 0.82, 0.22), bands={k: "dentil" for k in ("+x", "-x", "+y", "-y")})
        tm.box(mat, (x, y, pillar_top + 0.86), (0.92, 0.92, 0.56), decals={"+y": "lotus_medallion", "-y": "lotus_medallion",
                                                                            "+x": "lotus_medallion", "-x": "lotus_medallion"})
        tm.box(mat, (x, y, pillar_top + 1.18), (1.0, 1.0, 0.08), bands={k: "bead_reel" for k in ("+x", "-x", "+y", "-y")})
    z = pillar_top + 1.22
    beams = [(2.45, "medallion_frieze"), (2.62, "split"), (2.8, "medallion_frieze")]
    bh, bd, gap = 0.38, 0.34, 0.44
    for i, (half, kind) in enumerate(beams):
        zb = z + i * (bh + gap)
        n = 17 if hi else 7
        xs = np.linspace(-half, half, n)
        path = [(float(px), y, float(zb + 0.07 * (px / half) ** 2)) for px in xs]
        prof = rect(bd, bh, 0.0, 0.0)  # (side=+-Y, up=Z): right(+Y face) up, top, left(-Y face) down, bottom
        if kind == "split":
            front = [Run([(-bd / 2, bh), (-bd / 2, 0.24)], "dentil" if False else (SHEET.trims["vine_scroll"][1], SHEET.trims["vine_scroll"][0])),
                     Run([(-bd / 2, 0.24 - 0.0), (-bd / 2, 0.0)], (SHEET.trims["dentil"][1], SHEET.trims["dentil"][0]))]
            back = [Run([(bd / 2, 0.0), (bd / 2, 0.14)], "dentil"), Run([(bd / 2, 0.14), (bd / 2, bh)], "vine_scroll")]
            runs = back + [Run(prof[1:3], "ashlar")] + front + [Run(prof[3:5], "ashlar")]
        else:
            runs = [Run(prof[0:2], kind), Run(prof[1:3], "ashlar"), Run(prof[2:4], kind), Run(prof[3:5], "ashlar")]
        tm.path(runs, path, up=(0, 0, 1), mat=mat, caps=False, u_start=0.125 - half / SHEET.tile[0])
        # spiral volutes at both ends (Sanchi's signature): drums with the spiral-rosette decal on the faces
        for sx in (-1, 1):
            cx = sx * half
            cz = zb + 0.07 + bh / 2
            rr = bh / 2 + 0.03
            seg = 20 if hi else 10
            circle = [(rr * math.cos(t), rr * math.sin(t)) for t in np.linspace(0, TAU, seg + 1)]
            tm.path([Run(circle, "bead_reel")], [(cx, y - bd / 2 - 0.01, cz), (cx, y + bd / 2 + 0.01, cz)],
                    up=(0, 0, 1), mat=mat, caps=True, cap_band=None, cap_decal="spiral_rosette")
        if i < 2:
            # dies above the pillars and struts in the span
            zd = zb + bh + gap / 2 + 0.035
            for sx in (-1, 1):
                tm.box(mat, (sx * GATE_HALF, y, zd), (0.46, 0.42, gap + 0.04),
                       decals={"+y": "lotus_medallion", "-y": "lotus_medallion"}, bands={"+x": "ashlar", "-x": "ashlar"})
            if hi:
                for px in (-0.75, 0.0, 0.75):
                    tm.path([Run(rect(0.12, 0.12, 0.0, -0.06)[k:k + 2], "bead_reel") for k in range(4)],
                            [(px, y, zb + bh + 0.02), (px, y, zb + bh + gap + 0.05)], up=(0, 1, 0), mat=mat, caps=False)
    ztop = z + 2 * (bh + gap) + bh
    # dharmachakra (wheel of law) on a pedestal
    tm.box(mat, (0, y, ztop + 0.12), (0.5, 0.36, 0.24), bands={k: "bead_reel" for k in ("+x", "-x", "+y", "-y")})
    wc = ztop + 0.24 + 0.66
    R = 0.62
    seg = 40 if hi else 16
    circle = [(math.cos(t) * R, wc + math.sin(t) * R) for t in np.linspace(0, TAU, seg + 1)]
    # rim: sweep a small section around the circle (path in the XZ plane, profile in (radial, Y))
    rim_path = [(px, y, pz) for px, pz in circle]
    tm.path([Run([(-0.06, 0.07), (-0.06, -0.07)], "bead_reel"), Run([(-0.06, -0.07), (0.06, -0.07)], "ashlar"),
             Run([(0.06, -0.07), (0.06, 0.07)], "bead_reel"), Run([(0.06, 0.07), (-0.06, 0.07)], "ashlar")],
            rim_path, up=(0, 1, 0), mat=mat, caps=False)
    spokes = 16 if hi else 8
    for k in range(spokes):
        t = TAU * k / spokes
        a = (math.cos(t) * 0.16, wc + math.sin(t) * 0.16)
        b = (math.cos(t) * (R - 0.05), wc + math.sin(t) * (R - 0.05))
        tm.path([Run(rect(0.05, 0.05, 0.0, -0.025)[j:j + 2], "ashlar") for j in range(4)],
                [(a[0], y, a[1]), (b[0], y, b[1])], up=(0, 1, 0), mat=mat, caps=False)
    hub = [(math.cos(t) * 0.17, math.sin(t) * 0.17) for t in np.linspace(0, TAU, 17)]
    tm.path([Run(hub, "bead_reel")], [(0, y - 0.09, wc), (0, y + 0.09, wc)], up=(0, 0, 1), mat=mat, caps=True,
            cap_band=None, cap_decal="lotus_medallion")
    # triratna finials above the pillars: pedestal, disc and three prongs
    for sx in (-1, 1):
        x = sx * GATE_HALF
        zt = ztop + 0.07 * (GATE_HALF / beams[2][0]) ** 2
        tm.box(mat, (x, y, zt + 0.1), (0.36, 0.3, 0.2), bands={k: "bead_reel" for k in ("+x", "-x", "+y", "-y")})
        disc = [(math.cos(t) * 0.24, math.sin(t) * 0.24) for t in np.linspace(0, TAU, 21 if hi else 11)]
        tm.path([Run(disc, "bead_reel")], [(x, y - 0.07, zt + 0.46), (x, y + 0.07, zt + 0.46)], up=(0, 0, 1), mat=mat,
                caps=True, cap_band=None, cap_decal="spiral_rosette")
        for px, h, w in ((0.0, 0.72, 0.1), (-0.17, 0.46, 0.08), (0.17, 0.46, 0.08)):
            tm.path([Run(rect(w, 0.1, 0.0, -0.05)[j:j + 2], "ashlar") for j in range(4)],
                    [(x + px, y, zt + 0.62), (x + px * 1.4, y, zt + 0.62 + h)], up=(0, 1, 0), mat=mat, caps=True,
                    cap_band="ashlar")


def drum(tm: trim.TrimMesh, mat_stone: str, mat_pave: str, detail: float) -> None:
    hi = detail >= 0.75
    seg = 160 if hi else 56
    rd = R_DRUM
    runs = [
        Run([(rd + 0.12, GROUND - 0.02), (rd + 0.12, GROUND + 0.32)], "ashlar_base"),
        Run([(rd + 0.12, GROUND + 0.32), (rd, GROUND + 0.32)], "ashlar"),
        Run([(rd, GROUND + 0.32), (rd, GROUND + 0.96)], "ashlar"),
        Run([(rd, GROUND + 0.96), (rd, GROUND + 1.36)], "medallion_frieze"),
        Run([(rd, GROUND + 1.36), (rd + 0.04, GROUND + 1.44)], "bead_reel"),
        Run([(rd + 0.04, GROUND + 1.44), (rd + 0.11, GROUND + 1.55), (rd + 0.18, GROUND + 1.64)], "padma"),
        Run([(rd + 0.18, GROUND + 1.64), (rd + 0.18, DRUM_TOP)], "dentil"),
    ]
    tm.ring(runs, seg, mat_stone)
    tm.ring(courses(rd + 0.18, R_DOME - 0.05, DRUM_TOP), seg, mat_pave)
    # upper railing on the terrace edge, open at the stair landing
    gap = math.asin(1.2 / (rd - 0.05))
    vedika(tm, mat_stone, rd - 0.05, DRUM_TOP, 0.95, SOUTH + gap, SOUTH + TAU - gap, detail, post_w=0.16, post_d=0.14,
           bay=0.8, bars=2, coping_h=0.16, coping_d=0.18, small=True)


def dome(tm: trim.TrimMesh, mat: str, detail: float) -> None:
    seg = 160 if detail >= 0.75 else 56
    tm.ring(dome_profile(detail), seg, mat, continuous=True)
    zt = DRUM_TOP + DOME_H * math.sin(math.acos(R_DOME_TOP / R_DOME))
    tm.ring(courses(R_DOME_TOP, 0.0001, zt), 48 if detail >= 0.75 else 20, mat)
    return zt


def harmika_chhatra(tm: trim.TrimMesh, mat: str, z0: float, detail: float) -> None:
    hi = detail >= 0.75
    half = 1.3
    h = 1.05
    # corner + intermediate posts
    for i in range(4):
        for j in range(4):
            if 0 < i < 3 and 0 < j < 3:
                continue
            x = -half + 2 * half * i / 3
            yy = -half + 2 * half * j / 3
            tm.path([Run(rect(0.18, 0.18, 0.0, -0.09)[k:k + 2], "bead_reel" if k % 2 else "ashlar") for k in range(4)],
                    [(x, yy, z0), (x, yy, z0 + h - 0.2)], up=(0, 1, 0) if abs(x) > abs(yy) else (1, 0, 0), mat=mat, caps=False)
    # rails + coping on the four sides
    for side in range(4):
        rot = side * math.pi / 2
        c, s = math.cos(rot), math.sin(rot)

        def P(x: float, yy: float, zz: float) -> tuple[float, float, float]:
            return (x * c - yy * s, x * s + yy * c, zz)

        for zr in (z0 + 0.3, z0 + 0.58):
            tm.path([Run(lens(0.08, 0.18, 2)[:3], "medallion_frieze"), Run(lens(0.08, 0.18, 2)[2:], "medallion_frieze")],
                    [P(-half, -half, zr), P(half, -half, zr)], up=(0, 0, 1), mat=mat, caps=False, u_start=0.125)
        tm.box(mat, P(0, -half, z0 + h - 0.1), (2 * half + 0.26, 0.26, 0.2), bands={"-y": "bead_reel", "+y": "bead_reel",
                                                                                    "+x": "ashlar", "-x": "ashlar"}, rot_z=rot)
    # yashti (shaft) and three chhatras (umbrellas) with lotus-petal tops
    tm.ring([Run([(0.1, z0 - 0.1), (0.09, z0 + 3.45)], "ashlar")], 12 if hi else 8, mat)
    for zz, R in ((z0 + 1.55, 1.38), (z0 + 2.3, 1.02), (z0 + 2.95, 0.7)):
        top = [(R, zz + 0.1), (R * 0.55, zz + 0.2), (0.1, zz + 0.27)]
        tm.ring([Run([(0.1, zz - 0.04), (R, zz)], "ashlar"),
                 Run([(R, zz), (R, zz + 0.1)], "bead_reel"),
                 Run(top, "padma", flip=True)], 48 if hi else 20, mat, continuous=False)


def stairs(tm: trim.TrimMesh, mat: str, detail: float) -> None:
    """Double stairway (sopana) on the south side rising tangentially to a central landing."""
    y_out, y_in = -R_DRUM - 1.35, -R_DRUM + 1.4
    n = 11
    rise = (DRUM_TOP - GROUND) / n
    tread = 0.32
    x_land = 1.15
    for sx in (-1, 1):
        for k in range(n):
            x_inner = sx * (x_land + (n - 1 - k) * tread)
            x_outer = x_inner + sx * tread
            ztop = GROUND + rise * (k + 1)
            cx = (x_inner + x_outer) / 2
            tm.box(mat, (cx, (y_out + y_in) / 2, (GROUND - 0.02 + ztop) / 2), (tread, y_in - y_out, ztop - GROUND + 0.02),
                   bands={"-y": "ashlar_base", "+x": "ashlar", "-x": "ashlar"})
        # balustrade along the outer edge, rising with the flight
        x0 = sx * (x_land + n * tread)
        x1 = sx * x_land
        tm.path([Run(rect(0.2, 0.75, 0.0, 0.0)[k:k + 2], b) for k, b in ((0, "ashlar"), (1, "bead_reel"), (2, "ashlar_base"), (3, "ashlar"))],
                [(x0, y_out + 0.1, GROUND), (x1, y_out + 0.1, DRUM_TOP)], up=(0, 0, 1), mat=mat, caps=True)
    tm.box(mat, (0, (y_out + y_in) / 2, (GROUND - 0.02 + DRUM_TOP) / 2), (2 * x_land, y_in - y_out, DRUM_TOP - GROUND + 0.02),
           bands={"-y": "ashlar", "+x": "ashlar", "-x": "ashlar"})
    tm.path([Run(rect(0.2, 0.75, 0.0, 0.0)[k:k + 2], b) for k, b in ((0, "ashlar"), (1, "bead_reel"), (2, "medallion_frieze"), (3, "ashlar"))],
            [(-x_land, y_out + 0.1, DRUM_TOP), (x_land, y_out + 0.1, DRUM_TOP)], up=(0, 0, 1), mat=mat, caps=True)


def build(detail: float, name: str):
    tm = trim.TrimMesh(SHEET)
    hi = detail >= 0.75
    # paved path + platform edge
    tm.ring([Run([(R_PAVE, -0.05), (R_PAVE, GROUND)], "ashlar_base")] + courses(R_PAVE, R_DRUM + 0.1, GROUND),
            160 if hi else 56, "pave")
    gate = math.asin(1.92 / R_VED)
    vedika(tm, "stone", R_VED, GROUND, VED_H + 0.35, SOUTH + gate, SOUTH + TAU - gate, detail)
    torana(tm, "stone", detail)
    drum(tm, "stone", "pave", detail)
    stairs(tm, "stone", detail)
    zt = dome(tm, "dome", detail)
    harmika_chhatra(tm, "stone", zt, detail)
    core.log(f"{name}: ~{tm.triangle_estimate()} triangles before export")
    return tm


# ------------------------------------------------------------------------------------- materials
def make_materials(macro_png: str | None, macro_ref: str | None) -> dict[str, bpy.types.Material]:
    return {
        "stone": materials.from_material_set(dep, "stupa_stone", tint="#ffffff", macro=macro_png, macro_ref=macro_ref),
        "dome": materials.from_material_set(dep, "stupa_dome", tint="#d9c6bd", macro=macro_png, macro_ref=macro_ref),
        "pave": materials.from_material_set(dep, "stupa_paving", tint="#e9d6c8", macro=macro_png, macro_ref=macro_ref),
    }


def grime_material(z_ground: float) -> bpy.types.Material:
    """Emission shader for the macro G channel (albedo multiplier): rising damp near the ground,
    rain streaks on vertical faces, darker crevices (local AO), subtle large-scale variation."""
    from lib.nodes import NodeBuilder

    mat = bpy.data.materials.new("macro_grime")
    nb = NodeBuilder(mat)
    pos = nb.geometry("Position")
    nrm = nb.geometry("Normal")
    sep_p = nb.node("ShaderNodeSeparateXYZ")
    nb.link(pos, sep_p.inputs[0])
    sep_n = nb.node("ShaderNodeSeparateXYZ")
    nb.link(nrm, sep_n.inputs[0])
    # rising damp: dark band up to ~0.5-0.9 m with a noisy upper edge
    edge_noise = nb.noise(pos, scale=1.6, detail=4).outputs["Fac"]
    damp_h = nb.math("ADD", nb.math("MULTIPLY", edge_noise, 0.5), 0.35)
    damp = nb.map_range(nb.math("SUBTRACT", sep_p.outputs[2], z_ground), 0.0, 1.0, 1.0, 0.0)
    damp = nb.math("MULTIPLY", nb.math("GREATER_THAN", damp_h, nb.math("SUBTRACT", sep_p.outputs[2], z_ground)), damp)
    # rain streaks: noise stretched along Z on vertical faces
    mapping = nb.node("ShaderNodeMapping")
    nb.link(pos, mapping.inputs["Vector"])
    mapping.inputs["Scale"].default_value = (7.0, 7.0, 0.35)
    streak = nb.noise(mapping.outputs[0], scale=3.0, detail=3).outputs["Fac"]
    streak = nb.map_range(streak, 0.5, 0.75, 0.0, 1.0)
    vertical = nb.map_range(nb.math("ABSOLUTE", sep_n.outputs[2]), 0.6, 0.2, 0.0, 1.0)
    streak = nb.math("MULTIPLY", streak, vertical)
    # crevice dirt from local AO
    ao_local = nb.ao(distance=0.35, samples=8)
    crev = nb.map_range(ao_local, 0.4, 1.0, 1.0, 0.0)
    # combine into an albedo multiplier (1 = clean)
    big = nb.noise(pos, scale=0.25, detail=3).outputs["Fac"]
    dirt = nb.math("ADD", nb.math("MULTIPLY", damp, 0.32), nb.math("MULTIPLY", streak, 0.16))
    dirt = nb.math("ADD", dirt, nb.math("MULTIPLY", crev, 0.22))
    dirt = nb.math("ADD", dirt, nb.map_range(big, 0.3, 0.7, -0.04, 0.08))
    g = nb.map_range(dirt, 0.0, 1.0, 1.0, 0.0)
    comb = nb.node("ShaderNodeCombineColor")
    nb.link(g, comb.inputs[0])
    nb.link(g, comb.inputs[1])
    nb.link(g, comb.inputs[2])
    em = nb.node("ShaderNodeEmission")
    nb.link(comb.outputs[0], em.inputs["Color"])
    nb.links.new(em.outputs[0], nb.output.inputs["Surface"])
    return mat


def bake_macro(obj: bpy.types.Object, res: int, set_name: str) -> str:
    """Macro map on UV2: R = AO (2.5 m), G = albedo multiplier (grime), B = 1."""
    M.lightmap_uv(obj, "UVLightmap", margin=0.003)
    obj.data.uv_layers.active = obj.data.uv_layers["UVLightmap"]
    bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, -0.04))
    ground = bpy.context.active_object
    ground.name = "bake_ground"
    bake.configure(samples=ctx.samples(96, 12), margin=8)
    world = bpy.context.scene.world or bpy.data.worlds.new("bake_world")
    bpy.context.scene.world = world
    world.light_settings.distance = 2.5
    img = bake.new_image(f"{set_name}_ao", res, res)
    ao = bake.bake(obj, "AO", img, samples=ctx.samples(96, 12), uv_layer="UVLightmap")[..., 0]
    # grime: temporarily swap every slot to the emission shader
    saved = list(obj.data.materials)
    gm = grime_material(GROUND)
    for i in range(len(saved)):
        obj.data.materials[i] = gm
    img2 = bake.new_image(f"{set_name}_grime", res, res)
    grime = bake.bake(obj, "EMIT", img2, samples=ctx.samples(16, 4), uv_layer="UVLightmap")[..., 0]
    for i, m in enumerate(saved):
        obj.data.materials[i] = m
    bpy.data.objects.remove(ground)
    obj.data.uv_layers.active = obj.data.uv_layers["UVMap"]
    ao = tg.blur(np.clip(ao, 0, 1), 0.7)
    grime = tg.blur(np.clip(grime, 0, 1), 0.7)
    macro = np.stack([ao, grime, np.ones_like(ao)], axis=-1)
    path = ctx.path(f"{set_name}.png")
    tg.write_png(path, macro, 8)
    ctx.add_file(f"{set_name}_macro", path, set=set_name, map="macro", colorSpace="linear")
    core.log(f"macro {set_name}: AO mean {float(ao.mean()):.3f}, grime mean {float(grime.mean()):.3f}")
    return str(path)


# ------------------------------------------------------------------------------------- build LODs
LODS = [(1.0, "lod0", "macro", ctx.res(2048, 512)), (0.4, "lod1", "macro_lod1", ctx.res(512, 256))]
lod_info = []
for detail, tag, set_name, mres in LODS:
    core.reset_scene()
    rng = core.seed_all(core.stable_seed(ctx.id, "layout"))  # identical layout for every LOD
    tm = build(detail, tag)
    mats = make_materials(None, None)
    obj = tm.build(f"stupa_sanchi_{tag}", mats, smooth_angle=35.0)[0]
    with core.timer(f"macro bake {tag} {mres}px"):
        macro_png = bake_macro(obj, mres, set_name)
    # rebind preview materials with the macro (also carries the runtime extras)
    pm = make_materials(macro_png, f"{ctx.id}:{set_name}")
    for i, m in enumerate(obj.data.materials):
        key = {"stupa_stone": "stone", "stupa_dome": "dome", "stupa_paving": "pave"}[m.name.split(".")[0]]
        obj.data.materials[i] = pm[key]
    info = export.gltf(ctx.path(f"{ctx.id}_{tag}.glb"), [obj], extras={"id": ctx.id, "lod": tag})
    ctx.add_file(tag, ctx.path(f"{ctx.id}_{tag}.glb"), triangles=info["triangles"])
    lod_info.append(info)
    if tag == "lod0" and ctx.preview:
        res = (1280, 720) if not ctx.draft else (640, 360)
        render.setup_world(sun_elevation=24, sun_azimuth=230, strength=0.6, aerosol=2.2)
        render.add_sun(24, 230, 4.4, angle_deg=0.6, color="#ffe4c4")
        render.add_ground(500.0, "#6e5a44", 0.95, z=-0.05)
        render.look_at_camera((-17.5, -24.0, 5.2), (0.0, -2.0, 4.6), lens=32)
        ctx.add_file("preview", render.render(ctx.path("preview.png"), res, ctx.samples(96, 16)))
        render.look_at_camera((-3.2, -16.6, 2.0), (0.0, -10.6, 5.6), lens=30)
        ctx.add_file("preview_torana", render.render(ctx.path("preview_torana.png"), res, ctx.samples(96, 16)))
        render.look_at_camera((5.5, -13.2, 1.7), (2.0, -9.0, 1.4), lens=40, fstop=5.6)
        ctx.add_file("preview_railing", render.render(ctx.path("preview_railing.png"), res, ctx.samples(96, 16)))

ctx.meta.update(
    bounds=lod_info[0]["bounds"],
    lodDistances=[0, 110],
    minLod={"ultra": 0, "high": 0, "mobile": 0},
    materialSets=["sandstone_carved_red"],
    clips=[],
    footprintMeters=[2 * R_PAVE, 2 * R_PAVE],
    triangles=[i["triangles"] for i in lod_info],
    description="Sanchi-style stupa with carved torana, railings, drum, stairway, harmika and chhatras "
                "(trim-sheet sandstone, macro AO/grime).",
)
ctx.finish()
