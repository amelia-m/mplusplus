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
import type { LayoutResult, NodeLayout } from '../layout/index.js';
import { DEFAULT_GLOBAL_STYLE } from '../render/styles.js';
import { historyEqual, type HistorySlice } from './store.js';

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

/**
 * Store `session`; false when the storage refuses it (full, or disabled).
 * A refused write leaves the slot's previous value in place, which may be
 * another diagram, so the slot is cleared: a reload then starts empty
 * instead of bringing back a diagram older than the one on screen.
 */
export function saveSession(storage: SessionStorage, session: SavedSession): boolean {
  try {
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(session));
    return true;
  } catch {
    clearSession(storage);
    return false;
  }
}

/** What a save writes, apart from the time; see `sameSaveState`. */
export interface SaveState {
  /** The loaded file; a new load is a new object even for the same file. */
  file: object;
  engine: string;
  layout: LayoutResult;
  slice: HistorySlice;
}

/**
 * True when a save of `b` would write what a save of `a` already wrote, so
 * it can be skipped: a selection change or a restore then leaves the slot,
 * and its `savedAt`, alone.
 */
export function sameSaveState(a: SaveState, b: SaveState): boolean {
  return a.file === b.file && a.engine === b.engine && a.layout === b.layout && historyEqual(a.slice, b.slice);
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
  /** The saved layout, or null when it no longer fits the graph and the model must be laid out again. */
  layout: LayoutResult | null;
  slice: HistorySlice;
}

const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/**
 * True when `layout` places exactly the nodes of `graph`, each with a
 * finite box, and lays out only edges `graph` has. A saved layout can stop
 * fitting when a newer parser builds different ids from the same text; drawn
 * as it is, a node without a layout entry would land at the origin and an
 * edge to it would vanish.
 */
export function layoutFitsGraph(layout: LayoutResult, graph: ModelGraph): boolean {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const placed = new Set<string>();
  for (const n of layout.nodes as unknown[]) {
    if (typeof n !== 'object' || n === null) return false;
    const { id, x, y, width, height } = n as Partial<NodeLayout>;
    if (typeof id !== 'string' || !nodeIds.has(id) || placed.has(id)) return false;
    if (![x, y, width, height].every(finite)) return false;
    placed.add(id);
  }
  if (placed.size !== nodeIds.size) return false;
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  return (layout.edges as unknown[]).every(
    (e) => typeof e === 'object' && e !== null && edgeIds.has((e as { id?: unknown }).id as string),
  );
}

/**
 * Rebuild the graph from the saved text, with the saved slice and, when it
 * still fits the graph, the saved layout. Global style fields added since
 * the save take their defaults. Throws when the text no longer parses.
 */
export function restoreSession(session: SavedSession): RestoredSession {
  const graph = buildGraph(parseDgm(session.dgmText));
  const s = session.slice;
  return {
    graph,
    layout: layoutFitsGraph(session.layout, graph) ? session.layout : null,
    slice: {
      positions: s.positions ?? {},
      edgeStyles: s.edgeStyles ?? {},
      nodeStyles: s.nodeStyles ?? {},
      global: { ...DEFAULT_GLOBAL_STYLE, ...(s.global ?? {}) },
      pValues: s.pValues ?? {},
    },
  };
}
