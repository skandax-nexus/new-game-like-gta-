/**
 * Creates the audio worker. `?worker&inline` makes Vite bundle the worker into a Blob URL inside the main
 * bundle, so it works identically in `dist/` and in the single-file build. Kept in its own module so
 * node tests never import the worker shim. OWNER: Audio Developer (AUD-01).
 */
import AudioWorker from './audio.worker?worker&inline';

export function createAudioWorker(): Worker {
  return new AudioWorker({ name: 'samrajya-audio' });
}
