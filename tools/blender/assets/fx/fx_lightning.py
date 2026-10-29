"""
@asset fx_lightning
@kind flipbook
@tiers ultra,high

Four lightning bolt sprites for monsoon storms (4 x 1 atlas of 256 px = 1024 x 256, ASSET_LIST WP7-16, P2): recursive
midpoint-displacement bolts with forking branches, a white core and a cool violet glow (ART_BIBLE §6 varsha storm
light). Drawn on tall quads (~1-2 km in the distance) for 2-4 flicker frames while the weather system flashes the
sky. Additive (premultiplied emission x emissiveIntensity 10). High / ultra only: the mobile tier keeps the
procedural sky flash. The main channel strikes the ground: it runs to the bottom edge of its frame (`open_edges: bottom`, the quad's
bottom sits on the horizon / terrain); the top (cloud base) and the sides fade to 0 before the border. One ROW of
frames, so every open bottom edge lies on the atlas border (clamped) and never touches another frame's closed edge:
in the old 2 x 2 layout the strikes of bolt0 / bolt1 bled into the top edge of bolt2 / bolt3 (lossy WebP 8-10/255,
and texture filtering / mipmaps at runtime - a white blip above those bolts). Published lossless (thin cores
keep their colour). OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402

ctx = fb.begin(__file__)
PX = 512  # supersampled, published at 256 px frames
x, y = kit.coords(PX)
frames: list = []


def bolt(rng: np.random.Generator, a: np.ndarray, b: np.ndarray, rough: float, depth: int) -> list[np.ndarray]:
    """Midpoint displacement polyline a -> b."""
    pts = [a, b]
    off = rough
    for _ in range(depth):
        nxt = [pts[0]]
        for p, q in zip(pts[:-1], pts[1:]):
            d = q - p
            nrm = np.array([-d[1], d[0]]) / max(float(np.hypot(*d)), 1e-6)
            mid = (p + q) / 2 + nrm * rng.normal(0, off) * float(np.hypot(*d))
            nxt += [mid, q]
        pts = nxt
        off *= 0.62
    return pts


def draw(pts: list[np.ndarray], width: float, gain: float, acc: np.ndarray) -> None:
    for p, q in zip(pts[:-1], pts[1:]):
        # bounding-box limited segment distance for speed
        x0, x1 = min(p[0], q[0]) - width * 6, max(p[0], q[0]) + width * 6
        y0, y1 = min(p[1], q[1]) - width * 6, max(p[1], q[1]) + width * 6
        c0 = int(max(0, (x0 + 1) / 2 * PX))
        c1 = int(min(PX, (x1 + 1) / 2 * PX + 1))
        r0 = int(max(0, (1 - y1) / 2 * PX))
        r1 = int(min(PX, (1 - y0) / 2 * PX + 1))
        if c1 <= c0 or r1 <= r0:
            continue
        xs = x[r0:r1, c0:c1]
        ys = y[r0:r1, c0:c1]
        d = fb.segment_distance(xs, ys, p, q)
        acc[r0:r1, c0:c1] = np.maximum(acc[r0:r1, c0:c1], np.exp(-(d / width) ** 2) * gain)


for k in range(4):
    rng = np.random.default_rng(100 + k)
    core = np.zeros_like(x)
    top = np.array([rng.uniform(-0.25, 0.25), 0.98])
    bottom = np.array([rng.uniform(-0.3, 0.3), -1.08])  # past the bottom edge: the strike reaches the ground
    main = bolt(rng, top, bottom, 0.16, 7)
    draw(main, 0.008, 1.0, core)
    for _ in range(int(rng.integers(3, 6))):
        i = int(rng.integers(len(main) // 6, len(main) * 3 // 4))
        p = main[i]
        ang = -np.pi / 2 + rng.choice([-1, 1]) * rng.uniform(0.35, 0.9)
        L = rng.uniform(0.25, 0.6)
        q = p + np.array([np.cos(ang), np.sin(ang)]) * L
        br = bolt(rng, p, q, 0.2, 5)
        draw(br, 0.005, rng.uniform(0.45, 0.75), core)
    glow = fb.blur2(core, 10.0) * 2.2 + fb.blur2(core, 3.0) * 0.8
    i = np.clip(core * 1.4 + glow, 0, 1.6)
    # the top (cloud base) and the sides fade to exactly 0 before the border; the bottom stays open (ground strike)
    i *= kit.smoothstep(0.96, 0.8, y) * kit.smoothstep(0.94, 0.78, np.abs(x))
    frames.append(kit.emissive_frame(i, "#ffffff", "#9a8cff", 0.6))

seqs = [{"name": f"bolt{k}", "start": k, "count": 1, "fps": 1, "loop": True, "open_edges": ["bottom"]} for k in range(4)]
meta = fb.write(ctx, frames, 4, 1, fps=1, loop=True, sequences=seqs, blend="additive", lit=False, emissive_intensity=10.0,
                soft_fade_m=0.0, size_m=(600.0, 1200.0), atlas_px={"ultra": 1024, "high": 1024},
                labels=kit.label_sequences(seqs), srgb=True,
                description="Four forked lightning bolts, white core + violet glow, additive x10 (high / ultra only).")
meta["tint"] = "#ffffff"
meta["encoding"] = "lossless"
ctx.meta.update(meta)
ctx.finish()
