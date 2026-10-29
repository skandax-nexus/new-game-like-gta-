/**
 * Audio worker entry (bundled inline by Vite: `?worker&inline`, so it also works in the single-file
 * build). All logic lives in WorkerHost. OWNER: Audio Developer (AUD-01).
 */
import type { ToWorker } from './protocol';
import { WorkerHost } from './workerHost';

const scope = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const host = new WorkerHost((msg, transfer) => scope.postMessage(msg, transfer));
scope.onmessage = (e) => host.onMessage(e.data);
