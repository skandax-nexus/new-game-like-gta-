/**
 * Every StrategicCommand: side-effect-free validation with player-facing refusal reasons, and execution
 * (DESIGN_SPEC §7, §8; GameActions in src/app/session.ts and the campaign AI issue the same commands).
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 * `validateCommand(world, issued)` returns null when `executeCommand` would accept the command, else the reason the
 * UI shows (the same strings the executing modules use). world.ts `validateStrategicCommand` /
 * `applyStrategicCommand` delegate here; refusals notify the player.
 */
import type { ArmyOrder, ArmyState, IssuedStrategicCommand, LaborAllocation, SimEvent, StrategicCommand, TerrainQuery, WorldState } from '../../core/types';
import { BALANCE } from '../../data/balance';
import { RULES } from '../../data/rules';
import { getEventDef } from '../../data/events';
import { ARMY_REASONS, disbandArmy, mergeArmies, orderArmy, splitArmy, validateMerge, validateSplit } from './armies';
import { cancelConstruction, queueBuild, queueRepair, startLandmark, validateBuild, validateCancel, validateLandmark, validateRepair } from './construction';
import { appointCouncil, validateAppointCouncil } from './council';
import { arrangeMarriage, DIPLOMACY_REASONS, propose, respondToProposal, validateMarriage, validateProposal, validateResponse } from './diplomacy';
import { designateHeir, validateDesignateHeir } from './dynasty';
import { recallAgent, startMission, validateSpyMission, ESPIONAGE_REASONS } from './espionage';
import { evalCondition, resolveEventChoice } from './events';
import { decideEngagement } from './autoresolve';
import { executeMarketTrade, quoteMarketTrade } from './market';
import { appointGovernor, negotiateRebels, validateAppointGovernor, validateNegotiation } from './politics';
import { queueRecruit, validateRecruit } from './recruitment';
import { decideCapture, settlementHostile, SIEGE_REASONS, assaultState, validateCaptureDecision } from './siege';
import { createDepot, requisitionGrain, sendRelief, transferSupply, validateCreateDepot, validateRequisition, validateSendRelief, validateTransfer } from './supply';
import { totalDays } from './seasons';
import { addMonthToDate, hostileToArmy, notifyPlayer, regionTerrain } from './state';
import { decidePrisoners, validatePrisoners } from './writeback';

export const COMMAND_REASONS = {
  faction: 'Unknown or defeated faction',
  noArmy: ARMY_REASONS.noArmy,
  notYourArmy: ARMY_REASONS.notYours,
  inBattle: ARMY_REASONS.inBattle,
  outside: 'That is outside the map',
  noSettlement: 'No such settlement',
  notYourSettlement: 'Not your settlement',
  noTarget: 'No such army',
  notHostile: 'They are not your enemy',
  ownSettlement: SIEGE_REASONS.own,
  notYourDepot: 'Not your depot',
  notBesieging: SIEGE_REASONS.notBesieging,
  noBreach: SIEGE_REASONS.noBreach,
  patrol: 'A patrol needs at least two points',
  badStance: 'Unknown stance',
  taxRange: 'The tax rate must be between 0% and 60%',
  badPolicy: 'Unknown policy',
  labor: 'Labor shares must be between 0 and 1 and add up to 100%',
  noEdge: 'No such road',
  roadNotYours: 'Neither end of that road is yours',
  roadFine: 'The road is in good repair',
  roadHeld: 'An enemy army holds that road',
  noWealth: (n: number) => `Need ${Math.ceil(n)} wealth`,
  noEvent: 'No such decision is waiting',
  notYourEvent: 'That decision is not yours to take',
  noChoice: 'No such option',
  requirements: 'The requirements of that option are not met',
  noEngagement: 'No such engagement',
  engagementOver: 'That battle is over',
  notYourEngagement: 'None of your armies is in that battle',
  rallyFar: 'The rally point must be within 1,500 m of the settlement',
  rallyArmy: 'That army is not yours',
  agentNotYours: ESPIONAGE_REASONS.notYourAgent,
} as const;

const TAX_POLICIES = ['lenient', 'standard', 'heavy', 'emergency'] as const;
const STANCES = ['aggressive', 'balanced', 'cautious'] as const;
/** Wealth per real km of road per unit of missing condition (repair_road restores the road to full). */
export const ROAD_REPAIR_WEALTH_PER_KM = 20;

function armyOf(world: WorldState, fid: string, armyId: string, allowBattle = false): { army: ArmyState | null; reason: string | null } {
  const a = world.armies[armyId];
  if (!a) return { army: null, reason: COMMAND_REASONS.noArmy };
  if (a.factionId !== fid) return { army: null, reason: COMMAND_REASONS.notYourArmy };
  if (!allowBattle && (a.status === 'in_battle' || a.engagementId)) return { army: null, reason: COMMAND_REASONS.inBattle };
  return { army: a, reason: null };
}

function inMap(world: WorldState, x: number, z: number): boolean {
  return regionTerrain(world).inBounds(x, z);
}

/** Can this army take this order? */
export function validateOrder(world: WorldState, fid: string, army: ArmyState, order: ArmyOrder): string | null {
  switch (order.kind) {
    case 'idle':
    case 'forage':
      return null;
    case 'move':
    case 'retreat':
      return Number.isFinite(order.x) && Number.isFinite(order.z) && inMap(world, order.x, order.z) ? null : COMMAND_REASONS.outside;
    case 'attack_army': {
      const t = world.armies[order.targetArmyId];
      if (!t) return COMMAND_REASONS.noTarget;
      return hostileToArmy(world, fid, t) ? null : COMMAND_REASONS.notHostile;
    }
    case 'besiege':
    case 'raid': {
      const s = world.settlements[order.settlementId];
      if (!s) return COMMAND_REASONS.noSettlement;
      if (s.ownerFactionId === fid) return COMMAND_REASONS.ownSettlement;
      return settlementHostile(world, fid, s) ? null : SIEGE_REASONS.notHostile;
    }
    case 'assault': {
      const s = world.settlements[order.settlementId];
      if (!s) return COMMAND_REASONS.noSettlement;
      if (s.ownerFactionId === fid) return COMMAND_REASONS.ownSettlement;
      if (!settlementHostile(world, fid, s)) return SIEGE_REASONS.notHostile;
      if (s.fortLevel >= 1 && army.status === 'besieging' && !assaultState(world, s).available) return COMMAND_REASONS.noBreach;
      return null;
    }
    case 'garrison': {
      const s = world.settlements[order.settlementId];
      if (!s) return COMMAND_REASONS.noSettlement;
      return s.ownerFactionId === fid ? null : COMMAND_REASONS.notYourSettlement;
    }
    case 'escort': {
      const d = world.depots[order.depotId];
      return d && d.factionId === fid ? null : COMMAND_REASONS.notYourDepot;
    }
    case 'patrol':
      if (order.points.length < 2) return COMMAND_REASONS.patrol;
      return order.points.every((p) => inMap(world, p.x, p.z)) ? null : COMMAND_REASONS.outside;
    case 'resupply': {
      if (order.sourceId === null) return null;
      const s = world.settlements[order.sourceId];
      if (s) return s.ownerFactionId === fid ? null : COMMAND_REASONS.notYourSettlement;
      const d = world.depots[order.sourceId];
      return d && d.factionId === fid ? null : COMMAND_REASONS.notYourDepot;
    }
    default:
      return null;
  }
}

function validLabor(a: LaborAllocation): boolean {
  const vals = [a.farming, a.construction, a.crafts, a.military];
  if (vals.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) return false;
  const sum = vals.reduce((t, v) => t + v, 0);
  return Math.abs(sum - 1) <= 0.011;
}

/** Wealth to restore a road edge to full condition. */
export function roadRepairCost(world: WorldState, edgeId: string): number {
  const e = world.roads.edges[edgeId];
  if (!e) return 0;
  const km = (e.length * BALANCE.military.travelScale) / 1000;
  return Math.ceil(ROAD_REPAIR_WEALTH_PER_KM * km * Math.max(0, 1 - e.condition));
}

export function validateRepairRoad(world: WorldState, fid: string, edgeId: string): string | null {
  const e = world.roads.edges[edgeId];
  if (!e) return COMMAND_REASONS.noEdge;
  const sa = world.roads.nodes[e.a]?.settlementId;
  const sb = world.roads.nodes[e.b]?.settlementId;
  if (world.settlements[sa ?? '']?.ownerFactionId !== fid && world.settlements[sb ?? '']?.ownerFactionId !== fid) return COMMAND_REASONS.roadNotYours;
  if (e.condition >= 0.999) return COMMAND_REASONS.roadFine;
  if (e.blockedBy && world.armies[e.blockedBy] && hostileToArmy(world, fid, world.armies[e.blockedBy]!)) return COMMAND_REASONS.roadHeld;
  const cost = roadRepairCost(world, edgeId);
  if ((world.factions[fid]?.treasury ?? 0) < cost) return COMMAND_REASONS.noWealth(cost);
  return null;
}

function validateEventChoice(world: WorldState, fid: string, instanceId: string, choiceId: string): string | null {
  const inst = world.events.pending.find((p) => p.id === instanceId);
  if (!inst) return COMMAND_REASONS.noEvent;
  if (inst.scope.factionId !== fid) return COMMAND_REASONS.notYourEvent;
  const def = getEventDef(inst.defId);
  const choice = def?.choices.find((c) => c.id === choiceId);
  if (!def || !choice) return COMMAND_REASONS.noChoice;
  if (choice.requires && !evalCondition(world, choice.requires, inst.scope)) return COMMAND_REASONS.requirements;
  return null;
}

function validateEngagement(world: WorldState, fid: string, engagementId: string): string | null {
  const e = world.engagements[engagementId];
  if (!e) return COMMAND_REASONS.noEngagement;
  if (e.status === 'resolved') return COMMAND_REASONS.engagementOver;
  const mine = [...e.sides[0], ...e.sides[1]].some((id) => world.armies[id]?.factionId === fid);
  return mine ? null : COMMAND_REASONS.notYourEngagement;
}

function ownedSettlement(world: WorldState, fid: string, sid: string): string | null {
  const s = world.settlements[sid];
  if (!s) return COMMAND_REASONS.noSettlement;
  return s.ownerFactionId === fid ? null : COMMAND_REASONS.notYourSettlement;
}

/** Why `issued` would be refused (null = it would be accepted). Pure. */
export function validateCommand(world: WorldState, issued: IssuedStrategicCommand): string | null {
  const fid = issued.factionId;
  const f = world.factions[fid];
  if (!f || !f.alive) return COMMAND_REASONS.faction;
  const c: StrategicCommand = issued.cmd;
  switch (c.kind) {
    case 'move_army': {
      const r = armyOf(world, fid, c.armyId);
      return r.reason ?? validateOrder(world, fid, r.army!, { kind: 'move', x: c.x, z: c.z });
    }
    case 'army_order': {
      const r = armyOf(world, fid, c.armyId);
      return r.reason ?? validateOrder(world, fid, r.army!, c.order);
    }
    case 'set_army_stance': {
      const r = armyOf(world, fid, c.armyId, true);
      return r.reason ?? ((STANCES as readonly string[]).includes(c.stance) ? null : COMMAND_REASONS.badStance);
    }
    case 'forced_march':
      return armyOf(world, fid, c.armyId).reason;
    case 'split_army':
      return validateSplit(world, fid, c.armyId, c.unitIds);
    case 'merge_armies':
      return validateMerge(world, fid, c.armyId, c.otherArmyId);
    case 'disband_army':
      return armyOf(world, fid, c.armyId).reason;
    case 'recruit':
      return validateRecruit(world, fid, c.settlementId, c.unitClass, c.formations, c.targetArmyId).reason;
    case 'build':
      return validateBuild(world, fid, c.settlementId, c.building, c.cell, c.rot ?? 0).reason;
    case 'cancel_construction':
      return validateCancel(world, fid, c.settlementId, c.building, c.jobIndex).reason;
    case 'repair_building':
      return validateRepair(world, fid, c.settlementId, c.building).reason;
    case 'start_landmark':
      return validateLandmark(world, fid, c.landmarkId, c.settlementId, c.cell, c.rot ?? 0).reason;
    case 'repair_road':
      return validateRepairRoad(world, fid, c.edgeId);
    case 'set_tax_rate':
      return ownedSettlement(world, fid, c.settlementId) ?? (Number.isFinite(c.rate) && c.rate >= 0 && c.rate <= 0.6 ? null : COMMAND_REASONS.taxRange);
    case 'set_tax_policy':
      return (TAX_POLICIES as readonly string[]).includes(c.policy) ? null : COMMAND_REASONS.badPolicy;
    case 'set_labor':
      return ownedSettlement(world, fid, c.settlementId) ?? (validLabor(c.allocation) ? null : COMMAND_REASONS.labor);
    case 'set_policy':
      return c.policy === 'hold_reserve' || c.policy === 'rationing' ? null : COMMAND_REASONS.badPolicy;
    case 'set_rally_point': {
      const r = ownedSettlement(world, fid, c.settlementId);
      if (r || c.rallyPoint === null) return r;
      const s = world.settlements[c.settlementId]!;
      if (c.rallyPoint.kind === 'army') return world.armies[c.rallyPoint.armyId]?.factionId === fid ? null : COMMAND_REASONS.rallyArmy;
      const d2 = (c.rallyPoint.x - s.x) * (c.rallyPoint.x - s.x) + (c.rallyPoint.z - s.z) * (c.rallyPoint.z - s.z);
      return d2 <= 1500 * 1500 ? null : COMMAND_REASONS.rallyFar;
    }
    case 'requisition_grain':
      return validateRequisition(world, fid, c.settlementId, c.amount, c.toArmyId, c.toDepotId);
    case 'send_relief':
      return validateSendRelief(world, fid, c.settlementId, c.food, c.wealth);
    case 'create_depot':
      return validateCreateDepot(world, fid, c.x, c.z);
    case 'transfer_supply':
      return validateTransfer(world, fid, c.fromId, c.toId, c.amount);
    case 'market_trade':
      return quoteMarketTrade(world, fid, c.resource, c.lots, c.buy).reason;
    case 'appoint_governor':
      return validateAppointGovernor(world, fid, c.provinceId, c.characterId);
    case 'appoint_council':
      return validateAppointCouncil(world, fid, c.seat, c.characterId);
    case 'designate_heir':
      return validateDesignateHeir(world, fid, c.characterId);
    case 'arrange_marriage': {
      const r = validateMarriage(world, c.characterId, c.otherCharacterId);
      if (r) return r;
      const a = world.characters[c.characterId]!;
      const b = world.characters[c.otherCharacterId]!;
      if (a.factionId !== fid && b.factionId !== fid) return DIPLOMACY_REASONS.notYours;
      if (a.factionId === b.factionId) return null;
      return validateProposal(world, fid, a.factionId === fid ? b.factionId : a.factionId, 'marriage_alliance', { tributePerMonth: 0, payer: null, overlord: null, autonomy: 0, marriage: [a.id, b.id], durationDays: null });
    }
    case 'propose':
      return validateProposal(world, fid, c.to, c.type, c.terms);
    case 'respond_proposal':
      return validateResponse(world, fid, c.proposalId);
    case 'spy_mission': {
      const self = c.mission === 'counter_intelligence' || c.mission === 'protect_court';
      return validateSpyMission(world, fid, self ? fid : c.targetFactionId, c.mission, c.settlementId, c.agentCharacterId);
    }
    case 'recall_agent': {
      const a = world.espionage.agents[c.agentId];
      if (!a) return ESPIONAGE_REASONS.noAgent;
      if (a.ownerFactionId !== fid) return COMMAND_REASONS.agentNotYours;
      return a.status === 'active' ? null : ESPIONAGE_REASONS.notActive;
    }
    case 'event_choice':
      return validateEventChoice(world, fid, c.eventInstanceId, c.choiceId);
    case 'negotiate_rebels':
      return validateNegotiation(world, fid, c.settlementId, c.offer);
    case 'engagement_decision':
      return validateEngagement(world, fid, c.engagementId);
    case 'prisoners':
      return validatePrisoners(world, fid, c.engagementId);
    case 'capture_decision':
      return validateCaptureDecision(world, fid, c.settlementId, c.decision);
    default:
      return null;
  }
}

/** Report a refusal reason to the player. Returns true when `reason` is null. */
function report(world: WorldState, issued: IssuedStrategicCommand, out: SimEvent[], reason: string | null): boolean {
  if (reason && world.factions[issued.factionId]?.isPlayer) out.push({ kind: 'notification', factionId: issued.factionId, severity: 'warning', text: reason, focus: null });
  return reason === null;
}

/** Validate and execute one command. Returns true when accepted (refusals notify the player). */
export function executeCommand(world: WorldState, issued: IssuedStrategicCommand, out: SimEvent[], terrain: TerrainQuery): boolean {
  const reason = validateCommand(world, issued);
  if (reason) return report(world, issued, out, reason);
  issued.hour = world.calendar.totalHours;
  const fid = issued.factionId;
  const c = issued.cmd;
  switch (c.kind) {
    case 'move_army':
      return orderArmy(world, c.armyId, { kind: 'move', x: c.x, z: c.z }, terrain);
    case 'army_order':
      return orderArmy(world, c.armyId, c.order, terrain);
    case 'set_army_stance':
      world.armies[c.armyId]!.stance = c.stance;
      return true;
    case 'forced_march':
      world.armies[c.armyId]!.forcedMarch = c.on;
      return true;
    case 'split_army':
      return report(world, issued, out, splitArmy(world, fid, c.armyId, c.unitIds).reason);
    case 'merge_armies':
      return report(world, issued, out, mergeArmies(world, fid, c.armyId, c.otherArmyId));
    case 'disband_army':
      return report(world, issued, out, disbandArmy(world, fid, c.armyId, out));
    case 'recruit':
      return report(world, issued, out, queueRecruit(world, fid, c.settlementId, c.unitClass, c.formations, c.targetArmyId).reason);
    case 'build':
      return report(world, issued, out, queueBuild(world, fid, c.settlementId, c.building, c.cell, c.rot, out).reason);
    case 'cancel_construction':
      return report(world, issued, out, cancelConstruction(world, fid, c.settlementId, c.building, c.jobIndex, out).reason);
    case 'repair_building':
      return report(world, issued, out, queueRepair(world, fid, c.settlementId, c.building, out).reason);
    case 'start_landmark':
      return report(world, issued, out, startLandmark(world, fid, c.landmarkId, c.settlementId, c.cell, c.rot, out).reason);
    case 'repair_road': {
      const cost = roadRepairCost(world, c.edgeId);
      const f = world.factions[fid]!;
      f.treasury -= cost;
      addMonthToDate(world, fid, 'other_cost', cost);
      world.roads.edges[c.edgeId]!.condition = 1;
      notifyPlayer(world, out, fid, 'info', `The road was repaired for ${cost} wealth.`);
      return true;
    }
    case 'set_tax_rate':
      world.settlements[c.settlementId]!.taxRate = c.rate;
      return true;
    case 'set_tax_policy':
      world.factions[fid]!.taxPolicy = c.policy;
      return true;
    case 'set_labor':
      world.settlements[c.settlementId]!.laborAllocation = { ...c.allocation };
      return true;
    case 'set_policy': {
      const f = world.factions[fid]!;
      if (c.policy === 'hold_reserve') f.policies.holdReserve = c.on;
      else f.policies.rationingUntilDay = c.on ? totalDays(world.calendar) + RULES.distribution.rationing.days : null;
      return true;
    }
    case 'set_rally_point': {
      const s = world.settlements[c.settlementId]!;
      if (c.rallyPoint === null) delete s.rallyPoint;
      else if (c.rallyPoint.kind === 'army') s.rallyPoint = { kind: 'army', armyId: c.rallyPoint.armyId };
      else s.rallyPoint = { kind: 'point', x: c.rallyPoint.x, z: c.rallyPoint.z };
      return true;
    }
    case 'requisition_grain':
      return report(world, issued, out, requisitionGrain(world, fid, c.settlementId, c.amount, c.toArmyId, c.toDepotId, out));
    case 'send_relief':
      return report(world, issued, out, sendRelief(world, fid, c.settlementId, c.food, c.wealth, out));
    case 'create_depot':
      return report(world, issued, out, createDepot(world, fid, c.x, c.z, c.settlementId, out).reason);
    case 'transfer_supply':
      return report(world, issued, out, transferSupply(world, fid, c.fromId, c.toId, c.amount));
    case 'market_trade':
      return report(world, issued, out, executeMarketTrade(world, fid, c.resource, c.lots, c.buy, out).reason);
    case 'appoint_governor':
      return report(world, issued, out, appointGovernor(world, fid, c.provinceId, c.characterId, out));
    case 'appoint_council':
      return report(world, issued, out, appointCouncil(world, fid, c.seat, c.characterId));
    case 'designate_heir':
      return report(world, issued, out, designateHeir(world, fid, c.characterId));
    case 'arrange_marriage':
      return report(world, issued, out, arrangeMarriage(world, fid, c.characterId, c.otherCharacterId, out));
    case 'propose':
      return report(world, issued, out, propose(world, fid, c.to, c.type, c.terms, out).reason);
    case 'respond_proposal':
      respondToProposal(world, c.proposalId, c.accept, out);
      return true;
    case 'spy_mission':
      return report(world, issued, out, startMission(world, fid, c.targetFactionId, c.mission, c.settlementId, c.agentCharacterId).reason);
    case 'recall_agent':
      return report(world, issued, out, recallAgent(world, fid, c.agentId));
    case 'event_choice':
      return resolveEventChoice(world, c.eventInstanceId, c.choiceId, out);
    case 'negotiate_rebels':
      return report(world, issued, out, negotiateRebels(world, fid, c.settlementId, c.offer, out));
    case 'engagement_decision':
      return decideEngagement(world, c.engagementId, c.decision, out, terrain);
    case 'prisoners':
      return report(world, issued, out, decidePrisoners(world, fid, c.engagementId, c.decision, out));
    case 'capture_decision':
      return report(world, issued, out, decideCapture(world, fid, c.settlementId, c.decision, out));
    default:
      return false;
  }
}
