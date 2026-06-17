import { describe, it, expect } from 'vitest';
import { AbortRegistry } from './abortRegistry';

describe('AbortRegistry', () => {
  it('register returns an AbortSignal that fires on cancel', () => {
    const r = new AbortRegistry();
    const signal = r.register('run-1');
    let aborted = false;
    signal.addEventListener('abort', () => (aborted = true));
    expect(signal.aborted).toBe(false);
    r.cancel('run-1');
    expect(aborted).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it('complete removes a run without aborting', () => {
    const r = new AbortRegistry();
    const signal = r.register('run-2');
    r.complete('run-2');
    expect(signal.aborted).toBe(false);
    expect(r.cancel('run-2')).toBe(false);
  });

  it('cancel returns false for unknown ids', () => {
    const r = new AbortRegistry();
    expect(r.cancel('ghost')).toBe(false);
  });

  it('cancelAll aborts everything and returns the count', () => {
    const r = new AbortRegistry();
    const s1 = r.register('a');
    const s2 = r.register('b');
    const count = r.cancelAll();
    expect(count).toBe(2);
    expect(s1.aborted).toBe(true);
    expect(s2.aborted).toBe(true);
    expect(r.active()).toEqual([]);
  });

  it('active and hasActive track the registry state', () => {
    const r = new AbortRegistry();
    expect(r.hasActive()).toBe(false);
    r.register('x');
    expect(r.hasActive()).toBe(true);
    expect(r.active()).toEqual(['x']);
    r.complete('x');
    expect(r.hasActive()).toBe(false);
  });
});
