import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/events';

interface M {
  a: { n: number };
  b: string;
}

describe('EventBus', () => {
  it('delivers, unsubscribes and supports once', () => {
    const bus = new EventBus<M>();
    const got: number[] = [];
    const off = bus.on('a', (p) => got.push(p.n));
    bus.once('a', (p) => got.push(p.n * 10));
    bus.emit('a', { n: 1 });
    bus.emit('a', { n: 2 });
    off();
    bus.emit('a', { n: 3 });
    expect(got).toEqual([1, 10, 2]);
  });

  it('isolates throwing handlers when an error hook is set', () => {
    const bus = new EventBus<M>();
    const hook = vi.fn();
    bus.onHandlerError = hook;
    const ok = vi.fn();
    bus.on('b', () => {
      throw new Error('boom');
    });
    bus.on('b', ok);
    bus.emit('b', 'x');
    expect(hook).toHaveBeenCalledOnce();
    expect(ok).toHaveBeenCalledWith('x');
  });

  it('scopes subscriptions', () => {
    const bus = new EventBus<M>();
    const s = bus.scope();
    const fn = vi.fn();
    s.on('a', fn);
    expect(bus.listenerCount('a')).toBe(1);
    s.dispose();
    bus.emit('a', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
    expect(bus.listenerCount('a')).toBe(0);
  });

  it('allows unsubscribing during emit without skipping others', () => {
    const bus = new EventBus<M>();
    const calls: string[] = [];
    const off1 = bus.on('b', () => {
      calls.push('1');
      off1();
    });
    bus.on('b', () => calls.push('2'));
    bus.emit('b', '');
    bus.emit('b', '');
    expect(calls).toEqual(['1', '2', '2']);
  });
});
