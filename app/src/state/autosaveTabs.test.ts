import { describe, it, expect } from 'vitest';
import { claimTabId, openTabIds, TAB_ID_KEY, type TabLocks } from './autosaveTabs.js';
import { fakeBrowser, ids, memoryStorage } from './autosaveFakes.js';

const tabStorage = (kept?: string) => memoryStorage(kept ? { [TAB_ID_KEY]: kept } : {});

describe('autosave tab ids', () => {
  it('keeps a tab id across a reload, and lists the tab as open while it holds it', async () => {
    const { locks, close } = fakeBrowser();
    const store = tabStorage();
    const first = await claimTabId(locks, store, ids());
    expect(await openTabIds(locks)).toEqual(new Set([first]));
    close(first); // the reload releases the old page's lock
    expect(await openTabIds(locks)).toEqual(new Set());
    expect(await claimTabId(locks, store, () => 'other')).toBe(first);
    expect(await openTabIds(locks)).toEqual(new Set([first]));
  });

  it('keeps the id of a reloaded tab whose old page releases its lock a moment late', async () => {
    const { locks, close } = fakeBrowser();
    const store = tabStorage();
    const first = await claimTabId(locks, store, ids());
    const reloaded = claimTabId(locks, store, () => 'fresh', 1000);
    setTimeout(() => close(first), 20);
    expect(await reloaded).toBe(first);
  });

  it('gives a duplicated tab, which inherits the original tab id, a new id', async () => {
    const { locks } = fakeBrowser();
    const original = await claimTabId(locks, tabStorage(), ids());
    const copy = await claimTabId(locks, tabStorage(original), () => 'fresh', 30);
    expect(copy).toBe('fresh');
    expect(await openTabIds(locks)).toEqual(new Set([original, 'fresh']));
  });

  it('sees no tab as open where the lock API is missing or fails', async () => {
    expect(await claimTabId(undefined, tabStorage('kept'), ids())).toBe('kept');
    expect(await openTabIds(undefined)).toEqual(new Set());
    const failing: TabLocks = {
      request: () => Promise.reject(new Error('SecurityError')),
      query: () => Promise.reject(new Error('SecurityError')),
    };
    expect(await claimTabId(failing, tabStorage('kept'), ids())).toBe('kept');
    expect(await openTabIds(failing)).toEqual(new Set());
  });
});
