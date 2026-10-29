"""
Keyframe animation clips with standard names (Blender 4.4+/5.x slotted actions). OWNER: Technical Art Director.

    clip = new_clip(arm, "walk", frames=32)        action bound to the armature (slot created), loops by default
    key(clip, arm, frame, "thigh.L", rot=(20, 0, 0), loc=None)   pose key (euler DEGREES or quaternion)
    keys(clip, arm, frame, {"thigh.L": {"rot": (20,0,0)}, ...})
    cycle(arm, "walk", frames=32, pose_fn=lambda phase: {...}, samples=8)   procedural cyclic clip
    finish(clip, arm)                               close loops (last key == first), linear/bezier, stash in NLA
    clips_of(arm)                                   names of stashed clips

CLIP NAMES (runtime + VAT baking look clips up by these exact names; loops marked *):
    idle* walk* run* sprint* turn_l turn_r strafe_l* strafe_r* interact talk*
    attack attack_heavy attack_combo_1 attack_combo_2 block* parry dodge hit stagger
    shoot reload brace* charge* work* cheer* rout* die dead*   (custom clips: "x_<name>")
Clip length in frames at the scene fps (30 by default; seconds = frames / fps). A looping clip's
last frame equals its first so the runtime can wrap without a pop.
"""
from __future__ import annotations

import math
from typing import Callable, Mapping, Sequence

import bpy
from bpy_extras import anim_utils
from mathutils import Euler, Quaternion

LOOPING = {"idle", "walk", "run", "sprint", "strafe_l", "strafe_r", "talk", "block", "brace", "charge", "work",
           "cheer", "rout", "dead"}
ONE_SHOT = {"turn_l", "turn_r", "interact", "attack", "attack_heavy", "attack_combo_1", "attack_combo_2", "parry",
            "dodge", "hit", "stagger", "shoot", "reload", "die"}
STANDARD = LOOPING | ONE_SHOT


def validate_name(name: str) -> None:
    if name not in STANDARD and not name.startswith("x_"):
        raise ValueError(f"clip '{name}' is not a standard clip name (see lib/anim.py) - prefix custom clips with x_")


class Clip:
    def __init__(self, action: bpy.types.Action, frames: int, loop: bool) -> None:
        self.action = action
        self.frames = frames
        self.loop = loop

    @property
    def name(self) -> str:
        return self.action.name


def new_clip(arm: bpy.types.Object, name: str, frames: int, loop: bool | None = None) -> Clip:
    validate_name(name)
    old = bpy.data.actions.get(name)
    if old is not None:
        bpy.data.actions.remove(old)
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    is_loop = (name in LOOPING) if loop is None else loop
    action["samrajya_loop"] = bool(is_loop)
    action["samrajya_frames"] = int(frames)
    return Clip(action, frames, is_loop)


def _ensure_active(clip: Clip, arm: bpy.types.Object) -> None:
    if arm.animation_data is None:
        arm.animation_data_create()
    if arm.animation_data.action != clip.action:
        arm.animation_data.action = clip.action


def key(clip: Clip, arm: bpy.types.Object, frame: float, bone: str, rot: Sequence[float] | Quaternion | None = None,
        loc: Sequence[float] | None = None, scale: Sequence[float] | None = None) -> None:
    """Key one pose bone. `rot`: euler degrees (XYZ, bone local) or a Quaternion. Bones use quaternions."""
    _ensure_active(clip, arm)
    pb = arm.pose.bones[bone]
    pb.rotation_mode = "QUATERNION"
    if rot is not None:
        q = rot if isinstance(rot, Quaternion) else Euler(tuple(math.radians(a) for a in rot), "XYZ").to_quaternion()
        pb.rotation_quaternion = q
        pb.keyframe_insert("rotation_quaternion", frame=frame, group=bone)
    if loc is not None:
        pb.location = tuple(loc)
        pb.keyframe_insert("location", frame=frame, group=bone)
    if scale is not None:
        pb.scale = tuple(scale)
        pb.keyframe_insert("scale", frame=frame, group=bone)


def keys(clip: Clip, arm: bpy.types.Object, frame: float, pose: Mapping[str, Mapping[str, object]]) -> None:
    for bone, ch in pose.items():
        key(clip, arm, frame, bone, ch.get("rot"), ch.get("loc"), ch.get("scale"))  # type: ignore[arg-type]


def cycle(arm: bpy.types.Object, name: str, frames: int, pose_fn: Callable[[float], Mapping[str, Mapping[str, object]]],
          samples: int = 8, loop: bool | None = None) -> Clip:
    """Procedural clip: pose_fn(phase in [0,1)) -> pose dict, keyed at `samples` evenly spaced frames."""
    clip = new_clip(arm, name, frames, loop)
    for i in range(samples):
        ph = i / samples
        keys(clip, arm, 1 + ph * frames, pose_fn(ph))
    finish(clip, arm)
    return clip


def fcurves(action: bpy.types.Action, arm: bpy.types.Object):
    slot = arm.animation_data.action_slot if arm.animation_data else None
    if slot is None and len(action.slots):
        slot = action.slots[0]
    if slot is None:
        return []
    bag = anim_utils.action_get_channelbag_for_slot(action, slot)
    return list(bag.fcurves) if bag is not None else []


def finish(clip: Clip, arm: bpy.types.Object, interpolation: str = "BEZIER") -> Clip:
    """Close loops (copy first key value to frame 1+frames), set interpolation, stash into an NLA track
    named after the clip (glTF export picks every stashed action as a separate animation)."""
    _ensure_active(clip, arm)
    end = 1 + clip.frames
    for fc in fcurves(clip.action, arm):
        kps = fc.keyframe_points
        if not len(kps):
            continue
        if clip.loop:
            first = kps[0].co[1]
            last = next((k for k in kps if abs(k.co[0] - end) < 1e-3), None)
            if last is None:
                kps.insert(end, first, options={"FAST"})
            else:
                last.co[1] = first
        for k in kps:
            k.interpolation = interpolation
        fc.update()
    clip.action.frame_range = (1, end)
    clip.action.use_frame_range = True
    ad = arm.animation_data
    track = next((t for t in ad.nla_tracks if t.name == clip.name), None) or ad.nla_tracks.new()
    track.name = clip.name
    for s in list(track.strips):
        track.strips.remove(s)
    strip = track.strips.new(clip.name, 1, clip.action)
    strip.name = clip.name
    track.mute = True
    ad.action = None
    return clip


def clips_of(arm: bpy.types.Object) -> list[str]:
    ad = arm.animation_data
    return sorted(t.name for t in ad.nla_tracks) if ad else []


def rest(arm: bpy.types.Object) -> None:
    """Reset every pose bone to rest (call before exporting the bind pose)."""
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


__all__ = ["Clip", "LOOPING", "ONE_SHOT", "STANDARD", "clips_of", "cycle", "fcurves", "finish", "key", "keys",
           "new_clip", "rest", "validate_name"]
