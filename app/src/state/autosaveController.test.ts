import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { placeSem } from '../layout/sem.js';
import { DEFAULT_GLOBAL_STYLE } from '../render/styles.js';
import { LEGACY_KEY, listSlots, loadSession, saveSession, slotKey, toSession, type SaveState } from './autosave.js';
import { AutosaveController, DISCARDED_KEY, MAX_SLOTS, type AutosaveDeps } from './autosaveController.js';
import { TAB_ID_KEY } from './autosaveTabs.js';
import { fakeBrowser, ids, memoryStorage } from './autosaveFakes.js';

const text = readFileSync(join(resolve(__dirname, '../../../dgm'), 'syn_path.dgm'), 'utf8');
const layout = placeSem(buildGraph(parseDgm(text)), 120, 56);
const slice = { positions: {}, edgeStyles: {}, nodeStyles: {}, global: DEFAULT_GLOBAL_STYLE, pValues: {} };
const state = (file = {}): SaveState => ({ file, engine: 'sem', layout, slice });
const input = (fileName: string, s = state()) => ({ fileName, dgmText: text, state: s });

/** One browser: shared localStorage and locks; each tab gets its own sessionStorage. */
function browser() {
  const storage = memoryStorage();
  const { locks, close } = fakeBrowser();
  const nextId = ids();
  let clock = Date.parse('2026-11-03T10:00:00Z');
  const tab = (tabStore = memoryStorage()) => {
    const deps: AutosaveDeps = {
      storage,
      locks,
      tabStore,
      newId: nextId,
      now: () => new Date((clock += 1000)),
    };
    return { controller: new AutosaveController(deps), tabStore };
  };
  return { storage, locks, close, tab };
}

describe('AutosaveController', () => {
  it('saves to its own slot and gets it back after a reload', async () => {
    const b = browser();
    const { controller, tabStore } = b.tab();
    expect(await controller.start()).toBeNull();
    expect(controller.save(input('a.dgm'))).toBe('saved');
    b.close(controller.id!); // reload: the old page goes, the new one keeps the tab's sessionStorage
    const reloaded = b.tab(tabStore).controller;
    expect((await reloaded.start())?.fileName).toBe('a.dgm');
    expect(reloaded.id).toBe(controller.id);
  });

  it('keeps two open tabs apart: neither overwrites nor restores the other', async () => {
    const b = browser();
    const one = b.tab();
    const two = b.tab();
    await one.controller.start();
    expect(await two.controller.start()).toBeNull(); // one's slot is empty anyway
    one.controller.save(input('one.dgm'));
    two.controller.save(input('two.dgm'));
    expect(loadSession(b.storage, slotKey(one.controller.id!))?.fileName).toBe('one.dgm');
    expect(loadSession(b.storage, slotKey(two.controller.id!))?.fileName).toBe('two.dgm');
    const three = b.tab();
    expect(await three.controller.start()).toBeNull(); // both are open
    b.close(one.controller.id!);
    b.close(two.controller.id!);
    b.close(three.controller.id!);
    // Reloading the first tab still brings back its own diagram, whatever the others saved.
    expect((await b.tab(one.tabStore).controller.start())?.fileName).toBe('one.dgm');
  });

  it("gives a new tab a copy of the most recent closed tab's diagram, and keeps the original for that tab", async () => {
    const b = browser();
    const old = b.tab();
    await old.controller.start();
    old.controller.save(input('older.dgm'));
    const recent = b.tab();
    await recent.controller.start();
    recent.controller.save(input('recent.dgm'));
    b.close(old.controller.id!);
    b.close(recent.controller.id!);

    const fresh = b.tab();
    const restored = await fresh.controller.start();
    expect(restored?.fileName).toBe('recent.dgm');
    expect(restored?.tabId).toBe(fresh.controller.id);
    expect(loadSession(b.storage, slotKey(fresh.controller.id!))?.fileName).toBe('recent.dgm');
    // The closed tab may only have been unloaded by the browser: revisited,
    // it reloads with its id and gets its own slot back.
    expect((await b.tab(recent.tabStore).controller.start())?.fileName).toBe('recent.dgm');
  });

  it('restores a session from the shared slot of the first autosave builds', async () => {
    const b = browser();
    saveSession(b.storage, LEGACY_KEY, toSession('legacy.dgm', text, 'sem', layout, slice, new Date('2026-11-01T00:00:00Z')));
    b.storage.setItem(`${LEGACY_KEY}.tab`, 'stale');
    const { controller } = b.tab();
    expect((await controller.start())?.fileName).toBe('legacy.dgm');
    expect(b.storage.getItem(LEGACY_KEY)).toBeNull();
    expect(b.storage.getItem(`${LEGACY_KEY}.tab`)).toBeNull();
  });

  it('skips a save when nothing changed since the last save or the restore', async () => {
    const b = browser();
    const { controller } = b.tab();
    await controller.start();
    const s = state();
    expect(controller.save(input('a.dgm', s))).toBe('saved');
    expect(controller.save(input('a.dgm', { ...s }))).toBe('unchanged');
    controller.markSaved(state()); // a restore of another file
    expect(controller.save(input('a.dgm', s))).toBe('saved');
  });

  it('saves nothing before start has claimed the tab id', () => {
    expect(browser().tab().controller.save(input('a.dgm'))).toBe('not-started');
  });

  it("after Discard, clears its slot and restores nothing on the next start, not even another closed tab's", async () => {
    const b = browser();
    const others = [b.tab(), b.tab()];
    for (const t of others) await t.controller.start(); // both open, so neither takes the other's slot
    others[0].controller.save(input('older.dgm'));
    others[1].controller.save(input('other.dgm'));
    for (const t of others) b.close(t.controller.id!);
    const { controller, tabStore } = b.tab();
    expect((await controller.start())?.fileName).toBe('other.dgm');
    controller.discard();
    expect(loadSession(b.storage, slotKey(controller.id!))).toBeNull();
    expect(tabStore.getItem(DISCARDED_KEY)).not.toBeNull();
    b.close(controller.id!);
    expect(await b.tab(tabStore).controller.start()).toBeNull();
    expect(tabStore.getItem(DISCARDED_KEY)).toBeNull(); // only the one reload
    expect(listSlots(b.storage).map((s) => s.session.fileName)).toEqual(['older.dgm']);
  });

  it(`keeps the ${MAX_SLOTS} most recent closed tabs' slots and every open tab's`, async () => {
    const b = browser();
    const tabs = [];
    for (let i = 0; i < MAX_SLOTS + 2; i++) {
      const t = b.tab();
      await t.controller.start();
      t.controller.save(input(`m${i}.dgm`));
      tabs.push(t);
    }
    const stillOpen = tabs[0]; // the oldest save, but its tab is open
    for (const t of tabs.slice(1)) b.close(t.controller.id!);
    // A reload of the open tab triggers the tidy-up without taking over a slot.
    b.close(stillOpen.controller.id!);
    await b.tab(stillOpen.tabStore).controller.start();
    const names = listSlots(b.storage).map((s) => s.session.fileName).sort();
    expect(names).toEqual(['m0.dgm', 'm2.dgm', 'm3.dgm', 'm4.dgm', 'm5.dgm', 'm6.dgm']);
  });

  it("makes room when storage is full by deleting closed tabs' slots, oldest first, never an open tab's", async () => {
    const b = browser();
    const closedOld = b.tab();
    await closedOld.controller.start();
    closedOld.controller.save(input('closed-old.dgm'));
    const closedNew = b.tab();
    await closedNew.controller.start();
    closedNew.controller.save(input('closed-new.dgm'));
    const open = b.tab();
    await open.controller.start();
    open.controller.save(input('open.dgm'));
    b.close(closedOld.controller.id!);
    b.close(closedNew.controller.id!);
    const me = b.tab();
    await me.controller.start(); // takes over closed-new
    me.controller.save(input('mine.dgm'));
    // Storage now holds at most 3 slots.
    const realSet = b.storage.setItem;
    b.storage.setItem = (k, v) => {
      if (!b.storage.items.has(k) && b.storage.items.size >= 3) throw new Error('QuotaExceededError');
      realSet(k, v);
    };
    const another = b.tab();
    await another.controller.start(); // a new tab; closed-old is the only closed slot left
    expect(another.controller.save(input('another.dgm'))).toBe('saved');
    const names = listSlots(b.storage).map((s) => s.session.fileName).sort();
    expect(names).toContain('open.dgm');
    expect(names).toContain('another.dgm');
  });

  it("refuses a save rather than delete an open tab's slot to make room", async () => {
    const b = browser();
    const open = b.tab();
    await open.controller.start();
    open.controller.save(input('open.dgm'));
    const me = b.tab();
    await me.controller.start();
    b.storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(me.controller.save(input('mine.dgm'))).toBe('refused');
    expect(loadSession(b.storage, slotKey(open.controller.id!))?.fileName).toBe('open.dgm');
  });

  it('reports a refused save and clears its own slot when no closed slot can make room', async () => {
    const b = browser();
    const { controller } = b.tab();
    await controller.start();
    controller.save(input('a.dgm'));
    b.storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(controller.save(input('b.dgm'))).toBe('refused');
    expect(loadSession(b.storage, slotKey(controller.id!))).toBeNull();
  });

  it('keeps a duplicated tab apart from the original', async () => {
    const b = browser();
    const original = b.tab();
    await original.controller.start();
    original.controller.save(input('a.dgm'));
    const copyStore = memoryStorage({ [TAB_ID_KEY]: original.controller.id! });
    const copy = b.tab(copyStore).controller;
    expect(await copy.start()).toBeNull(); // the original is open, so its slot is not taken
    expect(copy.id).not.toBe(original.controller.id);
  });
});
