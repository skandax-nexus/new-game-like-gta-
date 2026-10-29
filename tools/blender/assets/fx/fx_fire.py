"""
@asset fx_fire
@kind flipbook

Looping flame (8 x 8 = 64 frames at 24 fps): hot particles rising out of a fuel bed through curl-noise
turbulence, cooling as they climb (white-gold core -> amber -> ember red -> soot), simulated in numpy and
rendered as an emission-absorption volume in Cycles. Seamless loop by cross-fading the simulated fields over
16 frames. Stored premultiplied (emission adds light, soot occludes): runtime blend ONE / ONE_MINUS_SRC_ALPHA,
color x emissiveIntensity (8, ART_BIBLE §10 fire `#fff2c0 -> #ffb040 -> #e2571e`, emissive 6-12).
Building fires 3-8 m, torches 0.3 m (scale the sprite). Atlas 1024 / 1024 / 512 (ASSET_LIST WP7-09).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402

ctx = fb.begin(__file__)
FRAMES, BLEND, WARMUP = 64, 16, 40
EXTENT = (1.3, 1.3, 2.6)
FPS = 24.0
grid = 64 if not ctx.draft else 40
px = ctx.res(128, 64)
rng = np.random.default_rng(31)
sim = fb.ParticleVolume(grid, EXTENT, 31, turbulence=0.55, curl=fb.CurlNoise(77, octaves=4, base_freq=2.6, speed=1.6))
dens_frames, temp_frames = [], []
rate = 140 if not ctx.draft else 70
dt = 1.0 / FPS
for f in range(WARMUP + FRAMES + BLEND):
    n = rate
    a = rng.uniform(0, 2 * np.pi, n)
    r = 0.24 * np.sqrt(rng.random(n))
    pos = np.stack([np.cos(a) * r, np.sin(a) * r * 0.8, rng.uniform(0.04, 0.12, n)], axis=1)
    vel = np.stack([-np.cos(a) * r * 0.6, -np.sin(a) * r * 0.5, rng.uniform(0.6, 1.1, n)], axis=1)
    life = rng.uniform(0.55, 1.15, n)
    heat = rng.uniform(0.85, 1.0, n)
    sim.emit(pos, vel, life, rng.uniform(0.6, 1.0, n), heat)
    sim.step(dt, buoyancy=0.2, drag=1.8, heat_buoyancy=2.4, cooling=2.2)
    if f >= WARMUP:
        d, t = sim.fields(bands=((0.0, 0.3, 0.9), (0.3, 0.65, 1.5), (0.65, 1.01, 2.4)), fade_in=0.03, fade_out=0.45)
        dens_frames.append(d)
        temp_frames.append(t)
dens = fb.loop_blend(dens_frames, FRAMES, BLEND)
temp = fb.loop_blend(temp_frames, FRAMES, BLEND)
vox = max(EXTENT) / (grid - 1)
peak = kit.peak_density(dens, vox)
K = 3.0  # optical-depth scale of the normalized density
pairs = []
for d, t in zip(dens, temp):
    d = d / max(peak, 1e-6)
    hot = kit.smoothstep(0.18, 0.75, t)
    # Flames are thin (low extinction, strong emission); cooled particles turn to soot (absorbing, dark).
    absorb = 2.2 + 9.0 * (1.0 - hot) ** 2
    sigma = (d * absorb * K).astype(np.float32)
    emit = fb.blackbody_ramp(np.clip(t * 1.05, 0, 1)) * (hot[..., None] ** 1.6) * 14.0
    soot = np.array([0.03, 0.025, 0.022], np.float32)
    # Renderer emission per meter = sigma * radiance  ->  d * emit + sigma * soot.
    radiance = emit / (absorb * K)[..., None] + soot[None, None, None, :] * (1.0 - hot[..., None])
    pairs.append((sigma, radiance.astype(np.float32)))
rgba = fb.render_volumes(pairs, EXTENT, px, samples=ctx.samples(16, 6))
# Normalize the HDR emission so the bright core sits near 1.0 in the 8-bit atlas (x emissiveIntensity at runtime).
peak_rgb = float(np.percentile(np.concatenate([f[..., :3].max(axis=-1).ravel() for f in rgba]), 99.7))
color = [np.concatenate([np.clip(f[..., :3] / max(peak_rgb, 1e-6), 0, 1), np.clip(f[..., 3:4], 0, 1)], axis=-1) for f in rgba]
meta = fb.write(ctx, color, 8, 8, fps=FPS, loop=True, blend="premultiplied", lit=False, emissive_intensity=8.0,
                soft_fade_m=0.3, size_m=(1.3, 2.6), atlas_px={"ultra": 1024, "high": 1024, "mobile": 512},
                description="Looping flame, premultiplied emission (x8) + soot occlusion, 64 frames at 24 fps.")
meta["tint"] = "#ffffff"
ctx.meta.update(meta)
ctx.finish()
