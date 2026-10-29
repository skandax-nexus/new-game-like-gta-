/**
 * Audio cue mapping (pure, shared by the audio director and the scenes): what a game event should
 * sound like. The AudioManager applies `heroCombatCues` itself (it listens to 'hero:combat'); scenes
 * (GP-03 world, GP-04 battle) forward their sim / battle events through `cuesForSimEvent` /
 * `cuesForBattleEvent` so every team maps events to the same sounds, and `battleBedLayers` turns the
 * number of engaged soldiers into the battle ambience mix.
 * OWNER: Audio Developer (AUD-01).
 */
import type { AudioStinger, HeroCombatKind, SfxKind } from '../core/events';
import type { BattleEventRecord, FactionId, SideIndex, SimEvent } from '../core/types';
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

function cue(out: SfxCue[], sfx: SfxSoundId, volume: number, delay = 0): void {
  out.push({ sfx, volume, delay });
}

/**
 * Hero melee feedback ('hero:combat') -> one-shots. GP-02 emits 'audio:sfx' only for the swings
 * (sword_light / sword_heavy), rolls (roll_cloth), salves and footsteps; hits, parries, guard breaks,
 * staggers, finishers and perfect dodges come from here. `out` is cleared and returned.
 */
export function heroCombatCues(kind: HeroCombatKind, strength: number, out: SfxCue[] = []): SfxCue[] {
  out.length = 0;
  const s = Math.max(0, Math.min(1, strength));
  const v = 0.6 + 0.4 * s;
  switch (kind) {
    case 'hit':
      cue(out, 'body_hit', v);
      if (s > 0.65) cue(out, 'fx_hit_metal', 0.5 * v);
      break;
    case 'parry':
      cue(out, 'parry_ring', 0.8 + 0.2 * s);
      break;
    case 'perfect_dodge':
      cue(out, 'fx_perfect_dodge', 1);
      break;
    case 'guard_break':
      cue(out, 'block_thud', 1);
      cue(out, 'fx_hit_metal', 0.6);
      cue(out, 'stagger_grunt', 0.8, 0.08);
      break;
    case 'stagger':
      cue(out, 'stagger_grunt', v);
      break;
    case 'finisher':
      cue(out, 'body_hit', 1);
      cue(out, 'fx_finisher_boom', 0.7 + 0.3 * s);
      break;
  }
  return out;
}

/** Strategic sim event -> SFX and / or stinger for the player (null fields = nothing). */
export function cuesForSimEvent(e: SimEvent, playerFactionId: FactionId | null): EventCue {
  const none: EventCue = { sfx: null, volume: 1, stinger: null };
  switch (e.kind) {
    case 'construction_complete':
      return { sfx: 'construction_complete', volume: 0.8, stinger: 'construction_complete' };
    case 'age_advanced':
      return e.factionId === playerFactionId ? { sfx: 'age_up_fanfare', volume: 1, stinger: 'age_up' } : none;
    case 'harvest':
      return { sfx: 'harvest', volume: 0.6, stinger: 'harvest' };
    case 'market_trade':
      return e.factionId === playerFactionId ? { sfx: 'market_coins', volume: 0.8, stinger: null } : none;
    case 'recruitment_complete':
      return { sfx: 'drum_hit', volume: 0.6, stinger: null };
    case 'war_declared':
    case 'settlement_captured':
      return { sfx: 'conch', volume: 0.8, stinger: null };
    case 'siege_started':
      return { sfx: 'ram_hit', volume: 0.6, stinger: null };
    case 'siege_breach':
      return { sfx: 'wall_crumble', volume: 0.8, stinger: null };
    case 'rebels_spawned':
    case 'rebellion_stage':
      return { sfx: 'drum_hit', volume: 0.7, stinger: null };
    case 'engagement_started':
      return e.involvesPlayer ? { sfx: 'charge_horn', volume: 0.9, stinger: null } : none;
    case 'scenario_ended':
      return { sfx: null, volume: 1, stinger: e.result === 'victory' ? 'victory' : e.result === 'defeat' ? 'defeat' : null };
    case 'hero_mission_available':
    case 'proposal_received':
    case 'event_fired':
      return { sfx: 'notify', volume: 0.8, stinger: null };
    case 'treaty_signed':
    case 'peace_made':
      return { sfx: 'bell_temple', volume: 0.6, stinger: null };
    case 'disaster':
      return { sfx: e.disaster === 'fire' ? 'fire_crackle' : 'thunder', volume: 0.7, stinger: null };
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
  out.length = 0;
  const share = total > 0 ? Math.max(0, Math.min(1, engaged / total)) : 0;
  const near = 1 / (1 + Math.max(0, distanceToFightM) / 250);
  out.push({ key: 'battle_roar', gain: Math.min(1, Math.sqrt(share) * (0.35 + 0.65 * near) * 1.15) });
  out.push({ key: 'battle_drums', gain: 0.35 + 0.35 * (1 - share) });
  return out;
}
