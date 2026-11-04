import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { placeSem } from '../layout/sem.js';
import { DEFAULT_GLOBAL_STYLE } from '../render/styles.js';
import { LEGACY_KEY, listSlots, loadSession, saveSession, slotKey, toSession, type SaveState } from './autosave.js';
import { AutosaveController, MAX_SLOTS, type AutosaveDeps } from './autosaveController.js';
import { TAB_ID_KEY, type TabLocks } from './autosaveTabs.js';
import { fakeBrowser, ids, memoryStorage } from './autosaveFakes.js';

const text = readFileSync(join(resolve(__dirname, '../../../dgm'), 'syn_path.dgm'), 'utf8');
const layout = placeSem(buildGraph(parseDgm(text)), 120, 56);
const slice = { positions: {}, edgeStyles: {}, nodeStyles: {}, global: DEFAULT_GLOBAL_STYLE, pValues: {} };
const state = (file = {}): SaveState => ({ file, engine: 'sem', layout, slice });
const input = (fileName: string, s = state()) => ({ fileName, dgmText: text, state: s });

/** One browser: shared localStorage and locks; each tab gets its own sessionStorage. */
function browser(locksAvailable = true) {
  const storage = memoryStorage();
  const { locks, close } = fakeBrowser();
  const nextId = ids();
  let clock = Date.parse('2026-11-03T10:00:00Z');
  const tab = (tabStore = memoryStorage()) => {
    const deps: AutosaveDeps = {
      storage,
      locks: locksAvailable ? locks : undefined,
      tabStore,
      newId: nextId,
      now: () => new Date((clock += 1000)),
    };
    return { controller: new AutosaveController(deps), tabStore };
  };
  /** A tab that has started and saved `fileName`. */
  const saving = async (fileName: string) => {
    const t = tab();
    await t.controller.start();
    t.controller.save(input(fileName));
    return t;
  };
  return { storage, locks, close, tab, saving };
}

const names = (b: ReturnType<typeof browser>) => listSlots(b.storage).map((s) => s.session.fileName).sort();

describe('AutosaveController', () => {
  it('saves to its own slot and restores it after a reload', async () => {
    const b = browser();
    const a = await b.saving('a.dgm');
    b.close(a.controller.id!); // reload: the old page goes, the new one keeps the tab's sessionStorage
    const reloaded = b.tab(a.tabStore).controller;
    expect(await reloaded.start()).toEqual({ restore: expect.objectContaining({ fileName: 'a.dgm' }), offer: null });
    expect(reloaded.id).toBe(a.controller.id);
  });

  it('keeps two open tabs apart: each writes only its own slot and is offered nothing of the other', async () => {
    const b = browser();
    const one = await b.saving('one.dgm');
    const two = b.tab();
    expect(await two.controller.start()).toEqual({ restore: null, offer: null }); // one is open
    two.controller.save(input('two.dgm'));
    expect(loadSession(b.storage, slotKey(one.controller.id!))?.fileName).toBe('one.dgm');
    expect(loadSession(b.storage, slotKey(two.controller.id!))?.fileName).toBe('two.dgm');
  });

  it("offers a new tab the most recent closed tab's diagram, and writes nothing until it is edited", async () => {
    const b = browser();
    const old = await b.saving('older.dgm');
    const recent = await b.saving('recent.dgm');
    b.close(old.controller.id!);
    b.close(recent.controller.id!);

    const fresh = b.tab();
    const { restore, offer } = await fresh.controller.start();
    expect(restore).toBeNull();
    expect(offer?.fileName).toBe('recent.dgm');
    // Opened: the diagram is recorded as saved, so an unchanged save writes nothing.
    const opened = state();
    fresh.controller.markSaved(opened);
    expect(fresh.controller.save(input('recent.dgm', opened))).toBe('unchanged');
    expect(loadSession(b.storage, slotKey(fresh.controller.id!))).toBeNull();
    expect(names(b)).toEqual(['older.dgm', 'recent.dgm']);
    // Edited: now it is this tab's, and the original is untouched.
    expect(fresh.controller.save(input('recent.dgm', state()))).toBe('saved');
    expect(loadSession(b.storage, slotKey(recent.controller.id!))?.fileName).toBe('recent.dgm');
    // The closed tab, if it was only unloaded, gets its own back.
    expect((await b.tab(recent.tabStore).controller.start()).restore?.fileName).toBe('recent.dgm');
  });

  it('offers, never restores, after its own slot is gone', async () => {
    const b = browser();
    const other = await b.saving('other.dgm');
    b.close(other.controller.id!);
    const me = await b.saving('mine.dgm');
    me.controller.discard();
    b.close(me.controller.id!);
    expect(await b.tab(me.tabStore).controller.start()).toEqual({
      restore: null,
      offer: expect.objectContaining({ fileName: 'other.dgm' }),
    });
  });

  it('offers a session from the shared slot of the first autosave builds, and deletes their stray keys', async () => {
    const b = browser();
    saveSession(b.storage, LEGACY_KEY, toSession('legacy.dgm', text, 'sem', layout, slice, new Date('2026-11-01T00:00:00Z')));
    b.storage.setItem(`${LEGACY_KEY}.tab`, 'stale');
    b.storage.setItem('mplusplus.autosave.discarded', '1');
    const { offer } = await b.tab().controller.start();
    expect(offer?.fileName).toBe('legacy.dgm');
    expect(b.storage.getItem(`${LEGACY_KEY}.tab`)).toBeNull();
    expect(b.storage.getItem('mplusplus.autosave.discarded')).toBeNull();
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

  it('after stop (a failed restore), keeps the saved diagram and writes nothing over it', async () => {
    const b = browser();
    const a = await b.saving('a.dgm');
    a.controller.stop();
    expect(a.controller.save(input('half-restored.dgm'))).toBe('not-started');
    expect(loadSession(b.storage, slotKey(a.controller.id!))?.fileName).toBe('a.dgm');
  });

  it('Discard deletes only its own slot', async () => {
    const b = browser();
    const other = await b.saving('other.dgm');
    b.close(other.controller.id!);
    const me = await b.saving('mine.dgm');
    me.controller.discard();
    expect(names(b)).toEqual(['other.dgm']);
  });

  it(`keeps the ${MAX_SLOTS} most recent closed tabs' slots and every open tab's`, async () => {
    const b = browser();
    const tabs = [];
    for (let i = 0; i < MAX_SLOTS + 2; i++) tabs.push(await b.saving(`m${i}.dgm`));
    // tabs[0] has the oldest save, but its tab stays open.
    for (const t of tabs.slice(1)) b.close(t.controller.id!);
    await b.tab().controller.start();
    expect(names(b)).toEqual(['m0.dgm', 'm2.dgm', 'm3.dgm', 'm4.dgm', 'm5.dgm', 'm6.dgm']);
  });

  it("makes room when storage is full by deleting closed tabs' slots, oldest first, never an open tab's", async () => {
    const b = browser();
    const closedOld = await b.saving('closed-old.dgm');
    const closedNew = await b.saving('closed-new.dgm');
    await b.saving('open.dgm');
    b.close(closedOld.controller.id!);
    b.close(closedNew.controller.id!);
    const me = b.tab();
    await me.controller.start();
    // Storage holds at most 3 slots; deleting one is enough.
    const realSet = b.storage.setItem;
    b.storage.setItem = (k, v) => {
      if (!b.storage.items.has(k) && b.storage.items.size >= 3) throw new Error('QuotaExceededError');
      realSet(k, v);
    };
    const s = input('mine.dgm');
    expect(me.controller.save(s)).toBe('refused');
    expect(await me.controller.makeRoomAndSave(s)).toBe('saved');
    expect(names(b)).toEqual(['closed-new.dgm', 'mine.dgm', 'open.dgm']);
  });

  it("refuses a save rather than delete an open tab's slot to make room", async () => {
    const b = browser();
    const open = await b.saving('open.dgm');
    const me = b.tab();
    await me.controller.start();
    b.storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(me.controller.save(input('mine.dgm'))).toBe('refused');
    expect(await me.controller.makeRoomAndSave(input('mine.dgm'))).toBe('refused');
    expect(loadSession(b.storage, slotKey(open.controller.id!))?.fileName).toBe('open.dgm');
  });

  /** A browser with one closed tab's slot and a started tab `me` whose saves are refused until `lift()`. */
  async function fullBrowser() {
    const b = browser();
    const closed = await b.saving('closed.dgm');
    b.close(closed.controller.id!);
    const me = b.tab();
    await me.controller.start();
    const realSet = b.storage.setItem;
    let full = true;
    b.storage.setItem = (k, v) => {
      if (full) throw new Error('QuotaExceededError');
      realSet(k, v);
    };
    return { b, me, lift: () => (full = false) };
  }

  it('drops a make-room retry overtaken by a newer save, so stale work never lands over newer work', async () => {
    const { b, me, lift } = await fullBrowser();
    const older = input('older.dgm', state());
    expect(me.controller.save(older)).toBe('refused');
    const retry = me.controller.makeRoomAndSave(older);
    lift();
    expect(me.controller.save(input('newer.dgm', state()))).toBe('saved');
    expect(await retry).toBe('unchanged');
    expect(loadSession(b.storage, slotKey(me.controller.id!))?.fileName).toBe('newer.dgm');
    expect(names(b)).toContain('closed.dgm'); // nothing deleted for the stale retry
  });

  it('drops a make-room retry after Discard, so a discarded diagram does not come back', async () => {
    const { b, me, lift } = await fullBrowser();
    expect(me.controller.save(input('mine.dgm'))).toBe('refused');
    const retry = me.controller.makeRoomAndSave(input('mine.dgm'));
    me.controller.discard();
    lift();
    expect(await retry).toBe('unchanged');
    expect(loadSession(b.storage, slotKey(me.controller.id!))).toBeNull();
    expect(me.controller.save(input('again.dgm'))).toBe('not-started');
  });

  /** Make `b.storage` refuse a write that would take its total text length past `budget`. */
  const withBudget = (b: ReturnType<typeof browser>, budget: number) => {
    const realSet = b.storage.setItem;
    const used = (except: string) =>
      [...b.storage.items].reduce((n, [k, v]) => (k === except ? n : n + k.length + v.length), 0);
    b.storage.setItem = (k, v) => {
      if (used(k) + k.length + v.length > budget) throw new Error('QuotaExceededError');
      realSet(k, v);
    };
  };

  it('makes room with a closed slot smaller than the save, when the space already free covers the rest', async () => {
    const b = browser();
    const small = await b.saving('small.dgm'); // a small diagram in a closed tab
    b.storage.items.set(slotKey(small.controller.id!), JSON.stringify({ ...JSON.parse(b.storage.getItem(slotKey(small.controller.id!))!), dgmText: 'x' }));
    b.close(small.controller.id!);
    const me = b.tab();
    await me.controller.start();
    const big = input('big.dgm');
    const bigSize = JSON.stringify(big).length;
    // Room for the big save only once the small slot is gone, though that slot is far smaller than the save.
    withBudget(b, [...b.storage.items].reduce((n, [k, v]) => n + k.length + v.length, 0) + bigSize + 200 - 1000);
    expect(me.controller.save(big)).toBe('refused');
    expect(await me.controller.makeRoomAndSave(big)).toBe('saved');
    expect(names(b)).toEqual(['big.dgm']);
  });

  it('puts the closed slots back when even all of them do not make room', async () => {
    const b = browser();
    const closed = await b.saving('closed.dgm');
    b.close(closed.controller.id!);
    const me = b.tab();
    await me.controller.start();
    withBudget(b, [...b.storage.items].reduce((n, [k, v]) => n + k.length + v.length, 0) + 100);
    const huge = { ...input('huge.dgm'), dgmText: text.repeat(50) };
    expect(me.controller.save(huge)).toBe('refused');
    expect(await me.controller.makeRoomAndSave(huge)).toBe('refused');
    expect(names(b)).toEqual(['closed.dgm']);
  });

  it('after stop, saves a newly loaded diagram under a new id and keeps the slot that failed to restore', async () => {
    const b = browser();
    const a = await b.saving('broken.dgm');
    const oldId = a.controller.id!;
    a.controller.stop();
    await a.controller.startFresh();
    expect(a.controller.id).not.toBe(oldId);
    expect(a.controller.save(input('new.dgm'))).toBe('saved');
    expect(loadSession(b.storage, slotKey(oldId))?.fileName).toBe('broken.dgm');
    expect(loadSession(b.storage, slotKey(a.controller.id!))?.fileName).toBe('new.dgm');
    expect(a.tabStore.getItem(TAB_ID_KEY)).toBe(a.controller.id); // a reload keeps the new id
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
    expect(await controller.makeRoomAndSave(input('b.dgm'))).toBe('refused');
    expect(loadSession(b.storage, slotKey(controller.id!))).toBeNull();
  });

  it('deletes no other slot, for the cap or to make room, where the lock API is missing', async () => {
    const b = browser(false);
    for (let i = 0; i < MAX_SLOTS + 2; i++) await b.saving(`m${i}.dgm`); // no lock, so none can be told closed
    const me = b.tab();
    expect((await me.controller.start()).offer?.fileName).toBe('m6.dgm');
    expect(names(b)).toHaveLength(MAX_SLOTS + 2);
    b.storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(await me.controller.makeRoomAndSave(input('mine.dgm'))).toBe('refused');
    expect(names(b)).toHaveLength(MAX_SLOTS + 2);
  });

  it('deletes nothing where the lock API fails', async () => {
    const b = browser();
    const tabs = [];
    for (let i = 0; i < MAX_SLOTS + 2; i++) tabs.push(await b.saving(`m${i}.dgm`)); // all open while saving
    for (const t of tabs) b.close(t.controller.id!);
    const failing: TabLocks = {
      request: () => Promise.reject(new Error('SecurityError')),
      query: () => Promise.reject(new Error('SecurityError')),
    };
    const me = new AutosaveController({ storage: b.storage, locks: failing, tabStore: null, newId: () => 'me', now: () => new Date() });
    await me.start();
    expect(names(b)).toHaveLength(MAX_SLOTS + 2);
  });

  it('keeps a duplicated tab apart from the original', async () => {
    const b = browser();
    const original = await b.saving('a.dgm');
    const copy = b.tab(memoryStorage({ [TAB_ID_KEY]: original.controller.id! })).controller;
    expect(await copy.start()).toEqual({ restore: null, offer: null }); // the original is open
    expect(copy.id).not.toBe(original.controller.id);
  });
});
