/**
 * Campaign AI construction and the age-up landmark (DESIGN_SPEC §8.2-§8.4, SIM-02 spec 4). OWNER: AI Engineer -
 * Battle AI, Intents & Campaign AI (SIM-02).
 *
 *  - Construction: every candidate (settlement x building type it may raise or upgrade) gets a need score - grain
 *    (fields, tanks, canals, granaries when stores spoil or overflow), housing when crowded, order and loyalty
 *    (temples), money and materials (markets, workshops, mines), the army (barracks, stables), defence where
 *    threatened (walls, watchtowers), new building types while the next age asks for more - times the personality
 *    weight of its category, discounted by cost. The best affordable one is validated by SIM-01 `validateBuild`
 *    (which places new buildings with `placement.autoPlace`) and issued with that cell. One job per run, two when
 *    rich, one project per town at a time; never below the wealth floor or into upkeep the realm cannot pay.
 *  - Age: when the next age's requirements hold and no landmark is chosen, the landmark whose effects best match the
 *    personality's top weights is started in the best allowed settlement (capital first). Short of wealth or materials
 *    the realm saves for it (construction holds back that wealth) and buys the missing materials on the market.
 */
import type { BuildingType, LandmarkDef, SettlementModifiers, SettlementState } from '../../../core/types';
import { BUILDING_TYPES } from '../../../core/types';
import { BUILDINGS } from '../../../data/buildings';
import { AGES } from '../../../data/ages';
import { FACTIONS } from '../../../data/factions';
import { RULES } from '../../../data/rules';
import { ageChecklist, ageIdx, buildingAge, buildingLevelCap, landmarkChosenForAge, landmarkOptions } from '../ages';
import { levelCost, plannedLevel, validateBuild, validateLandmark } from '../construction';
import { hasMarket, quoteMarketTrade } from '../market';
import type { Situation } from './core';
import { forget, issue, note, num, remember, str } from './core';
import { grainOutlook, spendable } from './economy';
import { goalSettlements } from './goals';

type Weights = Situation['personality']['weights'];
type Category = keyof Weights;

const DEPOSITS = ['stone', 'iron', 'copper'];

/** Personality category each building serves. */
const CATEGORY: Record<BuildingType, Category> = {
  farm_fields: 'develop',
  irrigation_canal: 'develop',
  granary: 'develop',
  water_tank: 'develop',
  stepwell: 'develop',
  market: 'trade',
  workshop: 'develop',
  mine: 'develop',
  harbor: 'trade',
  road_station: 'trade',
  barracks: 'expand',
  stables: 'raid',
  elephant_stables: 'expand',
  housing: 'develop',
  sanitation: 'develop',
  temple: 'defend',
  stupa: 'diplomacy',
  ghat: 'diplomacy',
  palace: 'develop',
  fort_walls: 'defend',
  watchtower: 'defend',
};

function level(s: SettlementState, type: BuildingType): number {
  let l = 0;
  for (const b of s.buildings) if (b.type === type) l = Math.max(l, b.level);
  return l;
}

function realmHas(sit: Situation, type: BuildingType): boolean {
  for (const s of sit.owned) if (level(s, type) > 0 || s.construction.some((j) => j.type === type && !j.landmarkId)) return true;
  return false;
}

/** Need (0..2) of building `type` in settlement `s`, before the personality weight. */
function need(sit: Situation, s: SettlementState, type: BuildingType, margin: number, threatened: boolean, wantTypes: boolean): number {
  const f = sit.f;
  const l = level(s, type);
  const crowded = s.population > 0.92 * Math.max(1, s.housing);
  const restless = s.loyalty < 0.5 || s.unrest > 0.15;
  const roster = FACTIONS[sit.fid]?.roster ?? [];
  let n = 0;
  switch (type) {
    case 'farm_fields':
      n = margin < 30 ? 1.3 : margin < 90 ? 0.8 : 0.35;
      break;
    case 'water_tank':
      n = s.waterAvailability < 0.6 ? 0.9 : 0.2;
      break;
    case 'stepwell':
      n = s.waterAvailability < 0.5 ? 0.8 : 0.15;
      break;
    case 'irrigation_canal':
      n = s.irrigation < 0.35 ? (margin < 60 ? 1.1 : 0.6) : 0.15;
      break;
    case 'granary': {
      const full = s.foodStored > 0.85 * s.foodCapacity;
      const spoiling = l === 0 && s.foodConsumption > 0 && s.foodStored > 60 * s.foodConsumption;
      n = full || spoiling ? 1.3 : l === 0 ? 0.5 : 0.15;
      break;
    }
    case 'housing':
      n = crowded ? 1.4 : 0.1;
      break;
    case 'sanitation':
      n = s.sanitation < 0.4 ? 0.8 : 0.1;
      break;
    case 'market':
      n = l === 0 ? 1.1 : 0.4;
      break;
    case 'workshop':
      n = f.materials.timber < 400 ? 1.1 : l === 0 ? 0.6 : 0.3;
      break;
    case 'mine':
      if (!s.resources.some((r) => DEPOSITS.includes(r))) return 0;
      n = f.materials.stone < 400 ? 1.1 : l === 0 ? 0.6 : 0.3;
      break;
    case 'harbor':
    case 'road_station':
      n = 0.4;
      break;
    case 'temple':
      n = restless ? 1.3 : l === 0 ? 0.4 : 0.15;
      break;
    case 'stupa':
    case 'ghat':
      n = restless ? 0.7 : 0.25;
      break;
    case 'barracks':
      n = !realmHas(sit, 'barracks') ? 1.5 : sit.capital?.id === s.id && l === 0 ? 0.6 : 0.15;
      break;
    case 'stables':
      if (!roster.some((c) => c === 'cavalry' || c === 'chariots' || c === 'scouts')) return 0;
      n = !realmHas(sit, 'stables') ? 0.9 : 0.1;
      break;
    case 'elephant_stables':
      n = roster.includes('war_elephants') && !realmHas(sit, 'elephant_stables') ? 0.5 : 0;
      break;
    case 'palace':
      n = sit.capital?.id === s.id ? 0.3 : 0;
      break;
    case 'fort_walls':
      n = threatened ? 1.3 : s.kind === 'fort' || sit.capital?.id === s.id ? 0.35 : 0.1;
      break;
    case 'watchtower':
      n = threatened ? 0.7 : 0.1;
      break;
  }
  if (wantTypes && !realmHas(sit, type)) n = n * 1.6 + 0.4;
  return n;
}

interface BuildCandidate {
  s: SettlementState;
  type: BuildingType;
  score: number;
  wealth: number;
}

/** Construction run: at most one job (two when rich). */
export function planConstruction(sit: Situation, crisis: boolean): void {
  const { world, f } = sit;
  if (crisis) return;
  let room = spendable(sit);
  if (room < 150) return;
  const margin = grainOutlook(sit).marginDays;
  const checklist = ageChecklist(world, sit.fid);
  const typesItem = checklist.items.find((i) => i.id === 'buildingTypes');
  const wantTypes = !!typesItem && !typesItem.met;
  const net = num(sit, 'net', 0);
  const threatened = new Set<string>();
  for (const t of sit.threats) if (t.threat > 0.5 * t.defense || t.besieged) threatened.add(t.s.id);
  const focus = goalSettlements(sit);
  const cands: BuildCandidate[] = [];
  for (const s of sit.owned) {
    if (s.besiegedBy || s.pendingCapture || s.rebellionStage === 'revolt' || s.rebellionStage === 'secession') continue;
    // One project per town at a time (its builders are not split); the realm builds in several towns at once.
    if (s.construction.length > 0) continue;
    for (const type of BUILDING_TYPES) {
      const def = BUILDINGS[type];
      if (!def.allowedIn.includes(s.kind)) continue;
      if (ageIdx(f.age) < ageIdx(buildingAge(type))) continue;
      const target = plannedLevel(s, type) + 1;
      if (target > buildingLevelCap(world, sit.fid, type)) continue;
      if (def.requires.some((r) => level(s, r) <= 0)) continue;
      if (s.construction.some((j) => j.type === type && !j.landmarkId)) continue;
      const n = need(sit, s, type, margin, threatened.has(s.id), wantTypes);
      if (n <= 0) continue;
      const cost = levelCost(type, target);
      if (cost.timber > f.materials.timber || cost.stone > f.materials.stone || cost.wealth > room) continue;
      // Upkeep the realm cannot carry: only for needs that pay for themselves (grain, order).
      const upkeep = def.upkeepWealth;
      if (net - upkeep < 0 && f.treasury < 12 * (upkeep - net) && CATEGORY[type] !== 'develop' && type !== 'temple') continue;
      const w = sit.personality.weights[CATEGORY[type]];
      const score = ((n * w) / (1 + cost.wealth / 1200 + (target - 1) * 0.15)) * (focus.has(s.id) ? 1.3 : 1);
      cands.push({ s, type, score, wealth: cost.wealth });
    }
  }
  cands.sort((a, b) => b.score - a.score || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : a.type < b.type ? -1 : 1));
  let started = 0;
  const maxJobs = room > 3000 ? 2 : 1;
  const used = new Set<string>();
  for (const c of cands) {
    if (started >= maxJobs || c.score < 0.25) break;
    if (used.has(c.s.id) || c.wealth > room) continue;
    const chk = validateBuild(world, sit.fid, c.s.id, c.type);
    if (!chk.ok) continue;
    issue(sit, chk.placement ? { kind: 'build', settlementId: c.s.id, building: c.type, cell: chk.placement.cell, rot: chk.placement.rot } : { kind: 'build', settlementId: c.s.id, building: c.type });
    note(sit, 'build', `builds ${BUILDINGS[c.type].name}${chk.targetLevel > 1 ? ` (level ${chk.targetLevel})` : ''} at ${c.s.name} (${CATEGORY[c.type]} need, score ${c.score.toFixed(2)})`);
    room -= chk.cost.wealth;
    used.add(c.s.id);
    started++;
  }
}

// ---------------------------------------------------------------------------------------------------
// Age-up landmark
// ---------------------------------------------------------------------------------------------------

/** Personality category and normaliser of each modifier. */
const SETTLEMENT_MOD: Partial<Record<keyof SettlementModifiers, [Category, number]>> = {
  foodProduction: ['develop', 0.15],
  foodCapacity: ['develop', 90],
  waterAvailability: ['develop', 0.3],
  irrigation: ['develop', 0.3],
  housing: ['develop', 1500],
  sanitation: ['develop', 0.2],
  publicOrder: ['defend', 0.08],
  wealth: ['trade', 0.15],
  tradeIncome: ['trade', 0.2],
  taxEfficiency: ['trade', 0.15],
  recruitmentPotential: ['expand', 0.2],
  loyalty: ['defend', 0.05],
  fortLevel: ['defend', 1],
  disasterResistance: ['develop', 0.1],
  culture: ['diplomacy', 0.2],
};
const FACTION_MOD: Record<string, Category> = {
  recruitmentPool: 'expand',
  governanceCost: 'develop',
  taxEfficiency: 'trade',
  tradeIncome: 'trade',
  fortDefense: 'defend',
  siegeStrength: 'expand',
  constructionSpeed: 'develop',
  marchSpeed: 'raid',
  forestMovement: 'raid',
  hillMovement: 'raid',
  scoutRange: 'raid',
  supplyEfficiency: 'expand',
  prolongedEngagement: 'defend',
  diplomacyOpinion: 'diplomacy',
  espionage: 'diplomacy',
};

/** How well a landmark's effects serve this personality (sum of effect sizes x category weights). */
export function landmarkScore(lm: LandmarkDef, w: Weights): number {
  let score = 0;
  const add = (mods: SettlementModifiers, k: number): void => {
    for (const key of Object.keys(mods).sort() as (keyof SettlementModifiers)[]) {
      const m = SETTLEMENT_MOD[key];
      const v = mods[key];
      if (!m || v === undefined) continue;
      score += (Math.abs(v) / m[1]) * w[m[0]] * k;
    }
  };
  add(lm.settlementEffects, 1);
  add(lm.realmEffects, 2);
  for (const key of Object.keys(lm.factionEffects).sort()) {
    const v = (lm.factionEffects as Record<string, number | undefined>)[key];
    const cat = FACTION_MOD[key];
    if (v === undefined || !cat) continue;
    score += (Math.abs(v - 1) / 0.1) * w[cat];
  }
  return score;
}

/** The landmark this realm prefers for its next age (the personality's top weights decide). */
export function preferredLandmark(sit: Situation): LandmarkDef | null {
  const next = ageChecklist(sit.world, sit.fid).nextAge;
  if (!next) return null;
  let best: LandmarkDef | null = null;
  let bestScore = -1;
  for (const o of landmarkOptions(sit.world, sit.fid)) {
    if (o.landmark.age !== next) continue;
    const sc = landmarkScore(o.landmark, sit.personality.weights);
    if (sc > bestScore + 1e-9 || (Math.abs(sc - bestScore) <= 1e-9 && best !== null && o.landmark.id < best.id)) {
      best = o.landmark;
      bestScore = sc;
    }
  }
  return best;
}

/** Age run: start the chosen landmark when the requirements hold, or save for it. */
export function planAge(sit: Situation): void {
  const { world, f } = sit;
  const checklist = ageChecklist(world, sit.fid);
  const next = checklist.nextAge;
  if (!next || landmarkChosenForAge(world, sit.fid, next)) {
    forget(sit, 'saveWealth');
    return;
  }
  if (!checklist.allMet) {
    forget(sit, 'saveWealth');
    const missing = checklist.items.filter((i) => !i.met).map((i) => i.id).join(',');
    if (str(sit, 'ageMissing', '') !== missing) {
      remember(sit, 'ageMissing', missing);
      note(sit, 'age', `the ${AGES[next].name} needs: ${checklist.items.filter((i) => !i.met).map((i) => `${i.label} ${Math.floor(i.current * 100) / 100}/${i.required}`).join(', ')}`);
    }
    return;
  }
  forget(sit, 'ageMissing');
  const lm = preferredLandmark(sit);
  if (!lm) return;
  if (str(sit, 'landmark', '') !== lm.id) {
    remember(sit, 'landmark', lm.id);
    note(sit, 'age', `chooses ${lm.name} for the ${AGES[next].name} (${lm.summary})`);
  }
  // Host: the capital when allowed, else the most populous allowed settlement.
  const sites = sit.owned.filter((s) => lm.allowedIn.includes(s.kind) && !s.besiegedBy && !s.pendingCapture);
  sites.sort((a, b) => (sit.capital?.id === b.id ? 1 : 0) - (sit.capital?.id === a.id ? 1 : 0) || b.population - a.population || (a.id < b.id ? -1 : 1));
  const host = sites[0];
  if (!host) return;
  const chk = validateLandmark(world, sit.fid, lm.id, host.id, null);
  if (chk.ok) {
    issue(sit, { kind: 'start_landmark', landmarkId: lm.id, settlementId: host.id, cell: chk.placement ? chk.placement.cell : [0, 0], ...(chk.placement ? { rot: chk.placement.rot } : {}) });
    forget(sit, 'saveWealth');
    note(sit, 'age', `begins ${lm.name} at ${host.name} to enter the ${AGES[next].name}`);
    return;
  }
  // Save the wealth; buy missing materials when the treasury covers them.
  remember(sit, 'saveWealth', Math.round(lm.cost.wealth));
  if (!hasMarket(world, sit.fid)) return;
  for (const res of ['timber', 'stone'] as const) {
    const missing = lm.cost[res] - f.materials[res];
    if (missing <= 0) continue;
    const lots = Math.min(20, Math.ceil(missing / RULES.market.lot));
    const q = quoteMarketTrade(world, sit.fid, res, lots, true);
    if (q.ok && f.treasury - q.wealth > lm.cost.wealth + 300) {
      issue(sit, { kind: 'market_trade', resource: res, lots, buy: true });
      note(sit, 'age', `buys ${lots * RULES.market.lot} ${res} for ${lm.name} (${Math.round(q.wealth)})`);
    }
  }
}
