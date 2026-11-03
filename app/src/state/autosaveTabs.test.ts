import { describe, it, expect } from 'vitest';
import { claimTabId, isTabOpen, mayWriteOnPagehide, ownsSlot, TAB_ID_KEY, type TabLocks } from './autosaveTabs.js';

/**
 * In-memory Web Locks with the rules used here: a lock is held until its
 * holder goes, `ifAvailable` gets `null` for a held lock, a request with a
 * `signal` waits for the lock and rejects when the signal aborts, and
 * `query` lists the held locks. `close(id)` stands in for the tab holding
 * that id's lock closing (or its old page going on a reload). All tabs of
 * one browser share one instance.
 */
function fakeBrowser() {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const grant = (name: string, callback: (lock: unknown) => unknown) => {
    held.add(name);
    void callback({ name });
  };
  const locks: TabLocks = {
    request(name, options, callback) {
      if (!held.has(name)) {
        grant(name, callback);
        return Promise.resolve();
      }
      if (options.ifAvailable || !options.signal) return Promise.resolve(callback(null));
      const signal = options.signal;
      return new Promise((resolve, reject) => {
        const queue = waiting.get(name) ?? [];
        const go = () => {
          grant(name, callback);
          resolve(undefined);
        };
        queue.push(go);
        waiting.set(name, queue);
        signal.addEventListener('abort', () => {
          queue.splice(queue.indexOf(go), 1);
          reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
        });
      });
    },
    query: () => Promise.resolve({ held: [...held].map((name) => ({ name })) }),
  };
  const close = (id: string) => {
    const name = `mplusplus.tab.${id}`;
    held.delete(name);
    waiting.get(name)?.shift()?.();
  };
  return { locks, close };
}

function tabStorage(initial?: string) {
  const items = new Map<string, string>(initial ? [[TAB_ID_KEY, initial]] : []);
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
}

function ids() {
  let n = 0;
  return () => `t${++n}`;
}

describe('autosave tabs', () => {
  it('lets a tab write and restore the slot only when it wrote it, nobody did, or the writer has closed', () => {
    expect(ownsSlot(undefined, 'a', false)).toBe(true);
    expect(ownsSlot('a', 'a', true)).toBe(true); // a reloaded tab gets its own diagram back
    expect(ownsSlot('b', 'a', true)).toBe(false); // another open tab wrote it
    expect(ownsSlot('b', 'a', false)).toBe(true); // that tab has closed
  });

  it('writes on unload only a slot this tab wrote or nobody did, since it cannot ask whether the writer is open', () => {
    expect(mayWriteOnPagehide(undefined, 'a')).toBe(true);
    expect(mayWriteOnPagehide('a', 'a')).toBe(true);
    expect(mayWriteOnPagehide('b', 'a')).toBe(false);
  });

  it('keeps a tab id across a reload, and sees the tab as open while it holds it', async () => {
    const { locks, close } = fakeBrowser();
    const store = tabStorage();
    const first = await claimTabId(locks, store, ids());
    expect(await isTabOpen(locks, first)).toBe(true);
    close(first); // the reload releases the old page's lock
    expect(await isTabOpen(locks, first)).toBe(false);
    expect(await claimTabId(locks, store, () => 'other')).toBe(first);
    expect(await isTabOpen(locks, first)).toBe(true);
  });

  it('keeps the id of a reloaded tab whose old page releases its lock a moment late', async () => {
    const { locks, close } = fakeBrowser();
    const store = tabStorage();
    const first = await claimTabId(locks, store, ids());
    const reloaded = claimTabId(locks, store, () => 'fresh', 1000);
    setTimeout(() => close(first), 20);
    expect(await reloaded).toBe(first);
    expect(await isTabOpen(locks, first)).toBe(true);
  });

  it('gives a duplicated tab, which inherits the original tab id, a new id', async () => {
    const { locks } = fakeBrowser();
    const original = await claimTabId(locks, tabStorage(), ids());
    const copy = await claimTabId(locks, tabStorage(original), () => 'fresh', 30);
    expect(copy).toBe('fresh');
    expect(await isTabOpen(locks, original)).toBe(true);
    expect(await isTabOpen(locks, copy)).toBe(true);
  });

  it('treats every other tab as closed where the lock API is missing or fails, so the last writer wins', async () => {
    expect(await claimTabId(undefined, tabStorage('kept'), ids())).toBe('kept');
    expect(await isTabOpen(undefined, 'kept')).toBe(false);
    const failing: TabLocks = {
      request: () => Promise.reject(new Error('SecurityError')),
      query: () => Promise.reject(new Error('SecurityError')),
    };
    expect(await claimTabId(failing, tabStorage('kept'), ids())).toBe('kept');
    expect(await isTabOpen(failing, 'kept')).toBe(false);
  });
});
