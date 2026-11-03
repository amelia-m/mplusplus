/**
 * Autosave: the open diagram is kept in the browser's storage so a reload
 * does not lose it (Amelia, 2026-11-03: restore automatically, with a
 * Discard button; one slot for now). A session holds the `.dgm` text, the
 * layout engine, the layout and the undoable slice; restoring parses the
 * text again, so a session never stores the parsed graph. Everything here
 * is pure apart from the `SessionStorage` passed in, so it runs in tests.
 * Nothing leaves the browser.
 */
import { parseDgm } from '../parser/dgm.js';
import { buildGraph, type ModelGraph } from '../model/graph.js';
import type { LayoutResult } from '../layout/index.js';
import { DEFAULT_GLOBAL_STYLE } from '../render/styles.js';
import type { HistorySlice } from './store.js';

/**
 * Storage key of the one slot. Further slots would take the same prefix
 * with their own suffix, so adding them does not move this one.
 */
export const AUTOSAVE_KEY = 'mplusplus.autosave.slot1';
const VERSION = 1;

export interface SavedSession {
  version: typeof VERSION;
  /** ISO time of the save. */
  savedAt: string;
  fileName: string;
  dgmText: string;
  engine: string;
  layout: LayoutResult;
  slice: HistorySlice;
}

/** The part of `Storage` autosave uses, so tests can pass a fake. */
export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function toSession(
  fileName: string,
  dgmText: string,
  engine: string,
  layout: LayoutResult,
  slice: HistorySlice,
  now: Date,
): SavedSession {
  return { version: VERSION, savedAt: now.toISOString(), fileName, dgmText, engine, layout, slice };
}

/** The session in `raw`, or null when it is missing, malformed or from another version. */
export function readSession(raw: string | null): SavedSession | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Partial<SavedSession>;
  const ok =
    s.version === VERSION &&
    typeof s.savedAt === 'string' &&
    typeof s.fileName === 'string' &&
    typeof s.dgmText === 'string' &&
    typeof s.engine === 'string' &&
    Array.isArray(s.layout?.nodes) &&
    Array.isArray(s.layout?.edges) &&
    typeof s.slice === 'object' &&
    s.slice !== null;
  return ok ? (s as SavedSession) : null;
}

/** Store `session`; false when the storage refuses it (full, or disabled). */
export function saveSession(storage: SessionStorage, session: SavedSession): boolean {
  try {
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(storage: SessionStorage): SavedSession | null {
  try {
    return readSession(storage.getItem(AUTOSAVE_KEY));
  } catch {
    return null;
  }
}

export function clearSession(storage: SessionStorage): void {
  try {
    storage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export interface RestoredSession {
  graph: ModelGraph;
  layout: LayoutResult;
  slice: HistorySlice;
}

/**
 * Rebuild the graph from the saved text, with the saved layout and slice.
 * Global style fields added since the save take their defaults. Throws
 * when the text no longer parses.
 */
export function restoreSession(session: SavedSession): RestoredSession {
  const graph = buildGraph(parseDgm(session.dgmText));
  const s = session.slice;
  return {
    graph,
    layout: session.layout,
    slice: {
      positions: s.positions ?? {},
      edgeStyles: s.edgeStyles ?? {},
      nodeStyles: s.nodeStyles ?? {},
      global: { ...DEFAULT_GLOBAL_STYLE, ...(s.global ?? {}) },
      pValues: s.pValues ?? {},
    },
  };
}
