import { describe, expect, it } from 'vitest';
import { GameLoop } from '../../src/core/loop';

function makeLoop(step = 0.05) {
  const loop = new GameLoop({ fixedStep: step, requestFrame: () => 0, cancelFrame: () => undefined, now: () => 0 });
  let steps = 0;
  let lastAlpha = -1;
  loop.setTarget({ fixedUpdate: () => steps++, update: (_dt, a) => (lastAlpha = a) });
  return { loop, steps: () => steps, alpha: () => lastAlpha };
}

describe('GameLoop', () => {
  it('runs fixed steps proportional to time and scale', () => {
    const t = makeLoop(0.05);
    for (let i = 0; i < 60; i++) t.loop.advance(1 / 60);
    // +-1 step tolerance for floating-point accumulation at boundaries.
    expect(Math.abs(t.steps() - 20)).toBeLessThanOrEqual(1);
    t.loop.setTimeScale(4);
    for (let i = 0; i < 60; i++) t.loop.advance(1 / 60);
    expect(Math.abs(t.steps() - 100)).toBeLessThanOrEqual(1);
    expect(t.alpha()).toBeGreaterThanOrEqual(0);
    expect(t.alpha()).toBeLessThan(1);
  });

  it('clamps time scale to 0.5x..8x', () => {
    const t = makeLoop();
    t.loop.setTimeScale(100);
    expect(t.loop.timeScale).toBe(8);
    t.loop.setTimeScale(0.01);
    expect(t.loop.timeScale).toBe(0.5);
  });

  it('pauses the sim but keeps updating, and steps manually', () => {
    const t = makeLoop();
    t.loop.pause();
    for (let i = 0; i < 30; i++) t.loop.advance(1 / 30);
    expect(t.steps()).toBe(0);
    t.loop.stepNow(3);
    expect(t.steps()).toBe(3);
  });

  it('drops backlog instead of spiralling', () => {
    const loop = new GameLoop({ fixedStep: 0.01, maxStepsPerFrame: 5, requestFrame: () => 0, cancelFrame: () => undefined });
    let n = 0;
    loop.setTarget({ fixedUpdate: () => n++, update: () => undefined });
    loop.advance(1);
    expect(n).toBe(5);
    expect(loop.stats.droppedSec).toBeGreaterThan(0.9);
  });

  it('gives identical step counts regardless of frame pacing', () => {
    const a = makeLoop(0.05);
    const b = makeLoop(0.05);
    for (let i = 0; i < 120; i++) a.loop.advance(1 / 120);
    for (let i = 0; i < 30; i++) b.loop.advance(1 / 30);
    expect(Math.abs(a.steps() - b.steps())).toBeLessThanOrEqual(1);
  });
});
