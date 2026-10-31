/**
 * Campaign AI army operations (DESIGN_SPEC §7.7-§7.9, SIM-02 spec 4). OWNER: AI Engineer - Battle AI, Intents &
 * Campaign AI (SIM-02).
 *
 * Each field army carries an operation in the realm's plan memory (`op_<armyId>`): defend, hunt, siege, raid, join,
 * resupply, home. Orders are issued only when the operation or its target changes (no daily re-pathing).
 *  - Supply first (daily): an army whose train runs low marches to resupply at the nearest own town with grain to spare
 *    over its 30-day floor (explicit sourceId), else the nearest town, topped up from the royal reserve (send_relief).
 *    It is done at 60% of its train; with no gain in 3 days it tries another source, after two fruitless tries it
 *    goes back to its operations (CD review round 1, B1 a). A siege camp gets a depot 150 m behind it and grain
 *    requisitioned into it from the nearest own settlement that can spare it (the player's conquest path, §7.8).
 *  - Defence (daily): a settlement under siege, or facing more hostile strength than it holds, is relieved by the
 *    nearest army strong enough to beat the threat (own strength >= the enemy's x 1.0-1.2 by aggression); a weaker
 *    army instead garrisons the town if it gets there first. Never attacks a stronger host.
 *  - Defence spells end: a pursuit (defence or hunt) of one enemy gives up after 10 days (not chased again for 20); a
 *    host that has chased threats for 15 days without a battle stops for 20 days (vital threats excepted; B1 b).
 *  - Offensives (strategy runs, at war - or against free towns for realms with an appetite): first the realm's own lost
 *    towns (held at the start or for 90+ days) the host outmatches (B1 c); then the main army hunts a weaker enemy army
 *    it can see, else besieges the best settlement by value / distance / defence, provided it beats
 *    the garrison plus nearby enemy armies by 1.2-1.6x (aggression), carries engineers (or elephants) for walls, has
 *    food, and the fords are open (no long marches in flood). It assaults once the walls are breached (1.3x the
 *    defenders) or laddered (2x); a capital needs 1.6x more to be besieged and is stormed only through a breach at 2.5x,
 *    and a fortified capital (fort level 2+) is besieged only by an expansionist. While an enemy still has a host of
 *    40% of ours in the field the main army fights near home (targets within 3,000 m of the capital or 1,500 m of an
 *    own settlement).
 *    It lifts a siege that turned hopeless. No siege in a realm whose field strength (realm strength
 *    minus garrisons) outmatches the host x (1 - 0.4 aggression). Raiders (raid weight) send their horse to raid weakly
 *    held enemy settlements.
 *    When it finds nothing it can take it records `noTarget` (the stall audit and the quiet-war peace read it).
 *  - Concentration: secondary armies march to the main army and merge with it; idle armies return to their station.
 *  - Stance from the battle personality (aggressive / balanced / cautious).
 * Perception: hostile armies count only while seen (`visibility`) or as last-seen ghosts; garrisons the realm has no
 * intelligence on (< 0.3) are assumed 25% stronger.
 */
import type { ArmyOrder, ArmyState, ArmyStance, SettlementState } from '../../../core/types';
import { sortedKeys } from '../../../core/ids';
import { RULES } from '../../../data/rules';
import { armyStrength, MERGE_DISTANCE } from '../armies';
import { assaultState, settlementHostile } from '../siege';
import { intelLevel } from '../espionage';
import { armyFoodNeed, validateCreateDepot } from '../supply';
import { hostileToArmy } from '../state';
import type { Situation } from './core';
import { armySupplyDays, dist, forget, garrisonStrength, issue, note, num, recently, remember, str } from './core';
import { mainArmy } from './recruit';

/** A defence spell without a battle ends after this many days (no endless shuttling between threats). */
const DEFEND_SPELL = 15;

/** A resupplying army is done at this share of its train (CD-B1 a). */
const RESUPPLY_DONE = 0.6;

/** A defender chases a threat only while it stays this close to the town it threatens (m). */
const DEFEND_RADIUS = 2500;

/** Effective campaign aggression 0..1: battle personality + difficulty / sandbox bonus. */
export function aggressionOf(sit: Situation): number {
  return Math.min(1, Math.max(0, sit.personality.battle.aggression + sit.aggressionBonus));
}

/** Strength ratio an attack needs (1.2 at aggression 1 ... 1.6 at 0). */
function attackRatio(sit: Situation): number {
  return 1.6 - 0.4 * aggressionOf(sit);
}

function sameOrder(a: ArmyState, o: ArmyOrder): boolean {
  const c = a.order;
  if (c.kind !== o.kind) return false;
  switch (o.kind) {
    case 'move':
    case 'retreat':
      return c.kind === o.kind && Math.abs(c.x - o.x) + Math.abs(c.z - o.z) < 60;
    case 'attack_army':
      return c.kind === 'attack_army' && c.targetArmyId === o.targetArmyId;
    case 'besiege':
    case 'raid':
    case 'garrison':
    case 'assault':
      return 'settlementId' in c && c.settlementId === o.settlementId;
    case 'resupply':
      return true;
    default:
      return true;
  }
}

function order(sit: Situation, a: ArmyState, o: ArmyOrder, op: string, why: string | null, tasked: Set<string>): void {
  tasked.add(a.id);
  const prev = str(sit, `op_${a.id}`, '');
  if (prev !== op) {
    remember(sit, `op_${a.id}`, op);
    remember(sit, `opd_${a.id}`, sit.day);
    if (why) note(sit, 'army', `${a.name}: ${why}`);
  }
  if (sameOrder(a, o)) return;
  issue(sit, { kind: 'army_order', armyId: a.id, order: o });
}

/** Seen hostile armies (and last-seen ghosts) with their (estimated) strength. */
interface Contact {
  id: string;
  army: ArmyState | null;
  x: number;
  z: number;
  strength: number;
}

function contacts(sit: Situation): Contact[] {
  const { world, fid } = sit;
  const out: Contact[] = [];
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id]!;
    if (a.units.length === 0 || a.status === 'disbanded' || !hostileToArmy(world, fid, a)) continue;
    if ((a.visibility[fid] ?? 0) > 0 || a.status === 'besieging') out.push({ id, army: a, x: a.x, z: a.z, strength: armyStrength(a) });
  }
  const per = perSoldier(sit);
  for (const id of sortedKeys(sit.f.ghosts)) {
    const g = sit.f.ghosts[id]!;
    if (out.some((c) => c.id === id)) continue;
    const a = world.armies[id];
    if (!a || !hostileToArmy(world, fid, a)) continue;
    out.push({ id, army: null, x: g.x, z: g.z, strength: g.soldiers * per });
  }
  return out;
}

/** Average strength per soldier of the realm's own field armies (ghost estimates). */
function perSoldier(sit: Situation): number {
  let s = 0;
  let n = 0;
  for (const a of sit.armies) {
    s += armyStrength(a);
    for (const u of a.units) n += u.soldiers;
  }
  return n > 0 ? s / n : 40;
}

function hasSiegeTools(a: ArmyState): boolean {
  return a.units.some((u) => (u.unitClass === 'engineers' || u.unitClass === 'war_elephants') && u.soldiers > 0);
}

/** Defenders of `t` the realm can reckon with: garrison (x1.25 without intelligence) + seen armies within 1,200 m. */
function defenseOf(sit: Situation, t: SettlementState, seen: readonly Contact[]): number {
  let d = garrisonStrength(t);
  if (t.ownerFactionId && intelLevel(sit.world, sit.fid, t.ownerFactionId) < 0.3) d *= 1.25;
  for (const c of seen) if (c.army && c.army.factionId === t.ownerFactionId && dist(c, t) < 1200) d += c.strength;
  return d;
}

/** Station of an idle army: the most threatened owned settlement, else the capital. */
function station(sit: Situation): SettlementState | null {
  let best: SettlementState | null = sit.capital;
  let bt = 0;
  for (const t of sit.threats) {
    if (t.threat > bt) {
      bt = t.threat;
      best = t.s;
    }
  }
  return best ?? sit.owned[0] ?? null;
}

/** Daily: supply, siege work and defence. Strategy runs add offensives, raids, concentration and stations. */
export function planMilitary(sit: Situation, strategy: boolean): void {
  const { world } = sit;
  const tasked = new Set<string>();
  const seen = contacts(sit);
  const main = mainArmy(sit);
  const ratio = attackRatio(sit);
  if (strategy) {
    cleanMemory(sit);
    markHeld(sit);
  }
  // 1. Supply (siege camps are fed by siegeWork below).
  const besieging: ArmyState[] = [];
  for (const a of sit.armies) {
    if (a.engagementId || a.status === 'in_battle') {
      tasked.add(a.id);
      continue;
    }
    if (a.status === 'besieging' && 'settlementId' in a.order) {
      besieging.push(a);
      continue;
    }
    // Armies carry 5 days of rations; one drawing from a source in reach is fed. March to resupply when the train
    // runs low with no source, or is nearly empty - to a source with grain to spare (CD-B1 a).
    const days = armySupplyDays(world, a);
    const share = a.supply.foodCapacity > 0 ? a.supply.food / a.supply.foodCapacity : 1;
    const fed = a.supply.sourceId !== null && a.supply.lineIntact;
    if (a.status !== 'garrisoned' && a.order.kind !== 'resupply' && ((share < 0.4 && !fed) || days < 1.5)) {
      const src = resupplySource(sit, a, null);
      order(sit, a, { kind: 'resupply', sourceId: src ? src.id : null }, 'resupply', `marches to resupply at ${src ? src.name : 'the nearest town'} (${days.toFixed(1)} days of food)`, tasked);
      remember(sit, `rsp_${a.id}`, `${sit.day},${Math.round(a.supply.food)}`);
      continue;
    }
    if (a.order.kind === 'resupply') resupplying(sit, a, share, tasked);
  }
  // 2. Defence. The capital or a besieged town may recall an army from its own siege. A defence order stands for 5
  // days while its enemy is still in the field (no daily switching between two threats).
  const threats = sit.threats.slice().sort((x, y) => urgency(sit, y) - urgency(sit, x) || (x.s.id < y.s.id ? -1 : 1));
  const engaged = new Set<string>();
  for (const a of sit.armies) {
    if (tasked.has(a.id)) continue;
    const op = str(sit, `op_${a.id}`, '');
    if (!(op.startsWith('defend:') || op.startsWith('hold:')) || sit.day - num(sit, `opd_${a.id}`, -99) >= 5) continue;
    const parts = op.split(':');
    if (parts[0] === 'defend') {
      // The pursuit ends when the enemy leaves the defended town's surroundings (no chase across the map).
      const e = world.armies[parts[1] ?? ''];
      const home = world.settlements[parts[2] ?? ''];
      if (!e || !home || e.units.length === 0 || e.status === 'garrisoned' || !hostileToArmy(world, sit.fid, e)) continue;
      if (home.ownerFactionId !== sit.fid || dist(e, home) > DEFEND_RADIUS) continue;
      engaged.add(e.id);
    }
    tasked.add(a.id);
  }
  // Give up a pursuit (defence or hunt) that has run 10 days: that enemy is not chased again for 20 days.
  for (const a of sit.armies) {
    const op = str(sit, `op_${a.id}`, '');
    if (!(op.startsWith('defend:') || op.startsWith('hunt:')) || sit.day - num(sit, `opd_${a.id}`, sit.day) < 10) continue;
    const e = op.split(':')[1] ?? '';
    if (!world.armies[e]) continue;
    remember(sit, `nochase_${e}`, sit.day);
    forget(sit, `op_${a.id}`);
    if (op.startsWith('hunt:')) note(sit, 'army', `${a.name}: gives up the chase of ${world.armies[e]?.name ?? e} after 10 days`);
    tasked.delete(a.id);
    engaged.delete(e);
  }
  // A defence spell (defend orders, whatever the enemy) that has run 15 days without a battle ends: the host stops
  // shuttling between threats for 20 days (vital ones excepted) and the garrisons hold. Memory `dfs_<id>` (spell start),
  // `nodefend_<id>`.
  for (const a of sit.armies) {
    const op = str(sit, `op_${a.id}`, '');
    const key = `dfs_${a.id}`;
    if (a.engagementId || a.status === 'in_battle' || !op.startsWith('defend:')) {
      if (key in sit.f.ai.memory && !op.startsWith('defend:')) forget(sit, key);
      else if (key in sit.f.ai.memory) remember(sit, key, sit.day);
      continue;
    }
    const since = num(sit, key, -1);
    if (since < 0) {
      remember(sit, key, num(sit, `opd_${a.id}`, sit.day));
      continue;
    }
    if (sit.day - since < DEFEND_SPELL) continue;
    forget(sit, key);
    forget(sit, `op_${a.id}`);
    remember(sit, `nodefend_${a.id}`, sit.day);
    tasked.delete(a.id);
    engaged.delete(op.split(':')[1] ?? '');
    note(sit, 'army', `${a.name}: ends ${DEFEND_SPELL} days of chasing threats without a battle - the garrisons hold`);
  }
  // A band too small to matter is left to the garrisons (recruit.ts raises them); one that keeps evading for 10 days
  // is not chased for the next 20 (no hunt across the map after a remnant that will not stand).
  const minThreat = Math.max(150, 0.05 * (main ? armyStrength(main) : 0));
  for (const t of threats) {
    if (!t.besieged && !(t.threat > 0.8 * t.defense && t.threat >= minThreat)) continue;
    const enemy = t.enemy;
    if (!enemy || engaged.has(enemy.id) || dist(enemy, t.s) > DEFEND_RADIUS) continue;
    if (recently(sit, `nochase_${enemy.id}`, 20) && !t.besieged) continue;
    const es = armyStrength(enemy);
    const vital = t.besieged || sit.capital?.id === t.s.id;
    let best: ArmyState | null = null;
    let bd = Infinity;
    for (const a of sit.armies) {
      if (tasked.has(a.id)) continue;
      if (a.status === 'besieging' && !vital) continue;
      if (!vital && recently(sit, `nodefend_${a.id}`, 20)) continue;
      const own = armyStrength(a);
      if (own < es * Math.max(1, ratio - 0.4)) continue;
      // A host marching on a siege is not turned back for a raid: only a siege at home or a real threat recalls it.
      const op = str(sit, `op_${a.id}`, '');
      if (op.startsWith('siege:') && !vital && es < 0.35 * own) continue;
      const d = dist(a, enemy);
      if (d < bd && d < 4000) {
        bd = d;
        best = a;
      }
    }
    if (best) {
      order(sit, best, { kind: 'attack_army', targetArmyId: enemy.id }, `defend:${enemy.id}:${t.s.id}`, `${best.status === 'besieging' ? 'breaks off its siege and ' : ''}marches against ${enemy.name} to defend ${t.s.name} (${Math.round(armyStrength(best))} vs ${Math.round(es)})`, tasked);
      if (dist(best, enemy) > 1500 && !best.forcedMarch) issue(sit, { kind: 'forced_march', armyId: best.id, on: true });
      continue;
    }
    // Too weak to fight it in the field: hold the walls if it gets there first.
    if (t.s.fortLevel >= 1 && !t.besieged) {
      for (const a of sit.armies) {
        if (tasked.has(a.id) || a.status === 'besieging') continue;
        if (dist(a, t.s) < dist(enemy, t.s) && dist(a, t.s) < 2500) {
          order(sit, a, { kind: 'garrison', settlementId: t.s.id }, `hold:${t.s.id}`, `falls back behind the walls of ${t.s.name}: ${enemy.name} is too strong to meet in the field`, tasked);
          break;
        }
      }
    }
  }
  // 3. Siege work.
  for (const a of besieging) if (!tasked.has(a.id) && 'settlementId' in a.order) siegeWork(sit, a, a.order.settlementId, seen, tasked);
  if (!strategy) return;
  // 3. Offensives (main army; others join it).
  const homeThreat = threats.some((t) => t.besieged || (t.threat > t.defense && (!main || t.threat > 0.5 * armyStrength(main))));
  if (main && !tasked.has(main.id) && !homeThreat && armySupplyDays(world, main) >= 8) offensive(sit, main, seen, ratio, homeSafe(sit, main), tasked);
  // 4. Raids (raid weight >= 1): a secondary mounted force raids weakly held enemy settlements.
  if (sit.personality.weights.raid >= 1 && sit.enemies.length > 0) {
    for (const a of sit.armies) {
      if (tasked.has(a.id) || (a === main && sit.armies.length > 1)) continue;
      raid(sit, a, seen, tasked);
    }
  }
  // 5. Concentration and stations.
  for (const a of sit.armies) {
    if (tasked.has(a.id) || a.status === 'besieging') continue;
    if (a.forcedMarch) issue(sit, { kind: 'forced_march', armyId: a.id, on: false });
    if (main && a !== main) {
      const d = dist(a, main);
      if (d <= MERGE_DISTANCE && main.status !== 'in_battle' && !main.engagementId) {
        issue(sit, { kind: 'merge_armies', armyId: main.id, otherArmyId: a.id });
        forget(sit, `op_${a.id}`);
        note(sit, 'army', `${a.name} joins ${main.name}`);
        tasked.add(a.id);
        continue;
      }
      if (main.status !== 'marching' || d < 1500) {
        order(sit, a, { kind: 'move', x: main.x, z: main.z }, `join:${main.id}`, `marches to join ${main.name}`, tasked);
        continue;
      }
    }
    const st = station(sit);
    if (!st) continue;
    const px = st.x + st.radius + 60;
    const pz = st.z + 40;
    if (Math.abs(a.x - px) + Math.abs(a.z - pz) > 400 && a.order.kind !== 'garrison') order(sit, a, { kind: 'move', x: px, z: pz }, `home:${st.id}`, `returns to its station at ${st.name}`, tasked);
    else remember(sit, `op_${a.id}`, `home:${st.id}`);
  }
  // 6. Stance by the battle personality.
  const aggr = aggressionOf(sit);
  const stance: ArmyStance = aggr > 0.62 ? 'aggressive' : aggr < 0.38 ? 'cautious' : 'balanced';
  for (const a of sit.armies) if (a.stance !== stance && !a.engagementId) issue(sit, { kind: 'set_army_stance', armyId: a.id, stance });
}

/** How urgently a threatened settlement needs help: the capital and besieged towns first, then the deficit. */
function urgency(sit: Situation, t: Situation['threats'][number]): number {
  return (t.besieged ? 1e6 : 0) + (sit.capital?.id === t.s.id ? 5e5 : 0) + (t.threat - t.defense);
}

/**
 * Can the main army leave home? The capital must hold without it: its garrison (walls counted, +50% a fort level)
 * against 60% of the strongest enemy realm's field strength (realm strength minus its garrisons - public knowledge
 * like the war rule's), or a second army stays near it. Otherwise offensives stay within 1,500 m of the capital.
 */
function homeSafe(sit: Situation, main: ArmyState): boolean {
  const cap = sit.capital;
  if (!cap || sit.enemies.length === 0) return true;
  for (const a of sit.armies) if (a !== main && dist(a, cap) < 800 && armyStrength(a) > 0.3 * armyStrength(main)) return true;
  let enemyField = 0;
  for (const e of sit.enemies) enemyField = Math.max(enemyField, fieldStrength(sit, e));
  return garrisonStrength(cap) * (1 + 0.5 * cap.fortLevel) >= 0.6 * enemyField;
}

/** A realm's field strength: its total strength minus its garrisons. */
export function fieldStrength(sit: Situation, fid: string): number {
  let field = sit.strength[fid] ?? 0;
  for (const id of sortedKeys(sit.world.settlements)) {
    const s = sit.world.settlements[id]!;
    if (s.ownerFactionId === fid) field -= garrisonStrength(s);
  }
  return Math.max(0, field);
}

/** Hunt a weaker seen army, else besiege the best target (near home only while the capital needs the army). */
function offensive(sit: Situation, a: ArmyState, seen: readonly Contact[], ratio: number, safe: boolean, tasked: Set<string>): void {
  const { world } = sit;
  const own = armyStrength(a);
  // First: retake the realm's own lost towns the host outmatches (CD-B1 c).
  const back = retakeTarget(sit, a, seen, ratio);
  if (back) {
    order(sit, a, { kind: 'besiege', settlementId: back.t.id }, `siege:${back.t.id}`, `marches to retake ${back.t.name} (${Math.round(own)} against ~${Math.round(back.def)} defenders)`, tasked);
    if (a.forcedMarch) issue(sit, { kind: 'forced_march', armyId: a.id, on: false });
    forget(sit, 'noTarget');
    return;
  }
  // Field battle with a weaker host in reach.
  let prey: Contact | null = null;
  let pd = Infinity;
  for (const c of seen) {
    if (!c.army || c.army.status === 'garrisoned' || c.army.engagementId) continue;
    if (own < c.strength * ratio || recently(sit, `nochase_${c.id}`, 20)) continue;
    const d = dist(a, c);
    if (!safe && sit.capital && dist(sit.capital, c) > 2000) continue;
    if (nearestOwn(sit, c) > 3000) continue;
    if (d < 2500 && d < pd) {
      pd = d;
      prey = c;
    }
  }
  if (prey && prey.army) {
    forget(sit, 'noTarget');
    order(sit, a, { kind: 'attack_army', targetArmyId: prey.army.id }, `hunt:${prey.army.id}`, `attacks ${prey.army.name} (${Math.round(own)} vs ${Math.round(prey.strength)})`, tasked);
    return;
  }
  // Siege.
  const flood = world.weather.flood > 0.5;
  const w = sit.personality.weights;
  const tools = hasSiegeTools(a);
  // Little appetite for land (defensive, mercantile): only overwhelming odds, close to home.
  const timid = w.expand < 0.6;
  const reach = timid ? 2500 : 4500;
  const cap = sit.capital;
  const need = timid ? ratio + 0.4 : ratio;
  let contested = false;
  for (const e of sit.enemies) if (fieldStrength(sit, e) >= 0.4 * own) contested = true;
  // No siege in a realm whose field armies (wherever they are) outmatch this host: the strength of a realm is public
  // (the war rule uses it), the positions of its armies are not.
  const fieldOk = new Map<string, boolean>();
  const outmatched = (owner: string): boolean => {
    let ok = fieldOk.get(owner);
    if (ok === undefined) {
      ok = own >= fieldStrength(sit, owner) * (1 - 0.4 * aggressionOf(sit));
      fieldOk.set(owner, ok);
    }
    return !ok;
  };
  let best: SettlementState | null = null;
  let bestScore = 0;
  let bestDef = 0;
  for (const id of sortedKeys(world.settlements)) {
    const t = world.settlements[id]!;
    if (t.pendingCapture || !settlementHostile(world, sit.fid, t)) continue;
    if (t.ownerFactionId === null && w.expand < 0.6) continue;
    if (t.ownerFactionId !== null && (!sit.enemies.includes(t.ownerFactionId) || outmatched(t.ownerFactionId))) continue;
    const d = dist(a, t);
    if (d > reach || (flood && d > 1500)) continue;
    if (!safe && cap && dist(cap, t) > 1500) continue;
    // At war with a realm that still has a host in the field, the main army fights near home: no deep strikes or
    // distant free towns while its own towns lie open.
    if (contested && cap && dist(cap, t) > 3000 && nearestOwn(sit, t) > 1500) continue;
    if (t.fortLevel >= 1 && !tools) continue;
    const def = defenseOf(sit, t, seen);
    // A realm's capital is taken only with overwhelming force (its fall decides a war; its defenders fight to the end).
    const capital = isCapital(sit, t);
    // A fortified capital is the conqueror's business: only an expansionist lays siege to one.
    if (capital && t.fortLevel >= 2 && w.expand < 1.5) continue;
    if (own < Math.max(1, def) * need * (capital ? 1.6 : 1)) continue;
    const kind = t.kind === 'capital' ? 3 : t.kind === 'city' ? 2 : t.kind === 'fort' ? 1.5 : t.kind === 'village' ? 0.6 : 1;
    const value = (t.population / 3000 + kind) * w.expand * (t.ownerFactionId === null && sit.enemies.length > 0 ? 0.6 : 1);
    const score = value / (1 + d / 1500) / (1 + t.fortLevel * 0.3);
    if (score > bestScore) {
      bestScore = score;
      best = t;
      bestDef = def;
    }
  }
  if (best) {
    order(sit, a, { kind: 'besiege', settlementId: best.id }, `siege:${best.id}`, `marches to besiege ${best.name} (${Math.round(own)} against ~${Math.round(bestDef)} defenders${best.ownerFactionId ? '' : ', a free town'})`, tasked);
    if (a.forcedMarch) issue(sit, { kind: 'forced_march', armyId: a.id, on: false });
    forget(sit, 'noTarget');
    return;
  }
  // Nothing the host can take (too strong, walled without siege tools, out of reach): recorded for the stall audit and
  // the quiet-war peace (diplomacy.ts).
  remember(sit, 'noTarget', sit.day);
}

/** Siege camp: assault when breached and strong enough, feed the camp, give up a hopeless siege. */
function siegeWork(sit: Situation, a: ArmyState, sid: string, seen: readonly Contact[], tasked: Set<string>): void {
  const { world } = sit;
  tasked.add(a.id);
  const t = world.settlements[sid];
  if (!t) return;
  remember(sit, `op_${a.id}`, `siege:${sid}`);
  const own = armyStrength(a);
  const def = defenseOf(sit, t, seen);
  const st = assaultState(world, t);
  // Storm through a breach at 1.3x the defenders; over ladders alone (the escalade penalty) at 2x; a capital only
  // through a breach, at 2.5x.
  const capital = isCapital(sit, t);
  const storm = st.breach ? (capital ? 2.5 : 1.3) : st.ladders && !capital ? 2 : Infinity;
  if (st.available && own >= storm * Math.max(1, def)) {
    order(sit, a, { kind: 'assault', settlementId: sid }, `assault:${sid}`, `storms ${t.name} (${st.breach ? 'the walls are breached' : 'the ladders are ready'}; ${Math.round(own)} vs ~${Math.round(def)})`, tasked);
    return;
  }
  const days = armySupplyDays(world, a);
  if (own < 0.8 * def || a.supply.starvationDays > 5) {
    const home = sit.capital ?? sit.owned[0];
    if (home) order(sit, a, { kind: 'retreat', x: home.x + home.radius + 60, z: home.z + 40 }, `home:${home.id}`, `lifts the siege of ${t.name} (${a.supply.starvationDays > 5 ? 'starving' : 'outmatched'})`, tasked);
    return;
  }
  if (days > 20) return;
  // Feed the camp: a depot behind it, grain requisitioned into it.
  let depot: string | null = null;
  for (const id of sortedKeys(world.depots)) {
    const d = world.depots[id]!;
    if (d.factionId === sit.fid && dist(d, a) < RULES.supply.resupplyRadius) depot = id;
  }
  if (!depot) {
    const len = Math.max(1, dist(a, t));
    const x = a.x + ((a.x - t.x) / len) * 150;
    const z = a.z + ((a.z - t.z) / len) * 150;
    if (sit.f.treasury > RULES.supply.depot.costWealth + 200 && !recently(sit, `depot_${a.id}`, 5) && !validateCreateDepot(world, sit.fid, x, z)) {
      remember(sit, `depot_${a.id}`, sit.day);
      issue(sit, { kind: 'create_depot', x, z, settlementId: null });
      note(sit, 'army', `${a.name}: builds a supply depot behind the siege camp at ${t.name}`);
    }
    return;
  }
  const d = world.depots[depot]!;
  if (d.food > 1500) return;
  let src: SettlementState | null = null;
  let bd = Infinity;
  for (const s of sit.owned) {
    if (s.besiegedBy || s.foodConsumption <= 0 || s.foodStored < 75 * s.foodConsumption) continue;
    const dd = dist(s, a);
    if (dd < bd) {
      bd = dd;
      src = s;
    }
  }
  if (!src) return;
  const amount = Math.floor(Math.min(d.capacity - d.food, 0.5 * src.foodStored, src.foodStored - 60 * src.foodConsumption));
  if (amount < 300) return;
  issue(sit, { kind: 'requisition_grain', settlementId: src.id, amount, toArmyId: null, toDepotId: depot });
  note(sit, 'army', `${a.name}: ${amount} grain requisitioned from ${src.name} for the siege depot`);
}

/** Distance from a point to the realm's nearest settlement (m). */
function nearestOwn(sit: Situation, p: { x: number; z: number }): number {
  let best = Infinity;
  for (const s of sit.owned) best = Math.min(best, dist(s, p));
  return best;
}

/** Is `t` the capital of its owner? */
function isCapital(sit: Situation, t: SettlementState): boolean {
  if (t.kind === 'capital') return true;
  const owner = t.ownerFactionId ? sit.world.factions[t.ownerFactionId] : null;
  return owner?.capitalSettlementId === t.id;
}

/** Raid a weakly held enemy settlement in reach. */
function raid(sit: Situation, a: ArmyState, seen: readonly Contact[], tasked: Set<string>): void {
  const { world } = sit;
  const own = armyStrength(a);
  let best: SettlementState | null = null;
  let bs = 0;
  for (const id of sortedKeys(world.settlements)) {
    const t = world.settlements[id]!;
    if (!t.ownerFactionId || !sit.enemies.includes(t.ownerFactionId)) continue;
    const d = dist(a, t);
    if (d > 3000) continue;
    if (defenseOf(sit, t, seen) * 2 > own) continue;
    const score = (t.wealth / 500 + t.foodStored / 20000 + 0.5) / (1 + d / 1500);
    if (score > bs) {
      bs = score;
      best = t;
    }
  }
  if (best) order(sit, a, { kind: 'raid', settlementId: best.id }, `raid:${best.id}`, `rides to raid ${best.name}`, tasked);
}

/** Drop plan memory of armies that no longer exist. */
function cleanMemory(sit: Situation): void {
  for (const k of Object.keys(sit.f.ai.memory).sort()) {
    if (!k.startsWith('op_') && !k.startsWith('opd_') && !k.startsWith('depot_') && !k.startsWith('nochase_') && !k.startsWith('rsp_') && !k.startsWith('rst_') && !k.startsWith('dfs_') && !k.startsWith('nodefend_')) continue;
    const id = k.slice(k.indexOf('_') + 1);
    if (!sit.world.armies[id]) forget(sit, k);
  }
}

/** Has the realm held `t` (at the start, or since - plan memory `held_<id>`)? */
function heldBefore(sit: Situation, t: SettlementState): boolean {
  return t.initialOwnerFactionId === sit.fid || sit.f.ai.memory[`held_${t.id}`] === true;
}

/** Remember the towns the realm has held 90+ days (strategy runs), so a lost one is known as its own. */
export function markHeld(sit: Situation): void {
  // A conquest becomes "ours" after 90 days (two realms do not both chase the same town as their own).
  for (const s of sit.owned) if (sit.f.ai.memory[`held_${s.id}`] !== true && s.initialOwnerFactionId !== sit.fid && sit.day - s.ownerSinceDay >= 90) remember(sit, `held_${s.id}`, true);
}

/**
 * The realm's own lost town the host should retake first (CD-B1 c): held by an enemy at war (or rebels), within
 * 4,500 m, not being captured, walls only with siege tools, and the host outmatches its defenders (ratio). Nearest
 * first, the capital's region first.
 */
function retakeTarget(sit: Situation, a: ArmyState, seen: readonly Contact[], ratio: number): { t: SettlementState; def: number } | null {
  const { world } = sit;
  const own = armyStrength(a);
  const tools = hasSiegeTools(a);
  let best: SettlementState | null = null;
  let bestDef = 0;
  let bd = Infinity;
  for (const id of sortedKeys(world.settlements)) {
    const t = world.settlements[id]!;
    if (t.ownerFactionId === sit.fid || t.pendingCapture || !heldBefore(sit, t) || !settlementHostile(world, sit.fid, t)) continue;
    if (t.ownerFactionId !== null && !sit.enemies.includes(t.ownerFactionId)) continue;
    if (t.fortLevel >= 1 && !tools) continue;
    const d = dist(a, t);
    if (d > 4500) continue;
    const def = defenseOf(sit, t, seen);
    if (own < Math.max(1, def) * ratio) continue;
    if (d < bd) {
      bd = d;
      best = t;
      bestDef = def;
    }
  }
  return best ? { t: best, def: bestDef } : null;
}

/** Spare grain of an own settlement over its 30-day floor. */
function spareGrain(s: SettlementState): number {
  return Math.max(0, s.foodStored) - RULES.storage.keepDays * Math.max(0, s.foodConsumption);
}

/**
 * Where an army should resupply (CD-B1 a): the nearest own settlement (not besieged, within 4,000 m) with grain to spare
 * over its 30-day floor - 10 days of the army's need at least - other than `not`; else the nearest own settlement, which
 * the royal reserve then tops up (send_relief) when it has grain.
 */
function resupplySource(sit: Situation, a: ArmyState, not: string | null): SettlementState | null {
  const need = Math.max(1, armyFoodNeed(sit.world, a));
  let best: SettlementState | null = null;
  let bd = Infinity;
  let near: SettlementState | null = null;
  let nd = Infinity;
  for (const s of sit.owned) {
    if (s.besiegedBy || s.id === not) continue;
    const d = dist(a, s);
    if (d > 4000) continue;
    if (d < nd) {
      nd = d;
      near = s;
    }
    if (spareGrain(s) >= Math.max(500, 10 * need) && d < bd) {
      bd = d;
      best = s;
    }
  }
  if (best) return best;
  if (near && sit.f.foodReserve > 0) relieveFor(sit, a, near);
  return near;
}

/** Top up `s` from the royal reserve so it can feed the army: 20 days of its need over the floor. */
function relieveFor(sit: Situation, a: ArmyState, s: SettlementState): void {
  if (recently(sit, `hostRelief_${s.id}`, 3)) return;
  const need = Math.max(1, armyFoodNeed(sit.world, a));
  const want = Math.ceil(20 * need - spareGrain(s));
  const food = Math.min(Math.floor(sit.f.foodReserve * 0.5), Math.max(0, want));
  if (food < 100) return;
  remember(sit, `hostRelief_${s.id}`, sit.day);
  issue(sit, { kind: 'send_relief', settlementId: s.id, food, wealth: 0 });
  note(sit, 'army', `${a.name}: ${food} grain sent from the royal reserve to ${s.name} to feed the host`);
}

/**
 * An army on a resupply order (CD-B1 a): done at 60% of its train; with no gain in 3 days it is sent to another source
 * with grain to spare (or its town is relieved from the reserve); after two fruitless tries it lives off its train and
 * forage and goes back to its operations. Memory `rsp_<id>` "day,food" (the last gain), `rst_<id>` (tries).
 */
function resupplying(sit: Situation, a: ArmyState, share: number, tasked: Set<string>): void {
  const key = `rsp_${a.id}`;
  const done = (why: string): void => {
    forget(sit, key);
    forget(sit, `rst_${a.id}`);
    if (str(sit, `op_${a.id}`, '') === 'resupply') {
      forget(sit, `op_${a.id}`);
      note(sit, 'army', `${a.name}: ${why}`);
    }
    issue(sit, { kind: 'army_order', armyId: a.id, order: { kind: 'idle' } });
  };
  if (share >= RESUPPLY_DONE) {
    done(`resupplied (${Math.round(100 * share)}% of its train)`);
    return;
  }
  const mark = str(sit, key, '');
  const [d0, f0] = mark ? mark.split(',').map(Number) : [sit.day, a.supply.food];
  if (!mark || a.supply.food > (f0 ?? 0) + 1) {
    remember(sit, key, `${sit.day},${Math.round(a.supply.food)}`);
    tasked.add(a.id);
    return;
  }
  if (sit.day - (d0 ?? sit.day) < 3) {
    tasked.add(a.id);
    return;
  }
  const tries = num(sit, `rst_${a.id}`, 0);
  if (tries >= 2) {
    done(`gives up resupplying (${Math.round(100 * share)}% of its train; no grain to spare within reach)`);
    return;
  }
  remember(sit, `rst_${a.id}`, tries + 1);
  remember(sit, key, `${sit.day},${Math.round(a.supply.food)}`);
  const cur = a.order.kind === 'resupply' ? a.order.sourceId : null;
  const src = resupplySource(sit, a, cur);
  tasked.add(a.id);
  if (src && src.id !== cur) {
    issue(sit, { kind: 'army_order', armyId: a.id, order: { kind: 'resupply', sourceId: src.id } });
    note(sit, 'army', `${a.name}: no grain gained in 3 days - resupplies at ${src.name} instead`);
  }
}
