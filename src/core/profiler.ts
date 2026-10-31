/**
 * Frame profiler: FPS, frame ms, per-system CPU timings, render stats + an on-screen overlay (F3 or
 * ?profiler=1). Owned by the CTO.
 *
 * Usage in hot paths (zero allocation):
 *   profiler.begin('sim.tactical'); ...; profiler.end('sim.tactical');
 * System names are dotted: sim.strategic, sim.tactical, sim.soldiers, render.terrain, render.units,
 * render.post, ui, input, audio ... Keep names static strings.
 */

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
  /** Current dynamic-resolution scale (1 = native). */
  resolutionScale: number;
  pixelRatio: number;
  width: number;
  height: number;
  /** Shadow-map draw calls inside drawCalls (optional; the overlay falls back to counter `render.shadowDraws`). */
  shadowDrawCalls?: number;
  /** Enabled post passes this frame (optional; the overlay falls back to counter `render.postPasses`). */
  postPasses?: number;
}

export interface SystemTiming {
  /** Exponential moving average (ms). */
  avg: number;
  /** Max over the last window (ms). */
  max: number;
  last: number;
}

export interface ProfileSnapshot {
  fps: number;
  frameMs: number;
  frameMsP95: number;
  frameMsMax: number;
  /** CPU ms spent inside begin/end blocks this frame (top-level systems only). */
  cpuMs: number;
  systems: Record<string, SystemTiming>;
  render: RenderStats;
  counters: Record<string, number>;
  memoryMb: number | null;
  frames: number;
  longFrames: number;
}

const WINDOW = 120;

export class Profiler {
  private frameTimes = new Float32Array(WINDOW);
  private frameIdx = 0;
  private frameCount = 0;
  private lastFrameStart = -1;
  private systems: Record<string, SystemTiming> = {};
  private starts: Record<string, number> = {};
  private windowMax: Record<string, number> = {};
  private windowFrames = 0;
  private counters: Record<string, number> = {};
  private render: RenderStats = {
    drawCalls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    resolutionScale: 1,
    pixelRatio: 1,
    width: 0,
    height: 0,
  };
  private longFrames = 0;
  private overlay: ProfilerOverlay | null = null;
  enabled = true;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Call at the start of each rendered frame. */
  beginFrame(): void {
    const t = this.now();
    if (this.lastFrameStart >= 0) {
      const dt = t - this.lastFrameStart;
      this.frameTimes[this.frameIdx] = dt;
      this.frameIdx = (this.frameIdx + 1) % WINDOW;
      this.frameCount++;
      if (dt > 50) this.longFrames++;
    }
    this.lastFrameStart = t;
    this.windowFrames++;
    if (this.windowFrames >= WINDOW) {
      this.windowFrames = 0;
      for (const k in this.windowMax) this.windowMax[k] = 0;
    }
  }

  /** Call at the end of each rendered frame (updates the overlay). */
  endFrame(): void {
    this.overlay?.maybeUpdate(this);
  }

  begin(name: string): void {
    if (!this.enabled) return;
    this.starts[name] = this.now();
  }

  end(name: string): void {
    if (!this.enabled) return;
    const s = this.starts[name];
    if (s === undefined) return;
    const ms = this.now() - s;
    let st = this.systems[name];
    if (!st) {
      st = { avg: ms, max: ms, last: ms };
      this.systems[name] = st;
    }
    st.last = ms;
    st.avg = st.avg * 0.92 + ms * 0.08;
    const wm = Math.max(this.windowMax[name] ?? 0, ms);
    this.windowMax[name] = wm;
    st.max = Math.max(wm, st.avg);
  }

  /** Measure a function (convenience; allocates a closure at the call site - avoid in hot loops). */
  measure<T>(name: string, fn: () => T): T {
    this.begin(name);
    try {
      return fn();
    } finally {
      this.end(name);
    }
  }

  /** Named counters (e.g. soldiers, formations, volleys, instances). */
  setCounter(name: string, value: number): void {
    this.counters[name] = value;
  }

  setRenderStats(stats: Partial<RenderStats>): void {
    Object.assign(this.render, stats);
  }

  snapshot(): ProfileSnapshot {
    const n = Math.min(this.frameCount, WINDOW);
    let sum = 0;
    let max = 0;
    const sorted: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = this.frameTimes[i];
      sum += v;
      if (v > max) max = v;
      sorted.push(v);
    }
    sorted.sort((a, b) => a - b);
    const avg = n > 0 ? sum / n : 0;
    let cpu = 0;
    for (const k in this.systems) if (!k.includes('.') || k.split('.').length === 2) cpu += this.systems[k]?.last ?? 0;
    const perf = (typeof performance !== 'undefined' ? performance : undefined) as
      | (Performance & { memory?: { usedJSHeapSize: number } })
      | undefined;
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      frameMs: avg,
      frameMsP95: n > 0 ? (sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0) : 0,
      frameMsMax: max,
      cpuMs: cpu,
      systems: JSON.parse(JSON.stringify(this.systems)) as Record<string, SystemTiming>,
      render: { ...this.render },
      counters: { ...this.counters },
      memoryMb: perf?.memory ? perf.memory.usedJSHeapSize / 1048576 : null,
      frames: this.frameCount,
      longFrames: this.longFrames,
    };
  }

  /** Average frame ms over the window (dynamic resolution controller input). */
  averageFrameMs(): number {
    const n = Math.min(this.frameCount, WINDOW);
    if (n === 0) return 0;
    let s = 0;
    for (let i = 0; i < n; i++) s += this.frameTimes[i];
    return s / n;
  }

  /** Raw ring buffer of frame times (ms) and the index of the oldest sample. Do not mutate. */
  getFrameHistory(): { times: Float32Array; head: number } {
    return { times: this.frameTimes, head: this.frameIdx };
  }

  attachOverlay(parent: HTMLElement): void {
    if (!this.overlay) this.overlay = new ProfilerOverlay(parent);
  }

  get overlayVisible(): boolean {
    return this.overlay?.visible ?? false;
  }

  setOverlayVisible(v: boolean): void {
    this.overlay?.setVisible(v);
  }

  toggleOverlay(): void {
    if (this.overlay) this.overlay.setVisible(!this.overlay.visible);
  }
}

class ProfilerOverlay {
  readonly el: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private readonly graph: HTMLCanvasElement;
  private lastUpdate = 0;
  visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'samrajya-profiler';
    Object.assign(this.el.style, {
      position: 'absolute',
      top: 'max(8px, env(safe-area-inset-top))',
      left: 'max(8px, env(safe-area-inset-left))',
      padding: '8px 10px',
      background: 'rgba(14, 10, 24, 0.82)',
      border: '1px solid rgba(233, 185, 73, 0.45)',
      borderRadius: '6px',
      color: '#f3e6c8',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '1500',
      minWidth: '220px',
    } satisfies Partial<CSSStyleDeclaration>);
    this.graph = document.createElement('canvas');
    this.graph.width = 220;
    this.graph.height = 40;
    this.graph.style.display = 'block';
    this.graph.style.marginBottom = '4px';
    this.text = document.createElement('pre');
    this.text.style.margin = '0';
    this.text.style.whiteSpace = 'pre';
    this.el.append(this.graph, this.text);
    parent.appendChild(this.el);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  maybeUpdate(p: Profiler): void {
    if (!this.visible) return;
    const now = performance.now();
    if (now - this.lastUpdate < 250) return;
    this.lastUpdate = now;
    const s = p.snapshot();
    const r = s.render;
    const lines = [
      `FPS ${s.fps.toFixed(1)}  frame ${s.frameMs.toFixed(1)} ms  p95 ${s.frameMsP95.toFixed(1)}`,
      `draws ${r.drawCalls}  tris ${(r.triangles / 1000).toFixed(1)}k  prog ${r.programs}`,
      `geo ${r.geometries}  tex ${r.textures}  res ${(r.resolutionScale * 100).toFixed(0)}% @${r.pixelRatio.toFixed(2)}x`,
      `${r.width}x${r.height}${s.memoryMb !== null ? `  heap ${s.memoryMb.toFixed(0)} MB` : ''}`,
    ];
    const shadowDraws = r.shadowDrawCalls ?? s.counters['render.shadowDraws'];
    const postPasses = r.postPasses ?? s.counters['render.postPasses'];
    if (shadowDraws !== undefined || postPasses !== undefined) {
      lines.splice(2, 0, `shadow draws ${shadowDraws ?? '-'}  post passes ${postPasses ?? '-'}`);
    }
    const names = Object.keys(s.systems).sort();
    for (const k of names) {
      const t = s.systems[k] as SystemTiming;
      lines.push(`${k.padEnd(18)} ${t.avg.toFixed(2).padStart(6)} ms  max ${t.max.toFixed(1)}`);
    }
    for (const k of Object.keys(s.counters).sort()) lines.push(`${k.padEnd(18)} ${s.counters[k]}`);
    this.text.textContent = lines.join('\n');
    this.drawGraph(p);
  }

  private drawGraph(p: Profiler): void {
    const ctx = this.graph.getContext('2d');
    if (!ctx) return;
    const { times: snapshot, head: idx } = p.getFrameHistory();
    const w = this.graph.width;
    const h = this.graph.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, w, h);
    // 16.7 ms and 33.3 ms guides
    ctx.strokeStyle = 'rgba(233,185,73,0.35)';
    for (const ms of [16.7, 33.3]) {
      const y = h - (ms / 50) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const n = snapshot.length;
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = snapshot[(idx + i) % n] ?? 0;
      const bh = Math.min(h, (v / 50) * h);
      ctx.fillStyle = v > 33.3 ? '#e0533d' : v > 16.7 ? '#e9b949' : '#5fbf7f';
      ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh);
    }
  }
}
