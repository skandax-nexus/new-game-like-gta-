"""
Package-local helper (pipeline_test): a low-poly spear-bearer test soldier - rig, body, props, vertex colors
and the idle / walk / attack clips - shared by vat_test_dummy (VAT) and skin_test_character (skinned GLB).
OWNER: Technical Artist G (TA-07). Not an asset (leading underscore); hashed into its users by the runner.

Proportions follow ART_BIBLE §9.1 (1.75 m, ~7.5 heads); kit after §9.2 spearmen: quilted jacket, antariya,
turban, 2.6 m bamboo spear with an iron head, round hide shield. Team mask (vertex color R) on the turban,
sash and shield face - 25-35 % of the visible surface (ASSET_LIST WP5).
Rig: the standard bone names of lib/rig.py, authored with the arms hanging (rest = natural stance) so poses
are small local rotations. Conventions measured in Blender: legs/arms (pointing down) +X swings backwards
(+Y), spine/chest (pointing up) +X bends forward, Y twists.
"""
from __future__ import annotations

import math
from typing import Callable

import bpy
import numpy as np

from lib import anim, mesh as M, rig

PARTS = ["skin", "cloth", "team", "metal", "wood", "leather"]
PART = {p: i for i, p in enumerate(PARTS)}
#: Preview / fallback colors per part (linear-ish sRGB hex, ART_BIBLE §9.4 palette: skin, bleached cotton,
#: saffron team dye, iron, bamboo, hide).
PART_COLORS = {"skin": "#8f5d40", "cloth": "#d9cfbb", "team": "#e0a040", "metal": "#4a4a4c", "wood": "#a4834f",
               "leather": "#6b4a32"}


def bones(height: float = 1.75) -> list[rig.BoneSpec]:
    s = height / 1.75

    def v(x: float, y: float, z: float) -> tuple[float, float, float]:
        return (x * s, y * s, z * s)

    out = [
        rig.BoneSpec("root", v(0, 0, 0), v(0, 0.25, 0), None, deform=False),
        rig.BoneSpec("hips", v(0, 0, 0.95), v(0, 0, 1.08), "root"),
        rig.BoneSpec("spine", v(0, 0, 1.08), v(0, 0, 1.25), "hips", connect=True),
        rig.BoneSpec("chest", v(0, 0, 1.25), v(0, 0, 1.45), "spine", connect=True),
        rig.BoneSpec("neck", v(0, 0, 1.45), v(0, 0, 1.56), "chest", connect=True),
        rig.BoneSpec("head", v(0, 0, 1.56), v(0, 0, 1.75), "neck", connect=True),
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        out += [
            rig.BoneSpec(f"shoulder.{side}", v(0.03 * sx, 0, 1.42), v(0.17 * sx, 0, 1.42), "chest"),
            rig.BoneSpec(f"upper_arm.{side}", v(0.19 * sx, 0, 1.42), v(0.235 * sx, 0.015, 1.14), f"shoulder.{side}"),
            rig.BoneSpec(f"forearm.{side}", v(0.235 * sx, 0.015, 1.14), v(0.26 * sx, -0.02, 0.89), f"upper_arm.{side}", connect=True),
            rig.BoneSpec(f"hand.{side}", v(0.26 * sx, -0.02, 0.89), v(0.265 * sx, -0.03, 0.80), f"forearm.{side}", connect=True),
            rig.BoneSpec(f"thigh.{side}", v(0.10 * sx, 0, 0.95), v(0.10 * sx, 0, 0.52), "hips"),
            rig.BoneSpec(f"shin.{side}", v(0.10 * sx, 0, 0.52), v(0.10 * sx, 0.02, 0.09), f"thigh.{side}", connect=True),
            rig.BoneSpec(f"foot.{side}", v(0.10 * sx, 0.02, 0.09), v(0.10 * sx, -0.12, 0.03), f"shin.{side}", connect=True),
            rig.BoneSpec(f"toe.{side}", v(0.10 * sx, -0.12, 0.03), v(0.10 * sx, -0.19, 0.03), f"foot.{side}", connect=True),
        ]
    out.append(rig.BoneSpec("weapon.R", v(-0.265, -0.03, 0.84), v(-0.265, -0.03, 1.0), "hand.R", deform=False))
    out.append(rig.BoneSpec("shield.L", v(0.30, -0.10, 1.0), v(0.30, -0.25, 1.0), "forearm.L", deform=False))
    return out


# ------------------------------------------------------------------------------------- geometry
class _Builder:
    """Accumulates mesh pieces with per-vertex part / team / cloth / rigid-bone labels."""

    def __init__(self) -> None:
        self.verts: list[np.ndarray] = []
        self.faces: list[list[int]] = []
        self.part: list[np.ndarray] = []
        self.team: list[np.ndarray] = []
        self.cloth: list[np.ndarray] = []
        self.bone: list[list[str | None]] = []
        self.n = 0

    def add(self, v: np.ndarray, f: list[list[int]], part: str, team: float = 0.0, cloth: float = 0.0,
            bone: str | None = None) -> None:
        self.verts.append(v.astype(np.float64))
        self.faces += [[i + self.n for i in face] for face in f]
        k = len(v)
        self.part.append(np.full(k, PART[part], np.int32))
        self.team.append(np.full(k, team, np.float32))
        self.cloth.append(np.full(k, cloth, np.float32))
        self.bone.append([bone] * k)
        self.n += k

    def tube(self, a, b, r0: float, r1: float, sides: int, part: str, rings: int = 1, team: float = 0.0,
             cloth: float = 0.0, bone: str | None = None, ellipse: float = 1.0, caps: bool = True) -> None:
        """Tapered cylinder from a to b (radius r0 -> r1), `rings` segments, elliptical in the local x."""
        a = np.asarray(a, np.float64)
        b = np.asarray(b, np.float64)
        axis = b - a
        L = float(np.linalg.norm(axis))
        w = axis / max(L, 1e-9)
        ref = np.array([0.0, 0.0, 1.0]) if abs(w[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        u = np.cross(w, ref)
        u /= np.linalg.norm(u)
        vv = np.cross(w, u)
        if abs(w[2]) >= 0.9:  # vertical parts: keep the ellipse major axis on world X (shoulders)
            u, vv = np.array([1.0, 0.0, 0.0]), np.array([0.0, 1.0, 0.0])
        verts = []
        for k in range(rings + 1):
            t = k / rings
            r = r0 + (r1 - r0) * t
            c = a + axis * t
            for i in range(sides):
                ang = 2 * math.pi * i / sides
                verts.append(c + u * math.cos(ang) * r * ellipse + vv * math.sin(ang) * r)
        faces = []
        for k in range(rings):
            for i in range(sides):
                j = (i + 1) % sides
                faces.append([k * sides + i, k * sides + j, (k + 1) * sides + j, (k + 1) * sides + i])
        if caps:
            verts.append(a)
            verts.append(b)
            ca, cb = len(verts) - 2, len(verts) - 1
            for i in range(sides):
                j = (i + 1) % sides
                faces.append([ca, j, i])
                faces.append([cb, rings * sides + i, rings * sides + j])
        self.add(np.array(verts), faces, part, team, cloth, bone)

    def sphere(self, c, r: float, part: str, seg: int = 10, rings: int = 7, scale=(1.0, 1.0, 1.0), team: float = 0.0,
               cloth: float = 0.0, bone: str | None = None) -> None:
        c = np.asarray(c, np.float64)
        verts = [c + np.array([0, 0, -r * scale[2]])]
        for k in range(1, rings):
            th = math.pi * k / rings
            for i in range(seg):
                ph = 2 * math.pi * i / seg
                verts.append(c + np.array([math.sin(th) * math.cos(ph) * r * scale[0], math.sin(th) * math.sin(ph) * r * scale[1],
                                           -math.cos(th) * r * scale[2]]))
        verts.append(c + np.array([0, 0, r * scale[2]]))
        faces = []
        top = len(verts) - 1
        for i in range(seg):
            j = (i + 1) % seg
            faces.append([0, 1 + j, 1 + i])
        for k in range(rings - 2):
            for i in range(seg):
                j = (i + 1) % seg
                a0, a1 = 1 + k * seg + i, 1 + k * seg + j
                b0, b1 = 1 + (k + 1) * seg + i, 1 + (k + 1) * seg + j
                faces.append([a0, a1, b1, b0])
        last = 1 + (rings - 2) * seg
        for i in range(seg):
            j = (i + 1) % seg
            faces.append([last + i, last + j, top])
        self.add(np.array(verts), faces, part, team, cloth, bone)

    def box(self, c, size, part: str, bone: str | None = None, team: float = 0.0) -> None:
        c = np.asarray(c, np.float64)
        hx, hy, hz = (s / 2 for s in size)
        v = np.array([[x, y, z] for z in (-hz, hz) for y in (-hy, hy) for x in (-hx, hx)]) + c
        f = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
        self.add(v, f, part, team, 0.0, bone)

    def object(self, name: str) -> bpy.types.Object:
        verts = np.concatenate(self.verts)
        obj = M.from_pydata(name, verts, self.faces, smooth=True)
        return obj


def build_body(detail: int = 1) -> tuple[bpy.types.Object, dict[str, np.ndarray], list[str | None]]:
    """Body + kit mesh (Blender axes, facing -Y). detail 1 = crowd LOD0 (~700 tris), 2 = close-up."""
    b = _Builder()
    s8 = 6 + 2 * detail
    s6 = 4 + 2 * detail
    # head, turban (team), neck
    b.sphere((0, -0.005, 1.645), 0.098, "skin", seg=s8, rings=5 + detail, scale=(0.92, 1.0, 1.08))
    b.tube((0, 0.005, 1.665), (0, 0.0, 1.765), 0.112, 0.096, s8, "team", rings=2, team=1.0, cloth=0.85)
    b.sphere((0, -0.03, 1.78), 0.05, "team", seg=s6, rings=4, team=1.0, cloth=0.85)  # forward knot (Suvarna)
    b.tube((0, 0.0, 1.47), (0, 0.0, 1.57), 0.045, 0.042, s6, "skin", caps=False)
    # torso: quilted jacket (cloth), sash (team), antariya skirt (cloth)
    b.tube((0, 0.0, 1.02), (0, 0.0, 1.47), 0.15, 0.175, s8, "cloth", rings=3, cloth=0.25, ellipse=1.18)
    b.tube((0, 0.0, 0.98), (0, 0.0, 1.07), 0.162, 0.156, s8, "team", team=1.0, cloth=0.55, ellipse=1.14)
    b.tube((0, 0.0, 0.99), (0, 0.0, 0.56), 0.165, 0.205, s8, "cloth", rings=2, cloth=0.7, ellipse=1.1, bone="skirt")
    # arms
    for side, sx in (("L", 1.0), ("R", -1.0)):
        b.sphere((0.185 * sx, 0, 1.415), 0.062, "cloth", seg=s6, rings=4, cloth=0.25)
        b.tube((0.19 * sx, 0, 1.42), (0.235 * sx, 0.015, 1.14), 0.052, 0.044, s6, "cloth", cloth=0.25)
        b.tube((0.235 * sx, 0.015, 1.14), (0.26 * sx, -0.02, 0.89), 0.042, 0.034, s6, "skin")
        b.box((0.263 * sx, -0.025, 0.845), (0.05, 0.075, 0.1), "skin")
        # legs: thigh under the skirt, shin, foot
        b.tube((0.10 * sx, 0, 0.92), (0.10 * sx, 0, 0.52), 0.075, 0.055, s6, "skin")
        b.tube((0.10 * sx, 0, 0.52), (0.10 * sx, 0.02, 0.10), 0.052, 0.038, s6, "skin")
        b.box((0.10 * sx, -0.06, 0.04), (0.085, 0.24, 0.07), "leather")
    # spear: bamboo shaft + iron head, held upright in the right hand (rigid to hand.R)
    b.tube((-0.265, -0.03, 0.06), (-0.265, -0.03, 2.48), 0.017, 0.015, s6, "wood", bone="hand.R")
    b.tube((-0.265, -0.03, 2.48), (-0.265, -0.03, 2.72), 0.03, 0.002, s6, "metal", bone="hand.R")
    # round hide shield on the left forearm (team-painted face, rigid to forearm.L)
    sh = 0.3
    b.tube((0.31, -0.075, 1.0), (0.31, -0.13, 1.0), sh, sh * 0.92, 10 + 2 * detail, "team", team=0.9, cloth=0.4,
           bone="forearm.L")
    b.sphere((0.31, -0.14, 1.0), 0.06, "metal", seg=s6, rings=4, scale=(1.0, 0.5, 1.0), bone="forearm.L")
    obj = b.object("dummy")
    labels = {"part": np.concatenate(b.part), "team": np.concatenate(b.team), "cloth": np.concatenate(b.cloth)}
    rigid = [x for lst in b.bone for x in lst]
    return obj, labels, rigid


def skin(obj: bpy.types.Object, arm: bpy.types.Object, rigid: list[str | None]) -> None:
    """Smooth proximity weights for the body, rigid weights for props bound to one bone, and a hips ->
    thigh gradient for the antariya skirt (it follows the legs at the hem without tearing at the waist)."""
    rig.skin_proximity(obj, arm, blend=0.045)
    groups = {vg.name: vg for vg in obj.vertex_groups}
    co = np.array([v.co[:] for v in obj.data.vertices])
    for i, bname in enumerate(rigid):
        if bname is None:
            continue
        for vg in groups.values():
            vg.remove([i])
        if bname == "skirt":
            t = float(np.clip((0.99 - co[i, 2]) / 0.43, 0.0, 1.0))
            w = 0.6 * t * t
            side = "L" if co[i, 0] >= 0 else "R"
            x = abs(co[i, 0]) / 0.2
            groups["hips"].add([i], 1.0 - w * min(1.0, x + 0.25), "REPLACE")
            groups[f"thigh.{side}"].add([i], w * min(1.0, x + 0.25), "REPLACE")
        else:
            groups[bname].add([i], 1.0, "REPLACE")


def build(height: float = 1.75, detail: int = 1) -> tuple[bpy.types.Object, bpy.types.Object, dict[str, np.ndarray]]:
    arm = rig.create_armature("dummy_rig", bones(height))
    body, labels, rigid = build_body(detail)
    if height != 1.75:
        body.scale = (height / 1.75,) * 3
        M.apply_transform(body)
    M.triangulate(body)
    skin(body, arm, rigid)
    return arm, body, labels


# ------------------------------------------------------------------------------------- clips (30 fps)
def _sin(p: float, k: float = 1.0, off: float = 0.0) -> float:
    return math.sin(2 * math.pi * (k * p + off))


def idle_pose(p: float) -> dict:
    br = _sin(p)
    return {
        # hips location is bone-local: (x side, y up, z forward)
        "hips": {"loc": (0.006 * _sin(p, 1, 0.25), 0.004 * br, 0)},
        "spine": {"rot": (0.8 * br, 0, 0)},
        "chest": {"rot": (1.4 * br, 0, 0)},
        "head": {"rot": (-1.0 * br, 4.0 * _sin(p, 1, 0.1), 0)},
        "upper_arm.R": {"rot": (-6 + 1.2 * br, 0, 0)},
        "forearm.R": {"rot": (-14, 0, 0)},
        "upper_arm.L": {"rot": (-22 + 1.0 * br, 0, -6)},
        "forearm.L": {"rot": (-58, 0, 0)},
        "thigh.L": {"rot": (0, 0, 2)},
        "thigh.R": {"rot": (0, 0, -2)},
    }


# Leg geometry of bones() (Blender: hip joint z 0.95, knee 0.52, ankle 0.09) for the walk IK.
_LT = 0.43
_LS = math.hypot(0.02, 0.43)
_SHIN_REST = math.atan2(0.02, 0.43)
_ANKLE_Z = 0.09
WALK_STEP = 0.35  # half of the planted-foot travel: stride (one cycle) = 4 x 0.35 = 1.4 m


def _smooth(t: float) -> float:
    return t * t * (3 - 2 * t)


def _foot(q: float, stance: float = 0.56) -> tuple[float, float, float]:
    """Ankle target relative to the hip (y backwards +, lift), and swing pitch, at gait phase q."""
    if q < stance:
        t = q / stance
        return -WALK_STEP + 2 * WALK_STEP * t, 0.0, 0.0
    t = (q - stance) / (1 - stance)
    return WALK_STEP - 2 * WALK_STEP * _smooth(t), 0.12 * math.sin(math.pi * t), 18.0 * math.sin(math.pi * t) - 6.0 * t


def _leg_ik(hz: float, ya: float, za: float) -> tuple[float, float]:
    """Thigh / shin pitch (degrees, +X = backwards) for an ankle at (ya, za) below a hip at height hz."""
    dy, dz = ya, hz - za
    d = min(math.hypot(dy, dz), (_LT + _LS) * 0.9995)
    phi = math.atan2(dy, dz)
    gamma = math.acos(max(-1.0, min(1.0, (_LT * _LT + d * d - _LS * _LS) / (2 * _LT * d))))
    knee = math.acos(max(-1.0, min(1.0, (_LT * _LT + _LS * _LS - d * d) / (2 * _LT * _LS))))
    alpha = phi - gamma
    beta = math.pi - knee
    return math.degrees(alpha), math.degrees(beta - _SHIN_REST)


def walk_pose(p: float) -> dict:
    """In-place walk with planted feet: ankles follow a stance line (moving backwards at walking speed) and
    a lifted swing arc; the hips ride as high as the stance leg allows; 2-bone IK gives thigh / knee."""
    ql, qr = p % 1.0, (p + 0.5) % 1.0
    fl = _foot(ql)
    fr = _foot(qr)
    reach = (_LT + _LS) * 0.985
    hz = min(math.sqrt(max(reach * reach - f[0] * f[0], 0.0)) + _ANKLE_Z for f in (fl, fr) if f[1] == 0.0)
    pose: dict = {}
    for side, f in (("L", fl), ("R", fr)):
        a, b = _leg_ik(hz, f[0], _ANKLE_Z + f[1])
        pose[f"thigh.{side}"] = {"rot": (a, 0, 1.5 if side == "L" else -1.5)}
        pose[f"shin.{side}"] = {"rot": (b, 0, 0)}
        pose[f"foot.{side}"] = {"rot": (-(a + b) + f[2], 0, 0)}
    c = math.cos(2 * math.pi * p)
    s = _sin(p)
    pose["hips"] = {"loc": (0.018 * s, hz - 0.95, 0), "rot": (0, 4.0 * c, 0)}
    pose["spine"] = {"rot": (3.0, -2.5 * c, 0)}
    pose["chest"] = {"rot": (2.0, -2.0 * c, 0)}
    pose["head"] = {"rot": (-3.0, 2.0 * c, 0)}
    pose["upper_arm.R"] = {"rot": (-6 - 7.0 * c, 0, 0)}
    pose["forearm.R"] = {"rot": (-14, 0, 0)}
    pose["upper_arm.L"] = {"rot": (-22 + 7.0 * c, 0, -6)}
    pose["forearm.L"] = {"rot": (-58, 0, 0)}
    return pose


ATTACK_KEYS = {
    # frame: pose (30 fps). Wind-up 1-8, thrust 8-12 (hit window), hold 12-15, recover 15-24.
    1: idle_pose(0.0),
    8: {"hips": {"loc": (0, -0.02, -0.05), "rot": (0, -14, 0)}, "chest": {"rot": (-4, -18, 0)},
        "upper_arm.R": {"rot": (32, 0, 18)}, "forearm.R": {"rot": (-75, 0, 0)}, "upper_arm.L": {"rot": (-38, 0, -8)},
        "forearm.L": {"rot": (-62, 0, 0)}, "thigh.L": {"rot": (-24, 0, 2)}, "shin.L": {"rot": (18, 0, 0)},
        "thigh.R": {"rot": (14, 0, -2)}, "shin.R": {"rot": (16, 0, 0)}, "head": {"rot": (-2, 10, 0)}},
    12: {"hips": {"loc": (0, -0.07, 0.1), "rot": (0, 16, 0)}, "chest": {"rot": (12, 22, 0)},
         "upper_arm.R": {"rot": (-78, 0, 6)}, "forearm.R": {"rot": (-12, 0, 0)}, "upper_arm.L": {"rot": (-30, 0, -10)},
         "forearm.L": {"rot": (-55, 0, 0)}, "thigh.L": {"rot": (-36, 0, 2)}, "shin.L": {"rot": (22, 0, 0)},
         "thigh.R": {"rot": (22, 0, -2)}, "shin.R": {"rot": (8, 0, 0)}, "head": {"rot": (6, -12, 0)}},
    15: {"hips": {"loc": (0, -0.065, 0.09), "rot": (0, 14, 0)}, "chest": {"rot": (10, 20, 0)},
         "upper_arm.R": {"rot": (-74, 0, 6)}, "forearm.R": {"rot": (-14, 0, 0)}, "upper_arm.L": {"rot": (-30, 0, -10)},
         "forearm.L": {"rot": (-55, 0, 0)}, "thigh.L": {"rot": (-34, 0, 2)}, "shin.L": {"rot": (22, 0, 0)},
         "thigh.R": {"rot": (21, 0, -2)}, "shin.R": {"rot": (9, 0, 0)}, "head": {"rot": (5, -11, 0)}},
    24: idle_pose(0.0),
}

#: Attack frame data (seconds, for clipEvents): thrust contact window, cancel point.
ATTACK_EVENTS = [{"type": "hit_start", "time": 9 / 30}, {"type": "hit_end", "time": 13 / 30},
                 {"type": "cancel", "time": 18 / 30}, {"type": "sfx", "time": 8 / 30, "data": "sword_light"}]
WALK_EVENTS = [{"type": "footstep", "time": 0.0, "data": "L"}, {"type": "footstep", "time": 16 / 30, "data": "R"}]


def add_clips(arm: bpy.types.Object, die: bool = False) -> list[str]:
    anim.cycle(arm, "idle", 48, idle_pose, samples=8)
    anim.cycle(arm, "walk", 32, walk_pose, samples=32)
    clip = anim.new_clip(arm, "attack", 24)
    for frame, pose in ATTACK_KEYS.items():
        anim.keys(clip, arm, frame, _complete(pose))
    anim.finish(clip, arm)
    names = ["idle", "walk", "attack"]
    if die:
        d = anim.new_clip(arm, "die", 36)
        anim.keys(d, arm, 1, _complete(idle_pose(0.0)))
        anim.keys(d, arm, 12, _complete({"hips": {"loc": (0, -0.35, -0.05), "rot": (0, 8, 0)}, "chest": {"rot": (25, 0, 0)},
                                         "thigh.L": {"rot": (-70, 0, 4)}, "shin.L": {"rot": (100, 0, 0)},
                                         "thigh.R": {"rot": (-60, 0, -4)}, "shin.R": {"rot": (95, 0, 0)},
                                         "upper_arm.R": {"rot": (-30, 0, 20)}, "head": {"rot": (20, 0, 0)}}))
        anim.keys(d, arm, 36, _complete({"hips": {"loc": (0, -0.8, -0.35), "rot": (0, 10, 0)}, "chest": {"rot": (70, 0, 0)},
                                         "thigh.L": {"rot": (-80, 0, 4)}, "shin.L": {"rot": (110, 0, 0)},
                                         "thigh.R": {"rot": (-75, 0, -4)}, "shin.R": {"rot": (105, 0, 0)},
                                         "upper_arm.R": {"rot": (-60, 0, 40)}, "upper_arm.L": {"rot": (-60, 0, -30)},
                                         "head": {"rot": (30, 0, 0)}}))
        anim.finish(d, arm)
        names.append("die")
    return names


_POSED = ["hips", "spine", "chest", "neck", "head", "upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R",
          "thigh.L", "thigh.R", "shin.L", "shin.R", "foot.L", "foot.R"]


def _complete(pose: dict) -> dict:
    """Key every posed bone in every key (missing bones -> rest), so keys never inherit stray values."""
    out = {}
    for name in _POSED:
        ch = dict(pose.get(name, {}))
        ch.setdefault("rot", (0, 0, 0))
        if name == "hips":
            ch.setdefault("loc", (0, 0, 0))
        out[name] = ch
    return out


def preview_material(name: str = "dummy_preview") -> bpy.types.Material:
    """Cycles preview material: part palette from vertex color B, team saffron by R (matches the runtime)."""
    from lib.nodes import NodeBuilder
    from lib.texgen import hex_to_linear

    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    col = nb.attribute("Col")
    sep = nb.separate(col)
    # (part id + 0.5) / N: stop i sits at i / N so constant interpolation never rounds into part i - 1.
    idx = nb.math("MULTIPLY_ADD", sep.outputs[2], 255.0 / len(PARTS), 0.5 / len(PARTS))
    stops = []
    for i, p in enumerate(PARTS):
        c = hex_to_linear(PART_COLORS[p])
        stops.append((i / len(PARTS), (float(c[0]), float(c[1]), float(c[2]), 1.0)))
    base = nb.ramp(idx, stops, interp="CONSTANT")
    nb.principled(base_color=base, roughness=0.75)
    return mat


Pose = Callable[[float], dict]
