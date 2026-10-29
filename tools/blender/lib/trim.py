"""
Trim-sheet modeling: build architecture from swept profiles whose UVs land on named bands of a trim
sheet (e.g. sandstone_carved_red: ashlar, vine_scroll, dentil, padma, bead_reel, medallion_frieze)
or on decal regions (single motifs such as lotus medallions / spiral rosettes). OWNER: Technical Art
Director.

    sheet = trim.Sheet.from_dependency(ctx.dep("sandstone_carved_red"))
    tm = trim.TrimMesh(sheet)
    tm.ring([trim.Run([(7.6, 0), (7.6, 0.32)], "ashlar_base"), ...], segments=128, mat="stone")
    tm.path([trim.Run(rect_profile, "medallion_frieze")], [(-2, 0, 4), (2, 0, 4)], up=(0, 0, 1), mat="stone")
    tm.box(center, size, mat=..., bands={...})
    objs = tm.build("stupa")            # one Blender object per material slot

Conventions
    * Profiles are CLOSED or open polylines in their 2D plane, ordered counter-clockwise around the
      solid (outer walls go up, tops go inwards, inner walls go down, bottoms go outwards) so faces
      point outwards. Each Run is a stretch of the profile shaded smooth and mapped to one band
      (v across the run); different runs meet at hard edges.
    * U runs along the sweep (meters / tile width). Closed rings use an integer number of tiles so the
      seam is invisible. Texture handedness is fixed per run (no mirrored carvings).
    * Vertical runs read bottom -> top (band v0 -> v1); horizontal runs read outside -> inside.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import bpy
import numpy as np

from . import mesh as M

F = np.float64


@dataclass
class Run:
    pts: Sequence[Sequence[float]]  # 2D profile points (ring: (r, z); path: (side, up))
    band: str | tuple[float, float]  # trim name or explicit (v0, v1)
    flip: bool = False  # reverse the v direction
    u_scale: float = 1.0  # extra scale on u (e.g. 2 = texture twice as dense along the sweep)
    u_offset: float = 0.0
    smooth: bool = True


@dataclass
class Decal:
    name: str
    u: float
    v: float
    r: float  # radius in UV units (u axis)
    r_v: float  # radius in UV units (v axis)


@dataclass
class Sheet:
    tile: tuple[float, float]
    trims: dict[str, tuple[float, float]]
    decals: dict[str, list[Decal]] = field(default_factory=dict)

    @staticmethod
    def from_dependency(dep) -> "Sheet":
        m = dep.meta.get("material", {})
        tile = tuple(m.get("tileSizeMeters", (2.0, 2.0)))
        trims = {t["name"]: (float(t["v0"]), float(t["v1"])) for t in m.get("trims", [])}
        decals: dict[str, list[Decal]] = {}
        for d in m.get("decals", []):
            decals.setdefault(d["name"], []).append(Decal(d["name"], d["u"], d["v"], d["r"], d["r_v"]))
        return Sheet(tile, trims, decals)

    def band(self, b: str | tuple[float, float]) -> tuple[float, float]:
        if isinstance(b, str):
            if b not in self.trims:
                raise KeyError(f"unknown trim band '{b}' (have {sorted(self.trims)})")
            return self.trims[b]
        return (float(b[0]), float(b[1]))

    def band_height_m(self, b: str | tuple[float, float]) -> float:
        v0, v1 = self.band(b)
        return (v1 - v0) * self.tile[1]

    def decal(self, name: str, index: int = 0) -> Decal:
        lst = self.decals.get(name)
        if not lst:
            raise KeyError(f"unknown decal '{name}' (have {sorted(self.decals)})")
        return lst[index % len(lst)]


def _cum(pts: np.ndarray) -> np.ndarray:
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(d)])


class TrimMesh:
    """Accumulates quads/polygons with per-loop UVs, per material slot."""

    def __init__(self, sheet: Sheet) -> None:
        self.sheet = sheet
        self.parts: dict[str, dict[str, list]] = {}

    def _part(self, mat: str) -> dict[str, list]:
        return self.parts.setdefault(mat, {"verts": [], "faces": [], "uvs": [], "normals": []})

    def _add_grid(self, mat: str, P: np.ndarray, UV: np.ndarray, closed_cols: bool, expected_n: np.ndarray | None,
                  normals: np.ndarray | None = None) -> None:
        """P: (rows, cols, 3) vertex grid, UV: (rows, cols, 2). Quads between neighbours. Winding is fixed
        per strip so the face normal agrees with `expected_n` (rows-1, cols-1, 3) when given. `normals`
        (rows, cols, 3) sets custom split normals (smooth across strips, e.g. dome courses)."""
        part = self._part(mat)
        rows, cols = P.shape[:2]
        base = len(part["verts"])
        part["verts"].extend(P.reshape(-1, 3).tolist())
        if normals is not None:
            part["normals"].extend(normals.reshape(-1, 3).tolist())
        else:
            part["normals"].extend([None] * (rows * cols))
        idx = lambda i, j: base + i * cols + j  # noqa: E731
        for i in range(rows - 1):
            for j in range(cols - 1):
                q = [idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)]
                quv = [UV[i, j], UV[i, j + 1], UV[i + 1, j + 1], UV[i + 1, j]]
                a, b, c = P[i, j], P[i, j + 1], P[i + 1, j + 1]
                d = P[i + 1, j]
                n = np.cross(c - a, d - b)
                if expected_n is not None and float(np.dot(n, expected_n[i, j])) < 0:
                    q = q[::-1]
                    quv = quv[::-1]
                part["faces"].append(q)
                part["uvs"].extend([tuple(map(float, t)) for t in quv])

    def polygon(self, mat: str, pts: Sequence[Sequence[float]], uvs: Sequence[Sequence[float]], normal: Sequence[float] | None = None) -> None:
        part = self._part(mat)
        P = np.asarray(pts, F)
        U = [tuple(map(float, t)) for t in uvs]
        order = list(range(len(P)))
        if normal is not None:
            n = np.zeros(3)
            for k in range(len(P)):
                n += np.cross(P[k], P[(k + 1) % len(P)])
            if float(np.dot(n, normal)) < 0:
                order = order[::-1]
        base = len(part["verts"])
        part["verts"].extend(P.tolist())
        part["normals"].extend([None] * len(P))
        part["faces"].append([base + k for k in order])
        part["uvs"].extend([U[k] for k in order])

    # ------------------------------------------------------------------------------------ v mapping
    def _run_v(self, run: Run, pts2: np.ndarray, vertical_axis: int = 1, reference: np.ndarray | None = None) -> np.ndarray:
        v0, v1 = self.sheet.band(run.band)
        s = _cum(pts2)
        t = s / max(s[-1], 1e-9)
        dz = pts2[-1, vertical_axis] - pts2[0, vertical_axis]
        dh = pts2[-1, 1 - vertical_axis] - pts2[0, 1 - vertical_axis]
        if abs(dz) >= abs(dh) * 0.25:
            rising = dz > 0  # vertical-ish run: v increases with height
        else:
            # horizontal run: v increases towards `reference` (ring axis / profile centroid)
            ref = reference if reference is not None else np.zeros(2)
            rising = np.linalg.norm(pts2[-1] - ref) < np.linalg.norm(pts2[0] - ref)
        if not rising:
            t = 1.0 - t
        if run.flip:
            t = 1.0 - t
        return v0 + t * (v1 - v0)

    # ------------------------------------------------------------------------------------ ring sweep
    def ring(self, runs: Iterable[Run], segments: int, mat: str, center: Sequence[float] = (0, 0, 0),
             a0: float = 0.0, a1: float = 2 * math.pi, integer_tiles: bool | None = None, caps: str | None = None,
             cap_band: str | tuple[float, float] = "ashlar", rot_offset: float = 0.0,
             continuous: bool = False) -> None:
        """Sweep (r, z) profile runs around the Z axis through `center`, from angle a0 to a1 (radians,
        CCW from +X seen from above). `integer_tiles` (default: closed rings) rounds U to whole tiles.
        `continuous`: runs form one smooth surface (custom normals averaged across run boundaries)."""
        runs = list(runs)
        n2_at: dict[tuple[float, float], np.ndarray] = {}
        if continuous:
            for run in runs:
                p = np.asarray(run.pts, F)
                for k in range(len(p) - 1):
                    seg = p[k + 1] - p[k]
                    nn = np.array([seg[1], -seg[0]]) / max(np.linalg.norm(seg), 1e-12)
                    for q in (p[k], p[k + 1]):
                        key = (round(float(q[0]), 6), round(float(q[1]), 6))
                        n2_at[key] = n2_at.get(key, np.zeros(2)) + nn
        cx, cy, cz = map(float, center)
        closed = abs((a1 - a0) - 2 * math.pi) < 1e-6
        integer_tiles = closed if integer_tiles is None else integer_tiles
        th = a0 + (a1 - a0) * np.arange(segments + 1) / segments + rot_offset
        tile_u = self.sheet.tile[0]
        for run in runs:
            p2 = np.asarray(run.pts, F)
            if len(p2) < 2:
                continue
            v = self._run_v(run, p2, 1, reference=np.array([0.0, p2[:, 1].mean()]))
            r_ref = max(float(np.mean(p2[:, 0])), 1e-3)
            arc = (a1 - a0) * r_ref
            n_tiles = arc / tile_u * run.u_scale
            if integer_tiles:
                n_tiles = max(1.0, round(n_tiles))
            u_th = (th - th[0]) / (a1 - a0) * n_tiles + run.u_offset
            # outward 2D normal of the run (CCW profile -> outward = (dz, -dr))
            d = p2[-1] - p2[0]
            n2 = np.array([d[1], -d[0]])
            # handedness: texture right = +theta tangent (u), up = direction of increasing v
            mid = len(p2) // 2
            k = min(mid, len(p2) - 2)
            dv = (v[k + 1] - v[k])
            vdir2 = (p2[k + 1] - p2[k]) * (1 if dv >= 0 else -1)
            # theta tangent = +y at theta=0; radial = +x; z = +z  -> 3D at theta = 0
            T = np.array([0.0, 1.0, 0.0])
            V = np.array([vdir2[0], 0.0, vdir2[1]])
            N = np.array([n2[0], 0.0, n2[1]])
            mirror = float(np.dot(np.cross(T, V), N)) < 0
            if mirror:
                u_th = -u_th
            cos, sin = np.cos(th), np.sin(th)
            P = np.empty((len(p2), len(th), 3))
            P[..., 0] = cx + p2[:, 0:1] * cos[None, :]
            P[..., 1] = cy + p2[:, 0:1] * sin[None, :]
            P[..., 2] = cz + p2[:, 1:2] + 0 * th[None, :]
            UV = np.empty((len(p2), len(th), 2))
            UV[..., 0] = u_th[None, :]
            UV[..., 1] = v[:, None]
            # expected normals per quad
            thm = 0.5 * (th[:-1] + th[1:])
            En = np.empty((len(p2) - 1, len(th) - 1, 3))
            seg = np.diff(p2, axis=0)
            nr, nz = seg[:, 1], -seg[:, 0]
            En[..., 0] = nr[:, None] * np.cos(thm)[None, :]
            En[..., 1] = nr[:, None] * np.sin(thm)[None, :]
            En[..., 2] = nz[:, None]
            Nv = None
            if continuous:
                n2 = np.array([n2_at[(round(float(q[0]), 6), round(float(q[1]), 6))] for q in p2])
                n2 /= np.maximum(np.linalg.norm(n2, axis=1, keepdims=True), 1e-12)
                Nv = np.empty((len(p2), len(th), 3))
                Nv[..., 0] = n2[:, 0:1] * cos[None, :]
                Nv[..., 1] = n2[:, 0:1] * sin[None, :]
                Nv[..., 2] = n2[:, 1:2]
            self._add_grid(mat, P, UV, closed, En, Nv)
        if caps and not closed:
            prof = np.concatenate([np.asarray(r.pts, F) for r in runs])
            for ang in ((a0 + rot_offset) if "start" in caps or caps == "both" else None,
                        (a1 + rot_offset) if "end" in caps or caps == "both" else None):
                if ang is None:
                    continue
                c, s = math.cos(ang), math.sin(ang)
                pts = [(cx + r * c, cy + r * s, cz + z) for r, z in _dedup(prof)]
                tang = np.array([-s, c, 0.0]) * (-1 if ang == a0 + rot_offset else 1)
                self.cap(mat, pts, tang, cap_band)

    # ------------------------------------------------------------------------------------ path sweep
    def path(self, runs: Iterable[Run], path: Sequence[Sequence[float]], up: Sequence[float], mat: str,
             caps: bool = True, cap_band: str | tuple[float, float] | None = "ashlar",
             cap_decal: str | None = None, u_start: float = 0.0) -> None:
        """Sweep (side, up) profile runs along a 3D polyline. `up` is the profile's second axis (must not
        be parallel to the path). Side axis = up x tangent. U = distance along the path / tile."""
        runs = list(runs)
        P3 = np.asarray(path, F)
        upv = np.asarray(up, F)
        upv = upv / np.linalg.norm(upv)
        tang = np.gradient(P3, axis=0) if len(P3) > 2 else np.repeat((P3[1:] - P3[:1]), len(P3), axis=0)
        tang /= np.linalg.norm(tang, axis=1, keepdims=True)
        side = np.cross(upv[None, :], tang)
        side /= np.linalg.norm(side, axis=1, keepdims=True)
        upk = np.cross(tang, side)
        s_path = _cum(P3) / self.sheet.tile[0] + u_start
        for run in runs:
            p2 = np.asarray(run.pts, F)
            if len(p2) < 2:
                continue
            v = self._run_v(run, p2, 1, reference=np.asarray(p2).mean(axis=0) * 0)
            u = s_path * run.u_scale + run.u_offset
            P = p2[:, 0:1, None] * side[None, :, :] + p2[:, 1:2, None] * upk[None, :, :] + P3[None, :, :]
            seg = np.diff(p2, axis=0)
            # outward 2D normal (CCW): (dz, -ds) in (side, up)
            n_side, n_up = seg[:, 1], -seg[:, 0]
            km = len(P3) // 2
            En = n_side[:, None, None] * side[None, :-1, :] + n_up[:, None, None] * upk[None, :-1, :]
            k = min(len(p2) // 2, len(p2) - 2)
            dv = v[k + 1] - v[k]
            vdir = (p2[k + 1] - p2[k]) * (1 if dv >= 0 else -1)
            V = vdir[0] * side[km] + vdir[1] * upk[km]
            N = n_side[k] * side[km] + n_up[k] * upk[km]
            if float(np.dot(np.cross(tang[km], V), N)) < 0:
                u = -u
            UV = np.empty((len(p2), len(P3), 2))
            UV[..., 0] = u[None, :]
            UV[..., 1] = v[:, None]
            # grid is (profile, path): quads (i,j) span profile i..i+1, path j..j+1
            self._add_grid(mat, P, UV, False, En)
        if caps:
            prof = _dedup(np.concatenate([np.asarray(r.pts, F) for r in runs]))
            for end, sign in ((0, -1.0), (len(P3) - 1, 1.0)):
                pts = [tuple(P3[end] + a * side[end] + b * upk[end]) for a, b in prof]
                self.cap(mat, pts, tang[end] * sign, cap_band, cap_decal)

    def cap(self, mat: str, pts: Sequence[Sequence[float]], normal: Sequence[float],
            band: str | tuple[float, float] | None = "ashlar", decal: str | None = None, decal_index: int = 0) -> None:
        """Planar polygon; UVs: fitted into a decal (single motif), or planar in meters inside a band."""
        P = np.asarray(pts, F)
        n = np.asarray(normal, F)
        n = n / np.linalg.norm(n)
        ref = np.array([0.0, 0.0, 1.0]) if abs(n[2]) < 0.9 else np.array([0.0, 1.0, 0.0])
        ax_u = np.cross(ref, n)
        ax_u /= np.linalg.norm(ax_u)
        ax_v = np.cross(n, ax_u)
        c = P.mean(axis=0)
        pu = (P - c) @ ax_u
        pv = (P - c) @ ax_v
        if decal:
            d = self.sheet.decal(decal, decal_index)
            ext = max(np.abs(pu).max(), np.abs(pv).max(), 1e-6)
            uvs = np.stack([d.u + pu / ext * d.r, d.v + pv / ext * d.r_v], axis=1)
        else:
            v0, v1 = self.sheet.band(band or "ashlar")
            tw, th = self.sheet.tile
            hb = (v1 - v0) * th
            span = max(pv.max() - pv.min(), 1e-6)
            sc = min(1.0, hb / span)  # squeeze tall caps into the band
            uvs = np.stack([pu / tw + 0.5, v0 + (pv - pv.min()) * sc / th], axis=1)
        self.polygon(mat, P, uvs, n)

    def box(self, mat: str, center: Sequence[float], size: Sequence[float], bands: dict[str, str | tuple[float, float]] | None = None,
            decals: dict[str, str] | None = None, rot_z: float = 0.0) -> None:
        """Axis-aligned (then rotated about Z) box with per-face trims ('+x','-x','+y','-y','+z','-z')."""
        bands = bands or {}
        decals = decals or {}
        cx, cy, cz = map(float, center)
        sx, sy, sz = (float(v) / 2 for v in size)
        c, s = math.cos(rot_z), math.sin(rot_z)

        def tr(x: float, y: float, z: float) -> tuple[float, float, float]:
            return (cx + x * c - y * s, cy + x * s + y * c, cz + z)

        faces = {
            "+x": ([(sx, -sy, -sz), (sx, sy, -sz), (sx, sy, sz), (sx, -sy, sz)], (1, 0, 0)),
            "-x": ([(-sx, sy, -sz), (-sx, -sy, -sz), (-sx, -sy, sz), (-sx, sy, sz)], (-1, 0, 0)),
            "+y": ([(sx, sy, -sz), (-sx, sy, -sz), (-sx, sy, sz), (sx, sy, sz)], (0, 1, 0)),
            "-y": ([(-sx, -sy, -sz), (sx, -sy, -sz), (sx, -sy, sz), (-sx, -sy, sz)], (0, -1, 0)),
            "+z": ([(-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)], (0, 0, 1)),
            "-z": ([(-sx, sy, -sz), (sx, sy, -sz), (sx, -sy, -sz), (-sx, -sy, -sz)], (0, 0, -1)),
        }
        for key, (corners, n) in faces.items():
            pts = [tr(*p) for p in corners]
            nn = (n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2])
            if key in decals:
                self.cap(mat, pts, nn, None, decals[key])
            elif key[1] in "xy":
                # vertical face: u along the face (meters/tile), v fitted to the band over the face height
                v0, v1 = self.sheet.band(bands.get(key, "ashlar"))
                w = 2 * (sx if key[1] == "y" else sy)
                tw = self.sheet.tile[0]
                uvs = [(0.0, v0), (w / tw, v0), (w / tw, v1), (0.0, v1)]
                self.polygon(mat, pts, uvs, nn)
            else:
                self.cap(mat, pts, nn, bands.get(key, "ashlar"))

    # ------------------------------------------------------------------------------------ output
    def triangle_estimate(self) -> int:
        return sum(len(f) - 2 for p in self.parts.values() for f in p["faces"])

    def build(self, name: str, materials: dict[str, bpy.types.Material], smooth_angle: float = 35.0,
              join: bool = True) -> list[bpy.types.Object]:
        objs = []
        for mat_name, part in self.parts.items():
            if not part["faces"]:
                continue
            o = M.from_pydata(f"{name}_{mat_name}", part["verts"], part["faces"], part["uvs"], smooth=True,
                              material=materials[mat_name])
            M.shade_smooth(o, smooth_angle)
            if any(n is not None for n in part["normals"]) and len(o.data.vertices) == len(part["verts"]):
                me = o.data
                vn = np.empty(len(me.vertices) * 3)
                me.vertices.foreach_get("normal", vn)
                vn = vn.reshape(-1, 3)
                custom = [tuple(n) if n is not None else tuple(vn[i]) for i, n in enumerate(part["normals"])]
                me.normals_split_custom_set_from_vertices(custom)
            objs.append(o)
        if join and len(objs) > 1:
            return [M.join(objs, name)]
        if objs:
            objs[0].name = name
        return objs


def _dedup(pts: np.ndarray, eps: float = 1e-7) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for p in pts:
        t = (float(p[0]), float(p[1]))
        if not out or (abs(out[-1][0] - t[0]) > eps or abs(out[-1][1] - t[1]) > eps):
            out.append(t)
    if len(out) > 2 and abs(out[0][0] - out[-1][0]) < eps and abs(out[0][1] - out[-1][1]) < eps:
        out.pop()
    return out


# -------------------------------------------------------------------------------------- profiles
def rect(w: float, h: float, chamfer: float = 0.0, z0: float = 0.0) -> list[tuple[float, float]]:
    """CCW closed rectangle profile (side in [-w/2, w/2], up in [z0, z0+h]) with optional chamfer."""
    a, c = w / 2, chamfer
    if c <= 0:
        return [(a, z0), (a, z0 + h), (-a, z0 + h), (-a, z0), (a, z0)]
    return [(a, z0 + c), (a, z0 + h - c), (a - c, z0 + h), (-a + c, z0 + h), (-a, z0 + h - c), (-a, z0 + c),
            (-a + c, z0), (a - c, z0), (a, z0 + c)]


def lens(w: float, h: float, n: int = 6, z0: float = 0.0) -> list[tuple[float, float]]:
    """CCW lens (two arcs) - Sanchi/Bharhut vedika crossbar section; first/last point on the right edge."""
    pts = []
    for k in range(n + 1):  # right arc bottom -> top
        t = -1 + 2 * k / n
        pts.append((w / 2 * (1 - t * t) ** 0.5 * 0.999 + 1e-4, z0 + h / 2 * (1 + t)))
    for k in range(1, n):
        t = 1 - 2 * k / n
        pts.append((-w / 2 * (1 - t * t) ** 0.5, z0 + h / 2 * (1 + t)))
    pts.append(pts[0])
    return pts


__all__ = ["Decal", "Run", "Sheet", "TrimMesh", "lens", "rect"]
