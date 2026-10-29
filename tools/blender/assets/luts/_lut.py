"""
Package-local helper (luts): 32^3 grading LUTs as lossless 1024 x 32 strips. OWNER: Technical Artist G (TA-07).

Source precedence per asset id:
  1. docs/art/luts/<id>.cube  - Adobe .cube authored by the Art Director (any LUT_3D_SIZE, resampled to 32)
  2. docs/art/luts/<id>.png   - a strip in our layout (any N, resampled)
  3. interim: generated from GRADE_PRESETS.<preset> (src/render/style/palette.ts, read through @style) with the
     lookdev grade math - render/post.ts GradeShader without the vignette:
        c *= tint; c += (0.04 w, 0.012 w, -0.04 w) * (0.5 + c); c = mix(luma(c), c, saturation);
        c = (c - 0.5) * contrast + 0.5; c += lift * (1 - c); clamp 0..1
Layout (three LUTImageLoader, no flip): blue slice b at x = 32 b, red along x inside the slice, green along y with
green 0 on the top row; lattice (r, g, b) = graded((r, g, b) / 31), 8-bit rounded. Identity is exact.
The strip is display-referred (applied after tone mapping) - see src/assets/loaders/lut.ts.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

from lib import core, texgen as tg

N = 32
F = np.float32


def style(ref: str) -> Any:
    """A style value passed by the runner (SAMRAJYA_STYLE) or evaluated with node for direct runs."""
    env = os.environ.get("SAMRAJYA_STYLE")
    if env:
        values = json.loads(env)
        if ref in values:
            return values[ref]
    out = subprocess.check_output(["node", str(core.REPO_ROOT / "tools/assets/build.mjs"), "--style", ref], cwd=core.REPO_ROOT)
    return json.loads(out)[ref]


def lattice(n: int = N) -> np.ndarray:
    """(n, n, n, 3) inputs indexed [b, g, r] in [0, 1]."""
    v = np.arange(n, dtype=np.float64) / (n - 1)
    b, g, r = np.meshgrid(v, v, v, indexing="ij")
    return np.stack([r, g, b], axis=-1)


def grade(c: np.ndarray, p: dict[str, Any]) -> np.ndarray:
    """Mirror of render/post.ts GradeShader (display space, no vignette)."""
    c = c * np.array(p["tint"], np.float64)
    w = float(p["warmth"])
    c = c + np.array([w * 0.04, w * 0.012, -w * 0.04]) * (0.5 + c)
    lum = c[..., 0:1] * 0.2126 + c[..., 1:2] * 0.7152 + c[..., 2:3] * 0.0722
    c = lum + (c - lum) * float(p["saturation"])
    c = (c - 0.5) * float(p["contrast"]) + 0.5
    c = c + float(p["lift"]) * (1.0 - c)
    return np.clip(c, 0.0, 1.0)


def to_strip(vol: np.ndarray) -> np.ndarray:
    """(n, n, n, 3) indexed [b, g, r] -> (n, n*n, 3) strip: row = g (top = 0), x = b * n + r."""
    n = vol.shape[0]
    return np.transpose(vol, (1, 0, 2, 3)).reshape(n, n * n, 3)


def from_strip(strip: np.ndarray) -> np.ndarray:
    n = strip.shape[0]
    return np.transpose(strip.reshape(n, n, n, 3), (1, 0, 2, 3))


def resample(vol: np.ndarray, n: int = N) -> np.ndarray:
    """Trilinear resample of a [b, g, r] lattice to n^3."""
    m = vol.shape[0]
    if m == n:
        return vol
    x = np.arange(n) / (n - 1) * (m - 1)
    i0 = np.minimum(np.floor(x).astype(int), m - 2)
    t = (x - i0)[:, None]
    out = vol
    for axis in range(3):
        a = np.take(out, i0, axis=axis)
        b = np.take(out, i0 + 1, axis=axis)
        shape = [1, 1, 1, 1]
        shape[axis] = n
        tt = t.reshape(shape)
        out = a * (1 - tt) + b * tt
    return out


def read_cube(path: Path) -> np.ndarray:
    size = 0
    vals: list[list[float]] = []
    dmin, dmax = np.zeros(3), np.ones(3)
    for line in path.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        k = s.split()
        if k[0] == "LUT_3D_SIZE":
            size = int(k[1])
        elif k[0] == "DOMAIN_MIN":
            dmin = np.array([float(x) for x in k[1:4]])
        elif k[0] == "DOMAIN_MAX":
            dmax = np.array([float(x) for x in k[1:4]])
        elif k[0][0].isdigit() or k[0][0] in "-.":
            vals.append([float(x) for x in k[:3]])
    if not size or len(vals) != size ** 3:
        raise ValueError(f"{path}: bad .cube (size {size}, {len(vals)} entries)")
    if np.any(dmin != 0) or np.any(dmax != 1):
        raise ValueError(f"{path}: only DOMAIN 0..1 cubes are supported")
    # .cube order: red fastest, then green, then blue -> [b, g, r]
    return np.array(vals, np.float64).reshape(size, size, size, 3)


def build(script_file: str, preset: str | None) -> None:
    ctx = core.begin(script_file, kind="model")
    ctx.kind = "lut"
    art = core.REPO_ROOT / "docs" / "art" / "luts"
    cube, png = art / f"{ctx.id}.cube", art / f"{ctx.id}.png"
    if cube.exists():
        vol, source = resample(read_cube(cube)), f"docs/art/luts/{ctx.id}.cube"
    elif png.exists():
        im = __import__("bpy").data.images.load(str(png))
        im.colorspace_settings.name = "Non-Color"
        img = tg.image_to_numpy(im)[..., :3]
        vol, source = resample(from_strip(img.astype(np.float64))), f"docs/art/luts/{ctx.id}.png"
    elif preset is None:
        vol, source = lattice(), "identity"
    else:
        vol, source = grade(lattice(), style(f"palette:GRADE_PRESETS.{preset}")), f"GRADE_PRESETS.{preset}"
    strip = to_strip(vol)
    path = tg.write_png(ctx.path(f"{ctx.id}.png"), strip, 8)
    ctx.add_file("lut", path)
    if ctx.preview:
        ctx.add_file("preview", tg.write_png(ctx.path("preview.png"), _preview(vol), 8))
    ident = lattice()
    delta = float(np.abs(np.round(vol * 255) - np.round(ident * 255)).max())
    core.log(f"LUT {ctx.id}: source {source}, max deviation from identity {delta:.0f}/255")
    ctx.meta.update({
        "description": f"32^3 grade LUT ({source}); display-referred, after tone mapping.",
        "size": N,
        "source": source,
        "preset": preset,
        "strength": 1.0 if preset is None else 0.35,
    })
    ctx.finish()


def _preview(vol: np.ndarray) -> np.ndarray:
    """Test chart (hue sweep, grey ramp, earth / skin / foliage / sky swatches): ungraded top, graded bottom."""
    w, h = 768, 96
    u = (np.arange(w) + 0.5) / w
    hue = np.stack([np.clip(np.abs(u * 6 - 3) - 1, 0, 1), np.clip(2 - np.abs(u * 6 - 2), 0, 1),
                    np.clip(2 - np.abs(u * 6 - 4), 0, 1)], axis=-1)
    rows = [np.repeat(hue[None], h // 3, axis=0) * 0.85 + 0.05,
            np.repeat(np.repeat(u[None, :, None], 3, axis=2), h // 3, axis=0)]
    sw = ["#3b2a1e", "#8f5d40", "#c48a63", "#c2a985", "#9c4f3c", "#556b2f", "#6d8f3e", "#a9c0e2", "#e4dac6", "#e8892b",
          "#2c3470", "#1b1813"]
    band = np.zeros((h // 3, w, 3))
    for i, c in enumerate(sw):
        x0, x1 = i * w // len(sw), (i + 1) * w // len(sw)
        band[:, x0:x1] = tg.linear_to_srgb(tg.hex_to_linear(c))
    rows.append(band)
    chart = np.concatenate(rows, axis=0)
    graded = _apply(vol, chart)
    sep = np.full((6, w, 3), 0.1)
    return np.concatenate([chart, sep, graded], axis=0).astype(F)


def _apply(vol: np.ndarray, img: np.ndarray) -> np.ndarray:
    n = vol.shape[0]
    q = np.round(vol * 255) / 255
    f = np.clip(img, 0, 1) * (n - 1)
    i0 = np.minimum(np.floor(f).astype(int), n - 2)
    t = f - i0
    out = np.zeros_like(img)
    for dr in (0, 1):
        for dg in (0, 1):
            for db in (0, 1):
                w_ = (t[..., 0] if dr else 1 - t[..., 0]) * (t[..., 1] if dg else 1 - t[..., 1]) * (t[..., 2] if db else 1 - t[..., 2])
                out += q[i0[..., 2] + db, i0[..., 1] + dg, i0[..., 0] + dr] * w_[..., None]
    return out
