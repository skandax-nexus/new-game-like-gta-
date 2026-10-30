"""
WP4 tree toolkit (package-local helper, not an asset): skeleton growth, bark tubes, leaf cards, wind vertex data,
parametric LODs, variants, GLB export, Blender lookdev materials and Cycles previews. OWNER: Technical Artist D (TA-04).
Recipe: docs/ART_BIBLE.md §7.2 - species values come from src/render/style/vegetation.ts (@style TREE_SPECIES...).

    sk = grow_broadleaf(spec, rng)                 # space colonization inside a crown envelope + pipe-model radii
    lods = [build_lod(sk, spec, cards, level) ...] # parametric LOD0/1/2 meshes (numpy), see LodMesh
    objs = to_blender(lod, name, materials)        # Blender objects with custom (bent) normals, UVs, COLOR_0

Geometry conventions (Blender, metres, +Z up, the trunk base at the origin; exported +Y up / +Z forward):
    UVMap   (TEXCOORD_0)  wood: tiling bark set UVs (u around, v along, metres / tile); cards: leaf-atlas UVs
    UVAlt   (TEXCOORD_1)  cards: atlas UVs of the seasonal alternate region (flowers...) - = UVMap when none
    UVData  (TEXCOORD_2)  x = per-card random r in [0, 1) (seasonal drop / alternate coverage), y = card class:
                          0 foliage, 0.25 structural (aerial roots, fronds: never dropped), 0.5 seasonal-only
                          (flowers on bare twigs: visible in flowering seasons only), 0.75 bare-season twigs,
                          1.0 wood
    COLOR_0 (float, data) R = hierarchy (0 trunk .. 1 twig tips / cards), G = per-branch wind phase, B = leaf flutter
                          (0 at the card's attachment edge .. 1 at its free edge, x species flutter), A = baked AO
                          (crown interior darker, 0.35 at the core)
    NORMAL                wood: smooth tube normals; cards: BENT normals (spherical transfer from the crown centre) -
                          shade them with the same normal on both faces (no back-face flip), +15 % lighter on back
"""
from __future__ import annotations

import json
import math
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Sequence

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

from lib import core, export, mesh as M, render, texgen as tg
from lib.core import log, timer

F = np.float32
CLASS_FOLIAGE, CLASS_STRUCT, CLASS_SEASONAL, CLASS_TWIG, CLASS_WOOD = 0.0, 0.25, 0.5, 0.75, 1.0
REF_SEASON = "sharad"  # leaf atlases are authored in this season's colour; runtime tint = leaf[s] / leaf[REF_SEASON]


# ---------------------------------------------------------------------------------------------------- style
def style(ref: str) -> Any:
    """A src/render/style value (`@style` passes them in SAMRAJYA_STYLE; direct runs ask the runner)."""
    env = os.environ.get("SAMRAJYA_STYLE")
    if env:
        values = json.loads(env)
        if ref in values:
            return values[ref]
    out = subprocess.check_output(["node", str(core.REPO_ROOT / "tools/assets/build.mjs"), "--style", ref], cwd=core.REPO_ROOT)
    return json.loads(out)[ref]


def hexlin(h: str) -> np.ndarray:
    return tg.hex_to_linear(h).astype(F)


def limit_threads(n: int = 2) -> None:
    """Cycles shares 4 CPUs with the other technical artist (STUDIO W3): cap render threads."""
    scn = bpy.context.scene
    scn.render.threads_mode = "FIXED"
    scn.render.threads = n


# ---------------------------------------------------------------------------------------------------- skeleton
@dataclass
class Skeleton:
    pos: np.ndarray          # (n, 3) node positions (Blender axes)
    parent: np.ndarray       # (n,) parent index (-1 root)
    radius: np.ndarray       # (n,)
    order: np.ndarray = field(default_factory=lambda: np.zeros(0, np.int32))   # branch order (0 trunk)
    branch: np.ndarray = field(default_factory=lambda: np.zeros(0, np.int32))  # chain id
    chains: list[list[int]] = field(default_factory=list)                      # node ids root -> tip per chain
    hier: np.ndarray = field(default_factory=lambda: np.zeros(0, F))           # COLOR_0.R per node
    phase: np.ndarray = field(default_factory=lambda: np.zeros(0, F))          # COLOR_0.G per node
    extra_tubes: list[dict] = field(default_factory=list)                      # prop roots, culms ... (own tubes)

    @property
    def n(self) -> int:
        return len(self.pos)


@dataclass
class Envelope:
    """Crown volume for the attraction points: an ellipsoid-like shape centred at (0, 0, zc) with half axes (rx, ry,
    rz), optional flat underside (`flat_bottom` = fraction of rz cut away below the centre), `dome` sharpening of
    the top, `hollow` = keep only the outer shell fraction (dense surface foliage, open interior)."""
    zc: float
    rx: float
    ry: float
    rz: float
    flat_bottom: float = 0.0
    top_flat: float = 0.0
    hollow: float = 0.0
    lumps: int = 0
    lump_amp: float = 0.0

    def sample(self, n: int, rng: np.random.Generator) -> np.ndarray:
        pts = []
        lump_c = rng.normal(size=(max(self.lumps, 1), 3))
        lump_c /= np.linalg.norm(lump_c, axis=1, keepdims=True)
        while sum(len(p) for p in pts) < n:
            q = rng.uniform(-1, 1, size=(n * 3, 3))
            r2 = np.sum(q * q, axis=1)
            keep = r2 <= 1.0
            if self.hollow > 0:
                keep &= r2 >= (1 - self.hollow) ** 2
            if self.flat_bottom > 0:
                keep &= q[:, 2] >= -1 + self.flat_bottom
            if self.top_flat > 0:
                keep &= q[:, 2] <= 1 - self.top_flat
            if self.lumps:
                dirs = q / np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-6)
                bump = np.max(dirs @ lump_c.T, axis=1)
                keep &= np.sqrt(r2) <= 1 - self.lump_amp + self.lump_amp * np.clip(bump, 0, 1) ** 2
            pts.append(q[keep])
        q = np.concatenate(pts)[:n]
        return np.stack([q[:, 0] * self.rx, q[:, 1] * self.ry, self.zc + q[:, 2] * self.rz], axis=1).astype(F)


@dataclass
class GrowthParams:
    envelope: Envelope
    attractors: int = 3000
    step: float = 0.45
    influence: float = 4.0
    kill: float = 0.9
    iterations: int = 90
    tropism: tuple[float, float, float] = (0.0, 0.0, 0.0)   # added to every growth direction (gravity < 0)
    tropism_gain: float = 0.12
    trunk_height: float = 3.0                                # clear bole before colonization starts
    trunk_lean: tuple[float, float] = (0.0, 0.0)             # lean at the bole top (m)
    trunk_wobble: float = 0.15
    trunk_segment: float = 0.6
    seeds_on_trunk: tuple[float, float] = (0.85, 1.0)       # fraction of the bole height where branching may start
    base_radius: float = 0.5
    tip_radius: float = 0.008
    pipe_exponent: float = 2.3
    smoothing: int = 2
    max_children: int = 4


def grow(params: GrowthParams, rng: np.random.Generator) -> Skeleton:
    """Bole + space colonization (Runions et al. 2007) towards attraction points in the crown envelope."""
    p = params
    # ---- bole: a gently wobbling column to the crown base
    nb = max(2, int(math.ceil(p.trunk_height / p.trunk_segment)))
    t = np.linspace(0, 1, nb + 1)
    wob = rng.normal(0, p.trunk_wobble, size=(2, 3))
    bx = p.trunk_lean[0] * t ** 1.6 + wob[0, 0] * np.sin(t * math.pi * (1.2 + wob[0, 1])) * t
    by = p.trunk_lean[1] * t ** 1.6 + wob[1, 0] * np.sin(t * math.pi * (1.1 + wob[1, 1]) + 0.7) * t
    pos = [np.array([bx[i], by[i], t[i] * p.trunk_height], F) for i in range(nb + 1)]
    parent = [-1] + list(range(nb))
    att = p.envelope.sample(p.attractors, rng)
    alive = np.ones(len(att), bool)
    nchild = [0] * len(pos)
    lo, hi = p.seeds_on_trunk
    active_from = int(lo * nb)
    kd_dirty = True
    kd = None
    for it in range(p.iterations):
        if kd_dirty:
            kd = KDTree(len(pos))
            for i, q in enumerate(pos):
                kd.insert(Vector(q.tolist()), i)
            kd.balance()
            kd_dirty = False
        idx = np.nonzero(alive)[0]
        if len(idx) == 0:
            break
        grow_dir: dict[int, np.ndarray] = {}
        for k in idx:
            a = att[k]
            co, i, d = kd.find(Vector(a.tolist()))
            if i is None or d > p.influence:
                continue
            if i < active_from and i != nb:
                continue
            v = (a - pos[i]) / max(d, 1e-6)
            grow_dir[i] = grow_dir.get(i, np.zeros(3, F)) + v
        if not grow_dir:
            break
        new = []
        for i, v in grow_dir.items():
            if nchild[i] >= p.max_children:
                continue
            n = v / max(np.linalg.norm(v), 1e-6)
            n = n + np.asarray(p.tropism, F) * p.tropism_gain
            n = n / max(np.linalg.norm(n), 1e-6)
            q = pos[i] + n * p.step
            new.append((i, q.astype(F)))
        for i, q in new:
            pos.append(q)
            parent.append(i)
            nchild.append(0)
            nchild[i] += 1
        kd_dirty = True
        # kill attractors reached by any new node
        if new:
            kdn = KDTree(len(new))
            for j, (_, q) in enumerate(new):
                kdn.insert(Vector(q.tolist()), j)
            kdn.balance()
            for k in idx:
                if kdn.find_range(Vector(att[k].tolist()), p.kill):
                    alive[k] = False
    sk = Skeleton(np.array(pos, F), np.array(parent, np.int32), np.zeros(len(pos), F))
    finalize(sk, p.base_radius, p.tip_radius, p.pipe_exponent, rng, smoothing=p.smoothing)
    return sk


def finalize(sk: Skeleton, base_radius: float, tip_radius: float, exponent: float, rng: np.random.Generator,
             smoothing: int = 2) -> None:
    """Pipe-model radii (r_parent^e = sum r_child^e, Leonardo's rule for e = 2), chain decomposition (the thickest
    child continues the chain), branch orders, wind hierarchy (COLOR_0.R) and per-branch phase (COLOR_0.G)."""
    n = sk.n
    children: list[list[int]] = [[] for _ in range(n)]
    for i in range(n):
        if sk.parent[i] >= 0:
            children[sk.parent[i]].append(i)
    r = np.zeros(n, np.float64)
    order_nodes = _topo(sk.parent)
    for i in reversed(order_nodes):
        if not children[i]:
            r[i] = tip_radius
        else:
            r[i] = sum(r[c] ** exponent for c in children[i]) ** (1.0 / exponent)
    root = order_nodes[0]
    scale = base_radius / max(r[root], 1e-9)
    # keep twig tips thin: scale only the excess over the tip radius
    sk.radius = (tip_radius + (r - tip_radius) * scale).astype(F)
    # chains: the child with the largest radius continues; others start new chains
    chains: list[list[int]] = []
    branch = np.full(n, -1, np.int32)
    order = np.zeros(n, np.int32)
    stack = [(root, 0, -1)]
    while stack:
        start, o, attach = stack.pop()
        chain = [attach] if attach >= 0 else []
        i = start
        while True:
            chain.append(i)
            branch[i] = len(chains)
            order[i] = o
            ch = sorted(children[i], key=lambda c: -sk.radius[c])
            if not ch:
                break
            for c in ch[1:]:
                stack.append((c, o + 1, i))
            i = ch[0]
        chains.append(chain)
    sk.chains = chains
    sk.branch = branch
    sk.order = order
    if smoothing:
        _smooth_chains(sk, smoothing)
    # wind hierarchy: path length from the trunk exit, normalized; trunk = 0
    path = np.zeros(n, np.float64)
    for i in order_nodes:
        pr = sk.parent[i]
        if pr >= 0:
            seg = float(np.linalg.norm(sk.pos[i] - sk.pos[pr]))
            path[i] = 0.0 if order[i] == 0 else path[pr] + seg
    mx = max(float(path.max()), 1e-6)
    sk.hier = np.clip((path / mx) ** 0.75, 0, 1).astype(F)
    # phase: per order-1 branch (+ a small per-chain offset so sub-branches are not in lockstep)
    phase = np.zeros(n, F)
    chain_phase = rng.uniform(0, 1, len(chains)).astype(F)
    top: dict[int, int] = {}
    for ci, ch in enumerate(chains):
        o = order[ch[-1]]
        if o == 0:
            continue
        first = ch[1] if len(ch) > 1 else ch[0]
        anc = first
        while order[anc] > 1 and sk.parent[anc] >= 0:
            anc = sk.parent[anc]
        top[ci] = branch[anc]
    for ci, ch in enumerate(chains):
        if order[ch[-1]] == 0:
            continue
        base_ph = chain_phase[top.get(ci, ci)]
        for i in ch[1:]:
            phase[i] = (base_ph + 0.12 * chain_phase[ci]) % 1.0
    sk.phase = phase


def _topo(parent: np.ndarray) -> list[int]:
    n = len(parent)
    children: list[list[int]] = [[] for _ in range(n)]
    roots = []
    for i in range(n):
        if parent[i] >= 0:
            children[parent[i]].append(i)
        else:
            roots.append(i)
    out = []
    stack = list(reversed(roots))
    while stack:
        i = stack.pop()
        out.append(i)
        stack.extend(reversed(children[i]))
    return out


def _smooth_chains(sk: Skeleton, iterations: int) -> None:
    """Laplacian smoothing of interior chain nodes (removes the colonization zig-zag), endpoints fixed."""
    pos = sk.pos.astype(np.float64)
    for _ in range(iterations):
        new = pos.copy()
        for ch in sk.chains:
            if len(ch) < 3:
                continue
            idx = np.array(ch)
            inner = idx[1:-1]
            new[inner] = pos[inner] * 0.5 + (pos[idx[:-2]] + pos[idx[2:]]) * 0.25
        pos = new
    sk.pos = pos.astype(F)


# ---------------------------------------------------------------------------------------------------- mesh data
@dataclass
class MeshData:
    """Plain numpy mesh: per-vertex attributes, triangle faces (or quads)."""
    v: list = field(default_factory=list)       # positions (3,)
    nrm: list = field(default_factory=list)     # normals (3,)
    uv: list = field(default_factory=list)      # UVMap
    uv_alt: list = field(default_factory=list)  # UVAlt
    data: list = field(default_factory=list)    # UVData
    col: list = field(default_factory=list)     # COLOR_0 RGBA
    f: list = field(default_factory=list)       # faces (vertex index tuples)

    def add(self, v, n, uv, col, uv_alt=None, data=(0.0, CLASS_WOOD)) -> int:
        self.v.append(v)
        self.nrm.append(n)
        self.uv.append(uv)
        self.uv_alt.append(uv if uv_alt is None else uv_alt)
        self.data.append(data)
        self.col.append(col)
        return len(self.v) - 1

    def tris(self) -> int:
        return sum(len(f) - 2 for f in self.f)

    def arrays(self) -> dict[str, np.ndarray]:
        return {k: np.asarray(getattr(self, k), F) for k in ("v", "nrm", "uv", "uv_alt", "data", "col")}

    def extend(self, other: "MeshData") -> None:
        o = len(self.v)
        for k in ("v", "nrm", "uv", "uv_alt", "data", "col"):
            getattr(self, k).extend(getattr(other, k))
        self.f.extend(tuple(i + o for i in f) for f in other.f)


def _frames(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    n = len(pts)
    T = np.zeros((n, 3))
    for i in range(n):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        d = b - a
        T[i] = d / max(np.linalg.norm(d), 1e-9)
    ref = np.array([0.0, 0.0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    N = np.zeros((n, 3))
    N[0] = np.cross(T[0], ref)
    N[0] /= np.linalg.norm(N[0])
    for i in range(1, n):
        b = np.cross(T[i - 1], T[i])
        bl = np.linalg.norm(b)
        if bl < 1e-9:
            N[i] = N[i - 1]
        else:
            b /= bl
            ang = math.acos(max(-1.0, min(1.0, float(T[i - 1] @ T[i]))))
            k = b
            v = N[i - 1]
            N[i] = v * math.cos(ang) + np.cross(k, v) * math.sin(ang) + k * (k @ v) * (1 - math.cos(ang))
        N[i] -= T[i] * (N[i] @ T[i])
        N[i] /= max(np.linalg.norm(N[i]), 1e-9)
    B = np.cross(T, N)
    return T, N, B


def tube(md: MeshData, pts: np.ndarray, radii: np.ndarray, sides: int, *, tile: tuple[float, float],
         hier: np.ndarray, phase: np.ndarray, ao: Callable[[np.ndarray], np.ndarray], v0: float = 0.0,
         cap: bool = True, flare: Callable[[np.ndarray, np.ndarray, np.ndarray], np.ndarray] | None = None,
         uv_rect: tuple[float, float, float, float] | None = None) -> None:
    """Swept tube along `pts` with per-ring `radii` and `sides` sides. UVs: u = arc length around / tile[0] (seam
    duplicated), v = v0 + length along / tile[1]; with `uv_rect` (u0, v0, u1, v1) the tube is mapped once into an
    atlas rectangle instead (LOD2 single-material trees). `flare(angle, z, r) -> r'` deforms rings (buttresses)."""
    pts = np.asarray(pts, np.float64)
    if len(pts) < 2:
        return
    T, N, B = _frames(pts)
    seglen = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    total = seglen[-1]
    rows = []
    ang = np.linspace(0, 2 * math.pi, sides + 1)
    for i in range(len(pts)):
        r = float(radii[i])
        ring = []
        rr = np.full(sides + 1, r)
        if flare is not None:
            rr = flare(ang, np.full(sides + 1, pts[i][2]), rr)
        for k in range(sides + 1):
            a = ang[k]
            dirv = N[i] * math.cos(a) + B[i] * math.sin(a)
            p = pts[i] + dirv * rr[k]
            if uv_rect is None:
                u = (a / (2 * math.pi)) * (2 * math.pi * max(r, 0.02)) / tile[0]
                u = round(u * max(1.0, 1.0)) if False else u
                v = v0 + seglen[i] / tile[1]
            else:
                u0, vv0, u1, vv1 = uv_rect
                u = u0 + (u1 - u0) * (k / sides)
                v = vv0 + (vv1 - vv0) * (seglen[i] / max(total, 1e-6))
            ring.append((p, dirv, (u, v)))
        rows.append(ring)
    aov = ao(np.array([[q[0] for q in ring] for ring in rows]).reshape(-1, 3)).reshape(len(rows), sides + 1)
    base = len(md.v)
    for i, ring in enumerate(rows):
        for k, (p, nv, uv) in enumerate(ring):
            md.add(p, nv, uv, (float(hier[i]), float(phase[i]), 0.0, float(aov[i, k])))
    S = sides + 1
    for i in range(len(rows) - 1):
        for k in range(sides):
            a = base + i * S + k
            md.f.append((a, a + 1, a + S + 1, a + S))
    if cap and radii[-1] > 0.004:
        tip = len(md.v)
        p = pts[-1] + T[-1] * float(radii[-1]) * 0.5
        md.add(p, T[-1], rows[-1][0][2], (float(hier[-1]), float(phase[-1]), 0.0, float(aov[-1, 0])))
        last = base + (len(rows) - 1) * S
        for k in range(sides):
            md.f.append((last + k, last + k + 1, tip))


def resample_chain(pts: np.ndarray, radii: np.ndarray, step: float, angle_tol_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Simplify a chain: drop points closer than `step` unless the direction turns more than `angle_tol_deg`.
    Returns (points, radii, kept indices)."""
    keep = [0]
    acc = 0.0
    for i in range(1, len(pts) - 1):
        acc += float(np.linalg.norm(pts[i] - pts[i - 1]))
        a = pts[i] - pts[keep[-1]]
        b = pts[i + 1] - pts[i]
        la, lb = np.linalg.norm(a), np.linalg.norm(b)
        turn = math.degrees(math.acos(max(-1, min(1, float(a @ b) / max(la * lb, 1e-9))))) if la > 1e-6 and lb > 1e-6 else 0
        if acc >= step or turn > angle_tol_deg:
            keep.append(i)
            acc = 0.0
    keep.append(len(pts) - 1)
    k = np.array(sorted(set(keep)))
    return pts[k], radii[k], k


# ---------------------------------------------------------------------------------------------------- crown AO
class CrownDensity:
    """Voxelized leaf-area density of the crown; vertex AO = mean transmittance towards the sky hemisphere
    (cosine-weighted directions), remapped so the densest core reaches `core_ao` (Bible §7.2: 0.35)."""

    def __init__(self, points: np.ndarray, areas: np.ndarray, cell: float = 0.8, extinction: float = 0.55,
                 core_ao: float = 0.35, dirs: int = 24) -> None:
        self.cell = cell
        lo = points.min(axis=0) - cell * 2
        hi = points.max(axis=0) + cell * 2
        self.lo = lo
        self.shape = np.maximum(np.ceil((hi - lo) / cell).astype(int), 1)
        grid = np.zeros(self.shape, np.float64)
        idx = np.clip(((points - lo) / cell).astype(int), 0, self.shape - 1)
        np.add.at(grid, (idx[:, 0], idx[:, 1], idx[:, 2]), areas)
        self.sigma = grid / (cell ** 3) * extinction  # leaf area per volume x extinction -> optical depth per m
        k = np.arange(dirs) + 0.5
        phi = k * math.pi * (3 - math.sqrt(5))
        cz = np.sqrt(1 - k / dirs)  # cosine-weighted upper hemisphere
        sz = np.sqrt(1 - cz * cz)
        self.dirs = np.stack([np.cos(phi) * sz, np.sin(phi) * sz, cz], axis=1)
        self.core_ao = core_ao
        self.norm = 1.0

    def transmittance(self, p: np.ndarray, steps: int = 20, length: float | None = None) -> np.ndarray:
        L = length if length is not None else float(np.max(self.shape) * self.cell)
        ds = L / steps
        out = np.zeros(len(p))
        for d in self.dirs:
            tau = np.zeros(len(p))
            for s in range(1, steps + 1):
                q = p + d * (s - 0.5) * ds
                idx = ((q - self.lo) / self.cell).astype(int)
                ok = np.all((idx >= 0) & (idx < self.shape), axis=1)
                v = np.zeros(len(p))
                ii = idx[ok]
                v[ok] = self.sigma[ii[:, 0], ii[:, 1], ii[:, 2]]
                tau += v * ds
            out += np.exp(-tau)
        return out / len(self.dirs)

    def calibrate(self, probe: np.ndarray) -> None:
        """Remap so the most occluded probe point reaches core_ao."""
        t = self.transmittance(probe)
        self.tmin = float(np.percentile(t, 2)) if len(t) else 0.0

    def ao(self, p: np.ndarray) -> np.ndarray:
        t = self.transmittance(np.asarray(p, np.float64))
        tmin = getattr(self, "tmin", 0.0)
        x = np.clip((t - tmin) / max(1.0 - tmin, 1e-6), 0, 1)
        return (self.core_ao + (1 - self.core_ao) * x ** 0.8).astype(F)


# ---------------------------------------------------------------------------------------------------- cards
@dataclass
class Region:
    """An atlas region (UV rect in the page, v up) with its card size in metres at LOD0 and an optional seasonal
    alternate rect of the same size."""
    name: str
    rect: tuple[float, float, float, float]
    size_m: tuple[float, float]
    alt: tuple[float, float, float, float] | None = None
    klass: float = CLASS_FOLIAGE


@dataclass
class Card:
    pos: np.ndarray      # attachment point (bottom centre of the card)
    up: np.ndarray       # card +V direction (unit)
    nrm: np.ndarray      # card plane normal (unit)
    w: float
    h: float
    region: Region
    hier: float
    phase: float
    r: float             # per-card random
    flip: bool = False   # mirror u (breaks repetition)
    klass: float = CLASS_FOLIAGE


def place_cards(sk: Skeleton, regions: list[Region], rng: np.random.Generator, *, per_tip: float = 1.0,
                along: float = 0.0, min_order: int = 1, jitter_deg: float = 35.0, outward: float = 0.65,
                droop: float = 0.15, size_jitter: float = 0.2, scale: float = 1.0, center: np.ndarray | None = None,
                max_radius: float = 0.03, region_weights: Sequence[float] | None = None) -> list[Card]:
    """Leaf cards on twig tips (+ `along` extra cards per metre on thin chains). Each card hangs from its twig: up =
    mix(twig direction, outward from the crown centre) jittered by +-`jitter_deg` (Bible §7.2), normal faces out."""
    cards: list[Card] = []
    n = sk.n
    children = np.zeros(n, np.int32)
    for i in range(n):
        if sk.parent[i] >= 0:
            children[sk.parent[i]] += 1
    tips = [i for i in range(n) if children[i] == 0 and sk.order[i] >= min_order]
    c = center if center is not None else crown_center(sk)
    wts = np.asarray(region_weights if region_weights is not None else [1.0] * len(regions), np.float64)
    wts = wts / wts.sum()

    def make(i: int, at: np.ndarray) -> Card:
        pr = sk.parent[i] if sk.parent[i] >= 0 else i
        twig = sk.pos[i] - sk.pos[pr]
        twig = twig / max(np.linalg.norm(twig), 1e-6)
        out = at - c
        out = out / max(np.linalg.norm(out), 1e-6)
        up = twig * (1 - outward) + out * outward + np.array([0, 0, -droop])
        up = _jitter(up / np.linalg.norm(up), jitter_deg, rng)
        side = np.cross(up, out)
        if np.linalg.norm(side) < 1e-4:
            side = np.cross(up, np.array([1.0, 0, 0]))
        side /= np.linalg.norm(side)
        nrm = np.cross(side, up)
        nrm /= np.linalg.norm(nrm)
        if nrm @ out < 0:
            nrm = -nrm
        nrm = _rotate(nrm, up, math.radians(rng.normal(0, jitter_deg * 0.6)))
        reg = regions[int(rng.choice(len(regions), p=wts))]
        s = scale * (1 + rng.uniform(-size_jitter, size_jitter))
        return Card(at.astype(F), up.astype(F), nrm.astype(F), reg.size_m[0] * s, reg.size_m[1] * s, reg,
                    float(sk.hier[i]), float(sk.phase[i]), float(rng.uniform()), bool(rng.uniform() < 0.5), reg.klass)

    for i in tips:
        k = int(per_tip) + (1 if rng.uniform() < per_tip - int(per_tip) else 0)
        for _ in range(k):
            cards.append(make(i, sk.pos[i]))
    if along > 0:
        for ch in sk.chains:
            if sk.order[ch[-1]] < min_order:
                continue
            for a, b in zip(ch[:-1], ch[1:]):
                if sk.radius[b] > max_radius:
                    continue
                seg = float(np.linalg.norm(sk.pos[b] - sk.pos[a]))
                k = rng.poisson(along * seg)
                for _ in range(k):
                    t = rng.uniform()
                    cards.append(make(b, sk.pos[a] + (sk.pos[b] - sk.pos[a]) * t))
    return cards


def _jitter(v: np.ndarray, deg: float, rng: np.random.Generator) -> np.ndarray:
    axis = np.cross(v, rng.normal(size=3))
    axis /= max(np.linalg.norm(axis), 1e-9)
    return _rotate(v, axis, math.radians(rng.uniform(-deg, deg)))


def _rotate(v: np.ndarray, axis: np.ndarray, ang: float) -> np.ndarray:
    axis = axis / max(np.linalg.norm(axis), 1e-9)
    return v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + axis * (axis @ v) * (1 - math.cos(ang))


def crown_center(sk: Skeleton) -> np.ndarray:
    m = sk.order > 0
    pts = sk.pos[m] if m.any() else sk.pos
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    return ((lo + hi) * 0.5).astype(F)


def crown_axes(pts: np.ndarray, center: np.ndarray) -> np.ndarray:
    return np.maximum(np.percentile(np.abs(pts - center), 95, axis=0), 0.5)


def cards_mesh(md: MeshData, cards: list[Card], *, center: np.ndarray, axes: np.ndarray, bend: float = 0.85,
               flutter: float = 1.0, ao: Callable[[np.ndarray], np.ndarray], hull: bool = False, curl: float = 0.0) -> None:
    """Quads for the cards: UVs into their region (mirrored when card.flip), UVAlt into the alternate region,
    BENT normals (spherical transfer from the ellipsoidal crown centre, `bend` = blend weight), wind data."""
    if not cards:
        return
    P = []
    for cd in cards:
        side = np.cross(cd.up, cd.nrm)
        side /= max(np.linalg.norm(side), 1e-9)
        hw = cd.w * 0.5
        # slight fold along the card's centre line (curl) gives cards some volume when seen edge-on
        mid_off = cd.nrm * cd.w * curl
        corners = [cd.pos - side * hw, cd.pos + side * hw, cd.pos + side * hw + cd.up * cd.h, cd.pos - side * hw + cd.up * cd.h]
        P.append((cd, side, corners, mid_off))
    allp = np.array([q for _, _, cs, _ in P for q in cs])
    aov = ao(allp).reshape(len(P), 4)
    for ci, (cd, side, corners, mid_off) in enumerate(P):
        u0, v0, u1, v1 = cd.region.rect
        if cd.flip:
            u0, u1 = u1, u0
        a = cd.region.alt or cd.region.rect
        au0, av0, au1, av1 = a
        if cd.flip:
            au0, au1 = au1, au0
        uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        auvs = [(au0, av0), (au1, av0), (au1, av1), (au0, av1)]
        fl = [0.0, 0.0, 1.0, 1.0]
        idx = []
        for k in range(4):
            p = corners[k]
            rad = (p - center) / axes
            rad = rad / max(np.linalg.norm(rad), 1e-9)
            nb = cd.nrm * (1 - bend) + rad * bend
            nb /= max(np.linalg.norm(nb), 1e-9)
            h = min(1.0, cd.hier + 0.08 * fl[k])
            idx.append(md.add(p, nb, uvs[k], (h, cd.phase, fl[k] * flutter, float(aov[ci, k])), auvs[k], (cd.r, cd.klass)))
        md.f.append(tuple(idx))


# ---------------------------------------------------------------------------------------------------- blender objects
def to_object(md: MeshData, name: str, material: bpy.types.Material | None) -> bpy.types.Object:
    """Blender mesh object from MeshData: custom normals, UVMap / UVAlt / UVData, float COLOR_0 (point domain)."""
    a = md.arrays()
    me = bpy.data.meshes.new(name)
    me.from_pydata(a["v"].tolist(), [], [tuple(f) for f in md.f])
    me.validate(clean_customdata=False)
    nl = len(me.loops)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get("vertex_index", lv)
    for layer, key in (("UVMap", "uv"), ("UVAlt", "uv_alt"), ("UVData", "data")):
        uv = me.uv_layers.new(name=layer)
        uv.data.foreach_set("uv", a[key][lv].reshape(-1))
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", a["col"].reshape(-1))
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0
    me.shade_smooth()
    me.normals_split_custom_set_from_vertices(a["nrm"].tolist())
    me.uv_layers.active = me.uv_layers["UVMap"]
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if material is not None:
        me.materials.append(material)
    return obj


# ---------------------------------------------------------------------------------------------------- materials
def leaf_material(name: str, color_png: Path | None, normal_png: Path | None, orm_png: Path | None, *,
                  fallback: str, atlas: str, translucency: float = 0.35, alpha_cut: float = 0.5,
                  bark_rect: Sequence[float] | None = None, preview_ao: bool = True) -> bpy.types.Material:
    """Leaf-card material: a Cycles lookdev graph (atlas colour x vertex AO, alpha cut-out, normal map, translucent
    back light from ORM.b) that is ALSO the runtime proxy: its glTF extras carry the atlas binding for GFX-03
    (samrajya_atlas, samrajya_alpha_cut, samrajya_foliage, samrajya_translucency). The Principled BSDF holds the
    atlas colour so the impostor capture (lib/impostor emission override) records exactly what the runtime shows."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    fc = hexlin(fallback)
    bsdf.inputs["Base Color"].default_value = (float(fc[0]), float(fc[1]), float(fc[2]), 1.0)
    bsdf.inputs["Roughness"].default_value = 0.6
    mat.use_backface_culling = False
    mat["samrajya_atlas"] = atlas
    mat["samrajya_alpha_cut"] = alpha_cut
    mat["samrajya_foliage"] = 1
    mat["samrajya_translucency"] = translucency
    mat["samrajya_tint"] = "#ffffff"
    if bark_rect is not None:
        mat["samrajya_bark_rect"] = [round(float(x), 6) for x in bark_rect]
    if color_png is None:
        nt.links.new(bsdf.outputs[0], out.inputs[0])
        return mat
    tex_uv = nt.nodes.new("ShaderNodeUVMap")
    tex_uv.uv_map = "UVMap"
    img = bpy.data.images.load(str(color_png), check_existing=True)
    img.colorspace_settings.name = "sRGB"
    img.alpha_mode = "STRAIGHT"
    ti = nt.nodes.new("ShaderNodeTexImage")
    ti.image = img
    ti.interpolation = "Cubic"
    nt.links.new(tex_uv.outputs[0], ti.inputs[0])
    color_out = ti.outputs["Color"]
    if preview_ao:
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        _sock(mul.inputs, "Factor_Float").default_value = 1.0
        nt.links.new(ti.outputs["Color"], _sock(mul.inputs, "A_Color"))
        nt.links.new(attr.outputs["Alpha"], _sock(mul.inputs, "B_Color"))
        color_out = _sock(mul.outputs, "Result_Color")
    nt.links.new(color_out, bsdf.inputs["Base Color"])
    # hard alpha cut (alpha test 0.5 like the runtime; Cycles then needs no transparency noise)
    cut = nt.nodes.new("ShaderNodeMath")
    cut.operation = "GREATER_THAN"
    cut.inputs[1].default_value = alpha_cut
    nt.links.new(ti.outputs["Alpha"], cut.inputs[0])
    nt.links.new(cut.outputs[0], bsdf.inputs["Alpha"])
    if normal_png is not None:
        nimg = bpy.data.images.load(str(normal_png), check_existing=True)
        nimg.colorspace_settings.name = "Non-Color"
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = nimg
        nt.links.new(tex_uv.outputs[0], tn.inputs[0])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.uv_map = "UVMap"
        nm.inputs["Strength"].default_value = 0.8
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    shader = bsdf.outputs[0]
    if orm_png is not None:
        oimg = bpy.data.images.load(str(orm_png), check_existing=True)
        oimg.colorspace_settings.name = "Non-Color"
        to = nt.nodes.new("ShaderNodeTexImage")
        to.image = oimg
        nt.links.new(tex_uv.outputs[0], to.inputs[0])
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(to.outputs["Color"], sep.inputs[0])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        # thin-leaf back light: translucent BSDF tinted 1.4 x leaf colour towards yellow (Bible §7.2)
        trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
        tint = nt.nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MULTIPLY"
        _sock(tint.inputs, "Factor_Float").default_value = 1.0
        nt.links.new(color_out, _sock(tint.inputs, "A_Color"))
        _sock(tint.inputs, "B_Color").default_value = (1.5, 1.45, 0.9, 1.0)
        nt.links.new(_sock(tint.outputs, "Result_Color"), trans.inputs["Color"])
        if bsdf.inputs["Normal"].links:
            nt.links.new(bsdf.inputs["Normal"].links[0].from_socket, trans.inputs["Normal"])
        w = nt.nodes.new("ShaderNodeMath")
        w.operation = "MULTIPLY"
        w.inputs[1].default_value = translucency
        nt.links.new(sep.outputs["Blue"], w.inputs[0])
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(w.outputs[0], mix.inputs[0])
        nt.links.new(bsdf.outputs[0], mix.inputs[1])
        nt.links.new(trans.outputs[0], mix.inputs[2])
        # keep the cut-out on the mix (transparent where alpha < cut)
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix2 = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(cut.outputs[0], mix2.inputs[0])
        nt.links.new(tr.outputs[0], mix2.inputs[1])
        nt.links.new(mix.outputs[0], mix2.inputs[2])
        shader = mix2.outputs[0]
    nt.links.new(shader, out.inputs[0])
    return mat


def bark_material(name: str, set_id: str, base_png: Path | None, normal_png: Path | None, orm_png: Path | None, *,
                  fallback: str, roughness: float = 0.88) -> bpy.types.Material:
    """Bark: lookdev graph from the bark set's cache maps + runtime proxy extras (samrajya_set = the shared bark set)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    fc = hexlin(fallback)
    bsdf.inputs["Base Color"].default_value = (float(fc[0]), float(fc[1]), float(fc[2]), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    mat["samrajya_set"] = set_id
    mat["samrajya_tint"] = "#ffffff"
    mat["samrajya_fallback_color"] = fallback
    if base_png is None:
        return mat
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    img = bpy.data.images.load(str(base_png), check_existing=True)
    img.colorspace_settings.name = "sRGB"
    ti = nt.nodes.new("ShaderNodeTexImage")
    ti.image = img
    nt.links.new(uv.outputs[0], ti.inputs[0])
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    _sock(mul.inputs, "Factor_Float").default_value = 1.0
    nt.links.new(ti.outputs["Color"], _sock(mul.inputs, "A_Color"))
    nt.links.new(attr.outputs["Alpha"], _sock(mul.inputs, "B_Color"))
    nt.links.new(_sock(mul.outputs, "Result_Color"), bsdf.inputs["Base Color"])
    if normal_png is not None:
        nimg = bpy.data.images.load(str(normal_png), check_existing=True)
        nimg.colorspace_settings.name = "Non-Color"
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = nimg
        nt.links.new(uv.outputs[0], tn.inputs[0])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.uv_map = "UVMap"
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    if orm_png is not None:
        oimg = bpy.data.images.load(str(orm_png), check_existing=True)
        oimg.colorspace_settings.name = "Non-Color"
        to = nt.nodes.new("ShaderNodeTexImage")
        to.image = oimg
        nt.links.new(uv.outputs[0], to.inputs[0])
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(to.outputs["Color"], sep.inputs[0])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    return mat


def _sock(socks: Any, ident: str) -> Any:
    return next(x for x in socks if x.identifier == ident)


__all__ = [
    "CLASS_FOLIAGE", "CLASS_SEASONAL", "CLASS_STRUCT", "CLASS_TWIG", "CLASS_WOOD", "Card", "CrownDensity", "Envelope",
    "GrowthParams", "MeshData", "REF_SEASON", "Region", "Skeleton", "bark_material", "cards_mesh", "crown_axes",
    "crown_center", "finalize", "grow", "hexlin", "leaf_material", "limit_threads", "place_cards", "resample_chain",
    "style", "to_object", "tube",
]
