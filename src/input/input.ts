/**
 * Unified input: keyboard, mouse, touch and pen -> InputFrame (continuous) + InputActionEvents.
 * OWNER: Lead UI/UX Engineer. Baseline by the CTO.
 *
 * Mapping (PC):  WASD/arrows pan, Q/E rotate, R/F tilt, wheel zoom (cursor-anchored), middle-drag or
 *   world left-drag = grab pan, right-drag = rotate (world) / facing drag (battle), left click select,
 *   left drag box select (battle), right click context command, edge scroll.
 * Mapping (touch): tap select, drag pan, pinch zoom, twist rotate, two-finger vertical drag tilt,
 *   long-press = context command / radial menu, double-tap = focus. Hero: left half virtual stick
 *   moves, right half drag looks.
 * Scenes call frame() once per update and react to frame.actions. UI elements stop propagation so
 * clicks on HUD never reach the canvas.
 */
import type { GameSettings, InputAction, InputActionEvent, InputFrame, PointerInfo, PointerKind } from '../core/types';
import type { GameBus } from '../core/events';
import { bindingsFor, HELD_KEYS, type BindingMap, type InputContext } from './bindings';

interface TrackedPointer {
  id: number;
  kind: PointerKind;
  button: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startTime: number;
  moved: boolean;
}

const DRAG_THRESHOLD = 8;
const LONG_PRESS_MS = 520;
const EDGE_PX = 14;

export class InputManager {
  private context: InputContext = 'menu';
  private bindings: BindingMap = {};
  private codeToActions = new Map<string, InputAction[]>();
  private readonly held = new Set<string>();
  private readonly pointers = new Map<number, TrackedPointer>();
  private hover: PointerInfo | null = null;
  private actions: InputActionEvent[] = [];
  private dragX = 0;
  private dragY = 0;
  private rotate = 0;
  private tilt = 0;
  private zoom = 0;
  private zoomAnchor: { ndcX: number; ndcY: number } | null = null;
  private lookX = 0;
  private lookY = 0;
  private stickX = 0;
  private stickY = 0;
  private stickPointer = -1;
  private pinchDist = 0;
  private pinchAngle = 0;
  private pinchMidY = 0;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTapTime = 0;
  private shift = false;
  private ctrl = false;
  touchMode = false;
  enabled = true;
  private readonly frameObj: InputFrame = {
    panX: 0,
    panY: 0,
    dragX: 0,
    dragY: 0,
    rotate: 0,
    tilt: 0,
    zoom: 0,
    zoomAnchor: null,
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    run: false,
    pointer: null,
    actions: [],
    touchMode: false,
  };

  constructor(
    private readonly target: HTMLElement,
    private readonly bus: GameBus,
    private settings: GameSettings,
  ) {
    this.setContext('menu');
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    // Block browser pinch-zoom / gestures (iOS Safari).
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    this.touchMode = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  setSettings(s: GameSettings): void {
    this.settings = s;
    this.setContext(this.context);
  }

  setContext(ctx: InputContext): void {
    this.context = ctx;
    this.bindings = bindingsFor(ctx, this.settings.keybindings);
    this.codeToActions.clear();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const code of codes ?? []) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action as InputAction);
        this.codeToActions.set(code, list);
      }
    }
    this.actions = [];
  }

  getContext(): InputContext {
    return this.context;
  }

  /** Virtual joystick input from the touch HUD (hero mode), -1..1. */
  setVirtualStick(x: number, y: number): void {
    this.stickX = x;
    this.stickY = y;
  }

  /** Inject an action from the UI (e.g. radial menu button) as if it came from input. */
  injectAction(action: InputAction, extra: Partial<InputActionEvent> = {}): void {
    this.push(action, extra.pointer ?? null, extra);
  }

  private pointerInfo(p: { x: number; y: number }, kind: PointerKind, button: number): PointerInfo {
    const r = this.target.getBoundingClientRect();
    const x = p.x - r.left;
    const y = p.y - r.top;
    return { x, y, ndcX: (x / Math.max(1, r.width)) * 2 - 1, ndcY: -(y / Math.max(1, r.height)) * 2 + 1, kind, button };
  }

  private push(action: InputAction, pointer: PointerInfo | null, extra: Partial<InputActionEvent> = {}): void {
    const ev: InputActionEvent = { action, pointer, box: extra.box ?? null, group: extra.group ?? null, shift: extra.shift ?? this.shift, ctrl: extra.ctrl ?? this.ctrl };
    this.actions.push(ev);
    this.bus.emit('input:action', ev);
  }

  // ------------------------------------------------------------------ keyboard
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey || e.metaKey;
    if (['F3', 'F5', 'F9', 'F12', 'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.held.add(e.code);
    this.touchMode = false;
    // Control groups: digits (select) / ctrl+digit (assign).
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit && (this.context === 'battle' || this.context === 'world')) {
      const g = Number(digit[1]);
      this.push(this.ctrl ? 'group_assign' : 'group_select', this.hover, { group: g });
      if (this.ctrl) e.preventDefault();
      return;
    }
    const acts = this.codeToActions.get(e.code);
    if (acts) for (const a of acts) this.push(a, this.hover);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey || e.metaKey;
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.pointers.clear();
  };

  private isHeld(codes: readonly string[]): boolean {
    for (const c of codes) if (this.held.has(c)) return true;
    return false;
  }

  // ------------------------------------------------------------------ pointer
  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.target.focus?.({ preventScroll: true });
    const kind = (e.pointerType || 'mouse') as PointerKind;
    this.touchMode = kind === 'touch';
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey || e.metaKey;
    const tp: TrackedPointer = { id: e.pointerId, kind, button: e.button, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, startTime: performance.now(), moved: false };
    this.pointers.set(e.pointerId, tp);
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (kind === 'touch') {
      const touches = [...this.pointers.values()].filter((p) => p.kind === 'touch');
      if (this.context === 'hero' && touches.length === 1) {
        const r = this.target.getBoundingClientRect();
        if (e.clientX - r.left < r.width * 0.45) this.stickPointer = e.pointerId;
      }
      if (touches.length === 2) {
        this.cancelLongPress();
        const [a, b] = touches as [TrackedPointer, TrackedPointer];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
        this.pinchMidY = (a.y + b.y) / 2;
        for (const t of touches) t.moved = true; // no tap after a pinch
      } else if (touches.length === 1 && this.context !== 'menu') {
        this.longPressTimer = setTimeout(() => {
          const p = this.pointers.get(e.pointerId);
          if (p && !p.moved) {
            p.moved = true;
            const info = this.pointerInfo(p, 'touch', 0);
            this.push('radial_menu', info);
            this.push('context_command', info);
          }
        }, LONG_PRESS_MS);
      }
    }
    e.preventDefault();
  };

  private cancelLongPress(): void {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const kind = (e.pointerType || 'mouse') as PointerKind;
    if (kind === 'mouse') this.hover = this.pointerInfo({ x: e.clientX, y: e.clientY }, 'mouse', -1);
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.startX, p.y - p.startY) > DRAG_THRESHOLD) {
      p.moved = true;
      this.cancelLongPress();
    }
    if (!p.moved) return;
    if (kind === 'touch') {
      const touches = [...this.pointers.values()].filter((t) => t.kind === 'touch');
      if (touches.length >= 2) {
        const [a, b] = touches as [TrackedPointer, TrackedPointer];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        if (this.pinchDist > 0) {
          this.zoom += Math.log(dist / this.pinchDist) * 4;
          const info = this.pointerInfo({ x: midX, y: midY }, 'touch', 0);
          this.zoomAnchor = { ndcX: info.ndcX, ndcY: info.ndcY };
          let da = ang - this.pinchAngle;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          this.rotate -= da;
          this.tilt += (midY - this.pinchMidY) * 0.004;
        }
        this.pinchDist = dist;
        this.pinchAngle = ang;
        this.pinchMidY = midY;
        return;
      }
      if (this.context === 'hero') {
        if (e.pointerId === this.stickPointer) {
          this.stickX = Math.max(-1, Math.min(1, (p.x - p.startX) / 60));
          this.stickY = Math.max(-1, Math.min(1, -(p.y - p.startY) / 60));
        } else {
          this.lookX += dx * 1.5;
          this.lookY += dy * 1.5;
        }
        return;
      }
      this.dragX += dx;
      this.dragY += dy;
      return;
    }
    // Mouse / pen
    if (this.context === 'hero') {
      this.lookX += dx;
      this.lookY += dy;
      return;
    }
    if (p.button === 1 || (p.button === 0 && this.context === 'world')) {
      this.dragX += dx;
      this.dragY += dy;
    } else if (p.button === 2 && this.context === 'world') {
      this.rotate -= dx * 0.006;
      this.tilt += dy * 0.004;
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = -1;
      this.stickX = 0;
      this.stickY = 0;
    }
    if (!this.enabled || e.type === 'pointercancel') return;
    const info = this.pointerInfo(p, p.kind, p.button);
    const r = this.target.getBoundingClientRect();
    const box = { x0: p.startX - r.left, y0: p.startY - r.top, x1: p.x - r.left, y1: p.y - r.top };
    if (this.pointers.size > 0 && p.kind === 'touch') return; // finishing a multi-touch gesture
    if (!p.moved) {
      if (p.button === 2) this.push('context_command', info, { box: null });
      else if (p.button === 0) {
        const now = performance.now();
        if (now - this.lastTapTime < 300) this.push('camera_focus', info);
        this.lastTapTime = now;
        this.push(this.shift ? 'select_add' : 'select', info);
      }
      return;
    }
    // Drags
    if (p.kind !== 'touch' && this.context === 'battle') {
      if (p.button === 0) this.push('box_select', info, { box });
      else if (p.button === 2) this.push('context_command', info, { box });
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.zoom += -d / 120;
    const info = this.pointerInfo({ x: e.clientX, y: e.clientY }, 'mouse', -1);
    this.zoomAnchor = { ndcX: info.ndcX, ndcY: info.ndcY };
  };

  /** Snapshot continuous input + actions since the previous call, then reset deltas. */
  frame(): InputFrame {
    const f = this.frameObj;
    const k = HELD_KEYS;
    const hero = this.context === 'hero';
    let panX = 0;
    let panY = 0;
    if (!hero && this.context !== 'menu') {
      panX = (this.isHeld(k.panRight) ? 1 : 0) - (this.isHeld(k.panLeft) ? 1 : 0);
      panY = (this.isHeld(k.panUp) ? 1 : 0) - (this.isHeld(k.panDown) ? 1 : 0);
      if (this.settings.edgeScroll && this.hover && !this.touchMode && this.pointers.size === 0) {
        const r = this.target.getBoundingClientRect();
        if (this.hover.x < EDGE_PX) panX = -1;
        else if (this.hover.x > r.width - EDGE_PX) panX = 1;
        if (this.hover.y < EDGE_PX) panY = 1;
        else if (this.hover.y > r.height - EDGE_PX) panY = -1;
      }
    }
    f.panX = panX;
    f.panY = panY;
    f.dragX = this.dragX;
    f.dragY = this.dragY;
    const keyRot = hero ? 0 : (this.isHeld(k.rotateRight) ? 1 : 0) - (this.isHeld(k.rotateLeft) ? 1 : 0);
    f.rotate = this.rotate + keyRot * 0.03;
    f.tilt = this.tilt + ((this.isHeld(k.tiltUp) ? 1 : 0) - (this.isHeld(k.tiltDown) ? 1 : 0)) * 0.02;
    f.zoom = this.zoom + ((this.isHeld(k.zoomIn) ? 1 : 0) - (this.isHeld(k.zoomOut) ? 1 : 0)) * 0.15;
    f.zoomAnchor = this.zoomAnchor;
    f.moveX = hero ? (this.isHeld(k.panRight) ? 1 : 0) - (this.isHeld(k.panLeft) ? 1 : 0) + this.stickX : 0;
    f.moveY = hero ? (this.isHeld(k.panUp) ? 1 : 0) - (this.isHeld(k.panDown) ? 1 : 0) + this.stickY : 0;
    f.lookX = this.lookX;
    f.lookY = this.lookY;
    f.run = this.isHeld(k.run);
    f.pointer = this.hover;
    f.actions = this.actions;
    f.touchMode = this.touchMode;
    this.actions = [];
    this.dragX = this.dragY = this.rotate = this.tilt = this.zoom = this.lookX = this.lookY = 0;
    this.zoomAnchor = null;
    return f;
  }

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.target.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.cancelLongPress();
  }
}
