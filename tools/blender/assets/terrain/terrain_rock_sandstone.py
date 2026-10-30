"""
@asset terrain_rock_sandstone
@kind material
@style terrain:TERRAIN_LAYERS.rock_sandstone_cliff, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Sandstone cliff splat layer for TRIPLANAR projection (class T, 10 m x 10 m, seamless; v = world up on the side
projections). The defining feature is CROSS-BEDDING (TERRAIN_LAYERS / ASSET_LIST): the face is built from sets
0.3-2 m thick whose boundaries undulate (+-0.2 m, so sets thicken and pinch along u); inside each set inclined
foreset laminae (dip 14-30 deg, 5-11 cm, alternating dip direction set to set) curve tangentially into the set's
base, etched out as fine ribs by differential weathering.
- Thin SOFT beds (~a third) recess 8-15 cm under the hard beds, which overhang with a sharp lower lip: a dark
  shadow line under every lip.
- Irregular blocky joints per set (2.5-6 m apart, rounded weathered shoulders, tilted, wandering, some running through several sets, most
  stopping at a bedding plane), each block at its own slight depth and tilt; joint edges broken, not chamfered.
- Sparse TAFONI: 2-4 honeycomb patches per tile (6-12 cm cells with thin walls), preferring the soft beds under
  overhangs.
- Buff / red / purple-grey set tones with lighter and darker laminae, Liesegang iron staining, dark varnish
  streaks from the lips and joints, grey-green crustose lichen on the rounded upper edges of hard beds.
Target (TERRAIN_LAYERS.rock_sandstone_cliff): average #a88a6c, roughness 0.82.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, joint_bands  # noqa: E402

S = 10.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.rock_sandstone_cliff", family="sandstone",
            rough_spread=0.07)
x, y = kit.x, kit.y
rng = kit.rng

with core.timer("sets and joints"):
    jb = joint_bands(kit, spacing=(0.3, 2.0), amp=0.3, feature=3.5, vspacing=(2.5, 6.0), carry=0.88, tilt=0.16,
                     wander=0.22, vfeature=1.6, pinch=True)
    band = jb["band"].astype(np.int64)
    nb = int(jb["nb"])
    below, above, thick = jb["below"], jb["above"], jb["thick"]
    lv = below / np.maximum(thick, 1e-3)
    soft_b = rng.uniform(0, 1, nb) < 0.36
    tone_b = rng.uniform(0, 1, nb)
    soft = soft_b[band].astype(np.float32)
    soft = np.where(thick > 1.3, 0.0, soft)  # thick sets are the massive hard cliff formers
    tone = tone_b[band].astype(np.float32)
    # the bed above / below a texel (for overhang lips)
    soft_below_bed = soft_b[(band - 1) % nb].astype(np.float32)
    soft_above_bed = soft_b[(band + 1) % nb].astype(np.float32)

with core.timer("bed profiles"):
    # hard beds: planar face, weathered rounded top edge, sharp lower lip; soft beds: concave recess
    r_top = 0.1 + 0.18 * jb["rand1"]
    t_top = np.clip(above / r_top, 0.0, 1.0)
    hard_h = 0.1 - r_top * (1.0 - np.sqrt(np.clip(1.0 - (1.0 - t_top) ** 2, 0.0, 1.0))) * (0.6 + 0.4 * soft_above_bed)
    hard_h = hard_h + 0.05 * np.sin(np.pi * np.clip(lv, 0, 1)) ** 0.5 * np.clip(thick / 1.2, 0.3, 1.0)  # weathered loaf profile
    rec = 0.1 + 0.08 * tone
    soft_h = 0.1 - rec - 0.05 * np.sin(np.pi * np.clip(lv, 0, 1)) ** 0.7
    # where a soft bed sits under a hard bed, its top is shadowed by the overhanging lip
    under_lip = soft * (1.0 - soft_above_bed) * tg.smoothstep(0.12, 0.0, above)
    h = hard_h * (1.0 - soft) + soft_h * soft
    # blocks: each joint-bounded block at its own depth and slight tilt
    h += 0.02 * (jb["block"] - 0.5) * (1.0 - 0.6 * soft) + 0.03 * (jb["rand2"] - 0.5) * (jb["lu"] - 0.5)
    h += 0.06 * kit.fbm(1.5, 3, aniso=(2.0, 1.0)) * (1.0 - soft)  # weathered, undulating bed faces
    # joints: broken V-grooves, open ones wider and deeper
    jopen = jb["open_v"]
    jw = 0.02 + 0.09 * jopen * (0.6 + 0.4 * (kit.fbm(0.8, 2) * 0.5 + 0.5))
    jd = jb["side"] + 0.015 * kit.fbm(0.05, 2)
    joint = tg.smoothstep(jw, 0.0, jd) * tg.smoothstep(-0.35, 0.15, kit.fbm(0.9, 3, aniso=(0.35, 1.0)))  # joints fade in and out
    jr = 0.08 + 0.1 * jopen  # weathered, rounded joint shoulders (not a cut line)
    h -= (0.04 + 0.14 * jopen) * joint + 0.06 * (1.0 - np.sqrt(np.clip(1.0 - (1.0 - np.clip(jd / jr, 0, 1)) ** 2, 0, 1)))
    bedding = tg.smoothstep(0.02, 0.0, np.minimum(below, above)) * (1.0 - soft)
    h -= 0.025 * bedding

with core.timer("cross-bedding"):
    sp_b = rng.uniform(0.05, 0.11, nb)
    tan_b = np.tan(np.radians(rng.uniform(14.0, 30.0, nb)))
    sign_b = np.where(rng.uniform(0, 1, nb) < 0.5, -1.0, 1.0)
    k_b = np.round(tan_b * S / sp_b) * sign_b  # integer laminae per tile in u: seamless
    sp = sp_b[band].astype(np.float32)
    kb = k_b[band].astype(np.float32)
    zr = np.clip(lv, 0, 1)
    g = below + 0.55 * thick * (1.0 - zr) ** 2  # foresets curve tangentially into the set's base
    phi = g / sp - kb * x + 0.45 * kit.fbm(1.5, 2) + 0.12 * kit.fbm(0.3, 2)  # planar foresets, gently warped
    saw = phi - np.floor(phi)
    lam = tg.smoothstep(0.0, 0.25, saw) * tg.smoothstep(1.0, 0.6, saw)  # etched rib profile
    lam_amp = (0.008 + 0.008 * soft) * tg.smoothstep(0.0, 0.08, lv) * (0.5 + 0.5 * tg.smoothstep(-0.3, 0.3, kit.fbm(1.0, 2)))
    h += lam_amp * lam
    lam_tone = (np.floor(phi) * 0.618) % 1.0  # lamina-to-lamina tone variation

with core.timer("tafoni"):
    tz = tg.smoothstep(0.66, 0.8, kit.fbm(1.6, 3) * 0.5 + 0.5 + 0.12 * soft + 0.1 * under_lip)
    hf1, hf2, hid = kit.worley(0.08, 0.9)
    wall = tg.smoothstep(0.0, 0.12, hf2 - hf1)
    bowl = np.clip(1.0 - (hf1 / (0.55 + 0.25 * hid)) ** 2, 0.0, 1.0)
    honey = tz * bowl * wall
    h -= 0.05 * honey + 0.03 * tz

with core.timer("surface"):
    h += 0.025 * kit.fbm(0.8, 3) + 0.008 * kit.fbm(0.15, 3) + 0.0012 * kit.fbm(0.02, 3)
    # granular disintegration pits and fresh spall scars (planar chips) on hard beds
    fc = kit.facets(0.3, slope=0.12)
    spall = tg.smoothstep(0.7, 0.76, kit.fbm(0.7, 3) * 0.5 + 0.5) * (fc["id"] > 0.5) * (1.0 - soft)
    h += spall * (-0.015 + 0.3 * fc["h"] * 0.05)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.45 * (tone - 0.5) + 0.12 * kit.fbm(0.9, 3) + 0.1 * (lam_tone - 0.5) + 0.04 * kit.fbm(0.04, 2), 0, 1)
    alb = K.ramp(t, [(0.0, "#8c6450"), (0.3, "#9c785e"), (0.55, "#ab8b6c"), (0.8, "#bda27f"), (1.0, "#c9b18f")])
    alb = K.tint(alb, "#857269", 0.35 * tg.smoothstep(0.8, 0.97, tone))  # purple-grey reduced sets
    alb = K.tint(alb, "#a2624a", 0.25 * tg.smoothstep(0.2, 0.04, tone))  # iron-red sets
    alb = K.mul(alb, 1.0 + 0.14 * (lam - 0.5) * (0.6 + 0.6 * soft))
    # Liesegang iron rings (wavy, faint)
    lies = 0.5 + 0.5 * np.sin(2 * np.pi * (kit.fbm(1.5, 3) * 6.0))
    alb = K.tint(alb, "#9b6a4c", 0.12 * lies * tg.smoothstep(0.1, 0.5, kit.fbm(2.0, 2)))
    alb = K.mul(alb, 1.0 - 0.55 * under_lip)  # overhang shadow line under every hard lip
    alb = K.tint(alb, "#5a4a3e", 0.5 * joint * jopen)
    alb = K.mul(alb, 1.0 - 0.35 * honey - 0.1 * tz)
    alb = K.tint(alb, "#c39878", 0.3 * spall)
    # varnish streaks from the lips and joints
    src = (tg.smoothstep(0.1, 0.0, below) * soft_below_bed * (1.0 - soft) + 0.5 * joint)
    src = src * tg.smoothstep(0.45, 0.75, kit.fbm(0.2, 3, aniso=(0.25, 5.0)) * 0.5 + 0.5)
    streak = tg.directional_blur_down(src, int(kit.px(1.2)), 0.988)
    streak = np.clip(tg.blur(streak, 1.5) * 1.4, 0, 1)
    alb = K.tint(alb, "#4b3d33", 0.45 * streak)
    # lichen on the rounded upper edges of the hard beds
    zone = tg.smoothstep(0.25, 0.0, above) * (1.0 - soft) * (1.0 - streak)
    lic = kit.lichen(zone, coverage=0.06, patch_m=0.3, rosette_m=0.03, rosette_density=0.35)
    alb = K.tint(alb, "#7f7d64", 0.5 * lic["crust"] + 0.4 * lic["rosette"])
    h = h + lic["h"]
    alb = K.compress_chroma(alb, 0.82)

with core.timer("roughness"):
    rough = 0.82 + 0.04 * kit.fbm(0.3, 3) + 0.06 * honey + 0.05 * lic["crust"] - 0.08 * streak - 0.05 * spall

finish_terrain(kit, h, alb, rough, macro_sigma=2.5, macro_amount=0.5, height_hp=0.25, ao_distance=0.35,
               ao_height_mix=0.35, preview="cliff",
               description="Sandstone cliff for triplanar projection (10 m, v = up): cross-bedded sets 0.3-2 m with "
                           "tangential foresets, recessed soft beds under overhanging lips, irregular blocky joints, "
                           "sparse tafoni, varnish streaks, lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
