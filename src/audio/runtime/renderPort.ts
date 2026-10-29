/**
 * Main-thread port to an audio worker. Uses a real Web Worker when available; otherwise (no Worker,
 * worker creation blocked) runs the same WorkerHost inline, lazily imported so the DSP code stays out of
 * the main bundle until it is needed.
 * OWNER: Audio Developer (AUD-01).
 */
import type { FromWorker, ToWorker } from './protocol';

export type WorkerFactory = () => Worker;

export interface RenderPort {
  post(msg: ToWorker, transfer?: Transferable[]): void;
  onMessage: ((msg: FromWorker) => void) | null;
  dispose(): void;
  readonly inline: boolean;
}

class WorkerPort implements RenderPort {
  onMessage: ((msg: FromWorker) => void) | null = null;
  readonly inline = false;
  constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage?.(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      this.onMessage?.({ t: 'error', message: `audio worker: ${e.message}` });
    };
  }
  post(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }
  dispose(): void {
    this.worker.terminate();
    this.onMessage = null;
  }
}

class InlinePort implements RenderPort {
  onMessage: ((msg: FromWorker) => void) | null = null;
  readonly inline = true;
  private host: { onMessage(m: ToWorker): void } | null = null;
  private readonly pending: ToWorker[] = [];
  private disposed = false;
  constructor() {
    void import('./workerHost').then(({ WorkerHost }) => {
      if (this.disposed) return;
      // Deliver asynchronously (like a worker) so callers never re-enter themselves.
      const host = new WorkerHost((msg) => setTimeout(() => this.onMessage?.(msg), 0));
      this.host = host;
      for (const m of this.pending.splice(0)) host.onMessage(m);
    });
  }
  post(msg: ToWorker): void {
    if (this.host) this.host.onMessage(msg);
    else this.pending.push(msg);
  }
  dispose(): void {
    this.disposed = true;
    this.onMessage = null;
  }
}

export function createRenderPort(factory: WorkerFactory | null): RenderPort {
  if (factory && typeof Worker !== 'undefined') {
    try {
      return new WorkerPort(factory());
    } catch {
      /* fall through to inline */
    }
  }
  return new InlinePort();
}
