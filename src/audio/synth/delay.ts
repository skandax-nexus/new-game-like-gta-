/**
 * Delay lines (integer / linear / Hermite reads), Schroeder allpass diffusers and comb resonators.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */

/** Power-of-two ring buffer delay line. Write one sample per tick, read any delay in [1, size - 4]. */
export class DelayLine {
  readonly buf: Float32Array;
  private readonly mask: number;
  private w = 0;

  constructor(maxDelay: number) {
    let size = 16;
    while (size < maxDelay + 8) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
  }

  get size(): number {
    return this.buf.length;
  }

  write(x: number): void {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }

  /** Sample written `d` ticks ago (d >= 1). */
  read(d: number): number {
    return this.buf[(this.w - d) & this.mask];
  }

  readLinear(d: number): number {
    const di = Math.floor(d);
    const f = d - di;
    const a = this.buf[(this.w - di) & this.mask];
    const b = this.buf[(this.w - di - 1) & this.mask];
    return a + (b - a) * f;
  }

  /** 4-point, 3rd-order Hermite interpolation (d >= 2). */
  readHermite(d: number): number {
    const di = Math.floor(d);
    const f = d - di;
    const m = this.mask;
    const w = this.w;
    const xm1 = this.buf[(w - di + 1) & m];
    const x0 = this.buf[(w - di) & m];
    const x1 = this.buf[(w - di - 1) & m];
    const x2 = this.buf[(w - di - 2) & m];
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }

  clear(): void {
    this.buf.fill(0);
  }
}

/** Schroeder allpass: y = -g x + d; d_in = x + g y. */
export class Allpass {
  private readonly line: DelayLine;
  constructor(
    private readonly delay: number,
    private readonly g: number,
  ) {
    this.line = new DelayLine(delay + 2);
  }
  process(x: number): number {
    const d = this.line.read(this.delay);
    const v = x + this.g * d;
    this.line.write(v);
    return d - this.g * v;
  }
}

/**
 * Lightly damped feedback comb tuned to a pitch: models a sympathetic (tarab) string or a resonant tube.
 * `t60` = ring time at the tuned pitch, `damp` = one-pole loop low-pass coefficient (0 = none).
 */
export class CombResonator {
  private readonly line: DelayLine;
  private readonly delay: number;
  private readonly fb: number;
  private lp = 0;
  constructor(
    freq: number,
    sr: number,
    t60: number,
    private readonly damp = 0.2,
  ) {
    this.delay = Math.max(2, sr / freq - damp / (1 - damp + 1e-9));
    this.line = new DelayLine(Math.ceil(this.delay) + 4);
    this.fb = Math.pow(10, -3 / (t60 * freq));
  }
  process(x: number): number {
    const y = this.line.readLinear(this.delay);
    this.lp += (1 - this.damp) * (y - this.lp);
    this.line.write(x + this.lp * this.fb);
    return y;
  }
}
