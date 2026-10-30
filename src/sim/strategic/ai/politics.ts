/**
 * Campaign AI home politics, espionage and event choices (DESIGN_SPEC §7.9, §7.11, §7.13, SIM-02 spec 4). OWNER: AI
 * Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 *  - Rebels (`negotiate_rebels`): a settlement at protest or worse gets an offer at most every 30 days - relief when
 *    it is hungry and the reserve can feed it, coercion for the hard personalities (expansionist, raider) when troops
 *    are at hand and loyalty is not so low that it backfires, a tax cut when the treasury can spare it, autonomy for
 *    the soft personalities (diplomatic, mercantile) or a town in open revolt. Rebel armies are fought by military.ts.
 *  - Espionage (`spy_mission`), by personality: counter-intelligence while at war (defensive, diplomatic, mercantile),
 *    gather intelligence on the enemy or the strongest neighbour, incite unrest in the enemy's least loyal town
 *    (opportunist, raider), sabotage the enemy's supply (raider), spread rumours (opportunist, diplomatic), protect the
 *    court when legitimacy is low. Hostile missions only against war enemies or realms it holds in contempt (opinion
 *    below -25), at most one per realm every 45 days (rumours every 120, the same town stirred every 120 days and only
 *    while calm or grumbling). Bounded by `maxAgents`.
 *  - Events: `chooseAiEventChoice` - the choice's `aiWeight` x the personality's appetite for its effects, among the
 *    choices whose `requires` holds, picked with the world RNG. Used for AI events left pending (SIM-01 resolves AI
 *    events at fire time; request filed to route that through this function too).
 */
import type { EventChoiceDef, EventDef, EventScope, FactionId, SpyMission, StrategicCommand, WorldState } from '../../../core/types';
import { sortedKeys } from '../../../core/ids';
import { AI_PERSONALITY_DEFS } from '../../../data/difficulty';
import { getEventDef } from '../../../data/events';
import { FACTIONS } from '../../../data/factions';
import { activeAgents, intelLevel, maxAgents, validateSpyMission } from '../espionage';
import { effectiveOpinion } from '../diplomacy';
import { evalCondition } from '../events';
import { validateNegotiation } from '../politics';
import { withWorldRng } from '../state';
import type { Situation } from './core';
import { issue, note, recently, remember } from './core';

const BAD_STAGES = ['protest', 'tax_refusal', 'unrest', 'revolt'];

type RebelOffer = Extract<StrategicCommand, { kind: 'negotiate_rebels' }>['offer'];

/** Rebel negotiations (economy runs). */
export function planRebels(sit: Situation): void {
  const p = sit.f.ai.personality;
  for (const s of sit.owned) {
    if (!BAD_STAGES.includes(s.rebellionStage)) continue;
    if (recently(sit, `negotiate_${s.id}`, 30)) continue;
    const hungry = s.starvationDays > 0 || (s.foodConsumption > 0 && s.foodStored / s.foodConsumption < 20);
    const offers: RebelOffer[] = [];
    if (hungry) offers.push('relief');
    if ((p === 'expansionist' || p === 'raider') && s.loyalty >= 0.32) offers.push('coercion');
    if (p === 'diplomatic' || p === 'mercantile' || s.rebellionStage === 'revolt') offers.push('autonomy');
    if (sit.f.treasury > 800) offers.push('tax_cut');
    if (!hungry) offers.push('relief');
    if (s.loyalty >= 0.32 && !offers.includes('coercion')) offers.push('coercion');
    offers.push('autonomy');
    for (const offer of offers) {
      if (validateNegotiation(sit.world, sit.fid, s.id, offer)) continue;
      issue(sit, { kind: 'negotiate_rebels', settlementId: s.id, offer });
      remember(sit, `negotiate_${s.id}`, sit.day);
      note(sit, 'rebels', `offers ${offer.replace('_', ' ')} to ${s.name} (${s.rebellionStage.replace('_', ' ')}, loyalty ${s.loyalty.toFixed(2)})`);
      break;
    }
  }
}

/** Espionage run (every 15 days). */
export function planEspionage(sit: Situation): void {
  const { world, fid, f } = sit;
  const max = maxAgents(world, fid);
  const busy = activeAgents(world, fid);
  if (busy.length >= max) return;
  const p = f.ai.personality;
  const running = (m: SpyMission, target: FactionId): boolean => busy.some((a) => a.mission === m && a.targetFactionId === target);
  // Rivals: war enemies first, else the strongest realm it is hostile to (opinion below -25). Covert harm against a
  // realm at peace and on fair terms is not worth the incident (caught agents cost opinion).
  const enemies = sit.enemies.filter((e) => !e.startsWith('rebel'));
  let rival: FactionId | null = enemies[0] ?? null;
  if (!rival) {
    let bs = 0;
    for (const o of sortedKeys(world.factions)) {
      if (o === fid || !world.factions[o]!.alive || effectiveOpinion(world, fid, o) >= -25) continue;
      const st = sit.strength[o] ?? 0;
      if (st > bs) {
        bs = st;
        rival = o;
      }
    }
  }
  // Intelligence (harmless) on the strongest neighbour even in peace.
  let watch: FactionId | null = rival;
  if (!watch) {
    let bs = 0;
    for (const o of sortedKeys(world.factions)) {
      if (o === fid || !world.factions[o]!.alive) continue;
      const st = sit.strength[o] ?? 0;
      if (st > bs) {
        bs = st;
        watch = o;
      }
    }
  }
  const plans: { mission: SpyMission; target: FactionId; settlementId: string | null; why: string }[] = [];
  if (f.legitimacy < 0.45) plans.push({ mission: 'protect_court', target: fid, settlementId: null, why: 'legitimacy is low' });
  const defensiveMind = p === 'defensive' || p === 'diplomatic' || p === 'mercantile';
  if (enemies.length > 0 && defensiveMind && f.counterIntelUntilDay === null) plans.push({ mission: 'counter_intelligence', target: fid, settlementId: null, why: 'at war' });
  if (rival) {
    if (p === 'raider' && enemies.length > 0) plans.push({ mission: 'sabotage_supply', target: rival, settlementId: null, why: 'cut their supply' });
    if (p === 'opportunist' || p === 'raider') {
      let weakest: string | null = null;
      let lo = 1;
      for (const id of sortedKeys(world.settlements)) {
        const s = world.settlements[id]!;
        if (s.ownerFactionId !== rival) continue;
        // Stir a town once in a long while, never one already in the streets (the agent would be wasted or caught).
        if (s.rebellionStage !== 'calm' && s.rebellionStage !== 'grumbling') continue;
        if (recently(sit, `incite_${s.id}`, 120)) continue;
        if (s.loyalty < lo) {
          lo = s.loyalty;
          weakest = s.id;
        }
      }
      if (weakest && lo < 0.55) plans.push({ mission: 'incite_unrest', target: rival, settlementId: weakest, why: `their loyalty is thin at ${world.settlements[weakest]!.name}` });
    }
    if (p === 'opportunist' || p === 'diplomatic') plans.push({ mission: 'spread_rumors', target: rival, settlementId: null, why: 'weaken their court' });
  }
  if (watch && intelLevel(world, fid, watch) < 0.6) plans.push({ mission: 'gather_intel', target: watch, settlementId: null, why: rival ? 'know the enemy' : 'watch the strongest neighbour' });
  if (defensiveMind && f.counterIntelUntilDay === null) plans.push({ mission: 'counter_intelligence', target: fid, settlementId: null, why: 'guard the court' });
  for (const pl of plans) {
    if (running(pl.mission, pl.target)) continue;
    // Hostile missions against one realm at most every 45 days (rumours every 120).
    const hostile = pl.mission === 'incite_unrest' || pl.mission === 'sabotage_supply' || pl.mission === 'spread_rumors';
    if (hostile && recently(sit, `covert_${pl.target}`, 45)) continue;
    if (pl.mission === 'spread_rumors' && recently(sit, `rumors_${pl.target}`, 120)) continue;
    if (validateSpyMission(world, fid, pl.target, pl.mission, pl.settlementId, null)) continue;
    if (hostile) remember(sit, `covert_${pl.target}`, sit.day);
    if (pl.mission === 'spread_rumors') remember(sit, `rumors_${pl.target}`, sit.day);
    if (pl.settlementId) remember(sit, `incite_${pl.settlementId}`, sit.day);
    issue(sit, { kind: 'spy_mission', targetFactionId: pl.target, mission: pl.mission, settlementId: pl.settlementId, agentCharacterId: null });
    note(sit, 'spy', `sends an agent: ${pl.mission.replace(/_/g, ' ')}${pl.target !== fid ? ` against ${FACTIONS[pl.target]?.shortName ?? pl.target}` : ''} (${pl.why})`);
    return;
  }
}

// ---------------------------------------------------------------------------------------------------
// Event choices
// ---------------------------------------------------------------------------------------------------

/** Personality appetite for a choice: aiWeight x (1 + alignment of its effects with the personality weights). */
function choiceWeight(world: WorldState, factionId: FactionId, c: EventChoiceDef): number {
  const f = world.factions[factionId];
  const w = AI_PERSONALITY_DEFS[f?.ai.personality ?? 'opportunist']?.weights;
  if (!w) return c.aiWeight;
  let k = 0;
  for (const e of c.effects) {
    switch (e.kind) {
      case 'faction_var':
        if (e.variable === 'treasury') k += (e.value < 0 ? -0.15 : 0.15) * (w.trade + w.develop) / 2;
        else if (e.variable === 'stability' || e.variable === 'legitimacy') k += (e.value > 0 ? 0.2 : -0.2) * (w.defend + w.diplomacy) / 2;
        else if (e.variable === 'prestige') k += (e.value > 0 ? 0.1 : -0.1) * w.expand;
        else if (e.variable === 'foodReserve') k += (e.value > 0 ? 0.15 : -0.15) * w.develop;
        break;
      case 'settlement_var':
        if (e.variable === 'loyalty' || e.variable === 'publicOrder') k += (e.value > 0 ? 0.15 : -0.15) * w.defend;
        else if (e.variable === 'unrest') k += (e.value > 0 ? -0.15 : 0.15) * w.defend;
        break;
      case 'opinion':
        k += (e.delta > 0 ? 0.15 : -0.1) * w.diplomacy;
        break;
      case 'sign_treaty':
        k += 0.2 * w.diplomacy;
        break;
      case 'declare_war':
        k += 0.25 * (w.expand + w.raid) / 2 - 0.2 * w.diplomacy;
        break;
      default:
        break;
    }
  }
  return Math.max(0.01, c.aiWeight * (1 + Math.max(-0.8, Math.min(1.5, k))));
}

/**
 * The AI's choice for an event instance (aiWeight x personality appetite, `requires` respected, world RNG). Exported
 * for SIM-01 `fireEvent` (request) and used for AI events left pending.
 */
export function chooseAiEventChoice(world: WorldState, factionId: FactionId, def: EventDef, scope: EventScope): string {
  const allowed = def.choices.filter((c) => !c.requires || evalCondition(world, c.requires, scope));
  const pool = allowed.length > 0 ? allowed : def.choices;
  if (pool.length === 0) return '';
  const weights = pool.map((c) => choiceWeight(world, factionId, c));
  const idx = withWorldRng(world, (rng) => rng.weightedIndex(weights));
  return pool[idx]?.id ?? pool[0]!.id;
}

/** Resolve this realm's pending events (normally none: SIM-01 resolves AI events when they fire). */
export function planEvents(sit: Situation): void {
  for (const inst of sit.world.events.pending) {
    if (inst.status !== 'pending' || inst.scope.factionId !== sit.fid) continue;
    const def = getEventDef(inst.defId);
    if (!def || def.choices.length === 0) continue;
    const choiceId = chooseAiEventChoice(sit.world, sit.fid, def, inst.scope);
    issue(sit, { kind: 'event_choice', eventInstanceId: inst.id, choiceId });
    note(sit, 'goal', `answers "${def.title}": ${def.choices.find((c) => c.id === choiceId)?.label ?? choiceId}`);
  }
}
