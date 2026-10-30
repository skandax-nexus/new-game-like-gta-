/**
 * Touch gesture recognition from synthetic pointer sequences (DESIGN_SPEC §8.8 touch). OWNER: UI Engineer - In-game
 * HUD, Command Card, Minimap & Input (UI-02).
 */
import { describe, expect, it } from 'vitest';
import { GestureRecognizer, type Gesture } from '../../src/input/gestures';

function kinds(g: Gesture[]): string[] {
  return g.map((x) => x.kind);
}

/** Move a finger in n steps (t advances 16 ms per step). */
function drag(r: GestureRecognizer, id: number, x0: number, y0: number, x1: number, y1: number, t0: number, n = 8): number {
  let t = t0;
  for (let i = 1; i <= n; i++) {
    t += 16;
    r.move(id, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, t);
  }
  return t;
}

describe('one finger', () => {
  it('tap', () => {
    const r = new GestureRecognizer();
    r.down(1, 100, 100, 0);
    r.up(1, 102, 101, 80);
    expect(r.drain()).toEqual([{ kind: 'tap', x: 102, y: 101 }]);
  });

  it('double tap = tap, tap + double_tap (focus)', () => {
    const r = new GestureRecognizer();
    r.down(1, 100, 100, 0);
    r.up(1, 100, 100, 60);
    r.down(1, 104, 98, 200);
    r.up(1, 104, 98, 250);
    expect(kinds(r.drain())).toEqual(['tap', 'tap', 'double_tap']);
  });

  it('two taps too far apart in time are not a double tap', () => {
    const r = new GestureRecognizer();
    r.down(1, 100, 100, 0);
    r.up(1, 100, 100, 60);
    r.down(1, 100, 100, 600);
    r.up(1, 100, 100, 650);
    expect(kinds(r.drain())).toEqual(['tap', 'tap']);
  });

  it('long press opens the radial wheel and suppresses the tap', () => {
    const r = new GestureRecognizer();
    r.down(1, 200, 300, 0);
    r.update(300);
    expect(r.drain()).toEqual([]);
    r.update(530);
    expect(r.drain()).toEqual([{ kind: 'long_press', x: 200, y: 300 }]);
    r.up(1, 200, 300, 900);
    expect(r.drain()).toEqual([]);
  });

  it('drag on empty ground pans by the full finger travel', () => {
    const r = new GestureRecognizer();
    r.down(1, 100, 100, 0);
    const t = drag(r, 1, 100, 100, 180, 140, 0);
    r.up(1, 180, 140, t + 200);
    const g = r.drain();
    expect(g.every((x) => x.kind === 'pan')).toBe(true);
    let dx = 0;
    let dy = 0;
    for (const x of g) if (x.kind === 'pan') ((dx += x.dx), (dy += x.dy));
    expect(dx).toBeCloseTo(80, 5);
    expect(dy).toBeCloseTo(40, 5);
  });

  it('a drag that starts on the selection is a move order (start / move / end), not a pan', () => {
    const r = new GestureRecognizer();
    r.hitSelection = (x, y) => Math.hypot(x - 100, y - 100) < 30;
    r.down(1, 100, 100, 0);
    const t = drag(r, 1, 100, 100, 300, 120, 0);
    r.up(1, 300, 120, t + 100);
    const g = r.drain();
    expect(g[0]).toMatchObject({ kind: 'drag_move', phase: 'start', x0: 100, y0: 100 });
    expect(g[g.length - 1]).toEqual({ kind: 'drag_move', x0: 100, y0: 100, x1: 300, y1: 120, phase: 'end' });
    expect(g.some((x) => x.kind === 'pan')).toBe(false);
  });

  it('a fast flick is a swipe (hero roll)', () => {
    const r = new GestureRecognizer();
    r.down(1, 100, 300, 0);
    r.move(1, 140, 300, 40);
    r.move(1, 200, 300, 80);
    r.up(1, 220, 300, 100);
    expect(kinds(r.drain()).filter((k) => k !== 'pan')).toEqual(['swipe']);
  });
});

describe('two fingers', () => {
  it('pinch out zooms in by log(d1 / d0) around the centre', () => {
    const r = new GestureRecognizer();
    r.down(1, 200, 300, 0);
    r.down(2, 300, 300, 5);
    let t = 5;
    for (let i = 1; i <= 10; i++) {
      t += 16;
      r.move(1, 200 - i * 5, 300, t);
      r.move(2, 300 + i * 5, 300, t);
    }
    r.up(1, 150, 300, t + 20);
    r.up(2, 350, 300, t + 25);
    const g = r.drain();
    let s = 0;
    for (const x of g) if (x.kind === 'pinch') s += x.scale;
    expect(s).toBeCloseTo(Math.log(200 / 100), 3);
    expect(g.some((x) => x.kind === 'tap' || x.kind === 'two_finger_tap')).toBe(false);
  });

  it('twist rotates (beyond a small dead zone)', () => {
    const r = new GestureRecognizer();
    r.down(1, 200, 300, 0);
    r.down(2, 300, 300, 0);
    let t = 0;
    const total = 0.6;
    for (let i = 1; i <= 12; i++) {
      t += 16;
      const a = (total * i) / 12;
      r.move(1, 250 - 50 * Math.cos(a), 300 - 50 * Math.sin(a), t);
      r.move(2, 250 + 50 * Math.cos(a), 300 + 50 * Math.sin(a), t);
    }
    let rot = 0;
    for (const x of r.drain()) if (x.kind === 'twist') rot += x.angle;
    expect(rot).toBeGreaterThan(total - 0.12);
    expect(rot).toBeLessThan(total + 0.01);
  });

  it('two fingers moving down together tilt the camera', () => {
    const r = new GestureRecognizer();
    r.down(1, 200, 300, 0);
    r.down(2, 300, 300, 0);
    let t = 0;
    for (let i = 1; i <= 10; i++) {
      t += 16;
      r.move(1, 200, 300 + i * 6, t);
      r.move(2, 300, 300 + i * 6, t);
    }
    const g = r.drain();
    let dy = 0;
    for (const x of g) if (x.kind === 'tilt') dy += x.dy;
    expect(dy).toBeCloseTo(60, 0);
    expect(g.some((x) => x.kind === 'pinch' || x.kind === 'twist')).toBe(false);
  });

  it('two-finger tap pauses', () => {
    const r = new GestureRecognizer();
    r.down(1, 200, 300, 0);
    r.down(2, 260, 300, 10);
    r.up(1, 200, 300, 120);
    r.up(2, 260, 300, 130);
    expect(kinds(r.drain())).toEqual(['two_finger_tap']);
  });

  it('a second finger ends a move drag (end emitted) and starts a pinch', () => {
    const r = new GestureRecognizer();
    r.hitSelection = () => true;
    r.down(1, 100, 100, 0);
    drag(r, 1, 100, 100, 160, 100, 0, 4);
    r.down(2, 300, 100, 100);
    const g = r.drain();
    expect(g[g.length - 1]).toMatchObject({ kind: 'drag_move', phase: 'end' });
  });
});
