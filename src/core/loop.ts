/**
 * Fixed-timestep game loop with pause, speed scaling (0.5x-8x) and render interpolation.
 * Owned by the CTO. DOM use limited to requestAnimationFrame (injectable for tests).
 *
 *   accumulator += realDt * timeScale
 *   while accumulator >= fixedStep: fixedUpdate(fixedStep)   // deterministic sim
 *   update(realDt, alpha = accumulator / fixedStep)           // camera, interpolation, render
 *
 * Speed changes alter HOW MANY steps run per frame, never the step size, so results are identical at
 * any speed. `fixedStep` is real seconds per sim step at 1x and is set per scene (see constants.ts).
 */
import { MAX_FRAME_DT, MAX_STEPS_PER_FRAME, MAX_TIME_SCALE, MIN_TIME_SCALE } from './constants';

export interface LoopTarget {
  /** Advance the simulation by exactly one fixed step (`step` = fixedStep seconds). */
  fixedUpdate(step: number): void;
  /** Per rendered frame. `dt` is real (unscaled) seconds; `alpha` in [0,1) interpolates prev->current sim state. */
  update(dt: number, alpha: number): void;
}

export interface LoopOptions {
  fixedStep: number;
  maxStepsPerFrame?: number;
  maxFrameDt?: number;
  now?: () => number;
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (id: number) => void;
}

export interface LoopStats {
  frames: number;
  /** Total fixed steps executed. */
  steps: number;
  stepsLastFrame: number;
  /** Sim seconds dropped due to the per-frame step cap (persistent drops mean the sim is too slow). */
  droppedSec: number;
  alpha: number;
  lastFrameDt: number;
}

export class GameLoop {
  fixedStep: number;
  private maxSteps: number;
  private maxFrameDt: number;
  private target: LoopTarget | null = null;
  private acc = 0;
  private last = -1;
  private rafId = 0;
  private _running = false;
  private _paused = false;
  private _timeScale = 1;
  private readonly now: () => number;
  private readonly requestFrame: (cb: (t: number) => void) => number;
  private readonly cancelFrame: (id: number) => void;
  /** Called after each frame (profiler hook). */
  onFrameEnd: ((stats: LoopStats) => void) | null = null;
  /** Called when a target throws (crash reporter hook). The loop keeps running. */
  onError: ((err: unknown) => void) | null = null;
  /** Called when pause/timeScale changes. */
  onSpeedChange: ((timeScale: number, paused: boolean) => void) | null = null;

  readonly stats: LoopStats = { frames: 0, steps: 0, stepsLastFrame: 0, droppedSec: 0, alpha: 0, lastFrameDt: 0 };

  constructor(opts: LoopOptions) {
    this.fixedStep = opts.fixedStep;
    this.maxSteps = opts.maxStepsPerFrame ?? MAX_STEPS_PER_FRAME;
    this.maxFrameDt = opts.maxFrameDt ?? MAX_FRAME_DT;
    this.now = opts.now ?? (() => performance.now());
    this.requestFrame = opts.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.cancelFrame = opts.cancelFrame ?? ((id) => cancelAnimationFrame(id));
  }

  get running(): boolean {
    return this._running;
  }
  get paused(): boolean {
    return this._paused;
  }
  get timeScale(): number {
    return this._timeScale;
  }

  setTarget(target: LoopTarget | null, fixedStep?: number): void {
    this.target = target;
    if (fixedStep !== undefined) this.fixedStep = fixedStep;
    this.acc = 0;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this.last = -1;
    const tick = (t: number): void => {
      if (!this._running) return;
      this.rafId = this.requestFrame(tick);
      this.frame(t);
    };
    this.rafId = this.requestFrame(tick);
  }

  stop(): void {
    this._running = false;
    this.cancelFrame(this.rafId);
  }

  setTimeScale(scale: number): void {
    const s = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, scale));
    if (s === this._timeScale) return;
    this._timeScale = s;
    this.onSpeedChange?.(this._timeScale, this._paused);
  }

  setPaused(paused: boolean): void {
    if (paused === this._paused) return;
    this._paused = paused;
    this.onSpeedChange?.(this._timeScale, this._paused);
  }
  pause(): void {
    this.setPaused(true);
  }
  resume(): void {
    this.setPaused(false);
  }
  togglePause(): void {
    this.setPaused(!this._paused);
  }

  /** Execute `n` fixed steps immediately (debug / QA, works while paused). */
  stepNow(n = 1): void {
    if (!this.target) return;
    for (let i = 0; i < n; i++) {
      this.target.fixedUpdate(this.fixedStep);
      this.stats.steps++;
    }
  }

  /** Run one frame with an explicit timestamp in ms (rAF callback; also used by headless tests). */
  frame(nowMs?: number): void {
    const t = nowMs ?? this.now();
    let dt = this.last < 0 ? 0 : (t - this.last) / 1000;
    this.last = t;
    if (dt > this.maxFrameDt) dt = this.maxFrameDt;
    if (dt < 0) dt = 0;
    this.advance(dt);
  }

  /** Advance by `dt` real seconds (no rAF). */
  advance(dt: number): void {
    const target = this.target;
    this.stats.frames++;
    this.stats.lastFrameDt = dt;
    let steps = 0;
    try {
      if (target) {
        if (!this._paused) this.acc += dt * this._timeScale;
        const step = this.fixedStep;
        while (this.acc >= step && steps < this.maxSteps) {
          target.fixedUpdate(step);
          this.acc -= step;
          steps++;
        }
        if (steps >= this.maxSteps && this.acc >= step) {
          // Too slow to keep up: drop the backlog instead of spiralling.
          this.stats.droppedSec += this.acc - (this.acc % step);
          this.acc = this.acc % step;
        }
        this.stats.alpha = step > 0 ? this.acc / step : 0;
        target.update(dt, this.stats.alpha);
      }
    } catch (err) {
      if (this.onError) this.onError(err);
      else throw err;
    }
    this.stats.steps += steps;
    this.stats.stepsLastFrame = steps;
    this.onFrameEnd?.(this.stats);
  }
}
