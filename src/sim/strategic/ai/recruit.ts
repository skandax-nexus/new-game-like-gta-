/**
 * Campaign AI recruitment and demobilisation (DESIGN_SPEC §7.6, SIM-02 spec 4). OWNER: AI Engineer - Battle AI,
 * Intents & Campaign AI (SIM-02).
 *
 *  - Ceiling: 0.04 x realm population soldiers (x1.3 expansionist, x0.7 mercantile); at peace and unthreatened the
 *    realm keeps 70% of it (80% defensive). Never into upkeep it cannot pay: the projected month after the new
 *    upkeep must stay >= 0, or the treasury must carry the deficit for two years (one year at war).
 *  - Composition: a personality doctrine (shares of spearmen, archers, horse, guards, elephants...) filtered by the
 *    roster, the age and the buildings that train them; the class furthest below its share is raised next; every
 *    field army gets a supply train and, for realms that besiege, engineers.
 *  - Where: settlements that can train the class, have the recruits and the grain. Recruits join the main field
 *    army (`targetArmyId`) when there is one; otherwise the settlement's rally point musters a new host (the military
 *    planner merges it). Standing garrisons first: two formations in the capital and forts at war, one in towns and
 *    villages near an enemy; a threatened settlement that no army can reach raises its own.
 *  - Demobilisation: a month in the red with the treasury below zero (or under four months of runway) for 10+ days
 *    disbands the smallest secondary army, else splits the costliest formations off the main host to disband them.
 */
import type { ArmyState, SettlementState, UnitClass } from '../../../core/types';
import { sortedKeys } from '../../../core/ids';
import { UNITS } from '../../../data/units';
import { FACTIONS } from '../../../data/factions';
import { RULES } from '../../../data/rules';
import { armySoldiers, armyStrength } from '../armies';
import { recruitCost, unlockedHere, validateRecruit } from '../recruitment';
import { unitAgeReason } from '../ages';
import { hasElephantSource } from '../recruitment';
import type { Situation } from './core';
import { dist, issue, note, num } from './core';
import { spendable } from './economy';

/** Doctrine shares per personality (formations). */
const DOCTRINE: Record<string, Partial<Record<UnitClass, number>>> = {
  expansionist: { spearmen: 0.36, archers: 0.24, cavalry: 0.16, elite_guards: 0.06, war_elephants: 0.06, chariots: 0.04 },
  defensive: { spearmen: 0.45, archers: 0.33, cavalry: 0.08, elite_guards: 0.1 },
  mercantile: { spearmen: 0.4, archers: 0.3, cavalry: 0.16, elite_guards: 0.08 },
  opportunist: { spearmen: 0.36, archers: 0.26, cavalry: 0.18, war_elephants: 0.06, elite_guards: 0.04 },
  diplomatic: { spearmen: 0.4, archers: 0.3, cavalry: 0.14, elite_guards: 0.1 },
  raider: { spearmen: 0.2, archers: 0.22, cavalry: 0.32, chariots: 0.12, scouts: 0.1 },
};

/** Soldier ceiling of the realm (0.04 x population x personality). */
export function soldierCeiling(sit: Situation): number {
  const k = sit.f.ai.personality === 'expansionist' ? 1.3 : sit.f.ai.personality === 'mercantile' ? 0.7 : 1;
  return 0.04 * sit.realmPop * k;
}

/** The realm's main field army: the strongest (ties: oldest id). */
export function mainArmy(sit: Situation): ArmyState | null {
  let best: ArmyState | null = null;
  let bs = -1;
  for (const a of sit.armies) {
    const s = armyStrength(a);
    if (s > bs) {
      bs = s;
      best = a;
    }
  }
  return best;
}

function canTrain(sit: Situation, cls: UnitClass): boolean {
  if (!(FACTIONS[sit.fid]?.roster ?? []).includes(cls)) return false;
  if (unitAgeReason(sit.world, sit.fid, cls)) return false;
  if (cls === 'war_elephants' && RULES.recruitment.elephantsNeedSource && !hasElephantSource(sit.world, sit.fid)) return false;
  for (const s of sit.owned) if (unlockedHere(s, cls)) return true;
  return false;
}

/** Formations per class across field armies, garrisons, queues and this run's own recruit commands. */
function composition(sit: Situation): Map<UnitClass, number> {
  const m = new Map<UnitClass, number>();
  for (const c of sit.commands) if (c.cmd.kind === 'recruit') m.set(c.cmd.unitClass, (m.get(c.cmd.unitClass) ?? 0) + c.cmd.formations);
  for (const a of sit.armies) for (const u of a.units) m.set(u.unitClass, (m.get(u.unitClass) ?? 0) + 1);
  for (const s of sit.owned) for (const u of s.garrison) m.set(u.unitClass, (m.get(u.unitClass) ?? 0) + 1);
  for (const s of sit.owned) for (const j of s.recruitment) m.set(j.unitClass, (m.get(j.unitClass) ?? 0) + j.formations);
  return m;
}

/** The class to raise next (most below its doctrine share), or null. */
function nextClass(sit: Situation, main: ArmyState | null): UnitClass | null {
  const comp = composition(sit);
  // Every host marches with a supply train; besiegers bring engineers.
  if (main && !main.units.some((u) => u.unitClass === 'supply_train') && !(comp.get('supply_train') ?? 0) && canTrain(sit, 'supply_train')) return 'supply_train';
  const w = sit.personality.weights;
  if (main && (w.expand >= 1 || sit.enemies.length > 0) && !main.units.some((u) => u.unitClass === 'engineers') && !(comp.get('engineers') ?? 0) && canTrain(sit, 'engineers')) return 'engineers';
  const doctrine = DOCTRINE[sit.f.ai.personality] ?? DOCTRINE.opportunist!;
  let total = 0;
  for (const [cls, n] of comp) if (cls in doctrine) total += n;
  let best: UnitClass | null = null;
  let gap = -Infinity;
  for (const cls of Object.keys(doctrine).sort() as UnitClass[]) {
    const share = doctrine[cls] ?? 0;
    if (!canTrain(sit, cls)) continue;
    const g = share - (comp.get(cls) ?? 0) / Math.max(1, total + 1);
    if (g > gap) {
      gap = g;
      best = cls;
    }
  }
  return best ?? (canTrain(sit, 'spearmen') ? 'spearmen' : null);
}

/** Soldiers the realm wants under arms now. */
export function soldierTarget(sit: Situation): number {
  const cap = soldierCeiling(sit);
  let pressed = sit.enemies.length > 0;
  for (const t of sit.threats) if (t.threat > 0.3 * Math.max(1, t.defense) || t.besieged) pressed = true;
  if (pressed) return cap;
  return cap * (sit.f.ai.personality === 'defensive' ? 0.8 : 0.7);
}

/** Recruitment run (staggered with economy runs). */
export function planRecruitment(sit: Situation, crisis: boolean): void {
  const { world, f } = sit;
  if (crisis) return;
  const target = soldierTarget(sit);
  let queued = 0;
  for (const s of sit.owned) for (const j of s.recruitment) queued += j.formations * 100;
  // Garrisons may exceed the field target by 40% (walls before field armies), never more.
  let garrisonGap = false;
  if (sit.soldiers + queued < 1.4 * soldierCeiling(sit)) for (const s of sit.owned) if (s.garrison.length < garrisonMinimum(sit, s) && s.recruitment.length === 0) garrisonGap = true;
  if (sit.soldiers + queued >= target && !garrisonGap) return;
  const main = mainArmy(sit);
  let room = spendable(sit);
  let net = num(sit, 'net', 0);
  const atWar = sit.enemies.length > 0;
  let jobs = 0;
  // Standing garrisons: two formations in the capital and forts, one in towns near an enemy while at war.
  for (const s of sit.owned) {
    if (jobs >= 2 || !garrisonGap) break;
    const min = garrisonMinimum(sit, s);
    let have = s.garrison.length;
    if (!s.rallyPoint) for (const j of s.recruitment) if (!j.targetArmyId) have += j.formations;
    if (have >= min || s.besiegedBy) continue;
    const cls: UnitClass | null = s.garrison.length % 2 === 1 && canTrain(sit, 'archers') && unlockedHere(s, 'archers') ? 'archers' : canTrain(sit, 'spearmen') && unlockedHere(s, 'spearmen') ? 'spearmen' : null;
    if (!cls) continue;
    if (s.rallyPoint) issue(sit, { kind: 'set_rally_point', settlementId: s.id, rallyPoint: null });
    const r = tryRecruit(sit, s, cls, null, room, net, atWar, `for the garrison of ${s.name} (${have}/${min} formations)`, true);
    if (r) {
      room -= r.wealth;
      net -= r.upkeep;
      jobs++;
    }
  }
  // Garrison levies where a threatened settlement has no army near.
  for (const t of sit.threats) {
    if (jobs >= 2) break;
    if (!(t.threat > t.defense) || t.besieged) continue;
    let near = false;
    for (const a of sit.armies) if (dist(a, t.s) < 1500 && armyStrength(a) > 0.6 * t.threat) near = true;
    if (near) continue;
    const cls = canTrain(sit, 'spearmen') && unlockedHere(t.s, 'spearmen') ? 'spearmen' : canTrain(sit, 'archers') && unlockedHere(t.s, 'archers') ? 'archers' : null;
    if (!cls) continue;
    if (t.s.rallyPoint) issue(sit, { kind: 'set_rally_point', settlementId: t.s.id, rallyPoint: null });
    const r = tryRecruit(sit, t.s, cls, null, room, net, atWar, `to hold ${t.s.name}`, true);
    if (r) {
      room -= r.wealth;
      net -= r.upkeep;
      jobs++;
    }
  }
  while (jobs < 2 && sit.soldiers + queued < target) {
    const cls = nextClass(sit, main);
    if (!cls) return;
    const site = bestSite(sit, cls, main);
    if (!site) return;
    const r = tryRecruit(sit, site, cls, main ? main.id : null, room, net, atWar, main ? `for ${main.name}` : 'to muster a new host', false, target - sit.soldiers - queued);
    if (!r) return;
    room -= r.wealth;
    net -= r.upkeep;
    jobs++;
    if (sit.soldiers + queued + r.soldiers >= target) return;
    queued += r.soldiers;
  }
  void f;
  void world;
}

/** Settlement to raise `cls` in: can train it, has recruits and grain; nearest the main army (capital first). */
function bestSite(sit: Situation, cls: UnitClass, main: ArmyState | null): SettlementState | null {
  const cost = recruitCost(sit.world, sit.fid, cls, 1);
  let best: SettlementState | null = null;
  let bd = Infinity;
  for (const s of sit.owned) {
    if (s.besiegedBy || !unlockedHere(s, cls) || s.recruitment.length >= 3) continue;
    if (s.recruitPool < cost.recruits || s.foodStored < cost.grain + 30 * s.foodConsumption) continue;
    const d = main ? dist(main, s) : sit.capital?.id === s.id ? 0 : 1000;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Garrison formations a settlement should keep. */
export function garrisonMinimum(sit: Situation, s: SettlementState): number {
  if (sit.capital?.id === s.id) return 2;
  if (s.kind === 'fort') return sit.enemies.length > 0 ? 2 : 1;
  if (sit.enemies.length === 0) return 0;
  // Near an enemy: one formation in towns within 3,500 m of an enemy-held settlement, villages within 2,500 m (an
  // empty town falls to the first column that reaches it).
  const reach = s.kind === 'village' ? 2500 : 3500;
  for (const id of sortedKeys(sit.world.settlements)) {
    const o = sit.world.settlements[id]!;
    if (o.ownerFactionId && sit.enemies.includes(o.ownerFactionId) && dist(o, s) < reach) return 1;
  }
  return 0;
}

/**
 * Queue one recruitment job of 1-4 formations (a job trains its formations together, so a batch is as quick as one):
 * as many as the gap to the target, the wealth room, the upkeep test, the recruits and the grain allow.
 */
function tryRecruit(sit: Situation, s: SettlementState, cls: UnitClass, targetArmyId: string | null, room: number, net: number, atWar: boolean, why: string, garrison = false, gap = 0): { wealth: number; upkeep: number; soldiers: number } | null {
  const { world, f } = sit;
  const per = recruitCost(world, sit.fid, cls, 1);
  const want = garrison ? 1 : Math.max(1, Math.min(RULES.recruitment.maxFormationsPerJob, Math.floor(gap / Math.max(1, per.recruits))));
  for (let n = want; n >= 1; n--) {
    const chk = validateRecruit(world, sit.fid, s.id, cls, n, targetArmyId);
    if (!chk.ok || chk.cost.wealth > room) continue;
    const soldiers = chk.cost.recruits;
    const upkeep = soldiers * UNITS[cls].stats.upkeepWealth;
    const after = net - upkeep;
    if (after < 0 && f.treasury < -after * (atWar ? 12 : 24)) continue;
    // No army to join: the settlement's rally point musters a new host next to it.
    if (!garrison && !targetArmyId && s.garrison.length >= 2 && !s.rallyPoint) {
      issue(sit, { kind: 'set_rally_point', settlementId: s.id, rallyPoint: { kind: 'point', x: s.x + s.radius + 80, z: s.z + 40 } });
    }
    issue(sit, { kind: 'recruit', settlementId: s.id, unitClass: cls, formations: n, targetArmyId });
    note(sit, 'recruit', `raises ${n > 1 ? `${n} x ` : ''}${FACTIONS[sit.fid]?.unitVariants?.[cls]?.name ?? UNITS[cls].name} at ${s.name} ${why} (${Math.round(sit.soldiers)} soldiers of ${Math.round(soldierTarget(sit))} wanted, ${Math.round(chk.cost.wealth)} wealth)`);
    return { wealth: chk.cost.wealth, upkeep, soldiers };
  }
  return null;
}

/**
 * Upkeep the treasury cannot carry: when the month is in the red and the treasury is below zero (or holds under four
 * months of the deficit) for 10+ days, cut the army - the smallest secondary field army is disbanded; with only the
 * main host left, its costliest formations (by upkeep) covering the deficit are split off, to be disbanded on the next
 * run. Garrisons stay (they hold the towns).
 */
export function planDemobilize(sit: Situation): void {
  const net = num(sit, 'net', 0);
  if (net >= 0) return;
  const since = num(sit, 'crisisSince', -1);
  const runway = sit.f.treasury / -net;
  if (since < 0 || sit.day - since < 10 || (sit.f.treasury >= 0 && runway >= 4)) return;
  const main = mainArmy(sit);
  let pick: ArmyState | null = null;
  for (const a of sit.armies) {
    if (a === main || a.engagementId || a.status === 'besieging' || a.status === 'in_battle') continue;
    if (!pick || armySoldiers(a) < armySoldiers(pick)) pick = a;
  }
  if (pick) {
    issue(sit, { kind: 'disband_army', armyId: pick.id });
    note(sit, 'recruit', `disbands ${pick.name} (${armySoldiers(pick)} soldiers): the treasury cannot carry its upkeep (${Math.round(sit.f.treasury)} in hand, ${Math.round(net)} a month)`);
    return;
  }
  if (!main || main.engagementId || main.status === 'in_battle' || main.units.length < 2) return;
  // Split off the costliest formations until the deficit is covered (never the whole host).
  const units = main.units.slice().sort((a, b) => b.soldiers * UNITS[b.unitClass].stats.upkeepWealth - a.soldiers * UNITS[a.unitClass].stats.upkeepWealth || (a.id < b.id ? -1 : 1));
  const ids: string[] = [];
  let saved = 0;
  for (const u of units) {
    if (ids.length >= main.units.length - 1 || saved >= -net) break;
    ids.push(u.id);
    saved += u.soldiers * UNITS[u.unitClass].stats.upkeepWealth;
  }
  if (ids.length === 0) return;
  issue(sit, { kind: 'split_army', armyId: main.id, unitIds: ids });
  note(sit, 'recruit', `splits ${ids.length} formation(s) off ${main.name} to stand them down (${Math.round(saved)} a month of upkeep; ${Math.round(sit.f.treasury)} in hand, ${Math.round(net)} a month)`);
}
