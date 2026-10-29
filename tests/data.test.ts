/**
 * Data integrity for src/data/** (Creative Director content). OWNER: Creative Director (requested by the
 * task brief; QA Lead may extend). Guards: ids unique, every reference resolves, the road graph is
 * connected, stats sit in sane ranges, authoring rules from events.ts/hero.ts hold, and every scenario
 * builds a world and runs without errors.
 */
import { describe, expect, it } from 'vitest';
import type { Condition, Effect, EventDef, ScopeRef, SimEvent, TerrainClass } from '../src/core/types';
import {
  AI_PERSONALITIES,
  ARCHITECTURE_KINDS,
  BUILDING_TYPES,
  COUNCIL_SEATS,
  DIFFICULTIES,
  ECONOMY_RESOURCES,
  FORMATION_SHAPES,
  NEGOTIATION_TACTICS,
  RESOURCE_KINDS,
  SCENE_IDS,
  SETTLEMENT_KINDS,
  TERRAIN_CLASSES,
  TERRAIN_PRESETS,
  TRAITS,
  UNIT_CLASSES,
  VICTORY_TYPES,
} from '../src/core/types';
import { FACTIONS, MINOR_FACTION_IDS, PLAYABLE_FACTION_IDS } from '../src/data/factions';
import { UNITS } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';
import { AGE_ORDER, AGES, LANDMARKS, landmarksFor } from '../src/data/ages';
import { REGION, REGION_FEATURES, SETTLEMENT_LORE } from '../src/data/region';
import { DEFAULT_SCENARIO_ID, SANDBOX_PRESETS, SANDBOX_RANGES, SCENARIOS, defaultSandbox } from '../src/data/campaign';
import { EVENTS, getEventDef } from '../src/data/events';
import { DIALOGUES, HERO_AVATARS, HERO_CHARACTERS, HERO_COMBAT, HERO_DISTRICTS, HERO_ENEMIES, HERO_GROUPS, HERO_MISSIONS, MISSION_INSPECTABLES, TRAINING_STEPS } from '../src/data/hero';
import { AI_PERSONALITY_DEFS, DIFFICULTY_DEFS } from '../src/data/difficulty';
import { TUTORIAL_HINTS } from '../src/data/tutorial';
import { DEFAULT_COMPOSITION_ID, FACTION_DEFAULT_COMPOSITION, SKIRMISH_COMPOSITIONS, SKIRMISH_MAPS, SKIRMISH_SIZES, SKIRMISH_WEATHER } from '../src/data/skirmish';
import { RESOURCE_BAR_ORDER, RESOURCE_DISPLAY, RESOURCE_KIND_FEEDS } from '../src/data/resources';
import { BALANCE } from '../src/data/balance';
import { RULES } from '../src/data/rules';
import { NAME_POOLS, PERSON_NAMES } from '../src/data/names';
import { END_GAME_STATS, STAT_CATEGORIES } from '../src/data/statistics';
import { createWorld, getRegionHeightfield, resolveRegionTerrain, tickWorld } from '../src/sim/strategic/world';
import { getHeightfield } from '../src/core/terrain/cache';

// -----------------------------------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------------------------------

const unique = (xs: readonly string[]): boolean => new Set(xs).size === xs.length;
const dupes = (xs: readonly string[]): string[] => xs.filter((x, i) => xs.indexOf(x) !== i);

const SETTLEMENT_IDS = new Set(REGION.settlements.map((s) => s.id));
const PROVINCE_IDS = new Set(REGION.provinces.map((p) => p.id));
const FACTION_IDS = new Set(Object.keys(FACTIONS));
const EVENT_IDS = new Set(EVENTS.map((e) => e.id));
const ALL_CHARACTER_IDS = new Set(Object.values(SCENARIOS).flatMap((s) => s.characters.map((c) => c.id)));
const MISSION_IDS = new Set(HERO_MISSIONS.map((m) => m.id));

interface Refs {
  settlements: string[];
  factions: string[];
  characters: string[];
  events: string[];
  objectives: string[];
  flagsRead: string[];
  flagsSet: string[];
  usesPlayer: boolean;
}
const emptyRefs = (): Refs => ({ settlements: [], factions: [], characters: [], events: [], objectives: [], flagsRead: [], flagsSet: [], usesPlayer: false });

function scope(r: Refs, s: ScopeRef | null): void {
  if (!s) return;
  if (s.kind === 'settlement') r.settlements.push(s.id);
  else if (s.kind === 'faction') r.factions.push(s.id);
  else if (s.kind === 'character') r.characters.push(s.id);
  else if (s.kind === 'player') r.usesPlayer = true;
}

function walkCondition(c: Condition, r: Refs): void {
  switch (c.kind) {
    case 'all':
    case 'any':
      c.of.forEach((x) => walkCondition(x, r));
      return;
    case 'not':
      walkCondition(c.cond, r);
      return;
    case 'settlement_var':
    case 'faction_var':
    case 'character_var':
    case 'rebellion_stage_at_least':
      scope(r, c.target);
      return;
    case 'flag':
    case 'flag_set':
      r.flagsRead.push(c.flag);
      return;
    case 'at_war':
      scope(r, c.a);
      scope(r, c.b);
      return;
    case 'has_treaty':
      scope(r, c.a);
      scope(r, c.b);
      return;
    case 'owns_settlement':
      scope(r, c.faction);
      r.settlements.push(c.settlementId);
      return;
    case 'battle_won':
    case 'army_strength_at_least':
      scope(r, c.faction);
      return;
    case 'event_resolved':
      r.events.push(c.eventId);
      return;
    default:
      return;
  }
}

function walkEffect(e: Effect, r: Refs): void {
  switch (e.kind) {
    case 'settlement_var':
    case 'faction_var':
    case 'character_var':
    case 'set_rebellion_stage':
    case 'kill_character':
      scope(r, e.target);
      return;
    case 'set_flag':
      r.flagsSet.push(e.flag);
      return;
    case 'clear_flag':
      return;
    case 'trigger_event':
      r.events.push(e.eventId);
      return;
    case 'opinion':
    case 'sign_treaty':
    case 'declare_war':
      scope(r, e.a);
      scope(r, e.b);
      return;
    case 'spawn_army':
      scope(r, e.faction);
      if (e.nearSettlement) r.settlements.push(e.nearSettlement);
      return;
    case 'damage_road':
      if (e.nearSettlement) r.settlements.push(e.nearSettlement);
      return;
    case 'transfer_settlement':
      scope(r, e.settlement);
      scope(r, e.to);
      return;
    case 'objective':
      r.objectives.push(e.objectiveId);
      return;
    default:
      return;
  }
}

function expectRefsResolve(r: Refs, where: string): void {
  for (const s of r.settlements) expect(SETTLEMENT_IDS.has(s), `${where}: settlement ${s}`).toBe(true);
  for (const f of r.factions) expect(FACTION_IDS.has(f), `${where}: faction ${f}`).toBe(true);
  for (const c of r.characters) expect(ALL_CHARACTER_IDS.has(c), `${where}: character ${c}`).toBe(true);
  for (const e of r.events) expect(EVENT_IDS.has(e), `${where}: event ${e}`).toBe(true);
}

/** All flags set anywhere in content (events, missions, dialogues, objectives) + sim-owned flags. */
function allFlagsSet(): Set<string> {
  const r = emptyRefs();
  for (const e of EVENTS) for (const c of e.choices) c.effects.forEach((x) => walkEffect(x, r));
  for (const m of HERO_MISSIONS) [...m.onSuccess, ...m.onFailure].forEach((x) => walkEffect(x, r));
  for (const ch of HERO_CHARACTERS) if (ch.negotiation) [...ch.negotiation.onSuccess, ...ch.negotiation.onFailure].forEach((x) => walkEffect(x, r));
  for (const t of Object.values(DIALOGUES)) for (const n of Object.values(t.nodes)) for (const c of n.choices) c.effects.forEach((x) => walkEffect(x, r));
  const set = new Set(r.flagsSet);
  // Inspectable clues set `clue_<id>` (hero.ts convention).
  for (const d of HERO_DISTRICTS) for (const i of d.inspectables) if (i.clue) set.add(`clue_${i.clue}`);
  for (const i of MISSION_INSPECTABLES) if (i.clue) set.add(`clue_${i.clue}`);
  // Sim-owned flags (DESIGN_SPEC §7.3) and the never-trigger convention.
  ['monsoon_failed', 'monsoon_flood', '__never__'].forEach((f) => set.add(f));
  return set;
}

// -----------------------------------------------------------------------------------------------------
// Factions
// -----------------------------------------------------------------------------------------------------

describe('factions', () => {
  it('ids match keys; exactly two playable; minors exist', () => {
    for (const [k, f] of Object.entries(FACTIONS)) expect(f.id).toBe(k);
    expect(PLAYABLE_FACTION_IDS.slice().sort()).toEqual(['heartland', 'highland']);
    for (const m of MINOR_FACTION_IDS) expect(FACTIONS[m]?.playable).toBe(false);
  });

  it('modifiers, colors, rosters and variants are sane', () => {
    const colors: string[] = [];
    for (const f of Object.values(FACTIONS)) {
      for (const [k, v] of Object.entries(f.modifiers)) expect(v, `${f.id}.${k}`).toBeGreaterThanOrEqual(0.5), expect(v, `${f.id}.${k}`).toBeLessThanOrEqual(2);
      for (const c of Object.values(f.colors)) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      colors.push(f.colors.primary.toLowerCase());
      expect(f.roster.length).toBeGreaterThanOrEqual(6);
      expect(unique(f.roster)).toBe(true);
      for (const u of f.roster) expect(UNIT_CLASSES).toContain(u);
      for (const [cls, v] of Object.entries(f.unitVariants ?? {})) {
        expect(f.roster, `${f.id} variant ${cls} must be in roster`).toContain(cls);
        for (const m of Object.values(v.multipliers)) expect(m).toBeGreaterThanOrEqual(0.5), expect(m).toBeLessThanOrEqual(1.6);
      }
      expect(f.heraldry?.blazon.length ?? 0).toBeGreaterThan(10);
      if (f.startingAge) expect(AGE_ORDER).toContain(f.startingAge);
      expect(AI_PERSONALITIES).toContain(f.aiPersonality);
    }
    expect(unique(colors)).toBe(true);
  });

  it('playable factions have distinct strategic strengths (GDD §15)', () => {
    const a = FACTIONS.heartland!.modifiers;
    const b = FACTIONS.highland!.modifiers;
    expect(a.recruitmentPool).toBeGreaterThan(b.recruitmentPool);
    expect(b.fortDefense).toBeGreaterThan(a.fortDefense);
    expect(b.hillMovement).toBeGreaterThan(a.hillMovement);
    expect(a.governanceCost).toBeGreaterThan(b.governanceCost);
  });
});

// -----------------------------------------------------------------------------------------------------
// Units
// -----------------------------------------------------------------------------------------------------

describe('units', () => {
  it('defines every class with sane stats', () => {
    expect(Object.keys(UNITS).sort()).toEqual([...UNIT_CLASSES].sort());
    const slots: number[] = [];
    for (const cls of UNIT_CLASSES) {
      const u = UNITS[cls];
      const s = u.stats;
      expect(u.id).toBe(cls);
      expect(s.menPerFormation).toBeGreaterThanOrEqual(4);
      expect(s.menPerFormation).toBeLessThanOrEqual(200);
      expect(s.hp).toBeGreaterThan(0);
      expect(s.meleeAttack).toBeGreaterThan(0);
      expect(s.meleeDefense).toBeGreaterThan(0);
      expect(s.runSpeed).toBeGreaterThan(s.walkSpeed);
      expect(s.walkSpeed).toBeGreaterThanOrEqual(1);
      expect(s.runSpeed).toBeLessThanOrEqual(12);
      expect(s.baseMorale).toBeGreaterThan(0);
      expect(s.baseMorale).toBeLessThanOrEqual(100);
      for (const k of ['discipline', 'accuracy', 'stealth', 'unruliness'] as const) expect(s[k]).toBeGreaterThanOrEqual(0), expect(s[k]).toBeLessThanOrEqual(1);
      const ranged = s.rangedAttack > 0;
      expect(s.range > 0).toBe(ranged);
      if (ranged) {
        expect(s.ammo).toBeGreaterThan(0);
        expect(s.reloadSec).toBeGreaterThan(0);
        expect(s.accuracy).toBeGreaterThan(0);
      }
      expect(s.spacingX).toBeGreaterThan(0);
      expect(s.spacingZ).toBeGreaterThan(0);
      expect(s.recruitCost.wealth).toBeGreaterThan(0);
      expect(s.recruitDays).toBeGreaterThan(0);
      expect(s.upkeepFood).toBeGreaterThan(0);
      expect(u.allowedShapes).toContain(u.defaultShape);
      for (const sh of u.allowedShapes) expect(FORMATION_SHAPES).toContain(sh);
      for (const tc of TERRAIN_CLASSES) {
        const t = u.terrain[tc as TerrainClass];
        expect(t, `${cls}.${tc}`).toBeDefined();
        expect(t.speed).toBeGreaterThan(0);
        expect(t.speed).toBeLessThanOrEqual(1.3);
      }
      for (const [k, v] of Object.entries(u.bonusVs)) {
        expect(UNIT_CLASSES).toContain(k);
        expect(v).toBeGreaterThanOrEqual(0.3);
        expect(v).toBeLessThanOrEqual(2.5);
      }
      for (const k of [...(u.counters?.strongVs ?? []), ...(u.counters?.weakVs ?? [])]) expect(UNIT_CLASSES).toContain(k);
      if (u.age) expect(AGE_ORDER).toContain(u.age);
      if (u.commandSlot !== undefined) slots.push(u.commandSlot);
    }
    expect(unique(slots.map(String))).toBe(true);
    expect(UNIT_CLASSES.filter((c) => UNITS[c].category !== 'support').length).toBeGreaterThanOrEqual(6);
  });

  it('encodes the rock-paper-scissors counters', () => {
    expect(UNITS.spearmen.bonusVs.cavalry ?? 1).toBeGreaterThan(1.3);
    expect(UNITS.cavalry.bonusVs.archers ?? 1).toBeGreaterThan(1.3);
    expect(UNITS.cavalry.bonusVs.spearmen ?? 1).toBeLessThan(1);
    expect(UNITS.archers.bonusVs.war_elephants ?? 1).toBeGreaterThan(1.2);
    expect(UNITS.war_elephants.bonusVs.cavalry ?? 1).toBeGreaterThan(1.3);
    expect(UNITS.elite_guards.bonusVs.spearmen ?? 1).toBeGreaterThan(1);
    expect(UNITS.chariots.terrain.forest.speed).toBeLessThan(0.3);
  });
});

// -----------------------------------------------------------------------------------------------------
// Buildings, ages, landmarks
// -----------------------------------------------------------------------------------------------------

describe('buildings and ages', () => {
  it('defines every building with valid references and footprints', () => {
    expect(Object.keys(BUILDINGS).sort()).toEqual([...BUILDING_TYPES].sort());
    const slotsByCat = new Map<string, number[]>();
    for (const t of BUILDING_TYPES) {
      const b = BUILDINGS[t];
      expect(b.id).toBe(t);
      expect(b.buildDays).toBeGreaterThan(0);
      expect(b.cost.wealth).toBeGreaterThan(0);
      expect(b.cost.labor).toBeGreaterThan(0);
      expect(b.maxLevel).toBeGreaterThanOrEqual(1);
      for (const r of b.requires) expect(BUILDING_TYPES).toContain(r);
      for (const u of b.unlocksUnits) expect(UNIT_CLASSES).toContain(u);
      for (const k of b.allowedIn) expect(SETTLEMENT_KINDS).toContain(k);
      for (const a of b.architecture) expect(ARCHITECTURE_KINDS).toContain(a);
      if (b.footprint) {
        if (b.footprint.placement !== 'perimeter') {
          expect(b.footprint.w % RULES.construction.gridCell).toBe(0);
          expect(b.footprint.d % RULES.construction.gridCell).toBe(0);
          expect(b.footprint.w).toBeGreaterThan(0);
        }
      }
      if (b.category && b.commandSlot !== undefined) slotsByCat.set(b.category, [...(slotsByCat.get(b.category) ?? []), b.commandSlot]);
    }
    for (const [cat, slots] of slotsByCat) expect(unique(slots.map(String)), `slots in ${cat}`).toBe(true);
  });

  it('building requirements are acyclic and never require a later age', () => {
    const ageIdx = (t: (typeof BUILDING_TYPES)[number]) => AGE_ORDER.indexOf(BUILDINGS[t].age ?? 'janapada');
    const visiting = new Set<string>();
    const visit = (t: (typeof BUILDING_TYPES)[number], depth: number): void => {
      expect(depth).toBeLessThan(BUILDING_TYPES.length);
      expect(visiting.has(t), `cycle at ${t}`).toBe(false);
      visiting.add(t);
      for (const r of BUILDINGS[t].requires) {
        expect(ageIdx(r)).toBeLessThanOrEqual(ageIdx(t));
        visit(r, depth + 1);
      }
      visiting.delete(t);
    };
    for (const t of BUILDING_TYPES) visit(t, 0);
  });

  it('every building and unit is unlocked in exactly the age it declares', () => {
    const unlockedB = AGE_ORDER.flatMap((a) => AGES[a].unlockBuildings);
    expect(dupes(unlockedB)).toEqual([]);
    expect(unlockedB.slice().sort()).toEqual([...BUILDING_TYPES].sort());
    for (const a of AGE_ORDER) for (const t of AGES[a].unlockBuildings) expect(BUILDINGS[t].age ?? 'janapada').toBe(a);
    const unlockedU = AGE_ORDER.flatMap((a) => AGES[a].unlockUnits);
    expect(dupes(unlockedU)).toEqual([]);
    expect(unlockedU.slice().sort()).toEqual([...UNIT_CLASSES].sort());
    for (const a of AGE_ORDER) for (const u of AGES[a].unlockUnits) expect(UNITS[u].age ?? 'janapada').toBe(a);
  });

  it('age requirements and caps escalate', () => {
    AGE_ORDER.forEach((a, i) => expect(AGES[a].index).toBe(i));
    for (let i = 1; i < AGE_ORDER.length; i++) {
      const prev = AGES[AGE_ORDER[i - 1]!];
      const cur = AGES[AGE_ORDER[i]!];
      expect(cur.requirements.previous).toBe(prev.id);
      expect(cur.requirements.minPopulation).toBeGreaterThan(prev.requirements.minPopulation);
      expect(cur.requirements.minSettlements).toBeGreaterThan(prev.requirements.minSettlements);
      expect(cur.maxBuildingLevel).toBeGreaterThanOrEqual(prev.maxBuildingLevel);
      expect(cur.governorSlots).toBeGreaterThan(prev.governorSlots);
    }
    for (const a of AGE_ORDER) for (const [t, cap] of Object.entries(AGES[a].buildingLevelCaps)) expect(cap).toBeLessThanOrEqual(BUILDINGS[t as (typeof BUILDING_TYPES)[number]].maxLevel);
  });

  it('landmarks: two per later age for playable factions, at least one for others', () => {
    expect(unique(LANDMARKS.map((l) => l.id))).toBe(true);
    for (const f of Object.values(FACTIONS)) {
      for (const age of AGE_ORDER.slice(1)) {
        const n = landmarksFor(f.id, age).length;
        if (f.playable) expect(n, `${f.id} ${age}`).toBe(2);
        else expect(n, `${f.id} ${age}`).toBeGreaterThanOrEqual(1);
      }
    }
    for (const l of LANDMARKS) {
      expect(FACTION_IDS.has(l.factionId)).toBe(true);
      expect(l.age).not.toBe('janapada');
      expect(l.cost.wealth + l.cost.timber + l.cost.stone).toBeGreaterThan(1000);
      expect(l.buildDays).toBeGreaterThan(30);
      for (const k of l.allowedIn) expect(SETTLEMENT_KINDS).toContain(k);
      for (const a of l.architecture) expect(ARCHITECTURE_KINDS).toContain(a);
      for (const v of Object.values(l.factionEffects)) expect(v).toBeGreaterThan(0.5), expect(v).toBeLessThan(1.6);
    }
  });
});

// -----------------------------------------------------------------------------------------------------
// Region
// -----------------------------------------------------------------------------------------------------

describe('region', () => {
  it('has 10-16 settlements of every kind, valid ids and provinces', () => {
    const ss = REGION.settlements;
    expect(ss.length).toBeGreaterThanOrEqual(10);
    expect(ss.length).toBeLessThanOrEqual(16);
    expect(unique(ss.map((s) => s.id))).toBe(true);
    expect(unique(ss.map((s) => s.name))).toBe(true);
    expect(unique(REGION.provinces.map((p) => p.id))).toBe(true);
    for (const k of ['capital', 'town', 'village', 'fort', 'port', 'temple_town'] as const) expect(ss.some((s) => s.kind === k), k).toBe(true);
    for (const s of ss) {
      expect(PROVINCE_IDS.has(s.provinceId), s.id).toBe(true);
      expect(s.u).toBeGreaterThanOrEqual(0.05), expect(s.u).toBeLessThanOrEqual(0.95);
      expect(s.v).toBeGreaterThanOrEqual(0.05), expect(s.v).toBeLessThanOrEqual(0.95);
      if (s.defaultOwner) expect(FACTION_IDS.has(s.defaultOwner)).toBe(true);
      expect(s.population).toBeGreaterThan(500);
      for (const r of s.resources) expect(RESOURCE_KINDS).toContain(r);
      expect(unique(s.buildings.map((b) => b.type))).toBe(true);
      for (const b of s.buildings) {
        expect(BUILDING_TYPES).toContain(b.type);
        expect(b.level).toBeGreaterThanOrEqual(1);
        expect(b.level).toBeLessThanOrEqual(BUILDINGS[b.type].maxLevel);
        expect(BUILDINGS[b.type].allowedIn, `${s.id} ${b.type}`).toContain(s.kind);
      }
      expect(SETTLEMENT_LORE[s.id], `lore for ${s.id}`).toBeDefined();
    }
    for (const p of REGION.provinces) {
      const cap = ss.find((s) => s.id === p.capitalSettlementId);
      expect(cap, p.id).toBeDefined();
      expect(cap!.provinceId).toBe(p.id);
      expect(p.fertility).toBeGreaterThan(0), expect(p.fertility).toBeLessThanOrEqual(1);
    }
    expect(Object.keys(SETTLEMENT_LORE).every((id) => SETTLEMENT_IDS.has(id))).toBe(true);
    for (const f of REGION_FEATURES) expect(SETTLEMENT_IDS.has(f.nearSettlement)).toBe(true);
  });

  it('starting buildings respect the owner\'s starting age caps', () => {
    for (const s of REGION.settlements) {
      const age = (s.defaultOwner ? FACTIONS[s.defaultOwner]?.startingAge : undefined) ?? 'mahajanapada';
      const ai = AGE_ORDER.indexOf(age);
      for (const b of s.buildings) {
        expect(AGE_ORDER.indexOf(BUILDINGS[b.type].age ?? 'janapada'), `${s.id} ${b.type} too advanced`).toBeLessThanOrEqual(ai);
        const cap = AGES[age].buildingLevelCaps[b.type] ?? AGES[age].maxBuildingLevel;
        expect(b.level, `${s.id} ${b.type} level`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('roads are valid, unique and connect every settlement', () => {
    const keys = REGION.roads.map((r) => [r.from, r.to].sort().join('|'));
    expect(dupes(keys)).toEqual([]);
    const adj = new Map<string, string[]>();
    for (const r of REGION.roads) {
      expect(SETTLEMENT_IDS.has(r.from), r.from).toBe(true);
      expect(SETTLEMENT_IDS.has(r.to), r.to).toBe(true);
      expect(r.from).not.toBe(r.to);
      adj.set(r.from, [...(adj.get(r.from) ?? []), r.to]);
      adj.set(r.to, [...(adj.get(r.to) ?? []), r.from]);
    }
    const seen = new Set<string>(['rajapura']);
    const queue = ['rajapura'];
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    expect([...SETTLEMENT_IDS].filter((id) => !seen.has(id))).toEqual([]);
    // The capital is reachable by a royal road from the river crossing.
    expect(REGION.roads.some((r) => r.quality === 'royal_road' && [r.from, r.to].includes('setupur') && [r.from, r.to].includes('rajapura'))).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------------------
// Campaign scenarios
// -----------------------------------------------------------------------------------------------------

describe('campaign', () => {
  it('default scenario exists and keeps the ids other code relies on', () => {
    const bc = SCENARIOS[DEFAULT_SCENARIO_ID];
    expect(bc).toBeDefined();
    expect(bc!.id).toBe('broken_crown');
    expect(bc!.armies.some((a) => a.id === 'army_royal' && a.factionId === 'heartland')).toBe(true);
    // The two playable factions each have a scenario.
    expect(new Set(Object.values(SCENARIOS).map((s) => s.playerFactionId))).toEqual(new Set(PLAYABLE_FACTION_IDS));
  });

  for (const sc of Object.values(SCENARIOS)) {
    describe(sc.id, () => {
      it('references resolve', () => {
        expect(sc.factionIds).toContain(sc.playerFactionId);
        for (const f of sc.factionIds) expect(FACTION_IDS.has(f)).toBe(true);
        expect(unique(sc.armies.map((a) => a.id))).toBe(true);
        expect(unique(sc.characters.map((c) => c.id))).toBe(true);
        const chars = new Set(sc.characters.map((c) => c.id));
        for (const a of sc.armies) {
          expect(SETTLEMENT_IDS.has(a.settlementId), `${a.id} at ${a.settlementId}`).toBe(true);
          expect(sc.factionIds).toContain(a.factionId);
          if (a.commanderId) expect(chars.has(a.commanderId), `${a.id} commander`).toBe(true);
          for (const u of a.units) expect(UNIT_CLASSES).toContain(u.unitClass), expect(FACTIONS[a.factionId]!.roster).toContain(u.unitClass);
          const home = REGION.settlements.find((s) => s.id === a.settlementId)!;
          const owner = sc.settlementOwners[home.id] !== undefined ? sc.settlementOwners[home.id] : home.defaultOwner;
          expect(owner, `${a.id} spawns in its own settlement`).toBe(a.factionId);
        }
        const seats = new Map<string, string[]>();
        for (const c of sc.characters) {
          expect(sc.factionIds).toContain(c.factionId);
          for (const p of c.parentIds) expect(chars.has(p)).toBe(true);
          if (c.governsProvinceId) expect(PROVINCE_IDS.has(c.governsProvinceId)).toBe(true);
          if (c.councilSeat) {
            expect(COUNCIL_SEATS).toContain(c.councilSeat);
            const k = `${c.factionId}:${c.councilSeat}`;
            seats.set(k, [...(seats.get(k) ?? []), c.id]);
          }
          for (const t of c.traits) expect(TRAITS).toContain(t);
          for (const v of Object.values(c.skills)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(20);
          expect(c.loyalty).toBeGreaterThanOrEqual(0), expect(c.loyalty).toBeLessThanOrEqual(1);
        }
        for (const [k, ids] of seats) expect(ids.length, `seat ${k}`).toBe(1);
        for (const f of sc.factionIds) expect(sc.characters.some((c) => c.factionId === f && c.roles.includes('ruler')), `${f} ruler`).toBe(true);
        for (const d of sc.dynasties) {
          expect(chars.has(d.headId)).toBe(true);
          expect(sc.characters.find((c) => c.id === d.headId)!.factionId).toBe(d.factionId);
        }
        for (const r of sc.relations) expect(sc.factionIds).toContain(r.a), expect(sc.factionIds).toContain(r.b);
        for (const k of Object.keys(sc.treasury)) expect(sc.factionIds).toContain(k);
        for (const se of sc.scriptedEvents) expect(EVENT_IDS.has(se.eventId), se.eventId).toBe(true);
        if (sc.heroCharacterId) expect(chars.has(sc.heroCharacterId)).toBe(true);
        for (const [f, a] of Object.entries(sc.startingAges ?? {})) expect(FACTION_IDS.has(f)).toBe(true), expect(AGE_ORDER).toContain(a);
      });

      it('objectives, outcomes and acts are well-formed with three viable victories', () => {
        expect(unique(sc.objectives.map((o) => o.id))).toBe(true);
        expect(unique(sc.outcomes.map((o) => o.id))).toBe(true);
        expect(unique(sc.outcomes.map((o) => String(o.priority)))).toBe(true);
        const victories = sc.outcomes.filter((o) => o.kind === 'victory');
        expect(victories.length).toBeGreaterThanOrEqual(3);
        expect(new Set(victories.map((v) => v.victoryType)).size).toBe(victories.length);
        for (const v of victories) expect(VICTORY_TYPES).toContain(v.victoryType);
        expect(sc.outcomes.some((o) => o.kind === 'defeat')).toBe(true);
        expect(sc.outcomes.some((o) => o.kind === 'mixed')).toBe(true);
        // Defeats outrank victories so a lost capital can never also count as a win.
        const minDefeat = Math.min(...sc.outcomes.filter((o) => o.kind === 'defeat').map((o) => o.priority));
        expect(Math.max(...victories.map((o) => o.priority))).toBeLessThan(minDefeat);
        const actNumbers = (sc.acts ?? []).map((a) => a.number);
        for (const o of sc.objectives) if (o.act !== undefined) expect(actNumbers).toContain(o.act);
        const r = emptyRefs();
        for (const o of sc.objectives) {
          walkCondition(o.condition, r);
          if (o.failCondition) walkCondition(o.failCondition, r);
          o.reward.forEach((e) => walkEffect(e, r));
        }
        for (const o of sc.outcomes) walkCondition(o.condition, r);
        expectRefsResolve(r, sc.id);
        const flags = allFlagsSet();
        for (const f of r.flagsRead) expect(flags.has(f), `${sc.id} reads flag ${f} that nothing sets`).toBe(true);
        expect(sc.timeLimitDays).toBeGreaterThan(300);
      });
    });
  }

  it('sandbox defaults and presets stay inside the slider ranges', () => {
    const base = defaultSandbox(1);
    for (const p of [{ id: 'default', patch: {} }, ...SANDBOX_PRESETS]) {
      const s = { ...base, ...p.patch };
      for (const [k, r] of Object.entries(SANDBOX_RANGES)) {
        const v = s[k as keyof typeof SANDBOX_RANGES];
        expect(v, `${p.id}.${k}`).toBeGreaterThanOrEqual(r.min);
        expect(v, `${p.id}.${k}`).toBeLessThanOrEqual(r.max);
      }
      for (const vt of s.victoryTypes) expect(VICTORY_TYPES).toContain(vt);
    }
    for (const f of base.rivalFactionIds) expect(FACTION_IDS.has(f)).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------------------------------

describe('events', () => {
  it('ids unique; choices well-formed; first choice is a safe default', () => {
    expect(unique(EVENTS.map((e) => e.id))).toBe(true);
    for (const e of EVENTS) {
      expect(e.choices.length, e.id).toBeGreaterThan(0);
      expect(unique(e.choices.map((c) => c.id)), e.id).toBe(true);
      expect(e.choices[0]!.requires, `${e.id}: choices[0] must not have requires (auto-resolve)`).toBeNull();
      for (const c of e.choices) if (c.advisorSeat) expect(COUNCIL_SEATS).toContain(c.advisorSeat);
      expect(e.body.length).toBeGreaterThan(20);
      if (e.autoResolveDays !== null) expect(e.autoResolveDays).toBeGreaterThan(0);
    }
  });

  it('every reference in triggers, requirements and effects resolves', () => {
    for (const e of EVENTS) {
      const r = emptyRefs();
      walkCondition(e.trigger, r);
      for (const c of e.choices) {
        if (c.requires) walkCondition(c.requires, r);
        c.effects.forEach((x) => walkEffect(x, r));
      }
      expectRefsResolve(r, e.id);
    }
  });

  it('AI-visible events never reference the player directly', () => {
    for (const e of EVENTS.filter((x) => !x.playerOnly)) {
      const r = emptyRefs();
      walkCondition(e.trigger, r);
      for (const c of e.choices) {
        if (c.requires) walkCondition(c.requires, r);
        c.effects.forEach((x) => walkEffect(x, r));
      }
      expect(r.usesPlayer, `${e.id} is playerOnly=false but uses {kind:'player'}`).toBe(false);
    }
  });

  it('every flag an event reads is set somewhere', () => {
    const flags = allFlagsSet();
    for (const e of EVENTS) {
      const r = emptyRefs();
      walkCondition(e.trigger, r);
      for (const c of e.choices) if (c.requires) walkCondition(c.requires, r);
      for (const f of r.flagsRead) expect(flags.has(f), `${e.id} reads flag ${f}`).toBe(true);
    }
  });

  it('scheduled/chain-only events are reachable', () => {
    const reached = new Set<string>();
    for (const sc of Object.values(SCENARIOS)) for (const se of sc.scriptedEvents) reached.add(se.eventId);
    const r = emptyRefs();
    for (const e of EVENTS) for (const c of e.choices) c.effects.forEach((x) => walkEffect(x, r));
    for (const m of HERO_MISSIONS) [...m.onSuccess, ...m.onFailure].forEach((x) => walkEffect(x, r));
    r.events.forEach((id) => reached.add(id));
    for (const e of EVENTS) {
      const never = e.trigger.kind === 'flag_set' && e.trigger.flag === '__never__';
      if (never) expect(reached.has(e.id), `${e.id} uses the NEVER trigger but nothing schedules it`).toBe(true);
    }
  });

  it('the GDD §6 consequence chain is wired end to end', () => {
    const chain = ['evt_bc_siege_grain', 'evt_bc_bread_price', 'evt_bc_governor_ultimatum'];
    for (let i = 0; i < chain.length - 1; i++) {
      const r = emptyRefs();
      getEventDef(chain[i]!)!.choices.forEach((c) => c.effects.forEach((x) => walkEffect(x, r)));
      expect(r.events, `${chain[i]} -> ${chain[i + 1]}`).toContain(chain[i + 1]);
    }
    const ultimatum = getEventDef('evt_bc_governor_ultimatum')!;
    expect(ultimatum.choices.map((c) => c.id).sort()).toEqual(['coerce', 'intervene', 'negotiate', 'relief']);
    for (const s of Object.values(RULES.politics.stageEffects)) if (s.eventId) expect(EVENT_IDS.has(s.eventId), s.eventId).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------------------
// Hero mode
// -----------------------------------------------------------------------------------------------------

describe('hero', () => {
  const districts = new Map(HERO_DISTRICTS.map((d) => [d.id, d]));
  const chars = new Map(HERO_CHARACTERS.map((c) => [c.id, c]));
  const enemies = new Set(HERO_ENEMIES.map((e) => e.id));
  const inspectables = new Set([...HERO_DISTRICTS.flatMap((d) => d.inspectables.map((i) => i.id)), ...MISSION_INSPECTABLES.map((i) => i.id)]);
  const flags = allFlagsSet();

  it('districts and inspectables', () => {
    expect(unique(HERO_DISTRICTS.map((d) => d.id))).toBe(true);
    expect(unique([...inspectables])).toBe(true);
    expect(HERO_DISTRICTS.filter((d) => d.settlementId === 'rajapura').length).toBeGreaterThanOrEqual(5);
    for (const d of HERO_DISTRICTS) {
      expect(SETTLEMENT_IDS.has(d.settlementId)).toBe(true);
      expect(d.angle).toBeGreaterThanOrEqual(0), expect(d.angle).toBeLessThan(Math.PI * 2);
      expect(d.radius).toBeGreaterThanOrEqual(0), expect(d.radius).toBeLessThanOrEqual(1);
      expect(d.crowd).toBeGreaterThanOrEqual(0), expect(d.crowd).toBeLessThanOrEqual(1);
      for (const a of d.architecture) expect(ARCHITECTURE_KINDS).toContain(a);
      for (const i of d.inspectables) expect(ARCHITECTURE_KINDS).toContain(i.kind);
    }
  });

  it('characters, dialogues and negotiations', () => {
    expect(unique(HERO_CHARACTERS.map((c) => c.id))).toBe(true);
    for (const c of HERO_CHARACTERS) {
      const d = districts.get(c.districtId);
      expect(d, `${c.id} district`).toBeDefined();
      expect(d!.settlementId).toBe(c.settlementId);
      if (c.characterId) expect(ALL_CHARACTER_IDS.has(c.characterId), c.id).toBe(true);
      if (c.dialogueId) expect(DIALOGUES[c.dialogueId], `${c.id} dialogue`).toBeDefined();
      for (const g of [c.appearance.garment, c.appearance.accent]) expect(g).toMatch(/^#[0-9a-f]{6}$/i);
      if (c.negotiation) {
        const n = c.negotiation;
        expect(n.winAt).toBeGreaterThan(n.startStance);
        expect(n.loseAt).toBeLessThan(n.startStance);
        expect(n.patience).toBeGreaterThanOrEqual(3);
        for (const t of [...n.strongVs, ...n.weakVs, ...n.backfires]) expect(NEGOTIATION_TACTICS).toContain(t);
        expect(n.strongVs.filter((t) => n.backfires.includes(t))).toEqual([]);
        for (const clue of n.revealClues) expect(flags.has(`clue_${clue}`), `${c.id} reveal clue ${clue} is obtainable`).toBe(true);
        // Winnable: two strong arguments from the start reach winAt (base 12 x 2).
        expect(n.startStance + 2 * 24).toBeGreaterThanOrEqual(n.winAt);
        const tree = DIALOGUES[c.dialogueId!]!;
        expect(tree.nodes.win).toBeDefined();
        expect(tree.nodes.lose).toBeDefined();
      }
    }
    for (const [g, members] of Object.entries(HERO_GROUPS)) for (const m of members) expect(chars.get(m)?.negotiation, `${g}:${m}`).toBeTruthy();
    for (const [f, id] of Object.entries(HERO_AVATARS)) expect(FACTION_IDS.has(f)).toBe(true), expect(chars.has(id)).toBe(true);
    for (const t of Object.values(DIALOGUES)) {
      expect(t.nodes[t.start], `${t.id} start`).toBeDefined();
      for (const n of Object.values(t.nodes)) {
        expect(n.speaker === 'hero' || n.speaker === 'narrator' || chars.has(n.speaker), `${t.id}/${n.id} speaker ${n.speaker}`).toBe(true);
        expect(unique(n.choices.map((c) => c.id))).toBe(true);
        for (const c of n.choices) {
          if (c.next !== null) expect(t.nodes[c.next], `${t.id}/${n.id} -> ${c.next}`).toBeDefined();
          if (c.startsMission) expect(MISSION_IDS.has(c.startsMission), c.startsMission).toBe(true);
          if (c.requiresClue) expect(flags.has(`clue_${c.requiresClue}`), `${t.id} clue ${c.requiresClue}`).toBe(true);
          const r = emptyRefs();
          c.effects.forEach((x) => walkEffect(x, r));
          expectRefsResolve(r, `${t.id}/${c.id}`);
        }
      }
    }
  });

  it('missions resolve their districts, targets, enemies and flags', () => {
    expect(unique(HERO_MISSIONS.map((m) => m.id))).toBe(true);
    expect(HERO_MISSIONS.some((m) => m.kind === 'cinematic')).toBe(true);
    expect(HERO_MISSIONS.some((m) => m.kind === 'negotiation')).toBe(true);
    expect(HERO_MISSIONS.some((m) => m.kind === 'combat')).toBe(true);
    expect(HERO_MISSIONS.some((m) => m.kind === 'duel')).toBe(true);
    for (const m of HERO_MISSIONS) {
      expect(districts.get(m.startDistrict)?.settlementId, m.id).toBe(m.settlementId);
      expect(m.hour).toBeGreaterThanOrEqual(0), expect(m.hour).toBeLessThan(24);
      expect(m.objectives.some((o) => !o.optional), m.id).toBe(true);
      const waveIds = new Set(m.waves.map((w) => w.id));
      for (const w of m.waves) {
        for (const e of w.enemies) expect(enemies.has(e.enemy), `${m.id} ${e.enemy}`).toBe(true);
        expect(districts.has(w.spawn), `${m.id} spawn ${w.spawn}`).toBe(true);
      }
      for (const o of m.objectives) {
        const t = o.target;
        if (t === null) continue;
        if (o.kind === 'reach') expect(districts.has(t), `${m.id} ${t}`).toBe(true);
        if (o.kind === 'talk') expect(chars.has(t), `${m.id} ${t}`).toBe(true);
        if (o.kind === 'inspect') expect(inspectables.has(t), `${m.id} ${t}`).toBe(true);
        if (o.kind === 'persuade') expect(HERO_GROUPS[t.replace('group:', '')], `${m.id} ${t}`).toBeDefined();
        if (o.kind === 'defeat' || o.kind === 'duel') expect(enemies.has(t) || waveIds.has(t), `${m.id} ${t}`).toBe(true);
      }
      for (const s of m.cinematic) {
        expect(s.durationSec).toBeGreaterThan(0);
        expect(districts.has(s.subject) || chars.has(s.subject) || REGION_FEATURES.some((f) => f.id === s.subject), `${m.id} shot ${s.id} subject ${s.subject}`).toBe(true);
      }
      const r = emptyRefs();
      walkCondition(m.availability, r);
      [...m.onSuccess, ...m.onFailure].forEach((x) => walkEffect(x, r));
      expectRefsResolve(r, m.id);
      for (const f of r.flagsRead) expect(flags.has(f), `${m.id} reads ${f}`).toBe(true);
    }
    expect(TRAINING_STEPS.length).toBeGreaterThanOrEqual(5);
  });

  it('melee frame data is coherent', () => {
    const c = HERO_COMBAT;
    expect(c.dodge.iframeStartSec).toBeLessThan(c.dodge.iframeEndSec);
    expect(c.dodge.iframeEndSec).toBeLessThanOrEqual(c.dodge.durationSec);
    expect(c.parry.windowSec).toBeGreaterThan(0.08), expect(c.parry.windowSec).toBeLessThanOrEqual(0.3);
    expect(c.lightCombo.length).toBe(3);
    for (let i = 1; i < c.lightCombo.length; i++) expect(c.lightCombo[i]!.damage).toBeGreaterThanOrEqual(c.lightCombo[i - 1]!.damage);
    for (const m of [...c.lightCombo, c.heavy.min, c.heavy.max]) {
      expect(m.cancelAfterSec).toBeLessThanOrEqual(m.startupSec + m.activeSec + m.recoverySec);
      expect(m.staminaCost).toBeLessThan(c.stamina);
    }
    expect(c.heavy.max.damage).toBeGreaterThan(c.heavy.min.damage);
    for (const e of HERO_ENEMIES) expect(e.hp).toBeGreaterThan(0), expect(e.telegraphSec).toBeGreaterThanOrEqual(0.4);
  });
});

// -----------------------------------------------------------------------------------------------------
// Difficulty, AI, tutorial, skirmish, resources, balance, names, statistics
// -----------------------------------------------------------------------------------------------------

describe('setup and presentation data', () => {
  it('difficulty escalates monotonically', () => {
    expect(Object.keys(DIFFICULTY_DEFS).sort()).toEqual([...DIFFICULTIES].sort());
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const a = DIFFICULTY_DEFS[DIFFICULTIES[i - 1]!];
      const b = DIFFICULTY_DEFS[DIFFICULTIES[i]!];
      expect(b.aiIncome).toBeGreaterThanOrEqual(a.aiIncome);
      expect(b.aiCommanderSkill).toBeGreaterThanOrEqual(a.aiCommanderSkill);
      expect(b.eventSeverity).toBeGreaterThanOrEqual(a.eventSeverity);
      expect(b.heroParryWindowSec).toBeLessThanOrEqual(a.heroParryWindowSec);
      expect(b.heroEnemyDamage).toBeGreaterThanOrEqual(a.heroEnemyDamage);
    }
  });

  it('AI personalities are complete and bounded', () => {
    expect(Object.keys(AI_PERSONALITY_DEFS).sort()).toEqual([...AI_PERSONALITIES].sort());
    for (const p of Object.values(AI_PERSONALITY_DEFS)) {
      for (const v of Object.values(p.battle)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
      expect(p.warRatio).toBeGreaterThan(1);
      expect(p.peaceWarScore).toBeLessThan(0);
    }
  });

  it('tutorial hints are unique and scoped to real scenes', () => {
    expect(unique(TUTORIAL_HINTS.map((h) => h.id))).toBe(true);
    expect(unique(TUTORIAL_HINTS.map((h) => h.trigger))).toBe(true);
    for (const h of TUTORIAL_HINTS) {
      expect(SCENE_IDS).toContain(h.scene);
      expect(h.trigger.startsWith(`${h.scene}.`), h.id).toBe(true);
      expect(h.text.length).toBeGreaterThan(20);
    }
  });

  it('skirmish options reference real classes, presets and factions', () => {
    expect(SKIRMISH_COMPOSITIONS.some((c) => c.id === DEFAULT_COMPOSITION_ID)).toBe(true);
    for (const c of SKIRMISH_COMPOSITIONS) {
      for (const k of Object.keys(c.weights)) expect(UNIT_CLASSES).toContain(k);
      expect(Object.values(c.weights).reduce((a, b) => a + b, 0)).toBeGreaterThan(0.5);
    }
    for (const m of SKIRMISH_MAPS) expect(TERRAIN_PRESETS).toContain(m.preset);
    for (const s of SKIRMISH_SIZES) expect(s.totalSoldiers).toBeGreaterThan(0);
    for (const list of Object.values(SKIRMISH_WEATHER)) expect(list.length).toBeGreaterThan(0);
    for (const [f, c] of Object.entries(FACTION_DEFAULT_COMPOSITION)) expect(FACTION_IDS.has(f)).toBe(true), expect(SKIRMISH_COMPOSITIONS.some((x) => x.id === c)).toBe(true);
  });

  it('resources map the GDD economy onto the AoE resource bar', () => {
    expect(Object.keys(RESOURCE_DISPLAY).sort()).toEqual([...ECONOMY_RESOURCES].sort());
    expect(RESOURCE_BAR_ORDER.slice().sort()).toEqual([...ECONOMY_RESOURCES].sort());
    expect(Object.keys(RESOURCE_KIND_FEEDS).sort()).toEqual([...RESOURCE_KINDS].sort());
  });

  it('balance values are internally consistent', () => {
    const m = BALANCE.morale;
    expect(m.routThreshold).toBeLessThan(m.rallyThreshold);
    for (const w of Object.values(m.weights)) expect(w).toBeGreaterThan(0);
    const t = BALANCE.politics.rebellionThresholds;
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
    expect(t[t.length - 1]!).toBeLessThan(1);
    const q = BALANCE.military.marchKmPerDay;
    expect(q.offroad).toBeLessThan(q.track), expect(q.track).toBeLessThan(q.road), expect(q.road).toBeLessThan(q.royal_road);
    const h = RULES.harvest;
    expect(h.trickleShare + h.kharifShare + h.rabiShare).toBeCloseTo(1, 6);
    const seasonMean = Object.values(h.seasonTrickle).reduce((a, b) => a + b, 0) / 6;
    expect(seasonMean).toBeCloseTo(1, 2);
  });

  it('names are unique within pools', () => {
    expect(unique(PERSON_NAMES.male)).toBe(true);
    expect(unique(PERSON_NAMES.female)).toBe(true);
    for (const p of Object.values(NAME_POOLS)) expect(unique(p.male)).toBe(true), expect(unique(p.female)).toBe(true);
  });

  it('statistics definitions are unique and categorized', () => {
    expect(unique(END_GAME_STATS.map((s) => s.id))).toBe(true);
    const cats = new Set(STAT_CATEGORIES.map((c) => c.id));
    for (const s of END_GAME_STATS) expect(cats.has(s.category)).toBe(true);
  });

  it('every authored entry declares its historicity', () => {
    const all = [...Object.values(FACTIONS), ...Object.values(UNITS), ...Object.values(BUILDINGS), ...Object.values(AGES), ...LANDMARKS, REGION, ...REGION.provinces, ...REGION.settlements, ...Object.values(SCENARIOS), ...EVENTS, ...HERO_DISTRICTS, ...HERO_CHARACTERS, ...HERO_MISSIONS];
    for (const x of all) expect(['documented', 'reconstruction', 'fictional']).toContain(x.historicity);
  });
});

// -----------------------------------------------------------------------------------------------------
// Design model: annual grain balance per realm (DESIGN_SPEC §7.3 reference formula, §13.2 targets)
// -----------------------------------------------------------------------------------------------------

describe('economy design targets', () => {
  /** Reference implementation of the DESIGN_SPEC §7.3 annual production formula (civilians only). */
  function realmBalance(monsoon: number): Record<string, number> {
    const { terrain, sites } = resolveRegionTerrain();
    const hf = getHeightfield(terrain);
    const e = BALANCE.economy;
    const h = RULES.harvest;
    const ym = monsoon >= 1 ? 1 + (e.monsoonYieldBonus * (monsoon - 1)) / 0.4 : Math.max(0.3, 1 - (e.droughtYieldPenalty * (1 - monsoon)) / 0.3);
    const prod: Record<string, number> = {};
    const cons: Record<string, number> = {};
    for (const s of REGION.settlements) {
      const site = sites.find((x) => x.id === s.id)!;
      const prov = REGION.provinces.find((p) => p.id === s.provinceId)!;
      const labor = s.kind === 'village' ? RULES.population.defaultLabor.village : s.kind === 'fort' ? RULES.population.defaultLabor.fort : RULES.population.defaultLabor.urban;
      let fp = 0;
      let irrB = 0;
      let wB = 0;
      for (const b of s.buildings) {
        const d = BUILDINGS[b.type];
        fp += (d.effects.foodProduction ?? 0) * b.level;
        irrB += (d.effects.irrigation ?? 0) * b.level;
        wB += (d.effects.waterAvailability ?? 0) * b.level;
      }
      const water = Math.min(1, 0.45 + hf.moistureAt(site.x, site.z) * 0.5 + wB);
      const irr = Math.min(1, 0.15 + irrB);
      const shield = irr * h.irrigationShield;
      const kharif = ym * (1 - shield) + shield * (1 + e.irrigationYieldBonus);
      const rabi = (0.7 + 0.3 * Math.min(monsoon, 1.2)) * (1 - irr * 0.5) + irr * 0.5 * (1 + e.irrigationYieldBonus);
      const potential = s.population * e.laborPerPopulation * labor.farming * e.foodPerFarmerPerDay * 360 * (1 + fp) * (0.5 + 0.5 * Math.max(water, irr)) * (h.fertilityBase + h.fertilityScale * prov.fertility);
      const owner = s.defaultOwner ?? 'independent';
      prod[owner] = (prod[owner] ?? 0) + potential * (h.trickleShare + h.kharifShare * kharif + h.rabiShare * rabi);
      cons[owner] = (cons[owner] ?? 0) + s.population * e.foodPerPersonPerDay * 360;
    }
    return Object.fromEntries(Object.keys(prod).map((k) => [k, prod[k]! / cons[k]! - 1]));
  }

  it('normal monsoon: each realm keeps its economic identity', () => {
    const b = realmBalance(1);
    expect(b.heartland!).toBeGreaterThan(0.08), expect(b.heartland!).toBeLessThan(0.25);
    expect(b.highland!).toBeGreaterThan(-0.18), expect(b.highland!).toBeLessThan(-0.02);
    expect(b.forest!).toBeGreaterThan(-0.05), expect(b.forest!).toBeLessThan(0.12);
    expect(b.frontier!).toBeGreaterThan(-0.2), expect(b.frontier!).toBeLessThan(0);
  });

  it('a failed monsoon (0.7) turns every realm to deficit - the Act II crisis', () => {
    const b = realmBalance(0.7);
    for (const [k, v] of Object.entries(b)) expect(v, k).toBeLessThan(0.02);
    expect(b.heartland!).toBeGreaterThan(-0.12);
  });
});

// -----------------------------------------------------------------------------------------------------
// Integration: every scenario builds a world and runs (data works with the sim baseline)
// -----------------------------------------------------------------------------------------------------

describe('scenario worlds', () => {
  for (const sc of Object.values(SCENARIOS)) {
    it(`${sc.id} builds and runs 40 days`, () => {
      const world = createWorld({ kind: 'scenario', scenarioId: sc.id, seed: 5, difficulty: 'normal' });
      for (const a of sc.armies) expect(world.armies[a.id], a.id).toBeDefined();
      for (const c of sc.characters) expect(world.characters[c.id], c.id).toBeDefined();
      expect(world.factions[sc.playerFactionId]?.isPlayer).toBe(true);
      const hf = getRegionHeightfield(world);
      const out: SimEvent[] = [];
      for (let h = 0; h < 24 * 40; h++) {
        out.length = 0;
        tickWorld(world, [], out, hf);
        for (const inst of world.events.pending.slice()) {
          if (inst.scope.factionId !== world.playerFactionId) continue;
          const def = getEventDef(inst.defId) as EventDef;
          tickWorld(world, [{ factionId: world.playerFactionId, hour: 0, cmd: { kind: 'event_choice', eventInstanceId: inst.id, choiceId: def.choices[0]!.id } }], out, hf);
        }
        for (const eng of Object.values(world.engagements)) {
          if (eng.status === 'pending_player') tickWorld(world, [{ factionId: world.playerFactionId, hour: 0, cmd: { kind: 'engagement_decision', engagementId: eng.id, decision: 'autoresolve' } }], out, hf);
        }
      }
      const actFlag = sc.acts?.[0]?.flag;
      if (actFlag) expect(world.events.flags[actFlag], `${sc.id} prologue sets ${actFlag}`).toBe(1);
      expect(world.victory.status).toBe('ongoing');
    });
  }
});
