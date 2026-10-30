"""
Decal-atlas helpers (package-local, not an asset). OWNER: Technical Artist A (TA-01).

Re-exports the shared WP1 kit (tools/blender/assets/materials/_matkit.py) and the terrain print shapes
(tools/blender/assets/terrain/_terrainkit.py); decal scripts list both in `@inputs` because the runner hashes
sibling helpers only.

    atlas = Atlas(kit)                                   # kit = Kit(..., cls="A", size=(4, 4))
    rk = atlas.region("kolam_lotus", "kolam", (x0, y0, w, h), surface="ground")
    ...  rk.x / rk.y (0..1 over the region, v up), rk.lu / rk.lv (meters), rk.fbm(...) periodic over the REGION
    atlas.put(rk, opacity=op, height=h, albedo=alb, rough=r)
    kit.finish(**atlas.finish_args(), ...)

Every region is evaluated on its own canvas (noise periodic over the region, so `tileU` strips wrap in u),
normals and AO are computed per region (no slopes across region borders) and the region rects sit on
0.5 m = 256 internal texel boundaries, so the box-filtered tiers (1024 / 512 / 256) never mix two regions.
Opacity goes to ORM.b (`blue: decalOpacity`); albedo carries the decal colour everywhere in the region
(no dark fringes when filtered), height/normal flatten where the opacity is zero.
"""
from __future__ import annotations

import pathlib
import sys
from typing import Any

import numpy as np

_HERE = pathlib.Path(__file__).resolve().parent
for _d in (_HERE.parent / "materials", _HERE.parent / "terrain"):
    if str(_d) not in sys.path:
        sys.path.insert(0, str(_d))

from lib import bake, core, materials, mesh, nodes, render, texgen as tg  # noqa: E402,F401  (hashed: used by _matkit)
import _matkit as K  # noqa: E402
from _terrainkit import shape_foot, shape_hoof  # noqa: E402

F = np.float32


class Atlas:
    def __init__(self, kit: "K.Kit") -> None:
        self.kit = kit
        N = kit.N
        self.N = N
        self.size = kit.size
        self.op = np.zeros((N, N), F)
        self.h = np.zeros((N, N), F)
        self.alb = np.zeros((N, N, 3), F) + K.hexlin("#8a7a66")[None, None, :]
        self.rough = np.full((N, N), 0.9, F)
        self.normal = np.zeros((N, N, 3), F)
        self.normal[..., 2] = 1.0
        self.ao = np.ones((N, N), F)
        self.regions: list[dict[str, Any]] = []

    def region(self, name: str, category: str, rect: tuple[float, float, float, float], surface: str = "any",
               tile_u: bool = False, notes: str = "") -> "K.Kit":
        """A Kit proxy over one atlas rect (x0, y0, w, h in atlas meters, v up): its noise / scatter / bond helpers
        are periodic over the region. Carries the rect for `put`."""
        x0, y0, w, h = rect
        tex = self.kit.texel
        nx, ny = int(round(w / tex)), int(round(h / tex))
        r = object.__new__(K.Kit)
        r.size = (float(w), float(h))
        r.rng = self.kit.rng
        r.texel = tex
        r.N = max(nx, ny)
        r.x, r.y = tg.coords(ny, nx, 1.0, 1.0)
        r.lu = (r.x * w).astype(F)
        r.lv = (r.y * h).astype(F)
        r.rect = rect
        r.meta = dict(name=name, category=category, surface=surface, tileU=tile_u, notes=notes)
        return r

    def put(self, rk: "K.Kit", opacity: np.ndarray, height: np.ndarray, albedo: np.ndarray, rough: np.ndarray,
            ao_radius: float = 0.02) -> None:
        x0, y0, w, h = rk.rect
        S = self.size[1]
        tex = self.kit.texel
        r0 = int(round((S - (y0 + h)) / tex))
        c0 = int(round(x0 / tex))
        ny, nx = rk.x.shape
        op = np.clip(opacity, 0.0, 1.0).astype(F)
        hh = (height * tg.smoothstep(0.0, 0.08, op)).astype(F)
        sl = (slice(r0, r0 + ny), slice(c0, c0 + nx))
        self.op[sl] = op
        self.h[sl] = hh
        self.alb[sl] = np.clip(albedo, 0.0, 1.0)
        self.rough[sl] = rough
        self.normal[sl] = tg.normal_from_height(hh, tex)
        ao = tg.horizon_ao(hh, tex, ao_radius, 8, 6) if float(np.ptp(hh)) > 1e-5 else np.ones_like(hh)
        self.ao[sl] = np.clip(tg.blur(ao, 0.7), 0.0, 1.0)
        W = self.size[0]
        m = dict(rk.meta)
        m.update(u0=round(x0 / W, 6), v0=round(y0 / S, 6), u1=round((x0 + w) / W, 6), v1=round((y0 + h) / S, 6),
                 sizeMeters=[round(w, 4), round(h, 4)])
        self.regions.append(m)
        core.log(f"decal {m['name']}: rect u {m['u0']}-{m['u1']} v {m['v0']}-{m['v1']} coverage {float(op.mean()):.3f}")

    def finish_args(self) -> dict[str, Any]:
        return dict(height=self.h, albedo=self.alb, rough=self.rough, ao=self.ao, normal=self.normal, orm_b=self.op,
                    orm_b_usage="decalOpacity", decals=self.regions, calibrate=False, remap_rough=False,
                    rough_blur_px=0.0, height_soften_px=0.0)


# ------------------------------------------------------------------ line-art helpers (implicit curves)
def iso_line(f: np.ndarray, level: float, half_width: float, texel: float) -> np.ndarray:
    """Coverage of the curve f = level with a half width in meters (distance ~ |f - level| / |grad f|)."""
    gy, gx = np.gradient(f.astype(F), texel)
    g = np.sqrt(gx * gx + gy * gy)
    d = np.abs(f - level) / np.maximum(g, 1e-6)
    return tg.smoothstep(half_width, half_width * 0.35, d).astype(F)


def dist_line(d: np.ndarray, half_width: float) -> np.ndarray:
    return tg.smoothstep(half_width, half_width * 0.35, d).astype(F)


def dots(lu: np.ndarray, lv: np.ndarray, centers: list[tuple[float, float]], radius: float) -> np.ndarray:
    out = np.zeros(lu.shape, F)
    for cx, cy in centers:
        d = np.sqrt((lu - cx) ** 2 + (lv - cy) ** 2)
        out = np.maximum(out, tg.smoothstep(radius, radius * 0.5, d))
    return out


__all__ = ["Atlas", "K", "dist_line", "dots", "iso_line", "shape_foot", "shape_hoof"]
