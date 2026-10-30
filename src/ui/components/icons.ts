/**
 * HUD icon set: single-colour 24 x 24 SVG masks that take currentColor (ART_BIBLE §11.4: flat, bold, readable at
 * 16 px). OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 *
 * The 21 theme icons (resources, tactics, stats, unit classes) come from theme.css (`.icon-<id>`, generated from
 * render/style/emblems.ts ICON_PATHS). This module adds the command-card vocabulary the theme does not have yet:
 * the 21 buildings, battle orders / shapes / intents, army orders, realm buttons, seasons, weather and HUD glyphs.
 * They render through the same `.icon` skin (mask + currentColor) with an inline `--icon` data URI, so colours stay
 * theme tokens. (Request to the Art Director: adopt these paths into ICON_PATHS / theme tokens.)
 *
 *   icon('granary')           -> <i class="icon" style="--icon:url(...)">  (or `.icon-<id>` for theme ids)
 *   ICON_IDS                  -> every id this module can draw (tests check the command cards only use these)
 */
import { h } from '../dom';

// ---------------------------------------------------------------------------------------------------
// Path helpers (24 x 24, y down). Holes use the opposite winding (nonzero fill).
// ---------------------------------------------------------------------------------------------------

const f = (n: number): string => String(Math.round(n * 100) / 100);
type Pt = readonly [number, number];

/** Rectangle, clockwise. */
function R(x0: number, y0: number, x1: number, y1: number): string {
  return `M${f(x0)} ${f(y0)}H${f(x1)}V${f(y1)}H${f(x0)}Z`;
}
/** Rectangle hole (counter-clockwise). */
function Rh(x0: number, y0: number, x1: number, y1: number): string {
  return `M${f(x0)} ${f(y0)}V${f(y1)}H${f(x1)}V${f(y0)}Z`;
}
/** Circle, clockwise. */
function C(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}Z`;
}
/** Circle hole (counter-clockwise). */
function Ch(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
}
function ring(cx: number, cy: number, r0: number, r1: number): string {
  return C(cx, cy, r0) + Ch(cx, cy, r1);
}
/** Polygon in the given order (give clockwise points for fills). */
function P(...pts: Pt[]): string {
  return `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z`;
}
/** Thick segment as a quad. */
function L(x0: number, y0: number, x1: number, y1: number, w: number): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  return P([x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]);
}
/** Arrow head pointing from (x0,y0) toward (x1,y1), tip at (x1,y1). */
function head(x0: number, y0: number, x1: number, y1: number, len: number, half: number): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const bx = x1 - ux * len;
  const by = y1 - uy * len;
  return P([x1, y1], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]);
}
function arrow(x0: number, y0: number, x1: number, y1: number, w = 2.6, hl = 6, hw = 4.6): string {
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  const sx = x1 - ((x1 - x0) / l) * (hl - 0.5);
  const sy = y1 - ((y1 - y0) / l) * (hl - 0.5);
  return L(x0, y0, sx, sy, w) + head(x0, y0, x1, y1, hl, hw);
}
/** Arc band (thick arc) from angle a0 to a1 (radians, 0 = +x, clockwise on screen). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, w: number): string {
  const ro = r + w / 2;
  const ri = r - w / 2;
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const p = (rr: number, a: number): string => `${f(cx + rr * Math.cos(a))} ${f(cy + rr * Math.sin(a))}`;
  return `M${p(ro, a0)}A${f(ro)} ${f(ro)} 0 ${large} 1 ${p(ro, a1)}L${p(ri, a1)}A${f(ri)} ${f(ri)} 0 ${large} 0 ${p(ri, a0)}Z`;
}
function dots(pts: readonly Pt[], r: number): string {
  return pts.map((p) => C(p[0], p[1], r)).join('');
}

// ---------------------------------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------------------------------

const SHIELD = 'M12 2.5L20 5.5V11.5Q20 18 12 21.5Q4 18 4 11.5V5.5Z';
const SWORD: string[] = [L(6, 18, 17.5, 6.5, 2.4), P([17.5, 6.5], [20.5, 3.5], [19.2, 7.6]), L(5, 14.5, 9.5, 19, 2), L(3.6, 20.4, 6.4, 17.6, 2.4)];
const HUT = (x: number, y: number, s: number): string => P([x, y - 5 * s], [x + 5.5 * s, y], [x + 4 * s, y], [x + 4 * s, y + 4.5 * s], [x - 4 * s, y + 4.5 * s], [x - 4 * s, y], [x - 5.5 * s, y]);
const WAVES = (y: number, x0 = 3, x1 = 21): string[] => {
  const d: string[] = [];
  for (let x = x0; x < x1 - 0.1; x += 6) d.push(arc(x + 1.5, y + 2, 2.2, Math.PI * 1.15, Math.PI * 1.85, 1.6), arc(x + 4.5, y - 1.2, 2.2, Math.PI * 0.15, Math.PI * 0.85, 1.6));
  return d;
};
const DOME = (cx: number, base: number, r: number): string => `M${f(cx - r)} ${f(base)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + r)} ${f(base)}Z`;
const CLOUD_HI = 'M6 12.5Q2 12.5 2 9.2Q2 5.8 6 5.6Q6.6 1.4 11.6 1.4Q16 1.4 17.4 5Q22 5 22 8.8Q22 12.5 17.6 12.5Z';
const CART: string[] = [ring(7, 18, 3.4, 1.6), ring(17, 18, 3.4, 1.6), R(2.5, 11, 21.5, 14.5)];
const LADDER: string[] = [L(3, 21.5, 11, 3, 1.6), L(8, 21.5, 15, 5, 1.6), L(4.4, 16.5, 9, 17.6, 1.3), L(6.2, 11.5, 11, 12.6, 1.3), L(7.8, 7, 12.4, 8.1, 1.3)];
const rays = (n: number, r0: number, r1: number, w: number): string[] => Array.from({ length: n }, (_, i) => L(12 + Math.cos((i * 2 * Math.PI) / n) * r0, 12 + Math.sin((i * 2 * Math.PI) / n) * r0, 12 + Math.cos((i * 2 * Math.PI) / n) * r1, 12 + Math.sin((i * 2 * Math.PI) / n) * r1, w));
const petal = (i: number, n: number): string => {
  const a = (i * 2 * Math.PI) / n - Math.PI / 2;
  const pt = (aa: number, r: number): string => `${f(12 + Math.cos(aa) * r)} ${f(12 + Math.sin(aa) * r)}`;
  return `M12 12Q${pt(a - 0.5, 7)} ${pt(a, 9.8)}Q${pt(a + 0.5, 7)} 12 12Z`;
};
const drop = (x: number, y: number, s: number): string => `M${f(x)} ${f(y)}Q${f(x + 1.6 * s)} ${f(y + 2.6 * s)} ${f(x + 1.6 * s)} ${f(y + 4 * s)}A${f(1.6 * s)} ${f(1.6 * s)} 0 0 1 ${f(x - 1.6 * s)} ${f(y + 4 * s)}Q${f(x - 1.6 * s)} ${f(y + 2.6 * s)} ${f(x)} ${f(y)}Z`;

/** Each icon is a list of independently filled paths (holes live inside one entry with opposite winding). */
export const ICON_PATHS_HUD: Readonly<Record<string, readonly string[]>> = {
  // --- HUD glyphs -------------------------------------------------------------------------------
  pause: [R(6, 4.5, 10, 19.5), R(14, 4.5, 18, 19.5)],
  play: [P([7.5, 4.5], [19.5, 12], [7.5, 19.5])],
  menu: [R(4, 5.5, 20, 8), R(4, 10.75, 20, 13.25), R(4, 16, 20, 18.5)],
  close: [L(5.5, 5.5, 18.5, 18.5, 2.8), L(18.5, 5.5, 5.5, 18.5, 2.8)],
  chevron_down: [P([4.5, 8.5], [12, 15.5], [19.5, 8.5], [19.5, 11.5], [12, 18.5], [4.5, 11.5])],
  chevron_up: [P([4.5, 15.5], [4.5, 12.5], [12, 5.5], [19.5, 12.5], [19.5, 15.5], [12, 8.5])],
  chevron_right: [P([8.5, 4.5], [15.5, 12], [8.5, 19.5], [11.5, 19.5], [18.5, 12], [11.5, 4.5])],
  check: [P([3.5, 12.5], [6, 10], [10, 14], [18, 5.5], [20.5, 8], [10, 19])],
  cross: [L(6, 6, 18, 18, 3), L(18, 6, 6, 18, 3)],
  plus: [R(10.6, 4, 13.4, 20), R(4, 10.6, 20, 13.4)],
  minus: [R(4, 10.6, 20, 13.4)],
  star: [P([12, 2.5], [14.6, 9], [21.5, 9.3], [16.1, 13.6], [18, 20.5], [12, 16.6], [6, 20.5], [7.9, 13.6], [2.5, 9.3], [9.4, 9])],
  alert: [P([12, 2.5], [22, 20.5], [2, 20.5]) + Rh(10.8, 8.5, 13.2, 15) + Rh(10.8, 16.4, 13.2, 18.6)],
  info: [ring(12, 12, 10, 8), R(10.8, 10.5, 13.2, 17.5), C(12, 7.6, 1.5)],
  rotate: [arc(12, 12.5, 7, Math.PI * 1.05, Math.PI * 2.65, 2.6), P([3.2, 7.6], [8.6, 7.2], [4.6, 12.8])],
  compass: [ring(12, 12, 10.2, 8.6), P([12, 3.8], [15, 12], [12, 10.6], [9, 12]), P([12, 20.2], [9.6, 12.6], [12, 13.6], [14.4, 12.6])],
  target: [ring(12, 12, 8.5, 6.6), R(11, 1.5, 13, 7), R(11, 17, 13, 22.5), R(1.5, 11, 7, 13), R(17, 11, 22.5, 13), C(12, 12, 1.6)],
  flag: [R(5, 2.5, 7, 21.5), P([7, 3.5], [19.5, 3.5], [16, 8], [19.5, 12.5], [7, 12.5])],
  swords: [L(4, 4, 18, 18, 2.4), L(20, 4, 6, 18, 2.4), L(3, 15, 9, 21, 2.2), L(21, 15, 15, 21, 2.2)],
  barrel: ['M7 3.5H17Q18.2 5 18.6 6.6H5.4Q5.8 5 7 3.5Z', 'M5.2 8.4H18.8Q19.6 12 18.8 15.6H5.2Q4.4 12 5.2 8.4Z', 'M5.4 17.4H18.6Q18.2 19 17 20.5H7Q5.8 19 5.4 17.4Z'],
  hourglass: [P([5, 2.5], [19, 2.5], [19, 4.5], [13.4, 12], [19, 19.5], [19, 21.5], [5, 21.5], [5, 19.5], [10.6, 12], [5, 4.5])],
  more: [dots([[5, 12], [12, 12], [19, 12]], 2.4)],
  // --- realm buttons ---------------------------------------------------------------------------
  diplomacy: [ring(8.6, 12, 6.4, 4.4), ring(15.4, 12, 6.4, 4.4)],
  council: [C(6, 8.2, 2.4), C(12, 6.4, 2.6), C(18, 8.2, 2.4), P([2.5, 18], [3.5, 12.2], [8.5, 12.2], [9, 15], [15, 15], [15.5, 12.2], [20.5, 12.2], [21.5, 18], [21.5, 21], [2.5, 21]), P([8.4, 13.6], [9.4, 9.6], [14.6, 9.6], [15.6, 13.6])],
  ages: [ring(12, 6, 4.4, 2.6), R(10.4, 10.6, 13.6, 19), R(7.5, 19, 16.5, 21.5), P([8.5, 10.6], [15.5, 10.6], [14.5, 12.4], [9.5, 12.4])],
  economy: ['M4 8L12 3L20 8Z', R(5, 9.5, 7.8, 17), R(10.6, 9.5, 13.4, 17), R(16.2, 9.5, 19, 17), R(3.5, 18, 20.5, 21)],
  // --- buildings (command card) ----------------------------------------------------------------
  b_farm_fields: [P([2, 20], [8, 9], [10.6, 9], [5.2, 20]), P([7.4, 20], [11, 9], [13, 9], [10.6, 20]), P([13.4, 20], [13, 9], [15, 9], [16.6, 20]), P([18.8, 20], [15.4, 9], [18, 9], [22, 20]), L(12, 8, 12, 3, 1.4), 'M12 5Q8.5 4.5 8 2Q11.5 2.4 12 5Z', 'M12 5.4Q15.5 4.9 16 2.4Q12.5 2.8 12 5.4Z'],
  b_irrigation_canal: [P([2, 20.5], [7, 5], [10, 5], [6.2, 20.5]), P([22, 20.5], [17, 5], [14, 5], [17.8, 20.5]), ...WAVES(12.5, 8, 14), ...WAVES(17.5, 7, 15)],
  b_granary: [DOME(12, 10, 7), R(5, 10, 19, 19.5) + Rh(10, 13, 14, 19.5), R(3.5, 19.5, 20.5, 21.5), R(11.2, 1.8, 12.8, 4)],
  b_water_tank: [P([2, 8], [22, 8], [19, 19], [5, 19]) + Rh(5.2, 10, 18.8, 11), ...WAVES(14.5, 6, 17)],
  b_stepwell: [P([2, 4], [22, 4], [22, 7], [19, 7], [19, 10], [16, 10], [16, 13], [13.5, 13], [13.5, 20.5], [10.5, 20.5], [10.5, 13], [8, 13], [8, 10], [5, 10], [5, 7], [2, 7])],
  b_market: [P([2.5, 9], [5, 3.5], [19, 3.5], [21.5, 9]), R(4, 9, 6, 20), R(18, 9, 20, 20), R(6, 13, 18, 15), C(9, 11.4, 1.4), C(12.5, 11.4, 1.4), C(16, 11.4, 1.4), R(3, 19.5, 21, 21.5)],
  b_workshop: [P([3, 15], [21, 15], [19, 17.5], [16.5, 17.5], [16.5, 21], [7.5, 21], [7.5, 17.5], [5, 17.5]), L(8, 3.5, 15, 11, 2.2), P([14, 7.5], [18.6, 3], [21, 5.4], [16.4, 10])],
  b_barracks: [P([2, 20.5], [12, 4], [22, 20.5], [16, 20.5], [12, 12.5], [8, 20.5]), L(12, 1.5, 12, 4.5, 1.4)],
  b_stables: ['M12 3.5Q20.5 3.5 20.5 12.5V20.5H16.5V12.5Q16.5 7.5 12 7.5Q7.5 7.5 7.5 12.5V20.5H3.5V12.5Q3.5 3.5 12 3.5Z'],
  b_elephant_stables: ['M3 14Q3 6 11.5 5Q19 4.6 20.6 10.5Q21.6 14 20.4 18.6Q20 21.4 22.2 21.2L22.4 22.8Q18.4 23.4 18.4 19Q18.6 15.2 16.8 14.4L16.2 21H12.6L12.4 16.6H8.4L8 21H4.4L4.2 16.6Q3 15.6 3 14Z'],
  b_temple: ['M12 1.5Q13.2 3 13.6 4.5Q17.5 9 17 14H7Q6.5 9 10.4 4.5Q10.8 3 12 1.5Z', R(5, 14, 19, 16), R(6.5, 16, 17.5, 20) + Rh(10.5, 16.5, 13.5, 20), R(3.5, 20, 20.5, 22)],
  b_stupa: [DOME(12, 15, 8), R(10, 4.6, 14, 7.6), R(11.4, 1.5, 12.6, 4.6), R(8.5, 2.8, 15.5, 3.8), R(3, 15, 21, 17), R(2, 18.5, 22, 21.5) + Rh(5, 18.5, 6.6, 21.5) + Rh(17.4, 18.5, 19, 21.5)],
  b_fort_walls: [P([2, 21], [2, 8], [4.5, 8], [4.5, 10.5], [7, 10.5], [7, 8], [9.5, 8], [9.5, 10.5], [14.5, 10.5], [14.5, 8], [17, 8], [17, 10.5], [19.5, 10.5], [19.5, 8], [22, 8], [22, 21]) + 'M9.5 21H14.5V17A2.5 2.5 0 0 0 9.5 17Z'],
  b_watchtower: [P([7, 3], [17, 3], [18.5, 6.5], [15, 6.5], [15.5, 21.5], [8.5, 21.5], [9, 6.5], [5.5, 6.5]) + Rh(10.8, 9, 13.2, 12)],
  b_road_station: [P([2, 9], [12, 3], [22, 9], [20, 10.5], [4, 10.5]), R(5, 10.5, 7, 19), R(17, 10.5, 19, 19), R(11, 10.5, 13, 19), R(2, 19, 22, 21.5)],
  b_harbor: [P([2.5, 13], [21.5, 13], [18, 19.5], [6, 19.5]), R(11.2, 2.5, 12.8, 13), P([12.8, 3.5], [19.5, 11.5], [12.8, 11.5]), ...WAVES(21, 3, 21)],
  b_mine: [P([1.5, 21.5], [7, 13], [10.5, 16.5], [14.5, 10], [22.5, 21.5]), L(5, 5, 15.5, 15.5, 2), 'M2.5 8.5Q8 1.5 15 3.2Q9.5 4.6 5 9.6Z'],
  b_palace: [DOME(6, 9, 3), DOME(12, 7.5, 4), DOME(18, 9, 3), R(3, 9, 9, 11), R(7.5, 7.5, 16.5, 9.5), R(15, 9, 21, 11), R(2.5, 11, 21.5, 21.5) + Rh(10, 15, 14, 21.5) + Rh(4.5, 13.5, 7, 17) + Rh(17, 13.5, 19.5, 17)],
  b_ghat: [P([2, 3], [6, 3], [6, 6], [10, 6], [10, 9], [14, 9], [14, 12], [18, 12], [18, 15], [22, 15], [22, 16.5], [2, 16.5]), ...WAVES(19.5, 3, 21)],
  b_housing: [HUT(7.5, 10, 1), HUT(16.5, 13, 0.85)],
  b_sanitation: [ring(12, 15.5, 6, 4), R(5.5, 14.6, 18.5, 16.4), drop(12, 2.5, 1.6)],
  b_landmark: [R(10.4, 7, 13.6, 19), P([7, 7], [8.5, 4.5], [15.5, 4.5], [17, 7]), C(12, 3, 1.8), R(6, 19, 18, 21.5)],
  // --- battle orders ---------------------------------------------------------------------------
  o_hold: [SHIELD + Rh(10.6, 6.5, 13.4, 16.5)],
  o_advance: [arrow(12, 18, 12, 3), R(4, 18, 20, 21)],
  o_attack: SWORD,
  o_charge: [P([3, 4], [12, 10.5], [21, 4], [21, 8.5], [12, 15], [3, 8.5]), P([3, 11.5], [12, 18], [21, 11.5], [21, 16], [12, 22.5], [3, 16])],
  o_flank: [arc(13, 14, 8, Math.PI * 1.0, Math.PI * 1.75, 2.6), head(14, 7, 21, 6.6, 6, 4.4), R(3, 18, 8, 21)],
  o_defend: [ring(12, 12, 10, 8.2), 'M12 6L17 8V12Q17 16 12 18.5Q7 16 7 12V8Z'],
  o_withdraw: [arrow(12, 6, 12, 21), R(4, 3, 20, 6)],
  o_regroup: [arrow(2.5, 4, 9.5, 11, 2.4, 5, 4), arrow(21.5, 4, 14.5, 11, 2.4, 5, 4), arrow(2.5, 20, 9.5, 13, 2.4, 5, 4), arrow(21.5, 20, 14.5, 13, 2.4, 5, 4)],
  o_run: [arrow(9, 12, 22, 12), R(2, 6, 8, 8), R(4, 11, 8, 13), R(2, 16, 8, 18)],
  o_stance: [R(5, 2.5, 7, 21.5), P([7, 3.5], [19, 6.5], [7, 11]), R(9.5, 14, 19.5, 16), R(9.5, 18, 16, 20)],
  o_rally: ['M3.5 12.5Q4 5.5 12 4.5Q19.5 4 20.5 9.5Q21 13.5 17 14.5L13 19.5Q11 21.5 9.5 19.5L8 17Q4 16 3.5 12.5Z' + Ch(13.5, 9.6, 2.4)],
  o_select_all: [R(2.5, 4, 7, 9), R(9.75, 4, 14.25, 9), R(17, 4, 21.5, 9), R(2.5, 15, 7, 20), R(9.75, 15, 14.25, 20), R(17, 15, 21.5, 20)],
  // --- formation shapes ------------------------------------------------------------------------
  s_line: [dots([[3, 9.5], [7.5, 9.5], [12, 9.5], [16.5, 9.5], [21, 9.5], [3, 14.5], [7.5, 14.5], [12, 14.5], [16.5, 14.5], [21, 14.5]], 1.7)],
  s_column: [dots([[9.5, 3], [14.5, 3], [9.5, 7.5], [14.5, 7.5], [9.5, 12], [14.5, 12], [9.5, 16.5], [14.5, 16.5], [9.5, 21], [14.5, 21]], 1.7)],
  s_square: [dots([[4, 4], [9.33, 4], [14.67, 4], [20, 4], [4, 9.33], [20, 9.33], [4, 14.67], [20, 14.67], [4, 20], [9.33, 20], [14.67, 20], [20, 20]], 1.7)],
  s_wedge: [dots([[12, 3.5], [8.5, 9], [15.5, 9], [5, 14.5], [12, 14.5], [19, 14.5], [1.8, 20], [8.6, 20], [15.4, 20], [22.2, 20]], 1.7)],
  s_loose: [dots([[4, 5], [11, 3.5], [19, 6], [7, 11.5], [15.5, 12], [21, 15], [3.5, 18], [11, 19.5], [17.5, 20.5]], 1.6)],
  s_circle: [dots([[12, 3], [18.4, 5.6], [21, 12], [18.4, 18.4], [12, 21], [5.6, 18.4], [3, 12], [5.6, 5.6]], 1.8)],
  // --- battle intents --------------------------------------------------------------------------
  i_hold_crossing: [...WAVES(6.5, 3, 21), ...WAVES(17.5, 3, 21), R(2.5, 10.4, 21.5, 13.6), R(5, 9, 6.6, 15), R(17.4, 9, 19, 15)],
  i_protect_formation: ['M12 2L19.5 4.8V10Q19.5 15.6 12 18.8Q4.5 15.6 4.5 10V4.8Z' + Ch(12, 9.8, 2.6), R(3, 20, 21, 22)],
  i_hold_high_ground: [P([1.5, 21.5], [9.5, 9], [13, 13.5], [16, 10], [22.5, 21.5]), R(9, 2, 10.5, 10), P([10.5, 2.5], [16, 4.2], [10.5, 6.2])],
  i_pin_enemy: [C(12, 8, 6) + Ch(12, 8, 2.4), P([9.8, 13], [14.2, 13], [12, 22])],
  i_screen_flank: [R(16, 3, 19, 21), dots([[7, 6], [11, 6], [7, 12], [11, 12], [7, 18], [11, 18]], 1.6), head(19, 12, 23, 12, 3.6, 3.4)],
  i_pursue_routers: [arrow(2.5, 12, 15, 12, 2.6, 5, 4.4), P([15.5, 5], [22, 12], [15.5, 19], [17.5, 12])],
  i_scout_area: ['M1.5 12Q12 1.5 22.5 12Q12 22.5 1.5 12ZM4.6 12Q12 18.6 19.4 12Q12 5.4 4.6 12Z' + C(12, 12, 3.6)],
  i_escort_supply: [...CART, 'M12 1.5L16.5 3.2V6.5Q16.5 9.4 12 11Q7.5 9.4 7.5 6.5V3.2Z'],
  i_clear: [ring(12, 12, 9.5, 7.5), L(5.5, 18.5, 18.5, 5.5, 2.2)],
  // --- army orders -----------------------------------------------------------------------------
  a_move: ['M6 2.5Q9.5 2.5 9.5 7Q9.5 10.5 7.5 11.5L4.5 11.5Q3 9 3.5 6Q4 2.5 6 2.5Z', R(4.4, 12.6, 7.8, 14.8), 'M17.5 9Q21 9 20.5 13.5Q20 17 18 18L15 18Q13.5 15.5 14 12.5Q14.6 9 17.5 9Z', R(15, 19.1, 18.4, 21.3)],
  a_attack: SWORD,
  a_besiege: [P([2, 21.5], [2, 9], [4.5, 9], [4.5, 11.5], [7, 11.5], [7, 9], [9.5, 9], [9.5, 21.5]), L(13, 21.5, 20, 4, 1.6), L(17, 21.5, 23, 6.5, 1.6), L(13.8, 17.5, 19, 18.8, 1.3), L(15.4, 13.5, 20.6, 14.8, 1.3), L(17, 9.5, 22, 10.8, 1.3)],
  a_garrison: [P([2.5, 11], [12, 3], [21.5, 11], [19, 11], [19, 21], [5, 21], [5, 11]) + 'M12 10L8 11.5V14.5Q8 17.5 12 19Q16 17.5 16 14.5V11.5Z'],
  a_raid: ['M12 2Q17.5 7.5 16.5 12Q16 14.5 13.5 15.5Q15 12.5 12.5 10Q12 13 9.5 14Q7.5 15 7.5 12.2Q5.5 14 6.5 17Q4 14 5.2 10.4Q6.6 6.2 12 2Z', L(12, 15.5, 12, 22, 2.2)],
  a_forage: [R(11.2, 9, 12.8, 21.5), P([12, 9], [7.6, 3], [9.8, 2.6]), P([12, 9], [14.2, 2.6], [16.4, 3]), 'M12 2.4Q13.4 5 12 8.4Q10.6 5 12 2.4Z', arc(18, 14, 4.5, Math.PI * 1.5, Math.PI * 2.6, 1.6)],
  a_retreat: [arrow(18.5, 12, 3, 12), R(18.5, 4, 21.5, 20)],
  a_patrol: [arc(12, 12, 7.5, Math.PI * 0.15, Math.PI * 1.55, 2.4), head(12, 4.5, 17.5, 4.5, 5, 4), head(12, 19.5, 6.5, 19.5, 5, 4)],
  a_resupply: [...CART, P([6, 11], [8, 5], [16, 5], [18, 11])],
  a_assault: [...LADDER, L(13, 19, 21, 6, 2.2), P([21, 6], [19.6, 4.6], [22.5, 2.8]), L(13.5, 15.5, 17.5, 18.5, 1.8)],
  a_stance_aggressive: [P([12, 2.5], [21, 12], [16, 12], [16, 21.5], [8, 21.5], [8, 12], [3, 12])],
  a_stance_balanced: [R(3, 7, 21, 10.5), R(3, 13.5, 21, 17)],
  a_stance_cautious: [SHIELD + Rh(8, 10.6, 16, 13.4)],
  a_forced_march: [arrow(3, 8, 20, 8, 2.2, 5, 4), arrow(3, 16, 20, 16, 2.2, 5, 4)],
  a_split: [L(12, 21.5, 12, 13, 2.6), arrow(12, 13.5, 4.5, 3.5, 2.6, 5.5, 4.2), arrow(12, 13.5, 19.5, 3.5, 2.6, 5.5, 4.2)],
  a_merge: [L(12, 2.5, 12, 11, 2.6), arrow(4.5, 21, 11.2, 12, 2.6, 5.5, 4.2), arrow(19.5, 21, 12.8, 12, 2.6, 5.5, 4.2)],
  a_disband: [L(3, 21, 10.5, 13.5, 2.2), L(13.5, 10.5, 19.5, 4.5, 2.2), P([19.5, 4.5], [22, 2], [21.2, 5.8]), L(9, 9, 15, 15, 1.2)],
  a_visit: [C(12, 4.4, 2.6), P([9, 8], [15, 8], [16.5, 14], [14.6, 14], [15.5, 21.5], [13, 21.5], [12, 16], [11, 21.5], [8.5, 21.5], [9.4, 14], [7.5, 14])],
  a_rally_point: [R(5, 2.5, 7, 21.5), P([7, 3.5], [19.5, 6.5], [7, 10]), ring(6, 20, 4, 2.4)],
  a_repair: [L(4, 20, 13, 11, 2.6), 'M12 4.5Q15.5 1.5 19.5 3.5L16.5 6.5L17.5 9.5L20.5 10.5L23 7.5Q23.5 12 19 14Q15.5 14.5 13.4 12.4Z'],
  a_cancel: [ring(12, 12, 10, 8), L(6.4, 6.4, 17.6, 17.6, 2.2)],
  // --- seasons + weather -----------------------------------------------------------------------
  w_clear: [C(12, 12, 4.4), ...rays(8, 7, 10.5, 1.8)],
  w_cloud: ['M6 18.5Q2 18.5 2 14.8Q2 11.2 6 11Q6.6 6 11.6 6Q16 6 17.4 10Q22 10 22 14.2Q22 18.5 17.6 18.5Z'],
  w_rain: [CLOUD_HI, L(6, 15, 4.5, 20.5, 1.6), L(11, 15, 9.5, 20.5, 1.6), L(16, 15, 14.5, 20.5, 1.6)],
  w_storm: [CLOUD_HI, P([12, 13.5], [16, 13.5], [13.4, 17.2], [16, 17.2], [9.5, 23], [11.4, 18.6], [8.6, 18.6])],
  w_haze: [R(3, 7, 21, 8.8), R(5, 11.1, 19, 12.9), R(3, 15.2, 21, 17)],
  w_dust: [arc(10, 10, 6, Math.PI * 0.9, Math.PI * 2.1, 2), R(2, 17, 20, 19), R(6, 20.5, 22, 22), dots([[18.5, 5], [20.5, 9], [16, 13]], 1)],
  season_vasanta: [...[0, 1, 2, 3, 4].map((i) => petal(i, 5)), C(12, 12, 2)],
  season_grishma: [C(12, 12, 5.2), ...rays(12, 7.4, 10.6, 1.5)],
  season_varsha: [CLOUD_HI, drop(7, 15, 1), drop(12.5, 15.5, 1), drop(18, 15, 1)],
  season_sharad: ['M15 3.5A9 9 0 1 0 20.5 16A7 7 0 1 1 15 3.5Z'],
  season_hemanta: ['M4 20Q4 6 19.5 4Q20.5 15 9 18.5Q12 12 15.5 8.5Q9.5 11.5 6.5 20Z'],
  season_shishira: [...[0, 1, 2].map((i) => L(12 + Math.cos((i * Math.PI) / 3) * 9.5, 12 + Math.sin((i * Math.PI) / 3) * 9.5, 12 - Math.cos((i * Math.PI) / 3) * 9.5, 12 - Math.sin((i * Math.PI) / 3) * 9.5, 1.8)), C(12, 12, 2.4)],
  // --- hero ------------------------------------------------------------------------------------
  heart: ['M12 21Q2 14 2 8.2Q2 3.5 6.8 3.5Q10 3.5 12 6.6Q14 3.5 17.2 3.5Q22 3.5 22 8.2Q22 14 12 21Z'],
  breath: [arc(12, 12, 8, Math.PI * 0.75, Math.PI * 2.25, 2.4), P([11, 6], [15, 6], [12.8, 11], [16, 11], [9.5, 19], [11.2, 13], [8.4, 13])],
  flask: [R(10, 2, 14, 6), 'M10 6H14V9Q19.5 11 19.5 15.5Q19.5 21.5 12 21.5Q4.5 21.5 4.5 15.5Q4.5 11 10 9Z' + Rh(7, 14.5, 17, 15.6)],
  roll: [arc(12, 12, 7.5, Math.PI * 0.6, Math.PI * 2.1, 2.6), head(14, 4.5, 19.5, 6.8, 5.2, 4)],
  guard: [SHIELD],
  heavy: [...SWORD, ring(19.5, 19.5, 3, 1.4)],
  lock: [R(5, 10.5, 19, 21) + Rh(11, 13.5, 13, 18), 'M7.5 10.5V7.5A4.5 4.5 0 0 1 16.5 7.5V10.5H14V7.5A2 2 0 0 0 10 7.5V10.5Z'],
  interact: ['M4 4H20V16H11L6 20.5V16H4Z' + Ch(8.5, 10, 1.3) + Ch(12, 10, 1.3) + Ch(15.5, 10, 1.3)],
  exit: [R(3, 3, 13, 21) + Rh(5.4, 5.4, 10.6, 18.6), arrow(9, 12, 21.5, 12, 2.4, 5, 4)],
};

/** Theme icon ids (theme.css `.icon-<id>`; render/style/emblems.ts ICON_PATHS). */
export const THEME_ICON_IDS: ReadonlySet<string> = new Set([
  'sheaf',
  'logs',
  'block',
  'coins',
  'villager',
  'spear',
  'wheel',
  'sword',
  'lotus',
  'eye',
  'crown',
  'scroll',
  'unit-spearmen',
  'unit-archers',
  'unit-elite-guards',
  'unit-cavalry',
  'unit-chariots',
  'unit-war-elephants',
  'unit-engineers',
  'unit-scouts',
  'unit-supply-train',
]);

/** Every id `icon()` can draw. */
export const ICON_IDS: ReadonlySet<string> = new Set([...THEME_ICON_IDS, ...Object.keys(ICON_PATHS_HUD)]);

const uriCache = new Map<string, string>();

/** CSS url() value of a HUD icon mask (cached). */
export function iconUrl(id: string): string {
  let u = uriCache.get(id);
  if (u) return u;
  const parts = ICON_PATHS_HUD[id] ?? ICON_PATHS_HUD.info!;
  const svgText = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>${parts.map((d) => `<path d='${d}'/>`).join('')}</svg>`;
  u = `url("data:image/svg+xml,${svgText.replace(/[<>#%{}\n"]/g, (c) => encodeURIComponent(c))}")`;
  uriCache.set(id, u);
  return u;
}

/** `<i class="icon ...">` for a theme or HUD icon id. Extra classes (e.g. 'res-grain') tint via currentColor. */
export function icon(id: string, extraClass = ''): HTMLElement {
  if (THEME_ICON_IDS.has(id)) return h('i', { class: `icon icon-${id}${extraClass ? ` ${extraClass}` : ''}`, 'aria-hidden': 'true' });
  const el = h('i', { class: `icon${extraClass ? ` ${extraClass}` : ''}`, 'aria-hidden': 'true' });
  el.style.setProperty('--icon', iconUrl(id));
  return el;
}

/** Change the icon of an existing `<i class="icon">` (command-card slot reuse). */
export function setIcon(el: HTMLElement, id: string): void {
  if (el.dataset.icon === id) return;
  el.dataset.icon = id;
  for (const c of [...el.classList]) if (c.startsWith('icon-')) el.classList.remove(c);
  if (THEME_ICON_IDS.has(id)) {
    el.style.removeProperty('--icon');
    el.classList.add(`icon-${id}`);
  } else el.style.setProperty('--icon', iconUrl(id));
}

/** Theme icon id of a unit class ('war_elephants' -> 'unit-war-elephants'). */
export function unitIcon(cls: string): string {
  return `unit-${cls.replace(/_/g, '-')}`;
}
