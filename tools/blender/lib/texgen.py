"""
numpy texture synthesis ("Substance Designer in numpy"). OWNER: Technical Art Director.

Conventions
    * Images are float32 numpy arrays, TOP-DOWN (row 0 = top of the image = UV v=1), shape (h, w)
      or (h, w, c). Blender image pixels are bottom-up: use to_blender()/from_blender().
    * Everything periodic (wraps at the borders) so tiling textures are seamless: noise lattices
      use integer frequencies, blurs are FFT-based, derivatives use np.roll.
    * Heights are in METERS; texel_m = physical size of one texel.
    * Normal maps: tangent space, OpenGL / glTF convention (+X right = +U, +Y up = +V).
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import Iterable

import numpy as np

F = np.float32


# ----------------------------------------------------------------------------------------- basics
def saturate(x: np.ndarray) -> np.ndarray:
    return np.clip(x, 0.0, 1.0)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = saturate((x - e0) / (e1 - e0))
    return t * t * (3.0 - 2.0 * t)


def remap(x: np.ndarray, a0: float, a1: float, b0: float = 0.0, b1: float = 1.0) -> np.ndarray:
    return b0 + (x - a0) * (b1 - b0) / (a1 - a0)


def lerp(a, b, t):
    return a + (b - a) * t


def coords(h: int, w: int, size_x: float = 1.0, size_y: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Texel-center coordinates: x in [0,size_x) left->right, y in [0,size_y) BOTTOM->TOP (UV-like)."""
    x = ((np.arange(w, dtype=F) + 0.5) / w) * size_x
    y = (1.0 - (np.arange(h, dtype=F) + 0.5) / h) * size_y
    return np.broadcast_to(x[None, :], (h, w)).copy(), np.broadcast_to(y[:, None], (h, w)).copy()


def normalize01(x: np.ndarray) -> np.ndarray:
    lo, hi = float(x.min()), float(x.max())
    return (x - lo) / max(hi - lo, 1e-8)


# ----------------------------------------------------------------------------------- periodic noise
def _fade(t: np.ndarray) -> np.ndarray:
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def perlin(x: np.ndarray, y: np.ndarray, period: tuple[int, int], rng: np.random.Generator) -> np.ndarray:
    """Periodic gradient noise. x, y in lattice units; repeats every `period` cells. Range ~[-1, 1]."""
    px, py = period
    ang = rng.uniform(0.0, 2.0 * np.pi, (py, px)).astype(F)
    gx, gy = np.cos(ang), np.sin(ang)
    xi = np.floor(x)
    yi = np.floor(y)
    xf = (x - xi).astype(F)
    yf = (y - yi).astype(F)
    x0 = xi.astype(np.int64) % px
    y0 = yi.astype(np.int64) % py
    x1 = (x0 + 1) % px
    y1 = (y0 + 1) % py

    def d(yy, xx, dx, dy):
        return gx[yy, xx] * dx + gy[yy, xx] * dy

    n00 = d(y0, x0, xf, yf)
    n10 = d(y0, x1, xf - 1.0, yf)
    n01 = d(y1, x0, xf, yf - 1.0)
    n11 = d(y1, x1, xf - 1.0, yf - 1.0)
    u = _fade(xf)
    v = _fade(yf)
    return (lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4142).astype(F)


def fbm(
    x: np.ndarray,
    y: np.ndarray,
    base: tuple[int, int] | int,
    octaves: int,
    rng: np.random.Generator,
    gain: float = 0.5,
    lacunarity: int = 2,
    ridged: bool = False,
) -> np.ndarray:
    """Periodic fractal noise. x, y in TILE units ([0,1) = one tile); `base` = cells per tile.
    Returns roughly [-1, 1] (ridged: [0, 1])."""
    bx, by = (base, base) if isinstance(base, int) else base
    total = np.zeros_like(x, dtype=F)
    amp, norm = 1.0, 0.0
    fx, fy = bx, by
    for _ in range(octaves):
        n = perlin(x * fx, y * fy, (fx, fy), rng)
        if ridged:
            n = 1.0 - np.abs(n)
            n = n * n
        total += n * amp
        norm += amp
        amp *= gain
        fx *= lacunarity
        fy *= lacunarity
    return (total / norm).astype(F)


def worley(
    x: np.ndarray, y: np.ndarray, cells: tuple[int, int] | int, rng: np.random.Generator, jitter: float = 1.0
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Periodic cellular noise. x, y in tile units. Returns (F1, F2, cell_random[0..1]) with distances in
    cell units. F2-F1 ~ distance to the cell border (cracks, flagstones)."""
    cx, cy = (cells, cells) if isinstance(cells, int) else cells
    jx = rng.uniform(0.5 - 0.5 * jitter, 0.5 + 0.5 * jitter, (cy, cx)).astype(F)
    jy = rng.uniform(0.5 - 0.5 * jitter, 0.5 + 0.5 * jitter, (cy, cx)).astype(F)
    rid = rng.uniform(0.0, 1.0, (cy, cx)).astype(F)
    X = x * cx
    Y = y * cy
    ix = np.floor(X).astype(np.int64)
    iy = np.floor(Y).astype(np.int64)
    f1 = np.full(X.shape, 9.0, F)
    f2 = np.full(X.shape, 9.0, F)
    idv = np.zeros(X.shape, F)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            nx = ix + ox
            ny = iy + oy
            wx = nx % cx
            wy = ny % cy
            px = nx + jx[wy, wx]
            py = ny + jy[wy, wx]
            d = np.sqrt((X - px) ** 2 + (Y - py) ** 2).astype(F)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            idv = np.where(closer, rid[wy, wx], idv)
            f1 = np.where(closer, d, f1)
    return f1, f2, idv


def warp(x: np.ndarray, y: np.ndarray, amount: float, base: int, octaves: int, rng: np.random.Generator):
    """Periodic domain warp (tile units)."""
    wx = fbm(x, y, base, octaves, rng)
    wy = fbm(x, y, base, octaves, rng)
    return x + wx * amount, y + wy * amount


# -------------------------------------------------------------------------------- filters (periodic)
def blur(img: np.ndarray, sigma_px: float) -> np.ndarray:
    """Exact periodic Gaussian blur via FFT (works on (h,w) or (h,w,c))."""
    if sigma_px <= 0:
        return img.copy()
    h, w = img.shape[:2]
    ky = np.fft.fftfreq(h)[:, None]
    kx = np.fft.rfftfreq(w)[None, :]
    g = np.exp(-2.0 * (np.pi**2) * (sigma_px**2) * (kx**2 + ky**2))
    if img.ndim == 2:
        return np.fft.irfft2(np.fft.rfft2(img) * g, s=(h, w)).astype(F)
    out = np.empty_like(img)
    for c in range(img.shape[2]):
        out[..., c] = np.fft.irfft2(np.fft.rfft2(img[..., c]) * g, s=(h, w))
    return out.astype(F)


def directional_blur_down(img: np.ndarray, length_px: int, decay: float = 0.97) -> np.ndarray:
    """Streaks running DOWN the image (rain/water staining under ledges). Periodic."""
    out = img.copy()
    acc = img.copy()
    k = 1.0
    for _ in range(max(1, length_px)):
        acc = np.roll(acc, 1, axis=0) * decay
        out = np.maximum(out, acc)
        k *= decay
    return out


def gradient(h: np.ndarray, texel_m: float) -> tuple[np.ndarray, np.ndarray]:
    """d/du (right) and d/dv (UP) of a top-down periodic height map, in m/m."""
    dhdu = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2.0 * texel_m)
    dhdv = (np.roll(h, 1, axis=0) - np.roll(h, -1, axis=0)) / (2.0 * texel_m)
    return dhdu.astype(F), dhdv.astype(F)


def normal_from_height(h: np.ndarray, texel_m: float, strength: float = 1.0) -> np.ndarray:
    """Tangent-space normal (OpenGL, +Y up) from a height map in meters. Returns (h,w,3) in [-1,1]."""
    du, dv = gradient(h, texel_m)
    n = np.stack([-du * strength, -dv * strength, np.ones_like(du)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n.astype(F)


def encode_normal(n: np.ndarray) -> np.ndarray:
    return (n * 0.5 + 0.5).astype(F)


def decode_normal(rgb: np.ndarray) -> np.ndarray:
    n = rgb[..., :3] * 2.0 - 1.0
    return (n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)).astype(F)


def blend_normals(base: np.ndarray, detail: np.ndarray) -> np.ndarray:
    """Reoriented normal mapping (RNM) of two decoded tangent-space normals."""
    t = base + np.array([0, 0, 1], F)
    u = detail * np.array([-1, -1, 1], F)
    r = t * np.sum(t * u, axis=-1, keepdims=True) / t[..., 2:3] - u
    return (r / np.linalg.norm(r, axis=-1, keepdims=True)).astype(F)


def cavity(h: np.ndarray, sigma_px: float) -> np.ndarray:
    """Signed local relief: >0 on ridges/convex, <0 in recesses (meters)."""
    return (h - blur(h, sigma_px)).astype(F)


def curvature(h: np.ndarray, texel_m: float, sigma_px: float = 1.5) -> np.ndarray:
    """Mean curvature-ish (negative Laplacian of slightly blurred height): >0 convex edges."""
    b = blur(h, sigma_px)
    lap = np.roll(b, 1, 0) + np.roll(b, -1, 0) + np.roll(b, 1, 1) + np.roll(b, -1, 1) - 4.0 * b
    return (-lap / (texel_m * texel_m)).astype(F)


def horizon_ao(h: np.ndarray, texel_m: float, radius_m: float, directions: int = 8, steps: int = 10) -> np.ndarray:
    """Cheap periodic horizon-based AO from a height map (fallback when Cycles AO is not baked)."""
    hh, ww = h.shape
    occl = np.zeros_like(h)
    for k in range(directions):
        a = 2.0 * np.pi * (k + 0.5) / directions
        dx, dy = np.cos(a), np.sin(a)
        best = np.full_like(h, -1e9)
        for s in range(1, steps + 1):
            r = radius_m * s / steps
            ox = int(round(dx * r / texel_m))
            oy = int(round(dy * r / texel_m))
            if ox == 0 and oy == 0:
                continue
            sample = np.roll(np.roll(h, -oy, axis=0), -ox, axis=1)
            dist = max(np.hypot(ox, oy) * texel_m, 1e-6)
            best = np.maximum(best, (sample - h) / dist)
        occl += np.clip(np.sin(np.arctan(np.maximum(best, 0.0))), 0.0, 1.0)
    return (1.0 - occl / directions).astype(F)


def resize(img: np.ndarray, h: int, w: int) -> np.ndarray:
    """Area/bilinear resize (periodic-safe enough for downsampling by integer factors)."""
    sh, sw = img.shape[:2]
    if sh % h == 0 and sw % w == 0:
        fy, fx = sh // h, sw // w
        shape = (h, fy, w, fx) + img.shape[2:]
        return img.reshape(shape).mean(axis=(1, 3)).astype(F)
    ys = (np.arange(h) + 0.5) * sh / h - 0.5
    xs = (np.arange(w) + 0.5) * sw / w - 0.5
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    ty = (ys - y0)[:, None]
    tx = (xs - x0)[None, :]
    if img.ndim == 3:
        ty = ty[..., None]
        tx = tx[..., None]
    y0m, y1m = y0 % sh, (y0 + 1) % sh
    x0m, x1m = x0 % sw, (x0 + 1) % sw
    a = img[y0m][:, x0m]
    b = img[y0m][:, x1m]
    c = img[y1m][:, x0m]
    d = img[y1m][:, x1m]
    return (lerp(lerp(a, b, tx), lerp(c, d, tx), ty)).astype(F)


# ------------------------------------------------------------------------------------ color
def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = np.asarray(c, dtype=F)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(F)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(np.asarray(c, dtype=F), 0.0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055).astype(F)


def hex_to_linear(hexstr: str) -> np.ndarray:
    v = int(hexstr.lstrip("#"), 16)
    rgb = np.array([(v >> 16) & 255, (v >> 8) & 255, v & 255], F) / 255.0
    return srgb_to_linear(rgb)


def linear_to_hex(rgb: Iterable[float]) -> str:
    s = linear_to_srgb(np.array(list(rgb), F))
    r, g, b = (int(round(float(np.clip(v, 0, 1)) * 255)) for v in s)
    return f"#{r:02x}{g:02x}{b:02x}"


def gradient_map(t: np.ndarray, stops: list[tuple[float, str]]) -> np.ndarray:
    """Map a scalar field through a color ramp of (position, sRGB hex) stops -> LINEAR rgb."""
    pos = np.array([p for p, _ in stops], F)
    cols = np.stack([hex_to_linear(c) for _, c in stops])
    out = np.empty(t.shape + (3,), F)
    for ch in range(3):
        out[..., ch] = np.interp(t, pos, cols[:, ch])
    return out


def luminance(rgb: np.ndarray) -> np.ndarray:
    return (rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722).astype(F)


# ------------------------------------------------------------------------------------ image IO
def write_png(path: Path | str, img: np.ndarray, bits: int = 8, srgb_encode: bool = False) -> Path:
    """Write a top-down float image [0,1] as PNG (gray / gray+alpha / RGB / RGBA; 8 or 16 bit).
    `srgb_encode` applies the sRGB OETF first (for LINEAR color data such as base color)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    a = np.asarray(img, dtype=F)
    if srgb_encode:
        a = a.copy()
        a[..., :3] = linear_to_srgb(a[..., :3]) if a.ndim == 3 else linear_to_srgb(a)
    if a.ndim == 2:
        a = a[..., None]
    h, w, c = a.shape
    color_type = {1: 0, 2: 4, 3: 2, 4: 6}[c]
    maxv = 255 if bits == 8 else 65535
    q = np.clip(np.round(a * maxv), 0, maxv)
    data = q.astype(np.uint8) if bits == 8 else q.astype(">u2")
    rows = data.reshape(h, w * c).view(np.uint8).reshape(h, -1)
    # PNG "Up" filter (type 2) on every row: much better zlib ratio for smooth images.
    up = rows.astype(np.int16)
    up[1:] -= rows[:-1].astype(np.int16)
    filtered = (up & 0xFF).astype(np.uint8)
    raw = np.concatenate([np.full((h, 1), 2, np.uint8), filtered], axis=1).tobytes()

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, bits, color_type, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 6))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)
    return path


def to_blender(img: np.ndarray) -> np.ndarray:
    """Top-down (h,w[,c]) -> flat bottom-up RGBA float32 for bpy Image.pixels.foreach_set."""
    a = np.asarray(img, dtype=F)
    if a.ndim == 2:
        a = np.stack([a, a, a], axis=-1)
    if a.shape[2] == 3:
        a = np.concatenate([a, np.ones(a.shape[:2] + (1,), F)], axis=-1)
    return np.ascontiguousarray(a[::-1]).reshape(-1)


def from_blender(flat: np.ndarray, w: int, h: int, channels: int = 4) -> np.ndarray:
    """Flat bottom-up RGBA (bpy Image.pixels) -> top-down (h,w,channels)."""
    return np.asarray(flat, dtype=F).reshape(h, w, 4)[::-1, :, :channels].copy()


def image_to_numpy(image) -> np.ndarray:
    """bpy Image -> top-down float RGBA array (values as stored: linear for float buffers)."""
    w, h = image.size
    buf = np.empty(w * h * 4, F)
    image.pixels.foreach_get(buf)
    return from_blender(buf, w, h, 4)


def numpy_to_image(img: np.ndarray, name: str, non_color: bool = True, float_buffer: bool = True):
    """Create (or replace) a bpy Image from a top-down array (for use in shader nodes)."""
    import bpy

    h, w = img.shape[:2]
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    im = bpy.data.images.new(name, w, h, alpha=True, float_buffer=float_buffer)
    im.colorspace_settings.name = "Non-Color" if non_color else "Linear Rec.709"
    im.pixels.foreach_set(to_blender(img))
    return im


__all__ = [
    "blend_normals",
    "blur",
    "cavity",
    "coords",
    "curvature",
    "decode_normal",
    "directional_blur_down",
    "encode_normal",
    "fbm",
    "from_blender",
    "gradient",
    "gradient_map",
    "hex_to_linear",
    "horizon_ao",
    "image_to_numpy",
    "lerp",
    "linear_to_hex",
    "linear_to_srgb",
    "luminance",
    "normal_from_height",
    "normalize01",
    "numpy_to_image",
    "perlin",
    "remap",
    "resize",
    "saturate",
    "smoothstep",
    "srgb_to_linear",
    "to_blender",
    "warp",
    "worley",
    "write_png",
]
