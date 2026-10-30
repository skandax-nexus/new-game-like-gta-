"""
@asset fx_sparks_embers
@kind flipbook

Additive spark atlas (8 x 8 frames, ASSET_LIST WP7-11, ART_BIBLE §10 melee VFX; low-gore: hits read through sparks,
never blood):
  `spark`           velocity-stretched streak: gold head, saffron tail (aligned to velocity at runtime: +Y = forward)
  `ember` x2        irregular glowing coals that rise and swirl (#ffb040 family)
  `slash_spark`     8 frames: a fan of sparks thrown along the blade arc from the hit point, curving under gravity
  `parry_flash`     8 frames (~130 ms, Bible §10 "gold radial flash 120 ms + sparks"): an OPEN radial flash - 16
                    irregular streaks of varied length, angle and width flung outward from the contact point (they
                    leave the centre as they fly: no hub), no rim, and a soft gold core gone after 4 frames. The old
                    rays + ring read as the 8-spoke wheel of our capitals and heraldry (ART_BIBLE §1.3, §1.5, §8.7) -
                    a combat flash must never quote it (Art Director TA-07 R2-B4); the bake logs its closure (share of
                    angles covered at the best radius, a ring ~1.0) and its 4- / 8-fold symmetry
  `finisher_burst`  16 frames: saffron-gold bloom and ring, a dust-coloured shockwave, and curved flying sparks
Colour: streaks run from gold `#e9b949` (bright) to saffron `#e8892b` (cooling); intensity is soft-saturated, and only
the hottest few percent blend towards the warm-white core `#fff2c0` (logged per sequence) - no flat white, no spokes.
Every sprite fades to exactly 0 before its frame border (frame window + flipbook border guard). Premultiplied
emission (additive: rgb x emissiveIntensity 6 added; alpha = coverage for tooling only), published LOSSLESS so the
thin streaks keep their colour (lossy 4:2:0 WebP put cyan fringes on them). Atlas 1024 / 1024 / 512.
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402
from lib.core import log  # noqa: E402

ctx = fb.begin(__file__)
PX = 128 if not ctx.draft else 64
x, y = kit.coords(PX)
r = np.hypot(x, y)
ang = np.arctan2(y, x)
WIN = fb.frame_window(PX, 0.04, 0.10)
# radial fade for blooms / rays / rings: round falloff to exactly 0 well inside the frame (the square frame window
# alone left a visible square glow around the finisher bloom on a dark backdrop)
RAD = kit.smoothstep(0.92, 0.62, r)
rng = np.random.default_rng(7)
frames: list = []
seqs: list = []
DUST = "#a8865c"  # dust-coloured shockwave (emissive, dim)


def seq(name: str, imgs: list, fps: float, loop: bool = False) -> None:
    seqs.append({"name": name, "start": len(frames), "count": len(imgs), "fps": fps, "loop": loop})
    frames.extend(imgs)
    v = np.concatenate([f[..., 3].ravel() for f in imgs])
    lit = v > 0.08
    log(f"sparks {name}: warm-white core {100.0 * float((v > 0.9).sum()) / max(int(lit.sum()), 1):.1f} % of the lit area")


def tapered(a: np.ndarray, b: np.ndarray, w0: float, w1: float) -> np.ndarray:
    """Soft segment a -> b whose width tapers from w0 (at a) to w1 (at b); brightness grows towards b (the head)."""
    d = b - a
    L2 = max(float(d @ d), 1e-12)
    t = np.clip(((x - a[0]) * d[0] + (y - a[1]) * d[1]) / L2, 0, 1)
    dist = np.hypot(x - (a[0] + t * d[0]), y - (a[1] + t * d[1]))
    w = w0 + (w1 - w0) * t
    return (np.exp(-(dist / w) ** 2) * (0.2 + 0.8 * t ** 1.5)).astype(np.float32)


# spark: head at the top, tail towards the bottom
i = tapered(np.array([0.0, -0.62]), np.array([0.0, 0.58]), 0.012, 0.05) * 1.7 + kit.glow(x, y, 0.0, 0.58, 0.05) * 0.7
seq("spark", [kit.spark_emission(i, gain=1.0, core=0.95, window=WIN)], 1)
# embers: soft irregular coals, saffron rim, gold heart
embers = []
for k in range(2):
    nz = kit.fbm2(x * 1.5, y * 1.5, 40 + k, 4, 2.2)
    rr = np.hypot(x * (1.0 + 0.25 * k), y * (1.0 - 0.1 * k))
    body = np.clip(1.0 - rr / (0.32 + 0.16 * nz), 0, 1) ** 1.3 * (0.6 + 0.6 * nz)
    i = body * 1.6 + kit.glow(x, y, 0, 0, 0.22, 2.0) * 0.35
    embers.append(kit.spark_emission(i, gold="#ffb040", saffron="#c2412d", gain=1.1, core=0.95, window=WIN))
seq("ember", embers, 1)
# slash spark: a fan thrown to the right from the hit point (left), curving down under gravity
fan = [(rng.uniform(-0.55, 0.45), rng.uniform(0.9, 1.6), rng.uniform(0.45, 1.0)) for _ in range(22)]
imgs = []
hit = np.array([-0.55, 0.05])
for f in range(8):
    t = (f + 1) / 8.0
    acc = np.zeros_like(x)
    for a_, sp, b in fan:
        v = np.array([np.cos(a_), np.sin(a_)]) * sp
        head = hit + v * t * 0.62 + np.array([0.0, -0.35]) * t * t
        tail = hit + v * max(0.0, t - 0.22) * 0.62 + np.array([0.0, -0.35]) * max(0.0, t - 0.22) ** 2
        acc += tapered(tail, head, 0.008, 0.02) * b * (1.0 - t ** 2.0) * 2.4
    acc += kit.glow(x, y, hit[0], hit[1], 0.13 * (1.0 - t) + 0.02, 2.0) * (1.0 - t) ** 1.5 * 1.6
    imgs.append(kit.spark_emission(acc, gain=1.0, window=WIN))
seq("slash_spark", imgs, 30)
# parry flash: an open burst of irregular streaks + a soft gold core (no ring, no regular rays - see the module doc)
imgs = []
rng.uniform(0, 2 * np.pi)  # the old flash's one draw: keeps the shared stream (finisher_burst flyers) unchanged
N_STREAK = 16
prng = np.random.default_rng(31)
base = prng.uniform(0, 2 * np.pi)
streaks = []
for k in range(N_STREAK):
    a_ = base + (k + prng.uniform(-0.38, 0.38)) * 2 * np.pi / N_STREAK  # jittered, never evenly spaced
    streaks.append((a_ + prng.normal(0, 0.03), prng.uniform(0.28, 0.82), prng.uniform(0.75, 1.35), prng.uniform(0.45, 1.0),
                    prng.uniform(0.006, 0.011), prng.uniform(0.012, 0.024), prng.uniform(-0.25, 0.25)))
for f in range(8):
    t = (f + 1) / 8.0
    acc = np.zeros_like(x)
    for a_, length, speed, amp, w0, w1, bend in streaks:
        tt = min(1.0, t * speed)
        head_r = 0.05 + length * (1.0 - (1.0 - tt) ** 2.2)  # fast out, easing
        tail_r = 0.03 + head_r * (0.15 + 0.55 * tt)  # the tail leaves the centre as the streak flies
        ah, at = a_ + bend * tt * 0.3, a_  # slight curl: streaks are not ruler-straight spokes
        head = np.array([np.cos(ah), np.sin(ah)]) * head_r
        tail = np.array([np.cos(at), np.sin(at)]) * tail_r
        acc += tapered(tail, head, w0, w1) * amp * (1.0 - t) ** 1.3 * 2.2
    # soft gold core: bright on contact, gone within 4 frames (~65 ms)
    core_amp = max(0.0, 1.0 - f / 4.0) ** 2
    acc += kit.glow(x, y, 0.0, 0.0, 0.09 + 0.04 * t, 2.0) * core_amp * 1.4
    imgs.append(kit.spark_emission(acc * RAD, gain=1.0, core=0.95, window=WIN))


def radial_report(name: str, frames_: list) -> None:
    """Closure = best share of 360 angle bins lit (> 15 % of the frame max) at one radius beyond the core (a ring ~1.0);
    symmetry = 4- and 8-fold angular power relative to the mean (regular spokes / a wheel read high)."""
    worst_c, worst_s = 0.0, 0.0
    for f_ in frames_:
        v_ = f_[..., 3]
        if v_.max() <= 0:
            continue
        lit = v_ > 0.15 * v_.max()
        bins = ((ang + np.pi) / (2 * np.pi) * 360).astype(np.int64) % 360
        for r0 in np.arange(0.3, 0.85, 0.02):  # beyond the core glow and its falloff
            band = (r > r0) & (r < r0 + 0.02)
            cov = np.zeros(360, bool)
            cov[bins[band & lit]] = True
            seen = np.zeros(360, bool)
            seen[bins[band]] = True
            if seen.sum() > 90:
                worst_c = max(worst_c, float(cov.sum() / seen.sum()))
        prof = np.bincount(bins[(r > 0.15) & (r < 0.7)], weights=v_[(r > 0.15) & (r < 0.7)], minlength=360)
        spec = np.abs(np.fft.rfft(prof))
        if spec[0] > 0:
            worst_s = max(worst_s, float(max(spec[4], spec[8]) / spec[0]))
    log(f"sparks {name}: closure {worst_c:.2f} (ring ~1.0), 4/8-fold symmetry {worst_s:.3f} of the mean")


radial_report("parry_flash", imgs)
seq("parry_flash", imgs, 60)
# finisher burst: saffron-gold bloom + ring, dust shockwave, curved flying sparks (few, varied - no spokes)
imgs = []
# flyers leave from the bloom's edge (r0), not from the centre, so they never meet in a white hub of spokes
flyers = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.8, 1.3), rng.uniform(0.45, 1.0), rng.uniform(-0.6, 0.6)) for _ in range(16)]
for f in range(16):
    t = (f + 1) / 16.0
    bloom = np.exp(-(r / (0.09 + 0.16 * t)) ** 2) * (1.0 - t) ** 2.0 * 0.8
    ring = np.exp(-((r - (0.1 + 0.5 * t)) / (0.03 + 0.045 * t)) ** 2) * (1.0 - t) ** 1.2 * 1.1
    acc = bloom + ring
    for a_, sp, b, curl in flyers:
        def pos(tt: float) -> np.ndarray:
            a2 = a_ + curl * tt
            return np.array([np.cos(a2), np.sin(a2)]) * (0.1 + sp * tt * 0.55)
        acc += tapered(pos(max(0.0, t - 0.24)), pos(t), 0.007, 0.02) * b * (1.0 - t) ** 0.8 * 2.2 * min(1.0, t * 4.0)
    fire = kit.spark_emission(acc * RAD, gold="#e9b949", saffron="#e8892b", gain=1.0, core=0.97, window=WIN)
    # dim: x emissiveIntensity 6 at runtime, so the dust ring stays a tan haze (~0.5 HDR), never a pale-white band
    shock = np.exp(-((r - (0.12 + 0.6 * t)) / (0.07 + 0.07 * t)) ** 2) * (1.0 - t) ** 1.3 * 0.12
    dust = kit.spark_emission(shock * RAD, gold=DUST, saffron="#6e5236", gain=1.0, core=2.0, window=WIN)
    imgs.append(np.concatenate([fire[..., :3] + dust[..., :3], np.maximum(fire[..., 3:], dust[..., 3:])], axis=-1))
seq("finisher_burst", imgs, 30)

color = [f.astype(np.float32) for f in frames]
meta = fb.write(ctx, color, 8, 8, fps=30, loop=False, sequences=seqs, blend="additive", lit=False, emissive_intensity=6.0,
                soft_fade_m=0.1, size_m=(0.6, 0.6), atlas_px={"ultra": 1024, "high": 1024, "mobile": 512},
                labels=kit.label_sequences(seqs), srgb=True,
                description="Additive sparks (gold -> saffron): spark, embers, slash spark, parry flash, finisher burst "
                            "with dust shockwave; premultiplied emission x6, lossless.")
meta["tint"] = "#ffffff"
meta["encoding"] = "lossless"
ctx.meta.update(meta)
ctx.finish()
