/**
 * Voice pool (pure bookkeeping, no WebAudio): a fixed number of slots (the quality tier's cap) with
 * priorities. Allocation:
 *   1. slots whose sound has ended are free;
 *   2. a re-trigger of the same kind inside its min interval is merged (rejected);
 *   3. a kind at its instance limit recycles its own oldest instance (if not of higher priority);
 *   4. otherwise a free slot;
 *   5. otherwise steal the least important voice: lowest priority, then quietest-and-nearly-done,
 *      then oldest - never a voice of higher priority than the request.
 * Typed arrays only; allocate() does not allocate after construction.
 * OWNER: Audio Developer (AUD-01).
 */

export interface VoiceRequest {
  /** Sound kind (instance limits and re-trigger merging are per kind). */
  kind: string;
  priority: number;
  /** Seconds (any monotonic clock, e.g. AudioContext.currentTime): the clock right now. */
  now: number;
  /**
   * Scheduled start (same clock) when the sound is delayed (thunder after lightning, a grunt after a guard
   * break); defaults to `now`. Slots are freed by `now` only, so a delayed request never frees (and then
   * cuts) voices that are still sounding.
   */
  at?: number;
  /** Expected duration (s) at the playback rate. */
  duration: number;
  /** Linear playback gain (quiet voices are stolen first). */
  gain: number;
  maxInstances: number;
  minIntervalMs: number;
}

export type RejectReason = 'interval' | 'limit' | 'busy';

export class VoicePool {
  private kinds: (string | null)[] = [];
  private prio = new Float64Array(0);
  private start = new Float64Array(0);
  private end = new Float64Array(0);
  private gain = new Float64Array(0);
  private readonly lastStart = new Map<string, number>();
  /** Set by allocate(): true when the returned slot was taken from a playing voice. */
  lastStolen = false;
  /** Set by allocate() when it returns -1. */
  lastReject: RejectReason | null = null;
  /** Counters for stats. */
  stolen = 0;
  rejected = 0;

  constructor(capacity: number) {
    this.resize(capacity);
  }

  get capacity(): number {
    return this.kinds.length;
  }

  /** Change the cap (quality tier change). Voices beyond the new cap are dropped. */
  resize(capacity: number): void {
    const n = Math.max(1, Math.floor(capacity));
    const k = this.kinds.slice(0, n);
    while (k.length < n) k.push(null);
    const grow = (a: Float64Array): Float64Array => {
      const b = new Float64Array(n);
      b.set(a.subarray(0, Math.min(a.length, n)));
      return b;
    };
    this.kinds = k;
    this.prio = grow(this.prio);
    this.start = grow(this.start);
    this.end = grow(this.end);
    this.gain = grow(this.gain);
  }

  /** Voices still sounding at `now`. */
  active(now: number): number {
    let c = 0;
    for (let i = 0; i < this.kinds.length; i++) if (this.kinds[i] !== null && this.end[i] > now) c++;
    return c;
  }

  kindAt(slot: number): string | null {
    return this.kinds[slot] ?? null;
  }

  /** Returns a slot index, or -1 (see lastReject). */
  allocate(r: VoiceRequest): number {
    this.lastStolen = false;
    this.lastReject = null;
    const n = this.kinds.length;
    const now = r.now;
    const at = r.at === undefined ? now : Math.max(now, r.at);
    for (let i = 0; i < n; i++) if (this.kinds[i] !== null && this.end[i] <= now) this.kinds[i] = null;
    const last = this.lastStart.get(r.kind);
    if (last !== undefined && Math.abs(at - last) < r.minIntervalMs / 1000) return this.reject('interval');
    // Per-kind instance limit: recycle the kind's own oldest voice.
    let count = 0;
    let oldest = -1;
    for (let i = 0; i < n; i++) {
      if (this.kinds[i] !== r.kind) continue;
      count++;
      if (oldest < 0 || this.start[i] < this.start[oldest]) oldest = i;
    }
    if (count >= Math.max(1, r.maxInstances)) {
      if (oldest >= 0 && this.prio[oldest] <= r.priority) return this.take(oldest, r, at, true);
      return this.reject('limit');
    }
    for (let i = 0; i < n; i++) if (this.kinds[i] === null) return this.take(i, r, at, false);
    // Steal the least important voice.
    let victim = -1;
    for (let i = 0; i < n; i++) {
      if (victim < 0) {
        victim = i;
        continue;
      }
      const pv = this.prio[victim];
      const pi = this.prio[i];
      if (pi < pv) victim = i;
      else if (pi === pv) {
        const lv = this.gain[victim] * Math.max(0, this.end[victim] - now);
        const li = this.gain[i] * Math.max(0, this.end[i] - now);
        if (li < lv || (li === lv && this.start[i] < this.start[victim])) victim = i;
      }
    }
    if (victim < 0 || this.prio[victim] > r.priority) return this.reject('busy');
    return this.take(victim, r, at, true);
  }

  release(slot: number): void {
    if (slot >= 0 && slot < this.kinds.length) this.kinds[slot] = null;
  }

  clear(): void {
    for (let i = 0; i < this.kinds.length; i++) this.kinds[i] = null;
    this.lastStart.clear();
  }

  private take(i: number, r: VoiceRequest, at: number, stolen: boolean): number {
    this.kinds[i] = r.kind;
    this.prio[i] = r.priority;
    this.start[i] = at;
    this.end[i] = at + Math.max(0.001, r.duration);
    this.gain[i] = r.gain;
    this.lastStart.set(r.kind, at);
    this.lastStolen = stolen;
    if (stolen) this.stolen++;
    return i;
  }

  private reject(reason: RejectReason): number {
    this.lastReject = reason;
    this.rejected++;
    return -1;
  }
}

/**
 * How a tier's voice cap is split between the pools: flat (UI + non-positional SFX), spatial SFX and
 * ambience spots. Stingers and the score stream are not voices.
 */
export function splitVoiceCap(cap: number): { flat: number; sfx: number; ambience: number } {
  const c = Math.max(8, Math.floor(cap));
  const flat = Math.max(4, Math.round(c * 0.2));
  const ambience = Math.max(3, Math.round(c * 0.2));
  return { flat, ambience, sfx: c - flat - ambience };
}
