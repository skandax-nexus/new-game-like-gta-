/**
 * Battle setup (DESIGN_SPEC §6.1, §5.7, §10.1): battle kinds, deploy zones, formation creation with faction variants,
 * line-order auto-deploy (field) and wall deployment (siege), skirmish setups. OWNER: Gameplay Engineer - Tactical
 * Battle Simulation (GP-01). Baseline by the CTO (zones, auto-deploy, composeArmy kept).
 *
 *  - Kinds: `field` default; `river_crossing` if deep water lies on the line between the armies within 300 m of its
 *    midpoint; `siege` when an army assaults a settlement with fort level >= 1; `ambush` when the defender stands in
 *    forest and the attacker had no scouts (the defender deploys hidden). `battleKindFor()` is the helper for setup
 *    builders (SIM-01); skirmish setups use the preset ('river_crossing' map -> river_crossing, else 'skirmish').
 *  - Deploy zones: two 300 x 220 m rectangles centered 150 m either side of the map center along the axis across the
 *    river [BASE]; siege: the defender inside the wall ring, the attacker 250 m outside the main gate.
 *  - Deployment phase: 60 s world (RULES.battle.deploymentSecWorld) / 30 s skirmish; positions are clamped to the zone.
 *  - Auto-deploy (AI and unplaced formations): elephants front, spears / guards, archers 20 m behind, horse on the
 *    wings, scouts and carts to the rear [BASE]; lines wider than the zone wrap into a second row. Siege defenders put
 *    archers on the walls facing the attacker, spears behind the main gate, horse and carts in reserve.
 */
import type {
  BattleKind,
  BattleSetup,
  BattleState,
  FormationSetup,
  FormationState,
  Rect,
  SideIndex,
  SkirmishSetup,
  TerrainQuery,
  UnitClass,
  Vec2,
} from '../../core/types';
import { UNIT_CLASSES } from '../../core/types';
import { BATTLE_MAP_RESOLUTION, BATTLE_MAP_SIZE, MAX_FORMATIONS_PER_SIDE } from '../../core/constants';
import { deriveSeed } from '../../core/rng';
import { dcos, dsin, facingOf } from '../../core/math';
import { createLocalTerrainSpec, createRegionTerrainSpec, findPresetSite } from '../../core/terrain/heightfield';
import { UNITS } from '../../data/units';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import { DIFFICULTY_DEFS } from '../../data/difficulty';
import { DEFAULT_COMPOSITION_ID, FACTION_DEFAULT_COMPOSITION, SKIRMISH_COMPOSITIONS } from '../../data/skirmish';
import { makeEnvironment } from '../strategic/seasons';
import { formationDims } from './formations';
import { attackerApproach, ringPoint } from './fort';
import { isShooter, variantName, variantStats } from './stats';
import type { BattleContext } from './context';

// ---------------------------------------------------------------------------------------------------
// Kinds and zones
// ---------------------------------------------------------------------------------------------------

/** Unit vector across the river (deploy axis) for a terrain spec. Side 0 deploys on +axis. */
export function deployAxis(setup: Pick<BattleSetup, 'terrain'>): { x: number; z: number } {
  const a = setup.terrain.river.angle;
  return { x: -dsin(a), z: dcos(a) };
}

function clampRect(r: Rect, setup: Pick<BattleSetup, 'terrain'>): Rect {
  const t = setup.terrain;
  const h = t.sizeMeters / 2 - 20;
  const minX = t.centerX - h;
  const maxX = t.centerX + h;
  const minZ = t.centerZ - h;
  const maxZ = t.centerZ + h;
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const cx = Math.min(maxX - w / 2, Math.max(minX + w / 2, (r.minX + r.maxX) / 2));
  const cz = Math.min(maxZ - d / 2, Math.max(minZ + d / 2, (r.minZ + r.maxZ) / 2));
  return { minX: cx - w / 2, minZ: cz - d / 2, maxX: cx + w / 2, maxZ: cz + d / 2 };
}

/**
 * Deploy zone of a side (§6.1). Field / river / ambush: 300 x 220 m, 150 m from the center along the deploy axis
 * [BASE]. Siege (when `fortification` is given): the defender gets the square inside the wall ring, the attacker a
 * 300 x 220 m rectangle centered 250 m outside the main gate.
 */
export function deployZoneFor(setup: Pick<BattleSetup, 'terrain'> & Partial<Pick<BattleSetup, 'fortification' | 'attackerSide'>>, side: SideIndex): Rect {
  const t = setup.terrain;
  const fort = setup.fortification ?? null;
  if (fort) {
    if (side === fort.defenderSide) {
      const h = fort.radius * 0.68;
      return { minX: fort.center.x - h, minZ: fort.center.z - h, maxX: fort.center.x + h, maxZ: fort.center.z + h };
    }
    const a = attackerApproach({ terrain: t, fortification: fort, attackerSide: setup.attackerSide ?? ((1 - fort.defenderSide) as SideIndex) });
    const cx = fort.center.x + dsin(a) * (fort.radius + 250);
    const cz = fort.center.z + dcos(a) * (fort.radius + 250);
    return clampRect({ minX: cx - 150, minZ: cz - 110, maxX: cx + 150, maxZ: cz + 110 }, setup);
  }
  const a = t.river.angle;
  const ax = -dsin(a);
  const az = dcos(a);
  const sign = side === 0 ? 1 : -1;
  const cx = t.centerX + ax * 150 * sign;
  const cz = t.centerZ + az * 150 * sign;
  return { minX: cx - 150, minZ: cz - 110, maxX: cx + 150, maxZ: cz + 110 };
}

/**
 * Battle kind from the engagement circumstances (§6.1 triggers). `a` / `b`: the two armies' positions (attacker,
 * defender). Siege wins over the others; then river crossing; then ambush; else field.
 */
export function battleKindFor(opts: {
  terrain: TerrainQuery;
  attacker: Vec2;
  defender: Vec2;
  assaultFortLevel: number;
  defenderInForest: boolean;
  attackerHasScouts: boolean;
}): BattleKind {
  if (opts.assaultFortLevel >= 1) return 'siege';
  const { attacker: a, defender: b } = opts;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const steps = Math.max(1, Math.ceil(len / 8));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + (dx * i) / steps;
    const z = a.z + (dz * i) / steps;
    if ((x - mx) * (x - mx) + (z - mz) * (z - mz) > 300 * 300) continue;
    if (opts.terrain.inBounds(x, z) && opts.terrain.terrainClassAt(x, z) === 'deep_water') return 'river_crossing';
  }
  if (opts.defenderInForest && !opts.attackerHasScouts) return 'ambush';
  return 'field';
}

// ---------------------------------------------------------------------------------------------------
// Formations
// ---------------------------------------------------------------------------------------------------

const LINE_ORDER: Record<UnitClass, number> = {
  war_elephants: 0,
  spearmen: 1,
  elite_guards: 1,
  archers: 2,
  chariots: 3,
  cavalry: 3,
  scouts: 4,
  engineers: 5,
  supply_train: 5,
};
/** Line depth offsets (m, + = toward the enemy) per LINE_ORDER [BASE]. */
const LINE_DEPTH = [40, 20, 0, 10, -30, -60];

/** Formation state for a setup entry; faction variant stats and names applied (§5.7). */
export function makeFormation(index: number, side: SideIndex, fs: FormationSetup, sideSupply: number, factionId: string): FormationState {
  const def = UNITS[fs.unitClass];
  const st = variantStats(factionId, fs.unitClass);
  const shape = fs.shape && def.allowedShapes.includes(fs.shape) ? fs.shape : def.defaultShape;
  const dims = formationDims(fs.unitClass, fs.soldiers, shape);
  return {
    index,
    side,
    unitClass: fs.unitClass,
    name: fs.name ?? variantName(factionId, fs.unitClass) ?? def.name,
    armyUnitId: fs.armyUnitId,
    soldiers: fs.soldiers,
    maxSoldiers: fs.soldiers,
    damagePool: 0,
    killed: 0,
    captured: 0,
    kills: 0,
    x: fs.x ?? 0,
    z: fs.z ?? 0,
    facing: fs.facing ?? 0,
    vx: 0,
    vz: 0,
    shape,
    files: dims.files,
    ranks: dims.ranks,
    width: dims.width,
    depth: dims.depth,
    order: { type: 'hold' },
    queue: [],
    intent: null,
    stance: def.category === 'ranged' ? 'skirmish' : fs.unitClass === 'engineers' || fs.unitClass === 'supply_train' ? 'defensive' : 'aggressive',
    activity: 'idle',
    engagedWith: [],
    target: -1,
    morale: fs.morale,
    cohesion: 1,
    fatigue: fs.fatigue,
    supply: Math.min(fs.supply, sideSupply),
    experience: fs.experience,
    ammo: st.ammo,
    reload: 0,
    hasCommander: fs.hasCommander,
    commanderAlive: fs.hasCommander,
    leadership: 0.6,
    moraleEvents: [],
    moraleBreakdown: null,
    lastHitTime: -100,
    spotted: true,
    workProgress: 0,
    rallies: 0,
    shapeChangeUntil: 0,
    panicUntil: 0,
    rallyingUntil: 0,
    disengageUntil: 0,
    chargeRun: 0,
    orderTime: 0,
    hidden: false,
  };
}

function zoneCenter(z: Rect): Vec2 {
  return { x: (z.minX + z.maxX) / 2, z: (z.minZ + z.maxZ) / 2 };
}

/** Facing of a side toward the enemy deploy zone. */
export function sideFacing(setup: BattleSetup, side: SideIndex): number {
  const a = zoneCenter(setup.sides[side].deployZone);
  const b = zoneCenter(setup.sides[(1 - side) as SideIndex].deployZone);
  if (Math.abs(b.x - a.x) + Math.abs(b.z - a.z) < 1) {
    const ax = deployAxis(setup);
    const sign = side === 0 ? 1 : -1;
    return facingOf(-ax.x * sign, -ax.z * sign);
  }
  return facingOf(b.x - a.x, b.z - a.z);
}

/** Place a formation, nudged out of water toward its own rear and kept on the map. */
export function placeFormation(f: FormationState, x: number, z: number, facing: number, terrain: TerrainQuery): void {
  let px = x;
  let pz = z;
  for (let i = 0; i < 40 && terrain.isWater(px, pz); i++) {
    px -= dsin(facing) * 8;
    pz -= dcos(facing) * 8;
  }
  const b = terrain.bounds;
  f.x = Math.min(b.maxX - 20, Math.max(b.minX + 20, px));
  f.z = Math.min(b.maxZ - 20, Math.max(b.minZ + 20, pz));
  f.facing = facing;
}

/** Auto-deploy formations without explicit positions (line order [BASE]; siege defenders on the walls). */
export function autoDeploy(state: BattleState, ctx: BattleContext, side: SideIndex, terrain: TerrainQuery): void {
  const setup = state.setup;
  const zone = setup.sides[side].deployZone;
  const own: FormationState[] = [];
  let k = 0;
  for (const f of state.formations) {
    if (f.side !== side) continue;
    const fs = setup.sides[side].formations[k++];
    if (fs && fs.x !== null && fs.z !== null) continue;
    own.push(f);
  }
  if (!own.length) return;
  const g = ctx.fort;
  if (g && side === g.defenderSide) {
    deployDefenders(state, ctx, own, terrain);
    return;
  }
  const c = zoneCenter(zone);
  const facing = sideFacing(setup, side);
  const rightX = -dcos(facing);
  const rightZ = dsin(facing);
  const fwdX = dsin(facing);
  const fwdZ = dcos(facing);
  const maxWidth = Math.max(60, zone.maxX - zone.minX - 20);
  const lines = new Map<number, FormationState[]>();
  for (const f of own) {
    const line = LINE_ORDER[f.unitClass];
    const arr = lines.get(line) ?? [];
    arr.push(f);
    lines.set(line, arr);
  }
  for (const [line, arr] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
    const depth = LINE_DEPTH[line] ?? 0;
    if (line === 3) {
      // Mounted wings: alternate left/right of the main line.
      arr.forEach((f, i) => {
        const wing = i % 2 === 0 ? 1 : -1;
        const off = 95 + Math.floor(i / 2) * (f.width + 10);
        placeFormation(f, c.x + rightX * off * wing + fwdX * depth, c.z + rightZ * off * wing + fwdZ * depth, facing, terrain);
      });
      continue;
    }
    // Split into rows no wider than the zone (rear rows 30 m behind).
    let row = 0;
    let i = 0;
    while (i < arr.length) {
      let width = -8;
      let j = i;
      while (j < arr.length && (j === i || width + arr[j]!.width + 8 <= maxWidth)) {
        width += arr[j]!.width + 8;
        j++;
      }
      let off = -width / 2;
      const d = depth - row * 30;
      for (let q = i; q < j; q++) {
        const f = arr[q]!;
        const lateral = off + f.width / 2;
        off += f.width + 8;
        placeFormation(f, c.x + rightX * lateral + fwdX * d, c.z + rightZ * lateral + fwdZ * d, facing, terrain);
      }
      i = j;
      row++;
    }
  }
}

function deployDefenders(state: BattleState, ctx: BattleContext, own: FormationState[], terrain: TerrainQuery): void {
  const g = ctx.fort!;
  const p: Vec2 = { x: 0, z: 0 };
  const walls: FormationState[] = [];
  const gate: FormationState[] = [];
  const reserve: FormationState[] = [];
  for (const f of own) {
    const st = variantStats(state.setup.sides[f.side].factionId, f.unitClass);
    if (UNITS[f.unitClass].category === 'ranged' && isShooter(st)) walls.push(f);
    else if (f.unitClass === 'spearmen' || f.unitClass === 'elite_guards' || f.unitClass === 'engineers') gate.push(f);
    else reserve.push(f);
  }
  // Archers on the wall walk, fanning out from the main gate.
  walls.forEach((f, i) => {
    const slot = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2);
    const a = g.mainAngle + (slot * (f.width + 10)) / g.radius;
    ringPoint(g, a, g.radius - 9 - f.depth / 2, p);
    placeFormation(f, p.x, p.z, a, terrain);
  });
  // Spears and guards in lines behind the main gate.
  gate.forEach((f, i) => {
    const row = Math.floor(i / 3);
    const col = (i % 3) - 1;
    const r = g.radius - 32 - row * 28;
    ringPoint(g, g.mainAngle, r, p);
    const rx = -dcos(g.mainAngle);
    const rz = dsin(g.mainAngle);
    placeFormation(f, p.x + rx * col * (f.width + 8), p.z + rz * col * (f.width + 8), g.mainAngle, terrain);
  });
  // Reserve near the center, facing the gate.
  reserve.forEach((f, i) => {
    const col = (i % 4) - 1.5;
    const row = Math.floor(i / 4);
    ringPoint(g, g.mainAngle, Math.max(0, g.radius * 0.25 - row * 25), p);
    const rx = -dcos(g.mainAngle);
    const rz = dsin(g.mainAngle);
    placeFormation(f, p.x + rx * col * (f.width + 10), p.z + rz * col * (f.width + 10), g.mainAngle, terrain);
  });
}

// ---------------------------------------------------------------------------------------------------
// Skirmish setup
// ---------------------------------------------------------------------------------------------------

/**
 * Split one class budget into formations (§10.1): k = max(1, round(budget / per)), raised to ceil(budget / per) when
 * budget / k would overfill a formation; the budget is spread evenly over the k formations (sizes differ by at most
 * one man, each <= per). There is never a separate remainder formation, so with k >= 2 every formation holds at
 * least half of `per`; `room` caps k at the formations left under MAX_FORMATIONS_PER_SIDE and the rest is dropped.
 */
function splitClassBudget(cls: UnitClass, budget: number, room: number, out: { unitClass: UnitClass; soldiers: number }[]): void {
  if (budget <= 0 || room <= 0) return;
  const per = UNITS[cls].stats.menPerFormation;
  let k = Math.max(1, Math.round(budget / per));
  if (budget / k > per) k = Math.ceil(budget / per);
  k = Math.min(k, room);
  const used = Math.min(budget, k * per);
  const base = Math.floor(used / k);
  const extra = used - base * k;
  for (let i = 0; i < k; i++) out.push({ unitClass: cls, soldiers: base + (i < extra ? 1 : 0) });
}

/**
 * Formations for a skirmish army from a composition (DESIGN_SPEC §10.1). Classes outside the faction roster are
 * skipped and the weights renormalized; the side budget is apportioned to classes by largest remainder (the class
 * budgets sum to exactly `total`); a class whose budget is below half a formation is dropped unless it is spearmen
 * or archers (which may field one sole small formation); each class is split by `splitClassBudget`, so no formation
 * is created below half strength. The total never exceeds `total`.
 */
export function composeArmy(total: number, factionId: string, compositionId: string): { unitClass: UnitClass; soldiers: number }[] {
  const comp = SKIRMISH_COMPOSITIONS.find((c) => c.id === compositionId) ?? SKIRMISH_COMPOSITIONS[0]!;
  const roster = new Set(FACTIONS[factionId]?.roster ?? UNIT_CLASSES);
  const budgetTotal = Math.max(0, Math.floor(total));
  const out: { unitClass: UnitClass; soldiers: number }[] = [];
  const classes: UnitClass[] = [];
  const weights: number[] = [];
  let sumW = 0;
  for (const cls of UNIT_CLASSES) {
    const w = roster.has(cls) ? (comp.weights[cls] ?? 0) : 0;
    if (w <= 0) continue;
    classes.push(cls);
    weights.push(w);
    sumW += w;
  }
  // Largest-remainder apportionment (ties: earlier class in UNIT_CLASSES order).
  const budgets = weights.map((w) => Math.floor((budgetTotal * w) / sumW));
  let left = budgetTotal - budgets.reduce((a, b) => a + b, 0);
  const byRemainder = classes.map((_, i) => i).sort((a, b) => {
    const ra = (budgetTotal * weights[a]!) / sumW - budgets[a]!;
    const rb = (budgetTotal * weights[b]!) / sumW - budgets[b]!;
    return rb - ra || a - b;
  });
  for (let j = 0; left > 0 && j < byRemainder.length; j++, left--) budgets[byRemainder[j]!]!++;
  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i]!;
    const budget = budgets[i]!;
    if (budget < UNITS[cls].stats.menPerFormation * 0.5 && cls !== 'spearmen' && cls !== 'archers') continue;
    splitClassBudget(cls, budget, MAX_FORMATIONS_PER_SIDE - out.length, out);
  }
  if (out.length === 0) splitClassBudget('spearmen', Math.max(1, budgetTotal), MAX_FORMATIONS_PER_SIDE, out);
  return out;
}

/** Build a complete BattleSetup for a skirmish (terrain window chosen by preset; 30 s deployment, 40 min limit). */
export function createSkirmishSetup(opts: SkirmishSetup): BattleSetup {
  const seed = opts.seed >>> 0;
  const region = createRegionTerrainSpec(deriveSeed(seed, 'skirmish-terrain'));
  const site = findPresetSite(region, opts.preset);
  const terrain = createLocalTerrainSpec(region, site.x, site.z, BATTLE_MAP_SIZE, BATTLE_MAP_RESOLUTION, opts.preset);
  const perSide = Math.max(2, Math.floor(opts.totalSoldiers / 2));
  const factionOf = (side: SideIndex): string => (side === opts.playerSide ? opts.playerFactionId : opts.enemyFactionId);
  const compOf = (side: SideIndex): string => {
    const c = opts.compositions?.[side === opts.playerSide ? 0 : 1];
    return c ?? FACTION_DEFAULT_COMPOSITION[factionOf(side)] ?? DEFAULT_COMPOSITION_ID;
  };
  const armies = opts.armies ?? [
    { factionId: factionOf(0), formations: composeArmy(perSide, factionOf(0), compOf(0)) },
    { factionId: factionOf(1), formations: composeArmy(perSide, factionOf(1), compOf(1)) },
  ];
  const partial = { terrain };
  const mkSide = (side: SideIndex): BattleSetup['sides'][number] => {
    const a = armies[side]!;
    const isPlayer = side === opts.playerSide && !opts.aiVsAi;
    const aiBonus = side === opts.playerSide ? 0 : (DIFFICULTY_DEFS[opts.difficulty]?.aiCommanderSkill ?? 0);
    return {
      factionId: a.factionId,
      armyIds: [],
      commanderId: null,
      commanderName: side === opts.playerSide ? 'You' : 'Enemy General',
      commanderSkill: Math.max(0, Math.min(20, 10 + aiBonus)),
      controller: isPlayer ? ('player' as const) : ('ai' as const),
      aiPersonality: FACTIONS[a.factionId]?.aiPersonality ?? 'opportunist',
      difficulty: opts.difficulty,
      formations: a.formations.map(
        (f): FormationSetup => ({
          unitClass: f.unitClass,
          soldiers: f.soldiers,
          experience: 0.2,
          morale: variantStats(a.factionId, f.unitClass).baseMorale,
          fatigue: 0,
          supply: 1,
          name: null,
          x: null,
          z: null,
          facing: null,
          shape: null,
          hasCommander: false,
          armyUnitId: null,
        }),
      ),
      deployZone: deployZoneFor(partial, side),
      supply: 1,
      aggression: null,
    };
  };
  const sides: BattleSetup['sides'] = [mkSide(0), mkSide(1)];
  return {
    id: `skirmish_${seed}`,
    seed,
    kind: opts.preset === 'river_crossing' ? 'river_crossing' : 'skirmish',
    terrain,
    fortification: null,
    environment: makeEnvironment(opts.hour, opts.season, opts.weather),
    sides,
    attackerSide: 0,
    timeLimitSec: RULES.battle.timeLimitSecSkirmish,
    objectives: [],
    deploymentSec: RULES.battle.deploymentSecSkirmish,
    origin: { kind: 'skirmish' },
  };
}
