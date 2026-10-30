"""
WP4 tree assembly (package-local helper, not an asset): builds a species' three shape variants from _species
settings with the _vegkit primitives - skeleton, signature features (banyan prop roots / aerial roots / platform,
peepal railing + votive threads), crown AO, budgeted parametric LODs - and turns them into GLBs, manifest metadata,
Cycles previews and hemi-octahedral impostors. OWNER: Technical Artist D (TA-04).

    tree = build_tree(species, variant, style)    # deterministic (seeded by species + variant), no bpy objects
    lods = tree.lods                               # [{material key: MeshData}] LOD0 / LOD1 / LOD2 within TREE_SPECIES.tris
    objs = tree.objects(level, materials, prefix)  # Blender objects (wood / leaves / stone)

LOD scheme (ASSET_LIST §0.3, VEGETATION_LOD): LOD0 (<= 35 m) bark set + leaf atlas (+ stone for shrine / platform
variants); LOD1 (35-90 m) and LOD2 (90-220 m) are ONE material: the trunk maps into the species' bark swatch region of
the leaf atlas (`samrajya_bark_rect`), so a far tree is a single draw call. Cards of lower LODs are fewer, bigger
copies (Voronoi groups of LOD0 cards keep the crown's leaf area and silhouette), so LOD changes do not pop.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import bpy
import numpy as np

import _leafkit as K
import _vegkit as V
from _species import SPECIES, TreeSpec
from lib import core
from lib.core import log

F = np.float32
LOD_FADE = (35.0, 90.0, 220.0)  # VEGETATION_LOD tree lod0ToM / lod1ToM / lod2ToM


@dataclass
class TreeBuild:
    species: str
    variant: str
    spec: TreeSpec
    sk: V.Skeleton
    cards: list[V.Card]
    center: np.ndarray
    axes: np.ndarray
    dens: V.CrownDensity
    height: float
    lods: list[dict[str, V.MeshData]] = field(default_factory=list)
    info: dict[str, Any] = field(default_factory=dict)


def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def region_list(spec: TreeSpec, regions_meta: dict, use: str = "crown") -> list[V.Region]:
    out = []
    for rs in spec.regions:
        if rs.use != use:
            continue
        m = regions_meta[f"{spec.id}.{rs.name}"]
        out.append(V.Region(rs.name, tuple(m["rect"]), tuple(m["sizeM"]), tuple(m["alt"]) if m["alt"] else None, rs.klass))
    return out


def region_weights(spec: TreeSpec, use: str = "crown") -> list[float]:
    return [rs.weight for rs in spec.regions if rs.use == use]


def build_tree(species: str, variant: str, style: dict, regions_meta: dict, tris: tuple[int, int, int]) -> TreeBuild:
    """Grow one variant and build its three LODs within `tris` (TREE_SPECIES.tris)."""
    spec = SPECIES[species]
    vo = spec.variants.get(variant, {})
    seed = core.stable_seed("tree", species, variant, vo.get("seed_offset", 0))
    rng = np.random.default_rng(seed)
    g = _merge(spec.growth, {"envelope": vo.get("envelope", {})})
    s = float(vo.get("scale", 1.0))
    env = g.pop("envelope")
    envelope = V.Envelope(**{**env, "zc": env["zc"] * s, "rx": env["rx"] * s, "ry": env["ry"] * s, "rz": env["rz"] * s})
    gp = V.GrowthParams(envelope=envelope, **{**g, "trunk_height": g["trunk_height"] * s,
                                               "base_radius": g["base_radius"] * (0.8 + 0.2 * s),
                                               "step": g["step"] * (0.85 + 0.15 * s)})
    sk = V.grow(gp, rng)
    crown = region_list(spec, regions_meta, "crown")
    # enough card candidates for the LOD0 budget (~72 % of it in leaf cards): densify until there are
    need = int(tris[0] * 0.72 / 2 * 1.1)
    ckw = dict(spec.cards)

    def crown_cards() -> list[V.Card]:
        cs = V.place_cards(sk, crown, rng, region_weights=region_weights(spec, "crown"), **ckw)
        if not cs:
            return cs
        keep = envelope.contains(np.array([c.pos for c in cs], np.float64), grow=1.18)  # never down the bole
        return [c for c, k in zip(cs, keep) if k]

    cards = crown_cards()
    for _ in range(5):
        if len(cards) >= need:
            break
        ckw["per_tip"] = ckw.get("per_tip", 1.0) * 1.4
        ckw["along"] = max(ckw.get("along", 0.0), 1.0) * 1.5
        ckw["max_radius"] = min(0.08, ckw.get("max_radius", 0.03) * 1.2)
        cards = crown_cards()
    center = V.crown_center(sk)
    cp = np.array([c.pos for c in cards]) if cards else sk.pos
    axes = V.crown_axes(cp, center)
    dens = V.CrownDensity(cp, np.array([c.w * c.h * 0.35 for c in cards]), cell=max(0.6, float(axes.max()) / 12))
    dens.calibrate(cp)
    tb = TreeBuild(species, variant, spec, sk, cards, center, axes, dens, float(sk.pos[:, 2].max()))
    _signatures(tb, vo, regions_meta, rng)
    tb.lods = [_build_lod(tb, lvl, tris[lvl], regions_meta, rng) for lvl in range(3)]
    tb.info = {
        "variant": variant, "seed": seed, "nodes": int(sk.n), "chains": len(sk.chains), "cardsLod0": len(cards),
        "heightM": round(tb.height, 2), "crownCenter": [round(float(x), 3) for x in center],
        "crownAxes": [round(float(x), 3) for x in axes],
        "tris": [sum(m.tris() for m in lod.values()) for lod in tb.lods],
    }
    log(f"{species}/{variant}: {sk.n} nodes, {len(cards)} cards, height {tb.height:.1f} m, tris {tb.info['tris']}")
    return tb


# ---------------------------------------------------------------------------------------------------- signatures
def _signatures(tb: TreeBuild, vo: dict, regions_meta: dict, rng: np.random.Generator) -> None:
    sp = tb.spec
    tb.extra_wood: list[tuple[np.ndarray, np.ndarray]] = []  # (points, radii) tubes in the bark material
    tb.struct_cards: list[V.Card] = []                       # aerial roots etc. (atlas, CLASS_STRUCT)
    tb.stone: list[dict] = []                                 # platform / railing boxes (stone material)
    tb.band: dict | None = None                               # votive thread band on the trunk
    if sp.extras.get("prop_roots"):
        lo, hi = vo.get("prop_roots", sp.extras["prop_roots"])
        _prop_roots(tb, int(rng.integers(lo, hi + 1)), rng)
    if sp.extras.get("aerial_cards"):
        _aerial_cards(tb, sp.extras["aerial_cards"][0], region_list(sp, regions_meta, "root"), rng)
    if sp.extras.get("twig_cards"):
        twigs = region_list(sp, regions_meta, "twig")
        if twigs:
            n = int(len(tb.cards) * float(sp.extras["twig_cards"]))
            pool = V.place_cards(tb.sk, twigs, rng, **{**sp.cards, "per_tip": 1.0, "along": 0.0})
            if pool:
                pick = rng.permutation(len(pool))[:n]
                for i in pick:
                    c = pool[int(i)]
                    c.klass = V.CLASS_TWIG
                    tb.struct_cards.append(c)
    if vo.get("platform"):
        r = float(tb.sk.radius[0]) * 2.6 + 1.6
        tb.stone.append({"kind": "platform", "half": r, "height": 0.62})
    if vo.get("shrine"):
        tb.stone.append({"kind": "railing", "half": float(tb.sk.radius[0]) * 2.2 + 1.4, "height": 1.15})
        thread = [V.Region(rs.name, tuple(regions_meta[f"{sp.id}.{rs.name}"]["rect"]), rs.size_m, None, V.CLASS_STRUCT)
                  for rs in sp.regions if rs.use == "thread"]
        if thread:
            tb.band = {"region": thread[0], "z0": 1.0, "z1": 1.45}


def _prop_roots(tb: TreeBuild, n: int, rng: np.random.Generator) -> None:
    """Banyan pillar roots: from limb nodes 5-16 m out and > 4.5 m up, straight-ish columns down to the ground,
    thickest near the trunk (older), with a small flare at the foot."""
    sk = tb.sk
    d = np.hypot(sk.pos[:, 0], sk.pos[:, 1])
    cand = np.nonzero((sk.order >= 1) & (d > 5.0) & (d < tb.axes[0] * 0.92) & (sk.pos[:, 2] > 4.5) & (sk.radius > 0.05))[0]
    rng.shuffle(cand)
    picked: list[int] = []
    for i in cand:
        if all(np.linalg.norm(sk.pos[i, :2] - sk.pos[j, :2]) > 3.2 for j in picked):
            picked.append(int(i))
        if len(picked) >= n:
            break
    for i in picked:
        top = sk.pos[i].astype(np.float64)
        bottom = np.array([top[0] + rng.normal(0, 0.25), top[1] + rng.normal(0, 0.25), -0.05])
        k = 7
        pts = np.array([top + (bottom - top) * (j / (k - 1)) + np.r_[rng.normal(0, 0.06, 2), 0] * math.sin(math.pi * j / (k - 1))
                        for j in range(k)])
        age = 1.0 - float(np.hypot(top[0], top[1])) / (tb.axes[0] + 1e-6)
        r = 0.14 + 0.32 * age * rng.uniform(0.7, 1.2)
        radii = np.linspace(min(r * 0.7, float(sk.radius[i]) * 1.2 + 0.03), r, k)
        radii[-1] *= 1.35
        tb.extra_wood.append((pts, radii))


def _aerial_cards(tb: TreeBuild, n: int, roots: list[V.Region], rng: np.random.Generator) -> None:
    """Hanging aerial-root curtains below the limbs (alpha cards, class structural - never dropped by season)."""
    if not roots:
        return
    sk = tb.sk
    d = np.hypot(sk.pos[:, 0], sk.pos[:, 1])
    cand = np.nonzero((sk.order >= 1) & (d > 2.5) & (sk.pos[:, 2] > 5.0) & (sk.radius > 0.03))[0]
    if len(cand) == 0:
        return
    for _ in range(n):
        i = int(rng.choice(cand))
        top = sk.pos[i].astype(F)
        reg = roots[int(rng.integers(0, len(roots)))]
        s = rng.uniform(0.7, 1.35)
        h = min(reg.size_m[1] * s, float(top[2]) - 0.6)
        if h < 1.0:
            continue
        a = rng.uniform(0, 2 * math.pi)
        nrm = np.array([math.cos(a), math.sin(a), 0.0], F)
        pos = top - np.array([0, 0, h], F)
        tb.struct_cards.append(V.Card(pos, np.array([0, 0, 1.0], F), nrm, reg.size_m[0] * s, h, reg, float(sk.hier[i]),
                                      float(sk.phase[i]), float(rng.uniform()), bool(rng.uniform() < 0.5), V.CLASS_STRUCT))


# ---------------------------------------------------------------------------------------------------- LODs
def _sides_for(r: float, table) -> int:
    for rmin, s in table:
        if r >= rmin:
            return s
    return table[-1][1]


WOOD_SHARE = (0.3, 0.3, 0.3)  # max fraction of each LOD's triangle budget spent on trunk / branches / roots


def _wood(tb: TreeBuild, level: int, bark_rect: tuple | None, budget: int | None = None) -> V.MeshData:
    """Trunk + branch tubes for a LOD; with `budget` the branch-radius cut-off and ring spacing rise until the wood fits."""
    w = tb.spec.wood
    r_min, step = w["r_min"][level], w["step"][level]
    for _ in range(12):
        md = _wood_once(tb, level, bark_rect, r_min, step)
        if budget is None or md.tris() <= budget:
            return md
        r_min *= 1.22
        step *= 1.12
    return md


def _wood_once(tb: TreeBuild, level: int, bark_rect: tuple | None, r_min: float, step: float) -> V.MeshData:
    sp = tb.spec
    sk = tb.sk
    w = sp.wood
    table = [(rmin, max(3, int(round(s * (1.0, 0.6, 0.42)[level])))) for rmin, s in w["sides"]]
    md = V.MeshData()
    tile = (64.0, 64.0)  # bark UVs in 1/64 tiles (quantizable [0, 1] range); the material's uv_scale restores tiles
    base_r = float(sk.radius[0])

    def flare(ang, z, r):  # root flare + fluting at the base of the trunk only
        k = np.clip(1.0 - z / 1.6, 0, 1)
        lobes = 1.0 + 0.18 * np.sin(ang * 5 + 0.7) * k + 0.08 * np.sin(ang * 9 + 2.1) * k
        return r * (1.0 + 0.55 * k ** 2.2) * lobes

    for ch in sk.chains:
        idx = np.array(ch)
        r = sk.radius[idx]
        keep = r >= r_min
        if keep.sum() < 2:
            continue
        idx = idx[keep]
        r = r[keep]
        pts, rr, k = V.resample_chain(sk.pos[idx].astype(np.float64), r, step, 14 if level == 0 else 22)
        sides = _sides_for(float(rr[0]), table)
        trunk = sk.order[idx[0]] == 0
        V.tube(md, pts, rr, sides, tile=tile, hier=sk.hier[idx][k], phase=sk.phase[idx][k], ao=tb.dens.ao,
               flare=flare if (trunk and level < 2) else None, uv_rect=bark_rect, cap=level == 0)
    for pts, radii in getattr(tb, "extra_wood", []):
        if radii.max() < (0.0, 0.12, 0.2)[level]:
            continue
        p2, r2, _ = V.resample_chain(pts, radii, step * 1.5, 30)
        V.tube(md, p2, r2, max(3, (7, 5, 4)[level]), tile=tile, hier=np.zeros(len(p2), F), phase=np.zeros(len(p2), F),
               ao=tb.dens.ao, uv_rect=bark_rect, cap=False)
    _ = base_r
    return md


def _cards_for_level(tb: TreeBuild, level: int, n: int, rng: np.random.Generator) -> list[V.Card]:
    """LOD0: `n` of the grown cards (stratified subset). LOD1/2: n Voronoi groups of the LOD0 cards, each replaced by
    one bigger card at the group's centroid (leaf area kept, pulled inwards by the size gain)."""
    src = tb.cards
    if level == 0 or n >= len(src):
        if n >= len(src):
            return list(src)
        order = rng.permutation(len(src))[:n]
        return [src[i] for i in sorted(order)]
    P = np.array([c.pos for c in src], np.float64)
    # farthest-point seeds -> Voronoi groups
    first = int(rng.integers(0, len(src)))
    seeds = [first]
    dmin = np.linalg.norm(P - P[first], axis=1)
    for _ in range(n - 1):
        j = int(np.argmax(dmin))
        seeds.append(j)
        dmin = np.minimum(dmin, np.linalg.norm(P - P[j], axis=1))
    S = P[seeds]
    assign = np.argmin(((P[:, None, :] - S[None, :, :]) ** 2).sum(axis=2), axis=1)
    out = []
    area_keep = (1.0, 0.92, 0.85)[level]
    for gi, si in enumerate(seeds):
        members = np.nonzero(assign == gi)[0]
        if len(members) == 0:
            continue
        seed_card = src[si]
        area = sum(src[m].w * src[m].h for m in members) * area_keep
        aspect = seed_card.h / max(seed_card.w, 1e-6)
        w = math.sqrt(area / aspect)
        h = w * aspect
        cen = P[members].mean(axis=0)
        gain = w / max(seed_card.w, 1e-6)
        radial = cen - tb.center
        radial /= max(np.linalg.norm(radial), 1e-6)
        pos = cen - radial * seed_card.w * (gain - 1) * 0.35 - seed_card.up * h * 0.25
        out.append(V.Card(pos.astype(F), seed_card.up, seed_card.nrm, w, h, seed_card.region, seed_card.hier,
                          seed_card.phase, seed_card.r, seed_card.flip, seed_card.klass))
    return out


def _build_lod(tb: TreeBuild, level: int, target: int, regions_meta: dict, rng: np.random.Generator) -> dict[str, V.MeshData]:
    sp = tb.spec
    bark = next((rs for rs in sp.regions if rs.use == "bark"), None)
    bark_rect = tuple(regions_meta[f"{sp.id}.{bark.name}"]["rect"]) if (bark is not None and level > 0) else None
    if bark_rect is not None:  # stay inside the swatch (mips / bilinear never reach the neighbour cells)
        u0, v0, u1, v1 = bark_rect
        du, dv = (u1 - u0) * 0.06, (v1 - v0) * 0.06
        bark_rect = (u0 + du, v0 + dv, u1 - du, v1 - dv)
    wood = _wood(tb, level, bark_rect, int(target * WOOD_SHARE[level]))
    leaves = V.MeshData()
    stone = V.MeshData()
    struct = tb.struct_cards
    if level > 0 and struct:
        keep = max(1, int(len(struct) * (0.45, 0.2)[level - 1]))
        struct = _cards_for_level(_Shim(tb, struct), level, keep, rng)
    for st in tb.stone:
        if level == 2 and st["kind"] == "railing":
            _railing(stone, st, simple=True)
        elif st["kind"] == "railing":
            _railing(stone, st, simple=level > 0)
        else:
            _platform(stone, st)
    if tb.band and level < 2:
        _thread_band(leaves, tb, tb.band, sides=(18, 10)[level])
    budget = target - wood.tris() - stone.tris() - leaves.tris() - 2 * len(struct)
    n_cards = max(16, budget // 2)
    cards = _cards_for_level(tb, level, n_cards, rng)
    V.cards_mesh(leaves, list(cards) + list(struct), center=tb.center, axes=tb.axes, ao=tb.dens.ao,
                 flutter=sp.flutter)
    out = {"leaves": leaves}
    if level == 0:
        out["wood"] = wood
    else:
        leaves.extend(wood)  # single material: wood UVs already point into the bark swatch
    if stone.f:
        out["stone"] = stone
    total = sum(m.tris() for m in out.values())
    if total > target:
        log(f"WARNING {tb.species}/{tb.variant} LOD{level}: {total} tris > target {target}")
    return out


class _Shim:
    """Minimal TreeBuild view whose `cards` are the structural cards (re-uses the Voronoi reduction)."""

    def __init__(self, tb: TreeBuild, cards: list[V.Card]) -> None:
        self.cards = cards
        self.center = tb.center


# ---------------------------------------------------------------------------------------------------- stone kit
def _box(md: V.MeshData, lo, hi, uv_scale: float = 1.0) -> None:
    """Axis-aligned box without its bottom face, world-scale box UVs (stone set tiles at 2 m: uv = m / 2)."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    faces = [
        ((0, 0, 1), [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], lambda p: (p[0], p[1])),
        ((0, -1, 0), [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], lambda p: (p[0], p[2])),
        ((0, 1, 0), [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], lambda p: (-p[0], p[2])),
        ((-1, 0, 0), [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], lambda p: (-p[1], p[2])),
        ((1, 0, 0), [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], lambda p: (p[1], p[2])),
    ]
    for n, quad, uvf in faces:
        idx = []
        for p in quad:
            u, v = uvf(p)
            ao = 0.75 if p[2] <= z0 + 1e-3 else 1.0
            idx.append(md.add(np.array(p, F), np.array(n, F), ((u / 2.0 + 32) / 64.0, (v / 2.0 + 32) / 64.0),
                              (0.0, 0.0, 0.0, ao)))
        md.f.append(tuple(idx))


def _platform(md: V.MeshData, st: dict) -> None:
    """Chabutra: a square stone-faced platform round the village tree (the trunk rises through it)."""
    h, r = st["height"], st["half"]
    _box(md, (-r, -r, -0.1), (r, r, h))
    _box(md, (-r - 0.12, -r - 0.12, -0.1), (r + 0.12, r + 0.12, 0.18))  # plinth course


def _railing(md: V.MeshData, st: dict, simple: bool = False) -> None:
    """Vedika: square stone railing of posts, three lens-section cross-bars and a coping (Sanchi / Bodh Gaya type)."""
    r, h = st["half"], st["height"]
    if simple:
        for sx, sy, ex, ey in ((-r, -r, r, -r + 0.18), (-r, r - 0.18, r, r), (-r, -r, -r + 0.18, r), (r - 0.18, -r, r, r)):
            _box(md, (sx, sy, 0), (ex, ey, h))
        return
    n = max(4, int(round(2 * r / 0.95)))
    for side in range(4):
        for k in range(n + 1):
            t = -r + 2 * r * k / n
            if side in (2, 3) and k in (0, n):
                continue
            x, y = (t, -r) if side == 0 else (t, r) if side == 1 else (-r, t) if side == 2 else (r, t)
            _box(md, (x - 0.11, y - 0.09, 0), (x + 0.11, y + 0.09, h))
        for zb in (0.28, 0.55, 0.82):
            if side < 2:
                y = -r if side == 0 else r
                _box(md, (-r, y - 0.05, zb - 0.07), (r, y + 0.05, zb + 0.07))
            else:
                x = -r if side == 2 else r
                _box(md, (x - 0.05, -r, zb - 0.07), (x + 0.05, r, zb + 0.07))
    for sx, sy, ex, ey in ((-r - 0.08, -r - 0.12, r + 0.08, -r + 0.12), (-r - 0.08, r - 0.12, r + 0.08, r + 0.12),
                           (-r - 0.12, -r, -r + 0.12, r), (r - 0.12, -r, r + 0.12, r)):
        _box(md, (sx, sy, h), (ex, ey, h + 0.16))


def _thread_band(md: V.MeshData, tb: TreeBuild, band: dict, sides: int = 18) -> None:
    """Votive threads wound round the trunk between z0 and z1 (a thin band just outside the bark)."""
    sk = tb.sk
    reg: V.Region = band["region"]
    u0, v0, u1, v1 = reg.rect
    trunk = [i for i in sk.chains[0]]
    zs = sk.pos[trunk, 2]
    for zi, z in enumerate((band["z0"], band["z1"])):
        pass
    rows = []
    for z, vv in ((band["z0"], v0), (band["z1"], v1)):
        j = int(np.argmin(np.abs(zs - z)))
        c = sk.pos[trunk[j]].astype(np.float64)
        r = float(sk.radius[trunk[j]])
        k = np.clip(1.0 - z / 1.6, 0, 1)
        r = r * (1.0 + 0.55 * k ** 2.2) * 1.12 + 0.02
        ring = []
        for s in range(sides + 1):
            a = 2 * math.pi * s / sides
            n = np.array([math.cos(a), math.sin(a), 0.0])
            p = np.array([c[0], c[1], z]) + n * r
            ring.append(md.add(p.astype(F), n.astype(F), (u0 + (u1 - u0) * s / sides, vv), (0.0, 0.0, 0.0, 0.8),
                               None, (0.5, V.CLASS_STRUCT)))
        rows.append(ring)
    for s in range(sides):
        md.f.append((rows[0][s], rows[0][s + 1], rows[1][s + 1], rows[1][s]))


__all__ = ["LOD_FADE", "TreeBuild", "build_tree", "region_list"]
