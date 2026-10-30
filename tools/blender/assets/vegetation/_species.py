"""
WP4 species book (package-local helper, not an asset): per-species atlas regions + painters, growth envelopes,
card and LOD settings, signature features and the botanical basis of each tree. OWNER: Technical Artist D (TA-04).

Every species here is native to (or long naturalised in) the subcontinent before 300 BCE - none is in BANNED_PLANTS
(src/render/style/vegetation.ts; ART_BIBLE §1.5). Basis notes per species are in BOTANY and repeated in each asset
script's docstring.

Atlas pages (A class 2048 / 1024 / 512, 8 species blocks of 4 x 2 cells, see _leafkit.Page):
    veg_leaves_a  broadleaf trees   banyan, peepal, mango, neem, sal, teak, palash, amaltas (blocks 0-7)
    veg_leaves_b  scrub, palms, ground plants   babul, bamboo, palmyra, date palm, coconut, shrubs, kash + reeds,
                                    lotus + doob grass
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


# ----------------------------------------------------------------------------------------------- more painters
def bare_twigs(color: str, *, side: int = 6, sub: int = 2, r: float = 0.011, crooked: float = 0.0,
               spread=(30.0, 65.0)) -> Callable[[Canvas, np.random.Generator, bool], None]:
    """Leafless twig sprays (bare-season silhouette cards, class 0.75): thicker, more branched, optionally crooked."""

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        tw = K.twig_tree(cv, side=side, sub=sub, r=r, side_angle=spread, rng=rng)
        c = hexlin(color)
        for t in tw:
            cv.stroke(t.p0, t.p1, t.r0, t.r1 * 1.2 + 0.0012 * cv.size[1], c * rng.uniform(0.85, 1.1), rough=0.88,
                      bend=t.bend + rng.normal(0, crooked))

    return paint


def _palash_flowers(cv: Canvas, rng: np.random.Generator, tips: list, twigs: list | None = None) -> None:
    """Flame of the forest: dense racemes of curved orange-red beak flowers with velvety olive-black calyces along
    the bare twig tips."""
    fl = hexlin("#e2571e")
    deep = hexlin("#c2412d")
    calyx = hexlin("#3a3226")
    for t in tips:
        for _ in range(int(rng.integers(7, 13))):
            base = t + rng.normal(0, 0.035, 2) * cv.size[1]
            ang = rng.uniform(0, 2 * math.pi)
            ln = rng.uniform(0.035, 0.05)
            col = fl * (1 - rng.uniform(0, 0.25)) + deep * rng.uniform(0, 0.25)
            cv.disc(base, ln * 0.18, calyx, dome=0.7, rough=0.8, transl=0.1, rng=rng)
            cv.petal(base, ang, ln, 0.5, col, curve=0.18 * float(rng.choice([-1, 1])), transl=0.75, rough=0.5)
            if rng.uniform() < 0.6:
                cv.petal(base, ang + rng.uniform(0.4, 0.9), ln * 0.7, 0.55, col * 1.08, transl=0.75, rough=0.5)


def palash_bloom(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
    """Alternate of the palash spray: the same twigs, leafless, blazing with flowers (vasanta)."""
    tw = K.twig_tree(cv, side=5, sub=1, r=0.009, rng=rng)
    c = hexlin("#4a4038")
    for t in tw:
        cv.stroke(t.p0, t.p1, t.r0, t.r1 + 0.001 * cv.size[1], c, rough=0.85, bend=t.bend + rng.normal(0, 0.05))
    tips = [t.p1 for t in tw] + [t.p0 + (t.p1 - t.p0) * 0.6 for t in tw if t.order == 1]
    _palash_flowers(cv, rng, tips)


def _teak_plumes(cv: Canvas, rng: np.random.Generator, tips: list) -> None:
    """Teak flowers (varsha): big erect terminal panicles of tiny white flowers held above the leaves."""
    for t in tips:
        if rng.uniform() < 0.8:
            K.panicle(cv, t, math.pi / 2 + rng.normal(0, 0.3), rng.uniform(0.32, 0.45), hexlin("#ece6d2"), hexlin("#b0a888"),
                      branches=11, flower_r=0.0075, density=11, cone=0.55, rng=rng)


def _sal_flowers(cv: Canvas, rng: np.random.Generator, tips: list) -> None:
    for t in tips:
        if rng.uniform() < 0.7:
            K.panicle(cv, t, math.pi / 2 + rng.normal(0, 0.5), rng.uniform(0.12, 0.18), hexlin("#e3dcb0"), hexlin("#8a845a"),
                      branches=6, flower_r=0.0055, density=5, cone=0.55, rng=rng)


def _amaltas_chains(cv: Canvas, rng: np.random.Generator, tips: list) -> None:
    W, H = cv.size
    for t in tips:
        for _ in range(int(rng.integers(1, 3))):
            top = t + rng.normal(0, 0.02, 2) * H
            ln = min(rng.uniform(0.3, 0.45) * H, top[1] - H * cv.margin * 1.5)
            if ln > 0.08 * H:
                K.raceme(cv, top, ln, hexlin("#f0c42e"), hexlin("#7d7a3c"), flowers=int(ln / H * 40), flower_r=0.016,
                         rng=rng)


def _babul_balls(cv: Canvas, rng: np.random.Generator, tips: list) -> None:
    c = hexlin("#e8c33a")
    for t in tips:
        for _ in range(int(rng.integers(3, 7))):
            p = t + rng.normal(0, 0.03, 2) * cv.size[1]
            cv.disc(p, rng.uniform(0.007, 0.01), c * rng.uniform(0.9, 1.1), fuzz=0.35, dome=0.8, rough=0.7, transl=0.6,
                    rng=rng)


# ----------------------------------------------------------------------------------------------- tree settings
@dataclass
class TreeSpec:
    """Everything the tree builder needs for one species (values that the Art Director owns come from
    TREE_SPECIES via @style; these are the modelling choices)."""
    id: str
    page: str
    block: int
    regions: list[RegionSpec]
    bark_set: str
    growth: dict                        # GrowthParams kwargs (envelope as a dict)
    cards: dict = field(default_factory=dict)       # place_cards kwargs
    wood: dict = field(default_factory=dict)        # per-LOD wood thresholds
    flutter: float = 1.0
    builder: str = "broadleaf"          # broadleaf | palm | bamboo
    variants: dict = field(default_factory=dict)    # per-variant overrides + signature features
    extras: dict = field(default_factory=dict)


SPECIES: dict[str, TreeSpec] = {}
PAGES: dict[str, list[str]] = {"a": ["banyan", "peepal", "mango", "neem", "sal", "teak", "palash", "amaltas"],
                                "b": ["babul", "bamboo", "palmyra", "date_palm", "coconut", "shrubs", "kash_reeds", "lotus_grass"]}
WOOD_STD = dict(r_min=(0.03, 0.08, 0.18), step=(0.55, 1.3, 2.8), sides=((0.4, 14), (0.18, 9), (0.07, 6), (0.0, 4)))


def flowering_block(spray, size: float, bark: RegionSpec, extra: RegionSpec | None = None) -> list[RegionSpec]:
    """Standard 4 x 2 block: three sprays (row 0) with their seasonal alternates above (row 1), the bark swatch at
    (3, 0) and a fourth region at (3, 1) (a spray without alternate by default)."""
    out = [RegionSpec(f"spray{i}", (i, 0, 1, 1), (size, size), spray, alt=(i, 1, 1, 1)) for i in range(3)]
    out.append(bark)
    out.append(extra or RegionSpec("spray3", (3, 1, 1, 1), (size, size), spray))
    return out


def bark_region(color: str, **kw: Any) -> RegionSpec:
    return RegionSpec("bark", (3, 0, 1, 1), (2.0, 2.0), bark_swatch(color, **kw), use="bark", margin=0.0)


# ---------------------------------------------------------------------------------------------------- banyan
_banyan_spray = broadleaf(K.BANYAN, "#3d5c2b", leaf_len=0.165, per_m=16, ven=Venation(spacing=0.09, angle=58, midrib=0.016),
                          look_kw=dict(vein_light=0.3, rough=0.42, fold=0.04, yellow_tips=0.03, bulge=0.003),
                          petiole=0.03, back_frac=0.2, extra=figs("#9c3b23", 0.009, (0, 3)))


def _aerial_roots(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
    """Hanging aerial-root curtain: bundles of thin tapering strands, grey-brown with paler fresh tips."""
    W, H = cv.size
    base = hexlin("#7a6e60")
    tip = hexlin("#b08a6a")
    n = 26
    xs = np.sort(rng.uniform(0.12, 0.88, n)) * W
    for x0 in xs:
        top = H * (1 - cv.margin * 1.1)
        ln = H * rng.uniform(0.35, 0.93) * (1.0 - 0.35 * abs(x0 / W - 0.5))
        x1 = x0 + rng.normal(0, 0.025) * W
        r0 = rng.uniform(0.004, 0.011)
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
    id="banyan", page="a", block=0, bark_set="veg_bark_fig",
    regions=[
        *[RegionSpec(f"spray{i}", (c, r, 1, 1), (1.25, 1.25), _banyan_spray) for i, (c, r) in
          enumerate([(0, 0), (1, 0), (2, 0), (0, 1), (1, 1)])],
        RegionSpec("bark", (2, 1, 1, 1), (2.0, 2.0), bark_swatch("#7d7466", fissure=0.25, lenticel=1.0), use="bark", margin=0.0),
        RegionSpec("roots", (3, 0, 1, 2), (1.5, 3.0), _aerial_roots, klass=0.25, use="root", ao_strength=0.3),
    ],
    growth=dict(envelope=dict(zc=11.0, rx=17.0, ry=16.0, rz=6.5, flat_bottom=0.3, lobes=10, lobe_size=0.4, lobe_dist=0.62,
                              lobe_rise=(-0.3, 0.35), top_lobe=1.0),
                attractors=5200, step=0.6, influence=5.5, kill=1.1, iterations=120, trunk_height=4.2,
                trunk_lean=(0.3, -0.2), base_radius=1.2, tip_radius=0.012, tropism=(0.0, 0.0, -0.05),
                seeds_on_trunk=(0.6, 1.0), max_children=5, limb_rise=0.12, limb_reach=0.85),
    cards=dict(per_tip=4.0, along=5.0, outward=0.7, jitter_deg=35, droop=0.25, max_radius=0.07),
    wood=dict(r_min=(0.035, 0.09, 0.25), step=(0.6, 1.4, 3.0), sides=((0.6, 16), (0.25, 9), (0.08, 6), (0.0, 4))),
    flutter=0.5,
    extras=dict(prop_roots=(8, 13), aerial_cards=(70, 22, 8)),
    variants={"a": {}, "b": dict(scale=0.85, seed_offset=11, prop_roots=(5, 8)),
              "c": dict(scale=0.95, seed_offset=23, platform=True)},
)

# ---------------------------------------------------------------------------------------------------- peepal
_peepal_ven = Venation(spacing=0.07, angle=55, palmate_base=2, midrib=0.013)
_peepal_spray = broadleaf(K.PEEPAL, "#4b6a31", leaf_len=0.15, per_m=18, ven=_peepal_ven,
                          look_kw=dict(vein_light=0.24, rough=0.5, fold=0.05, yellow_tips=0.06, spots=0.1, holes=0.04),
                          petiole=0.075, notch=0.12, spread=(45, 85), back_frac=0.28, roll=0.6, droop=0.65,
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
    id="peepal", page="a", block=1, bark_set="veg_bark_fig",
    regions=[
        *[RegionSpec(f"spray{i}", (c, r, 1, 1), (0.95, 0.95), _peepal_spray) for i, (c, r) in
          enumerate([(0, 0), (1, 0), (2, 0), (3, 0), (0, 1), (1, 1)])],
        RegionSpec("bark", (2, 1, 1, 1), (2.0, 2.0), bark_swatch("#8a8276", fissure=0.15, lenticel=1.5, horizontal=0.12),
                   use="bark", margin=0.0),
        RegionSpec("threads", (3, 1, 1, 1), (1.0, 1.0), _threads, klass=0.25, use="thread", margin=0.0, ao_strength=0.2),
    ],
    growth=dict(envelope=dict(zc=12.0, rx=9.0, ry=8.5, rz=6.8, flat_bottom=0.12, lobes=8, lobe_size=0.46, lobe_dist=0.6,
                              lobe_rise=(-0.3, 0.65), top_lobe=1.15),
                attractors=3200, step=0.5, influence=4.5, kill=0.9, iterations=110, trunk_height=4.2,
                trunk_lean=(0.6, 0.3), base_radius=0.8, tip_radius=0.01, tropism=(0.0, 0.0, 0.2),
                seeds_on_trunk=(0.6, 1.0), limb_rise=0.35, limb_reach=0.72, leader=True),
    cards=dict(per_tip=4.0, along=5.0, outward=0.6, jitter_deg=38, droop=0.2, max_radius=0.06),
    wood=dict(r_min=(0.03, 0.08, 0.2), step=(0.55, 1.3, 2.8), sides=((0.5, 14), (0.2, 9), (0.07, 6), (0.0, 4))),
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
                         petiole=0.03, side=7, sub=1, main_len=0.6, side_len=(0.26, 0.38), spread=(30, 70), tip_leaves=7,
                         whorl=True, droop=0.7, back_frac=0.15, alt_fn=_mango_panicles, alt_color="#3a5a2e")
SPECIES["mango"] = TreeSpec(
    id="mango", page="a", block=2, bark_set="veg_bark_furrowed",
    regions=flowering_block(_mango_spray, 1.0, bark_region("#4a3c30", fissure=0.7)),
    growth=dict(envelope=dict(zc=6.6, rx=7.2, ry=7.0, rz=5.0, flat_bottom=0.04, lobes=8, lobe_size=0.55, lobe_dist=0.5,
                              lobe_rise=(-0.35, 0.45), top_lobe=1.0),
                attractors=3200, step=0.45, influence=4.2, kill=0.85, iterations=110, trunk_height=1.9,
                trunk_lean=(0.2, 0.1), base_radius=0.45, tip_radius=0.009, tropism=(0, 0, 0.05),
                seeds_on_trunk=(0.5, 1.0), limb_rise=0.3, limb_reach=0.7),
    cards=dict(per_tip=4.0, along=5.0, outward=0.75, jitter_deg=35, droop=0.3, max_radius=0.06),
    wood=dict(r_min=(0.028, 0.07, 0.16), step=(0.45, 1.0, 2.2), sides=((0.35, 12), (0.15, 8), (0.06, 6), (0.0, 4))),
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
    id="neem", page="a", block=3, bark_set="veg_bark_furrowed",
    regions=flowering_block(_neem_spray, 0.75, bark_region("#5a4a3c", fissure=0.85)),
    growth=dict(envelope=dict(zc=7.6, rx=6.2, ry=6.0, rz=4.4, flat_bottom=0.06, lobes=8, lobe_size=0.5, lobe_dist=0.58,
                              lobe_rise=(-0.35, 0.45), top_lobe=0.95),
                attractors=3200, step=0.42, influence=4.0, kill=0.8, iterations=110, trunk_height=2.2,
                trunk_lean=(0.3, 0.2), base_radius=0.48, tip_radius=0.008, tropism=(0, 0, 0.12),
                seeds_on_trunk=(0.4, 1.0), limb_rise=0.22, limb_reach=0.72),
    cards=dict(per_tip=3.5, along=4.5, outward=0.6, jitter_deg=35, droop=0.2, max_radius=0.05),
    wood=dict(r_min=(0.025, 0.06, 0.14), step=(0.45, 1.0, 2.0), sides=((0.3, 12), (0.12, 8), (0.05, 6), (0.0, 4))),
    flutter=0.7,
    variants={"a": {}, "b": dict(scale=0.85, seed_offset=3), "c": dict(scale=1.05, seed_offset=17, envelope=dict(rz=5.2))},
)

# ---------------------------------------------------------------------------------------------------- sal
_sal_spray = broadleaf(K.SAL, "#41612b", leaf_len=0.19, per_m=11, ven=Venation(spacing=0.075, angle=52, midrib=0.014),
                       look_kw=dict(vein_light=0.22, rough=0.42, fold=0.05, yellow_tips=0.05, spots=0.05),
                       petiole=0.025, notch=0.06, spread=(40, 80), back_frac=0.2, alt_fn=_sal_flowers, alt_color="#9aa04e")
SPECIES["sal"] = TreeSpec(
    id="sal", page="a", block=4, bark_set="veg_bark_furrowed",
    regions=flowering_block(_sal_spray, 1.1, bark_region("#4f4033", fissure=0.9)),
    growth=dict(envelope=dict(zc=23.0, rx=5.2, ry=5.0, rz=5.5, flat_bottom=0.15, lobes=6, lobe_size=0.55, lobe_dist=0.5,
                              lobe_rise=(-0.4, 0.5), top_lobe=1.1),
                attractors=3200, step=0.45, influence=4.0, kill=0.8, iterations=110, trunk_height=17.0,
                trunk_lean=(0.25, 0.15), trunk_wobble=0.08, base_radius=0.45, tip_radius=0.009, tropism=(0, 0, 0.3),
                seeds_on_trunk=(0.82, 1.0), limb_rise=0.4, limb_reach=0.65, leader=True),
    cards=dict(per_tip=3.5, along=4.5, outward=0.65, jitter_deg=35, droop=0.2, max_radius=0.05),
    wood=dict(r_min=(0.025, 0.07, 0.15), step=(0.5, 1.4, 3.0), sides=((0.35, 12), (0.15, 8), (0.06, 6), (0.0, 4))),
    flutter=0.55,
    variants={"a": {}, "b": dict(scale=0.85, seed_offset=29), "c": dict(scale=1.1, seed_offset=31)},
)

# ---------------------------------------------------------------------------------------------------- teak
_teak_spray = broadleaf(K.TEAK, "#557334", leaf_len=0.42, per_m=3.2, ven=Venation(spacing=0.07, angle=55, midrib=0.012),
                        look_kw=dict(vein_light=0.28, rough=0.72, fold=0.03, yellow_tips=0.08, spots=0.15, holes=0.08),
                        petiole=0.03, side=4, sub=0, side_len=(0.3, 0.42), spread=(55, 85), tip_leaves=2, back_frac=0.3,
                        droop=0.5, alt_fn=_teak_plumes, alt_color="#4d6b30")
SPECIES["teak"] = TreeSpec(
    id="teak", page="a", block=5, bark_set="veg_bark_fibrous",
    regions=flowering_block(_teak_spray, 1.5, bark_region("#7a6a58", fissure=0.4),
                            RegionSpec("twigs", (3, 1, 1, 1), (1.5, 1.5), bare_twigs("#6e6050", side=4, sub=2, r=0.013),
                                       klass=0.75, use="twig")),
    growth=dict(envelope=dict(zc=17.5, rx=5.6, ry=5.4, rz=5.0, flat_bottom=0.1, lobes=6, lobe_size=0.55, lobe_dist=0.55,
                              lobe_rise=(-0.35, 0.5), top_lobe=1.0),
                attractors=2000, step=0.6, influence=4.5, kill=1.0, iterations=100, trunk_height=10.0,
                trunk_lean=(0.3, 0.2), trunk_wobble=0.1, base_radius=0.36, tip_radius=0.012, tropism=(0, 0, 0.25),
                seeds_on_trunk=(0.75, 1.0), limb_rise=0.35, limb_reach=0.7, leader=True),
    cards=dict(per_tip=2.5, along=3.0, outward=0.6, jitter_deg=40, droop=0.3, max_radius=0.06),
    wood=dict(r_min=(0.03, 0.07, 0.14), step=(0.55, 1.3, 2.8), sides=((0.3, 12), (0.14, 8), (0.06, 6), (0.0, 4))),
    flutter=0.4,
    extras=dict(twig_cards=0.18),
    variants={"a": {}, "b": dict(scale=0.85, seed_offset=37), "c": dict(scale=1.08, seed_offset=41)},
)

# ---------------------------------------------------------------------------------------------------- palash
_palash_spray = compound(K.PALASH_LEAFLET, "#4f6c31", rachis_len=0.13, pairs=1, leaflet_len=(0.13, 0.17), per_m=6,
                         ven=Venation(spacing=0.08, angle=50, midrib=0.012, palmate_base=1),
                         look_kw=dict(vein_light=0.22, rough=0.62, fold=0.03, yellow_tips=0.06, spots=0.1),
                         side=5, sub=1, leaflet_angle=70, tip_leaves=2, terminal=True, taper=0.0, rachis_r=0.0016,
                         twig="#5d5146", rachis="#6d6a42", envelope=(0.44, 0.44))
def _palash_paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
    """Base: trifoliate leaf spray. Alternate (vasanta): the same card leafless and in full flame."""
    (palash_bloom if alt else _palash_spray)(cv, rng, alt)


SPECIES["palash"] = TreeSpec(
    id="palash", page="a", block=6, bark_set="veg_bark_furrowed",
    regions=[*[RegionSpec(f"spray{i}", (i, 0, 1, 1), (0.9, 0.9), _palash_paint, alt=(i, 1, 1, 1)) for i in range(3)],
             bark_region("#5d5146", fissure=0.6),
             RegionSpec("twigs", (3, 1, 1, 1), (0.9, 0.9), bare_twigs("#4a4038", side=5, sub=2, r=0.01, crooked=0.08),
                        klass=0.75, use="twig")],
    growth=dict(envelope=dict(zc=7.2, rx=4.2, ry=4.0, rz=3.0, flat_bottom=0.1, lobes=6, lobe_size=0.55, lobe_dist=0.55,
                              lobe_rise=(-0.3, 0.45), top_lobe=0.9),
                attractors=1800, step=0.4, influence=3.6, kill=0.75, iterations=90, trunk_height=2.6,
                trunk_lean=(0.6, -0.3), trunk_wobble=0.35, base_radius=0.22, tip_radius=0.008, tropism=(0, 0, 0.05),
                seeds_on_trunk=(0.5, 1.0), limb_rise=0.25, limb_reach=0.75),
    cards=dict(per_tip=3.0, along=4.0, outward=0.6, jitter_deg=40, droop=0.2, max_radius=0.05),
    wood=dict(r_min=(0.022, 0.05, 0.11), step=(0.4, 0.9, 1.8), sides=((0.2, 10), (0.1, 7), (0.04, 5), (0.0, 4))),
    flutter=0.6,
    extras=dict(twig_cards=0.25),
    variants={"a": {}, "b": dict(scale=0.85, seed_offset=43), "c": dict(scale=1.1, seed_offset=47)},
)

# ---------------------------------------------------------------------------------------------------- amaltas
_amaltas_spray = compound(K.AMALTAS_LEAFLET, "#4f6e30", rachis_len=0.3, pairs=4, leaflet_len=(0.09, 0.12), per_m=5,
                          ven=Venation(spacing=0.08, angle=55, midrib=0.012),
                          look_kw=dict(vein_light=0.2, rough=0.5, fold=0.04, yellow_tips=0.05),
                          side=5, sub=1, leaflet_angle=62, tip_leaves=2, terminal=False, taper=0.25, rachis_r=0.0016,
                          alt_fn=_amaltas_chains, alt_color="#7a8a3e", twig="#6e6458", envelope=(0.44, 0.44))
SPECIES["amaltas"] = TreeSpec(
    id="amaltas", page="a", block=7, bark_set="veg_bark_fibrous",
    regions=flowering_block(_amaltas_spray, 1.0, bark_region("#6e6458", fissure=0.2, lenticel=0.6)),
    growth=dict(envelope=dict(zc=8.6, rx=4.6, ry=4.4, rz=3.4, flat_bottom=0.1, lobes=6, lobe_size=0.55, lobe_dist=0.55,
                              lobe_rise=(-0.35, 0.45), top_lobe=1.0),
                attractors=2000, step=0.45, influence=3.8, kill=0.8, iterations=90, trunk_height=3.2,
                trunk_lean=(0.3, 0.2), trunk_wobble=0.15, base_radius=0.22, tip_radius=0.008, tropism=(0, 0, -0.05),
                seeds_on_trunk=(0.55, 1.0), limb_rise=0.3, limb_reach=0.72),
    cards=dict(per_tip=3.0, along=4.0, outward=0.6, jitter_deg=38, droop=0.35, max_radius=0.05),
    wood=dict(r_min=(0.022, 0.05, 0.11), step=(0.45, 1.0, 2.0), sides=((0.2, 10), (0.1, 7), (0.04, 5), (0.0, 4))),
    flutter=0.65,
    variants={"a": {}, "b": dict(scale=0.88, seed_offset=53), "c": dict(scale=1.08, seed_offset=59)},
)


# ================================================================================================ page B
# ---------------------------------------------------------------------------------------------------- babul
def _babul_spray(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
    """Thorn acacia twig: zigzag dark twigs with paired white spines and feathery bipinnate leaves (each pinna drawn
    as a comb of tiny leaflets); the alternate adds yellow ball flowers (varsha-sharad)."""
    col = "#566e3a" if alt else "#5a713c"
    look = leaf_look(col, vein_light=0.05, rough=0.6, fold=0.02, bulge=0.0, value_jitter=0.12)
    tw = K.twig_tree(cv, side=6, sub=2, r=0.007, side_angle=(35, 70), rng=rng)
    tc = hexlin("#3a302a")
    spine = hexlin("#d9d0bc")
    pinna = K.outline([(0.0, 0.0), (0.05, 0.18), (0.5, 0.2), (0.95, 0.14), (1.0, 0.0)])

    def dl(p, a, sc, depth):
        # bipinnate leaf: short rachis with 3-4 pinna pairs; pinnae = combs (heavy serration reads as leaflets)
        L = 0.075 * sc
        d = np.array([math.cos(a), math.sin(a)], F)
        cv.stroke(p, p + d * L, 0.0009, 0.0005, hexlin("#6d7a42"), z=0.01 * (depth + 1))
        for k in range(4):
            q = p + d * L * (0.25 + 0.25 * k)
            for sg in (-1, 1):
                aa = a + sg * math.radians(rng.uniform(55, 80))
                cv.leaf(q, aa, rng.uniform(0.035, 0.05), pinna, look, Venation(spacing=1.0, strength=0.0),
                        serration=(16, 0.85), roll=float(rng.normal(0, 0.3)), rng=rng, z=0.01 * (depth + 1) + 0.001)
        if rng.uniform() < 0.5:  # paired stipular spines
            for sg in (-1, 1):
                aa = a + sg * 0.9
                cv.stroke(p, p + np.array([math.cos(aa), math.sin(aa)], F) * 0.03, 0.0012, 0.0002, spine, rough=0.5)

    K.cluster(cv, tw, dl, per_m=9, twig_color=tc, spread=(40, 80), rng=rng, leaf_len=0.12, tip_leaves=2)
    if alt:
        _babul_balls(cv, rng, [t.p1 for t in tw] + [t.p0 + (t.p1 - t.p0) * 0.5 for t in tw])


def _thorn_twigs(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
    bare_twigs("#3a302a", side=6, sub=2, r=0.008, crooked=0.1)(cv, rng, alt)


# ---------------------------------------------------------------------------------------------------- bamboo
def _bamboo_spray(dry: bool = False) -> Callable[[Canvas, np.random.Generator, bool], None]:
    """Bamboo branchlet fan: thin wiry twigs from a node with drooping lanceolate leaves in fans."""

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        col = "#a0a05a" if dry else "#5f7c3c"
        look = leaf_look(col, vein_light=0.12, rough=0.5, fold=0.06, yellow_tips=0.3 if dry else 0.08, value_jitter=0.12)
        ven = Venation(spacing=0.03, angle=12, midrib=0.008, strength=0.5)  # parallel venation
        tw = K.twig_tree(cv, side=5, sub=1, r=0.004, main_len=0.8, side_len=(0.35, 0.55), side_angle=(25, 55), rng=rng)
        tc = hexlin("#8a8a4a")

        def dl(p, a, sc, depth):
            cv.leaf(p, a - 0.25 * math.copysign(1, math.cos(a)), rng.uniform(0.15, 0.22) * sc, K.BAMBOO, look, ven,
                    roll=float(rng.normal(0, 0.4)), droop=float(rng.uniform(0.2, 0.7)), curve=0.02 * float(rng.choice([-1, 1])),
                    rng=rng, z=0.01 * (depth + 1))

        K.cluster(cv, tw, dl, per_m=12, twig_color=tc, spread=(30, 65), rng=rng, leaf_len=0.22, tip_leaves=3)

    return paint


def _culm_swatch(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
    """Bamboo culm strip for far LODs: yellow-green culm with node rings (v along the culm)."""
    H, W = cv.H, cv.W
    y = np.arange(H, dtype=F)[:, None] / H
    x = np.arange(W, dtype=F)[None, :] / W
    nodes = (y * 6.0) % 1.0
    ring = np.exp(-((nodes - 0.5) / 0.025) ** 2)
    streak = 0.92 + 0.08 * np.sin(x * 40.0 + np.sin(y * 9.0))
    base = hexlin("#8a8a4a")
    c = base[None, None, :] * (streak * (1 - 0.35 * ring))[..., None]
    c = c * (1 - 0.15 * (nodes < 0.48)[..., None] * (nodes > 0.3)[..., None])
    cv.rgb[...] = c
    cv.a[...] = 1.0
    cv.rough[...] = 0.5
    cv.layer = 1


# ---------------------------------------------------------------------------------------------------- palms
def _fan_leaf(dead: bool = False) -> Callable[[Canvas, np.random.Generator, bool], None]:
    """Palmyra fan (costapalmate): 60-80 stiff pleated segments radiating from the hastula near the bottom centre,
    split drooping tips; dead fans hang brown and ragged."""

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        W, H = cv.size
        hub = np.array([W * 0.5, H * 0.16], F)
        col = hexlin("#7a6a4e" if dead else "#47603b")
        n = int(rng.integers(56, 70))
        spread = math.radians(rng.uniform(230, 270))
        a0 = math.pi / 2 - spread / 2
        prof = K.outline([(0.0, 0.0), (0.08, 0.035), (0.5, 0.05), (0.85, 0.035), (0.95, 0.02), (1.0, 0.0)])
        cv.stroke((W * 0.5, H * cv.margin), hub, W * 0.02, W * 0.016, hexlin("#3e3934") if not dead else hexlin("#5a4a3a"))
        for k in range(n):
            f = (k + 0.5) / n
            a = a0 + spread * f + rng.normal(0, 0.01)
            L = W * (0.42 + 0.04 * math.sin(f * math.pi)) * rng.uniform(0.92, 1.04)
            if dead:
                L *= rng.uniform(0.6, 1.0)
            shade = 0.85 + 0.3 * (k % 2)  # pleats: alternating lit / shaded segments
            look = LeafLook(color=col * shade, vein_light=0.0, margin_light=0.08, value_jitter=0.05, hue_jitter=0.01,
                            rough=0.45 if not dead else 0.85, transl=0.5 if not dead else 0.1, fold=0.12, bulge=0.0)
            cv.leaf(hub, a, L, prof, look, Venation(spacing=1.0, midrib=0.01, strength=0.5), roll=0.5 * (1 if k % 2 else -1),
                    curve=-0.03 * math.cos(a), rng=rng, z=0.001 * k)
            if rng.uniform() < 0.5:  # split, drooping tip
                tip = hub + np.array([math.cos(a), math.sin(a)], F) * L * 0.95
                cv.stroke(tip, tip + np.array([math.cos(a - 0.6), math.sin(a - 0.6) - 0.5], F) * L * 0.1,
                          W * 0.003, W * 0.001, col * shade * 0.9)

    return paint


def _pinnate_frond(color: str, *, droop: float, leaflet: tuple[float, float], angle: float, dead: bool = False,
                   density: int = 46) -> Callable[[Canvas, np.random.Generator, bool], None]:
    """One side of a pinnate palm frond (date palm / coconut): the rachis runs along the bottom edge (u from base to
    tip), leaflets leave it towards the tip at `angle` deg; geometry places two mirrored strips in a V."""

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        W, H = cv.size
        col = hexlin("#7a6a4e" if dead else color)
        y0 = H * 0.07
        cv.stroke((W * 0.02, y0), (W * 0.98, y0), H * 0.025, H * 0.008, col * 0.8 if not dead else col, rough=0.7)
        look = LeafLook(color=col, vein_light=0.08, margin_light=0.05, value_jitter=0.1, hue_jitter=0.02,
                        rough=0.5 if not dead else 0.85, transl=0.55 if not dead else 0.1, fold=0.15, bulge=0.0)
        prof = K.outline([(0.0, 0.0), (0.06, 0.04), (0.4, 0.05), (0.8, 0.035), (1.0, 0.0)])
        for k in range(density):
            f = 0.05 + 0.9 * (k + rng.uniform(0, 1)) / density
            p = np.array([W * f, y0], F)
            L = H * (leaflet[0] + (leaflet[1] - leaflet[0]) * math.sin(math.pi * min(1.0, f * 1.15)))
            a = math.radians(angle + rng.normal(0, 6))
            cv.leaf(p, a, L * (rng.uniform(0.6, 0.9) if dead else 1.0), prof, look,
                    Venation(spacing=1.0, midrib=0.012, strength=0.7), roll=float(rng.normal(0, 0.4)),
                    curve=-droop * (0.5 + f), rng=rng, z=0.001 * k)

    return paint


def _trunk_swatch(color: str, *, rings: float = 0.0, diamonds: float = 0.0) -> Callable[[Canvas, np.random.Generator, bool], None]:
    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        bark_swatch(color, fissure=0.3, rings=rings)(cv, rng, alt)
        if diamonds > 0:
            H, W = cv.H, cv.W
            y, x = np.mgrid[0:H, 0:W].astype(F)
            u, v = x / W * 5, y / H * 8
            d = np.abs(((u + v) % 1.0) - 0.5) + np.abs(((u - v) % 1.0) - 0.5)
            cv.rgb *= (1 - diamonds * np.clip(1 - d / 0.25, 0, 1) ** 2)[..., None]

    return paint


def _fruit_cluster(color: str, r: float, n: int) -> Callable[[Canvas, np.random.Generator, bool], None]:
    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        W, H = cv.size
        top = np.array([W * 0.5, H * 0.9], F)
        stem = hexlin("#6e5f4e")
        for _ in range(8):
            q = top + np.array([rng.normal(0, 0.15) * W, -rng.uniform(0.2, 0.5) * H], F)
            cv.stroke(top, q, W * 0.006, W * 0.003, stem, bend=float(rng.normal(0, 0.1)))
        for _ in range(n):
            p = np.array([W * 0.5 + rng.normal(0, 0.13) * W, H * rng.uniform(0.25, 0.65)], F)
            cv.disc(p, r * rng.uniform(0.85, 1.1), hexlin(color) * rng.uniform(0.8, 1.1), dome=0.9, rough=0.4, transl=0.05, rng=rng)

    return paint


# ---------------------------------------------------------------------------------------------------- shrubs
def _shrub_spray(prof, color, *, leaf_len, per_m, look_kw, opposite=False, flowers=None, thorns=False, twig="#5d5146",
                 sessile=False) -> Callable[[Canvas, np.random.Generator, bool], None]:
    base = broadleaf(prof, color, leaf_len=leaf_len, per_m=per_m, ven=Venation(spacing=0.12, angle=50, palmate_base=1 if thorns else 0),
                     look_kw=look_kw, petiole=0.0 if sessile else 0.012, back_frac=0.3, twig=twig, side=6, sub=2)

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        base(cv, rng, alt)
        if thorns:  # ber: paired hooked thorns along the twigs - small light strokes
            for _ in range(40):
                p = np.array([rng.uniform(0.2, 0.8) * cv.size[0], rng.uniform(0.1, 0.8) * cv.size[1]], F)
                a = rng.uniform(0, 2 * math.pi)
                cv.stroke(p, p + np.array([math.cos(a), math.sin(a)], F) * 0.012, 0.0015, 0.0003, hexlin("#b8a888"))
        if flowers is not None and (alt or flowers.get("always")):
            fl = hexlin(flowers["color"])
            for _ in range(flowers.get("n", 8)):
                c = np.array([rng.uniform(0.25, 0.75) * cv.size[0], rng.uniform(0.45, 0.85) * cv.size[1]], F)
                for _ in range(int(rng.integers(4, 9))):
                    cv.disc(c + rng.normal(0, 0.018, 2), flowers.get("r", 0.012), fl * rng.uniform(0.9, 1.1), petals=5,
                            petal_depth=0.45, phase=float(rng.uniform(0, 6)), center_color=hexlin(flowers.get("center", "#6a3a6e")),
                            center_r=0.3, transl=0.6, rough=0.5, rng=rng)

    return paint


# ---------------------------------------------------------------------------------------------------- grasses
def _grass_clump(color_base: str, color_tip: str, *, blades: tuple[int, int], height: float, width: float,
                 plume: str | None = None, plume_alt_only: bool = True, cattail: bool = False, dry_tips: float = 0.0,
                 spread: float = 0.35) -> Callable[[Canvas, np.random.Generator, bool], None]:
    """Clump of grass / reed blades rising from the bottom centre (kash, phragmites, typha, doob); plumes (kash
    silver-white, phragmites brown) and typha cattails on top; plumes only in the alternate (flowering) when
    plume_alt_only."""

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        W, H = cv.size
        cb, ct = hexlin(color_base), hexlin(color_tip)
        n = int(rng.integers(*blades))
        tops = []
        for k in range(n):
            x = W * 0.5 + rng.normal(0, W * 0.05)
            a = math.pi / 2 + rng.normal(0, spread)
            L = H * height * rng.uniform(0.55, 1.0)
            wv = W * width * rng.uniform(0.7, 1.2)
            curl = float(rng.normal(0, 0.12))
            K.blade(cv, (x, H * cv.margin * 1.1), a, L, wv, cb, ct, curl=curl, tip_dry=dry_tips, rng=rng, z=0.001 * k)
            tops.append((np.array([x, H * cv.margin], F) + np.array([math.cos(a), math.sin(a)], F) * L * 0.97, a))
        if plume and (alt or not plume_alt_only):
            pc = hexlin(plume)
            for q, a in tops[: max(3, n // 3)]:
                stalk_top = q + np.array([rng.normal(0, 0.02) * W, H * rng.uniform(0.05, 0.12)], F)
                cv.stroke(q - np.array([0, H * 0.1], F), stalk_top, W * 0.004, W * 0.002, cb * 1.2)
                for j in range(14):  # feathery plume: many fine drooping strands
                    s0 = stalk_top - np.array([0, H * 0.012 * j], F)
                    ang = math.pi / 2 + rng.normal(0, 0.5) + (0.6 if j % 2 else -0.6)
                    ln = H * rng.uniform(0.06, 0.11) * (1 - j / 18)
                    cv.petal(s0, ang - 0.5 * math.copysign(1, math.cos(ang)), ln, 0.18, pc * rng.uniform(0.92, 1.06),
                             transl=0.95, rough=0.8)
        if cattail:
            for q, a in tops[: max(2, n // 5)]:
                top = q + np.array([0, H * 0.06], F)
                cv.stroke(q, top + np.array([0, H * 0.08], F), W * 0.004, W * 0.002, cb)
                cv.stroke(top - np.array([0, H * 0.05], F), top + np.array([0, H * 0.04], F), W * 0.016, W * 0.016,
                          hexlin("#5a3e26"), rough=0.9)

    return paint


def _lotus_pad(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
    """Top view of a lotus pad: round, peltate (radial veins from the off-centre hub), a waxy blue-green surface with a
    slightly upturned paler rim; an older yellowing pad in the alternate slot is drawn by the second region."""
    W, H = cv.size
    c = np.array([W * 0.5, H * 0.5], F)
    r = W * 0.44
    bb = cv._bbox(c[0] - r, c[1] - r, c[0] + r, c[1] + r)
    win, X, Y = bb
    dx, dy = X - c[0], Y - c[1]
    rho = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    rr = r * (1 + 0.03 * np.sin(ang * 7 + float(rng.uniform(0, 6))))
    cov = cv.aa(rr - rho)
    q = np.clip(rho / rr, 0, 1)
    veins = np.exp(-((((ang / (2 * math.pi)) * 22) % 1.0 - 0.5) / 0.06) ** 2) * (q > 0.08)
    col = hexlin("#4c6b37") * (0.9 + 0.1 * q)[..., None] * (1 + 0.18 * veins)[..., None]
    col = col * (1 - 0.15 * tg_smooth(q, 0.9, 1.0))[..., None] + hexlin("#7a8a50") * 0.15 * tg_smooth(q, 0.9, 1.0)[..., None]
    nz = np.ones_like(q)
    nrm = np.stack([dx / np.maximum(rho, 1e-6) * 0.25 * q ** 4, dy / np.maximum(rho, 1e-6) * 0.25 * q ** 4, nz], axis=-1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    cv._composite(win, cov, col, nrm, 0.35, 0.3, 0.0)


def tg_smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _lotus_flower(color: str) -> Callable[[Canvas, np.random.Generator, bool], None]:
    """Lotus flower held above the water on its stalk: two tiers of broad pointed petals around a yellow seed pod;
    the alternate is a closed bud."""

    def paint(cv: Canvas, rng: np.random.Generator, alt: bool) -> None:
        W, H = cv.size
        base = np.array([W * 0.5, H * cv.margin], F)
        top = np.array([W * 0.5 + rng.normal(0, 0.02) * W, H * 0.55], F)
        cv.stroke(base, top, W * 0.012, W * 0.01, hexlin("#5a6e3e"), bend=0.05)
        pc = hexlin(color)
        if alt:  # bud
            for k in range(5):
                cv.petal(top, math.pi / 2 + (k - 2) * 0.12, H * 0.22, 0.32, pc * (0.9 + 0.05 * k), transl=0.7, rough=0.45)
            return
        for tier, (n, ln, sp) in enumerate(((8, 0.27, 1.25), (6, 0.22, 0.7))):
            for k in range(n):
                a = math.pi / 2 + (k - (n - 1) / 2) * sp / (n - 1) * 2
                cv.petal(top, a, H * ln * rng.uniform(0.9, 1.05), 0.36, pc * (0.85 + 0.25 * tier), transl=0.75, rough=0.45,
                         tip_color=pc * 1.2)
        cv.disc(top + np.array([0, H * 0.04], F), W * 0.06, hexlin("#d9b54a"), dome=0.5, rough=0.6, rng=rng)

    return paint
