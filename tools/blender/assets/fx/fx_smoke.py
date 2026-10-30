"""
@asset fx_smoke
@kind flipbook

Billowing smoke puff over its life (8 x 8 = 64 frames at 16 fps, one-shot, ASSET_LIST WP7-09): an Eulerian smoke
simulation (lib/flipbook FluidSim) of a buoyant, expanding cluster of cauliflower lobes - hot-gas expansion pushes
the lobes out, buoyancy lifts them into a rolling cap, vorticity confinement keeps the curls - rendered noise-free
(exact emission-absorption integration, no Cycles grain) as an occlusion-only albedo plus a tangent-space normal
map taken from the volume's density gradient (the transmittance-weighted surface normal), so the runtime lights it
with the sun: a lit top and a shaded side that swap when the sun moves from east to west (ART_BIBLE §10 "sun-lit
tops", no unlit puffs). Lit as a medium, not a solid (Art Director TA-07 R2-B1): the gradient comes from the density
blurred by 3.5 % of the frame (the puff's big rounded forms - no internal folds), the tilt fades with alpha
(smoothstep 0.1-0.7: thin fringes face the camera) at strength 0.6, so the mean normal z is >= 0.8 wherever alpha >
0.1 (lit-medium guard in flipbook.write); the runtime adds wrap lighting and upper-hemisphere ambient (ADR 0003). The whole life stays inside the 3 m frame (flipbook border guard); late frames keep their
opacity (flatten) and fade out over the last 30 %. Plumes are built from many of these (10-40 m, life 8-15 s);
tint by the particle color (building smoke `#4a4038`, steam / dust lighter). Atlas 2048 / 1024 / 512 (256 px frames
on ultra: Art Director decision, TA-07 review). OWNER: Technical Artist G (TA-07).
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402
from lib.core import log, timer  # noqa: E402

ctx = fb.begin(__file__)
FRAMES, FPS = 64, 16.0
S = 3.0  # frame side (m)
H = 0.022 if not ctx.draft else 0.05
PX = 256 if not ctx.draft else 64
shape, EXT = kit.sim_box((S, S * 0.8, S * 1.15), H)
sim = fb.FluidSim(shape, EXT, floor=False, vorticity=3.5, sponge=0.06, sponge_top=0.06)
x, y, z = sim.world()
rng = np.random.default_rng(11)
# nine overlapping lobes around a centre 0.62 m up -> cauliflower start, modulated by fractal noise
dens = np.zeros(shape, np.float32)
c0 = np.array([0.0, 0.0, 0.62])
for _ in range(9):
    d = rng.normal(0, 1, 3)
    d /= np.linalg.norm(d)
    c = c0 + d * 0.36 * rng.uniform(0.3, 0.8)
    rr = 0.36 * rng.uniform(0.35, 0.6)
    q = np.sqrt((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2)
    dens = np.maximum(dens, np.clip((rr - q) / (rr * 0.45), 0, 1) * rng.uniform(0.7, 1.0))
dens = (dens * np.clip(0.35 + 1.3 * fb.value_noise3(shape, 0.07 / H, 5, octaves=4), 0, None)).astype(np.float32)
sim.dens = dens
sim.temp = np.clip(dens * 1.2, 0, 1).astype(np.float32)
seed_v = fb.CurlNoise(23, octaves=3, base_freq=2.5, speed=0.0).velocity(np.stack([x.ravel(), y.ravel(), z.ravel()], 1), 0.0)
inside = (dens > 0.02).astype(np.float32)
for a in range(3):
    sim.vel[a] = seed_v[:, a].reshape(shape) * 0.8 * inside
sim.vel[2] += 0.9 * inside
# fine detail carried by the flow: stretched into wisps and curls, multiplied into the rendered density
sim.fields["detail"] = fb.value_noise3(shape, 0.05 / H, 77, octaves=3)
frames = []
with timer(f"smoke sim {shape} x {FRAMES} frames"):
    for _ in range(FRAMES):
        sim.step(1.0 / FPS, buoyancy=2.0, vorticity=3.5, cooling=0.45, dissipation=0.08, damping=0.15,
                 expansion=3.0 * math.exp(-sim.t / 1.2), substeps=2)
        frames.append((sim.dens * np.clip(0.4 + 1.2 * sim.fields["detail"], 0, None)).astype(np.float32))
with timer("smoke render (exact integration + density-gradient normals)"):
    color, normals, worst = kit.lit_frames(frames, EXT, H, PX, view="front", frame=(0.0, S / 2, S), depth=3.5,
                                           albedo=(0.6, 0.585, 0.565), flatten=0.5, fades=kit.life_fade(FRAMES, 0.06, 0.28),
                                           normal_blur_frac=0.035, normal_fade=(0.1, 0.7), normal_strength=0.6)
log(f"smoke: pre-window border alpha {worst * 255:.2f}/255")
meta = fb.write(ctx, color, 8, 8, fps=FPS, loop=False, normals=normals, blend="alpha", lit=True, soft_fade_m=0.8, min_normal_z=0.8,
                size_m=(S, S), atlas_px={"ultra": 2048, "high": 1024, "mobile": 512},
                description="Billowing smoke puff over life (Eulerian sim, 64 frames, one-shot), lit via density-gradient "
                            "normals; tint #4a4038 for fires.")
meta["tint"] = "#4a4038"
ctx.meta.update(meta)
ctx.finish()
