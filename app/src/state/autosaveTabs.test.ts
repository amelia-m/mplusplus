import { describe, it, expect } from 'vitest';
import { claimTabId, isTabOpen, ownsSlot, TAB_ID_KEY, type TabLocks } from './autosaveTabs.js';

/**
 * In-memory Web Locks with the rules used here: a lock is held until its
 * callback's promise settles, `ifAvailable` gets `null` for a held lock,
 * and `query` lists the held ones. `close(name)` stands in for the holding
 * tab closing. All tabs of one browser share one instance.
 */
function fakeBrowser() {
  const held = new Set<string>();
  const locks: TabLocks = {
    request(name, _options, callback) {
      if (held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      void callback({ name });
      return Promise.resolve();
    },
    query: () => Promise.resolve({ held: [...held].map((name) => ({ name })) }),
  };
  return { locks, close: (id: string) => held.delete(`mplusplus.tab.${id}`) };
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

  it('gives a duplicated tab, which inherits the original tab id, a new id', async () => {
    const { locks } = fakeBrowser();
    const original = await claimTabId(locks, tabStorage(), ids());
    const copy = await claimTabId(locks, tabStorage(original), () => 'fresh');
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
