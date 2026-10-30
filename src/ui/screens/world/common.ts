/**
 * Shared helpers for the world screens: notification feed entries from sim events (DESIGN_SPEC §12.6), event-choice
 * requirement text, relation labels, settlement / army focus points. OWNER: UI Engineer - In-game HUD, Command Card,
 * Minimap & Input (UI-02). Pure except `sfx`.
 */
import type { AppContext } from '../../../app/contracts';
import type { Condition, FactionId, SimEvent, WorldState } from '../../../core/types';
import type { SfxKind, WorldAlertSeverity } from '../../../core/events';
import { FACTIONS } from '../../../data/factions';
import { BUILDINGS } from '../../../data/buildings';
import { UNITS } from '../../../data/units';
import { LANDMARKS, AGES } from '../../../data/ages';
import { SEASON_NAMES } from '../../../sim/strategic/seasons';
import { fmtInt, label } from '../../dom';

export function sfx(ctx: AppContext, s: SfxKind = 'ui_click'): void {
  ctx.bus.emit('audio:sfx', { sfx: s });
}

export function factionName(id: FactionId | null): string {
  if (!id) return 'Independent';
  if (id === 'rebels') return 'Rebels';
  return FACTIONS[id]?.name ?? id;
}

export function factionShort(id: FactionId | null): string {
  if (!id) return 'Independent';
  if (id === 'rebels') return 'Rebels';
  return FACTIONS[id]?.shortName ?? id;
}

export type FeedSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface FeedEntry {
  key: string;
  text: string;
  severity: FeedSeverity;
  icon: string;
  focus: { x: number; z: number } | null;
  select: { kind: 'army' | 'settlement'; id: string } | null;
  /** Minimap ping (DESIGN_SPEC §8.7 colours). */
  ping: WorldAlertSeverity | null;
}

let feedSeq = 0;

/** Player-relevant feed entry for a sim event (null = not shown). */
export function feedEntry(e: SimEvent, w: Readonly<WorldState>): FeedEntry | null {
  const me = w.playerFactionId;
  const st = (id: string) => w.settlements[id];
  const mk = (text: string, severity: FeedSeverity, icon: string, focus: { x: number; z: number } | null, select: FeedEntry['select'], ping: WorldAlertSeverity | null = null): FeedEntry => ({ key: `f${++feedSeq}`, text, severity, icon, focus, select, ping });
  const mine = (sid: string): boolean => st(sid)?.ownerFactionId === me;
  switch (e.kind) {
    case 'harvest': {
      const s = st(e.settlementId);
      return s && mine(e.settlementId) ? mk(`Harvest at ${s.name}: ${fmtInt(e.amount)} grain`, 'success', 'sheaf', s, { kind: 'settlement', id: s.id }) : null;
    }
    case 'shortage': {
      const s = st(e.settlementId);
      return s && mine(e.settlementId) ? mk(`Food shortage in ${s.name}`, 'warning', 'sheaf', s, { kind: 'settlement', id: s.id }, 'warning') : null;
    }
    case 'disaster': {
      const s = st(e.settlementId);
      return s && mine(e.settlementId) ? mk(`${label(e.disaster)} strikes ${s.name}`, 'danger', 'alert', s, { kind: 'settlement', id: s.id }, 'danger') : null;
    }
    case 'construction_complete': {
      const s = st(e.settlementId);
      return s && mine(e.settlementId) ? mk(`${BUILDINGS[e.building].name}${e.level > 1 ? ` (level ${e.level})` : ''} complete at ${s.name}`, 'success', `b_${e.building}`, s, { kind: 'settlement', id: s.id }, 'success') : null;
    }
    case 'construction_started': {
      const s = st(e.settlementId);
      if (!s || !mine(e.settlementId)) return null;
      const name = e.landmarkId ? (LANDMARKS.find((l) => l.id === e.landmarkId)?.name ?? 'Landmark') : BUILDINGS[e.building].name;
      return mk(`Builders begin the ${name} at ${s.name}`, 'info', e.landmarkId ? 'b_landmark' : `b_${e.building}`, s, { kind: 'settlement', id: s.id });
    }
    case 'recruitment_complete': {
      const s = st(e.settlementId);
      return s && mine(e.settlementId) ? mk(`${UNITS[e.unitClass].name} raised at ${s.name}`, 'success', `unit-${e.unitClass.replace(/_/g, '-')}`, s, e.armyId ? { kind: 'army', id: e.armyId } : { kind: 'settlement', id: s.id }) : null;
    }
    case 'army_arrived': {
      const a = w.armies[e.armyId];
      return a && a.factionId === me ? mk(`${a.name} has arrived`, 'info', 'flag', a, { kind: 'army', id: a.id }) : null;
    }
    case 'army_supply_low': {
      const a = w.armies[e.armyId];
      return a && a.factionId === me ? mk(`${a.name}: ${e.days} days of food left`, 'warning', 'sheaf', a, { kind: 'army', id: a.id }, 'warning') : null;
    }
    case 'army_starving': {
      const a = w.armies[e.armyId];
      return a && a.factionId === me ? mk(`${a.name} is starving`, 'danger', 'sheaf', a, { kind: 'army', id: a.id }, 'warning') : null;
    }
    case 'engagement_started': {
      const en = w.engagements[e.engagementId];
      return e.involvesPlayer && en ? mk('Armies have met in the field', 'danger', 'swords', en, null, 'danger') : null;
    }
    case 'siege_started': {
      const s = st(e.settlementId);
      if (!s) return null;
      const a = w.armies[e.armyId];
      if (mine(e.settlementId)) return mk(`${s.name} is besieged`, 'danger', 'a_besiege', s, { kind: 'settlement', id: s.id }, 'danger');
      if (a?.factionId === me) return mk(`Our host besieges ${s.name}`, 'info', 'a_besiege', s, { kind: 'settlement', id: s.id });
      return null;
    }
    case 'settlement_captured': {
      const s = st(e.settlementId);
      if (!s || (e.to !== me && e.from !== me)) return null;
      return mk(`${s.name} has fallen to ${factionName(e.to)}`, e.to === me ? 'success' : 'danger', 'flag', s, { kind: 'settlement', id: s.id }, e.to === me ? 'success' : 'danger');
    }
    case 'rebellion_stage': {
      const s = st(e.settlementId);
      if (!s || !mine(e.settlementId)) return null;
      const bad = ['protest', 'tax_refusal', 'unrest', 'revolt', 'secession'].includes(e.stage);
      return mk(`${s.name}: ${label(e.stage)}`, bad ? 'danger' : 'info', 'alert', s, { kind: 'settlement', id: s.id }, bad ? 'danger' : null);
    }
    case 'war_declared':
      return e.a === me || e.b === me ? mk(`War: ${factionShort(e.a)} against ${factionShort(e.b)}`, 'danger', 'swords', null, null) : null;
    case 'peace_made':
      return e.a === me || e.b === me ? mk(`Peace between ${factionShort(e.a)} and ${factionShort(e.b)}`, 'success', 'diplomacy', null, null) : null;
    case 'treaty_signed': {
      const t = w.diplomacy.treaties[e.treatyId];
      return t && t.parties.includes(me) ? mk(`Treaty signed: ${label(t.type)} with ${factionShort(t.parties[0] === me ? t.parties[1] : t.parties[0])}`, 'success', 'diplomacy', null, null, 'success') : null;
    }
    case 'proposal_received':
      return e.to === me ? mk('An envoy awaits an answer', 'info', 'diplomacy', null, null) : null;
    case 'season_changed':
      return mk(`The season turns: ${SEASON_NAMES[e.season].name} (${SEASON_NAMES[e.season].english})`, 'info', `season_${e.season}`, null, null);
    case 'monsoon_roll':
      return mk(e.result === 'failed' ? 'The monsoon has failed' : e.result === 'flood' ? 'The monsoon brings floods' : 'The monsoon arrives on time', e.result === 'normal' ? 'success' : 'danger', 'season_varsha', null, null);
    case 'age_advanced':
      return e.factionId === me ? mk(`A new age: ${AGES[e.age].name}`, 'success', 'ages', e.settlementId ? (st(e.settlementId) ?? null) : null, null, 'success') : null;
    case 'landmark_started': {
      const s = st(e.settlementId);
      return e.factionId === me && s ? mk(`The ${LANDMARKS.find((l) => l.id === e.landmarkId)?.name ?? 'landmark'} rises at ${s.name}`, 'info', 'b_landmark', s, { kind: 'settlement', id: s.id }) : null;
    }
    case 'spoilage': {
      const s = st(e.settlementId);
      return s && mine(e.settlementId) && e.reason === 'capacity' && e.amount >= 1 ? mk(`${fmtInt(e.amount)} measures spoiled at ${s.name} (granaries full)`, 'warning', 'sheaf', s, { kind: 'settlement', id: s.id }) : null;
    }
    case 'market_trade':
      return null;
    case 'rebels_spawned': {
      const s = st(e.settlementId);
      return s && mine(e.settlementId) ? mk(`Rebels take up arms near ${s.name}`, 'danger', 'a_raid', s, { kind: 'army', id: e.armyId }, 'danger') : null;
    }
    case 'secession': {
      const s = st(e.settlementId);
      return s && e.from === me ? mk(`${s.name} has broken away`, 'danger', 'alert', s, { kind: 'settlement', id: s.id }, 'danger') : null;
    }
    case 'siege_breach': {
      const s = st(e.settlementId);
      return s ? mk(`The walls of ${s.name} are breached`, mine(e.settlementId) ? 'danger' : 'success', 'b_fort_walls', s, { kind: 'settlement', id: s.id }, mine(e.settlementId) ? 'danger' : 'success') : null;
    }
    case 'depot_raided': {
      const d = w.depots[e.depotId];
      return d && d.factionId === me ? mk('A supply depot was raided', 'danger', 'barrel', d, null, 'warning') : null;
    }
    case 'army_sighted': {
      const a = w.armies[e.armyId];
      return e.observerFactionId === me ? mk(`${a?.name ?? 'An army'} of ${factionShort(e.factionId)} sighted`, 'warning', 'i_scout_area', { x: e.x, z: e.z }, { kind: 'army', id: e.armyId }, 'warning') : null;
    }
    case 'hero_mission_available':
      return mk('A matter in the capital needs the prince', 'info', 'a_visit', null, null);
    case 'objective_updated':
      return mk(`Objective ${e.status === 'complete' ? 'complete' : 'failed'}`, e.status === 'complete' ? 'success' : 'danger', e.status === 'complete' ? 'check' : 'cross', null, null);
    case 'notification':
      return e.factionId === null || e.factionId === me ? mk(e.text, e.severity, e.severity === 'danger' ? 'alert' : 'info', e.focus, null) : null;
    default:
      return null;
  }
}

const OPS: Record<string, string> = { '<': 'below', '<=': 'at most', '>': 'above', '>=': 'at least', '==': 'exactly', '!=': 'not' };

/** Readable requirement of an event choice ("Requires 1,500 wealth"). */
export function describeCondition(c: Condition, w: Readonly<WorldState>): string {
  switch (c.kind) {
    case 'all':
      return c.of.map((x) => describeCondition(x, w)).join('; ');
    case 'any':
      return c.of.map((x) => describeCondition(x, w)).join(' or ');
    case 'not':
      return `Not: ${describeCondition(c.cond, w)}`;
    case 'faction_var':
      if (c.variable === 'treasury') return `Requires ${OPS[c.op]} ${fmtInt(c.value)} wealth`;
      if (c.variable === 'foodReserve') return `Requires ${OPS[c.op]} ${fmtInt(c.value)} grain in the royal reserve`;
      return `Requires ${label(c.variable)} ${OPS[c.op]} ${c.value <= 1 ? `${Math.round(c.value * 100)}%` : fmtInt(c.value)}`;
    case 'settlement_var':
      return `Requires ${label(String(c.variable))} ${OPS[c.op]} ${c.value <= 1 ? `${Math.round(c.value * 100)}%` : fmtInt(c.value)}`;
    case 'character_var':
      return `Requires ${label(c.variable)} ${OPS[c.op]} ${c.value}`;
    case 'rebellion_stage_at_least':
      return `Only when unrest reaches ${label(c.stage)}`;
    case 'season':
      return `Only in ${SEASON_NAMES[c.season].name}`;
    case 'weather':
      return `Only in ${label(c.weather)}`;
    case 'day_at_least':
      return `Not before day ${c.day}`;
    case 'flag':
    case 'flag_set':
      return 'Requires an earlier decision';
    case 'at_war':
      return 'Requires a war';
    case 'has_treaty':
      return `Requires a ${label(c.type)} treaty`;
    case 'owns_settlement':
      return `Requires holding ${w.settlements[c.settlementId]?.name ?? c.settlementId}`;
    case 'battle_won':
      return `Requires a victory in the last ${c.withinDays} days`;
    case 'army_strength_at_least':
      return `Requires ${fmtInt(c.soldiers)} soldiers under arms`;
    case 'event_resolved':
      return 'Requires an earlier decision';
    case 'random':
      return 'A matter of chance';
    case 'age_at_least':
      return `Requires the ${AGES[c.age].name}`;
    case 'landmark_built':
      return c.landmarkId ? `Requires the ${LANDMARKS.find((l) => l.id === c.landmarkId)?.name ?? 'landmark'}` : 'Requires a landmark';
    default:
      return 'Requirement not met';
  }
}

export const SEAT_NAMES: Readonly<Record<string, string>> = {
  chief_minister: 'Chief Minister',
  commander: 'Senapati',
  treasurer: 'Treasurer',
  spymaster: 'Spymaster',
  court_scholar: 'Court Scholar',
};

export const SEAT_ICONS: Readonly<Record<string, string>> = {
  chief_minister: 'scroll',
  commander: 'sword',
  treasurer: 'coins',
  spymaster: 'eye',
  court_scholar: 'lotus',
};
