"""
@asset fx_fire
@kind flipbook

Looping flame (8 x 8 = 64 frames at 24 fps, ASSET_LIST WP7-09, ART_BIBLE §10 fire): an Eulerian fire simulation
(lib/flipbook FluidSim: buoyant temperature field, vorticity confinement for licking tongues, hot-gas expansion,
free-slip ground) fed by a flickering, noise-modulated fuel bed, rendered noise-free (exact emission-absorption
integration) with the Bible ramp `#fff2c0` core -> `#ffb040` body -> `#e2571e` tongues. Emission only above an
ignition temperature with a steep ramp, so flames have crisp, separating tongues; NO soot (fire is emission plus a
slight occlusion - the smoke column above a fire is fx_smoke). Seamless loop: the last 16 simulated frames
cross-fade into the first.
Fuel bed (Art Director TA-07 R2-B2a): every hot spot is a DOME whose height follows the continuous noise (2 cm at
its foot, ~20 cm at its crest; the old source was a slab with one flat 14 cm top), and the spots stay inside the
inner ~80 % of the bed. A small spot is too weak to lift a tongue that stays above the ignition temperature, so all
that showed of it was its source shape: the slab read as a detached flat-topped glowing block at the right of the bed
for ~0.35 s of every loop; a dome reads as a rounded flamelet that licks up and curls into the body. Logged per
frame: the longest flat top of a DETACHED emissive region (straight_top_edge: sub-pixel top edge, within 1 px - the
Art Director's criterion; the bake fails above 8 % of the frame width, target <= 10 %) and of any shouldered block
(block_tops).
Gradient-mapped (R2-B2b): the atlas stores ONE channel, v = the sRGB-encoded luminance of the emission (+-1 LSB
triangular dither), plus the occlusion alpha; the runtime colours it with the published `ramp` (33 stops fitted to
the simulated emission: black -> ember #a8300e -> tongue #e2571e -> body #ffb040 -> core #fff2c0, R >= G >= B at every
stop). Lossy WebP put green / blue / magenta 8x8 chroma blocks into the dim emission around the tongues (x6.5 on a
night sky); a single lossless channel has no chroma to lose and is smaller on mobile.
Stored premultiplied (runtime blend ONE / ONE_MINUS_SRC_ALPHA, ramp(v) x emissiveIntensity 6.5: at night <= ~12 % of
the flame reads as the pale #fff2c0 core and none clips to white; logged at bake). The base fades in over 16 cm, the
ground line sits 13 % of the frame (25 cm) above its bottom edge (manifest `groundLine`: sink the quad by that much),
and every frame keeps its border clear in the source and in every encoded tier down to 64 px frames (flipbook border
guard). Building fires 3-8 m, torches 0.3 m (scale the 1.9 m sprite). Atlas 2048 / 1024 / 512 (256 px frames on
ultra: Art Director decision, TA-07 review), all lossless.
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402
from lib.core import log, timer  # noqa: E402

ctx = fb.begin(__file__)
FRAMES, BLEND, WARMUP = 64, 16, 30
FPS = 24.0
S = 1.9  # frame side (m): the flame fills ~65 % of its height
H = 0.0135 if not ctx.draft else 0.026
PX = 256 if not ctx.draft else 64
shape, EXT = kit.sim_box((S * 0.7, S * 0.5, S), H)
sim = fb.FluidSim(shape, EXT, floor=True, vorticity=10.0, sponge=0.08, sponge_top=0.08)
x, y, z = sim.world()
# fuel bed: an ellipse 1.16 x 0.6 m whose hot spots flicker (time-scrolled value noise -> several separate tongues).
# Hot spots only inside the inner ~80 % (full up to rx 0.30, gone at 0.37 of the bed's 0.40): see the module doc.
rx = np.sqrt((x / 1.45) ** 2 + (y / 0.75) ** 2)
bed_xy = (np.clip((0.40 - rx) / 0.08, 0, 1) * kit.smooth01((0.37 - rx) / 0.07))[:, :, :1]
zc = z[:1, :1, :]
TN = 160
noise = fb.value_noise3((shape[0], shape[1], TN), 0.10 / H, 9, octaves=2)
noise = np.stack([fb.blur2(noise[:, :, k], 0.02 / H) for k in range(TN)], axis=2)  # round hot spots, no lattice blocks
temps = []
dt = 1.0 / FPS
with timer(f"fire sim {shape} x {WARMUP + FRAMES + BLEND} frames"):
    for f in range(WARMUP + FRAMES + BLEND):
        for sub in range(2):
            ti = (f * 2 + sub) * 0.5
            k0 = int(ti) % TN
            k1 = (k0 + 1) % TN
            a = ti - int(ti)
            n2 = noise[:, :, k0] * (1 - a) + noise[:, :, k1] * a
            nn = n2[:, :, None]
            heat = np.clip((nn - 0.3) * 2.2, 0, 1)
            # dome-shaped source: its top follows the continuous noise (never saturates), soft 4 cm edge
            top = 0.02 + 0.3 * np.maximum(nn - 0.3, 0.0)
            src = (bed_xy * heat * kit.smooth01((top - zc) / 0.04) * 1.4).astype(np.float32)
            sim.temp = np.maximum(sim.temp, src)
            sim.vel[2] += (src * 3.0 * dt).astype(np.float32)
            sim.step(dt / 2, buoyancy=6.5, vorticity=10.0, cooling=0.95, damping=0.6, expansion=0.9)
        if f >= WARMUP:
            temps.append(sim.temp.copy())
temps = fb.loop_blend(temps, FRAMES, BLEND)
GROUND = 0.13  # ground line 13 % (25 cm) above the frame bottom: lanczos + lossy WebP keep the bright base off the border
frame = (0.0, S / 2 - GROUND * S, S)
with timer("fire render (exact integration)"):
    hdr, worst = kit.fire_frames(temps, EXT, H, PX, frame=frame)
# Normalize the HDR emission: the 99th percentile of flame pixels -> 1.0 in the 8-bit atlas (x emissiveIntensity 6.5).
lum = np.concatenate([f[..., :3].max(axis=-1).ravel() for f in hdr])
pk = float(np.percentile(lum[lum > 0.02 * lum.max()], 99.0))
color = [np.concatenate([np.clip(f[..., :3] / pk, 0, 1), np.clip(f[..., 3:4], 0, 1)], axis=-1).astype(np.float32) for f in hdr]
# Gradient map: v = encoded luminance; the ramp is the mean simulated colour per v (monotone R >= G >= B by construction)
Y = [fb.luminance(c[..., :3]) for c in color]
ramp = fb.ramp_fit([c[..., :3] for c in color], [kit.tg.linear_to_srgb(y) for y in Y], stops=33)
vq = [fb.ramp_encode(y, dither=True, seed=1000 + i) for i, y in enumerate(Y)]
shaded = [fb.ramp_apply(ramp, v) for v in vq]
err = float(np.mean([np.abs(kit.tg.linear_to_srgb(sh) - kit.tg.linear_to_srgb(c[..., :3]))[c[..., :3].max(-1) > 0.01].mean() for sh, c in zip(shaded, color)]))
log(f"fire: ramp {len(ramp)} stops, mean |ramp(v) - simulated colour| {err * 255:.2f}/255 (encoded) over emitting texels")
color = [np.concatenate([np.repeat(v[..., None], 3, axis=-1), c[..., 3:4]], axis=-1).astype(np.float32) for v, c in zip(vq, color)]
enc = [kit.tg.linear_to_srgb(np.clip(sh, 0, 1)) for sh in shaded]
flame = sum(int((e.max(-1) > 0.25).sum()) for e in enc)
core = sum(int(((e.min(-1) > 0.70) & (e.max(-1) > 0.25)).sum()) for e in enc)
log(f"fire: core (#fff2c0-like, all channels > 70 %) {100.0 * core / max(flame, 1):.1f} % of the flame area; pre-window border "
    f"{worst / pk * 255:.2f}/255")
# no flat-topped glowing blocks (R2-B2a): flat top of any detached emissive region, and shouldered block tops
edges = [kit.straight_top_edge(v, detached_only=True) for v in vq]
blocks = [kit.block_tops(v) for v in vq]
k_worst = int(np.argmax([e[0] for e in edges]))
k_block = int(np.argmax([b[0] for b in blocks]))
log(f"fire: detached flat top worst {100 * edges[k_worst][0]:.1f} % of the frame width (frame {k_worst}, {edges[k_worst][1]}); "
    f"shouldered block top worst {100 * blocks[k_block][0]:.1f} % (frame {k_block}, {blocks[k_block][1]})")
if edges[k_worst][0] > 0.08:
    raise ValueError(f"fx_fire: frame {k_worst} has a detached emissive region with a flat top {100 * edges[k_worst][0]:.1f} % "
                     "of the frame width (> 8 %)")
meta = fb.write(ctx, color, 8, 8, fps=FPS, loop=True, blend="premultiplied", lit=False, emissive_intensity=6.5,
                soft_fade_m=0.3, size_m=(S, S), atlas_px={"ultra": 2048, "high": 1024, "mobile": 512},
                ground_line=GROUND, ramp=ramp,
                description="Looping flame (Eulerian sim, licking tongues), gradient-mapped premultiplied emission x6.5 + "
                            "slight occlusion, no soot; 64 frames at 24 fps.")
meta["tint"] = "#ffffff"
meta["encoding"] = "lossless"
ctx.meta.update(meta)
ctx.finish()
