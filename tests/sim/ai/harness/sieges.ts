/**
 * Siege battle scenarios for the battle AI (SIM-02 review round 1): shared by tests/sim/ai/siege.test.ts and the
 * siege-watch dev tool. OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 * A town of radius 120 m at the origin (fort level 2: mud-brick walls 167 HP a segment, 2 gates of 251 HP, 12 towers),
 * the besiegers coming from +Z. Real battles (createBattle / stepBattle) on the flat test terrain.
 *  - 'engineers': 3 spears, 2 archers, 2 engineers, 1 horse against 2 archers, 2 spears and engineers.
 *  - 'elephants': the second engineer formation replaced by war elephants.
 *  - 'ram_only': 3 spears, 2 archers, 1 engineer formation, 1 horse (the one engineer formation builds the ram).
 * `summarize` follows a battle to its end and reports what the plan did (the facts the end-to-end tests check).
 */
import type { BattleEventRecord, BattleState, SideIndex } from '../../../../src/core/types';
import { BATTLE_DT } from '../../../../src/core/constants';
import { stepBattle } from '../../../../src/sim/tactical/battle';
import { createFortificationSpec, distFromCenter } from '../../../../src/sim/tactical/fort';
import { testBattle } from '../../tactical/helpers';
import type { TestBattle, TestFormation } from '../../tactical/helpers';

export type SiegeVariant = 'engineers' | 'elephants' | 'ram_only';
export const SIEGE_VARIANTS: readonly SiegeVariant[] = ['engineers', 'elephants', 'ram_only'];

export const TOWN_RADIUS = 120;

export function townFort(): ReturnType<typeof createFortificationSpec> {
  return createFortificationSpec({ settlementKind: 'town', fortLevel: 2, fortDefense: 1, center: { x: 0, z: 0 }, radius: TOWN_RADIUS, defenderSide: 1 });
}

/** The garrison of the scenarios: 2 archers on the walls, 2 spears, 1 engineer formation. */
export const GARRISON: TestFormation[] = [
  { cls: 'archers', x: 0, z: 80 },
  { cls: 'archers', x: 40, z: 60 },
  { cls: 'spearmen', x: 0, z: 40 },
  { cls: 'spearmen', x: -30, z: 30 },
  { cls: 'engineers', x: 0, z: 0 },
];

export function besiegers(variant: SiegeVariant): TestFormation[] {
  const out: TestFormation[] = [
    { cls: 'spearmen', x: -40, z: 420 },
    { cls: 'spearmen', x: 0, z: 420 },
    { cls: 'spearmen', x: 40, z: 420 },
    { cls: 'archers', x: -30, z: 460 },
    { cls: 'archers', x: 30, z: 460 },
    { cls: 'engineers', x: -60, z: 480 },
  ];
  if (variant === 'engineers') out.push({ cls: 'engineers', x: 60, z: 480 });
  if (variant === 'elephants') out.push({ cls: 'war_elephants', x: 60, z: 400 });
  out.push({ cls: 'cavalry', x: 120, z: 440 });
  return out;
}

export interface SiegeOptions {
  controllers?: ['player' | 'ai', 'player' | 'ai'];
  timeLimitSec?: number;
  seed?: number;
  attackers?: TestFormation[];
  defenders?: TestFormation[];
}

export function siegeBattle(variant: SiegeVariant, o: SiegeOptions = {}): TestBattle {
  return testBattle({
    kind: 'siege',
    fortification: townFort(),
    attackerSide: 0,
    controllers: o.controllers ?? ['ai', 'ai'],
    timeLimitSec: o.timeLimitSec ?? 1800,
    seed: o.seed ?? 1,
    sides: [o.attackers ?? besiegers(variant), o.defenders ?? GARRISON],
  });
}

/** What happened in a siege battle (seconds of battle time; null = never). */
export interface SiegeSummary {
  outcome: string;
  winner: SideIndex | null;
  minutes: number;
  /** The attacker AI's withdrawal reason (plan memory), if it withdrew. */
  withdrawReason: string | null;
  ramBuilt: number | null;
  /** First time a crewed ram stood within 20 m of a gate. */
  ramAtGate: number | null;
  /** Least distance of a crewed ram to the main gate (m). */
  ramClosest: number;
  gateBroken: number | null;
  breachHoldSince: number | null;
  palisades: number;
  palisadesBuilt: number | null;
  ladders: number;
  /** Least distance of an attacking archer formation to a wall shooter before the ram came within 60 m (m). */
  archerExposure: number;
  /** Attacker archers' soldiers when the ram was first within 60 m of the gate (or at the end). */
  archersAtCommit: number;
  /** Max number of towers garrisoned at once; the towers manned when the main gate was first hit. */
  maxTowersManned: number;
  /** Gate HP regained by repairs (sum of increases). */
  gateRepaired: number;
  /** Defender formations that went out of the walls (> radius + 20 m) at some point. */
  sallies: number;
  losses: [number, number];
  /** Longest stretch (s) a storming attacker formation stood still outside the breach with a way in open. */
  stormerJam: number;
}

/** Run a siege battle to its end (or the time limit) and summarize it. `log` prints every `every` s. */
export function summarize(b: TestBattle, maxSec = 1800, log?: (line: string) => void, every = 30): SiegeSummary {
  const st = b.state;
  const sg = st.siege!;
  const out: BattleEventRecord[] = [];
  const start = st.formations.map((f) => f.soldiers);
  const sum: SiegeSummary = {
    outcome: 'running',
    winner: null,
    minutes: 0,
    withdrawReason: null,
    ramBuilt: null,
    ramAtGate: null,
    ramClosest: Infinity,
    gateBroken: null,
    breachHoldSince: null,
    palisades: 0,
    palisadesBuilt: null,
    ladders: 0,
    archerExposure: Infinity,
    archersAtCommit: 0,
    maxTowersManned: 0,
    gateRepaired: 0,
    sallies: 0,
    losses: [0, 0],
    stormerJam: 0,
  };
  const g = { x: 0, z: 0 };
  const gateAt = (k: number): { x: number; z: number } => {
    const a = b.ctx.fort!.gateAngle[k]!;
    g.x = Math.sin(a) * TOWN_RADIUS;
    g.z = Math.cos(a) * TOWN_RADIUS;
    return g;
  };
  const sallied = new Set<number>();
  let committed = false;
  let lastGateHp = sg.gates.map((x) => x.hp);
  const still = new Map<number, number>();
  let next = 0;
  while (!st.outcome && st.time < maxSec) {
    out.length = 0;
    stepBattle(st, BATTLE_DT, b.terrain, out);
    const t = st.time;
    for (const e of out) if (e.kind === 'gate_breached' && sum.gateBroken === null) sum.gateBroken = t;
    sg.gates.forEach((x, k) => {
      if (x.hp > lastGateHp[k]! && x.hp > 0) sum.gateRepaired += x.hp - lastGateHp[k]!;
    });
    lastGateHp = sg.gates.map((x) => x.hp);
    if (sg.breachHold && sum.breachHoldSince === null) sum.breachHoldSince = sg.breachHold.since;
    const manned = sg.towers.filter((x) => x.garrison >= 0).length;
    sum.maxTowersManned = Math.max(sum.maxTowersManned, manned);
    let ramD = Infinity;
    for (const w of st.works) {
      if (w.side !== 0) continue;
      if (w.work === 'ram' && w.progress >= 1) {
        sum.ramBuilt ??= t;
        if (w.formation >= 0) {
          for (let k = 0; k < sg.gates.length; k++) {
            if (sg.gates[k]!.hp <= 0) continue;
            const p = gateAt(k);
            ramD = Math.min(ramD, Math.hypot(w.x - p.x, w.z - p.z));
          }
        }
      }
    }
    sum.ramClosest = Math.min(sum.ramClosest, ramD);
    if (ramD < 20 && sum.ramAtGate === null) sum.ramAtGate = t;
    const pal = st.works.filter((w) => w.side === 0 && w.work === 'palisade' && w.progress >= 1).length;
    if (pal > sum.palisades) sum.palisades = pal;
    if (pal > 0 && sum.palisadesBuilt === null) sum.palisadesBuilt = t;
    sum.ladders = Math.max(sum.ladders, sg.segments.filter((x) => x.ladder).length);
    const archers = st.formations.filter((f) => f.side === 0 && f.unitClass === 'archers');
    if (!committed && (ramD <= 60 || sg.breaches.length > 0 || sum.ladders > 0)) {
      committed = true;
      sum.archersAtCommit = archers.reduce((s, f) => s + f.soldiers, 0);
    }
    if (!committed) {
      for (const a of archers) {
        if (a.soldiers <= 0) continue;
        for (const d of st.formations) {
          if (d.side !== 1 || d.unitClass !== 'archers' || d.soldiers <= 0) continue;
          sum.archerExposure = Math.min(sum.archerExposure, Math.hypot(a.x - d.x, a.z - d.z));
        }
      }
    }
    for (const f of st.formations) {
      if (f.side === 1 && f.soldiers > 0 && distFromCenter(b.ctx.fort!, f.x, f.z) > TOWN_RADIUS + 20) sallied.add(f.index);
      // A storming formation (an attacker melee block with a way in open) standing still outside the walls.
      if (f.side === 0 && sg.breaches.length > 0 && (f.unitClass === 'spearmen' || f.unitClass === 'elite_guards') && f.soldiers > 0 && f.activity !== 'routing') {
        const outside = distFromCenter(b.ctx.fort!, f.x, f.z) > TOWN_RADIUS - 3;
        const stuck = outside && f.engagedWith.length === 0 && f.order.type === 'move_to' && f.vx * f.vx + f.vz * f.vz < 0.04;
        const s0 = still.get(f.index) ?? 0;
        const s1 = stuck ? s0 + BATTLE_DT : 0;
        still.set(f.index, s1);
        sum.stormerJam = Math.max(sum.stormerJam, s1);
      }
    }
    if (log && t >= next) {
      next += every;
      const mem = st.sides[0].aiMemory;
      const works = st.works.map((w) => `${w.work}[s${w.side}] ${(w.progress * 100).toFixed(0)}% hp ${w.hp.toFixed(0)} @${w.x.toFixed(0)},${w.z.toFixed(0)} crew ${w.formation}`).join(', ');
      log(`t=${t.toFixed(0)} phase ${String(mem.sgPhase ?? '-')} gates ${sg.gates.map((x) => x.hp.toFixed(0)).join('/')} breaches ${sg.breaches.length} towers ${sg.towers.map((x) => x.garrison).join(',')} hold ${JSON.stringify(sg.breachHold ?? null)} works ${works}`);
      log(`   ${st.formations.map((f) => `${f.index} ${f.unitClass.slice(0, 3)}${f.side} @${f.x.toFixed(0)},${f.z.toFixed(0)} ${f.shape.slice(0, 2)} ${f.order.type} ${f.activity} n${f.soldiers} m${f.morale.toFixed(0)}${f.ammo > 0 || f.unitClass === 'archers' ? ` a${f.ammo}` : ''}`).join(' | ')}`);
    }
  }
  sum.outcome = st.outcome ? st.outcome.reason : 'running';
  sum.winner = st.outcome ? st.outcome.winner : null;
  sum.minutes = st.time / 60;
  const wr = st.sides[0].aiMemory.withdrawReason;
  sum.withdrawReason = typeof wr === 'string' ? wr : null;
  if (!committed) sum.archersAtCommit = st.formations.filter((f) => f.side === 0 && f.unitClass === 'archers').reduce((s, f) => s + f.soldiers, 0);
  sum.sallies = sallied.size;
  st.formations.forEach((f, i) => {
    sum.losses[f.side as 0 | 1] += start[i]! - f.soldiers;
  });
  return sum;
}

export function battleState(b: TestBattle): BattleState {
  return b.state;
}
