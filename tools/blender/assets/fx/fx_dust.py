"""
@asset fx_dust
@kind flipbook

Dust for marching feet, hooves, construction and heavy landings (8 x 8 atlas, four one-shot sequences of 16
frames, ASSET_LIST WP7-10): `puff` and `puff_b` (low, wide ground puffs 1-2 m, ART_BIBLE §10 marching dust),
`ring` (3 m expanding ground ring, seen from above - construction completion / heavy landing decal particle)
and `hoof` (dust kicked backwards by a hoof or wheel). Curl-noise particle volumes rendered with Cycles as a
neutral, occlusion-only albedo plus normals from optical depth: the runtime tints by the ground color (sample
the splat albedo, lighten 15 %) and lights it with the sun. Atlas 1024 / 1024 / 512. OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402

ctx = fb.begin(__file__)
grid = 64 if not ctx.draft else 40
px = ctx.res(128, 64)
count = 2200 if not ctx.draft else 900
ALBEDO = (0.74, 0.72, 0.69)
color: list = []
normals: list = []
sequences = []


def add(name: str, dens: list, extent: tuple, view: str, duration: float, depth: float) -> None:
    vox = max(extent) / (grid - 1)
    axis = 2 if view == "top" else 1
    peak = float(max((f.sum(axis=axis) * vox).max() for f in dens))
    c, n = kit.lit_volume_frames(dens, extent, px, k_ext=depth / max(peak, 1e-6), albedo=ALBEDO, samples=ctx.samples(16, 6),
                                 view=view, ambient_blur=4.0)
    sequences.append({"name": name, "start": len(color), "count": len(dens), "fps": round(len(dens) / duration, 3), "loop": False})
    color.extend(c)
    normals.extend(n)


# puff: low and wide, drifting downwind (+x), settling
E1 = (2.6, 2.6, 2.0)
add("puff", kit.puff_frames(5, 16, 2.5, E1, grid=grid, count=count, origin=(-0.3, 0.0, 0.25), radius=0.3, clusters=12, burst=0.7,
                            direction=(0.25, 0, 0), rise=0.12, drag=1.4, turbulence=0.3, curl_freq=2.4, flatten=0.55,
                            ground=0.04, fade_out=0.7), E1, "front", 2.5, 2.4)
add("puff_b", kit.puff_frames(9, 16, 2.5, E1, grid=grid, count=count, origin=(-0.2, 0.0, 0.2), radius=0.36, clusters=10,
                              burst=0.85, direction=(0.2, 0, 0.05), rise=0.1, drag=1.5, turbulence=0.36, curl_freq=2.0,
                              flatten=0.45, ground=0.04, fade_out=0.7), E1, "front", 2.5, 2.4)

# ring: particles on a circle bursting outwards along the ground (top view)
E2 = (3.6, 3.6, 1.0)
rng = np.random.default_rng(21)
sim = fb.ParticleVolume(grid, E2, 21, turbulence=0.25, curl=fb.CurlNoise(44, octaves=3, base_freq=2.4, speed=0.4))
a = rng.uniform(0, 2 * np.pi, count)
r = 0.3 + rng.normal(0, 0.06, count)
pos = np.stack([np.cos(a) * r, np.sin(a) * r, rng.uniform(0.05, 0.25, count)], axis=1)
vel = np.stack([np.cos(a), np.sin(a), np.zeros(count)], axis=1) * rng.uniform(1.4, 2.0, (count, 1)) + rng.normal(0, 0.12, (count, 3))
vel[:, 2] = rng.uniform(0.05, 0.3, count)
sim.emit(pos, vel, rng.uniform(1.6, 2.1, count), rng.uniform(0.6, 1.0, count))
ring = []
for _ in range(16):
    sim.step(2.0 / 16, buoyancy=0.05, drag=1.6)
    d, _ = sim.fields(bands=((0.0, 0.3, 0.9), (0.3, 0.65, 1.6), (0.65, 1.01, 2.6)), fade_out=0.6)
    ring.append(d)
add("ring", ring, E2, "top", 2.0, 1.8)

# hoof: kicked backwards (+x) and up, falling back
E3 = (2.4, 2.4, 1.6)
add("hoof", kit.puff_frames(13, 16, 1.6, E3, grid=grid, count=count, origin=(-0.7, 0.0, 0.08), radius=0.14, clusters=8, burst=0.5,
                            direction=(1.4, 0, 0.55), rise=-0.25, drag=1.6, turbulence=0.3, curl_freq=2.6, ground=0.04,
                            fade_out=0.65), E3, "front", 1.6, 2.2)

meta = fb.write(ctx, color, 8, 8, fps=8, loop=False, sequences=sequences, normals=normals, blend="alpha", lit=True,
                soft_fade_m=0.5, size_m=(2.0, 1.5), atlas_px={"ultra": 1024, "high": 1024, "mobile": 512},
                labels=kit.label_sequences(sequences),
                description="Dust: ground puffs (2), expanding ring (top view), hoof kick; neutral albedo + normals, tint by ground.")
meta["tint"] = "#b0956e"
ctx.meta.update(meta)
ctx.finish()
