/**
 * Heraldry emblems (the ten BANNER_PATTERNS), banner cloth shapes and single-color UI icons as SVG path
 * data. OWNER: Art Director. Pure strings, no DOM: render code draws them into canvas textures with
 * Path2D (banners, shields, map markers); the UI gets the same shapes as CSS mask tokens in
 * src/ui/theme.css (--emblem-*, --icon-*), generated from this file (docs/ART_BIBLE.md §11.4).
 *
 * Style: the emblems follow the symbol vocabulary of early punch-marked coins and Sanchi reliefs (sun,
 * arched hill, elephant, tree-in-railing, wheel, lotus) - flat, bold, readable at 16 px and on a banner at
 * 200 m. Emblem viewBox 0 0 100 100; banner cloth viewBox 0 0 100 150 (hangs from the crossbar at y = 0);
 * icon viewBox 0 0 24 24.
 */
import type { BannerPattern, FactionColors } from '../../core/types';
import type { BannerShape } from './factions';

export type EmblemRole = 'field' | 'secondary' | 'accent' | 'light' | 'dark';

export interface EmblemLayer {
  /** SVG path data; nonzero fill rule (clockwise shapes, counter-clockwise holes). */
  d: string;
  role: EmblemRole;
}

/** Fixed colors for blazon "white" and "black" charges. */
export const EMBLEM_LIGHT = '#efe6d2';
export const EMBLEM_DARK = '#231c18';

// ----------------------------------------------------------------------------------------- path helpers

const DEG = Math.PI / 180;
const n1 = (v: number): string => String(Math.round(v * 10) / 10);

/** Signed area in y-down coordinates (> 0 = clockwise on screen). */
function area(points: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Closed polygon, normalized to clockwise. Every filled shape is clockwise and every hole counter-clockwise,
 * so the nonzero fill rule (SVG default, canvas Path2D default) unions overlapping charges and cuts holes.
 */
function poly(points: readonly (readonly [number, number])[], hole = false): string {
  const pts = (area(points) > 0) === !hole ? points : [...points].reverse();
  return `M${pts.map(([x, y]) => `${n1(x)} ${n1(y)}`).join('L')}Z`;
}

/** Clockwise circle (filled); `hole` = counter-clockwise (cuts). */
function circle(cx: number, cy: number, r: number, hole = false): string {
  const s = hole ? 0 : 1;
  return `M${n1(cx - r)} ${n1(cy)}a${n1(r)} ${n1(r)} 0 1 ${s} ${n1(2 * r)} 0a${n1(r)} ${n1(r)} 0 1 ${s} ${n1(-2 * r)} 0Z`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, rotDeg = 0, segments = 20, hole = false): string {
  const pts: [number, number][] = [];
  const c = Math.cos(rotDeg * DEG);
  const s = Math.sin(rotDeg * DEG);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return poly(pts, hole);
}

function rotatePts(pts: readonly (readonly [number, number])[], cx: number, cy: number, deg: number): [number, number][] {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

function rect(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** n triangular rays around (cx, cy). */
function rays(cx: number, cy: number, n: number, rIn: number, rOut: number, halfDeg: number, rotDeg = 0): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (rotDeg + (i * 360) / n) * DEG;
    const h = halfDeg * DEG;
    d += poly([
      [cx + Math.sin(a) * rOut, cy - Math.cos(a) * rOut],
      [cx + Math.sin(a + h) * rIn, cy - Math.cos(a + h) * rIn],
      [cx + Math.sin(a - h) * rIn, cy - Math.cos(a - h) * rIn],
    ]);
  }
  return d;
}

/** n rectangular spokes. */
function spokes(cx: number, cy: number, n: number, rIn: number, rOut: number, width: number, rotDeg = 0): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    d += poly(rotatePts(rect(cx - width / 2, cy - rOut, cx + width / 2, cy - rIn), cx, cy, rotDeg + (i * 360) / n));
  }
  return d;
}

/** n lens petals (pointed both ends) radiating from (cx, cy). */
function petals(cx: number, cy: number, n: number, rIn: number, rOut: number, width: number, rotDeg = 0): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const pts: [number, number][] = [];
    const len = rOut - rIn;
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push([cx + Math.sin(Math.PI * t) * width * 0.5, cy - rIn - len * t]);
    }
    for (let k = 9; k >= 1; k--) {
      const t = k / 10;
      pts.push([cx - Math.sin(Math.PI * t) * width * 0.5, cy - rIn - len * t]);
    }
    d += poly(rotatePts(pts, cx, cy, rotDeg + (i * 360) / n));
  }
  return d;
}

/** A horizontal wave band (two sinusoid edges) between y and y + h, `waves` crests across 0..100. */
function waveBand(y: number, h: number, amp: number, waves: number, x0 = 0, x1 = 100): string {
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  const steps = waves * 12;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const s = Math.sin((i / steps) * waves * Math.PI * 2);
    top.push([x, y - s * amp]);
    bottom.push([x, y + h - s * amp * 0.7]);
  }
  return poly([...top, ...bottom.reverse()]);
}

const ring = (cx: number, cy: number, rOut: number, rIn: number): string => circle(cx, cy, rOut) + circle(cx, cy, rIn, true);

// ----------------------------------------------------------------------------------------- emblems

const ELEPHANT_BODY =
  ellipse(45, 60, 21, 13.5) +
  circle(68, 53, 11.5) +
  poly([[74, 56], [80, 62], [81, 72], [80.5, 80], [83, 84], [87, 82], [88.5, 85], [84, 89.5], [78, 88], [76.5, 80], [76.5, 70], [72, 63]]) +
  poly(rect(27, 64, 34.5, 85)) +
  poly(rect(37.5, 66, 45, 85)) +
  poly(rect(51, 66, 58.5, 85)) +
  poly(rect(60, 62, 67.5, 85)) +
  poly([[25, 55], [27.5, 56], [23, 72], [20.5, 71.5]]);
const ELEPHANT_EAR = ellipse(62.5, 57, 6.5, 9.5, -10);
const ELEPHANT_TUSK = poly([[72, 64], [78, 67.5], [82, 66], [79.5, 69.5], [73.5, 67.5]]);

/** Emblem layers per banner pattern (drawn in order over the field). */
export const EMBLEMS: Readonly<Record<BannerPattern, readonly EmblemLayer[]>> = {
  solid: [],
  sun: [
    { d: circle(50, 40, 13) + rays(50, 40, 12, 16.5, 31, 7.5), role: 'secondary' },
    { d: waveBand(78, 30, 4, 2), role: 'accent' },
  ],
  mountain: [
    {
      d: (
        [
          [8, 67, 21],
          [22, 58, 22],
          [36, 48, 23],
          [50, 33, 27],
          [64, 48, 23],
          [78, 58, 22],
          [92, 67, 21],
        ] as const
      )
        .map(([x, top, half]) => poly([[x, top], [x + half, 96], [x - half, 96]]))
        .join(''),
      role: 'light',
    },
    { d: poly([[40, 20], [60, 20], [55.5, 25.5], [44.5, 25.5]]) + poly([[50, 6], [53.6, 11.5], [53, 16.5], [50, 18.5], [47, 16.5], [46.4, 11.5]]), role: 'accent' },
  ],
  elephant: [
    { d: poly([[8, 48], [14, 30], [26, 18], [40, 12], [50, 11], [60, 12], [74, 18], [86, 30], [92, 48], [86, 48], [80, 33], [70, 23], [58, 18], [50, 17.5], [42, 18], [30, 23], [20, 33], [14, 48]]), role: 'secondary' },
    {
      d: circle(14, 33, 4) + circle(25, 21, 4) + circle(38, 14.5, 4) + circle(50, 13, 4.2) + circle(62, 14.5, 4) + circle(75, 21, 4) + circle(86, 33, 4),
      role: 'secondary',
    },
    { d: ELEPHANT_BODY, role: 'accent' },
    { d: ELEPHANT_EAR, role: 'field' },
    { d: ELEPHANT_TUSK, role: 'light' },
  ],
  chevron: [
    { d: 'M0 86Q25 56 50 48Q75 56 100 86L100 100Q75 72 50 66Q25 72 0 100Z', role: 'dark' },
    { d: ring(50, 25, 16, 11.5) + circle(50, 25, 4.2) + spokes(50, 25, 8, 3.5, 12.5, 3.4, 22.5), role: 'light' },
  ],
  wave: [
    { d: waveBand(74, 7, 4, 3) + waveBand(87, 7, 4, 3), role: 'light' },
    { d: poly([[43, 69], [57, 69], [54.5, 32], [45.5, 32]]) + poly(rect(41.5, 27, 58.5, 32)) + poly([[50, 9], [54, 16], [53, 22], [50, 24.5], [47, 22], [46, 16]]), role: 'accent' },
  ],
  tower: [
    { d: poly(rect(29, 30, 71, 90)) + poly(rect(29, 21, 36, 31)) + poly(rect(38.5, 21, 45.5, 31)) + poly(rect(54.5, 21, 61.5, 31)) + poly(rect(64, 21, 71, 31)) + poly(rect(47.5, 18, 52.5, 31)), role: 'light' },
    { d: 'M41 90V68A9 9 0 0 1 59 68V90Z', role: 'field' },
    { d: poly(rect(36, 40, 40, 50)) + poly(rect(60, 40, 64, 50)), role: 'field' },
    { d: ring(50, 75, 6, 3.6) + circle(50, 75, 1.6), role: 'accent' },
  ],
  lotus: [
    { d: petals(50, 50, 8, 9, 36, 15, 22.5), role: 'secondary' },
    { d: petals(50, 50, 8, 7, 24, 11), role: 'light' },
    { d: circle(50, 50, 7), role: 'accent' },
  ],
  wheel: [
    { d: ring(50, 50, 34, 27.5) + circle(50, 50, 8) + spokes(50, 50, 8, 7, 28, 4.2), role: 'secondary' },
    { d: circle(50, 50, 3), role: 'accent' },
  ],
  tree: [
    { d: circle(50, 33, 17) + circle(35, 42, 12) + circle(65, 42, 12) + circle(50, 46, 12), role: 'secondary' },
    { d: poly(rect(46.5, 46, 53.5, 76)), role: 'accent' },
    {
      d: poly(rect(18, 74, 82, 78.5)) + poly(rect(18, 84, 82, 88.5)) + [20, 32, 44, 56, 68, 80].map((x) => poly(rect(x - 2.2, 70, x + 2.2, 96))).join(''),
      role: 'light',
    },
  ],
};

/** Banner cloth outlines (viewBox 0 0 100 150, hanging from a crossbar at the top edge). */
export const BANNER_SHAPES: Readonly<Record<BannerShape, string>> = {
  swallowtail: 'M0 0H100V150L50 116L0 150Z',
  pennant: 'M0 0H100L50 150Z',
  notched: 'M0 14L16.6 0L33.3 14L50 0L66.6 14L83.3 0L100 14V150H0Z',
  streamer: 'M6 0H94L62 150H38Z',
  square: 'M0 0H100V100H0Z',
  fringed: 'M0 0H100V128H0Z',
};

/** Where the emblem sits on each cloth (center x, y and scale of the 100 x 100 emblem box). */
export const BANNER_EMBLEM_PLACEMENT: Readonly<Record<BannerShape, { x: number; y: number; scale: number }>> = {
  swallowtail: { x: 50, y: 52, scale: 0.78 },
  pennant: { x: 50, y: 38, scale: 0.56 },
  notched: { x: 50, y: 66, scale: 0.8 },
  streamer: { x: 50, y: 34, scale: 0.6 },
  square: { x: 50, y: 50, scale: 0.84 },
  fringed: { x: 50, y: 62, scale: 0.84 },
};

/** Border band drawn inside every banner (fraction of width) in the secondary color. */
export const BANNER_BORDER = 0.06;

export function emblemColor(role: EmblemRole, colors: FactionColors): string {
  switch (role) {
    case 'field':
      return colors.primary;
    case 'secondary':
      return colors.secondary;
    case 'accent':
      return colors.accent;
    case 'light':
      return EMBLEM_LIGHT;
    case 'dark':
      return EMBLEM_DARK;
  }
}

/** Full-color emblem as an SVG string (for UI crests via data URI, docs, or canvas via Image). */
export function emblemSvg(pattern: BannerPattern, colors: FactionColors, opts: { round?: boolean; border?: boolean } = {}): string {
  const field = opts.round ? `<circle cx="50" cy="50" r="49" fill="${colors.primary}"/>` : `<rect width="100" height="100" rx="6" fill="${colors.primary}"/>`;
  const clip = opts.round ? `<clipPath id="c"><circle cx="50" cy="50" r="49"/></clipPath>` : `<clipPath id="c"><rect width="100" height="100" rx="6"/></clipPath>`;
  const layers = EMBLEMS[pattern]
    .map((l) => `<path d="${l.d}" fill="${emblemColor(l.role, colors)}"/>`)
    .join('');
  const border = opts.border === false ? '' : opts.round ? `<circle cx="50" cy="50" r="46.5" fill="none" stroke="${colors.secondary}" stroke-width="3"/>` : `<rect x="3" y="3" width="94" height="94" rx="4" fill="none" stroke="${colors.secondary}" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${clip}</defs>${field}<g clip-path="url(#c)">${layers}</g>${border}</svg>`;
}

/** Full banner (cloth shape + border + emblem) as an SVG string, 100 x 150. */
export function bannerSvg(pattern: BannerPattern, shape: BannerShape, colors: FactionColors): string {
  const p = BANNER_EMBLEM_PLACEMENT[shape];
  const s = p.scale;
  const layers = EMBLEMS[pattern]
    .map((l) => `<path d="${l.d}" fill="${emblemColor(l.role, colors)}"/>`)
    .join('');
  const fringe =
    shape === 'fringed'
      ? Array.from({ length: 12 }, (_, i) => `<rect x="${n1(2 + i * 8.3)}" y="128" width="4" height="${i % 2 ? 18 : 22}" rx="2" fill="${colors.accent}"/>`).join('')
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><defs><clipPath id="b"><path d="${BANNER_SHAPES[shape]}"/></clipPath></defs>` +
    `${fringe}<path d="${BANNER_SHAPES[shape]}" fill="${colors.primary}"/>` +
    `<g clip-path="url(#b)"><path d="${BANNER_SHAPES[shape]}" fill="none" stroke="${colors.secondary}" stroke-width="${BANNER_BORDER * 200}"/>` +
    `<g transform="translate(${n1(p.x - 50 * s)} ${n1(p.y - 50 * s)}) scale(${s})">${layers}</g></g></svg>`
  );
}

/** Single-color emblem silhouette (all charges merged) for masks: minimap, chips, colorblind shape coding. */
export function emblemMaskPath(pattern: BannerPattern): string {
  return EMBLEMS[pattern]
    .filter((l) => l.role !== 'field')
    .map((l) => l.d)
    .join('');
}

// ----------------------------------------------------------------------------------------- UI icons (24 x 24)

const SPEAR = poly(rotatePts([...rect(11.2, 8.5, 12.8, 23)], 12, 12, 40)) + poly(rotatePts([[12, 0.8], [14.6, 5.8], [12, 10], [9.4, 5.8]], 12, 12, 40));

/**
 * Single-color icons (nonzero fill) used as CSS masks so they take any color. Ids match
 * RESOURCE_DISPLAY.icon, TACTIC_INFO.icon, STAT_CATEGORIES.icon and the nine unit classes.
 */
export const ICON_PATHS: Readonly<Record<string, string>> = {
  // resources
  sheaf:
    poly(rect(11.2, 9, 12.8, 22.5)) +
    poly(rotatePts(rect(11.2, 9, 12.8, 22.5), 12, 15, -16)) +
    poly(rotatePts(rect(11.2, 9, 12.8, 22.5), 12, 15, 16)) +
    ellipse(12, 5.6, 2.1, 4.4) +
    ellipse(7.3, 7.2, 1.9, 4, -22) +
    ellipse(16.7, 7.2, 1.9, 4, 22) +
    poly(rect(8, 14.2, 16, 16.4)),
  logs: ring(6.8, 17, 4.6, 1.6) + ring(17.2, 17, 4.6, 1.6) + ring(12, 8.4, 4.6, 1.6),
  block: poly([[12, 2.5], [21.5, 7.2], [12, 12], [2.5, 7.2]]) + poly([[2.5, 8.8], [11.2, 13.3], [11.2, 22.5], [2.5, 18]]) + poly([[21.5, 8.8], [12.8, 13.3], [12.8, 22.5], [21.5, 18]]),
  coins: ellipse(12, 18.5, 8.5, 2.6) + ellipse(12, 15, 8.5, 2.6) + ring(12, 8.5, 7.6, 5.8) + rays(12, 8.5, 8, 1.6, 4.4, 14) + circle(12, 8.5, 1.4),
  villager:
    circle(12, 7.4, 2.6) +
    poly([[7.2, 1.6], [16.8, 1.6], [15.8, 4.2], [8.2, 4.2]]) +
    poly([[8.4, 10.6], [15.6, 10.6], [17, 16.8], [15, 16.8], [15, 22.6], [12.9, 22.6], [12, 17.4], [11.1, 22.6], [9, 22.6], [9, 16.8], [7, 16.8]]) +
    poly([[8.4, 10.6], [9.8, 11.4], [8.8, 4], [7.4, 4.2]]) +
    poly([[15.6, 10.6], [14.2, 11.4], [15.2, 4], [16.6, 4.2]]),
  spear: SPEAR,
  // tactics / stats
  wheel: ring(12, 12, 10.5, 8.4) + circle(12, 12, 2.4) + spokes(12, 12, 8, 2, 8.6, 1.5),
  sword:
    poly(rotatePts([[12, 1.2], [13.5, 3.8], [13.5, 14.8], [10.5, 14.8], [10.5, 3.8]], 12, 12, 35)) +
    poly(rotatePts(rect(7.2, 14.8, 16.8, 16.8), 12, 12, 35)) +
    poly(rotatePts(rect(11, 16.8, 13, 20.6), 12, 12, 35)) +
    poly(rotatePts([[10.6, 20.6], [13.4, 20.6], [13.4, 22.6], [10.6, 22.6]], 12, 12, 35)),
  lotus:
    ellipse(12, 10.2, 2.7, 7.4) +
    ellipse(7.6, 12.6, 2.4, 6.2, -34) +
    ellipse(16.4, 12.6, 2.4, 6.2, 34) +
    ellipse(4.6, 16, 1.9, 4.6, -66) +
    ellipse(19.4, 16, 1.9, 4.6, 66) +
    ellipse(12, 19.6, 7.6, 1.8),
  eye: 'M1.5 12Q12 1.5 22.5 12Q12 22.5 1.5 12ZM4.6 12Q12 18.6 19.4 12Q12 5.4 4.6 12Z' + circle(12, 12, 3.6),
  crown: poly([[3, 17.5], [3, 7.5], [7.6, 11.8], [12, 4], [16.4, 11.8], [21, 7.5], [21, 17.5]]) + poly(rect(3, 18.8, 21, 21.4)) + circle(12, 2.8, 1.4) + circle(3, 6.2, 1.2) + circle(21, 6.2, 1.2),
  scroll:
    poly(rect(6.5, 5, 17.5, 19)) +
    ellipse(12, 4.4, 7.4, 2) +
    ellipse(12, 19.6, 7.4, 2) +
    poly(rect(8.5, 8.2, 15.5, 9.6), true) +
    poly(rect(8.5, 11.2, 15.5, 12.6), true) +
    poly(rect(8.5, 14.2, 13.5, 15.6), true),
  // unit classes (formation cards, command card)
  unit_spearmen: SPEAR + ellipse(7, 14, 4.4, 8.8) + circle(7, 14, 1.7, true),
  unit_archers: 'M8.4 1.4Q22.4 12 8.4 22.6L7 21.5Q19.5 12 7 2.5Z' + poly(rect(7.6, 1.9, 8.8, 22.1)) + poly(rect(3, 11.3, 18.5, 12.7)) + poly([[18, 9.4], [22.4, 12], [18, 14.6]]),
  unit_elite_guards: ring(12, 12, 10, 8.2) + circle(12, 12, 3) + spokes(12, 12, 12, 4.4, 7.4, 1.1, 15),
  unit_cavalry:
    poly([[6.5, 22.5], [7.5, 15], [5.2, 12.2], [8.6, 5.8], [12.2, 2.2], [13.4, 4.8], [16.4, 6.4], [21.6, 11.4], [20.2, 13.8], [17.4, 12.6], [14.6, 11.8], [15, 15.2], [17.4, 22.5]]),
  unit_chariots: ring(8.5, 15.5, 6.8, 5.2) + circle(8.5, 15.5, 1.5) + spokes(8.5, 15.5, 6, 1.2, 5.6, 1) + poly([[8.5, 7.5], [20, 7.5], [20, 13.6], [15.6, 13.6], [14.2, 9.6], [8.5, 9.6]]) + poly(rect(19, 13, 23, 14.4)),
  unit_war_elephants:
    'M3 13.5Q3 5 11.5 4Q19 3.6 20.6 10Q21.6 13.8 20.4 18.6Q20 21.6 22.2 21.4L22.4 23Q18.2 23.6 18.4 19Q18.6 15.2 16.8 14.2L16.2 21.5H12.6L12.4 16.4H8.4L8 21.5H4.4L4.6 16.6Q3 15.2 3 13.5Z' +
    ellipse(13.6, 9.6, 2.6, 3.6, -10, 20, true),
  unit_engineers: poly(rotatePts(rect(11.1, 8, 12.9, 23), 12, 12, -38)) + poly(rotatePts([[6.2, 2.6], [17.8, 2.6], [17.8, 4.6], [16, 8.6], [8, 8.6], [6.2, 4.6]], 12, 12, -38)),
  unit_scouts: poly(rect(5, 2, 6.8, 23)) + poly([[6.8, 2.5], [20.5, 6.2], [6.8, 10.5]]) + poly([[6.8, 10.5], [15.5, 12.4], [6.8, 14.6]]),
  unit_supply_train: ring(7.5, 18, 4.4, 3) + circle(7.5, 18, 1.1) + ring(17, 18, 4.4, 3) + circle(17, 18, 1.1) + poly([[2.5, 11], [21.5, 11], [21.5, 14.4], [2.5, 14.4]]) + ellipse(7.5, 8, 3.6, 3) + ellipse(14.4, 8.2, 3.4, 2.8),
};

/** Single-color icon as an SVG string (for CSS mask data URIs). */
export function iconSvg(id: string, color = '#000'): string {
  const d = ICON_PATHS[id] ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="${d}"/></svg>`;
}

/** Encode an SVG string for a CSS url("data:...") token. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${svg.replace(/"/g, "'").replace(/[<>#%{}\n]/g, (c) => encodeURIComponent(c))}`;
}

// ----------------------------------------------------------------------------------------- UI ornaments

const GOLD = '#e9b949';
const GOLD_DIM = '#c99a3b';
const LACQUER = '#15122a';

/**
 * Ornament SVGs for the UI frame language (background images, colored): lotus-medallion panel corner,
 * padma divider, torana arch header, jali lattice tile and parchment grain. Gold = --c-gold.
 */
export const ORNAMENTS: Readonly<Record<'corner' | 'divider' | 'torana' | 'jali' | 'paper' | 'bullet', string>> = {
  corner:
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'>` +
    `<g fill='none' stroke='${GOLD}' stroke-linecap='round'><path stroke-width='1.5' d='M2 38V11Q2 2 11 2H38'/><path stroke-width='1' opacity='.55' d='M6 38V15Q6 6 15 6H38'/></g>` +
    `<path fill='${GOLD}' d='${petals(11, 11, 8, 1.4, 6.6, 3, 22.5)}'/><path fill='${LACQUER}' d='${circle(11, 11, 1.9)}'/><path fill='${GOLD}' d='${circle(11, 11, 0.9)}'/>` +
    `<path fill='${GOLD}' d='${circle(2, 19, 1.25) + circle(2, 25, 1.05) + circle(2, 30.5, 0.85) + circle(19, 2, 1.25) + circle(25, 2, 1.05) + circle(30.5, 2, 0.85)}'/></svg>`,
  divider:
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 16'><defs><linearGradient id='l' x1='0' x2='1'><stop offset='0' stop-color='${GOLD_DIM}' stop-opacity='0'/><stop offset='1' stop-color='${GOLD_DIM}'/></linearGradient>` +
    `<linearGradient id='r' x1='1' x2='0'><stop offset='0' stop-color='${GOLD_DIM}' stop-opacity='0'/><stop offset='1' stop-color='${GOLD_DIM}'/></linearGradient></defs>` +
    `<path stroke='url(#l)' stroke-width='1.2' d='M0 9H100'/><path stroke='url(#r)' stroke-width='1.2' d='M140 9H240'/>` +
    `<path fill='${GOLD}' d='${ellipse(120, 6.4, 2.4, 5.6) + ellipse(115.4, 8.6, 2, 4.6, -48) + ellipse(124.6, 8.6, 2, 4.6, 48) + ellipse(111.6, 10.6, 1.5, 3.4, -78) + ellipse(128.4, 10.6, 1.5, 3.4, 78) + ellipse(120, 13.4, 9.5, 1.3)}'/>` +
    `<path fill='${GOLD}' d='${circle(104, 9, 1.6) + circle(98.5, 9, 1.2) + circle(94, 9, 0.9) + circle(136, 9, 1.6) + circle(141.5, 9, 1.2) + circle(146, 9, 0.9)}'/></svg>`,
  torana:
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 260 38'><g fill='none' stroke='${GOLD}' stroke-linecap='round'>` +
    `<path stroke-width='3' d='M34 13Q130 3 226 13'/><path stroke-width='2.2' d='M42 24Q130 16 218 24'/>` +
    `<path stroke-width='2.4' d='M52 12V36M208 12V36'/><path stroke-width='1.6' d='M92 8V20M130 6V18M168 8V20'/></g>` +
    `<path fill='${GOLD}' d='${ring(30, 14, 5.2, 2.6) + ring(230, 14, 5.2, 2.6) + ring(39, 25, 3.8, 1.8) + ring(221, 25, 3.8, 1.8)}'/>` +
    `<path fill='${GOLD}' d='${petals(130, 3.6, 6, 0.6, 3.2, 1.8) + circle(52, 9.5, 2.3) + circle(208, 9.5, 2.3)}'/></svg>`,
  jali:
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><g fill='none' stroke='${GOLD}' stroke-opacity='.07' stroke-width='1'>` +
    `<circle cx='16' cy='16' r='11.3'/><circle cx='0' cy='0' r='11.3'/><circle cx='32' cy='0' r='11.3'/><circle cx='0' cy='32' r='11.3'/><circle cx='32' cy='32' r='11.3'/></g>` +
    `<circle cx='16' cy='16' r='1.2' fill='${GOLD}' fill-opacity='.09'/></svg>`,
  paper:
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 .33 0 0 0 0 .22 0 0 0 0 .1 0 0 0 .13 0'/></filter><rect width='180' height='180' filter='url(#n)'/></svg>`,
  bullet: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='${GOLD}' d='${petals(8, 8, 4, 0.8, 6.5, 3.6, 45)}'/></svg>`,
};

/**
 * The generated CSS custom properties for src/ui/theme.css (between the "@generated icons" markers):
 * --icon-<id> and --emblem-<pattern> single-color masks, --ornament-* frame art. Regenerate with
 * docs/art/tools/gen-theme-icons.ts.
 */
export function themeIconTokens(): string {
  const lines: string[] = [];
  for (const [k, svg] of Object.entries(ORNAMENTS)) lines.push(`  --ornament-${k}: url("${svgDataUri(svg)}");`);
  for (const id of Object.keys(ICON_PATHS)) lines.push(`  --icon-${id.replace(/_/g, '-')}: url("${svgDataUri(iconSvg(id, '#000'))}");`);
  for (const p of Object.keys(EMBLEMS) as BannerPattern[]) {
    if (p === 'solid') continue;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path fill='#000' d='${emblemMaskPath(p)}'/></svg>`;
    lines.push(`  --emblem-${p}: url("${svgDataUri(svg)}");`);
  }
  return lines.join('\n');
}
