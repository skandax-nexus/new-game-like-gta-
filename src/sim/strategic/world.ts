/**
 * Strategic world: creation, the hourly tick and command application.
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01). Baseline by the CTO; exported signatures kept.
 *
 * Contract (see docs/ARCHITECTURE.md §Simulation):
 *  - Pure, deterministic, three-free. All randomness from `world.rng` (via `withWorldRng`).
 *  - `tickWorld` advances exactly STRATEGIC_TICK_HOURS (1 game hour). Daily/monthly systems run on
 *    calendar rollovers. Iterate records via sortedKeys() for stable order.
 *  - Commands are applied at the start of a tick, in the given order; AI commands are generated daily.
 *  - Never mutate data/* definitions; copy into state.
 */
import type {
  CharacterState,
  DiplomacyState,
  DynastyState,
  EngagementId,
  EspionageState,
  FactionId,
  FactionLedger,
  FactionState,
  IssuedStrategicCommand,
  ProvinceState,
  RoadEdge,
  RoadGraph,
  RoadNode,
  ScenarioDef,
  SettlementDef,
  SettlementState,
  SimEvent,
  TerrainQuery,
  TerrainSpec,
  TreatyType,
  Vec2,
  VictoryType,
  WorldSetup,
  WorldState,
} from '../../core/types';
import { VICTORY_TYPES } from '../../core/types';
import { STATS_SAMPLE_LIMIT, WORLD_SCHEMA_VERSION } from '../../core/constants';
import { nextWorldId, relationKey, sortedKeys } from '../../core/ids';
import { Rng, rngStateFromSeed } from '../../core/rng';
import { dcos, dsin, TWO_PI } from '../../core/math';
import { getHeightfield } from '../../core/terrain/cache';
import type { Heightfield } from '../../core/terrain/heightfield';
import { resolveSettlementSites, type ResolvedSite } from '../../core/terrain/sites';
import { traceRoad, type RoadTrace } from '../../core/terrain/roads';
import { terrainKey } from '../../core/terrain/cache';
import { RULES } from '../../data/rules';
import { BALANCE } from '../../data/balance';
import { BUILDINGS } from '../../data/buildings';
import { FACTIONS } from '../../data/factions';
import { REGION } from '../../data/region';
import { DEFAULT_SCENARIO_ID, SCENARIOS } from '../../data/campaign';
import { PERSON_NAMES } from '../../data/names';
import { advanceCalendar, createCalendar, floodLevel, makeWeather, seasonOf, totalDays, updateMonsoonDaily, updateWeatherDaily, type CalendarAdvance } from './seasons';
import { addChronicle, pushBattleHistory, withWorldRng } from './state';
import { executeMarketTrade } from './market';
import { updateRoadBlocks } from './network';
import { factionMod } from './modifiers';
import { laborFor } from './economy';
import { updateEconomyDaily, updateEconomyMonthly } from './economy';
import { orderArmy, updateArmiesDaily, updateArmiesHourly, armySoldiers, makeArmy, makeArmyUnit } from './armies';
import { declareWar, makePeace, respondToProposal, proposeTreaty, updateDiplomacyDaily, updateDiplomacyMonthly, createTreaty } from './diplomacy';
import { updatePoliticsDaily, updateCharactersYearly } from './politics';
import { startSpyMission, updateEspionageDaily } from './espionage';
import { checkObjectives, evaluateEventsDaily, resolveEventChoice } from './events';
import { runCampaignAI } from './ai';
import { decideEngagement, stepDistantBattles } from './autoresolve';

// Shared helpers live in state.ts (no import cycles); re-exported for existing callers.
export { addChronicle, pushBattleHistory, withWorldRng };

// ---------------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------------

let regionCache: { terrain: TerrainSpec; sites: ResolvedSite[] } | null = null;
/** Traced road geometry per terrain + endpoints (pure function of static data; saves ~0.3 s per createWorld). */
const roadTraceCache = new Map<string, RoadTrace>();

/**
 * The region terrain spec with settlement flatten pads + resolved settlement sites. Pure and
 * deterministic (data/region.ts); cached. Used by createWorld and by scenes that need the region
 * without a world (menu backdrop, hero mode from the main menu).
 */
export function resolveRegionTerrain(): { terrain: TerrainSpec; sites: ResolvedSite[] } {
  if (!regionCache) {
    const sites = resolveSettlementSites(REGION.terrain, REGION.settlements);
    regionCache = { terrain: { ...REGION.terrain, pads: sites.map((s) => s.pad) }, sites };
  }
  return { terrain: { ...regionCache.terrain, pads: regionCache.terrain.pads.map((p) => ({ ...p })), river: { ...regionCache.terrain.river } }, sites: regionCache.sites.map((s) => ({ ...s, pad: { ...s.pad } })) };
}

const EMPTY_LEDGER: FactionLedger = {
  taxIncome: 0,
  tradeIncome: 0,
  tribute: 0,
  armyUpkeep: 0,
  buildingUpkeep: 0,
  administration: 0,
  construction: 0,
  recruitment: 0,
  other: 0,
  net: 0,
  foodProduced: 0,
  foodConsumed: 0,
};

function zeroVictory(): Record<VictoryType, number> {
  return Object.fromEntries(VICTORY_TYPES.map((v) => [v, 0])) as Record<VictoryType, number>;
}

function defaultLabor(kind: SettlementDef['kind']): SettlementState['laborAllocation'] {
  const d = RULES.population.defaultLabor;
  const src = kind === 'village' ? d.village : kind === 'fort' ? d.fort : d.urban;
  return { farming: src.farming, construction: src.construction, crafts: src.crafts, military: src.military };
}

/** Sum of a building effect x level over a settlement definition's starting buildings. */
function defEffect(def: SettlementDef, key: 'foodCapacity' | 'housing' | 'irrigation' | 'waterAvailability' | 'sanitation'): number {
  let v = 0;
  for (const b of def.buildings) v += (BUILDINGS[b.type].effects[key] ?? 0) * b.level;
  return v;
}

/** Initial settlement (DESIGN_SPEC §7.2 [BASE] values; storage capacity in days of consumption, §7.3.4). */
function makeSettlement(def: SettlementDef, x: number, z: number, owner: FactionId | null, hf: Heightfield, seed: number): SettlementState {
  const pop = def.population;
  const st = RULES.settlement;
  const moisture = hf.moistureAt(x, z);
  const health = 0.8;
  const daily = pop * BALANCE.economy.foodPerPersonPerDay;
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    provinceId: def.provinceId,
    ownerFactionId: owner,
    x,
    z,
    layoutSeed: seed,
    radius: def.kind === 'capital' ? 200 : def.kind === 'city' ? 150 : def.kind === 'village' ? 70 : 110,
    population: pop,
    labor: laborFor(pop, health),
    laborAllocation: defaultLabor(def.kind),
    growthRate: 0.01,
    foodProduction: pop * 0.11,
    foodConsumption: daily,
    foodStored: daily * 75,
    foodCapacity: daily * (RULES.storage.baseDays + defEffect(def, 'foodCapacity')),
    kharif: { sown: 0, growth: 0, health: 1, laborAtSowing: 0 },
    rabi: { sown: 0, growth: 0, health: 1, laborAtSowing: 0 },
    lastHarvest: 0,
    grainPrice: 1,
    waterAvailability: Math.min(1, st.waterBase + moisture * st.waterMoistureWeight + defEffect(def, 'waterAvailability')),
    irrigation: Math.min(1, st.irrigationBase + defEffect(def, 'irrigation')),
    waterInfrastructure: 0.3,
    housing: Math.round(pop * st.initialHousingPerCapita + defEffect(def, 'housing')),
    sanitation: Math.min(1, st.sanitationBase + defEffect(def, 'sanitation')),
    publicOrder: 0.7,
    health,
    wealth: pop * 0.05,
    taxRate: RULES.tax.defaultRate,
    taxIncome: 0,
    tradeIncome: 0,
    tradeVolume: 0,
    recruitmentPotential: Math.round(pop * RULES.recruitment.poolPerCapita),
    recruitPool: Math.round(pop * 0.03),
    loyalty: owner ? 0.65 : 0.5,
    infrastructure: 0.7,
    disasterExposure: { flood: hf.riverDistanceAt(x, z) < 500 ? 0.5 : 0.1, drought: 1 - moisture, fire: 0.15, epidemic: 0.1 },
    damage: 0,
    buildings: def.buildings.map((b) => ({ type: b.type, level: b.level, condition: 1 })),
    construction: [],
    recruitment: [],
    unrest: 0.05,
    rebellionStage: 'calm',
    fortLevel: def.fortLevel,
    wallHp: def.fortLevel * RULES.siege.wallHpPerLevel,
    garrison: [],
    besiegedBy: null,
    siegeDays: 0,
    resources: def.resources.slice(),
    requisitionedFood: 0,
    ownerSinceDay: 0,
    // Contracts v2 (values equal to the v1 -> v2 migration defaults; SIM-01 rules evolve them).
    initialOwnerFactionId: owner,
    occupiedSinceDay: null,
    pendingCapture: null,
    starvationDays: 0,
    revoltSinceDay: null,
    taxRelief: null,
    reliefThisMonth: 0,
    ladderProgress: 0,
    landmarks: [],
  };
}

function provinceBoundary(center: Vec2, points: Vec2[], rng: Rng): Vec2[] {
  let r = 700;
  for (const p of points) {
    const dx = p.x - center.x;
    const dz = p.z - center.z;
    r = Math.max(r, Math.sqrt(dx * dx + dz * dz) + 550);
  }
  const out: Vec2[] = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TWO_PI;
    const rr = r * rng.range(0.85, 1.1);
    out.push({ x: center.x + dsin(a) * rr, z: center.z + dcos(a) * rr });
  }
  return out;
}

function generatedCharacter(world: WorldState, rng: Rng, factionId: FactionId, role: CharacterState['roles'][number], year: number): CharacterState {
  const gender = rng.chance(0.75) ? 'male' : 'female';
  const pool = PERSON_NAMES[gender];
  return {
    id: nextWorldId(world, 'char'),
    name: rng.pick(pool),
    dynastyId: null,
    factionId,
    gender,
    birthYear: year - rng.int(25, 55),
    alive: true,
    deathYear: null,
    health: rng.range(0.6, 1),
    traits: [],
    skills: { martial: rng.int(3, 15), stewardship: rng.int(3, 15), diplomacy: rng.int(3, 15), intrigue: rng.int(3, 15), learning: rng.int(3, 15) },
    roles: [role],
    loyalty: role === 'ruler' ? 1 : rng.range(0.4, 0.9),
    ambition: rng.range(0.2, 0.8),
    interest: rng.pick(['wealth', 'power', 'faith', 'family', 'land', 'learning'] as const),
    opinionOfRuler: role === 'ruler' ? 100 : rng.int(-10, 40),
    spouseId: null,
    parentIds: [],
    childIds: [],
    claim: role === 'ruler' ? 1 : role === 'heir' ? 0.8 : 0,
    locationSettlementId: null,
    armyId: null,
    governsProvinceId: null,
    councilSeat: null,
    prestige: role === 'ruler' ? 50 : 10,
    captiveOf: null,
  };
}

/** Build a fresh world for a scenario or sandbox. Deterministic for a given setup. */
export function createWorld(setup: WorldSetup): WorldState {
  const scenario: ScenarioDef | null =
    setup.kind === 'scenario' ? (SCENARIOS[setup.scenarioId] ?? SCENARIOS[DEFAULT_SCENARIO_ID] ?? null) : null;
  if (setup.kind === 'scenario' && !scenario) throw new Error(`Unknown scenario ${setup.scenarioId}`);
  const sandbox = setup.kind === 'sandbox' ? setup.sandbox : null;
  const seed = (setup.kind === 'scenario' ? (setup.seed ?? scenario?.seed ?? 1) : (sandbox?.seed ?? 1)) >>> 0;
  const playerFactionId = scenario?.playerFactionId ?? sandbox?.playerFactionId ?? 'heartland';
  const factionIds = scenario ? scenario.factionIds.slice() : [playerFactionId, ...(sandbox?.rivalFactionIds ?? [])];
  const inPlay = new Set(factionIds);

  // Terrain: resolve settlement sites, add flatten pads, generate region heightfield.
  const { terrain, sites } = resolveRegionTerrain();
  const hf = getHeightfield(terrain);
  const half = terrain.sizeMeters / 2;

  const startYear = scenario?.startYear ?? -300;
  const startMonth = scenario?.startMonth ?? sandbox?.startMonth ?? 0;
  const calendar = createCalendar(startYear, startMonth);

  const world: WorldState = {
    schema: WORLD_SCHEMA_VERSION,
    seed,
    mode: scenario ? 'campaign' : 'sandbox',
    scenarioId: scenario?.id ?? null,
    sandbox,
    difficulty: setup.kind === 'scenario' ? setup.difficulty : (sandbox?.difficulty ?? 'normal'),
    rng: rngStateFromSeed(seed),
    nextId: 1,
    calendar,
    weather: { ...makeWeather('clear', seasonOf(calendar)), flood: floodLevel(calendar.month, scenario?.monsoonStrength ?? sandbox?.monsoonStrength ?? 1) },
    region: {
      id: REGION.id,
      name: REGION.name,
      terrain,
      bounds: { minX: -half, minZ: -half, maxX: half, maxZ: half },
    },
    playerFactionId,
    factions: {},
    provinces: {},
    settlements: {},
    roads: { nodes: {}, edges: {}, adjacency: {} },
    armies: {},
    depots: {},
    engagements: {},
    characters: {},
    dynasties: {},
    diplomacy: { relations: {}, treaties: {}, proposals: [] },
    espionage: { agents: {}, intel: {}, network: {} },
    events: { pending: [], history: [], flags: {}, cooldowns: {}, scheduled: [], firedOnce: [] },
    victory: { status: 'ongoing', outcomeId: null, objectives: {}, endedDay: null },
    battleHistory: [],
    chronicle: [],
    stats: [],
    // Contracts v2 (CORE-01 compile-fix): this year's monsoon + end-game statistics counters.
    monsoon: { strength: scenario?.monsoonStrength ?? sandbox?.monsoonStrength ?? 1, year: calendar.year, forecast: null },
    statistics: Object.fromEntries(factionIds.map((f) => [f, {}])),
  };
  const rng = new Rng(world.rng);

  // Settlements.
  for (const def of REGION.settlements) {
    const site = sites.find((s) => s.id === def.id);
    if (!site) continue;
    let owner: FactionId | null = def.defaultOwner;
    if (scenario && def.id in scenario.settlementOwners) owner = scenario.settlementOwners[def.id] ?? null;
    if (owner && !inPlay.has(owner)) owner = null;
    world.settlements[def.id] = makeSettlement(def, site.x, site.z, owner, hf, rng.nextU32());
  }

  // Provinces.
  for (const pd of REGION.provinces) {
    const members = REGION.settlements.filter((s) => s.provinceId === pd.id).map((s) => s.id);
    const pts = members.map((id) => world.settlements[id]).filter((s): s is SettlementState => !!s);
    const center = pts.length ? { x: pts.reduce((a, s) => a + s.x, 0) / pts.length, z: pts.reduce((a, s) => a + s.z, 0) / pts.length } : { x: 0, z: 0 };
    const cap = world.settlements[pd.capitalSettlementId];
    const p: ProvinceState = {
      id: pd.id,
      name: pd.name,
      zone: pd.zone,
      ownerFactionId: cap?.ownerFactionId ?? null,
      governorId: null,
      capitalSettlementId: pd.capitalSettlementId,
      settlementIds: members,
      center,
      boundary: provinceBoundary(center, pts, rng),
      fertility: pd.fertility,
      resources: pd.resources.slice(),
      unrest: 0.05,
      rebellionStage: 'calm',
      autonomy: 0,
    };
    world.provinces[pd.id] = p;
  }

  // Roads.
  const roads: RoadGraph = world.roads;
  for (const s of Object.values(world.settlements)) {
    const node: RoadNode = { id: `node_${s.id}`, x: s.x, z: s.z, settlementId: s.id };
    roads.nodes[node.id] = node;
    roads.adjacency[node.id] = [];
  }
  REGION.roads.forEach((rd, i) => {
    const a = world.settlements[rd.from];
    const b = world.settlements[rd.to];
    if (!a || !b) return;
    const key = `${terrainKey(terrain)}|${a.id}|${b.id}`;
    let tr = roadTraceCache.get(key);
    if (!tr) {
      tr = traceRoad(hf, a.x, a.z, b.x, b.z);
      roadTraceCache.set(key, tr);
    }
    const edge: RoadEdge = {
      id: `road_${i}`,
      a: `node_${a.id}`,
      b: `node_${b.id}`,
      quality: rd.quality,
      condition: 1,
      length: tr.length,
      points: tr.points.map((p) => ({ x: p.x, z: p.z })),
      bridge: tr.crossesWater && rd.quality !== 'track',
      ford: tr.crossesWater && rd.quality === 'track',
      blockedBy: null,
    };
    roads.edges[edge.id] = edge;
    roads.adjacency[edge.a]?.push(edge.id);
    roads.adjacency[edge.b]?.push(edge.id);
  });

  // Characters & dynasties.
  if (scenario) {
    for (const c of scenario.characters) {
      world.characters[c.id] = {
        id: c.id,
        name: c.name,
        dynastyId: c.dynastyId,
        factionId: c.factionId,
        gender: c.gender,
        birthYear: startYear - c.age,
        alive: true,
        deathYear: null,
        health: 0.9,
        traits: c.traits.slice(),
        skills: { ...c.skills },
        roles: c.roles.slice(),
        loyalty: c.loyalty,
        ambition: c.ambition,
        interest: c.interest,
        opinionOfRuler: Math.round((c.loyalty - 0.5) * 120),
        spouseId: c.spouseId,
        parentIds: c.parentIds.slice(),
        childIds: [],
        claim: c.roles.includes('ruler') ? 1 : c.roles.includes('heir') ? 0.8 : c.roles.includes('claimant') ? 0.6 : 0,
        locationSettlementId: null,
        armyId: null,
        governsProvinceId: c.governsProvinceId,
        councilSeat: c.councilSeat,
        prestige: c.roles.includes('ruler') ? 50 : 10,
        captiveOf: null,
      };
    }
    for (const c of Object.values(world.characters)) for (const p of c.parentIds) world.characters[p]?.childIds.push(c.id);
    for (const d of scenario.dynasties) {
      const dyn: DynastyState = {
        id: d.id,
        name: d.name,
        factionId: d.factionId,
        headId: d.headId,
        memberIds: Object.values(world.characters)
          .filter((c) => c.dynastyId === d.id)
          .map((c) => c.id),
        prestige: 100,
        legitimacy: 0.6,
        successionLaw: d.successionLaw,
        founderYear: startYear - 80,
        generation: 1,
      };
      world.dynasties[d.id] = dyn;
    }
  }

  // Factions.
  for (const fid of factionIds) {
    const def = FACTIONS[fid];
    if (!def) throw new Error(`Unknown faction ${fid}`);
    const owned = Object.values(world.settlements).filter((s) => s.ownerFactionId === fid);
    const capital =
      owned.find((s) => s.kind === 'capital') ?? owned.find((s) => s.kind === 'city' || s.kind === 'fort') ?? owned[0] ?? null;
    let ruler = Object.values(world.characters).find((c) => c.factionId === fid && c.roles.includes('ruler')) ?? null;
    if (!ruler) {
      ruler = generatedCharacter(world, rng, fid, 'ruler', startYear);
      world.characters[ruler.id] = ruler;
    }
    const heir = Object.values(world.characters).find((c) => c.factionId === fid && c.roles.includes('heir')) ?? null;
    const council: FactionState['council'] = {};
    for (const c of Object.values(world.characters)) if (c.factionId === fid && c.councilSeat) council[c.councilSeat] = c.id;
    const fs: FactionState = {
      id: fid,
      name: def.name,
      archetype: def.archetype,
      isPlayer: fid === playerFactionId,
      alive: true,
      capitalSettlementId: capital?.id ?? null,
      rulerId: ruler.id,
      heirId: heir?.id ?? null,
      dynastyId: ruler.dynastyId,
      treasury: scenario?.treasury[fid] ?? sandbox?.startingTreasury ?? 2000,
      foodReserve: 2000,
      manpower: owned.reduce((a, s) => a + s.recruitPool, 0),
      prestige: 50,
      legitimacy: 0.6,
      stability: 0.6,
      taxPolicy: 'standard',
      council,
      ledger: { ...EMPTY_LEDGER },
      ai: { personality: def.aiPersonality, goals: [], lastPlanHour: -1, threat: {}, memory: {} },
      victoryProgress: zeroVictory(),
      flags: {},
      // Contracts v2 (CORE-01 compile-fix: initial values per DESIGN_SPEC §14.3; rules land with SIM-01).
      age: scenario?.startingAges?.[fid] ?? def.startingAge ?? 'janapada',
      landmarks: [],
      materials: { timber: scenario?.materials?.[fid]?.timber ?? 0, stone: scenario?.materials?.[fid]?.stone ?? 0 },
      policies: { holdReserve: false, rationingUntilDay: null },
      marketPrices: { grain: 1, timber: 1, stone: 1 },
      ghosts: {},
      counterIntel: 0,
      counterIntelUntilDay: null,
      protectCourtUntilDay: null,
      advisorIgnored: { chief_minister: 0, commander: 0, treasurer: 0, spymaster: 0, court_scholar: 0 },
      councilAdvice: [],
      culturePoints: 0,
      prosperityDays: 0,
    };
    world.factions[fid] = fs;
    if (capital) ruler.locationSettlementId = capital.id;
  }
  // Governors.
  for (const c of Object.values(world.characters)) {
    if (c.governsProvinceId && world.provinces[c.governsProvinceId]) world.provinces[c.governsProvinceId]!.governorId = c.id;
  }
  // Owner-dependent settlement values: wall HP (x fortDefense) and recruit pool cap (x recruitmentPool, age bonus).
  for (const id of Object.keys(world.settlements).sort()) {
    const s = world.settlements[id]!;
    s.wallHp = s.fortLevel * RULES.siege.wallHpPerLevel * factionMod(world, s.ownerFactionId, 'fortDefense');
  }

  // Armies.
  if (scenario) {
    for (const a of scenario.armies) {
      const s = world.settlements[a.settlementId];
      if (!s || !world.factions[a.factionId]) continue;
      const army = makeArmy(world, a.id, a.name, a.factionId, s.x + s.radius + 60, s.z + 40, a.units, a.commanderId);
      world.armies[army.id] = army;
      if (a.commanderId && world.characters[a.commanderId]) world.characters[a.commanderId]!.armyId = army.id;
    }
  } else {
    for (const fid of factionIds) {
      const f = world.factions[fid];
      const cap = f?.capitalSettlementId ? world.settlements[f.capitalSettlementId] : null;
      if (!f || !cap) continue;
      const id = nextWorldId(world, 'army');
      world.armies[id] = makeArmy(
        world,
        id,
        `${FACTIONS[fid]?.adjective ?? fid} Host`,
        fid,
        cap.x + cap.radius + 60,
        cap.z,
        [
          { unitClass: 'spearmen', formations: 3 },
          { unitClass: 'archers', formations: 2 },
          { unitClass: 'cavalry', formations: 1 },
          { unitClass: 'supply_train', formations: 1 },
        ],
        f.rulerId,
      );
    }
  }

  // Diplomacy + espionage.
  const dip: DiplomacyState = world.diplomacy;
  const esp: EspionageState = world.espionage;
  for (let i = 0; i < factionIds.length; i++) {
    const a = factionIds[i] as FactionId;
    esp.intel[a] = {};
    esp.network[a] = {};
    for (let j = 0; j < factionIds.length; j++) {
      const b = factionIds[j] as FactionId;
      esp.intel[a]![b] = { level: a === b ? 1 : 0.25, lastUpdatedDay: 0, armiesVisibleUntilDay: null };
      esp.network[a]![b] = a === b ? 1 : 0.1;
      if (j <= i) continue;
      const [x, y] = a < b ? [a, b] : [b, a];
      dip.relations[relationKey(a, b)] = { a: x, b: y, opinion: 0, trust: 0.5, atWar: false, warStartDay: null, warScore: 0, treatyIds: [], grievances: [], warWeariness: 0, truceUntilDay: null };
    }
  }
  if (scenario) {
    for (const r of scenario.relations) {
      const rel = dip.relations[relationKey(r.a, r.b)];
      if (!rel) continue;
      rel.opinion = r.opinion;
      rel.atWar = r.atWar;
      rel.warStartDay = r.atWar ? 0 : null;
      for (const t of r.treaties) createTreaty(world, t as TreatyType, r.a, r.b);
    }
  } else {
    // Sandbox: player starts at war with the first rival so there is conflict to resolve.
    const rival = sandbox?.rivalFactionIds[0];
    if (rival) {
      const rel = dip.relations[relationKey(playerFactionId, rival)];
      if (rel) {
        rel.atWar = true;
        rel.warStartDay = 0;
        rel.opinion = -30;
      }
    }
  }

  // Events + objectives.
  if (scenario) {
    for (const se of scenario.scriptedEvents) {
      world.events.scheduled.push({
        eventId: se.eventId,
        day: se.day,
        scope: { factionId: playerFactionId, settlementId: world.factions[playerFactionId]?.capitalSettlementId ?? null, provinceId: null, characterId: null, armyId: null },
      });
    }
    for (const o of scenario.objectives) world.victory.objectives[o.id] = 'pending';
  }
  world.rng = rng.getState();
  addChronicle(world, null, scenario ? `${scenario.title}: the chronicle begins.` : 'A new realm takes shape.', 2);
  return world;
}

// ---------------------------------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------------------------------

const adv: CalendarAdvance = { newDay: false, newMonth: false, newYear: false, seasonChanged: false };

/**
 * Advance the world by one game hour.
 * @param commands player/scripted commands to apply first (AI commands are generated internally).
 * @param out receives SimEvents produced during this tick (UI/audio/session consume them).
 * @param terrain the region heightfield (`getRegionHeightfield(world)`).
 */
export function tickWorld(world: WorldState, commands: readonly IssuedStrategicCommand[], out: SimEvent[], terrain: TerrainQuery): void {
  if (world.victory.status !== 'ongoing') return;
  for (const c of commands) applyStrategicCommand(world, c, out, terrain);
  advanceCalendar(world.calendar, 1, adv);
  updateArmiesHourly(world, out, terrain);
  stepDistantBattles(world, out, terrain);
  if (adv.newDay) {
    const day = totalDays(world.calendar);
    out.push({ kind: 'new_day', day });
    updateMonsoonDaily(world, out);
    const changed = updateWeatherDaily(world);
    if (changed) out.push({ kind: 'weather_changed', weather: changed });
    updateRoadBlocks(world);
    updateEconomyDaily(world, out);
    updateArmiesDaily(world, out);
    updatePoliticsDaily(world, out);
    updateDiplomacyDaily(world, out);
    updateEspionageDaily(world, out);
    evaluateEventsDaily(world, out);
    for (const fid of sortedKeys(world.factions)) {
      const f = world.factions[fid] as FactionState;
      if (f.isPlayer || !f.alive) continue;
      const cmds = runCampaignAI(world, fid, terrain);
      for (const c of cmds) applyStrategicCommand(world, c, out, terrain);
    }
    checkObjectives(world, out);
  }
  if (adv.newMonth) {
    out.push({ kind: 'new_month', month: world.calendar.month });
    updateEconomyMonthly(world, out);
    updateDiplomacyMonthly(world, out);
    sampleStats(world);
  }
  if (adv.seasonChanged) out.push({ kind: 'season_changed', season: seasonOf(world.calendar) });
  if (adv.newYear) {
    out.push({ kind: 'new_year', year: world.calendar.year });
    updateCharactersYearly(world, out);
  }
}

/** Region heightfield for this world (cached). */
export function getRegionHeightfield(world: WorldState): Heightfield {
  return getHeightfield(world.region.terrain);
}

// ---------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------

/** Validate a command; returns a human-readable reason if it cannot be applied, else null. */
export function validateStrategicCommand(world: WorldState, issued: IssuedStrategicCommand): string | null {
  const c = issued.cmd;
  const f = world.factions[issued.factionId];
  if (!f || !f.alive) return 'Unknown or defeated faction';
  switch (c.kind) {
    case 'move_army':
    case 'army_order':
    case 'set_army_stance':
    case 'split_army':
    case 'disband_army': {
      const a = world.armies[c.armyId];
      if (!a) return 'No such army';
      if (a.factionId !== issued.factionId) return 'Not your army';
      if (a.status === 'in_battle') return 'Army is in battle';
      return null;
    }
    case 'build':
    case 'recruit':
    case 'set_tax_rate':
    case 'set_labor': {
      const s = world.settlements[c.settlementId];
      if (!s) return 'No such settlement';
      if (s.ownerFactionId !== issued.factionId) return 'Not your settlement';
      return null;
    }
    default:
      return null;
  }
}

/** Apply one command. Returns true if accepted. Unknown/unimplemented kinds are ignored (false). */
export function applyStrategicCommand(world: WorldState, issued: IssuedStrategicCommand, out: SimEvent[], terrain: TerrainQuery): boolean {
  const reason = validateStrategicCommand(world, issued);
  if (reason) {
    if (world.factions[issued.factionId]?.isPlayer) out.push({ kind: 'notification', factionId: issued.factionId, severity: 'warning', text: reason, focus: null });
    return false;
  }
  issued.hour = world.calendar.totalHours;
  const c = issued.cmd;
  switch (c.kind) {
    case 'move_army':
      return orderArmy(world, c.armyId, { kind: 'move', x: c.x, z: c.z }, terrain);
    case 'army_order':
      return orderArmy(world, c.armyId, c.order, terrain);
    case 'set_army_stance': {
      const a = world.armies[c.armyId];
      if (a) a.stance = c.stance;
      return !!a;
    }
    case 'set_tax_rate': {
      const s = world.settlements[c.settlementId];
      if (s) s.taxRate = Math.min(0.6, Math.max(0, c.rate));
      return !!s;
    }
    case 'set_tax_policy': {
      const f = world.factions[issued.factionId];
      if (f) f.taxPolicy = c.policy;
      return !!f;
    }
    case 'set_labor': {
      const s = world.settlements[c.settlementId];
      if (s) s.laborAllocation = { ...c.allocation };
      return !!s;
    }
    case 'build': {
      const s = world.settlements[c.settlementId];
      if (!s) return false;
      const cur = s.buildings.find((b) => b.type === c.building)?.level ?? 0;
      // CORE-01 compile-fix: v2 job fields (nothing is charged yet; crew 0 = derive from the definition).
      s.construction.push({ type: c.building, targetLevel: cur + 1, progress: 0, startedDay: totalDays(world.calendar), laborAssigned: 0, paid: { wealth: 0, timber: 0, stone: 0, labor: 0 }, crew: 0 });
      return true;
    }
    case 'recruit': {
      const s = world.settlements[c.settlementId];
      if (!s) return false;
      s.recruitment.push({ unitClass: c.unitClass, formations: c.formations, progress: 0, startedDay: totalDays(world.calendar), targetArmyId: c.targetArmyId });
      return true;
    }
    case 'event_choice':
      return resolveEventChoice(world, c.eventInstanceId, c.choiceId, out);
    case 'propose':
      proposeTreaty(world, issued.factionId, c.to, c.type, c.terms, out);
      return true;
    case 'respond_proposal':
      respondToProposal(world, c.proposalId, c.accept, out);
      return true;
    case 'spy_mission':
      return startSpyMission(world, issued.factionId, c.targetFactionId, c.mission, c.settlementId, c.agentCharacterId, out);
    case 'engagement_decision':
      return decideEngagement(world, c.engagementId as EngagementId, c.decision, out, terrain);
    case 'designate_heir': {
      const f = world.factions[issued.factionId];
      const ch = world.characters[c.characterId];
      if (!f || !ch || ch.factionId !== f.id) return false;
      f.heirId = ch.id;
      if (!ch.roles.includes('heir')) ch.roles.push('heir');
      return true;
    }
    case 'market_trade':
      return executeMarketTrade(world, issued.factionId, c.resource, c.lots, c.buy, out).ok;
    case 'set_policy': {
      const f = world.factions[issued.factionId];
      if (!f) return false;
      if (c.policy === 'hold_reserve') f.policies.holdReserve = c.on;
      else f.policies.rationingUntilDay = c.on ? totalDays(world.calendar) + RULES.distribution.rationing.days : null;
      return true;
    }
    default:
      // TODO(Lead AI & Simulation): remaining commands (split/merge, depots, requisition, relief,
      // marriages, governors, council, rebels, roads...). Keep validation in validateStrategicCommand.
      return false;
  }
}

// Re-exported so callers (UI/AI) can declare war/peace without importing diplomacy directly.
export { declareWar, makePeace, makeArmy, makeArmyUnit };

// ---------------------------------------------------------------------------------------------------
// Queries & bookkeeping
// ---------------------------------------------------------------------------------------------------

/** Province containing (x, z): nearest settlement's province (Voronoi). */
export function provinceAt(world: WorldState, x: number, z: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id] as SettlementState;
    const dx = s.x - x;
    const dz = s.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = s.provinceId;
    }
  }
  return best;
}

function sampleStats(world: WorldState): void {
  const factions: WorldState['stats'][number]['factions'] = {};
  for (const fid of sortedKeys(world.factions)) {
    const f = world.factions[fid] as FactionState;
    let pop = 0;
    let food = 0;
    let n = 0;
    for (const s of Object.values(world.settlements)) {
      if (s.ownerFactionId !== fid) continue;
      pop += s.population;
      food += s.foodStored;
      n++;
    }
    let soldiers = 0;
    for (const a of Object.values(world.armies)) if (a.factionId === fid) soldiers += armySoldiers(a);
    factions[fid] = { treasury: f.treasury, population: pop, food, soldiers, stability: f.stability, settlements: n };
  }
  world.stats.push({ day: totalDays(world.calendar), factions });
  if (world.stats.length > STATS_SAMPLE_LIMIT) world.stats.splice(0, world.stats.length - STATS_SAMPLE_LIMIT);
}

export interface WorldSummary {
  day: number;
  date: { year: number; month: number; day: number; hour: number };
  season: string;
  weather: string;
  factions: { id: FactionId; treasury: number; settlements: number; soldiers: number }[];
  armies: number;
  engagements: number;
  pendingEvents: number;
  victory: string;
}

/** Compact summary for debug API / QA logs. */
export function summarizeWorld(world: WorldState): WorldSummary {
  return {
    day: totalDays(world.calendar),
    date: { year: world.calendar.year, month: world.calendar.month, day: world.calendar.day, hour: world.calendar.hour },
    season: seasonOf(world.calendar),
    weather: world.weather.kind,
    factions: sortedKeys(world.factions).map((id) => ({
      id,
      treasury: Math.round(world.factions[id]!.treasury),
      settlements: Object.values(world.settlements).filter((s) => s.ownerFactionId === id).length,
      soldiers: Object.values(world.armies)
        .filter((a) => a.factionId === id)
        .reduce((s, a) => s + armySoldiers(a), 0),
    })),
    armies: Object.keys(world.armies).length,
    engagements: Object.values(world.engagements).filter((e) => e.status !== 'resolved').length,
    pendingEvents: world.events.pending.length,
    victory: world.victory.status,
  };
}
