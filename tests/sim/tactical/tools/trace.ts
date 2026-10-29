/**
 * GP-01 evidence trace generator (not a test): runs headless battles with the authoritative formation sim and writes
 * JSON traces that scripts/shots/gp-01.cjs renders into top-down tactical maps and timelines.
 * OWNER: Gameplay Engineer - Tactical Battle Simulation.
 *
 *   node_modules/.bin/vite-node tests/sim/tactical/tools/trace.ts <out.json>
 *
 * Traces: 'river' (1,000-soldier river crossing, AI vs AI), 'plains' (1,000-soldier balanced skirmish), 'siege'
 * (scripted assault: ram on the main gate, ladders on the east wall, elephants, defenders on the walls).
 */
import { writeFileSync } from 'node:fs';
import type { BattleEventRecord, BattleSetup, BattleState, TerrainQuery } from '../../../../src/core/types';
import { TERRAIN_CLASSES } from '../../../../src/core/types';
import { BATTLE_DT } from '../../../../src/core/constants';
import { Heightfield } from '../../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, issueBattleCommand, stepBattle } from '../../../../src/sim/tactical/battle';
import { battleContext } from '../../../../src/sim/tactical/context';
import { createFortificationSpec } from '../../../../src/sim/tactical/fort';
import { testSetup, TestTerrain } from '../helpers';

interface Frame {
  t: number;
  f: number[][]; // [x, z, facing, width, depth, soldiers, morale, activityCode]
  sides: [number, number, number, number]; // soldiers 0, soldiers 1, avg morale 0, avg morale 1
}

const ACT = ['idle', 'moving', 'engaged', 'shooting', 'charging', 'withdrawing', 'regrouping', 'routing', 'rallying', 'constructing', 'destroyed', 'surrendered'];

function frame(state: BattleState): Frame {
  return {
    t: Math.round((state.time - state.deploymentEndsAt) * 10) / 10,
    f: state.formations.map((f) => [Math.round(f.x * 10) / 10, Math.round(f.z * 10) / 10, Math.round(f.facing * 1000) / 1000, Math.round(f.width * 10) / 10, Math.round(f.depth * 10) / 10, f.soldiers, Math.round(f.morale), ACT.indexOf(f.activity)]),
    sides: [state.sides[0].soldiers, state.sides[1].soldiers, Math.round(state.sides[0].averageMorale), Math.round(state.sides[1].averageMorale)],
  };
}

function grid(state: BattleState, terrain: TerrainQuery): { cols: number; rows: number; minX: number; minZ: number; cell: number; cls: number[] } {
  const g = battleContext(state, terrain).grid;
  const cls: number[] = [];
  for (let c = 0; c < g.n; c++) cls.push(g.road[c] ? TERRAIN_CLASSES.indexOf('road') : g.tclass[c]!);
  return { cols: g.cols, rows: g.rows, minX: g.minX, minZ: g.minZ, cell: g.cell, cls };
}

function run(setup: BattleSetup, terrain: TerrainQuery, opts: { maxSec: number; every: number; commands?: (s: BattleState) => void; begin?: boolean }): unknown {
  const state = createBattle(setup, terrain);
  if (opts.begin) issueBattleCommand(state, 0, { kind: 'begin_battle' });
  const frames: Frame[] = [];
  const events: BattleEventRecord[] = [];
  const out: BattleEventRecord[] = [];
  let volleys = 0;
  const every = Math.round(opts.every / BATTLE_DT);
  for (let i = 0; i < opts.maxSec / BATTLE_DT && !state.outcome; i++) {
    opts.commands?.(state);
    out.length = 0;
    stepBattle(state, BATTLE_DT, terrain, out);
    for (const e of out) {
      if (e.kind === 'volley') volleys++;
      else events.push({ ...e, time: Math.round((e.time - state.deploymentEndsAt) * 10) / 10 });
    }
    if (state.phase !== 'deployment' && state.tick % every === 0) frames.push(frame(state));
  }
  frames.push(frame(state));
  return {
    id: setup.id,
    kind: setup.kind,
    preset: setup.terrain.preset,
    factions: [setup.sides[0].factionId, setup.sides[1].factionId],
    formations: state.formations.map((f) => ({ index: f.index, side: f.side, cls: f.unitClass, name: f.name, start: f.maxSoldiers, commander: f.hasCommander })),
    grid: grid(state, terrain),
    fort: setup.fortification ? { cx: setup.fortification.center.x, cz: setup.fortification.center.z, r: setup.fortification.radius } : null,
    siege: state.siege,
    works: state.works,
    frames,
    events,
    volleys,
    outcome: state.outcome,
  };
}

const outPath = process.argv[2] ?? 'trace.json';
const traces: Record<string, unknown> = {};

{
  const setup = createSkirmishSetup({ seed: 11, preset: 'river_crossing', totalSoldiers: 1000, playerFactionId: 'heartland', enemyFactionId: 'highland', armies: null, playerSide: 0, hour: 17, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true, compositions: ['balanced', 'balanced'] });
  const hf = Heightfield.generate(setup.terrain);
  traces.river = run(setup, hf, { maxSec: 900, every: 2, begin: true });
}
{
  const setup = createSkirmishSetup({ seed: 2, preset: 'plains', totalSoldiers: 1000, playerFactionId: 'heartland', enemyFactionId: 'highland', armies: null, playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true, compositions: ['balanced', 'balanced'] });
  const hf = Heightfield.generate(setup.terrain);
  traces.plains = run(setup, hf, { maxSec: 900, every: 2, begin: true });
}
{
  const terrain = new TestTerrain();
  const fortification = createFortificationSpec({ settlementKind: 'town', fortLevel: 2, fortDefense: 1, center: { x: 0, z: 0 }, radius: 120, defenderSide: 1 });
  const setup = testSetup({
    terrain,
    kind: 'siege',
    fortification,
    attackerSide: 0,
    controllers: ['player', 'ai'],
    seed: 77,
    sides: [
      [
        { cls: 'engineers', x: 35, z: 210, facing: Math.PI },
        { cls: 'engineers', x: 210, z: -30, facing: -Math.PI / 2 },
        { cls: 'spearmen', x: 0, z: 290, facing: Math.PI },
        { cls: 'elite_guards', x: 40, z: 300, facing: Math.PI, commander: true },
        { cls: 'spearmen', x: 240, z: -10, facing: -Math.PI / 2 },
        { cls: 'archers', x: -40, z: 260, facing: Math.PI },
        { cls: 'war_elephants', x: 90, z: 260, facing: Math.PI },
      ],
      [
        { cls: 'archers', x: 30, z: 100, facing: 0 },
        { cls: 'archers', x: -98, z: 50, facing: -Math.PI / 3 },
        { cls: 'spearmen', x: 15, z: 60, facing: 0 },
        { cls: 'spearmen', x: -20, z: -20, facing: 0, n: 90 },
      ],
    ],
  });
  let phase = 0;
  traces.siege = run(setup, terrain, {
    maxSec: 600,
    every: 2,
    commands: (s) => {
      if (s.tick === 1) {
        issueBattleCommand(s, 0, { kind: 'order', formations: [0], order: { type: 'construct', work: 'ram', x: 35, z: 210, facing: Math.PI }, queue: false });
        issueBattleCommand(s, 0, { kind: 'order', formations: [1], order: { type: 'construct', work: 'ladder', x: 128, z: -22, facing: -Math.PI / 2 }, queue: false });
        issueBattleCommand(s, 0, { kind: 'order', formations: [5], order: { type: 'skirmish', target: 7 }, queue: false });
        issueBattleCommand(s, 0, { kind: 'order', formations: [6], order: { type: 'move_to', x: 36, z: 142, facing: Math.PI + 0.26, run: false }, queue: false });
      }
      if (phase === 0 && s.siege!.segments.some((g) => g.ladder)) {
        phase = 1;
        issueBattleCommand(s, 0, { kind: 'order', formations: [4], order: { type: 'attack_target', target: 10, run: false }, queue: false });
      }
      if (phase <= 1 && s.siege!.breaches.length > 0) {
        phase = 2;
        const seg = s.siege!.breaches[0]!;
        const a = ((seg + 0.5) / 12) * Math.PI * 2;
        issueBattleCommand(s, 0, { kind: 'order', formations: [2, 3], order: { type: 'move_to', x: Math.sin(a) * 92, z: Math.cos(a) * 92, facing: a + Math.PI, run: true }, queue: false });
      }
    },
  });
}

writeFileSync(outPath, JSON.stringify(traces));
const summary = Object.entries(traces).map(([k, v]) => {
  const t = v as { frames: unknown[]; events: unknown[]; outcome: { winner: number | null; reason: string; durationSec: number } | null };
  return `${k}: ${t.frames.length} frames, ${t.events.length} events, outcome ${t.outcome ? `${t.outcome.winner} ${t.outcome.reason} ${(t.outcome.durationSec / 60).toFixed(1)} min` : 'none'}`;
});
console.log(`[trace] wrote ${outPath}\n  ${summary.join('\n  ')}`);
