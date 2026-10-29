/**
 * Messages between the main thread and the audio workers (two instances of one worker script: the
 * 'music' worker streams the score, the 'bank' worker renders one-shots, beds, stingers and impulse
 * responses). Float32Arrays travel as transferables.
 * OWNER: Audio Developer (AUD-01).
 */
import type { AudioMood, AudioStinger } from '../../core/events';
import type { MusicContext } from '../music/moods';
import type { ScoreStats } from '../music/engine';

export type WorkerRole = 'music' | 'bank';

/**
 * Sound keys rendered by the bank worker:
 *   sfx:<SfxSoundId>   spot:<ambienceKey>:<spotName>   bed:<ambienceKey>   stinger:<AudioStinger>   ir:<name>
 */
export type SoundKey = string;

export type ToWorker =
  | { t: 'init'; role: WorkerRole; sampleRate: number; seed: number }
  | { t: 'render'; key: SoundKey; variant: number; priority: number }
  | { t: 'cancel'; key: SoundKey }
  | { t: 'mood'; mood: AudioMood; intensity: number }
  | { t: 'intensity'; value: number }
  | { t: 'context'; ctx: MusicContext }
  | { t: 'cue'; stinger: AudioStinger }
  /** Ask for the next music chunk; `recycle` returns earlier chunk arrays for reuse. */
  | { t: 'chunk'; frames: number; recycle?: [Float32Array, Float32Array] };

export type FromWorker =
  | { t: 'ready'; role: WorkerRole }
  | { t: 'sound'; key: SoundKey; variant: number; sampleRate: number; channels: Float32Array[]; ms: number }
  | { t: 'chunk'; seq: number; frames: number; L: Float32Array; R: Float32Array; ms: number; stats: ScoreStats | null }
  | { t: 'error'; message: string; key?: SoundKey };
