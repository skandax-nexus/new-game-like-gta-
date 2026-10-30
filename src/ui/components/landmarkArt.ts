/**
 * Landmark illustration bands for the age panel's carved cards (Art Director review UI-02 round 1, item 5): an ink
 * silhouette of each landmark against a golden-hour sky band, 120 x 72 viewBox, drawn as inline SVG (no image
 * asset). Interim art: the final is a golden-hour thumbnail of the landmark model ('image' asset from the content
 * pipeline, requested from Technical Art); `landmarkArt` keeps the same 5:3 band so the swap is a one-liner.
 * Every landmark of src/data/ages.ts has its own silhouette; unknown ids get the generic pillar hall.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { svg } from '../dom';

type Shape = readonly [kind: 'p' | 'c' | 'r', ...values: (string | number)[]];

const W = 120;
const H = 72;
const GROUND = 60;

/** Helpers that return path data in the 120 x 72 band (y down, ground at 60). */
const rect = (x: number, y: number, w: number, h: number): string => `M${x} ${y}h${w}v${h}h${-w}Z`;
const tri = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): string => `M${x0} ${y0}L${x1} ${y1}L${x2} ${y2}Z`;
const disc = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
const repeat = (n: number, fn: (i: number) => string): string => Array.from({ length: n }, (_, i) => fn(i)).join('');

/** Stambha: plinth, tapering shaft, lotus bell, abacus, crowning lion / wheel. */
function stambha(cx: number, top: number, scale = 1): string {
  const s = scale;
  const base = GROUND;
  return [
    rect(cx - 6 * s, base - 3 * s, 12 * s, 3 * s),
    `M${cx - 2.6 * s} ${base - 3 * s}L${cx - 1.8 * s} ${top + 12 * s}L${cx + 1.8 * s} ${top + 12 * s}L${cx + 2.6 * s} ${base - 3 * s}Z`,
    `M${cx - 2 * s} ${top + 12 * s}C${cx - 5 * s} ${top + 11 * s} ${cx - 5 * s} ${top + 7 * s} ${cx - 3 * s} ${top + 6 * s}L${cx + 3 * s} ${top + 6 * s}C${cx + 5 * s} ${top + 7 * s} ${cx + 5 * s} ${top + 11 * s} ${cx + 2 * s} ${top + 12 * s}Z`,
    rect(cx - 3.6 * s, top + 4.4 * s, 7.2 * s, 1.8 * s),
    // Seated lion: haunch, chest, head and mane.
    `M${cx - 3 * s} ${top + 4.4 * s}L${cx - 2.6 * s} ${top + 1.2 * s}C${cx - 1.2 * s} ${top - 0.4 * s} ${cx + 0.6 * s} ${top - 1.8 * s} ${cx + 1.4 * s} ${top - 2.4 * s}C${cx + 2.8 * s} ${top - 2.2 * s} ${cx + 3.2 * s} ${top - 0.8 * s} ${cx + 2.6 * s} ${top + 0.4 * s}L${cx + 3 * s} ${top + 4.4 * s}Z`,
  ].join('');
}

const SHAPES: Readonly<Record<string, readonly Shape[]>> = {
  // Hall of a Hundred Pillars: stepped plinth, colonnade, flat roof with a parapet and a finial.
  lm_hundred_pillars: [
    ['p', rect(18, 55, 84, 5) + rect(22, 51, 76, 4)],
    ['p', repeat(9, (i) => rect(25 + i * 8.6, 32, 3, 19))],
    ['p', rect(20, 27, 80, 5) + rect(24, 23, 72, 4) + repeat(10, (i) => rect(25 + i * 7.4, 19, 3, 4))],
    ['p', tri(56, 19, 60, 9, 64, 19) + disc(60, 8, 1.8)],
  ],
  // The Royal Granary: barrel-vaulted store on a plinth, ramp and gate, sheaves.
  lm_royal_granary: [
    ['p', rect(22, 54, 76, 6)],
    ['p', 'M28 54V36C28 22 92 22 92 36V54Z'],
    ['c', 'gate', rect(54, 40, 12, 14)],
    ['p', repeat(3, (i) => `M${10 + i * 5} 60L${12 + i * 5} 46L${14 + i * 5} 60Z`) + repeat(3, (i) => `M${96 + i * 5} 60L${98 + i * 5} 47L${100 + i * 5} 60Z`)],
    ['p', rect(58, 18, 4, 6) + disc(60, 17, 2.5)],
  ],
  // Pillars of the Spoken Law: three edict pillars of rising height.
  lm_edict_pillars: [['p', stambha(32, 26, 0.85) + stambha(60, 10, 1.15) + stambha(88, 26, 0.85)]],
  // The Great Road: a road running to the horizon through a torana, a milestone at the roadside.
  lm_great_road: [
    ['r', 'M30 60L57 34H63L90 60Z'],
    ['c', 'dash', 'M59.6 36H60.4L60.6 39H59.4ZM59.2 42H60.8L61.1 46H58.9ZM58.7 49H61.3L61.7 54H58.3Z'],
    ['p', 'M30 60L57 34L56 34L28 60ZM90 60L63 34L64 34L92 60Z'],
    ['p', rect(46, 22, 3, 26) + rect(71, 22, 3, 26) + rect(42, 22, 36, 2.6) + rect(43, 27, 34, 2.2) + rect(44, 31.6, 32, 2)],
    ['p', 'M41 22.3C41 19.5 44 19 44 22.3ZM76 22.3C76 19 79 19.5 79 22.3Z'],
    ['p', 'M93 60V47C93 43 99 43 99 47V60Z' + rect(91, 58, 10, 2)],
    ['p', repeat(4, (i) => disc(14 + i * 7, 52 - (i % 2) * 2, 4.5)) + rect(20, 54, 2, 6)],
  ],
  // The Oath Stone: a tall standing stone ringed by smaller menhirs.
  lm_oath_stone: [['p', 'M54 60L52 30C53 22 64 20 66 28L68 60Z' + 'M34 60L35 46C36 42 41 42 42 46L43 60Z' + 'M77 60L78 44C79 40 84 40 85 44L86 60Z' + 'M22 60L24 51C25 49 28 49 29 51L30 60Z' + 'M90 60L92 50C93 48 96 48 97 50L98 60Z']],
  // The Cliff Cistern: a cliff face with a stepped tank cut at its foot.
  lm_cliff_cistern: [
    ['p', 'M0 60V22L14 18L22 24L30 14L42 20V60Z'],
    ['p', 'M44 60V50H96V60Z'],
    ['c', 'water', rect(54, 52, 32, 6)],
    ['p', repeat(4, (i) => rect(44 + i * 3, 52 + i * 2, 3, 8 - i * 2)) + repeat(4, (i) => rect(93 - i * 3, 52 + i * 2, 3, 8 - i * 2))],
  ],
  // The Thousand Steps: a stair climbing a hill to a hilltop shrine.
  lm_thousand_steps: [
    ['p', 'M6 60C30 52 40 30 60 24C80 30 92 50 114 60Z'],
    ['c', 'steps', repeat(9, (i) => rect(50 - i * 1.2, 30 + i * 3.4, 20 + i * 2.4, 1.2))],
    ['p', 'M54 24L60 10L66 24Z' + rect(55, 23, 10, 3) + disc(60, 9, 1.6)],
  ],
  // The Cave Assembly: a rock face with a horseshoe chaitya arch and pillared veranda.
  lm_cave_assembly: [
    ['p', 'M4 60V20C20 12 40 10 60 10C80 10 100 12 116 20V60Z'],
    ['c', 'arch', 'M44 50V34C44 20 76 20 76 34V50Z' + repeat(4, (i) => rect(36 + i * 14.5, 50, 3, 10))],
    ['p', 'M52 50V36C52 28 68 28 68 36V50Z'],
  ],
  // The Elephant Grove: a war elephant beneath two spreading trees.
  lm_elephant_grove: [
    ['p', disc(22, 26, 12) + disc(34, 22, 10) + rect(26, 30, 3, 30) + disc(92, 24, 13) + disc(104, 28, 9) + rect(95, 30, 3, 30)],
    ['p', 'M42 60V46C42 36 50 32 60 32C70 32 76 36 78 42C82 44 84 50 82 58H79C80 52 79 48 76 47V60H71V52H50V60H45Z' + 'M78 42C79 36 76 33 72 34L73 39Z'],
  ],
  // The Canopy Watch: a great tree with a lookout platform and ladder.
  lm_canopy_watch: [
    ['p', disc(60, 22, 18) + disc(44, 30, 12) + disc(76, 30, 12) + rect(57, 32, 6, 28)],
    ['c', 'deck', rect(44, 36, 32, 3) + rect(46, 39, 2, 6) + rect(72, 39, 2, 6)],
    ['p', rect(66, 39, 1.2, 21) + rect(70, 39, 1.2, 21) + repeat(6, (i) => rect(66, 42 + i * 3, 5.2, 0.9))],
  ],
  // The Salt Caravanserai: a walled courtyard with a tall arched gate and a loaded camel.
  lm_salt_caravanserai: [
    ['p', rect(18, 34, 64, 26) + repeat(8, (i) => rect(18 + i * 8.6, 30, 4, 4))],
    ['p', rect(38, 22, 24, 38)],
    ['c', 'gate', 'M44 60V40C44 32 56 32 56 40V60Z'],
    ['p', 'M88 60L89 50L86 46C86 40 90 38 94 40C96 36 101 36 102 40L106 38L110 40L107 46L106 50L107 60H104L103 51H93L92 60Z'],
  ],
  // The Beacon Line: three hill towers with fires at their tops.
  lm_beacon_line: [
    ['p', 'M0 60C16 52 22 48 30 48C42 48 50 56 60 56C72 56 80 44 92 44C102 44 110 50 120 54V60Z'],
    ['p', rect(26, 30, 6, 18) + rect(24, 28, 10, 3) + rect(88, 24, 6, 20) + rect(86, 22, 10, 3) + rect(57, 40, 5, 16) + rect(55, 38, 9, 3)],
    ['c', 'fire', 'M29 28C26 24 29 20 29 17C32 21 33 24 29 28ZM91 22C88 18 91 14 91 11C94 15 95 18 91 22ZM59.5 38C57 35 59.5 32 59.5 30C62 33 63 35 59.5 38Z'],
  ],
  // The Lamp Tower: a tiered deepa stambha with lamp brackets.
  lm_lamp_tower: [
    ['p', rect(48, 56, 24, 4) + 'M54 56L56 14H64L66 56Z' + repeat(7, (i) => rect(50 - (i % 2), 50 - i * 5.6, 20 + (i % 2) * 2, 1.6)) + tri(55, 14, 60, 4, 65, 14)],
    ['c', 'fire', repeat(7, (i) => disc(49 - (i % 2), 48.6 - i * 5.6, 1.1) + disc(71 + (i % 2), 48.6 - i * 5.6, 1.1)) + disc(60, 3, 1.4)],
  ],
  // The Guild Hall: a gabled hall with a pillared porch and guild banners.
  lm_guild_hall: [
    ['p', rect(24, 38, 72, 22) + 'M20 38L60 18L100 38Z' + rect(56, 14, 8, 6)],
    ['c', 'gate', repeat(5, (i) => rect(32 + i * 13.2, 42, 4, 18))],
    ['p', rect(14, 26, 1.4, 34) + 'M15.4 26H24L21 30L24 34H15.4Z' + rect(104, 26, 1.4, 34) + 'M105.4 26H114L111 30L114 34H105.4Z'],
  ],
  // The Coin House: a mint with a great punch-marked coin above its door.
  lm_coin_house: [
    ['p', rect(26, 34, 68, 26) + rect(22, 30, 76, 5)],
    ['p', disc(60, 18, 11)],
    ['c', 'coin', disc(60, 18, 7.5)],
    ['p', 'M56 22L60 13L64 22ZM55 15h10v1.6H55Z' + rect(52, 44, 16, 16)],
  ],
  // The Arsenal: a fortified store with crenellations, crossed spears and a shield.
  lm_arsenal: [
    ['p', rect(22, 32, 76, 28) + repeat(10, (i) => rect(22 + i * 7.9, 27, 4.4, 5)) + rect(16, 24, 10, 36) + rect(94, 24, 10, 36)],
    ['c', 'gate', 'M52 60V46C52 40 68 40 68 46V60Z'],
    ['p', 'M40 6L42 6L80 50L78 52ZM78 6L80 8L42 52L40 50Z' + tri(38, 4, 44, 4, 41, 0) + tri(76, 4, 82, 4, 79, 0) + disc(60, 22, 6)],
  ],
};

/** Ink silhouette band of a landmark (`aria-hidden`; the card's title names it). */
export function landmarkArt(landmarkId: string): SVGSVGElement {
  const shapes = SHAPES[landmarkId] ?? SHAPES.lm_hundred_pillars!;
  const gid = `lmsky-${landmarkId}`;
  const sky = svg(
    'linearGradient',
    { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' },
    svg('stop', { offset: '0', 'stop-color': '#f6c66a' }),
    svg('stop', { offset: '0.62', 'stop-color': '#e9a04a' }),
    svg('stop', { offset: '1', 'stop-color': '#b86a33' }),
  );
  const parts: SVGElement[] = [
    svg('defs', null, sky),
    svg('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${gid})` }),
    // Low sun behind the subject, then the ground.
    svg('circle', { cx: 92, cy: 40, r: 13, fill: '#fde3a2', opacity: '0.85' }),
    svg('rect', { x: 0, y: GROUND, width: W, height: H - GROUND, class: 'lm-ground' }),
  ];
  for (const sh of shapes) {
    const [kind, ...v] = sh;
    if (kind === 'p') parts.push(svg('path', { d: String(v[0]), class: 'lm-ink' }));
    else if (kind === 'r') parts.push(svg('path', { d: String(v[0]), class: 'lm-road' }));
    else parts.push(svg('path', { d: String(v[1]), class: `lm-cut lm-${String(v[0])}` }));
  }
  return svg('svg', { class: 'lm-art', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true', focusable: 'false' }, ...parts);
}

/** Landmark ids with a dedicated silhouette (tests: every LANDMARKS entry is covered). */
export const LANDMARK_ART_IDS: readonly string[] = Object.keys(SHAPES);
