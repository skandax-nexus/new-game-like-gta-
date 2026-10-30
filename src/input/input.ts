/**
 * Unified input: keyboard, mouse, touch and pen -> InputFrame (continuous) + InputActionEvents.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02). Bindings: ./bindings.ts (Classic / Grid
 * presets, chords, rebinding). Touch gestures: ./gestures.ts.
 *
 * Contexts: menu | world | battle | hero | lab (SceneManager sets them) + optional overlay mode ('placement' |
 * 'targeting', pushed by scenes) + the battle command-card page (setCardPage, by the battle HUD).
 *
 * PC (world / battle):  keys per preset; wheel zoom (cursor-anchored); middle-drag grab pan; world: left-drag pan,
 *   right-drag rotate + tilt; battle: left-drag box select, right-click context command, right-drag = context command
 *   with a box (facing + frontage drag); edge scroll; Ctrl+digit assigns a control group, digit selects, Shift+digit
 *   adds, a double press within 350 ms also emits camera_focus with `group` set (centre on the group).
 * PC (hero):  WASD move, mouse look while a button is held or the pointer is locked, LMB light attack, RMB heavy
 *   (hold to charge: heldFor / releasedFor), MMB / Tab lock-on, Q guard (hold; tap = parry), R salve, Space roll,
 *   E interact, hold Esc 0.8 s = skip cinematic. holdToToggle settings turn guard / run holds into toggles.
 * Touch (world / battle): tap select, double-tap focus, drag pan (battle: a drag that starts on the selection is a
 *   move order -> context_command with a box; touchDrag exposes it while dragging), pinch zoom, twist rotate,
 *   two-finger vertical drag tilt, long-press: world context command / battle radial wheel, two-finger tap pause.
 * Touch (hero): left 45% virtual stick (past 80% runs), right side drag look, flick = roll, tap = select (lock-on /
 *   prompt bubble).
 * HUD buttons share the path: injectAction(action), pressAction / releaseAction for holds (hero combat buttons).
 * Scenes call frame() once per update and react to frame.actions. UI elements stop propagation, so clicks on the
 * HUD never reach the canvas. CPU time spent in handlers + frame() is accumulated for the UI + input budget
 * (consumeCpuMs, reported by the UIManager as profiler counters).
 */
import type { GameSettings, InputAction, InputActionEvent, InputFrame, KeyPreset, PointerInfo, PointerKind } from '../core/types';
import type { GameBus } from '../core/events';
import { buildChordTable, chordFromEvent, heldKeysFor, resolveChord, type BindingMap, type HeldKeyMap, type InputContext, type InputMode } from './bindings';
import { GestureRecognizer, type Gesture, type SelectionHitTest } from './gestures';

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
const EDGE_PX = 14;
const GROUP_DOUBLE_MS = 350;
const SKIP_HOLD_MS = 800;
const STICK_RADIUS = 60;
/** Actions whose held state is tracked (isHeld / heldFor / releasedFor). */
const HOLDABLE: ReadonlySet<InputAction> = new Set<InputAction>(['hero_guard', 'hero_attack_heavy', 'hero_attack_light', 'hero_run', 'hero_skip_cinematic', 'hero_interact']);
const TOGGLE_HOLDS: Partial<Record<InputAction, 'guard' | 'run'>> = { hero_guard: 'guard', hero_run: 'run' };

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class InputManager {
  private context: InputContext = 'menu';
  private mode: InputMode | null = null;
  private page = 0;
  private presetOverride: KeyPreset | null = null;
  private chordTable = new Map<string, InputAction[]>();
  private held: HeldKeyMap;
  private readonly heldCodes = new Set<string>();
  private readonly pointers = new Map<number, TrackedPointer>();
  private readonly gestures = new GestureRecognizer();
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
  private stickRun = false;
  private hudStickX = 0;
  private hudStickY = 0;
  private stickPointer = -1;
  private lookPointer = -1;
  private shift = false;
  private ctrl = false;
  private lastGroup = { group: -1, t: 0 };
  /** action -> press time (ms) while held. */
  private readonly holdStart = new Map<InputAction, number>();
  /** action -> held seconds of holds released since the last frame() (pending) / during the current frame (visible). */
  private releasedPending = new Map<InputAction, number>();
  private releasedVisible = new Map<InputAction, number>();
  private readonly toggled = new Set<InputAction>();
  private escDownAt = -1;
  private skipFired = false;
  private cpuMs = 0;
  private touchDragBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
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
  private readonly onGesture: (g: Gesture) => void;

  constructor(
    private readonly target: HTMLElement,
    private readonly bus: GameBus,
    private settings: GameSettings,
  ) {
    this.held = heldKeysFor(settings.keyPreset);
    this.onGesture = (g) => this.handleGesture(g);
    this.setContext('menu');
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    // Block browser pinch-zoom / gestures (iOS Safari).
    document.addEventListener('gesturestart', this.onGestureStart);
    this.touchMode = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  // ------------------------------------------------------------------ configuration

  setSettings(s: GameSettings): void {
    this.settings = s;
    this.rebuild();
  }

  /** URL override of the key preset (?keypreset=), applied over settings.keyPreset. */
  setPresetOverride(preset: KeyPreset | null): void {
    this.presetOverride = preset;
    this.rebuild();
  }

  get preset(): KeyPreset {
    return this.presetOverride ?? this.settings.keyPreset ?? 'classic';
  }

  get keybindings(): BindingMap {
    return this.settings.keybindings;
  }

  setContext(ctx: InputContext): void {
    this.context = ctx;
    this.mode = null;
    this.page = 0;
    this.rebuild();
    this.actions = [];
    this.holdStart.clear();
    this.toggled.clear();
    this.gestures.reset();
    this.touchDragBox = null;
  }

  getContext(): InputContext {
    return this.context;
  }

  /** Overlay mode: 'placement' (R rotates, Esc = cancel, R no longer tilts) or 'targeting' (Esc = cancel); null clears. */
  setMode(mode: InputMode | null): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.rebuild();
  }

  getMode(): InputMode | null {
    return this.mode;
  }

  /** Battle command-card page (0 = orders + shapes; > 0 = slot pages such as intents). Set by the battle HUD. */
  setCardPage(page: number): void {
    if (this.page === page) return;
    this.page = page;
    this.rebuild();
  }

  get cardPage(): number {
    return this.page;
  }

  /** Battle: answers whether a touch starts on the selected formations (a drag then issues a move). */
  setSelectionHitTest(fn: SelectionHitTest | null): void {
    this.gestures.hitSelection = fn;
  }

  /** Touch drag of a move order in progress (CSS px from the canvas origin), for the order preview. */
  get touchDrag(): { x0: number; y0: number; x1: number; y1: number } | null {
    return this.touchDragBox;
  }

  private rebuild(): void {
    this.chordTable = buildChordTable(this.preset, { context: this.context, page: this.page, mode: this.mode }, this.settings.keybindings);
    this.held = heldKeysFor(this.preset);
  }

  /** Virtual joystick input from the touch HUD (hero mode), -1..1. */
  setVirtualStick(x: number, y: number): void {
    this.hudStickX = x;
    this.hudStickY = y;
  }

  /** Inject an action from the UI (command card, radial wheel, touch buttons) as if it came from input. */
  injectAction(action: InputAction, extra: Partial<InputActionEvent> = {}): void {
    this.push(action, extra.pointer ?? null, extra);
  }

  /** HUD hold buttons (hero ATTACK / HEAVY / GUARD): press... */
  pressAction(action: InputAction): void {
    this.beginHold(action, true);
  }

  /** ...and release (records the held time for releasedFor). */
  releaseAction(action: InputAction): void {
    this.endHold(action, true);
  }

  /** Held right now (keys, mouse buttons, HUD buttons or a hold-to-toggle latch). */
  isHeld(action: InputAction): boolean {
    return this.holdStart.has(action) || this.toggled.has(action);
  }

  /** Seconds the action has been held (0 if not held). */
  heldFor(action: InputAction): number {
    const t = this.holdStart.get(action);
    return t === undefined ? 0 : (now() - t) / 1000;
  }

  /** Seconds the action was held when it was released since the previous frame(), else -1 (hold-to-charge). */
  releasedFor(action: InputAction): number {
    return this.releasedVisible.get(action) ?? -1;
  }

  /** CPU ms spent in input handlers and frame() since the last call. */
  consumeCpuMs(): number {
    const v = this.cpuMs;
    this.cpuMs = 0;
    return v;
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

  private beginHold(action: InputAction, emit: boolean): void {
    const toggle = TOGGLE_HOLDS[action];
    if (toggle && this.settings.holdToToggle?.[toggle]) {
      if (this.toggled.has(action)) this.toggled.delete(action);
      else this.toggled.add(action);
      if (emit) this.push(action, this.hover);
      return;
    }
    if (HOLDABLE.has(action) && !this.holdStart.has(action)) this.holdStart.set(action, now());
    if (emit) this.push(action, this.hover);
  }

  private endHold(action: InputAction, _fromHud: boolean): void {
    const t = this.holdStart.get(action);
    if (t === undefined) return;
    this.holdStart.delete(action);
    this.releasedPending.set(action, (now() - t) / 1000);
  }

  // ------------------------------------------------------------------ keyboard
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    const t0 = now();
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey || e.metaKey;
    const chord = chordFromEvent(e);
    const inGame = this.context !== 'menu' && this.context !== 'lab';
    if (['F1', 'F2', 'F3', 'F4', 'F5', 'F9', 'F12', 'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.code)) e.preventDefault();
    if (inGame && (chord.alt || (chord.ctrl && /^(Digit\d|KeyA)$/.test(e.code)))) e.preventDefault();
    if (e.repeat) {
      this.cpuMs += now() - t0;
      return;
    }
    this.heldCodes.add(e.code);
    this.touchMode = false;
    if (e.code === 'Escape') {
      this.escDownAt = now();
      this.skipFired = false;
    }
    // Control groups: digits (select) / Ctrl+digit (assign) / Shift+digit (add); hero: dialogue choices.
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit && (this.context === 'battle' || this.context === 'world') && !chord.alt) {
      const g = Number(digit[1]);
      if (this.ctrl) this.push('group_assign', this.hover, { group: g });
      else {
        this.push('group_select', this.hover, { group: g, shift: this.shift });
        const tNow = now();
        if (!this.shift && this.lastGroup.group === g && tNow - this.lastGroup.t < GROUP_DOUBLE_MS) {
          this.push('camera_focus', null, { group: g });
          this.lastGroup.group = -1;
        } else this.lastGroup = { group: g, t: tNow };
      }
      this.cpuMs += now() - t0;
      return;
    }
    for (const a of resolveChord(this.chordTable, chord)) {
      if (HOLDABLE.has(a) || TOGGLE_HOLDS[a]) this.beginHold(a, true);
      else this.push(a, this.hover, { shift: this.shift });
    }
    this.cpuMs += now() - t0;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.heldCodes.delete(e.code);
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'Escape') this.escDownAt = -1;
    // Release holds bound to this key (any modifier state).
    for (const a of resolveChord(this.chordTable, { code: e.code, ctrl: false, shift: false, alt: false })) this.endHold(a, false);
  };

  private readonly onBlur = (): void => {
    this.heldCodes.clear();
    this.pointers.clear();
    this.gestures.reset();
    for (const a of [...this.holdStart.keys()]) this.endHold(a, false);
    this.stickPointer = -1;
    this.stickX = this.stickY = 0;
    this.escDownAt = -1;
  };

  private readonly onContextMenu = (e: Event): void => e.preventDefault();
  private readonly onGestureStart = (e: Event): void => e.preventDefault();

  private isHeldKey(codes: readonly string[]): boolean {
    for (const c of codes) if (this.heldCodes.has(c)) return true;
    return false;
  }

  // ------------------------------------------------------------------ pointer
  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const t0 = now();
    this.target.focus?.({ preventScroll: true });
    const kind = (e.pointerType || 'mouse') as PointerKind;
    this.touchMode = kind === 'touch';
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey || e.metaKey;
    const tp: TrackedPointer = { id: e.pointerId, kind, button: e.button, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, startTime: t0, moved: false };
    this.pointers.set(e.pointerId, tp);
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      // ignore (synthetic events / detached targets)
    }
    if (kind === 'touch') {
      const r = this.target.getBoundingClientRect();
      if (this.context === 'hero') {
        if (e.clientX - r.left < r.width * 0.45 && this.stickPointer < 0) this.stickPointer = e.pointerId;
        else if (this.lookPointer < 0) this.lookPointer = e.pointerId;
      } else if (this.context !== 'menu') {
        this.gestures.down(e.pointerId, e.clientX - r.left, e.clientY - r.top, t0);
      }
    } else if (this.context === 'hero') {
      const locked = typeof document !== 'undefined' && document.pointerLockElement === this.target;
      if (e.button === 2) this.beginHold('hero_attack_heavy', true);
      else if (e.button === 1) this.push('hero_lock_on', this.pointerInfo(tp, kind, 1));
      else if (e.button === 0 && locked) this.beginHold('hero_attack_light', true);
    }
    e.preventDefault();
    this.cpuMs += now() - t0;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const t0 = now();
    const kind = (e.pointerType || 'mouse') as PointerKind;
    if (kind === 'mouse') this.hover = this.pointerInfo({ x: e.clientX, y: e.clientY }, 'mouse', -1);
    if (!this.enabled) return;
    if (kind === 'mouse' && this.context === 'hero' && typeof document !== 'undefined' && document.pointerLockElement === this.target) {
      this.lookX += e.movementX;
      this.lookY += e.movementY;
      this.cpuMs += now() - t0;
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.startX, p.y - p.startY) > DRAG_THRESHOLD) p.moved = true;
    if (kind === 'touch') {
      if (this.context === 'hero') {
        if (e.pointerId === this.stickPointer) {
          const sx = (p.x - p.startX) / STICK_RADIUS;
          const sy = -(p.y - p.startY) / STICK_RADIUS;
          const len = Math.hypot(sx, sy);
          const k = len > 1 ? 1 / len : 1;
          this.stickX = sx * k;
          this.stickY = sy * k;
          this.stickRun = len > 0.8;
        } else {
          this.lookX += dx * 1.5;
          this.lookY += dy * 1.5;
        }
      } else if (this.context !== 'menu') {
        const r = this.target.getBoundingClientRect();
        this.gestures.move(e.pointerId, e.clientX - r.left, e.clientY - r.top, t0);
        this.flushGestures();
      }
      this.cpuMs += now() - t0;
      return;
    }
    if (!p.moved) {
      this.cpuMs += now() - t0;
      return;
    }
    // Mouse / pen
    if (this.context === 'hero') {
      this.lookX += dx;
      this.lookY += dy;
    } else if (p.button === 1 || (p.button === 0 && this.context === 'world')) {
      this.dragX += dx;
      this.dragY += dy;
    } else if (p.button === 2 && this.context === 'world') {
      this.rotate -= dx * 0.006;
      this.tilt += dy * 0.004;
    }
    this.cpuMs += now() - t0;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const t0 = now();
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const cancelled = e.type === 'pointercancel';
    if (p.kind === 'touch') {
      if (this.context === 'hero') {
        if (e.pointerId === this.stickPointer) {
          this.stickPointer = -1;
          this.stickX = this.stickY = 0;
          this.stickRun = false;
        } else if (e.pointerId === this.lookPointer) {
          this.lookPointer = -1;
          if (!cancelled && this.enabled) {
            const dt = t0 - p.startTime;
            const dist = Math.hypot(p.x - p.startX, p.y - p.startY);
            if (!p.moved) this.push('select', this.pointerInfo(p, 'touch', 0));
            else if (dt < 260 && dist > 60) this.push('hero_roll', this.pointerInfo(p, 'touch', 0));
          }
        }
      } else if (this.context !== 'menu') {
        const r = this.target.getBoundingClientRect();
        if (cancelled) this.gestures.cancel(e.pointerId);
        else this.gestures.up(e.pointerId, e.clientX - r.left, e.clientY - r.top, t0);
        if (this.enabled) this.flushGestures();
        else this.gestures.drain();
      }
      this.cpuMs += now() - t0;
      return;
    }
    if (this.context === 'hero') {
      if (p.button === 2) this.endHold('hero_attack_heavy', false);
      else if (p.button === 0) {
        if (this.holdStart.has('hero_attack_light')) this.endHold('hero_attack_light', false);
        else if (!p.moved && !cancelled && this.enabled) this.push('hero_attack_light', this.pointerInfo(p, p.kind, 0));
      }
      this.cpuMs += now() - t0;
      return;
    }
    if (!this.enabled || cancelled) return;
    const info = this.pointerInfo(p, p.kind, p.button);
    const r = this.target.getBoundingClientRect();
    const box = { x0: p.startX - r.left, y0: p.startY - r.top, x1: p.x - r.left, y1: p.y - r.top };
    if (!p.moved) {
      if (p.button === 2) this.push('context_command', info, { box: null });
      else if (p.button === 0) {
        this.push(this.shift ? 'select_add' : 'select', info);
        if (t0 - this.lastClick.t < 300 && Math.hypot(info.x - this.lastClick.x, info.y - this.lastClick.y) < 12) {
          this.push('camera_focus', info);
          this.lastClick.t = 0;
        } else this.lastClick = { t: t0, x: info.x, y: info.y };
      }
    } else if (this.context === 'battle') {
      if (p.button === 0) this.push('box_select', info, { box });
      else if (p.button === 2) this.push('context_command', info, { box });
    }
    this.cpuMs += now() - t0;
  };

  private lastClick = { t: 0, x: 0, y: 0 };

  private flushGestures(): void {
    const list = this.gestures.drain();
    for (let i = 0; i < list.length; i++) this.onGesture(list[i]!);
  }

  /** Map a recognized touch gesture to frame deltas / actions (world and battle contexts). */
  private handleGesture(g: Gesture): void {
    const r = this.target.getBoundingClientRect();
    const info = (x: number, y: number): PointerInfo => this.pointerInfo({ x: x + r.left, y: y + r.top }, 'touch', 0);
    switch (g.kind) {
      case 'tap':
        this.push('select', info(g.x, g.y));
        break;
      case 'double_tap':
        this.push('camera_focus', info(g.x, g.y));
        break;
      case 'long_press':
        // Battle: the radial command wheel (UI-02). World: the context command (march / move) at the point.
        this.push(this.context === 'battle' ? 'radial_menu' : 'context_command', info(g.x, g.y));
        break;
      case 'pan':
        this.dragX += g.dx;
        this.dragY += g.dy;
        break;
      case 'drag_move':
        this.touchDragBox = g.phase === 'end' ? null : { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 };
        if (g.phase === 'end') this.push('context_command', info(g.x1, g.y1), { box: { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 } });
        break;
      case 'pinch': {
        this.zoom += g.scale * 4;
        const p = info(g.cx, g.cy);
        this.zoomAnchor = { ndcX: p.ndcX, ndcY: p.ndcY };
        break;
      }
      case 'twist':
        this.rotate -= g.angle;
        break;
      case 'tilt':
        this.tilt += g.dy * 0.004;
        break;
      case 'two_finger_tap':
        this.push('pause', null);
        break;
      case 'swipe':
        break;
    }
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.zoom += (this.settings.invertZoom ? d : -d) / 120;
    const info = this.pointerInfo({ x: e.clientX, y: e.clientY }, 'mouse', -1);
    this.zoomAnchor = { ndcX: info.ndcX, ndcY: info.ndcY };
  };

  /** Snapshot continuous input + actions since the previous call, then reset deltas. */
  frame(): InputFrame {
    const t0 = now();
    const f = this.frameObj;
    const k = this.held;
    const hero = this.context === 'hero';
    if (this.context !== 'menu' && !hero && this.enabled) {
      this.gestures.update(t0);
      this.flushGestures();
    }
    // Hold Esc in hero mode = skip the cinematic (once per hold).
    if (hero && this.escDownAt >= 0 && !this.skipFired && t0 - this.escDownAt >= SKIP_HOLD_MS) {
      this.skipFired = true;
      this.push('hero_skip_cinematic', null);
    }
    let panX = 0;
    let panY = 0;
    if (!hero && this.context !== 'menu') {
      panX = (this.isHeldKey(k.panRight) ? 1 : 0) - (this.isHeldKey(k.panLeft) ? 1 : 0);
      panY = (this.isHeldKey(k.panUp) ? 1 : 0) - (this.isHeldKey(k.panDown) ? 1 : 0);
      if (this.settings.edgeScroll && this.hover && !this.touchMode && this.pointers.size === 0 && this.hasFocus()) {
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
    const keyRot = hero ? 0 : (this.isHeldKey(k.rotateRight) ? 1 : 0) - (this.isHeldKey(k.rotateLeft) ? 1 : 0);
    f.rotate = this.rotate + keyRot * 0.03;
    const tiltKeys = hero || this.mode === 'placement' ? 0 : (this.isHeldKey(k.tiltUp) ? 1 : 0) - (this.isHeldKey(k.tiltDown) ? 1 : 0);
    f.tilt = this.tilt + tiltKeys * 0.02;
    f.zoom = this.zoom + ((this.isHeldKey(k.zoomIn) ? 1 : 0) - (this.isHeldKey(k.zoomOut) ? 1 : 0)) * 0.15;
    f.zoomAnchor = this.zoomAnchor;
    if (hero) {
      const mx = (this.isHeldKey(k.moveRight) ? 1 : 0) - (this.isHeldKey(k.moveLeft) ? 1 : 0) + this.stickX + this.hudStickX;
      const my = (this.isHeldKey(k.moveUp) ? 1 : 0) - (this.isHeldKey(k.moveDown) ? 1 : 0) + this.stickY + this.hudStickY;
      f.moveX = Math.max(-1, Math.min(1, mx));
      f.moveY = Math.max(-1, Math.min(1, my));
    } else {
      f.moveX = 0;
      f.moveY = 0;
    }
    f.lookX = this.lookX;
    f.lookY = this.lookY;
    if (hero) {
      const latched = this.settings.holdToToggle?.run ? this.toggled.has('hero_run') : this.holdStart.has('hero_run') || this.isHeldKey(k.run);
      f.run = latched || this.stickRun;
    } else f.run = this.isHeldKey(k.run);
    f.pointer = this.hover;
    f.actions = this.actions;
    f.touchMode = this.touchMode;
    this.actions = [];
    const vis = this.releasedVisible;
    vis.clear();
    this.releasedVisible = this.releasedPending;
    this.releasedPending = vis;
    this.dragX = this.dragY = this.rotate = this.tilt = this.zoom = this.lookX = this.lookY = 0;
    this.zoomAnchor = null;
    this.cpuMs += now() - t0;
    return f;
  }

  private hasFocus(): boolean {
    return typeof document === 'undefined' || typeof document.hasFocus !== 'function' || document.hasFocus();
  }

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.target.removeEventListener('wheel', this.onWheel);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('gesturestart', this.onGestureStart);
    this.gestures.reset();
  }
}

export type { InputContext, InputMode } from './bindings';
