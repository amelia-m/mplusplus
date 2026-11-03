import { describe, it, expect } from 'vitest';
import { claimAutosave, type AutosaveLocks } from './autosaveLock.js';

/**
 * An in-memory exclusive lock manager with the Web Locks semantics used
 * here: a held lock is released when its callback's promise settles, the
 * next waiting request then gets it, and `ifAvailable` gets `null` instead
 * of waiting. `releaseHolder` stands in for the owning tab closing.
 */
function fakeLocks() {
  let held = false;
  let releaseHolder: () => void = () => {};
  const waiting: Array<() => void> = [];
  const grant = (cb: (lock: unknown) => unknown) => {
    held = true;
    const done = () => {
      held = false;
      waiting.shift()?.();
    };
    releaseHolder = done;
    void Promise.resolve(cb({ name: 'lock' })).then(done);
  };
  const locks: AutosaveLocks = {
    request(_name: string, a: unknown, b?: unknown): Promise<unknown> {
      const cb = (typeof a === 'function' ? a : b) as (lock: unknown) => unknown;
      const ifAvailable = typeof a === 'object' && a !== null && (a as { ifAvailable?: boolean }).ifAvailable;
      if (!held) grant(cb);
      else if (ifAvailable) void cb(null);
      else waiting.push(() => grant(cb));
      return Promise.resolve();
    },
  };
  return { locks, closeOwner: () => releaseHolder() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('claimAutosave', () => {
  it('lets the first tab own autosave at once', async () => {
    const { locks } = fakeLocks();
    const events: string[] = [];
    claimAutosave(locks, () => events.push('own'), () => events.push('wait'));
    await tick();
    expect(events).toEqual(['own']);
  });

  it('makes a second tab wait, then take over when the first tab closes', async () => {
    const { locks, closeOwner } = fakeLocks();
    const first: string[] = [];
    const second: string[] = [];
    claimAutosave(locks, () => first.push('own'), () => first.push('wait'));
    await tick();
    claimAutosave(locks, () => second.push('own'), () => second.push('wait'));
    await tick();
    expect(first).toEqual(['own']);
    expect(second).toEqual(['wait']);
    closeOwner();
    await tick();
    expect(second).toEqual(['wait', 'own']);
  });

  it('autosaves in every tab where the browser has no lock API', () => {
    const events: string[] = [];
    claimAutosave(undefined, () => events.push('own'), () => events.push('wait'));
    expect(events).toEqual(['own']);
  });
});
