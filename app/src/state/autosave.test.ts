import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { placeSem } from '../layout/sem.js';
import { DEFAULT_GLOBAL_STYLE } from '../render/styles.js';
import {
  AUTOSAVE_KEY,
  clearSession,
  loadSession,
  readSession,
  restoreSession,
  saveSession,
  toSession,
  type SessionStorage,
} from './autosave.js';

const text = readFileSync(join(resolve(__dirname, '../../../dgm'), 'syn_sem.dgm'), 'utf8');
const layout = placeSem(buildGraph(parseDgm(text)), 120, 56);
const slice = {
  positions: { fa: { x: 10, y: 20, width: 120, height: 56 } },
  edgeStyles: { 'BY:fa->a1': { stroke: '#ff0000' } },
  nodeStyles: {},
  global: { ...DEFAULT_GLOBAL_STYLE, decimals: 2 },
  pValues: { 'BY:fa->a1': { unstd: 0.01, stdyx: 0.02 } },
};
const session = () => toSession('syn_sem.dgm', text, 'sem', layout, slice, new Date('2026-11-03T10:00:00Z'));

function memoryStorage(): SessionStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
}

describe('autosave', () => {
  it('saves a session and loads the same one back', () => {
    const storage = memoryStorage();
    expect(saveSession(storage, session())).toBe(true);
    expect(loadSession(storage)).toEqual(session());
  });

  it('restores the graph from the saved text, with the saved positions, styles and p-values', () => {
    const r = restoreSession(session());
    expect(r.graph.nodes.map((n) => n.id).sort()).toEqual(buildGraph(parseDgm(text)).nodes.map((n) => n.id).sort());
    expect(r.layout.nodes.length).toBe(layout.nodes.length);
    expect(r.slice).toEqual(slice);
  });

  it('fills global style fields added since the save with their defaults', () => {
    const old = session();
    const { decimals } = old.slice.global;
    old.slice = { ...old.slice, global: { decimals } as typeof old.slice.global };
    expect(restoreSession(old).slice.global).toEqual({ ...DEFAULT_GLOBAL_STYLE, decimals: 2 });
  });

  it('reads nothing from missing, malformed or other-version data', () => {
    expect(readSession(null)).toBeNull();
    expect(readSession('{not json')).toBeNull();
    expect(readSession(JSON.stringify({ ...session(), version: 2 }))).toBeNull();
    expect(readSession(JSON.stringify({ ...session(), dgmText: undefined }))).toBeNull();
  });

  it('reports a refused save (storage full) instead of throwing', () => {
    const full: SessionStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(saveSession(full, session())).toBe(false);
  });

  it('clears the slot on Discard', () => {
    const storage = memoryStorage();
    saveSession(storage, session());
    clearSession(storage);
    expect(storage.items.has(AUTOSAVE_KEY)).toBe(false);
    expect(loadSession(storage)).toBeNull();
  });
});
