"""
WP4 species book (package-local helper, not an asset): per-species atlas regions + painters, growth envelopes,
card and LOD settings, signature features and the botanical basis of each tree. OWNER: Technical Artist D (TA-04).

Every species here is native to (or long naturalised in) the subcontinent before 300 BCE - none is in BANNED_PLANTS
(src/render/style/vegetation.ts; ART_BIBLE §1.5). Basis notes per species are in BOTANY and repeated in each asset
script's docstring.

Atlas pages (A class, 2 x 2 species quadrants of 4 x 4 cells, see _leafkit.Page):
    veg_leaves_a  figs & groves     banyan (q0), peepal (q1), mango (q2), neem (q3)
    veg_leaves_b  forest            sal (q0), teak (q1), palash (q2), amaltas (q3)
    veg_leaves_c  scrub & palms     babul (q0), bamboo (q1), palmyra (q2), date palm + coconut (q3)
Leaves are painted in the REF_SEASON colour (TREE_SPECIES.leaf.sharad); the runtime tints base regions by
leaf[season] / leaf.sharad. Alternate (seasonal) regions are painted in their own season's colours and are NOT tinted.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np

import _leafkit as K
from _leafkit import Canvas, LeafLook, RegionSpec, Venation

F = np.float32
hexlin = K.hexlin

BOTANY = {
    "banyan": "Ficus benghalensis (Indian banyan) - native to the subcontinent; the vata of the Vedas and Pali texts.",
    "peepal": "Ficus religiosa (peepal / ashvattha / bodhi tree) - native; venerated with railings and threads since the "
              "Indus period (seal motifs) and the Mauryan age (Bodh Gaya).",
    "mango": "Mangifera indica (amra) - native to NE India / Burma; orchards (amrakuta) are named in Pali canon texts.",
    "neem": "Azadirachta indica (nimba) - native to the subcontinent; used in Vedic-era medicine.",
    "sal": "Shorea robusta (sala) - native dominant tree of the eastern and northern forests (Buddha's birth grove).",
    "teak": "Tectona grandis (shaka) - native to peninsular India; ancient shipbuilding timber.",
    "palash": "Butea monosperma (palasha, flame of the forest) - native; sacred in Vedic ritual.",
    "amaltas": "Cassia fistula (aragvadha, golden shower) - native; listed in early Ayurvedic texts.",
    "babul": "Vachellia nilotica (babbula) - native to the dry northwest and Deccan.",
    "bamboo": "Dendrocalamus strictus / Bambusa bambos (venu) - native clumping bamboos.",
    "palmyra": "Borassus flabellifer (tala) - palmyra palm of the plains and south; palm-leaf manuscripts.",
    "date_palm": "Phoenix sylvestris (kharjura, wild date / sugar date palm) - native to the plains and NW.",
    "coconut": "Cocos nucifera (narikela) - present on the south-west coast in the period; coast only (P2).",
}


def leaf_look(hexcol: str, **kw: Any) -> LeafLook:
    return LeafLook(color=hexlin(hexcol), **kw)


# ----------------------------------------------------------------------------------------------- generic painters
def broadleaf(prof: np.ndarray, color: str, *, leaf_len: float, per_m: float, ven: Venation, look_kw: dict,
              back_frac: float = 0.25, petiole: float = 0.0, notch: float = 0.0, side: int = 5, sub: int = 1,
              main_len: float = 0.88, side_len=(0.32, 0.5), spread=(40.0, 80.0), tip_leaves: int = 2, whorl: bool = False,
              droop: float = 0.55, roll: float = 0.5, leaf_scale_alt: float = 1.0,
              alt_fn: Callable[[Canvas, np.random.Generator, list], None] | None = None,
              alt_color: str | None = None, twig: str = "#6e5a44", extra: Callable | None = None,
              envelope=(0.46, 0.47), curve: float = 0.0, serration=(0, 0.0)) -> Callable[[Canvas, np.random.Generator, bool], None]:
    """Painter of a leafy twig cluster. With alt=True the SAME twigs / leaves are drawn (same seed) in `alt_color`
    and `alt_fn` then adds flowers / fruit on the twig tips."""

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        col = alt_color if (alt and alt_color) else color
        look = leaf_look(col, **look_kw)
        back = leaf_look(col, **{**look_kw, "underside": True, "rough": look_kw.get("rough", 0.55) + 0.1})
        tw = K.twig_tree(cv, side=side, sub=sub, main_len=main_len, side_len=side_len, rng=rng)
        tc = hexlin(twig)
        tips = [t.p1 for t in tw]

        def dl(p, a, sc, depth):
            lk = back if rng.uniform() < back_frac else look
            cv.leaf(p, a, leaf_len * sc * rng.uniform(0.85, 1.12), prof, lk, ven, roll=float(rng.normal(0, roll)),
                    droop=float(rng.uniform(0, droop)), petiole=petiole * sc, petiole_color=tc * 1.25, notch=notch,
                    curve=curve * float(rng.choice([-1, 1])), serration=serration, rng=rng, z=0.01 * (depth + 1))

        K.cluster(cv, tw, dl, per_m=per_m, twig_color=tc, spread=spread, rng=rng, leaf_len=leaf_len * 1.25,
                  tip_leaves=tip_leaves, whorl=whorl, envelope=envelope)
        if extra is not None:
            extra(cv, rng, tips)
        if alt and alt_fn is not None:
            alt_fn(cv, rng, tips)

    return paint


def compound(prof: np.ndarray, color: str, *, rachis_len: float, pairs: int, leaflet_len: tuple[float, float],
             per_m: float, ven: Venation, look_kw: dict, side: int = 6, sub: int = 1, side_len=(0.3, 0.42),
             spread=(35.0, 65.0), tip_leaves: int = 3, serration=(0, 0.0), curve: float = 0.0, leaflet_angle: float = 58.0,
             terminal: bool = True, alt_fn=None, alt_color: str | None = None, twig: str = "#6e5a44",
             rachis: str = "#5a6a34", droop: float = 0.4, envelope=(0.44, 0.45), taper: float = 0.35,
             rachis_r: float = 0.0012) -> Callable[[Canvas, np.random.Generator, bool], None]:
    """Painter of pinnately compound leaves (neem, amaltas, palash trifoliate) on a twig cluster."""

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        col = alt_color if (alt and alt_color) else color
        look = leaf_look(col, **look_kw)
        tw = K.twig_tree(cv, side=side, sub=sub, side_len=side_len, rng=rng)
        tc = hexlin(twig)
        rc = hexlin(rachis)
        tips = [t.p1 for t in tw]

        def dl(p, a, sc, depth):
            K.pinnate(cv, p, a, rachis_len * sc, prof, look, ven, pairs=pairs, leaflet_len=leaflet_len, rachis_color=rc,
                      serration=serration, curve=curve, rng=rng, z=0.01 * (depth + 1), rachis_r=rachis_r,
                      leaflet_angle=leaflet_angle, terminal=terminal, droop=droop, taper=taper)

        K.cluster(cv, tw, dl, per_m=per_m, twig_color=tc, spread=spread, tip_leaves=tip_leaves, rng=rng,
                  leaf_len=rachis_len * 1.15, envelope=envelope)
        if alt and alt_fn is not None:
            alt_fn(cv, rng, tips)

    return paint


def bark_swatch(color: str, *, fissure: float = 0.6, horizontal: float = 0.0, lenticel: float = 0.0,
                rings: float = 0.0) -> Callable[[Canvas, np.random.Generator, bool], None]:
    """Opaque bark patch for single-material far LODs (the trunk of LOD2 maps into it). Vertical fissures (furrowed
    barks), horizontal lenticels (figs), rings (palms)."""

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        H, W = cv.H, cv.W
        y, x = np.mgrid[0:H, 0:W].astype(F)
        u, v = x / W, y / H
        n1 = np.zeros((H, W), F)
        for k, (fx, fy, amp) in enumerate(((3, 1, 1.0), (7, 2, 0.5), (15, 3, 0.3), (31, 5, 0.15))):
            ph = float(rng.uniform(0, 6.28))
            n1 += amp * np.sin(u * math.pi * 2 * fx + np.sin(v * math.pi * 2 * fy + ph) * 1.7 + ph)
        fiss = np.clip(np.abs(n1) / 1.4, 0, 1) ** 0.5
        val = 0.62 + 0.38 * (fissure * fiss + (1 - fissure))
        if horizontal > 0:
            hz = 0.5 + 0.5 * np.sin(v * math.pi * 2 * 22 + np.sin(u * 9 + 1.3) * 0.8)
            val *= 1 - horizontal * (hz > 0.92)
        if rings > 0:
            rg = 0.5 + 0.5 * np.sin(v * math.pi * 2 * 14)
            val *= 1 - rings * rg ** 6
        if lenticel > 0:
            spots = (rng.uniform(size=(H, W)) < lenticel * 0.004).astype(F)
            val *= 1 - 0.35 * K._box_blur(spots, 2) * 6
        c = hexlin(color)[None, None, :] * val[..., None]
        cv.rgb[...] = c
        cv.a[...] = 1.0
        cv.rough[...] = 0.9
        cv.transl[...] = 0.0
        g = np.gradient(val, axis=1)
        nrm = np.stack([-g * 6, np.zeros_like(g), np.ones_like(g)], axis=-1)
        cv.n[...] = nrm / np.linalg.norm(nrm, axis=-1, keepdims=True)
        cv.layer = 1

    return paint


def figs(color: str, size: float, count: tuple[int, int]) -> Callable:
    """Paired figs (syconia) in the leaf axils near twig tips (banyan red, peepal purple-black)."""

    def extra(cv: Canvas, rng: np.random.Generator, tips: list) -> None:
        c = hexlin(color)
        for t in tips:
            for _ in range(int(rng.integers(*count))):
                p = t + rng.normal(0, size * 2.5, 2)
                cv.disc(p, size * rng.uniform(0.8, 1.15), c * rng.uniform(0.8, 1.1), dome=0.8, rough=0.45, transl=0.15,
                        z=0.03, rng=rng)

    return extra


# ----------------------------------------------------------------------------------------------- tree settings
@dataclass
class TreeSpec:
    """Everything the tree builder needs for one species (values that the Art Director owns come from
    TREE_SPECIES via @style; these are the modelling choices)."""
    id: str
    page: str
    quadrant: int
    regions: list[RegionSpec]
    bark_set: str
    growth: dict                        # GrowthParams kwargs (envelope as a dict)
    cards: dict = field(default_factory=dict)       # place_cards kwargs
    wood: dict = field(default_factory=dict)        # per-LOD wood thresholds
    lod_card_scale: tuple[float, float, float] = (1.0, 1.7, 3.0)
    flutter: float = 1.0
    builder: str = "broadleaf"          # broadleaf | palm | bamboo
    variants: dict = field(default_factory=dict)    # per-variant overrides + signature features
    extras: dict = field(default_factory=dict)


SPECIES: dict[str, TreeSpec] = {}
PAGES: dict[str, list[str]] = {"a": ["banyan", "peepal", "mango", "neem"]}

# ---------------------------------------------------------------------------------------------------- banyan
_banyan_spray = broadleaf(K.BANYAN, "#3d5c2b", leaf_len=0.165, per_m=16, ven=Venation(spacing=0.09, angle=58, midrib=0.016),
                          look_kw=dict(vein_light=0.3, rough=0.42, fold=0.04, yellow_tips=0.03, bulge=0.003),
                          petiole=0.12, back_frac=0.2, extra=figs("#9c3b23", 0.009, (0, 3)))


def _aerial_roots(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
    """Hanging aerial-root curtain: bundles of thin tapering strands, grey-brown with paler fresh tips."""
    W, H = cv.size
    base = hexlin("#7a6e60")
    tip = hexlin("#b08a6a")
    n = 34
    xs = np.sort(rng.uniform(0.1, 0.9, n)) * W
    for i, x0 in enumerate(xs):
        top = H * (1 - cv.margin * 1.1)
        ln = H * rng.uniform(0.35, 0.93) * (1.0 - 0.35 * abs(x0 / W - 0.5))
        x1 = x0 + rng.normal(0, 0.025) * W
        r0 = rng.uniform(0.004, 0.012)
        segs = 5
        prev = np.array([x0, top], F)
        for s in range(segs):
            f = (s + 1) / segs
            nxt = np.array([x0 + (x1 - x0) * f + rng.normal(0, 0.004) * W, top - ln * f], F)
            c = base * (1 - f * 0.4) + tip * (f * 0.4)
            cv.stroke(prev, nxt, r0 * (1 - 0.55 * (s / segs)), r0 * (1 - 0.55 * f), c * rng.uniform(0.85, 1.1),
                      rough=0.85, transl=0.05, bend=float(rng.normal(0, 0.02)))
            prev = nxt
        if rng.uniform() < 0.5:  # split tips
            for _ in range(2):
                q = prev + np.array([rng.normal(0, 0.02) * W, -rng.uniform(0.02, 0.06) * H], F)
                cv.stroke(prev, q, r0 * 0.3, r0 * 0.12, tip, rough=0.8)


SPECIES["banyan"] = TreeSpec(
    id="banyan", page="a", quadrant=0, bark_set="veg_bark_fig",
    regions=[
        *[RegionSpec(f"spray{i}", (c, r, 1, 1), (1.25, 1.25), _banyan_spray) for i, (c, r) in
          enumerate([(0, 0), (1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (0, 2), (1, 2), (0, 3)])],
        RegionSpec("bark", (1, 3, 1, 1), (2.0, 2.0), bark_swatch("#7d7466", fissure=0.25, lenticel=1.0), use="bark", margin=0.0),
        RegionSpec("roots_a", (2, 1, 1, 3), (1.4, 4.2), _aerial_roots, klass=0.25, use="root", ao_strength=0.3),
        RegionSpec("roots_b", (3, 1, 1, 3), (1.4, 4.2), _aerial_roots, klass=0.25, use="root", ao_strength=0.3),
    ],
    growth=dict(envelope=dict(zc=11.5, rx=17.0, ry=16.0, rz=6.5, flat_bottom=0.32, lumps=9, lump_amp=0.18),
                attractors=4200, step=0.6, influence=6.0, kill=1.2, iterations=110, trunk_height=4.2,
                trunk_lean=(0.3, -0.2), base_radius=1.2, tip_radius=0.012, tropism=(0.0, 0.0, -0.05),
                seeds_on_trunk=(0.7, 1.0), max_children=5),
    cards=dict(per_tip=3.0, along=2.0, outward=0.7, jitter_deg=35, droop=0.25),
    wood=dict(r_min=(0.03, 0.08, 0.22), step=(0.6, 1.4, 3.0), sides=((0.6, 14), (0.25, 9), (0.08, 6), (0.0, 4))),
    flutter=0.5,
    extras=dict(prop_roots=(10, 16), aerial_cards=(60, 22, 8)),
    variants={"a": {}, "b": dict(scale=0.85, seed_offset=11, prop_roots=(6, 10)),
              "c": dict(scale=0.95, seed_offset=23, platform=True)},
)

# ---------------------------------------------------------------------------------------------------- peepal
_peepal_ven = Venation(spacing=0.07, angle=55, palmate_base=2, midrib=0.013)
_peepal_spray = broadleaf(K.PEEPAL, "#4b6a31", leaf_len=0.15, per_m=18, ven=_peepal_ven,
                          look_kw=dict(vein_light=0.24, rough=0.5, fold=0.05, yellow_tips=0.06, spots=0.1, holes=0.04),
                          petiole=0.5, notch=0.12, spread=(45, 85), back_frac=0.28, roll=0.6, droop=0.65,
                          extra=figs("#4a2a3a", 0.006, (0, 2)))


def _threads(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
    """Votive threads (kalava) wound round a sacred trunk: red / saffron / undyed cotton bands, mapped on a band
    around the trunk (u around, v across the band)."""
    W, H = cv.size
    cols = [hexlin("#c2412d"), hexlin("#9c2f25"), hexlin("#d9a02c"), hexlin("#d9cdb3"), hexlin("#c8381f")]
    y = H * 0.12
    while y < H * 0.88:
        c = cols[int(rng.integers(0, len(cols)))]
        r = H * rng.uniform(0.006, 0.014)
        slope = rng.normal(0, 0.04) * H
        cv.stroke((W * 0.0, y), (W * 1.0, y + slope), r, r, c * rng.uniform(0.85, 1.1), rough=0.9, transl=0.2)
        y += r * rng.uniform(1.6, 3.2)


SPECIES["peepal"] = TreeSpec(
    id="peepal", page="a", quadrant=1, bark_set="veg_bark_fig",
    regions=[
        *[RegionSpec(f"spray{i}", (c, r, 1, 1), (0.95, 0.95), _peepal_spray) for i, (c, r) in
          enumerate([(x, y) for y in range(4) for x in range(4) if (x, y) not in ((2, 3), (3, 3))])],
        RegionSpec("bark", (2, 3, 1, 1), (2.0, 2.0), bark_swatch("#8a8276", fissure=0.15, lenticel=1.5, horizontal=0.3),
                   use="bark", margin=0.0),
        RegionSpec("threads", (3, 3, 1, 1), (1.0, 0.5 * 2.0), _threads, klass=0.25, use="thread", margin=0.0, ao_strength=0.2),
    ],
    growth=dict(envelope=dict(zc=12.5, rx=9.0, ry=8.5, rz=6.8, flat_bottom=0.15, hollow=0.45, lumps=8, lump_amp=0.33),
                attractors=2600, step=0.55, influence=5.5, kill=1.1, iterations=100, trunk_height=4.6,
                trunk_lean=(0.6, 0.3), base_radius=0.8, tip_radius=0.01, tropism=(0.0, 0.0, 0.25),
                seeds_on_trunk=(0.7, 1.0)),
    cards=dict(per_tip=3.0, along=2.5, outward=0.6, jitter_deg=38, droop=0.2),
    wood=dict(r_min=(0.025, 0.07, 0.18), step=(0.5, 1.2, 2.5), sides=((0.5, 14), (0.2, 9), (0.07, 6), (0.0, 4))),
    flutter=1.0,
    variants={"a": {}, "b": dict(scale=0.85, seed_offset=7), "c": dict(scale=0.95, seed_offset=19, shrine=True)},
)

# ---------------------------------------------------------------------------------------------------- mango
def _mango_panicles(cv: Canvas, rng: np.random.Generator, tips: list) -> None:
    for t in tips:
        if rng.uniform() < 0.75:
            ang = math.pi / 2 + rng.normal(0, 0.35)
            K.panicle(cv, t, ang, rng.uniform(0.13, 0.2), hexlin("#c9b46a"), hexlin("#7d6a3c"), branches=7,
                      flower_r=0.0045, density=6, rng=rng)


_mango_spray = broadleaf(K.MANGO, "#304d27", leaf_len=0.24, per_m=6, ven=Venation(spacing=0.05, angle=60, midrib=0.011),
                         look_kw=dict(vein_light=0.25, rough=0.45, fold=0.07, yellow_tips=0.04),
                         petiole=0.12, side=6, sub=1, main_len=0.62, side_len=(0.28, 0.4), spread=(30, 70), tip_leaves=7,
                         whorl=True, droop=0.7, back_frac=0.15, alt_fn=_mango_panicles, alt_color="#3a5a2e")
SPECIES["mango"] = TreeSpec(
    id="mango", page="a", quadrant=2, bark_set="veg_bark_furrowed",
    regions=[
        *[RegionSpec(f"spray{i}", (c, 0 if i < 4 else 1, 1, 1), (1.0, 1.0), _mango_spray,
                     alt=(c, 2 if i < 4 else 3, 1, 1) if i < 7 else None)
          for i, c in enumerate([0, 1, 2, 3, 0, 1, 2, 3])],
        RegionSpec("bark", (3, 3, 1, 1), (2.0, 2.0), bark_swatch("#4a3c30", fissure=0.7), use="bark", margin=0.0),
    ],
    growth=dict(envelope=dict(zc=6.6, rx=7.2, ry=7.0, rz=5.0, flat_bottom=0.05, hollow=0.2, lumps=7, lump_amp=0.15),
                attractors=2600, step=0.45, influence=4.5, kill=0.9, iterations=100, trunk_height=1.9,
                trunk_lean=(0.2, 0.1), base_radius=0.45, tip_radius=0.009, tropism=(0, 0, 0.05),
                seeds_on_trunk=(0.5, 1.0)),
    cards=dict(per_tip=3.0, along=2.5, outward=0.75, jitter_deg=35, droop=0.3),
    wood=dict(r_min=(0.025, 0.07, 0.16), step=(0.45, 1.0, 2.2), sides=((0.35, 12), (0.15, 8), (0.06, 6), (0.0, 4))),
    flutter=0.45,
    variants={"a": {}, "b": dict(scale=0.88, seed_offset=5), "c": dict(scale=1.0, seed_offset=13, envelope=dict(rx=8.0, rz=4.6))},
)

# ---------------------------------------------------------------------------------------------------- neem
def _neem_blossom(cv: Canvas, rng: np.random.Generator, tips: list) -> None:
    for t in tips:
        if rng.uniform() < 0.8:
            ang = math.pi / 2 + rng.normal(0, 0.6)
            K.panicle(cv, t + rng.normal(0, 0.01, 2), ang, rng.uniform(0.1, 0.16), hexlin("#e8e2c8"), hexlin("#8a8a5a"),
                      branches=6, flower_r=0.004, density=5, cone=0.55, rng=rng)


_neem_spray = compound(K.NEEM_LEAFLET, "#517431", rachis_len=0.24, pairs=6, leaflet_len=(0.055, 0.07), per_m=9,
                       ven=Venation(spacing=0.12, angle=60, strength=0.5), look_kw=dict(vein_light=0.15, rough=0.55, fold=0.04),
                       serration=(14, 0.25), curve=0.05, leaflet_angle=55, alt_fn=_neem_blossom, alt_color="#6a8a3c",
                       envelope=(0.42, 0.42))
SPECIES["neem"] = TreeSpec(
    id="neem", page="a", quadrant=3, bark_set="veg_bark_furrowed",
    regions=[
        *[RegionSpec(f"spray{i}", (c, 0 if i < 4 else 1, 1, 1), (0.75, 0.75), _neem_spray,
                     alt=(c, 2 if i < 4 else 3, 1, 1) if i < 7 else None)
          for i, c in enumerate([0, 1, 2, 3, 0, 1, 2, 3])],
        RegionSpec("bark", (3, 3, 1, 1), (2.0, 2.0), bark_swatch("#5a4a3c", fissure=0.85), use="bark", margin=0.0),
    ],
    growth=dict(envelope=dict(zc=8.8, rx=6.0, ry=5.8, rz=4.4, flat_bottom=0.1, hollow=0.35, lumps=6, lump_amp=0.2),
                attractors=2200, step=0.45, influence=4.2, kill=0.85, iterations=90, trunk_height=2.6,
                trunk_lean=(0.3, 0.2), base_radius=0.4, tip_radius=0.008, tropism=(0, 0, 0.15),
                seeds_on_trunk=(0.55, 1.0)),
    cards=dict(per_tip=2.5, along=2.0, outward=0.6, jitter_deg=35, droop=0.2),
    wood=dict(r_min=(0.022, 0.06, 0.14), step=(0.45, 1.0, 2.0), sides=((0.3, 12), (0.12, 8), (0.05, 6), (0.0, 4))),
    flutter=0.7,
    variants={"a": {}, "b": dict(scale=0.85, seed_offset=3), "c": dict(scale=1.05, seed_offset=17, envelope=dict(rz=5.2))},
)

__all__ = ["BOTANY", "PAGES", "SPECIES", "TreeSpec", "bark_swatch", "broadleaf", "compound", "figs"]
