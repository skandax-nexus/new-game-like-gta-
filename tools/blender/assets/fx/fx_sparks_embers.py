"""
@asset fx_sparks_embers
@kind flipbook

Additive spark atlas (8 x 8 frames of 64 px = 512, ASSET_LIST WP7-11): `spark` (velocity-stretched streak,
white-hot head, amber tail), `ember` x2 (irregular glowing coals that rise and swirl, `#ffb040`), `slash_spark`
(8 frames: a fan of sparks thrown along the blade arc at the hit point), `parry_flash` (8 frames: gold radial
flash, ~120 ms, plus sparks), `finisher_burst` (16 frames: saffron-gold burst with a dust-colored shockwave
ring and flying sparks). ART_BIBLE §10 melee VFX; low-gore: hits read through sparks, never blood.
Color is premultiplied emission (additive: rgb x emissiveIntensity added, alpha = coverage for tooling).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402

ctx = fb.begin(__file__)
PX = 64 * 2  # supersampled, the publisher resamples to 64 px frames
x, y = kit.coords(PX)
rng = np.random.default_rng(7)
frames: list = []
seqs: list = []


def seq(name: str, imgs: list, fps: float, loop: bool = False) -> None:
    seqs.append({"name": name, "start": len(frames), "count": len(imgs), "fps": fps, "loop": loop})
    frames.extend(imgs)


# spark: head at the top-right, tail towards the bottom-left (aligned to velocity at runtime: +Y = forward)
i = kit.streak(x, y, (0.0, -0.85), (0.0, 0.85), 0.05, 1.0) * 1.6 + kit.glow(x, y, 0.0, 0.85, 0.07) * 0.8
seq("spark", [kit.emissive_frame(i, "#fff2c0", "#e2571e", 0.7)], 1)
# embers: soft irregular coals
embers = []
for k in range(2):
    nz = kit.fbm2(x * 1.4, y * 1.4, 40 + k, 4, 2.2)
    r = np.hypot(x * (1.0 + 0.2 * k), y)
    i = np.clip(1.0 - r / (0.42 + 0.18 * nz), 0, 1) ** 1.4 * (0.75 + 0.5 * nz) + kit.glow(x, y, 0, 0, 0.25, 2.0) * 0.35
    embers.append(kit.emissive_frame(i, "#ffd27a", "#c2412d", 0.9))
seq("ember", embers, 1)
# slash spark: fan of sparks thrown along an arc from the impact point (left) to the right
sparks = [(rng.uniform(-0.35, 0.35), rng.uniform(0.9, 1.9), rng.uniform(0.5, 1.0)) for _ in range(26)]
imgs = []
for f in range(8):
    t = (f + 1) / 8.0
    acc = np.zeros_like(x)
    for ang, speed, b in sparks:
        dx, dy = np.cos(ang) * speed, np.sin(ang) * speed
        p0 = np.array([-0.85, 0.0]) + np.array([dx, dy]) * max(0.0, t - 0.18) * 0.9
        p1 = np.array([-0.85, 0.0]) + np.array([dx, dy - 0.25 * t]) * t * 0.9
        acc += kit.streak(x, y, p0, p1, 0.022, 1.0) * b * (1.0 - t ** 2.2) * 1.8
    acc += kit.glow(x, y, -0.85, 0.0, 0.18 * (1.0 - t) + 0.02, 2.0) * (1.0 - t) * 1.4
    imgs.append(kit.emissive_frame(acc, "#ffe39a", "#e8892b", 0.8))
seq("slash_spark", imgs, 30)
# parry flash: star burst + ring, very short
imgs = []
ang = np.arctan2(y, x)
r = np.hypot(x, y)
for f in range(8):
    t = f / 7.0
    rays = (np.abs(np.cos(ang * 4.0)) ** 18 + 0.6 * np.abs(np.cos(ang * 4.0 + np.pi / 4)) ** 30) * np.exp(-r / (0.25 + 0.8 * t)) * 1.6
    ring = np.exp(-((r - (0.15 + 0.75 * t)) / 0.05) ** 2) * 0.9
    core = kit.glow(x, y, 0, 0, 0.12 + 0.1 * t, 2.0) * 1.5
    i = (rays + ring + core) * (1.0 - t) ** 1.3
    imgs.append(kit.emissive_frame(i, "#fff2c0", "#e9b949", 0.75))
seq("parry_flash", imgs, 60)
# finisher burst: saffron-gold burst + shockwave + sparks
imgs = []
bsparks = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.6, 1.3), rng.uniform(0.4, 1.0)) for _ in range(40)]
for f in range(16):
    t = (f + 1) / 16.0
    burst = np.exp(-r / (0.18 + 0.55 * t)) * (1.0 - t) ** 1.5 * 2.2
    shock = np.exp(-((r - (0.1 + 0.85 * t)) / (0.04 + 0.05 * t)) ** 2) * (1.0 - t) * 1.1
    acc = burst + shock
    for a_, sp, b in bsparks:
        d = np.array([np.cos(a_), np.sin(a_)]) * sp
        acc += kit.streak(x, y, d * max(0.0, t - 0.12) * 0.8, d * t * 0.8, 0.018, 1.0) * b * (1.0 - t) * 1.6
    imgs.append(kit.emissive_frame(acc, "#ffe9a8", "#e8892b", 0.8))
seq("finisher_burst", imgs, 30)

color = [f.astype(np.float32) for f in frames]
meta = fb.write(ctx, color, 8, 8, fps=30, loop=False, sequences=seqs, blend="additive", lit=False, emissive_intensity=6.0,
                soft_fade_m=0.1, size_m=(0.6, 0.6), atlas_px={"ultra": 512, "high": 512, "mobile": 512},
                labels=kit.label_sequences(seqs), srgb=True,
                description="Additive sparks: spark, embers, slash spark, parry flash, finisher burst (premultiplied emission x6).")
meta["tint"] = "#ffffff"
ctx.meta.update(meta)
ctx.finish()
