/**
 * Audio cue mapping (pure, shared by the audio director and the scenes): what a game event should
 * sound like. The AudioManager applies `heroCombatCues` itself (it listens to 'hero:combat'); scenes
 * (GP-03 world, GP-04 battle) forward their sim / battle events through `cuesForSimEvent` /
 * `cuesForBattleEvent` so every team maps events to the same sounds, and `battleBedLayers` turns the
 * number of engaged soldiers into the battle ambience mix.
 * OWNER: Audio Developer (AUD-01).
 */
import type { AudioStinger, HeroCombatKind, SfxKind } from '../core/events';
import type { ArmyId, BattleEventRecord, FactionId, SettlementId, SideIndex, SimEvent } from '../core/types';
import type { AmbienceLayer } from './ambience/meta';
import type { SfxSoundId } from './sfx/meta';

export interface SfxCue {
  sfx: SfxSoundId;
  volume: number;
  /** Seconds after the event (e.g. the impact of a volley). */
  delay: number;
}

export interface EventCue {
  sfx: SfxKind | null;
  volume: number;
  stinger: AudioStinger | null;
}

/** Writes cue `i` of `out`, reusing the object already there (no allocation once `out` has grown). */
function cue(out: SfxCue[], i: number, sfx: SfxSoundId, volume: number, delay = 0): number {
  const c = out[i];
  if (c) {
    c.sfx = sfx;
    c.volume = volume;
    c.delay = delay;
  } else out[i] = { sfx, volume, delay };
  return i + 1;
}

/**
 * Hero melee feedback ('hero:combat') -> one-shots. GP-02 emits 'audio:sfx' only for the swings
 * (sword_light / sword_heavy), rolls (roll_cloth), salves and footsteps; hits, parries, guard breaks,
 * staggers, finishers and perfect dodges come from here. Writes the cues into `out[0..n)` (reusing the cue
 * objects already there; `out` is never shrunk, so a scratch array makes this allocation-free per trigger)
 * and returns `n`.
 */
export function writeHeroCombatCues(kind: HeroCombatKind, strength: number, out: SfxCue[]): number {
  const s = Math.max(0, Math.min(1, strength));
  const v = 0.6 + 0.4 * s;
  let n = 0;
  switch (kind) {
    case 'hit':
      n = cue(out, n, 'body_hit', v);
      if (s > 0.65) n = cue(out, n, 'fx_hit_metal', 0.5 * v);
      break;
    case 'parry':
      n = cue(out, n, 'parry_ring', 0.8 + 0.2 * s);
      break;
    case 'perfect_dodge':
      n = cue(out, n, 'fx_perfect_dodge', 1);
      break;
    case 'guard_break':
      n = cue(out, n, 'block_thud', 1);
      n = cue(out, n, 'fx_hit_metal', 0.6);
      n = cue(out, n, 'stagger_grunt', 0.8, 0.08);
      break;
    case 'stagger':
      n = cue(out, n, 'stagger_grunt', v);
      break;
    case 'finisher':
      n = cue(out, n, 'body_hit', 1);
      n = cue(out, n, 'fx_finisher_boom', 0.7 + 0.3 * s);
      break;
  }
  return n;
}

/** `writeHeroCombatCues` returning exactly the cues (`out` is overwritten and trimmed to them). */
export function heroCombatCues(kind: HeroCombatKind, strength: number, out: SfxCue[] = []): SfxCue[] {
  out.length = writeHeroCombatCues(kind, strength, out);
  return out;
}

/**
 * Ownership lookups for `cuesForSimEvent` (the world scene passes its selectors). Settlement / army events
 * (construction, harvest, recruitment, sieges, unrest, disasters) are cued only for the player's own
 * settlements and armies, like AoE: an AI granary finishing across the map must not chime, play a stinger and
 * duck the score. Without `ownsSettlement` every settlement event is cued.
 */
export interface CueScope {
  ownsSettlement?: (id: SettlementId) => boolean;
  ownsArmy?: (id: ArmyId) => boolean;
}

/**
 * Strategic sim event -> SFX and / or stinger for the player (null fields = nothing). Faction-bearing events
 * (war, peace, captures, event cards, proposals) are cued when they involve `playerFactionId` (every one
 * when it is null: spectator / AI vs AI).
 */
export function cuesForSimEvent(e: SimEvent, playerFactionId: FactionId | null, scope?: CueScope): EventCue {
  const none: EventCue = { sfx: null, volume: 1, stinger: null };
  const mine = (id: SettlementId): boolean => !scope?.ownsSettlement || scope.ownsSettlement(id);
  const ours = (id: ArmyId | null): boolean => id !== null && !!scope?.ownsArmy && scope.ownsArmy(id);
  const player = (f: FactionId | null): boolean => playerFactionId === null || f === playerFactionId;
  switch (e.kind) {
    case 'construction_complete':
      return mine(e.settlementId) ? { sfx: 'construction_complete', volume: 0.8, stinger: 'construction_complete' } : none;
    case 'age_advanced':
      return e.factionId === playerFactionId ? { sfx: 'age_up_fanfare', volume: 1, stinger: 'age_up' } : none;
    case 'harvest':
      // All the player's settlements harvest on the same day: the voice pools' min-interval merging plays one.
      return mine(e.settlementId) ? { sfx: 'harvest', volume: 0.6, stinger: 'harvest' } : none;
    case 'market_trade':
      return e.factionId === playerFactionId ? { sfx: 'market_coins', volume: 0.8, stinger: null } : none;
    case 'recruitment_complete':
      return mine(e.settlementId) ? { sfx: 'drum_hit', volume: 0.6, stinger: null } : none;
    case 'war_declared':
      return player(e.a) || player(e.b) ? { sfx: 'conch', volume: 0.8, stinger: null } : none;
    case 'settlement_captured':
      return player(e.from) || player(e.to) ? { sfx: 'conch', volume: 0.8, stinger: null } : none;
    case 'siege_started':
      return mine(e.settlementId) || ours(e.armyId) ? { sfx: 'ram_hit', volume: 0.6, stinger: null } : none;
    case 'siege_breach':
      return mine(e.settlementId) || ours(e.armyId) ? { sfx: 'wall_crumble', volume: 0.8, stinger: null } : none;
    case 'rebels_spawned':
    case 'rebellion_stage':
      return mine(e.settlementId) ? { sfx: 'drum_hit', volume: 0.7, stinger: null } : none;
    case 'engagement_started':
      return e.involvesPlayer ? { sfx: 'charge_horn', volume: 0.9, stinger: null } : none;
    case 'scenario_ended':
      return { sfx: null, volume: 1, stinger: e.result === 'victory' ? 'victory' : e.result === 'defeat' ? 'defeat' : null };
    case 'hero_mission_available':
      return { sfx: 'notify', volume: 0.8, stinger: null };
    case 'proposal_received':
      return player(e.to) ? { sfx: 'notify', volume: 0.8, stinger: null } : none;
    case 'event_fired':
      return player(e.factionId) ? { sfx: 'notify', volume: 0.8, stinger: null } : none;
    case 'peace_made':
      return player(e.a) || player(e.b) ? { sfx: 'bell_temple', volume: 0.6, stinger: null } : none;
    case 'treaty_signed':
      return { sfx: 'bell_temple', volume: 0.6, stinger: null };
    case 'disaster':
      return mine(e.settlementId) ? { sfx: e.disaster === 'fire' ? 'fire_crackle' : 'thunder', volume: 0.7, stinger: null } : none;
    default:
      return none;
  }
}

/** Tactical battle event -> SFX / stinger (`playerSide` decides victory vs defeat). */
export function cuesForBattleEvent(e: BattleEventRecord, playerSide: SideIndex | null): EventCue {
  const none: EventCue = { sfx: null, volume: 1, stinger: null };
  switch (e.kind) {
    case 'battle_started':
      return { sfx: null, volume: 1, stinger: 'battle_start' };
    case 'deployment_ended':
      return { sfx: 'conch', volume: 1, stinger: null };
    case 'contact':
      return { sfx: 'clash', volume: 0.9, stinger: null };
    case 'charge':
      return { sfx: 'charge_horn', volume: 0.9, stinger: null };
    case 'volley':
      return { sfx: 'arrow_volley', volume: 0.8, stinger: null };
    case 'formation_routed':
    case 'formation_destroyed':
    case 'flank_collapsed':
      return { sfx: 'rout_cry', volume: 0.8, stinger: null };
    case 'formation_rallied':
      return { sfx: 'drum_hit', volume: 0.8, stinger: null };
    case 'formation_surrendered':
      return { sfx: 'cheer', volume: 0.7, stinger: null };
    case 'commander_fallen':
      return { sfx: 'conch', volume: 1, stinger: null };
    case 'elephant_rampage':
      return { sfx: 'elephant_trumpet', volume: 1, stinger: null };
    case 'gate_breached':
      return { sfx: 'gate_break', volume: 1, stinger: null };
    case 'side_withdrew':
      return { sfx: 'charge_horn', volume: 0.6, stinger: null };
    case 'battle_ended':
      return { sfx: 'cheer', volume: 0.8, stinger: playerSide === null ? null : e.side === playerSide ? 'victory' : 'defeat' };
    default:
      return none;
  }
}

/**
 * Battle ambience from the fight: `engaged` soldiers in melee out of `total`, and the camera's distance
 * to the nearest melee (m). The roar grows with the square root of the engaged share (crowds add up
 * like noise), fades with distance; distant drums are always there while the armies stand.
 */
export function battleBedLayers(engaged: number, total: number, distanceToFightM: number, out: AmbienceLayer[] = []): AmbienceLayer[] {
  const share = total > 0 ? Math.max(0, Math.min(1, engaged / total)) : 0;
  const near = 1 / (1 + Math.max(0, distanceToFightM) / 250);
  // Reuses the layer objects already in `out` (the audio director re-mixes the bed at 4 Hz).
  setLayer(out, 0, 'battle_roar', Math.min(1, Math.sqrt(share) * (0.35 + 0.65 * near) * 1.15));
  setLayer(out, 1, 'battle_drums', 0.35 + 0.35 * (1 - share));
  out.length = 2;
  return out;
}

function setLayer(out: AmbienceLayer[], i: number, key: string, gain: number): void {
  const l = out[i];
  if (l) {
    l.key = key;
    l.gain = gain;
  } else out[i] = { key, gain };
}
