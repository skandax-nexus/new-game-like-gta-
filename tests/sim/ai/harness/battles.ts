/**
 * Headless AI-vs-AI battle harness for the SIM-02 matchup suite, the 200-run matchup script and tuning probes.
 * OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 * Battles go through the real skirmish setup (`createSkirmishSetup`: deploy zones, line-order auto-deploy, 30 s
 * deployment in which the battle AI deploys) on the skirmish 'plains' map of the seed, generated at the autoresolve
 * resolution (65 samples; DESIGN_SPEC §13.3 "autoresolve QA, plains"), or on synthetic terrain for the rows that need
 * one (a +15 m hill under one side). Both sides are AI unless a row scripts one. Every battle runs to its outcome
 * (40-minute skirmish limit).
 */
import type { BattleEventRecord, BattleSetup, BattleState, FormationShape, SideIndex, SkirmishSetup, TerrainQuery, UnitClass, Vec3, Biome, TerrainClass, Rect, TerrainSpec } from '../../../../src/core/types';
import { BATTLE_DT } from '../../../../src/core/constants';
import { Heightfield } from '../../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, issueBattleCommand, stepBattle } from '../../../../src/sim/tactical/battle';
import { addMoraleEvent } from '../../../../src/sim/tactical/morale';
import { UNITS } from '../../../../src/data/units';
import { FACTION_DEFAULT_COMPOSITION } from '../../../../src/data/skirmish';
import { composeArmy } from '../../../../src/sim/tactical/setup';

export type ArmyRow = { unitClass: UnitClass; soldiers: number; shape?: FormationShape }[];

export interface BattleSpec {
  seed: number;
  factions: [string, string];
  /** Explicit armies (else compositions / faction defaults at `total`). */
  armies?: [ArmyRow, ArmyRow];
  compositions?: [string, string];
  total?: number;
  hour?: number;
  preset?: SkirmishSetup['preset'];
  /** Map: the seed's skirmish map ('map', default) or a hill of `hill` m under side `hillSide`'s deploy zone on it. */
  hill?: number;
  hillSide?: SideIndex;
  /** Terrain resolution of the seed map (65 = autoresolve). */
  resolution?: number;
  difficulty?: SkirmishSetup['difficulty'];
  /** Scripted side behaviour. */
  script?: { side: SideIndex; kind: 'frontal_charge' } | { side: SideIndex; kind: 'kill_commander'; atSec: number };
  /** Called after setup creation (mutate positions, aggression...). */
  patch?: (setup: BattleSetup) => void;
  /** Collect a decision trace (posture changes, first contact, routs, withdrawals). */
  trace?: boolean;
}

export interface BattleRun {
  winner: SideIndex | null;
  reason: string;
  minutes: number;
  start: [number, number];
  loss: [number, number];
  /** Side routed (lost by rout / annihilation / surrender). */
  routed: [boolean, boolean];
  firstContactSec: number;
  trace: string[];
}

const hfCache = new Map<string, Heightfield>();

/** Synthetic hill on top of a base terrain (heights only; classes, water unchanged). */
class HillTerrain implements TerrainQuery {
  readonly spec: TerrainSpec;
  readonly bounds: Rect;
  constructor(
    private readonly base: TerrainQuery,
    private readonly cx: number,
    private readonly cz: number,
    private readonly height: number,
    private readonly radius: number,
  ) {
    this.spec = base.spec;
    this.bounds = base.bounds;
  }
  private bump(x: number, z: number): number {
    const dx = x - this.cx;
    const dz = z - this.cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= this.radius * 1.6) return 0;
    if (d <= this.radius) return this.height;
    const t = (d - this.radius) / (this.radius * 0.6);
    return this.height * (1 - t * t * (3 - 2 * t));
  }
  heightAt(x: number, z: number): number {
    return this.base.heightAt(x, z) + this.bump(x, z);
  }
  normalAt(x: number, z: number, out: Vec3): Vec3 {
    return this.base.normalAt(x, z, out);
  }
  slopeAt(x: number, z: number): number {
    return this.base.slopeAt(x, z);
  }
  biomeAt(x: number, z: number): Biome {
    return this.base.biomeAt(x, z);
  }
  terrainClassAt(x: number, z: number): TerrainClass {
    return this.base.terrainClassAt(x, z);
  }
  moistureAt(x: number, z: number): number {
    return this.base.moistureAt(x, z);
  }
  fertilityAt(x: number, z: number): number {
    return this.base.fertilityAt(x, z);
  }
  isWater(x: number, z: number): boolean {
    return this.base.isWater(x, z);
  }
  waterDepthAt(x: number, z: number): number {
    return this.base.waterDepthAt(x, z);
  }
  riverDistanceAt(x: number, z: number): number {
    return this.base.riverDistanceAt(x, z);
  }
  inBounds(x: number, z: number): boolean {
    return this.base.inBounds(x, z);
  }
}

/** Recruit cost (wealth) of an army row. */
export function armyCost(army: ArmyRow): number {
  let c = 0;
  for (const f of army) c += (UNITS[f.unitClass].stats.recruitCost.wealth * f.soldiers) / UNITS[f.unitClass].stats.menPerFormation;
  return c;
}

/** A faction's default composition scaled to `wealth` of recruit cost (equal-cost rows). */
export function armyOfCost(factionId: string, wealth: number, compositionId?: string): ArmyRow {
  const comp = compositionId ?? FACTION_DEFAULT_COMPOSITION[factionId] ?? 'balanced';
  let lo = 50;
  let hi = 6000;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (armyCost(composeArmy(Math.round(mid), factionId, comp)) > wealth) hi = mid;
    else lo = mid;
  }
  return composeArmy(Math.round(lo), factionId, comp);
}

function terrainFor(setup: BattleSetup, spec: BattleSpec): TerrainQuery {
  const res = spec.resolution ?? 65;
  const tspec = { ...setup.terrain, resolution: res };
  const key = JSON.stringify(tspec);
  let hf = hfCache.get(key);
  if (!hf) {
    hf = Heightfield.generate(tspec);
    hfCache.set(key, hf);
  }
  if (!spec.hill) return hf;
  const z = setup.sides[spec.hillSide ?? 1].deployZone;
  return new HillTerrain(hf, (z.minX + z.maxX) / 2, (z.minZ + z.maxZ) / 2, spec.hill, 150);
}

/** Run one battle to its outcome. */
export function runBattle(spec: BattleSpec): BattleRun {
  const [fa, fb] = spec.factions;
  const setup = createSkirmishSetup({
    seed: spec.seed,
    preset: spec.preset ?? 'plains',
    totalSoldiers: spec.total ?? 1000,
    playerFactionId: fa,
    enemyFactionId: fb,
    armies: spec.armies
      ? [
          { factionId: fa, formations: spec.armies[0].map((f) => ({ unitClass: f.unitClass, soldiers: f.soldiers })) },
          { factionId: fb, formations: spec.armies[1].map((f) => ({ unitClass: f.unitClass, soldiers: f.soldiers })) },
        ]
      : null,
    playerSide: 0,
    hour: spec.hour ?? 9,
    season: 'sharad',
    weather: 'clear',
    difficulty: spec.difficulty ?? 'normal',
    aiVsAi: true,
    compositions: spec.compositions,
  });
  if (spec.armies) {
    for (const s of [0, 1] as const) spec.armies[s].forEach((f, i) => {
      const fs = setup.sides[s].formations[i];
      if (fs && f.shape) fs.shape = f.shape;
    });
  }
  if (spec.script?.kind === 'frontal_charge') setup.sides[spec.script.side].controller = 'player';
  spec.patch?.(setup);
  const terrain = terrainFor(setup, spec);
  const st: BattleState = createBattle(setup, terrain);
  const out: BattleEventRecord[] = [];
  const trace: string[] = [];
  let firstContact = -1;
  const lastPosture: [string, string] = ['', ''];
  let killed = false;
  if (spec.trace) trace.push(st.formations.map((f) => `${f.index}:${f.side}:${f.unitClass}:${f.soldiers}`).join(' '));
  while (!st.outcome) {
    if (spec.script?.kind === 'frontal_charge' && st.phase === 'active' && st.tick % 20 === 0) frontalCharge(st, spec.script.side);
    if (spec.script?.kind === 'kill_commander' && !killed && st.phase === 'active' && st.time - st.deploymentEndsAt >= spec.script.atSec) {
      killed = true;
      killCommander(st, spec.script.side);
    }
    out.length = 0;
    stepBattle(st, BATTLE_DT, terrain, out);
    for (const e of out) {
      if (e.kind === 'contact' && firstContact < 0) firstContact = st.time - st.deploymentEndsAt;
      if (spec.trace && (e.kind === 'formation_routed' || e.kind === 'side_withdrew' || e.kind === 'commander_fallen' || e.kind === 'formation_rallied' || (e.kind === 'contact' && trace.length < 400)))
        trace.push(`${(st.time - st.deploymentEndsAt).toFixed(0).padStart(5)}s ${e.kind} side ${e.side} f ${e.formation}${e.formation !== null ? `(${st.formations[e.formation]!.unitClass} ${st.formations[e.formation]!.order.type} m${st.formations[e.formation]!.morale.toFixed(0)})` : ''}${e.other !== null ? ` vs ${e.other}(${st.formations[e.other]!.unitClass} ${st.formations[e.other]!.shape})` : ''}${e.text ? ` (${e.text})` : ''}`);
    }
    if (spec.trace) {
      for (const s of [0, 1] as const) {
        const p = String(st.sides[s].aiMemory.posture ?? '');
        if (p !== lastPosture[s]) {
          lastPosture[s] = p;
          trace.push(`${(st.time - st.deploymentEndsAt).toFixed(0).padStart(5)}s side ${s} posture ${p} (pA ${Number(st.sides[s].aiMemory.pA ?? 0).toFixed(2)})`);
        }
      }
    }
  }
  const o = st.outcome;
  const start: [number, number] = [o.sides[0].startSoldiers, o.sides[1].startSoldiers];
  const loss: [number, number] = [o.sides[0].killed + o.sides[0].captured, o.sides[1].killed + o.sides[1].captured];
  const broke = (s: SideIndex): boolean => o.winner !== null && o.winner !== s && (o.reason === 'rout' || o.reason === 'annihilation' || o.reason === 'surrender');
  return { winner: o.winner, reason: o.reason, minutes: o.durationSec / 60, start, loss, routed: [broke(0), broke(1)], firstContactSec: firstContact, trace };
}

/** Scripted side: every second, each formation charges the enemy formation nearest in front of it. */
function frontalCharge(st: BattleState, side: SideIndex): void {
  for (const f of st.formations) {
    if (f.side !== side || f.soldiers <= 0 || f.activity === 'routing' || f.engagedWith.length > 0) continue;
    let best = -1;
    let bd = Infinity;
    for (const e of st.formations) {
      if (e.side === side || e.soldiers <= 0 || e.activity === 'routing' || e.activity === 'surrendered') continue;
      const d = (e.x - f.x) * (e.x - f.x) + (e.z - f.z) * (e.z - f.z);
      if (d < bd) {
        bd = d;
        best = e.index;
      }
    }
    if (best < 0) continue;
    if (f.order.type === 'charge' && f.order.target === best) continue;
    issueBattleCommand(st, side, { kind: 'order', formations: [f.index], order: { type: 'charge', target: best }, queue: false });
  }
}

/** Scripted commander death (the battle.ts commanderFalls effects: side flag + commander_fallen on every formation). */
function killCommander(st: BattleState, side: SideIndex): void {
  const s = st.sides[side];
  if (!s.commanderAlive || s.commanderFormation < 0) return;
  const c = st.formations[s.commanderFormation]!;
  s.commanderAlive = false;
  c.commanderAlive = false;
  st.events.push({ time: st.time, kind: 'commander_fallen', side, formation: c.index, other: null, x: c.x, z: c.z, value: null, text: 'scripted' });
  for (const f of st.formations) if (f.side === side && f.soldiers > 0) addMoraleEvent(f, 'commander_fallen', st.time);
}

/** Wilson score interval (95%) for k successes in n trials. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.959963984540054;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}
