/**
 * Touch gesture recognizer (DESIGN_SPEC §8.8 touch, §12.3; ARCHITECTURE §11). OWNER: UI Engineer - In-game HUD,
 * Command Card, Minimap & Input (UI-02). Pure and clock-injected (no DOM, no timers) so tests replay synthetic
 * pointer sequences: feed down / move / up / cancel with a time in ms, call update(now) for the long-press timer and
 * drain() the recognized gestures.
 *
 *   one finger:  tap, double_tap (2nd tap within 300 ms and 24 px), long_press (520 ms still -> no tap after),
 *                pan (drag on empty ground, px deltas), drag_move (drag that STARTS on the selection: a move order
 *                with start / end points; GP-04 previews it, ends with phase 'end'), swipe (fast flick)
 *   two fingers: pinch (log scale delta + centre), twist (radians), tilt (both fingers moving vertically together),
 *                two_finger_tap (both down and up within 260 ms without moving: pause)
 * The two-finger mode locks once a finger moves past the threshold: 'tilt' when the midpoint moves vertically
 * with little spread / angle change, else 'pinch' (zoom + twist together, like map apps).
 */

export interface GestureConfig {
  dragThresholdPx: number;
  longPressMs: number;
  doubleTapMs: number;
  doubleTapPx: number;
  twoFingerTapMs: number;
  /** Twist dead zone (radians) before rotation starts. */
  twistDeadZone: number;
  /** Swipe: minimum distance (px) and speed (px/ms) within swipeMaxMs. */
  swipeMinPx: number;
  swipeMinSpeed: number;
  swipeMaxMs: number;
}

export const DEFAULT_GESTURE_CONFIG: Readonly<GestureConfig> = Object.freeze({
  dragThresholdPx: 10,
  longPressMs: 520,
  doubleTapMs: 300,
  doubleTapPx: 28,
  twoFingerTapMs: 260,
  twistDeadZone: 0.06,
  swipeMinPx: 60,
  swipeMinSpeed: 0.7,
  swipeMaxMs: 260,
});

export type Gesture =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'double_tap'; x: number; y: number }
  | { kind: 'long_press'; x: number; y: number }
  | { kind: 'pan'; dx: number; dy: number; x: number; y: number }
  | { kind: 'drag_move'; x0: number; y0: number; x1: number; y1: number; phase: 'start' | 'move' | 'end' }
  | { kind: 'swipe'; dx: number; dy: number; x: number; y: number }
  | { kind: 'pinch'; scale: number; cx: number; cy: number }
  | { kind: 'twist'; angle: number; cx: number; cy: number }
  | { kind: 'tilt'; dy: number }
  | { kind: 'two_finger_tap'; x: number; y: number };

interface Finger {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  moved: boolean;
  /** Recent samples for swipe speed. */
  lastX: number;
  lastY: number;
  lastT: number;
}

/** Answers whether a touch at (x, y) starts on the current selection (drag = move order instead of pan). */
export type SelectionHitTest = (x: number, y: number) => boolean;

export class GestureRecognizer {
  private readonly cfg: GestureConfig;
  private readonly fingers = new Map<number, Finger>();
  private out: Gesture[] = [];
  private lastTap: { x: number; y: number; t: number } | null = null;
  private longPressFired = false;
  private dragOnSelection = false;
  private dragStarted = false;
  /** A second finger joined during this touch sequence: no tap / long press / swipe until all fingers lift. */
  private multi = false;
  private twoStart = 0;
  private twoMoved = false;
  private twoMode: 'none' | 'pinch' | 'tilt' = 'none';
  private pinchDist = 0;
  private pinchAngle = 0;
  private pinchMidY = 0;
  private twistAccum = 0;
  private twoX0 = 0;
  private twoY0 = 0;
  hitSelection: SelectionHitTest | null = null;

  constructor(cfg: Partial<GestureConfig> = {}) {
    this.cfg = { ...DEFAULT_GESTURE_CONFIG, ...cfg };
  }

  get activeCount(): number {
    return this.fingers.size;
  }

  /** True while a one-finger drag that started on the selection is in progress (move-order preview). */
  get draggingSelection(): boolean {
    return this.dragOnSelection && this.dragStarted;
  }

  down(id: number, x: number, y: number, t: number): void {
    const f: Finger = { id, x0: x, y0: y, x, y, t0: t, moved: false, lastX: x, lastY: y, lastT: t };
    this.fingers.set(id, f);
    if (this.fingers.size === 1) {
      this.multi = false;
      this.longPressFired = false;
      this.dragStarted = false;
      this.dragOnSelection = !!this.hitSelection?.(x, y);
    } else if (this.fingers.size === 2) {
      // A second finger: abandon any one-finger gesture and start a two-finger one.
      if (this.dragOnSelection && this.dragStarted) {
        const a = this.first();
        if (a) this.out.push({ kind: 'drag_move', x0: a.x0, y0: a.y0, x1: a.x, y1: a.y, phase: 'end' });
      }
      this.multi = true;
      this.dragOnSelection = false;
      this.dragStarted = false;
      this.twoStart = t;
      this.twoMoved = false;
      this.twoMode = 'none';
      this.twistAccum = 0;
      const [a, b] = this.pair();
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
      this.pinchMidY = (a.y + b.y) / 2;
      this.twoX0 = (a.x + b.x) / 2;
      this.twoY0 = this.pinchMidY;
    } else {
      this.multi = true;
    }
  }

  move(id: number, x: number, y: number, t: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    const dx = x - f.x;
    const dy = y - f.y;
    f.lastX = f.x;
    f.lastY = f.y;
    f.lastT = t;
    f.x = x;
    f.y = y;
    if (!f.moved && Math.hypot(x - f.x0, y - f.y0) > this.cfg.dragThresholdPx) f.moved = true;
    if (this.fingers.size >= 2) {
      if (f.moved) this.twoMoved = true;
      this.twoFinger();
      return;
    }
    if (this.multi || this.longPressFired || !f.moved) return;
    if (this.dragOnSelection) {
      this.out.push({ kind: 'drag_move', x0: f.x0, y0: f.y0, x1: x, y1: y, phase: this.dragStarted ? 'move' : 'start' });
      this.dragStarted = true;
      return;
    }
    if (!this.dragStarted) {
      // Include the distance travelled before the threshold so the map does not lag the finger.
      this.dragStarted = true;
      this.out.push({ kind: 'pan', dx: x - f.x0, dy: y - f.y0, x, y });
      return;
    }
    this.out.push({ kind: 'pan', dx, dy, x, y });
  }

  up(id: number, x: number, y: number, t: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    f.x = x;
    f.y = y;
    const count = this.fingers.size;
    this.fingers.delete(id);
    if (count >= 2) {
      // Two-finger tap: the sequence ends quickly with no movement.
      if (count === 2 && !this.twoMoved && t - this.twoStart <= this.cfg.twoFingerTapMs) this.out.push({ kind: 'two_finger_tap', x: this.twoX0, y: this.twoY0 });
      this.twoMoved = true; // the remaining finger's lift is not a tap either
      return;
    }
    if (this.multi) return;
    if (this.longPressFired) return;
    if (this.dragOnSelection && this.dragStarted) {
      this.out.push({ kind: 'drag_move', x0: f.x0, y0: f.y0, x1: x, y1: y, phase: 'end' });
      return;
    }
    if (f.moved) {
      const dt = Math.max(1, t - f.lastT);
      const total = t - f.t0;
      const dist = Math.hypot(x - f.x0, y - f.y0);
      const speed = Math.hypot(x - f.lastX, y - f.lastY) / dt;
      if (total <= this.cfg.swipeMaxMs && dist >= this.cfg.swipeMinPx && (speed >= this.cfg.swipeMinSpeed || dist / Math.max(1, total) >= this.cfg.swipeMinSpeed)) this.out.push({ kind: 'swipe', dx: x - f.x0, dy: y - f.y0, x, y });
      return;
    }
    this.out.push({ kind: 'tap', x, y });
    const lt = this.lastTap;
    if (lt && t - lt.t <= this.cfg.doubleTapMs && Math.hypot(x - lt.x, y - lt.y) <= this.cfg.doubleTapPx) {
      this.out.push({ kind: 'double_tap', x, y });
      this.lastTap = null;
    } else this.lastTap = { x, y, t };
  }

  cancel(id: number): void {
    this.fingers.delete(id);
    if (this.fingers.size === 0) {
      this.multi = false;
      this.dragStarted = false;
      this.dragOnSelection = false;
    }
  }

  /** Advance the clock: fires long_press once a single finger rested long enough. */
  update(t: number): void {
    if (this.fingers.size !== 1 || this.multi || this.longPressFired) return;
    const f = this.first();
    if (!f || f.moved) return;
    if (t - f.t0 >= this.cfg.longPressMs) {
      this.longPressFired = true;
      this.out.push({ kind: 'long_press', x: f.x, y: f.y });
    }
  }

  /** Recognized gestures since the last drain (oldest first). */
  drain(): Gesture[] {
    const g = this.out;
    this.out = [];
    return g;
  }

  reset(): void {
    this.fingers.clear();
    this.out = [];
    this.multi = false;
    this.dragStarted = false;
    this.dragOnSelection = false;
    this.lastTap = null;
  }

  private first(): Finger | undefined {
    for (const f of this.fingers.values()) return f;
    return undefined;
  }

  private pair(): [Finger, Finger] {
    const it = this.fingers.values();
    return [it.next().value as Finger, it.next().value as Finger];
  }

  private twoFinger(): void {
    if (this.fingers.size < 2) return;
    const [a, b] = this.pair();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (this.twoMode === 'none') {
      if (!this.twoMoved) return;
      const dDist = Math.abs(dist - this.pinchDist);
      let dAng = ang - this.pinchAngle;
      if (dAng > Math.PI) dAng -= Math.PI * 2;
      if (dAng < -Math.PI) dAng += Math.PI * 2;
      const dMid = midY - this.pinchMidY;
      const sameDir = (a.y - a.y0) * (b.y - b.y0) > 0;
      this.twoMode = sameDir && Math.abs(dMid) > dDist && Math.abs(dAng) < 0.12 ? 'tilt' : 'pinch';
      // Fall through and emit from the original reference so no movement is lost.
    }
    if (this.twoMode === 'tilt') {
      this.out.push({ kind: 'tilt', dy: midY - this.pinchMidY });
    } else {
      if (this.pinchDist > 1 && dist > 1) {
        const scale = Math.log(dist / this.pinchDist);
        if (scale !== 0) this.out.push({ kind: 'pinch', scale, cx: midX, cy: midY });
      }
      let da = ang - this.pinchAngle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      const before = this.twistAccum;
      this.twistAccum += da;
      if (Math.abs(this.twistAccum) > this.cfg.twistDeadZone) {
        // Emit only the part beyond the dead zone the first time it is crossed.
        const emit = Math.abs(before) > this.cfg.twistDeadZone ? da : this.twistAccum - Math.sign(this.twistAccum) * this.cfg.twistDeadZone;
        if (emit !== 0) this.out.push({ kind: 'twist', angle: emit, cx: midX, cy: midY });
      }
    }
    this.pinchDist = dist;
    this.pinchAngle = ang;
    this.pinchMidY = midY;
  }
}
