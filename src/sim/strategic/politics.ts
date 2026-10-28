/**
 * Internal politics: governors, loyalty, unrest -> rebellion escalation, council advice, succession,
 * characters aging/birth/death, dynasty continuation. OWNER: Lead AI & Simulation Engineer.
 * Baseline by the CTO: unrest -> rebellion stage mapping, aging, stub advice.
 *
 * Required behavior (GDD §7):
 *  - Loyalty drifts with governor interests, taxes, food, legitimacy; ambitious governors with low
 *    loyalty demand concessions (events) or rebel.
 *  - Rebellion escalation calm -> grumbling -> protest -> tax_refusal -> unrest -> revolt -> secession
 *    (BALANCE.politics.rebellionThresholds). Revolt spawns rebel armies; secession makes the province
 *    independent. Player responses: relief, negotiation, coercion, intervention (negotiate_rebels cmd).
 *  - Succession when the ruler dies: law-based heir selection, crisis chance -> claimant war.
 *    The campaign continues with the heir (dynasty.generation++).
 *  - Council: each seat's advisor recommends competing actions (getCouncilRecommendations).
 */
import type { AdvisorRecommendation, FactionId, RebellionStage, SimEvent, WorldState } from '../../core/types';
import { REBELLION_STAGES } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { clamp01 } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { settlementFoodBalance } from './economy';

/** Rebellion stage implied by an unrest level. */
export function stageForUnrest(unrest: number): RebellionStage {
  const t = BALANCE.politics.rebellionThresholds;
  let stage = 0;
  for (let i = 0; i < t.length; i++) if (unrest >= (t[i] as number)) stage = i + 1;
  return REBELLION_STAGES[Math.min(stage, REBELLION_STAGES.length - 1)] as RebellionStage;
}

export function updatePoliticsDaily(world: WorldState, out: SimEvent[]): void {
  const p = BALANCE.politics;
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (!s.ownerFactionId) continue;
    const food = settlementFoodBalance(world, s);
    const hunger = s.foodStored <= 0 && food.net < 0 ? 1 : s.grainPrice > 1.6 ? 0.4 : 0;
    s.unrest = clamp01(s.unrest + hunger * p.unrestFromHunger - 0.004 * s.publicOrder);
    s.loyalty = clamp01(s.loyalty + (0.6 - s.unrest - s.loyalty) * p.loyaltyDriftPerDay * 5);
    const stage = stageForUnrest(s.unrest);
    if (stage !== s.rebellionStage) {
      s.rebellionStage = stage;
      out.push({ kind: 'rebellion_stage', settlementId: s.id, stage });
    }
  }
}

/** Aging, natural death, (TODO) births and marriages. Called on new year. */
export function updateCharactersYearly(world: WorldState, out: SimEvent[]): void {
  for (const id of sortedKeys(world.characters)) {
    const c = world.characters[id]!;
    if (!c.alive) continue;
    const age = world.calendar.year - c.birthYear;
    if (age > 60) c.health = Math.max(0, c.health - 0.05);
    if (c.health <= 0) {
      c.alive = false;
      c.deathYear = world.calendar.year;
      out.push({ kind: 'character_died', characterId: c.id });
      const f = world.factions[c.factionId];
      if (f && f.rulerId === c.id) checkSuccession(world, f.id, out);
    }
  }
}

/** Resolve succession for a faction whose ruler died. Baseline: heir takes over. */
export function checkSuccession(world: WorldState, factionId: FactionId, out: SimEvent[]): void {
  const f = world.factions[factionId];
  if (!f) return;
  const ruler = f.rulerId ? world.characters[f.rulerId] : null;
  if (ruler && ruler.alive) return;
  const heir = f.heirId ? world.characters[f.heirId] : null;
  if (heir && heir.alive) {
    f.rulerId = heir.id;
    f.heirId = null;
    heir.roles = heir.roles.filter((r) => r !== 'heir').concat('ruler');
    const dyn = f.dynastyId ? world.dynasties[f.dynastyId] : null;
    if (dyn) {
      dyn.headId = heir.id;
      dyn.generation += 1;
    }
    out.push({ kind: 'succession', factionId, newRulerId: heir.id, crisis: false });
  }
}

/** Competing advice from the council. Baseline: one generic line per seated advisor. */
export function getCouncilRecommendations(world: WorldState, factionId: FactionId): AdvisorRecommendation[] {
  const f = world.factions[factionId];
  if (!f) return [];
  const recs: AdvisorRecommendation[] = [];
  for (const seat of Object.keys(f.council).sort() as (keyof typeof f.council)[]) {
    const id = f.council[seat];
    if (!id) continue;
    recs.push({
      advisorId: id,
      seat,
      topic: seat === 'commander' ? 'military' : seat === 'treasurer' ? 'economy' : seat === 'spymaster' ? 'espionage' : 'order',
      text: seat === 'commander' ? 'Strengthen the southern crossings before the dry season.' : seat === 'treasurer' ? 'The granaries must be refilled before we march.' : 'Keep the nobles close and the people fed.',
      suggestion: null,
      urgency: 0.3,
    });
  }
  return recs;
}
