/**
 * Offline render entry points (node: tests/audio, scripts/audio/render.mjs; also used by the audio
 * worker). Pure functions only - nothing here touches WebAudio or the DOM.
 * OWNER: Audio Developer (AUD-01).
 */
import { ALL_SFX, SFX_META, type SfxSoundId } from './sfx/meta';
import { renderSfx } from './sfx/render';
import { AMBIENCE_DEFS, AMBIENCE_KEYS, ambienceDef, worldBedLayers } from './ambience/meta';
import { renderBed, renderSpot, simulateAmbience } from './ambience/render';

export { ALL_SFX, SFX_META, renderSfx, AMBIENCE_DEFS, AMBIENCE_KEYS, ambienceDef, worldBedLayers, renderBed, renderSpot, simulateAmbience };
export type { SfxSoundId };

/** All variants of one SFX at the `high` tier count. */
export function renderSfxVariants(id: SfxSoundId, sr: number, seed = 0, count = SFX_META[id].variants): Float32Array[] {
  const out: Float32Array[] = [];
  for (let v = 0; v < count; v++) out.push(renderSfx(id, v, sr, seed));
  return out;
}
