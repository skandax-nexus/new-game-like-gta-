"""
@asset fx_dust
@kind flipbook

Dust for marching feet, hooves, construction and heavy landings (8 x 8 atlas, four one-shot sequences of 16 frames,
ASSET_LIST WP7-10, ART_BIBLE §10 "low and wide, drifts downwind"): Eulerian dust simulations (lib/flipbook FluidSim
with a free-slip ground) rendered noise-free as a neutral, occlusion-only albedo plus density-gradient normals, so
the runtime tints by the ground color (sample the splat albedo, lighten 15 %) and lights it with the sun.
  `puff`, `puff_b`  a dome of kicked-up dust whose wall jet rolls outward along the ground into rounded billowing
                    lobes and drifts downwind (+x); low and wide (width : height ~2 : 1); the ground contact fades
                    over 14 cm, so there is no straight base edge
  `ring`            the construction-completion / heavy-landing ring seen from above: a symmetric radial wall jet
                    (no wind, no mean drift) that stays a closed, centred ring while it expands to ~2 m
  `hoof`            a hoof / wheel kick: grains and clods thrown backwards (+x) in low ballistic arcs (<= ~0.23 m) over
                    a low dust jet that rolls out along the ground; the grains land into the rolling puff
Lit as a medium (Art Director TA-07 R2-B1, as fx_smoke): normals from the density blurred by 3.5 % of the frame,
tilt faded with alpha (smoothstep 0.1-0.7) at strength 0.55 - mean normal z >= 0.8 where alpha > 0.1 on every frame
(lit-medium guard), so golden light reads as soft lit dust, never gilded rock with black pockets.
Every frame keeps its border clear (flipbook border guard). Atlas 1024 / 1024 / 512. OWNER: Technical Artist G (TA-07).
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
H = 0.022 if not ctx.draft else 0.045
PX = 128 if not ctx.draft else 64
N = 16
ALBEDO = (0.74, 0.72, 0.69)
color: list = []
normals: list = []
sequences: list = []


def spray(c: list, n: list, seed: int, frame: tuple, dur: float, count: int = 40) -> None:
    """Hoof kick: grains / clods thrown backwards (+x) and up from the hoof, flying ballistic arcs (gravity, low: <= ~0.2 m)
    and landing into the rolling puff the sim makes - drawn as motion-blurred soft specks composited over the dust
    frames (darker than the dust, facing normals). Every grain lands inside the frame (flight <= 0.43 s, x <= 0.62 m)."""
    rng = np.random.default_rng(seed)
    cx, cz, size = frame
    u0, v_top = cx - size / 2, cz + size / 2
    jj, ii = np.mgrid[0:PX, 0:PX].astype(np.float32)
    win = fb.frame_window(PX, 0.02, 0.06)
    grains = [(rng.uniform(-0.62, -0.46), rng.uniform(0.04, 0.09), rng.uniform(1.0, 2.5), rng.uniform(0.8, 2.1),
               rng.uniform(0.0, 0.16), rng.uniform(0.012, 0.028), rng.uniform(0.55, 1.0)) for _ in range(count)]
    dt = dur / N
    for f in range(N):
        t = (f + 1) * dt
        ag = np.zeros((PX, PX), np.float32)
        for x0, z0, vx, vz, delay, rad, amp in grains:
            tt = t - delay
            if tt <= 0:
                continue
            pos = lambda q: (x0 + vx * q, z0 + vz * q - 4.9 * q * q)  # noqa: E731
            xa, za = pos(max(0.0, tt - 0.03))
            xb, zb = pos(tt)
            if zb < 0.03:
                continue  # landed: absorbed by the rolling puff
            # world -> pixel (front view: x right, z up)
            pa = np.array([(xa - u0) / size * PX, (v_top - za) / size * PX])
            pb = np.array([(xb - u0) / size * PX, (v_top - zb) / size * PX])
            d = fb.segment_distance(ii, jj, pa, pb)
            r_px = rad / size * PX
            fade = min(1.0, (zb - 0.03) / 0.08)
            ag = np.maximum(ag, (np.exp(-(d / max(r_px, 0.6)) ** 2) * amp * fade).astype(np.float32))
        ag = ag * win
        cf = c[f]
        ap = cf[..., 3]
        ao = ag + ap * (1.0 - ag)
        w = np.where(ao > 1e-5, ag / np.maximum(ao, 1e-5), 0.0)[..., None]
        grain_rgb = np.array(ALBEDO, np.float32) * 0.3  # clods read darker than the dust
        cf[..., :3] = cf[..., :3] * (1.0 - w) + grain_rgb * w
        cf[..., 3] = ao
        nf = n[f]
        flat = np.array([0.5, 0.5, 1.0], np.float32)
        base = np.where((nf[..., :3] == 0).all(axis=-1, keepdims=True), flat, nf[..., :3])
        nf[..., :3] = np.where(ao[..., None] > 1e-5, base * (1.0 - w) + flat * w, nf[..., :3])


def run(name: str, kind: str, seed: int, dur: float, *, jet: float, up: float, temp: float, buoy: float, weight: float,
        damp: float, exp: float, wind: float, size: float, width: float = 0.42, height: float = 0.25, vort: float = 4.0) -> None:
    rng = np.random.default_rng(seed)
    if kind == "ring":
        S = 3.6
        shape, ext = kit.sim_box((S * 1.15, S * 1.15, 0.9), H)
        view, frame = "top", (0.0, 0.0, S)
    else:
        S = size
        shape, ext = kit.sim_box((S * 1.25, S * 0.7, S * 0.6), H)
        view, frame = "front", ((0.2 if kind == "puff" else 0.12) * S / 2.2, S / 2 - 0.05, S)
    sim = fb.FluidSim(shape, ext, floor=True, vorticity=vort, sponge=0.06, sponge_top=0.08)
    x, y, z = sim.world()
    nz = fb.value_noise3(shape, 0.08 / H, seed, octaves=3)
    kick = 0.6 + 0.8 * fb.value_noise3(shape, 0.2 / H, seed + 50, octaves=2)  # uneven jet -> irregular lobes
    rh = np.maximum(np.sqrt(x ** 2 + y ** 2), 1e-3)
    if kind == "puff":
        # a dome: wide at the ground, narrower at the top
        q = np.sqrt((x / (width * (1.15 - 0.5 * z / height))) ** 2 + (y / width) ** 2 + ((z - 0.06) / height) ** 2)
        d = np.clip((1 - q) / 0.35, 0, 1) * (0.4 + 1.2 * nz)
        sim.vel[0] = d * x / rh * jet * kick
        sim.vel[1] = d * y / rh * jet * kick
        sim.vel[2] = d * up * kick
        w = (wind, 0.0, 0.0)
    elif kind == "ring":
        q = np.sqrt(((rh - 0.34) / width) ** 2 + ((z - 0.1) / 0.14) ** 2)
        d = np.clip((1 - q) / 0.4, 0, 1) * (0.4 + 1.2 * nz)
        sim.vel[0] = d * x / rh * jet * kick
        sim.vel[1] = d * y / rh * jet * kick
        sim.vel[2] = d * up
        w = (0.0, 0.0, 0.0)
    else:  # hoof: kicked backwards (+x) and up, faster at the back -> a stretched spray
        q = np.sqrt(((x + 0.55) / width) ** 2 + (y / width) ** 2 + ((z - 0.1) / (width * 0.8)) ** 2)
        d = np.clip((1 - q) / 0.4, 0, 1) * (0.4 + 1.2 * nz)
        stretch = np.clip(1.0 + (x + 0.55) / width, 0.3, 2.0)
        sim.vel[0] = d * jet * kick * stretch
        sim.vel[1] = d * rng.normal(0, 0.3) * kick
        sim.vel[2] = d * up * kick
        w = (wind, 0.0, 0.0)
    sim.dens = d.astype(np.float32)
    sim.temp = (d * temp).astype(np.float32)
    # fine detail carried by the flow (stretched into grainy wisps), multiplied into the rendered density
    sim.fields["detail"] = fb.value_noise3(shape, 0.05 / H, seed + 31, octaves=3)
    frames = []
    dt = dur / N
    with timer(f"dust {name} sim {shape}"):
        for _ in range(N):
            sim.step(dt, buoyancy=buoy, weight=weight, vorticity=vort, cooling=1.0, dissipation=0.05, damping=damp, wind=w,
                     expansion=exp * math.exp(-sim.t / 0.35), substeps=3)
            frames.append((sim.dens * np.clip(0.5 + sim.fields["detail"], 0, None)).astype(np.float32))
    # soft, ragged ground contact: the ground line g0 wanders -4..+30 cm along the ground (noise), then a 12 cm soft
    # fade above it - no straight base edge (the old puffs sat on a hard flat base)
    gn = fb.value_noise3((shape[0], shape[1], 1), 0.2 / H, seed + 77, octaves=2)[:, :, 0]
    gf = (-0.04 + 0.34 * kit.smooth01((gn - 0.25) / 0.5)) if view == "front" else 0.0
    c, n, worst = kit.lit_frames(frames, ext, H, PX, view=view, frame=frame, depth=2.6, albedo=ALBEDO, flatten=0.55,
                                 fades=kit.life_fade(N, 0.08, 0.35), normal_blur_frac=0.035, normal_fade=(0.1, 0.7),
                                 normal_strength=0.55, ground_fade=gf)
    if kind == "hoof":
        spray(c, n, seed + 5, frame, dur)
    for i in (5, 10):
        ys, xs = np.nonzero(c[i][..., 3] > 0.1)
        if len(xs):
            log(f"dust {name} frame {i}: width : height {(xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1):.2f}, "
                f"straight base {100 * kit.straight_base_fraction(c[i][..., 3]):.0f} % of the frame width")
    log(f"dust {name}: pre-window border alpha {worst * 255:.2f}/255")
    sequences.append({"name": name, "start": len(color), "count": N, "fps": round(N / dur, 3), "loop": False})
    color.extend(c)
    normals.extend(n)


run("puff", "puff", 5, 2.5, jet=2.2, up=1.6, temp=0.8, buoy=2.2, weight=0.25, damp=0.25, exp=4.0, wind=0.3, size=2.2,
    width=0.45, height=0.3)
run("puff_b", "puff", 9, 2.5, jet=2.2, up=1.7, temp=0.85, buoy=2.4, weight=0.25, damp=0.25, exp=3.8, wind=0.25, size=2.2,
    width=0.42, height=0.3)
run("ring", "ring", 21, 2.0, jet=4.5, up=0.8, temp=0.5, buoy=1.2, weight=0.2, damp=0.15, exp=2.5, wind=0.0, size=3.6, width=0.18)
run("hoof", "hoof", 13, 1.6, jet=8.0, up=0.7, temp=0.1, buoy=0.4, weight=1.8, damp=0.3, exp=0.5, wind=0.2, size=2.2, width=0.2,
    vort=6.0)

meta = fb.write(ctx, color, 8, 8, fps=8, loop=False, sequences=sequences, normals=normals, blend="alpha", lit=True, min_normal_z=0.8,
                soft_fade_m=0.5, size_m=(2.2, 2.2), atlas_px={"ultra": 1024, "high": 1024, "mobile": 512},
                ground_line=round(0.05 / 2.2, 4),  # front-view sequences: ground 5 cm above the frame bottom (ring: top view)
                labels=kit.label_sequences(sequences),
                description="Dust (Eulerian sims): rolling ground puffs (2), closed expanding ring (top view), hoof kick; "
                            "neutral albedo + normals, tint by ground.")
meta["tint"] = "#b0956e"
ctx.meta.update(meta)
ctx.finish()
