/**
 * Minimap widget for the world and battle HUDs (DESIGN_SPEC §8.7). OWNER: UI Engineer - In-game HUD, Command Card,
 * Minimap & Input (UI-02).
 *
 * Layers: terrain tint from biomes with hill shading and water (cached bitmap from the heightfield, render/style
 * palette colours), province borders in owner colour (contested provinces hatched), roads by quality, settlements
 * (squares sized by kind, owner colour, gold star = capital, red ring = besieged), armies (dots with direction ticks,
 * dashed ghost outlines for last-known enemies), engagements (flashing crossed swords), depots (barrels), the camera
 * frustum quad (HudFeeds), alert pings (expanding rings: red attack / siege / revolt, amber shortage / supply, gold
 * good news). Battle: formations as team-coloured rectangles (selection highlighted), deploy zones, objectives, walls.
 * Interaction: click / tap jumps the camera, right-click orders the selection to move there (PC), north-up toggle,
 * phone: collapses to a 56 px button (expands to 40% of the short side).
 * Relation shape coding (colour-blind): own solid ring, ally dashed, enemy spiked, neutral dotted.
 */
import type { BattleState, FactionId, FormationIndex, Rect, SideIndex, WorldState } from '../../core/types';
import { BIOMES } from '../../core/types';
import type { Heightfield } from '../../core/terrain/heightfield';
import { BIOME_COLORS, MATERIALS, hexToRgb } from '../../render/style/palette';
import { h, setAttr, setClass, setHidden, uiClock } from '../dom';
import type { HudFeeds } from '../services/hudCommands';
import { battleLayers, facingToMap, makeProjection, mapToWorld, worldLayers, worldToMap, type BattleMapLayers, type MapProjection, type Relation, type Selection, type WorldMapLayers } from '../services/minimapModel';
import { icon } from './icons';

export type PingSeverity = 'danger' | 'warning' | 'success';

export interface MinimapOptions {
  onJump(x: number, z: number): void;
  onMove(x: number, z: number): void;
  onNorthUp(northUp: boolean): void;
  /** Collapsible on phones (56 px button). */
  collapsible: boolean;
}

interface Ping {
  x: number;
  z: number;
  severity: PingSeverity;
  t0: number;
}

interface Tokens {
  gold: string;
  ivory: string;
  ink: string;
  danger: string;
  warning: string;
  success: string;
  rel: Record<Relation, string>;
  faction: Map<string, string>;
  font: string;
  version: string;
}

const PING_SEC = 2.2;
const TERRAIN_RES = 256;
const terrainCache = new Map<string, HTMLCanvasElement>();

function cssVar(st: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = st.getPropertyValue(name).trim();
  return v || fallback;
}

/** Terrain tint bitmap (north-up) of a heightfield: biome colours, water, NW hill shading. Cached per spec key. */
function terrainBitmap(hf: Heightfield, key: string): HTMLCanvasElement {
  const hit = terrainCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = TERRAIN_RES;
  c.height = TERRAIN_RES;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(TERRAIN_RES, TERRAIN_RES);
  const res = hf.resolution;
  const pal = BIOMES.map((b) => hexToRgb(BIOME_COLORS[b]));
  const deep = hexToRgb(MATERIALS.waterDeep);
  const shallow = hexToRgb(MATERIALS.waterShallow);
  const wl = hf.spec.waterLevel;
  const relief = Math.max(1, hf.maxHeight - hf.minHeight);
  const at = (ix: number, iz: number): number => hf.heights[Math.max(0, Math.min(res - 1, iz)) * res + Math.max(0, Math.min(res - 1, ix))]!;
  for (let v = 0; v < TERRAIN_RES; v++) {
    const iz = Math.round((v / (TERRAIN_RES - 1)) * (res - 1));
    for (let u = 0; u < TERRAIN_RES; u++) {
      const ix = Math.round((u / (TERRAIN_RES - 1)) * (res - 1));
      const i = iz * res + ix;
      const hgt = hf.heights[i]!;
      let r: number;
      let g: number;
      let b: number;
      if (hgt < wl) {
        const d = Math.min(1, (wl - hgt) / 3);
        r = shallow[0] + (deep[0] - shallow[0]) * d;
        g = shallow[1] + (deep[1] - shallow[1]) * d;
        b = shallow[2] + (deep[2] - shallow[2]) * d;
      } else {
        const col = pal[hf.biomes[i]!] ?? pal[0]!;
        const step = Math.max(1, Math.round(res / TERRAIN_RES));
        const slope = (at(ix - step, iz - step) - at(ix + step, iz + step)) / (hf.cellSize * step * 2);
        const shade = Math.max(0.62, Math.min(1.35, 1 + slope * 1.6 + ((hgt - hf.minHeight) / relief - 0.4) * 0.18));
        r = col[0] * shade;
        g = col[1] * shade;
        b = col[2] * shade;
      }
      const o = (v * TERRAIN_RES + u) * 4;
      img.data[o] = Math.min(255, r * 255);
      img.data[o + 1] = Math.min(255, g * 255);
      img.data[o + 2] = Math.min(255, b * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  terrainCache.set(key, c);
  return c;
}

export class Minimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D | null;
  private readonly northBtn: HTMLButtonElement;
  private readonly toggleBtn: HTMLButtonElement;
  private mode: 'world' | 'battle' = 'world';
  private world: Readonly<WorldState> | null = null;
  private battle: Readonly<BattleState> | null = null;
  private feeds: HudFeeds | null = null;
  private northUp = false;
  private hf: Heightfield | null = null;
  private hfKey = '';
  private proj: MapProjection | null = null;
  private pings: Ping[] = [];
  private raf = 0;
  private tokens: Tokens | null = null;
  private cssSize = 220;
  private collapsed = false;
  private readonly tmp: [number, number] = [0, 0];
  private readonly tmp2: [number, number] = [0, 0];
  private lastDraw = 0;
  private wl: WorldMapLayers | null = null;
  private bl: BattleMapLayers | null = null;
  private layerKey = '';
  private layerClock = Number.NaN;
  private layersAt = Number.NEGATIVE_INFINITY;
  private camVersion = -1;
  private cssW = 0;
  private readonly ro: ResizeObserver | null = null;

  constructor(private readonly o: MinimapOptions) {
    this.canvas = h('canvas', { class: 'minimap-canvas', role: 'img', 'aria-label': 'Minimap: tap to move the camera' });
    this.ctx2d = this.canvas.getContext('2d');
    this.northBtn = h('button', { class: 'btn icon ghost minimap-north', type: 'button', 'aria-label': 'North up', title: 'North up / rotate with camera', onclick: () => this.setNorthUp(!this.northUp, true) }, icon('compass'));
    this.toggleBtn = h('button', { class: 'btn icon minimap-toggle', type: 'button', 'aria-label': 'Show minimap', onclick: () => this.setCollapsed(!this.collapsed) }, icon('compass'));
    this.el = h('div', { class: 'minimap', dataset: { anchor: 'minimap' } }, h('div', { class: 'minimap-frame' }, this.canvas), this.northBtn, o.collapsible ? this.toggleBtn : null);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Size from a ResizeObserver: reading clientWidth in draw() forced a layout after every HUD DOM update.
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        if (w > 0 && Math.abs(w - this.cssW) > 0.5) {
          this.cssW = w;
          this.draw();
        }
      });
      this.ro.observe(this.canvas);
    }
  }

  /**
   * Layers are rebuilt when the selection / source object changes, or when the clock moved and LAYER_MS passed;
   * the canvas is redrawn only when layers or the camera feed changed (state pushes arrive at up to 10 Hz).
   */
  private layersDue(key: string, clock: number, ms: number): boolean {
    const now = uiClock.now();
    if (key === this.layerKey && (clock === this.layerClock || now - this.layersAt < ms)) return false;
    this.layerKey = key;
    this.layerClock = clock;
    this.layersAt = now;
    return true;
  }

  setCollapsed(c: boolean): void {
    this.collapsed = c;
    setClass(this.el, 'collapsed', c);
    setAttr(this.toggleBtn, 'aria-label', c ? 'Show minimap' : 'Hide minimap');
    if (!c) this.draw();
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  setNorthUp(v: boolean, fire = false): void {
    if (this.northUp === v) return;
    this.northUp = v;
    setClass(this.northBtn, 'active', v);
    setAttr(this.northBtn, 'aria-pressed', v ? 'true' : 'false');
    if (fire) this.o.onNorthUp(v);
    this.draw();
  }

  setWorld(world: Readonly<WorldState>, selection: Selection, feeds: HudFeeds | null): void {
    const fresh = this.mode !== 'world' || this.world !== world || !this.wl;
    this.mode = 'world';
    this.world = world;
    this.feeds = feeds;
    const due = this.layersDue(`w|${selection.kind}:${selection.id}`, world.calendar.totalHours, 250) || fresh;
    if (due) this.wl = worldLayers(world, selection);
    const cam = feeds?.cameraVersion ?? 0;
    if (due || cam !== this.camVersion) {
      this.camVersion = cam;
      this.draw();
    }
  }

  setBattle(battle: Readonly<BattleState>, side: SideIndex, selection: readonly FormationIndex[], feeds: HudFeeds | null): void {
    const fresh = this.mode !== 'battle' || this.battle !== battle || !this.bl;
    this.mode = 'battle';
    this.battle = battle;
    this.feeds = feeds;
    const due = this.layersDue(`b|${side}|${selection.join(',')}`, battle.tick, 120) || fresh;
    if (due) this.bl = battleLayers(battle, side, selection);
    const cam = feeds?.cameraVersion ?? 0;
    if (due || cam !== this.camVersion) {
      this.camVersion = cam;
      this.draw();
    }
  }

  /** Terrain source (region heightfield for the world, the battle window for battles). */
  setTerrain(hf: Heightfield | null, key: string): void {
    this.hf = hf;
    this.hfKey = key;
    this.draw();
  }

  get hasTerrain(): boolean {
    return !!this.hf;
  }

  ping(x: number, z: number, severity: PingSeverity): void {
    this.pings.push({ x, z, severity, t0: performance.now() });
    if (this.pings.length > 12) this.pings.shift();
    this.animate();
  }

  get projection(): MapProjection | null {
    return this.proj;
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
  }

  // ------------------------------------------------------------------ interaction

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.proj) return;
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const u = ((e.clientX - r.left) / Math.max(1, r.width)) * this.proj.size;
    const v = ((e.clientY - r.top) / Math.max(1, r.height)) * this.proj.size;
    const [x, z] = mapToWorld(this.proj, u, v, this.tmp);
    const b = this.proj.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return;
    if (e.button === 2) this.o.onMove(x, z);
    else this.o.onJump(x, z);
  };

  // ------------------------------------------------------------------ drawing

  private readTokens(): Tokens {
    const ver = `${document.documentElement.dataset.colorblind ?? ''}|${document.documentElement.dataset.relation ?? ''}`;
    if (this.tokens && this.tokens.version === ver) return this.tokens;
    const st = getComputedStyle(this.el);
    const t: Tokens = {
      gold: cssVar(st, '--c-gold', '#e9b949'),
      ivory: cssVar(st, '--c-ivory', '#f6ecd6'),
      ink: cssVar(st, '--c-ink', '#24160f'),
      danger: cssVar(st, '--ui-danger', '#ec5a40'),
      warning: cssVar(st, '--ui-warning', '#e9b949'),
      success: cssVar(st, '--c-gold', '#e9b949'),
      rel: { own: cssVar(st, '--rel-own', '#ffd36b'), ally: cssVar(st, '--rel-ally', '#6fb7e8'), enemy: cssVar(st, '--rel-enemy', '#e0533d'), neutral: cssVar(st, '--rel-neutral', '#d8cdb5') },
      faction: new Map(),
      font: st.fontFamily || 'sans-serif',
      version: ver,
    };
    this.tokens = t;
    return t;
  }

  private factionColor(t: Tokens, id: FactionId | null): string {
    const key = id ?? 'independent';
    let c = t.faction.get(key);
    if (!c) {
      c = cssVar(getComputedStyle(this.el), `--faction-${key}`, t.rel.neutral);
      t.faction.set(key, c);
    }
    return c;
  }

  private animate(): void {
    if (this.raf || typeof requestAnimationFrame !== 'function') return;
    const tick = (): void => {
      this.raf = 0;
      this.draw(true);
      const now = performance.now();
      this.pings = this.pings.filter((p) => now - p.t0 < PING_SEC * 1000);
      if (this.pings.length > 0 || this.hasEngagements()) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private hasEngagements(): boolean {
    return this.mode === 'world' && !!this.wl && this.wl.engagements.length > 0;
  }

  /** Redraw (state pushes at 4-10 Hz; animation frames only while pings or engagements are live, capped ~20 Hz). */
  draw(fromAnim = false): void {
    const ctx = this.ctx2d;
    if (!ctx || this.collapsed) return;
    const now = performance.now();
    if (fromAnim && now - this.lastDraw < 48) return;
    this.lastDraw = now;
    if (!this.cssW) this.cssW = this.canvas.clientWidth;
    const cssW = this.cssW || this.cssSize;
    const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    const px = Math.max(64, Math.round(cssW * dpr));
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    const t = this.readTokens();
    const bounds = this.mode === 'world' ? this.world?.region.bounds : this.battle ? battleBoundsOf(this.battle) : undefined;
    if (!bounds) return;
    const heading = this.feeds?.cameraHeading ?? Math.PI;
    const p = makeProjection(bounds, px, this.northUp, heading);
    this.proj = p;
    ctx.save();
    ctx.clearRect(0, 0, px, px);
    // Clip: circle when rotating (no empty corners), rounded square when north-up.
    ctx.beginPath();
    if (this.northUp) roundRect(ctx, 0, 0, px, px, px * 0.04);
    else ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = t.ink;
    ctx.fillRect(0, 0, px, px);
    this.drawTerrain(ctx, p);
    if (this.mode === 'world' && this.wl) this.drawWorld(ctx, p, t, this.wl, dpr, now);
    else if (this.mode === 'battle' && this.bl) this.drawBattle(ctx, p, t, this.bl, dpr);
    this.drawFrustum(ctx, p, t, dpr);
    this.drawPings(ctx, p, t, dpr, now);
    ctx.restore();
    // North marker on the rim when rotating.
    if (!this.northUp) {
      const [nu, nv] = facingToMap(p, Math.PI);
      ctx.save();
      ctx.fillStyle = t.gold;
      ctx.strokeStyle = t.ink;
      ctx.lineWidth = 2 * dpr;
      ctx.font = `700 ${11 * dpr}px ${t.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const r = px / 2 - 9 * dpr;
      ctx.strokeText('N', px / 2 + nu * r, px / 2 + nv * r);
      ctx.fillText('N', px / 2 + nu * r, px / 2 + nv * r);
      ctx.restore();
    }
    if (this.hasEngagements() || this.pings.length) this.animate();
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, p: MapProjection): void {
    if (!this.hf) return;
    const bmp = terrainBitmap(this.hf, this.hfKey);
    const hb = this.hf.bounds;
    const [u0, v0] = worldToMap(p, hb.minX, hb.minZ, this.tmp);
    ctx.save();
    ctx.translate(u0, v0);
    ctx.rotate(p.rotation);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bmp, 0, 0, (hb.maxX - hb.minX) / p.scale, (hb.maxZ - hb.minZ) / p.scale);
    ctx.restore();
  }

  private poly(ctx: CanvasRenderingContext2D, p: MapProjection, pts: readonly (readonly [number, number])[], close: boolean): void {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [u, v] = worldToMap(p, pts[i]![0], pts[i]![1], this.tmp);
      if (i === 0) ctx.moveTo(u, v);
      else ctx.lineTo(u, v);
    }
    if (close) ctx.closePath();
  }

  private drawWorld(ctx: CanvasRenderingContext2D, p: MapProjection, t: Tokens, L: WorldMapLayers, dpr: number, now: number): void {
    // Borders: tinted fill + owner line; contested provinces hatched.
    for (const b of L.borders) {
      const col = this.factionColor(t, b.owner);
      this.poly(ctx, p, b.points, true);
      ctx.globalAlpha = b.owner ? 0.16 : 0.05;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4 * dpr;
      ctx.setLineDash(b.relation === 'enemy' ? [6 * dpr, 3 * dpr] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (b.contested) {
        ctx.save();
        this.poly(ctx, p, b.points, true);
        ctx.clip();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = t.danger;
        ctx.lineWidth = 1.2 * dpr;
        const step = 7 * dpr;
        ctx.beginPath();
        for (let k = -p.size; k < p.size * 2; k += step) {
          ctx.moveTo(k, 0);
          ctx.lineTo(k + p.size, p.size);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    // Roads by quality.
    for (const r of L.roads) {
      this.poly(ctx, p, r.points, false);
      ctx.strokeStyle = r.quality === 'royal_road' ? t.gold : t.ivory;
      ctx.globalAlpha = r.quality === 'track' ? 0.45 : 0.75;
      ctx.lineWidth = (r.quality === 'royal_road' ? 2.2 : r.quality === 'road' ? 1.5 : 1) * dpr;
      ctx.setLineDash(r.quality === 'track' || r.damaged ? [3 * dpr, 3 * dpr] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    const k = (p.size / dpr / 220) * dpr;
    // Depots: small barrels.
    for (const d of L.depots) {
      const [u, v] = worldToMap(p, d.x, d.z, this.tmp);
      ctx.fillStyle = this.factionColor(t, d.owner);
      ctx.strokeStyle = t.ink;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      roundRect(ctx, u - 2.5 * k, v - 3.5 * k, 5 * k, 7 * k, 1.5 * k);
      ctx.fill();
      ctx.stroke();
    }
    // Settlements.
    for (const s of L.settlements) {
      const [u, v] = worldToMap(p, s.x, s.z, this.tmp);
      const sz = s.size * k;
      ctx.fillStyle = this.factionColor(t, s.owner);
      ctx.strokeStyle = s.selected ? t.ivory : t.ink;
      ctx.lineWidth = (s.selected ? 2.4 : 1.4) * dpr;
      ctx.beginPath();
      if (s.kind === 'fort') {
        ctx.moveTo(u, v - sz * 0.7);
        ctx.lineTo(u + sz * 0.7, v);
        ctx.lineTo(u, v + sz * 0.7);
        ctx.lineTo(u - sz * 0.7, v);
        ctx.closePath();
      } else ctx.rect(u - sz / 2, v - sz / 2, sz, sz);
      ctx.fill();
      ctx.stroke();
      this.relationRing(ctx, u, v, sz * 0.9 + 2 * k, s.relation, t, dpr);
      if (s.capital) drawStar(ctx, u, v - sz / 2 - 3.5 * k, 3.6 * k, t.gold, t.ink, dpr);
      if (s.besieged) {
        ctx.strokeStyle = t.danger;
        ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath();
        ctx.arc(u, v, sz * 0.95 + 3 * k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Armies: dots + direction ticks; ghosts dashed outlines.
    for (const a of L.armies) {
      const [u, v] = worldToMap(p, a.x, a.z, this.tmp);
      const r = 3.6 * k;
      const col = this.factionColor(t, a.owner);
      if (a.ghost) {
        ctx.setLineDash([2 * dpr, 2 * dpr]);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4 * dpr;
        ctx.beginPath();
        ctx.arc(u, v, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const [du, dv] = facingToMap(p, a.facing);
      if (a.moving) {
        ctx.strokeStyle = t.ivory;
        ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath();
        ctx.moveTo(u + du * r, v + dv * r);
        ctx.lineTo(u + du * (r + 5 * k), v + dv * (r + 5 * k));
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.strokeStyle = a.selected ? t.ivory : t.ink;
      ctx.lineWidth = (a.selected ? 2.2 : 1.2) * dpr;
      ctx.beginPath();
      ctx.arc(u, v, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      this.relationRing(ctx, u, v, r + 2 * k, a.relation, t, dpr);
    }
    // Engagements: flashing crossed swords.
    const flash = 0.55 + 0.45 * Math.sin(now / 160);
    for (const e of L.engagements) {
      const [u, v] = worldToMap(p, e.x, e.z, this.tmp);
      const s = 5.5 * k;
      ctx.globalAlpha = flash;
      ctx.strokeStyle = t.ink;
      ctx.lineWidth = 3.4 * dpr;
      crossedSwords(ctx, u, v, s);
      ctx.strokeStyle = t.danger;
      ctx.lineWidth = 1.8 * dpr;
      crossedSwords(ctx, u, v, s);
      ctx.globalAlpha = 1;
    }
  }

  private relationRing(ctx: CanvasRenderingContext2D, u: number, v: number, r: number, rel: Relation, t: Tokens, dpr: number): void {
    if (rel === 'own') return;
    ctx.save();
    ctx.strokeStyle = t.rel[rel];
    ctx.lineWidth = 1 * dpr;
    if (rel === 'ally') ctx.setLineDash([3 * dpr, 2 * dpr]);
    else if (rel === 'neutral') ctx.setLineDash([1 * dpr, 2.5 * dpr]);
    ctx.beginPath();
    if (rel === 'enemy') {
      const n = 8;
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const rr = i % 2 === 0 ? r + 1.6 * dpr : r;
        if (i === 0) ctx.moveTo(u + Math.cos(a) * rr, v + Math.sin(a) * rr);
        else ctx.lineTo(u + Math.cos(a) * rr, v + Math.sin(a) * rr);
      }
    } else ctx.arc(u, v, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawBattle(ctx: CanvasRenderingContext2D, p: MapProjection, t: Tokens, L: BattleMapLayers, dpr: number): void {
    for (const z of L.zones) {
      const pts: [number, number][] = [
        [z.rect.minX, z.rect.minZ],
        [z.rect.maxX, z.rect.minZ],
        [z.rect.maxX, z.rect.maxZ],
        [z.rect.minX, z.rect.maxZ],
      ];
      this.poly(ctx, p, pts, true);
      ctx.fillStyle = z.own ? t.rel.own : t.rel.enemy;
      ctx.globalAlpha = 0.14;
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.strokeStyle = z.own ? t.rel.own : t.rel.enemy;
      ctx.lineWidth = 1.4 * dpr;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (L.fort) {
      const [u, v] = worldToMap(p, L.fort.x, L.fort.z, this.tmp);
      ctx.strokeStyle = t.ivory;
      ctx.lineWidth = 2.4 * dpr;
      ctx.beginPath();
      ctx.arc(u, v, L.fort.radius / p.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const o of L.objectives) {
      const [u, v] = worldToMap(p, o.x, o.z, this.tmp);
      ctx.strokeStyle = t.gold;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      ctx.arc(u, v, Math.max(4 * dpr, o.radius / p.scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      drawStar(ctx, u, v, 4 * dpr, t.gold, t.ink, dpr);
    }
    const sideFaction = (s: SideIndex): FactionId => this.battle!.sides[s].factionId;
    for (const f of L.formations) {
      const [u, v] = worldToMap(p, f.x, f.z, this.tmp);
      const w = Math.max(3 * dpr, f.width / p.scale);
      const d = Math.max(2.4 * dpr, f.depth / p.scale);
      ctx.save();
      ctx.translate(u, v);
      // Formation frame: facing theta maps through the projection rotation.
      const [du, dv] = facingToMap(p, f.facing);
      ctx.rotate(Math.atan2(dv, du) - Math.PI / 2);
      ctx.fillStyle = this.factionColor(t, sideFaction(f.side));
      ctx.globalAlpha = f.routing ? 0.5 : 1;
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.strokeStyle = f.selected ? t.ivory : t.ink;
      ctx.lineWidth = (f.selected ? 2 : 1) * dpr;
      ctx.strokeRect(-w / 2, -d / 2, w, d);
      // Front edge tick (facing).
      ctx.strokeStyle = f.relation === 'own' ? t.rel.own : t.rel.enemy;
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      ctx.moveTo(-w / 2, d / 2);
      ctx.lineTo(w / 2, d / 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  private drawFrustum(ctx: CanvasRenderingContext2D, p: MapProjection, t: Tokens, dpr: number): void {
    const q = this.feeds?.cameraQuad;
    if (!q) return;
    this.poly(ctx, p, q, true);
    ctx.strokeStyle = t.ivory;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = t.ivory;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawPings(ctx: CanvasRenderingContext2D, p: MapProjection, t: Tokens, dpr: number, now: number): void {
    for (const pg of this.pings) {
      const age = (now - pg.t0) / 1000;
      if (age > PING_SEC) continue;
      const [u, v] = worldToMap(p, pg.x, pg.z, this.tmp2);
      const col = pg.severity === 'danger' ? t.danger : pg.severity === 'warning' ? t.warning : t.success;
      for (let i = 0; i < 2; i++) {
        const a = (age + i * 0.5) % 1.1;
        ctx.globalAlpha = Math.max(0, 1 - a / 1.1) * (1 - age / PING_SEC);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(u, v, (4 + a * 22) * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
}

function battleBoundsOf(b: Readonly<BattleState>): Rect {
  const t = b.setup.terrain;
  const half = t.sizeMeters / 2;
  return { minX: t.centerX - half, minZ: t.centerZ - half, maxX: t.centerX + half, maxZ: t.centerZ + half };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string, dpr: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1 * dpr;
  ctx.fill();
  ctx.stroke();
}

function crossedSwords(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x - s, y - s);
  ctx.lineTo(x + s, y + s);
  ctx.moveTo(x + s, y - s);
  ctx.lineTo(x - s, y + s);
  ctx.moveTo(x - s * 0.9, y + s * 0.2);
  ctx.lineTo(x - s * 0.2, y + s * 0.9);
  ctx.moveTo(x + s * 0.9, y + s * 0.2);
  ctx.lineTo(x + s * 0.2, y + s * 0.9);
  ctx.stroke();
}

export { setHidden };
