import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { placeSem } from '../layout/sem.js';
import { DEFAULT_GLOBAL_STYLE } from '../render/styles.js';
import {
  clearSession,
  LEGACY_KEY,
  listSlots,
  loadSession,
  readSession,
  restoreSession,
  sameSaveState,
  saveSession,
  slotKey,
  toSession,
} from './autosave.js';
import { memoryStorage } from './autosaveFakes.js';

const text = readFileSync(join(resolve(__dirname, '../../../dgm'), 'syn_sem.dgm'), 'utf8');
const layout = placeSem(buildGraph(parseDgm(text)), 120, 56);
const slice = {
  positions: { fa: { x: 10, y: 20, width: 120, height: 56 } },
  edgeStyles: { 'BY:fa->a1': { stroke: '#ff0000' } },
  nodeStyles: {},
  global: { ...DEFAULT_GLOBAL_STYLE, decimals: 2 },
  pValues: { 'BY:fa->a1': { unstd: 0.01, stdyx: 0.02 } },
  residualSides: { a1: 'left' as const },
  curveSides: {},
};
const session = () => toSession('syn_sem.dgm', text, 'sem', layout, slice, new Date('2026-11-03T10:00:00Z'));

const KEY = slotKey('tab-a');

describe('autosave', () => {
  it('saves a session and loads the same one back', () => {
    const storage = memoryStorage();
    expect(saveSession(storage, KEY, session())).toBe(true);
    expect(loadSession(storage, KEY)).toEqual(session());
  });

  it('restores the graph from the saved text, with the saved layout, positions, styles and p-values', () => {
    const r = restoreSession(session(), 'sem');
    expect(r.graph.nodes.map((n) => n.id).sort()).toEqual(buildGraph(parseDgm(text)).nodes.map((n) => n.id).sort());
    expect(r.layout).toEqual(layout);
    expect(r.slice).toEqual(slice);
  });

  it('drops a saved layout that no longer fits the graph, so the model is laid out again', () => {
    const withNodes = (nodes: unknown[]) => {
      const s = session();
      s.layout = { ...s.layout, nodes: nodes as typeof layout.nodes };
      return restoreSession(s, 'sem').layout;
    };
    const [first, ...rest] = layout.nodes;
    expect(withNodes(rest)).toBeNull(); // a node missing (ids changed)
    expect(withNodes([{ ...first, id: 'renamed' }, ...rest])).toBeNull();
    expect(withNodes([null, ...rest])).toBeNull();
    expect(withNodes([{ ...first, x: Number.NaN }, ...rest])).toBeNull();
    expect(withNodes([first, first, ...rest])).toBeNull(); // a node twice
    const s = session();
    s.layout = { ...s.layout, edges: [...s.layout.edges, { id: 'ON:gone->away' }] };
    expect(restoreSession(s, 'sem').layout).toBeNull();
  });

  it('lays out again, without the saved boxes, a diagram saved with another engine (ELK, dropped)', () => {
    const r = restoreSession({ ...session(), engine: 'elk-layered' }, 'sem');
    expect(r.layout).toBeNull();
    expect(r.slice.positions).toBeUndefined();
    expect(r.slice.residualSides).toEqual({}); // its residual sides went with its boxes
    expect(r.slice.edgeStyles).toEqual(slice.edgeStyles); // styles still come back
  });

  it('fills global style fields added since the save with their defaults', () => {
    const old = session();
    const { decimals } = old.slice.global;
    old.slice = { ...old.slice, global: { decimals } as typeof old.slice.global };
    expect(restoreSession(old, 'sem').slice.global).toEqual({ ...DEFAULT_GLOBAL_STYLE, decimals: 2 });
  });

  it('reads nothing from missing, malformed or other-version data', () => {
    expect(readSession(null)).toBeNull();
    expect(readSession('{not json')).toBeNull();
    expect(readSession(JSON.stringify({ ...session(), version: 2 }))).toBeNull();
    expect(readSession(JSON.stringify({ ...session(), dgmText: undefined }))).toBeNull();
    expect(readSession(JSON.stringify({ ...session(), tabId: 7 }))).toBeNull();
  });

  it('lists the per-tab slots and the legacy shared one, newest first, skipping unreadable ones', () => {
    const at = (iso: string, tabId?: string) => toSession('m.dgm', text, 'sem', layout, slice, new Date(iso), tabId);
    const storage = memoryStorage({ unrelated: 'x', [slotKey('broken')]: '{not json' });
    saveSession(storage, slotKey('a'), at('2026-11-03T10:00:00Z', 'a'));
    saveSession(storage, LEGACY_KEY, at('2026-11-02T10:00:00Z'));
    saveSession(storage, slotKey('b'), at('2026-11-03T12:00:00Z', 'b'));
    expect(listSlots(storage).map((s) => [s.key, s.tabId])).toEqual([
      [slotKey('b'), 'b'],
      [slotKey('a'), 'a'],
      [LEGACY_KEY, null],
    ]);
  });

  it('reads the writing tab id, and still reads a session saved before tabs had ids', () => {
    const withTab = toSession('syn_sem.dgm', text, 'sem', layout, slice, new Date('2026-11-03T10:00:00Z'), 'tab-a');
    expect(readSession(JSON.stringify(withTab))?.tabId).toBe('tab-a');
    const old = readSession(JSON.stringify(session()));
    expect(old).not.toBeNull();
    expect(old?.tabId).toBeUndefined();
  });

  it('reports a refused save (storage full) and clears the older diagram left in the slot', () => {
    const storage = memoryStorage();
    saveSession(storage, KEY, session());
    const full = {
      ...storage,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(saveSession(full, KEY, { ...session(), fileName: 'other.dgm' })).toBe(false);
    expect(loadSession(storage, KEY)).toBeNull();
  });

  it('treats a save as unchanged only when the file, engine, layout and undoable slice are all the same', () => {
    const file = { fileName: 'syn_sem.dgm' };
    const base = { file, engine: 'sem', layout, slice };
    expect(sameSaveState(base, { ...base, slice: { ...slice } })).toBe(true);
    expect(sameSaveState(base, { ...base, file: { ...file } })).toBe(false); // the same file loaded again
    expect(sameSaveState(base, { ...base, engine: 'another-engine' })).toBe(false);
    expect(sameSaveState(base, { ...base, layout: { ...layout } })).toBe(false);
    expect(sameSaveState(base, { ...base, slice: { ...slice, positions: {} } })).toBe(false);
  });

  it('clears one slot and leaves the others', () => {
    const storage = memoryStorage();
    saveSession(storage, KEY, session());
    saveSession(storage, slotKey('tab-b'), session());
    clearSession(storage, KEY);
    expect(loadSession(storage, KEY)).toBeNull();
    expect(loadSession(storage, slotKey('tab-b'))).not.toBeNull();
  });
});
