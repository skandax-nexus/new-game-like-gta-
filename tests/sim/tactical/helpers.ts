/**
 * Test helpers for the tactical battle sim (GP-01). OWNER: Gameplay Engineer - Tactical Battle Simulation.
 * A synthetic TerrainQuery (flat by default; terrain classes / heights from callbacks) and setup builders that place
 * formations explicitly, so worked examples and order tests are exact and fast.
 */
import type {
  BattleEventRecord,
  BattleKind,
  BattleSetup,
  BattleState,
  Biome,
  FormationSetup,
  FormationShape,
  FortificationSpec,
  Rect,
  SideIndex,
  TerrainClass,
  TerrainQuery,
  TerrainSpec,
  UnitClass,
  Vec3,
  WeatherKind,
} from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { makeEnvironment } from '../../../src/sim/strategic/seasons';
import { createBattle, deployZoneFor, stepBattle } from '../../../src/sim/tactical/battle';
import { battleContext } from '../../../src/sim/tactical/context';
import type { BattleContext } from '../../../src/sim/tactical/context';
import { UNITS } from '../../../src/data/units';

export interface TestTerrainOptions {
  size?: number;
  classAt?: (x: number, z: number) => TerrainClass;
  heightAt?: (x: number, z: number) => number;
}

/** Synthetic terrain: square map centered on (0, 0); water classes report depth 2 (deep) / 0.7 (shallow). */
export class TestTerrain implements TerrainQuery {
  readonly spec: TerrainSpec;
  readonly bounds: Rect;
  private readonly cls: (x: number, z: number) => TerrainClass;
  private readonly h: (x: number, z: number) => number;

  constructor(opts: TestTerrainOptions = {}) {
    const size = opts.size ?? 1024;
    this.spec = {
      seed: 1,
      preset: 'plains',
      sizeMeters: size,
      resolution: 129,
      centerX: 0,
      centerZ: 0,
      reliefMeters: 0,
      waterLevel: 0,
      river: { enabled: false, widthMeters: 0, depthMeters: 0, meander: 0, tributary: false, angle: 0 },
      pads: [],
      detail: 0,
    };
    this.bounds = { minX: -size / 2, minZ: -size / 2, maxX: size / 2, maxZ: size / 2 };
    this.cls = opts.classAt ?? (() => 'open');
    this.h = opts.heightAt ?? (() => 1);
  }

  heightAt(x: number, z: number): number {
    return this.h(x, z);
  }
  normalAt(_x: number, _z: number, out: Vec3): Vec3 {
    out.x = 0;
    out.y = 1;
    out.z = 0;
    return out;
  }
  slopeAt(): number {
    return 0;
  }
  biomeAt(x: number, z: number): Biome {
    const c = this.cls(x, z);
    return c === 'forest' ? 'forest' : c === 'marsh' ? 'marsh' : c === 'deep_water' || c === 'shallow_water' ? 'river' : 'grassland';
  }
  terrainClassAt(x: number, z: number): TerrainClass {
    return this.cls(x, z);
  }
  moistureAt(): number {
    return 0.5;
  }
  fertilityAt(): number {
    return 0.5;
  }
  isWater(x: number, z: number): boolean {
    const c = this.cls(x, z);
    return c === 'deep_water' || c === 'shallow_water';
  }
  waterDepthAt(x: number, z: number): number {
    const c = this.cls(x, z);
    return c === 'deep_water' ? 2 : c === 'shallow_water' ? 0.7 : 0;
  }
  riverDistanceAt(): number {
    return Infinity;
  }
  inBounds(x: number, z: number): boolean {
    return x >= this.bounds.minX && x <= this.bounds.maxX && z >= this.bounds.minZ && z <= this.bounds.maxZ;
  }
}

export interface TestFormation {
  cls: UnitClass;
  n?: number;
  x: number;
  z: number;
  /** Radians (0 = facing +Z). */
  facing?: number;
  shape?: FormationShape;
  morale?: number;
  exp?: number;
  fatigue?: number;
  supply?: number;
  commander?: boolean;
}

export interface TestSetupOptions {
  /** Side 0 and side 1 formations. */
  sides: [TestFormation[], TestFormation[]];
  /** Factions per side; defaults pick factions without variants on the common classes ('forest', 'citystates'). */
  factions?: [string, string];
  terrain?: TerrainQuery;
  kind?: BattleKind;
  fortification?: FortificationSpec | null;
  deploymentSec?: number;
  weather?: WeatherKind;
  hour?: number;
  seed?: number;
  controllers?: ['player' | 'ai', 'player' | 'ai'];
  timeLimitSec?: number | null;
  attackerSide?: SideIndex;
  commanderSkill?: number;
}

export function testSetup(o: TestSetupOptions): BattleSetup {
  const terrain = o.terrain ?? new TestTerrain();
  const factions = o.factions ?? ['forest', 'citystates'];
  const partial = { terrain: terrain.spec, fortification: o.fortification ?? null, attackerSide: o.attackerSide ?? 0 };
  const side = (s: SideIndex): BattleSetup['sides'][number] => ({
    factionId: factions[s]!,
    armyIds: [],
    commanderId: null,
    commanderName: `Commander ${s}`,
    commanderSkill: o.commanderSkill ?? 0,
    controller: o.controllers?.[s] ?? 'player',
    aiPersonality: 'opportunist',
    difficulty: 'normal',
    formations: o.sides[s].map(
      (f): FormationSetup => ({
        unitClass: f.cls,
        soldiers: f.n ?? UNITS[f.cls].stats.menPerFormation,
        experience: f.exp ?? 0,
        morale: f.morale ?? UNITS[f.cls].stats.baseMorale,
        fatigue: f.fatigue ?? 0,
        supply: f.supply ?? 1,
        name: null,
        x: f.x,
        z: f.z,
        facing: f.facing ?? (s === 0 ? Math.PI : 0),
        shape: f.shape ?? null,
        hasCommander: !!f.commander,
        armyUnitId: null,
      }),
    ),
    deployZone: deployZoneFor(partial, s),
    supply: 1,
    aggression: null,
  });
  return {
    id: `test_${o.seed ?? 1}`,
    seed: o.seed ?? 1,
    kind: o.kind ?? 'field',
    terrain: terrain.spec,
    fortification: o.fortification ?? null,
    environment: makeEnvironment(o.hour ?? 10, 'sharad', o.weather ?? 'clear'),
    sides: [side(0), side(1)],
    attackerSide: o.attackerSide ?? 0,
    timeLimitSec: o.timeLimitSec === undefined ? 3600 : o.timeLimitSec,
    objectives: [],
    deploymentSec: o.deploymentSec ?? 0,
    origin: { kind: 'skirmish' },
  };
}

export interface TestBattle {
  state: BattleState;
  terrain: TerrainQuery;
  ctx: BattleContext;
  events: BattleEventRecord[];
}

/** Create a battle from test options (explicit positions; both sides player-controlled unless set). */
export function testBattle(o: TestSetupOptions): TestBattle {
  const terrain = o.terrain ?? new TestTerrain();
  const setup = testSetup({ ...o, terrain });
  const state = createBattle(setup, terrain);
  return { state, terrain, ctx: battleContext(state, terrain), events: [] };
}

/** Step for `seconds` of battle time (or until `until` returns true / the battle ends). Collects events. */
export function runFor(b: TestBattle, seconds: number, until?: (s: BattleState) => boolean): void {
  const steps = Math.round(seconds / BATTLE_DT);
  const out: BattleEventRecord[] = [];
  for (let i = 0; i < steps && !b.state.outcome; i++) {
    out.length = 0;
    stepBattle(b.state, BATTLE_DT, b.terrain, out);
    for (const e of out) b.events.push(e);
    if (until?.(b.state)) break;
  }
}

/** HP lost by a formation so far (killed x hp + pending pool). */
export function hpLost(b: TestBattle, index: number): number {
  const f = b.state.formations[index]!;
  return f.killed * b.ctx.stats[index]!.hp + f.damagePool;
}

export function within(actual: number, expected: number, tol = 0.1): boolean {
  return Math.abs(actual - expected) <= Math.abs(expected) * tol;
}
