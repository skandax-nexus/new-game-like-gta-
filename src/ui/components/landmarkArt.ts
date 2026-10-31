/**
 * Landmark illustration bands for the age panel's carved cards: an ink silhouette of each landmark (ART_BIBLE §8.7)
 * against a golden-hour sky with a pale far ridge (three depth planes, §1.4), drawn as inline SVG (no image asset).
 *
 * Band geometry (Art Director review UI-02 round 2, B1f): the art is authored in a band-shaped 240 x 88 viewBox with the
 * ground line at y = 76 and a 200 x 64 safe box (x 20..220, y 12..76) for the subject. It is fitted with
 * `xMidYMax meet`, so the whole viewBox is always visible; the sky, far ridge and ground are drawn far beyond the
 * viewBox on every side and fill whatever the card's aspect leaves over (a wide phone band gets more sky and ground at
 * the sides, a narrow one more sky on top). Nothing is ever cropped: every subject stands on the ground strip and its
 * finial stays >= 4 px below the band top (asserted in tests/ui/hud/landmarkArt.test.ts from `landmarkArtBounds`).
 *
 * Vocabulary (ART_BIBLE §1.3 / §1.5): Mauryan bell capitals crowned by bull, elephant, horse or an open 8-spoke wheel
 * (never lions, never the 24-spoke chakra); Sanchi toranas with sagging architraves and spiral volutes; wagon-vault
 * roofs, gavaksha (horseshoe) gables and kalasha finials; trabeated timber gates. No merlons on halls, no pointed or
 * pishtaq arches, no pediments, no torii, no modern road markings.
 *
 * All path data is absolute M / L / C / Q / Z with x,y pairs only (no H / V / arcs), so bounds can be measured.
 * Interim art: the final is a golden-hour thumbnail of the landmark model ('image' asset from the content pipeline,
 * requested from Technical Art); the band keeps its size so the swap is a one-liner.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { svg } from '../dom';

/** Band viewBox, ground line and safe box (exported for tests and the evidence script). */
export const LM_BAND = { w: 240, h: 88, ground: 76, safe: { x: 20, y: 12, w: 200, h: 64 } } as const;
const G = LM_BAND.ground;

/** One layer: CSS class suffixes (`ink`, `cut gate`, ...) and path data; `eo` draws it with the even-odd rule. */
interface Layer {
  readonly cls: string;
  readonly d: string;
  readonly eo?: boolean;
}
interface Art {
  /** Sun centre (behind the subject). */
  readonly sun: readonly [number, number];
  /** Far ridge height variant (0 = low hills, 1 = mountains, 2 = flat plain / sea). */
  readonly far: 0 | 1 | 2;
  readonly layers: readonly Layer[];
}

// ------------------------------------------------------------------------------------------------ path helpers

type Pt = readonly [number, number];
const n = (v: number): string => String(Math.round(v * 100) / 100);
const poly = (pts: readonly Pt[]): string => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;
const rect = (x: number, y: number, w: number, h: number): string => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const tri = (a: Pt, b: Pt, c: Pt): string => poly([a, b, c]);
const K = 0.5523;
const ellipse = (cx: number, cy: number, rx: number, ry: number): string => {
  const kx = K * rx;
  const ky = K * ry;
  return (
    `M${n(cx + rx)} ${n(cy)}C${n(cx + rx)} ${n(cy + ky)} ${n(cx + kx)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)}` +
    `C${n(cx - kx)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + ky)} ${n(cx - rx)} ${n(cy)}` +
    `C${n(cx - rx)} ${n(cy - ky)} ${n(cx - kx)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)}` +
    `C${n(cx + kx)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - ky)} ${n(cx + rx)} ${n(cy)}Z`
  );
};
const disc = (cx: number, cy: number, r: number): string => ellipse(cx, cy, r, r);
/** A straight bar of width `w` from (x0, y0) to (x1, y1). */
const bar = (x0: number, y0: number, x1: number, y1: number, w: number): string => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * (w / 2);
  const oy = (dx / len) * (w / 2);
  return poly([[x0 + ox, y0 + oy], [x1 + ox, y1 + oy], [x1 - ox, y1 - oy], [x0 - ox, y0 - oy]]);
};
/** A sagging rope / beam of width `w` between two points (quadratic, `sag` units down at the middle). */
const sagBar = (x0: number, y0: number, x1: number, y1: number, sag: number, w: number): string => {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2 + sag * 2;
  return `M${n(x0)} ${n(y0 - w / 2)}Q${n(mx)} ${n(my - w / 2)} ${n(x1)} ${n(y1 - w / 2)}L${n(x1)} ${n(y1 + w / 2)}Q${n(mx)} ${n(my + w / 2)} ${n(x0)} ${n(y0 + w / 2)}Z`;
};
const repeat = (count: number, fn: (i: number) => string): string => Array.from({ length: count }, (_, i) => fn(i)).join('');

/**
 * Places a motif authored in local units (origin at its foot, y up = negative, facing +x) at (ox, oy) with scale s,
 * mirrored when `flip`. Works on the absolute M / L / C / Q / Z path data the helpers above produce.
 */
function place(d: string, ox: number, oy: number, s: number, flip = false): string {
  const out: string[] = [];
  let pair: number[] = [];
  for (const tok of d.match(/[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []) {
    if (/^[MLCQZ]$/.test(tok)) {
      out.push(tok);
      continue;
    }
    pair.push(Number(tok));
    if (pair.length === 2) {
      out.push(`${n(ox + (flip ? -pair[0]! : pair[0]!) * s)} ${n(oy + pair[1]! * s)}`);
      pair = [];
    }
  }
  return out.join(' ');
}

// ------------------------------------------------------------------------------------------------ motifs (local units)

/** Kalasha finial: pot, neck, lid and point; 6 units tall. */
const KALASHA = disc(0, -2.4, 1.6) + rect(-0.8, -1, 1.6, 1) + rect(-1.1, -4.3, 2.2, 0.6) + tri([-0.8, -4.3], [0, -6], [0.8, -4.3]);
const kalasha = (x: number, base: number, s = 1): string => place(KALASHA, x, base, s);

/** Zebu bull standing, facing +x: about 16 long, 11 tall. */
const BULL =
  ellipse(0, -6.2, 6, 2.7) +
  ellipse(3.4, -8.6, 1.9, 1.5) +
  poly([[4.6, -7.8], [8.6, -6.4], [9.4, -4.6], [8.4, -3.8], [5.6, -4.4]]) +
  tri([7.4, -6.6], [6.9, -10], [8.1, -6.9]) +
  tri([5.8, -4.6], [7.6, -3.8], [6.2, -2.4]) +
  rect(-5.2, -4.2, 1.3, 4.2) +
  rect(-3.4, -4.2, 1.3, 4.2) +
  rect(2.4, -4.2, 1.3, 4.2) +
  rect(4.1, -4.2, 1.3, 4.2) +
  bar(-5.8, -6.8, -7.4, -2, 0.8);

/** Elephant standing, facing +x: about 17 long, 14 tall. */
const ELEPHANT =
  ellipse(-0.6, -7.4, 6.4, 4.4) +
  disc(5.2, -9, 3.4) +
  ellipse(3.2, -8.6, 2.2, 3) +
  'M7.6 -9.2C10.2 -8 10 -3.6 9.6 -0.4L8.3 -0.4C8.6 -3.2 8.4 -6 6.6 -6.8Z' +
  rect(-5.6, -4.6, 2.2, 4.6) +
  rect(-2.9, -4.6, 2.2, 4.6) +
  rect(1.8, -4.6, 2.2, 4.6) +
  rect(4.3, -4.6, 2.2, 4.6) +
  bar(-6.8, -8, -7.8, -3.6, 0.7);

/** Horse standing, facing +x, head high: about 14 long, 14 tall. */
const HORSE =
  ellipse(0, -7, 5.2, 2.3) +
  poly([[2.6, -8], [5, -12.6], [6.8, -12.4], [5.6, -6.4]]) +
  poly([[5, -13], [8.8, -10.6], [8.4, -9.6], [6, -10.6]]) +
  tri([5.2, -12.8], [5.6, -14.4], [6.2, -12.6]) +
  bar(-4.2, -5.4, -4.6, 0, 0.9) +
  bar(-2.8, -5.4, -2.6, 0, 0.9) +
  bar(3, -5.4, 3.6, 0, 0.9) +
  bar(4.2, -5.4, 5.2, 0, 0.9) +
  'M-4.8 -8C-7.2 -7.6 -7.4 -4.6 -6.6 -2.8L-5.8 -3C-6.2 -4.6 -5.8 -6.4 -4.4 -6.8Z';

/** Dromedary camel, facing +x, with two salt sacks drawn separately (CAMEL_SACKS): about 22 long, 20 tall. */
const CAMEL =
  ellipse(0, -11.4, 6, 2.8) +
  ellipse(-0.6, -13.6, 3.2, 2.4) +
  'M4.2 -12.8C7 -12.4 7.6 -15 8 -17.6C8.2 -18.8 9.4 -19.4 10.6 -18.8L12.4 -18.2L12.2 -16.9L10.4 -17C9.8 -14.4 9.2 -11.4 6 -9.6Z' +
  bar(-4.2, -10, -4.6, -5, 1.1) + bar(-4.6, -5, -4.2, 0, 0.9) +
  bar(-2.6, -10, -2.2, -5, 1.1) + bar(-2.2, -5, -2.8, 0, 0.9) +
  bar(3.2, -10, 3.6, -5, 1.1) + bar(3.6, -5, 3.2, 0, 0.9) +
  bar(4.6, -10, 5.4, -5, 1.1) + bar(5.4, -5, 5.2, 0, 0.9) +
  bar(-5.8, -12, -6.8, -8, 0.6);
const CAMEL_SACKS = ellipse(-2.6, -10.6, 2, 2.4) + ellipse(1.8, -10.6, 2, 2.4);

/** Standing figure with a spear, facing +x: 11 tall. */
const GUARD =
  disc(0, -9.6, 1.1) +
  poly([[-1.2, -8.4], [1.2, -8.4], [1.6, -4], [-1.6, -4]]) +
  bar(-0.6, -4.2, -0.9, 0, 0.9) +
  bar(0.6, -4.2, 0.9, 0, 0.9) +
  bar(2.2, 0, 2.2, -13, 0.5) +
  tri([1.6, -13], [2.2, -15], [2.8, -13]);

/** Rounded tree: trunk and three canopy lobes; about 14 tall at s = 1. */
const TREE = rect(-0.8, -6, 1.6, 6) + disc(0, -9.6, 4) + disc(-3, -7.8, 2.8) + disc(3, -7.8, 2.8);

/** 8-spoke wheel (dharma wheel, never the 24-spoke chakra): returns [even-odd rim, spokes + hub]. */
function wheel(cx: number, cy: number, r: number, rim = r * 0.2): [string, string] {
  const ring = disc(cx, cy, r) + disc(cx, cy, r - rim);
  const hub = r * 0.24;
  let spokes = disc(cx, cy, hub);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    spokes += bar(cx + c * hub * 0.6, cy + s * hub * 0.6, cx + c * (r - rim * 0.5), cy + s * (r - rim * 0.5), Math.max(0.9, r * 0.13));
  }
  return [ring, spokes];
}

/** Mauryan pillar: base slab, tapering shaft, inverted-lotus bell capital and abacus; returns the abacus top y. */
function stambha(cx: number, top: number, w: number): { d: string; abacus: number } {
  const bellH = w * 1.4;
  const abH = w * 0.45;
  const shaftTop = top + bellH + abH;
  const d =
    rect(cx - w * 1.1, G - w * 0.5, w * 2.2, w * 0.5) +
    poly([[cx - w * 0.5, G - w * 0.5], [cx - w * 0.36, shaftTop], [cx + w * 0.36, shaftTop], [cx + w * 0.5, G - w * 0.5]]) +
    // Bell: narrow at the neck, flaring down like an inverted lotus.
    `M${n(cx - w * 0.36)} ${n(shaftTop)}C${n(cx - w * 0.95)} ${n(shaftTop - bellH * 0.1)} ${n(cx - w * 0.75)} ${n(top + abH + bellH * 0.25)} ${n(cx - w * 0.42)} ${n(top + abH)}` +
    `L${n(cx + w * 0.42)} ${n(top + abH)}C${n(cx + w * 0.75)} ${n(top + abH + bellH * 0.25)} ${n(cx + w * 0.95)} ${n(shaftTop - bellH * 0.1)} ${n(cx + w * 0.36)} ${n(shaftTop)}Z` +
    rect(cx - w * 0.75, top, w * 1.5, abH);
  return { d, abacus: top };
}

/** Vedika railing: posts with three lens crossbars and a coping, from x0 to x1, `h` tall above the ground. */
function vedika(x0: number, x1: number, hgt: number, base: number = G): string {
  const posts = Math.max(2, Math.round((x1 - x0) / 7));
  const step = (x1 - x0) / posts;
  let d = rect(x0, base - hgt, x1 - x0, hgt * 0.22);
  for (let i = 0; i <= posts; i++) d += rect(x0 + i * step - 0.8, base - hgt, 1.6, hgt);
  for (let k = 0; k < 3; k++) d += rect(x0, base - hgt * (0.68 - k * 0.2) - 0.45, x1 - x0, 0.9);
  return d;
}

/** Wagon-vault (barrel) roof seen broadside: a long rounded ridge with eaves, ridge line at `top`. */
const wagonRoof = (x0: number, x1: number, eave: number, top: number): string => {
  const r = Math.min((x1 - x0) * 0.18, (eave - top) * 1.6);
  return `M${n(x0)} ${n(eave)}C${n(x0)} ${n(top + (eave - top) * 0.15)} ${n(x0 + r * 0.4)} ${n(top)} ${n(x0 + r)} ${n(top)}L${n(x1 - r)} ${n(top)}C${n(x1 - r * 0.4)} ${n(top)} ${n(x1)} ${n(top + (eave - top) * 0.15)} ${n(x1)} ${n(eave)}Z`;
};
/** Gavaksha (horseshoe) gable outline seen end-on: the arch springs inward at its foot. */
const gavaksha = (cx: number, base: number, w: number, hgt: number): string => {
  const r = w / 2;
  return (
    `M${n(cx - r * 0.82)} ${n(base)}C${n(cx - r * 1.12)} ${n(base - hgt * 0.35)} ${n(cx - r * 1.08)} ${n(base - hgt)} ${n(cx)} ${n(base - hgt)}` +
    `C${n(cx + r * 1.08)} ${n(base - hgt)} ${n(cx + r * 1.12)} ${n(base - hgt * 0.35)} ${n(cx + r * 0.82)} ${n(base)}Z`
  );
};
/** Spiral volute end of a torana architrave (ring + eye, even-odd). */
const volute = (cx: number, cy: number, r: number): string => disc(cx, cy, r) + disc(cx + r * 0.1, cy - r * 0.05, r * 0.5) + disc(cx + r * 0.15, cy - r * 0.1, r * 0.22);
/** Flame tongue standing at (x, base), `hgt` tall. */
const flame = (x: number, base: number, hgt: number): string => {
  const w = hgt * 0.42;
  return `M${n(x)} ${n(base)}C${n(x - w)} ${n(base - hgt * 0.2)} ${n(x - w * 0.7)} ${n(base - hgt * 0.7)} ${n(x + w * 0.1)} ${n(base - hgt)}C${n(x - w * 0.05)} ${n(base - hgt * 0.6)} ${n(x + w * 0.9)} ${n(base - hgt * 0.45)} ${n(x + w * 0.5)} ${n(base - hgt * 0.15)}C${n(x + w * 0.4)} ${n(base - hgt * 0.05)} ${n(x + w * 0.2)} ${n(base)} ${n(x)} ${n(base)}Z`;
};
/** Swallow-tailed guild / clan banner on a pole, flying toward +x (or -x when flip). */
const banner = (x: number, base: number, hgt: number, flip = false): { pole: string; cloth: string } => {
  const s = flip ? -1 : 1;
  const top = base - hgt;
  return {
    pole: rect(x - 0.6, top, 1.2, hgt) + disc(x, top - 0.6, 1),
    cloth: poly([[x + s * 0.6, top + 1], [x + s * 10, top + 1.6], [x + s * 7.6, top + 4.4], [x + s * 10, top + 7.4], [x + s * 0.6, top + 8]]),
  };
};

// ------------------------------------------------------------------------------------------------ landmarks

const L = (cls: string, d: string, eo = false): Layer => (eo ? { cls, d, eo } : { cls, d });

/** Suvarna: Hall of a Hundred Pillars - moulded plinth, bell-capital colonnade, low roof, wagon-vault ridge, kalashas, saffron awnings. */
function hundredPillars(): Art {
  const pillars = 11;
  const x0 = 50;
  const x1 = 190;
  const step = (x1 - x0) / (pillars - 1);
  let cols = '';
  for (let i = 0; i < pillars; i++) {
    const cx = x0 + i * step;
    cols += rect(cx - 1.9, 38, 3.8, 24) + poly([[cx - 1.9, 38], [cx - 3.2, 35.4], [cx + 3.2, 35.4], [cx + 1.9, 38]]) + rect(cx - 3.4, 34, 6.8, 1.6);
  }
  const ridge = wagonRoof(84, 156, 27, 19);
  const finials = repeat(7, (i) => kalasha(90 + i * 10, 19.4, 1.05));
  return {
    sun: [196, 46],
    far: 0,
    layers: [
      L('ink', rect(30, 72, 180, 4) + rect(34, 69, 172, 3) + rect(38, 66.5, 164, 2.5) + rect(42, 62, 156, 4.5)),
      L('ink', cols),
      // Beam, low hipped roof with deep eaves, the wagon-vault ridge and its gavaksha gable ends.
      L('ink', rect(44, 31, 152, 3.4) + poly([[36, 31.4], [204, 31.4], [192, 26], [48, 26]]) + ridge + gavaksha(84, 27, 7, 8) + gavaksha(156, 27, 7, 8)),
      L('ink', finials),
      // Saffron awnings scalloped between the capitals.
      L('cut awning', repeat(pillars - 1, (i) => {
        const a = x0 + i * step + 3.4;
        const b = x0 + (i + 1) * step - 3.4;
        return `M${n(a)} 35.4L${n(b)} 35.4L${n(b)} 37.2Q${n((a + b) / 2)} 40.6 ${n(a)} 37.2Z`;
      })),
      L('cut gate', gavaksha(84, 26.4, 3.4, 4.4) + gavaksha(156, 26.4, 3.4, 4.4)),
    ],
  };
}

/**
 * Suvarna: The Royal Granary - stepped podium, brick store with vent slits, three parallel wagon-vault roofs seen
 * broadside (stepping back in aerial perspective, so they read as barrel roofs, never domes), gavaksha gable ends,
 * a ramp with an ox-cart, and an edict pillar at the entrance.
 */
function royalGranary(): Art {
  const pillar = stambha(32, 30, 3.4);
  const [ring, spokes] = wheel(32, 25.6, 4.4, 1);
  return {
    sun: [196, 40],
    far: 0,
    layers: [
      L('ink3', wagonRoof(70, 158, 36, 22) + gavaksha(70, 36, 8, 10) + gavaksha(158, 36, 8, 10) + repeat(3, (i) => kalasha(96 + i * 18, 22.4, 0.9))),
      L('ink2', wagonRoof(62, 164, 42, 29) + gavaksha(62, 42, 9, 11) + gavaksha(164, 42, 9, 11)),
      L('ink', rect(42, 70, 136, 6) + rect(48, 64, 124, 6) + rect(58, 48, 104, 16) + wagonRoof(54, 166, 49, 37) + gavaksha(54, 49, 10, 12) + gavaksha(166, 49, 10, 12)),
      L('cut gate', repeat(8, (i) => rect(64.4 + i * 12.6, 52, 1.8, 8) ) + gavaksha(54, 48, 5, 6.4) + gavaksha(166, 48, 5, 6.4)),
      // Ramp down to the yard and an ox-cart loaded with sacks.
      L('ink', poly([[172, 64], [200, 76], [172, 76]]) + place(BULL, 224, G, 0.95, true) + rect(184, 63.4, 20, 6) + disc(189.6, 61.8, 2.8) + disc(196, 61.4, 2.8) + bar(204, 67, 213, 68.6, 1)),
      L('ink', disc(194, 70.6, 5.4)),
      L('cut gate', disc(194, 70.6, 3.8)),
      L('ink', disc(194, 70.6, 1.1) + bar(194, 67, 194, 74.2, 0.8) + bar(190.4, 70.6, 197.6, 70.6, 0.8)),
      // Edict pillar at the entrance, crowned by a small wheel.
      L('ink', pillar.d + rect(30.8, 29.8, 2.4, 1.2) + spokes),
      L('ink', ring, true),
    ],
  };
}

/** Suvarna: Pillars of the Spoken Law - vedika-railed square, central pillar with an open 8-spoke wheel, bull / elephant / horse / wheel flanks. */
function edictPillars(): Art {
  const centre = stambha(120, 29, 6);
  const [ring, spokes] = wheel(120, 18.6, 8.6, 1.8);
  const inner = [stambha(80, 38, 4.6), stambha(160, 38, 4.6)];
  const outer = [stambha(44, 47, 3.6), stambha(196, 47, 3.6)];
  const [ring2, spokes2] = wheel(196, 40.4, 5.4, 1.2);
  return {
    sun: [176, 50],
    far: 0,
    layers: [
      L('ink', centre.d + rect(118.2, 27.2, 3.6, 1.8) + spokes),
      L('ink', ring, true),
      // Inner pair: a standing bull (west) and an elephant (east), both turned toward the centre.
      L('ink', inner[0]!.d + place(BULL, 79, 38, 1.12) + inner[1]!.d + place(ELEPHANT, 160.8, 38, 0.98, true)),
      // Outer pair: a horse and a small wheel.
      L('ink', outer[0]!.d + place(HORSE, 43.4, 47, 0.86) + outer[1]!.d + rect(194.9, 45.6, 2.2, 1.4) + spokes2),
      L('ink', ring2, true),
      L('ink', vedika(24, 216, 9) + rect(20, 74, 200, 2.2)),
    ],
  };
}

/** Suvarna: The Great Road - a Sanchi torana over a paved royal road, milestone pillars and a tree row to the horizon. */
function greatRoad(): Art {
  const H0 = 54;
  const vx = 120;
  // Two square posts with block capitals, three sagging architraves ending in spiral volutes beyond the posts,
  // three struts per bay between them, and a wheel finial.
  const pl = 97;
  const pr = 143;
  const posts = rect(pl - 3, 41, 6, 37) + rect(pr - 3, 41, 6, 37) + rect(pl - 4.6, 35.6, 9.2, 5.6) + rect(pr - 4.6, 35.6, 9.2, 5.6);
  const arch = (top: number, thick: number, reach: number): string => sagBar(pl - reach, top + thick / 2, pr + reach, top + thick / 2, 1.5, thick);
  const archs = arch(31.6, 3.4, 12.5) + arch(24.4, 3, 13.5) + arch(17.4, 2.8, 14.5);
  const vols = volute(pl - 12.5, 33.3, 3) + volute(pr + 12.5, 33.3, 3) + volute(pl - 13.5, 25.9, 2.7) + volute(pr + 13.5, 25.9, 2.7) + volute(pl - 14.5, 18.8, 2.5) + volute(pr + 14.5, 18.8, 2.5);
  const struts = (y0: number, y1: number): string =>
    rect(pl - 2.4, y0, 4.8, y1 - y0) + rect(pr - 2.4, y0, 4.8, y1 - y0) + repeat(3, (i) => rect(vx - 11 + i * 11 - 1.1, y0 + 2.2, 2.2, y1 - y0));
  const [ring, spokes] = wheel(vx, 12.2, 3.8, 0.9);
  // Trees along both kerbs, smaller toward the vanishing point.
  const trees = [
    place(TREE, 22, 84, 1.25), place(TREE, 46, 74, 0.95), place(TREE, 66, 66.5, 0.7), place(TREE, 82, 61, 0.5), place(TREE, 93, 57.6, 0.36),
    place(TREE, 218, 84, 1.25), place(TREE, 194, 74, 0.95), place(TREE, 174, 66.5, 0.7), place(TREE, 158, 61, 0.5), place(TREE, 147, 57.6, 0.36),
  ].join('');
  const milestone = (x: number, base: number, s: number): string => place(rect(-1.8, -10, 3.6, 10) + disc(0, -10, 1.8) + rect(-2.8, -1.2, 5.6, 1.2), x, base, s);
  return {
    sun: [180, 40],
    far: 2,
    layers: [
      // The plain to the horizon, then the paved road (no centre markings): darker kerbs and two faint cart ruts.
      L('plain', rect(-400, H0, 1040, 400)),
      L('road', poly([[vx - 3, H0], [vx + 3, H0], [vx + 58, 92], [vx - 58, 92]])),
      L('rut', bar(vx - 3, H0, vx - 58, 92, 1) + bar(vx + 3, H0, vx + 58, 92, 1)),
      L('rut faint', bar(vx - 1, H0, vx - 18, 92, 1.2) + bar(vx + 1, H0, vx + 18, 92, 1.2)),
      L('ink', trees),
      L('ink', milestone(62, 77, 1.1) + milestone(178, 77, 1.1) + milestone(85, 62.4, 0.6)),
      L('ink', posts + archs + struts(28.6, 31.6) + struts(21.4, 24.4) + rect(vx - 1, 15.8, 2, 2) + spokes),
      L('ink', vols, true),
      L('ink', ring, true),
    ],
  };
}

/** Giridurga: Oath Stone of the Seven Clans - hilltop platform, seven basalt stones around the carved oath stone, a lit lamp pillar. */
function oathStone(): Art {
  const stone = (x: number, hgt: number, w: number, lean = 0): string =>
    `M${n(x - w / 2)} 66L${n(x - w / 2 + 0.6 + lean)} ${n(66 - hgt + w * 0.4)}C${n(x - w * 0.3 + lean)} ${n(66 - hgt - 1)} ${n(x + w * 0.3 + lean)} ${n(66 - hgt - 1)} ${n(x + w / 2 - 0.6 + lean)} ${n(66 - hgt + w * 0.6)}L${n(x + w / 2)} 66Z`;
  const ring = [
    stone(56, 16, 7, -0.6), stone(72, 20, 7.6, 0.4), stone(90, 15, 6.4), stone(150, 16, 6.8, 0.5), stone(166, 21, 7.6, -0.4), stone(182, 15, 6.6), stone(104, 12, 5.6),
  ].join('');
  const lamp = rect(201, 28, 4, 38) + rect(198, 64, 10, 2) + repeat(5, (i) => rect(198.6, 32 + i * 6.6, 8.8, 1.4)) + rect(199.6, 24.6, 6.8, 3.4);
  return {
    sun: [130, 42],
    far: 1,
    layers: [
      L('ink', 'M14 78C40 66 70 64 120 64C170 64 200 66 226 78Z' + rect(40, 64, 172, 3)),
      L('ink', ring),
      L('ink', 'M114 66L113 34C114 26 128 25 129 33L130 66Z'),
      L('cut gate', disc(121.4, 41, 3.4) + disc(121.4, 41, 2.2) + rect(117, 48, 8.8, 1) + rect(117, 51.4, 8.8, 1) + rect(117, 54.8, 8.8, 1), true),
      L('ink', lamp),
      L('fire', flame(203, 24.8, 7) + repeat(5, (i) => flame(198.2, 32 + i * 6.6, 2.6) + flame(207.8, 32 + i * 6.6, 2.6))),
    ],
  };
}

/** Giridurga: The Cliff Cistern - a cliff with chaitya-arch niches and a pavilion above, an aqueduct channel and the stepped tank. */
function cliffCistern(): Art {
  const cliff = 'M-400 78L-400 30L6 26L16 32L26 25L60 25L72 30L78 44L84 52L86 78Z';
  const pavilion = place(rect(30, 14, 26, 1.6) + wagonRoof(28, 58, 14.4, 9) + gavaksha(28.6, 14.4, 4, 4.6) + gavaksha(57.4, 14.4, 4, 4.6) + kalasha(43, 9.2, 0.9) + repeat(4, (i) => rect(32 + i * 7, 15.6, 1.6, 6.4)) + rect(28, 21.6, 30, 2.4), 0, 3, 1);
  const tankL = 104;
  const tankR = 214;
  const steps = repeat(5, (i) => rect(tankL + i * 4, 62 + i * 2.6, tankR - tankL - i * 8, 1.1));
  const aqueduct = rect(80, 46, 30, 3) + repeat(3, (i) => rect(84 + i * 9, 49, 2.4, 13)) + rect(108, 46, 3, 16);
  return {
    sun: [176, 40],
    far: 1,
    layers: [
      L('ink', cliff + pavilion),
      L('cut gate', gavaksha(22, 62, 11, 16) + gavaksha(50, 60, 9, 13)),
      L('ink', rect(20.6, 50, 1.4, 12) + rect(48.8, 50.4, 1.2, 9.6)),
      L('ink', aqueduct + rect(tankL - 4, 60, tankR - tankL + 8, 2.4) + rect(tankL - 4, 60, 4, 16) + rect(tankR, 60, 4, 16)),
      L('steps', steps),
      L('water', rect(tankL + 20, 75, tankR - tankL - 40, 1)),
      L('ink', rect(tankL, 62, 4, 14) + rect(tankR - 4, 62, 4, 14) + repeat(5, (i) => rect(tankL + i * 4, 63 + i * 2.6, 4, 13 - i * 2.6) + rect(tankR - 4 - i * 4, 63 + i * 2.6, 4, 13 - i * 2.6))),
      L('water', rect(tankL + 20, 74, tankR - tankL - 40, 2)),
    ],
  };
}

/** Giridurga: Citadel of a Thousand Steps - three wall tiers climbing the hill, a zig-zag stair, bastions, the gate tower and torches. */
function thousandSteps(): Art {
  const hill = 'M-400 78L-40 78C20 74 44 64 70 52C92 40 104 34 120 32C136 34 150 40 170 52C196 66 220 74 280 78L640 78Z';
  const tier = (y: number, x0: number, x1: number, hgt: number): string => {
    const b = 5.4;
    const bastion = (x: number, up: number): string => rect(x - b / 2, y - hgt - up, b, hgt + up) + rect(x - b / 2 - 0.8, y - hgt - up - 1.2, b + 1.6, 1.4);
    return rect(x0, y - hgt, x1 - x0, hgt) + rect(x0, y - hgt - 1, x1 - x0, 1) + bastion(x0, 3) + bastion(x1, 3) + bastion((x0 + x1) / 2 - (x1 - x0) * 0.25, 1.6) + bastion((x0 + x1) / 2 + (x1 - x0) * 0.25, 1.6);
  };
  const tower = rect(111, 18.4, 18, 15.6) + rect(108.6, 16.8, 22.8, 2) + wagonRoof(109.6, 130.4, 17, 11.4) + kalasha(120, 11.6, 0.9);
  const stair = 'M120 76L120 74.6L150 70.4L150 69L96 61.4L96 60L140 52L140 50.6L106 43L106 41.6L120 36L121.4 36.4L108.6 41.8L142.4 50.2L142.4 52.4L99.4 60.2L152.4 68L152.4 70.8L122 75L122 76Z';
  const torches = [[150, 69], [96, 60], [140, 50.6], [106, 41.6]] as const;
  return {
    sun: [184, 36],
    far: 1,
    layers: [
      L('hill', hill),
      L('ink', tier(71, 50, 190, 5.4) + tier(58, 74, 166, 5.2) + tier(45.6, 92, 148, 4.8) + tower),
      L('steps', stair),
      L('cut gate', rect(117.2, 24, 5.6, 10) + gavaksha(120, 16.2, 4.4, 3.4) + repeat(4, (i) => rect(60 + i * 38, 67.4, 2, 2.4))),
      L('fire', torches.map(([x, y]) => flame(x, y - 1.6, 4.4)).join('')),
      L('ink', torches.map(([x, y]) => rect(x - 0.4, y - 1.8, 0.8, 1.8)).join('')),
    ],
  };
}

/** Giridurga: Assembly Caves of the League - a cliff face, the horseshoe chaitya window with its timber-rib screen, pillared veranda, railing frieze. */
function caveAssembly(): Art {
  const rock = 'M-400 78L-400 22C-20 16 0 10 30 12C60 8 90 6 120 7C150 6 180 9 210 12C240 10 260 16 640 22L640 78Z';
  const ribs = repeat(5, (i) => bar(108 + i * 6, 46, 108 + i * 6, 22 + Math.abs(i - 2) * 2.4, 1.1)) + sagBar(104, 34, 136, 34, 0, 1);
  const veranda = repeat(6, (i) => rect(66.6 + i * 21.4, 52, 3.6, 24) + poly([[65.6 + i * 21.4, 52], [71.2 + i * 21.4, 52], [70.2 + i * 21.4, 54.4], [66.6 + i * 21.4, 54.4]]));
  const frieze = repeat(14, (i) => rect(56.6 + i * 9.2, 48.4, 5.4, 2.2));
  return {
    sun: [200, 42],
    far: 1,
    layers: [
      L('ink', rock),
      // The one lit opening: the chaitya window (light shaft into the hall); the veranda stays in deep shade.
      L('cut gate', gavaksha(120, 48, 36, 36)),
      L('ink', gavaksha(120, 46, 26, 28) + rect(52, 46.6, 136, 4.4)),
      L('cut deep', gavaksha(120, 46, 22, 24) + rect(60, 52, 120, 24)),
      L('cut gate', frieze),
      L('ink', veranda + rect(56, 74, 128, 2) + ribs),
    ],
  };
}

/**
 * Nilavana: Elephant Grove of Gajavana - a giant banyan with prop roots, a war elephant, and the raised pavilion with a
 * steep three-tier thatch roof (rounded, drooping thatch eaves on a stilted timber deck - not upturned tiers).
 */
function elephantGrove(): Art {
  const canopy =
    ellipse(58, 32, 44, 11) + disc(24, 30, 10) + disc(38, 23, 12) + disc(56, 19, 13) + disc(74, 21, 12) + disc(90, 27, 10) + disc(100, 33, 6.6) + disc(16, 35, 6.6);
  const trunk = poly([[49, 76], [52, 40], [62, 40], [66, 76]]);
  const props = [20, 28, 37, 76, 86, 96].map((x) => bar(x, 38, x + 0.6, 76, 1.8)).join('');
  const hanging = [24, 32, 42, 46, 70, 80, 91, 100].map((x, i) => bar(x, 38, x, 52 + (i % 3) * 5, 0.6)).join('');
  // Kutagara pavilion of the Bharhut / Sanchi reliefs: a stilted timber deck under a tall barrel-thatch roof seen
  // broadside (long ridge, gavaksha gables at both ends, a thick thatch rim, ridge finials). Stacked tiers or an
  // end-on horseshoe read as a pagoda or an onion dome at band size, so neither is used.
  const pavilion =
    repeat(4, (i) => rect(162 + i * 10.6, 52, 1.8, 24)) + rect(158, 50, 40, 2.6) + vedika(160, 196, 5.6, 50) + rect(163, 42, 1.8, 8) + rect(191.2, 42, 1.8, 8) +
    wagonRoof(154, 202, 43, 22) + gavaksha(155, 43, 10, 15) + gavaksha(201, 43, 10, 15) + rect(151, 41.6, 54, 2.8) + repeat(3, (i) => kalasha(166 + i * 12, 22.4, 1));
  return {
    sun: [136, 38],
    far: 0,
    layers: [
      L('ink', canopy + trunk + props),
      L('ink', hanging),
      L('ink', pavilion),
      L('cut gate', gavaksha(155, 41.4, 5, 7) + gavaksha(201, 41.4, 5, 7)),
      L('cut deep', repeat(6, (i) => bar(166 + i * 5, 40.6, 166 + i * 5, 28, 0.7))),
      L('ink', place(ELEPHANT, 128, G, 2)),
      L('cut gate', bar(143.4, 59.6, 147.4, 62.2, 1.2)),
    ],
  };
}

/** Nilavana: The Canopy Watch - timber towers in the canopy, rope bridges between them, the central lookout with banners. */
function canopyWatch(): Art {
  const tree = (x: number, s: number): string => rect(x - 2.2 * s, 76 - 46 * s, 4.4 * s, 46 * s) + disc(x, 76 - 50 * s, 13 * s) + disc(x - 11 * s, 76 - 44 * s, 9 * s) + disc(x + 11 * s, 76 - 44 * s, 9 * s);
  const deck = (x: number, y: number, w: number): string => rect(x - w / 2, y, w, 2.2) + rect(x - w / 2 + 1, y + 2.2, 1.4, 5) + rect(x + w / 2 - 2.4, y + 2.2, 1.4, 5) + vedika(x - w / 2, x + w / 2, 4.4, y);
  const look = rect(110, 30, 20, 2.4) + vedika(110, 130, 5, 30) + rect(112, 18, 1.6, 12) + rect(126.4, 18, 1.6, 12) + poly([[108, 18.4], [132, 18.4], [124, 12.4], [116, 12.4]]) + rect(118.6, 32.4, 2.8, 43.6);
  const b1 = banner(108, 30, 16, true);
  const b2 = banner(132, 30, 16);
  const ladder = rect(116, 32, 1, 44) + rect(124, 32, 1, 44) + repeat(9, (i) => rect(116, 36 + i * 4.4, 9, 0.8));
  return {
    sun: [180, 34],
    far: 0,
    layers: [
      L('ink', tree(50, 1) + tree(190, 1.02)),
      L('ink', deck(50, 38, 26) + deck(190, 36, 26)),
      L('ink', sagBar(63, 38.6, 110, 31.6, 2.6, 0.9) + sagBar(130, 31.6, 177, 36.6, 2.6, 0.9) + sagBar(63, 34.6, 110, 27.6, 2.6, 0.6) + sagBar(130, 27.6, 177, 32.6, 2.6, 0.6)),
      L('ink', look + ladder + b1.pole + b2.pole),
      L('cut banner', b1.cloth + b2.cloth),
    ],
  };
}

/** Marudesha: Caravanserai of the Salt Road - a low mud-brick court, square corner towers, a trabeated timber gate, camel and salt sacks. */
function saltCaravanserai(): Art {
  const dx = -10;
  const X = (x: number): number => x + dx;
  const wall = rect(X(40), 50, 140, 26) + rect(X(38), 48, 144, 2.4);
  const towers = rect(X(30), 36, 16, 40) + rect(X(28.6), 34, 18.8, 2.4) + rect(X(174), 36, 16, 40) + rect(X(172.6), 34, 18.8, 2.4);
  // Trabeated gate: a flat-roofed gate room on two posts, a flat lintel with projecting beam ends - no arch.
  const gate = rect(X(92), 36, 36, 40) + rect(X(90), 34, 40, 2.4) + repeat(6, (i) => rect(X(91 + i * 7.2), 32.4, 2.2, 1.8));
  const opening = rect(X(100), 50, 20, 26);
  const beams = rect(X(96), 47, 28, 3) + rect(X(93.2), 47.6, 3, 1.8) + rect(X(123.8), 47.6, 3, 1.8) + rect(X(98), 50, 2.4, 26) + rect(X(119.6), 50, 2.4, 26);
  const roomCut = repeat(3, (i) => rect(X(101 + i * 7.4), 39.4, 3.4, 4.6));
  // Timber veranda roof inside the court, glimpsed over the wall (no arcades).
  const veranda = rect(X(136), 44, 34, 1.6) + repeat(5, (i) => rect(X(137 + i * 7.6), 45.6, 1.2, 2.8)) + rect(X(50), 44, 34, 1.6) + repeat(5, (i) => rect(X(51 + i * 7.6), 45.6, 1.2, 2.8));
  const sack = (x: number, y: number): string => `M${n(x - 3.4)} ${n(y)}C${n(x - 3.8)} ${n(y - 4)} ${n(x - 2.6)} ${n(y - 5.6)} ${n(x)} ${n(y - 5.6)}C${n(x + 2.6)} ${n(y - 5.6)} ${n(x + 3.8)} ${n(y - 4)} ${n(x + 3.4)} ${n(y)}Z`;
  const sacks = sack(X(142), 76) + sack(X(149.4), 76) + sack(X(145.7), 70.8);
  return {
    sun: [146, 36],
    far: 2,
    layers: [
      L('ink', wall + towers + gate + veranda),
      L('cut gate', opening + roomCut + rect(X(35.4), 42, 2.4, 5) + rect(X(39), 42, 2.4, 5) + rect(X(179.4), 42, 2.4, 5) + rect(X(183), 42, 2.4, 5)),
      L('ink', beams),
      L('sack', sacks),
      L('ink', bar(X(140), 73.6, X(144), 73.6, 0.5) + bar(X(147.4), 73.6, X(151.4), 73.6, 0.5) + bar(X(143.7), 68.4, X(147.7), 68.4, 0.5)),
      L('ink', place(CAMEL, 214, G, 1.6, true)),
      L('sack', place(CAMEL_SACKS, 214, G, 1.6, true)),
    ],
  };
}

/** Marudesha: Beacon Line of the Western Passes - the master stone tower with an iron fire basket and smoke, smaller beacons on the hills. */
function beaconLine(): Art {
  const hills = 'M-400 78L-400 72C-20 70 0 66 20 64C40 62 52 56 66 52C80 50 90 58 104 64C120 70 150 66 170 54C186 46 204 44 222 52C240 58 260 66 300 72L640 72L640 78Z';
  const beacon = (x: number, base: number, s: number): string => place(rect(-2.6, -14, 5.2, 14) + poly([[-4.4, -14], [4.4, -14], [3, -17], [-3, -17]]), x, base, s);
  const master = poly([[110, 76], [114, 28], [126, 28], [130, 76]]) + rect(108.6, 26, 22.8, 2.6);
  const basketBars = repeat(5, (i) => bar(111.2 + i * 4.4, 17.4, 112.8 + i * 3.6, 25.6, 0.9)) + rect(108.6, 16.4, 22.8, 1.4) + rect(111, 21, 18, 0.9);
  const smoke = 'M118 15C112 11 117 7 124 6C134 4.6 146 4 158 5.4C170 6.6 182 5 198 4.6L198 9.6C182 11 172 13 160 12C148 11 136 12.6 128 13.4C124 13.8 122 14.6 122 16Z';
  return {
    sun: [70, 36],
    far: 1,
    layers: [
      L('smoke', smoke),
      L('ink', hills),
      L('ink', beacon(66, 52.4, 1) + beacon(204, 45.4, 0.92) + beacon(30, 63.2, 0.62)),
      L('fire', flame(66, 35.6, 7) + flame(204, 29.6, 6.4) + flame(30, 52.8, 4.4)),
      L('ink', master + rect(106, 72, 28, 4)),
      L('cut gate', rect(118, 44, 4, 6) + rect(118, 58, 4, 8)),
      L('fire', flame(120, 24, 13) + flame(115, 24, 8) + flame(125.4, 24, 8.6)),
      L('ink', basketBars),
    ],
  };
}

/** Samudra: Lamp Tower of the River Mouth - a tapered brick-and-stone tower with a fire cage on a stone jetty, boats moored around. */
function lampTower(): Art {
  const water = 62;
  const tower = poly([[110, 70], [114.4, 25], [125.6, 25], [130, 70]]) + rect(106, 68, 28, 3) + rect(112.4, 22.6, 15.2, 2.6);
  const bands = repeat(4, (i) => rect(111.6 + i * 1, 60 - i * 10, 16.8 - i * 2, 1.2));
  const cage = rect(112.6, 11.4, 14.8, 1.4) + repeat(5, (i) => rect(113 + i * 3.4, 12.8, 1, 10.2)) + tri([112, 11.4], [120, 7.2], [128, 11.4]);
  const jetty = rect(64, 68, 120, 3.4) + repeat(8, (i) => rect(68 + i * 15.6, 71.4, 2.4, 4.6));
  const boat = (x: number, s: number, flip = false): string =>
    place(
      // Planked hull with raised prow and stern, a mast with a yard and a square sail (no lateen / modern sail).
      'M-13 -5L-10.6 -2.4L10.6 -2.4L13 -5.4L12.4 -1.4C9 1.4 5 2 0 2C-5 2 -9 1.4 -12.4 -1.2Z' + rect(-0.5, -21, 1, 18.8) + bar(-7.4, -19.4, 7.4, -19.4, 0.9) + poly([[-6.8, -18.8], [6.8, -18.8], [6, -7.6], [-6, -7.6]]) + rect(-6, -4.8, 8, 2.4),
      x, water + 6 * s, s, flip,
    );
  return {
    sun: [176, 46],
    far: 2,
    layers: [
      L('water', rect(-400, water, 1040, 14)),
      L('glint', repeat(5, (i) => rect(150 + i * 9, 64 + (i % 2) * 3, 6 - (i % 3), 0.8))),
      L('ink', boat(42, 1) + boat(196, 0.86, true) + boat(160, 0.55)),
      L('ink', jetty + tower + cage),
      L('cut gate', bands + rect(118, 50, 4, 6) + rect(118, 32, 4, 6)),
      L('fire', flame(120, 22.6, 9) + flame(116.2, 22.6, 5) + flame(123.8, 22.6, 5.6)),
    ],
  };
}

/** Samudra: Hall of the Guilds - a two-storey timber hall, barrel-vault roof with gavaksha gables, balcony on beam ends, guild banners. */
function guildHall(): Art {
  const ground = rect(56, 52, 128, 2) + repeat(9, (i) => rect(58 + i * 15.2, 54, 2.6, 22)) + rect(52, 74, 136, 2);
  const balcony = rect(50, 46, 140, 2.6) + repeat(12, (i) => rect(51 + i * 12.4, 48.6, 2.2, 1.8)) + vedika(52, 188, 6, 46);
  const upper = rect(62, 26, 116, 14) + rect(58, 24.4, 124, 2);
  const roof = wagonRoof(56, 184, 25, 13) + gavaksha(62, 25, 11, 13) + gavaksha(178, 25, 11, 13) + repeat(5, (i) => kalasha(88 + i * 16, 13.4, 1));
  const b1 = banner(36, 76, 46);
  const b2 = banner(204, 76, 46, true);
  const b3 = banner(28, 76, 34);
  const b4 = banner(212, 76, 34, true);
  return {
    sun: [196, 52],
    far: 2,
    layers: [
      L('ink', ground + balcony + upper + roof + rect(54, 40, 132, 6) + b1.pole + b2.pole + b3.pole + b4.pole),
      L('cut gate', repeat(6, (i) => rect(68 + i * 18.4, 29.4, 6, 8)) + gavaksha(62, 24, 6, 8) + gavaksha(178, 24, 6, 8) + rect(108, 58, 24, 18)),
      L('ink', rect(113, 58, 1.4, 18) + rect(125.6, 58, 1.4, 18) + rect(108, 58, 24, 1.6)),
      L('cut banner', b1.cloth + b2.cloth),
      L('cut banner2', b3.cloth + b4.cloth),
    ],
  };
}

/** Kotanagara: The Coin House - a red-sandstone mint with a wagon-vault roof, a punch-marked coin over the gate, a guarded court wall. */
function coinHouse(): Art {
  const mint = rect(64, 38, 112, 26) + wagonRoof(58, 182, 38.4, 26) + gavaksha(64, 38, 10, 12) + gavaksha(176, 38, 10, 12) + repeat(5, (i) => kalasha(96 + i * 12, 26.4, 1));
  const court = rect(40, 60, 160, 16) + rect(38, 58, 164, 2.4);
  const gate = rect(104, 46, 32, 30) + rect(101, 44, 38, 2.6);
  const coin = disc(120, 24, 11.4);
  // Punch marks: the arched hill (three arches + crescent), a sun with rays, a taurine.
  const marks =
    'M110.4 30L110.4 27.6C110.4 25.4 113.6 25.4 113.6 27.6L113.6 30Z' + 'M113.6 30L113.6 25.4C113.6 22.8 117.4 22.8 117.4 25.4L117.4 30Z' + 'M117.4 30L117.4 27.6C117.4 25.4 120.6 25.4 120.6 27.6L120.6 30Z' +
    'M113.4 21.8C113.6 19.6 117.4 19.6 117.6 21.8C116.4 20.8 114.6 20.8 113.4 21.8Z' +
    disc(126, 20, 1.8) + repeat(8, (i) => {
      const a = (i * Math.PI) / 4;
      return bar(126 + Math.cos(a) * 2.4, 20 + Math.sin(a) * 2.4, 126 + Math.cos(a) * 3.8, 20 + Math.sin(a) * 3.8, 0.7);
    }) +
    disc(126, 28.4, 1.2) + 'M123.4 26.2C124 27.8 128 27.8 128.6 26.2L127.8 26C127.2 27 124.8 27 124.2 26Z';
  return {
    sun: [190, 40],
    far: 0,
    layers: [
      L('ink', mint + court + gate + coin + rect(117, 35, 6, 9)),
      L('coin', disc(120, 24, 9.6)),
      L('ink', marks),
      L('cut gate', rect(112, 52, 16, 24) + repeat(4, (i) => rect(72 + i * 8, 44, 3, 8)) + repeat(4, (i) => rect(145 + i * 8, 44, 3, 8))),
      L('ink', place(GUARD, 96, G, 1.2) + place(GUARD, 144, G, 1.2, true)),
    ],
  };
}

/** Kotanagara: Engineers' Arsenal - a workshop yard: timber crane, a siege tower in scaffolding, a covered ram, timber stacks. */
function arsenal(): Art {
  const shed = rect(30, 52, 60, 24) + wagonRoof(26, 94, 52.4, 42) + gavaksha(30, 52, 8, 9) + gavaksha(90, 52, 8, 9);
  const crane = bar(102, 76, 116, 18, 2) + bar(130, 76, 116, 18, 2) + bar(106, 58, 126, 58, 1.2) + bar(110, 42, 122, 42, 1.2) + bar(116, 18, 168, 30, 1.8) + bar(116, 18, 100, 22, 1.6) + rect(97, 20, 6, 6) + bar(166, 30, 166, 46, 0.6);
  const load = rect(160, 46, 12, 5);
  // Siege tower under construction: tapered frame, floors, cross-bracing, unfinished top.
  const tw = (y: number): number => 9 - (76 - y) * 0.06;
  const towerX = 196;
  let frame = bar(towerX - 10, 76, towerX - 7, 22, 1.8) + bar(towerX + 10, 76, towerX + 7, 22, 1.8);
  for (const y of [70, 58, 46, 34, 24]) frame += rect(towerX - tw(y) - 0.6, y, (tw(y) + 0.6) * 2, 1.6);
  frame += bar(towerX - 9.6, 70, towerX + 8.6, 58, 0.8) + bar(towerX + 9.6, 70, towerX - 8.6, 58, 0.8) + bar(towerX - 8.8, 58, towerX + 7.8, 46, 0.8) + bar(towerX + 8.8, 58, towerX - 7.8, 46, 0.8);
  frame += rect(towerX - 9.4, 58, 18.8, 12) + bar(towerX - 7.4, 24, towerX - 7.4, 16, 1) + bar(towerX + 3, 24, towerX + 3, 19, 1);
  const ram = poly([[140, 68], [146, 58], [170, 58], [176, 68]]) + rect(136, 64.6, 44, 2) + disc(146, 71, 4.4) + disc(170, 71, 4.4);
  const logs = repeat(4, (i) => disc(40 + i * 7, 72.6, 3.2)) + repeat(3, (i) => disc(43.6 + i * 7, 66.8, 3.2)) + repeat(2, (i) => disc(47 + i * 7, 61, 3.2));
  return {
    sun: [60, 30],
    far: 0,
    layers: [
      L('ink', shed + crane + load + frame + ram),
      L('cut gate', rect(48, 58, 22, 18) + disc(146, 71, 2.4) + disc(170, 71, 2.4)),
      L('ink', disc(146, 71, 0.9) + disc(170, 71, 0.9) + bar(176, 63, 184, 63, 2.2)),
      L('ink', logs),
      L('cut log', repeat(4, (i) => disc(40 + i * 7, 72.6, 1.6)) + repeat(3, (i) => disc(43.6 + i * 7, 66.8, 1.6)) + repeat(2, (i) => disc(47 + i * 7, 61, 1.6))),
    ],
  };
}

const ARTS: Readonly<Record<string, () => Art>> = {
  lm_hundred_pillars: hundredPillars,
  lm_royal_granary: royalGranary,
  lm_edict_pillars: edictPillars,
  lm_great_road: greatRoad,
  lm_oath_stone: oathStone,
  lm_cliff_cistern: cliffCistern,
  lm_thousand_steps: thousandSteps,
  lm_cave_assembly: caveAssembly,
  lm_elephant_grove: elephantGrove,
  lm_canopy_watch: canopyWatch,
  lm_salt_caravanserai: saltCaravanserai,
  lm_beacon_line: beaconLine,
  lm_lamp_tower: lampTower,
  lm_guild_hall: guildHall,
  lm_coin_house: coinHouse,
  lm_arsenal: arsenal,
};

const cache = new Map<string, Art>();
function artFor(landmarkId: string): Art {
  const id = ARTS[landmarkId] ? landmarkId : 'lm_hundred_pillars';
  let art = cache.get(id);
  if (!art) {
    art = ARTS[id]!();
    cache.set(id, art);
  }
  return art;
}

/** Far ridge behind the subject (pale haze plane), drawn well past the viewBox on both sides. */
const FAR: Readonly<Record<0 | 1 | 2, string>> = {
  0: 'M-400 80L-400 64C-300 60 -200 64 -100 60C-40 58 0 62 40 58C80 54 110 60 150 57C190 54 220 60 260 58C340 54 420 60 640 62L640 80Z',
  1: 'M-400 80L-400 58C-300 50 -200 56 -100 50C-40 46 -10 52 20 44C50 36 70 50 100 46C130 42 150 34 180 42C210 50 230 44 260 48C340 54 420 50 640 54L640 80Z',
  2: 'M-400 80L-400 66C-200 64 0 66 120 65C240 64 440 66 640 66L640 80Z',
};

/** Ink silhouette band of a landmark (`aria-hidden`; the card's title names it). */
export function landmarkArt(landmarkId: string): SVGSVGElement {
  const art = artFor(landmarkId);
  const gid = `lmsky-${landmarkId}`;
  const sky = svg(
    'linearGradient',
    { id: gid, x1: 0, y1: -60, x2: 0, y2: G, gradientUnits: 'userSpaceOnUse' },
    svg('stop', { offset: '0', 'stop-color': '#f8d488' }),
    svg('stop', { offset: '0.55', 'stop-color': '#f1b45e' }),
    svg('stop', { offset: '0.85', 'stop-color': '#e5994a' }),
    svg('stop', { offset: '1', 'stop-color': '#d4823e' }),
  );
  const [sx, sy] = art.sun;
  const parts: SVGElement[] = [
    svg('defs', null, sky),
    // Sky and ground run far past the viewBox: `meet` letterboxing on any card aspect shows more sky / ground, never a gap.
    svg('rect', { x: -400, y: -400, width: 1040, height: 400 + G, fill: `url(#${gid})` }),
    svg('circle', { cx: sx, cy: sy, r: 22, class: 'lm-halo' }),
    svg('circle', { cx: sx, cy: sy, r: 12.5, class: 'lm-sun' }),
    svg('path', { d: FAR[art.far], class: 'lm-far' }),
    svg('rect', { x: -400, y: G, width: 1040, height: 400, class: 'lm-ground' }),
    svg('rect', { x: -400, y: G, width: 1040, height: 1.2, class: 'lm-ground-lip' }),
  ];
  for (const layer of art.layers) {
    if (!layer.d) continue;
    const cls = layer.cls.split(' ').map((c) => `lm-${c}`).join(' ');
    parts.push(svg('path', layer.eo ? { d: layer.d, class: cls, 'fill-rule': 'evenodd' } : { d: layer.d, class: cls }));
  }
  return svg(
    'svg',
    { class: 'lm-art', viewBox: `0 0 ${LM_BAND.w} ${LM_BAND.h}`, preserveAspectRatio: 'xMidYMax meet', 'aria-hidden': 'true', focusable: 'false' },
    ...parts,
  );
}

/**
 * Bounds of a landmark's subject layers (everything but sky, far ridge, ground and the plain / road / water planes),
 * measured from the absolute path data; curve control points make it conservative.
 */
export function landmarkArtBounds(landmarkId: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const art = artFor(landmarkId);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const layer of art.layers) {
    if (/^(plain|road|rut|water|glint|smoke)\b/.test(layer.cls)) continue;
    const nums = (layer.d.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      minX = Math.min(minX, nums[i]!);
      maxX = Math.max(maxX, nums[i]!);
      minY = Math.min(minY, nums[i + 1]!);
      maxY = Math.max(maxY, nums[i + 1]!);
    }
  }
  return { minX, maxX, minY, maxY };
}

/** Landmark ids with a dedicated illustration (tests: every LANDMARKS entry is covered). */
export const LANDMARK_ART_IDS: readonly string[] = Object.keys(ARTS);
