/**
 * Autosave sessions: the open diagram is kept in the browser's storage so a
 * reload does not lose it (Amelia, 2026-11-03: restore automatically, with a
 * Discard button). A session holds the `.dgm` text, the layout engine, the
 * layout and the undoable slice; restoring parses the text again, so a
 * session never stores the parsed graph. Each tab saves to its own slot
 * (`slotKey`; which slot a tab uses and restores is `autosaveController.ts`).
 * Everything here is pure apart from the storage passed in, so it runs in
 * tests. Nothing leaves the browser.
 */
import { parseDgm } from '../parser/dgm.js';
import { buildGraph, type ModelGraph } from '../model/graph.js';
import type { LayoutResult, NodeLayout } from '../layout/index.js';
import { DEFAULT_GLOBAL_STYLE } from '../render/styles.js';
import { historyEqual, type HistorySlice } from './store.js';

/** Key prefix of the per-tab slots; the tab's id follows it. */
export const SLOT_PREFIX = 'mplusplus.autosave.tab.';
/** The storage key of tab `tabId`'s slot. */
export const slotKey = (tabId: string): string => `${SLOT_PREFIX}${tabId}`;
/**
 * The one shared slot of the first autosave builds (before 2026-11-03). A
 * session still under it is restored like a slot of a closed tab.
 */
export const LEGACY_KEY = 'mplusplus.autosave.slot1';
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
  /** The tab that wrote it (`state/autosaveTabs.ts`); absent in a session saved before tabs had ids. */
  tabId?: string;
}

/** The part of `Storage` autosave uses, so tests can pass a fake. */
export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & {
  readonly length: number;
};

export function toSession(
  fileName: string,
  dgmText: string,
  engine: string,
  layout: LayoutResult,
  slice: HistorySlice,
  now: Date,
  tabId?: string,
): SavedSession {
  return { version: VERSION, savedAt: now.toISOString(), fileName, dgmText, engine, layout, slice, tabId };
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
    s.slice !== null &&
    (s.tabId === undefined || typeof s.tabId === 'string');
  return ok ? (s as SavedSession) : null;
}

/**
 * Store `session` under `key`; false when the storage refuses it (full, or
 * disabled). A refused write leaves the slot's previous value in place,
 * which may be an older diagram, so the slot is cleared: a reload then
 * starts empty instead of bringing back a diagram older than the one on
 * screen.
 */
export function saveSession(storage: SessionStorage, key: string, session: SavedSession): boolean {
  try {
    storage.setItem(key, JSON.stringify(session));
    return true;
  } catch {
    clearSession(storage, key);
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

export function loadSession(storage: SessionStorage, key: string): SavedSession | null {
  try {
    return readSession(storage.getItem(key));
  } catch {
    return null;
  }
}

export function clearSession(storage: SessionStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/** A stored session, with the key it is under and the tab that owns it. */
export interface StoredSlot {
  key: string;
  /** The owning tab's id, from the key; null for the legacy shared slot. */
  tabId: string | null;
  session: SavedSession;
}

/**
 * Every readable autosave slot in `storage`, most recently saved first: the
 * per-tab slots and the legacy shared one. Unreadable ones are skipped.
 */
export function listSlots(storage: SessionStorage): StoredSlot[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k !== null && (k.startsWith(SLOT_PREFIX) || k === LEGACY_KEY)) keys.push(k);
    }
  } catch {
    return [];
  }
  const slots: StoredSlot[] = [];
  for (const key of keys) {
    const session = loadSession(storage, key);
    if (session) slots.push({ key, tabId: key === LEGACY_KEY ? null : key.slice(SLOT_PREFIX.length), session });
  }
  return slots.sort((a, b) => b.session.savedAt.localeCompare(a.session.savedAt));
}

export interface RestoredSession {
  graph: ModelGraph;
  /**
   * The saved layout, or null when the model must be laid out again: the
   * layout no longer fits the graph, or it was made by another engine.
   */
  layout: LayoutResult | null;
  /** The saved slice; without positions when the layout is redone, so the new layout's boxes stand. */
  slice: Partial<HistorySlice>;
}

const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const hasFiniteBox = (p: unknown): boolean => {
  if (typeof p !== 'object' || p === null) return false;
  const { x, y, width, height } = p as Partial<NodeLayout>;
  return [x, y, width, height].every(finite);
};

/**
 * The positions to use after a restore: `restored` laid over `fresh` (the
 * layout's boxes for the graph just loaded), so a node with no saved
 * position, new since the save, keeps the box the layout gave it.
 */
export function restoredPositions<P>(fresh: Record<string, P>, restored: Record<string, P>): Record<string, P> {
  return { ...fresh, ...restored };
}

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
 * still fits the graph and was made by `engine` (the one the app lays out
 * with now), the saved layout. Otherwise the model is laid out again: with
 * the same engine the saved positions of nodes that still exist are kept
 * over it; from another engine they are left out (a diagram saved with the
 * ELK engine, dropped 2026-11-03, would otherwise keep ELK's boxes). Global style fields added since the save take their
 * defaults. Throws when the text no longer parses.
 */
export function restoreSession(session: SavedSession, engine: string): RestoredSession {
  const graph = buildGraph(parseDgm(session.dgmText));
  const s = session.slice;
  const sameEngine = session.engine === engine;
  const reuse = sameEngine && layoutFitsGraph(session.layout, graph);
  // Same engine but a layout that no longer fits (ids changed): keep the
  // user's placement for the nodes that still exist; new ones take the
  // fresh layout. Another engine's boxes are dropped altogether.
  const ids = new Set(graph.nodes.map((n) => n.id));
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  // A broken box (JSON turns NaN into null) is dropped either way, so the
  // layout's box for that node shows instead.
  const kept = Object.fromEntries(
    Object.entries(s.positions ?? {}).filter(([id, p]) => ids.has(id) && hasFiniteBox(p)),
  );
  return {
    graph,
    layout: reuse ? session.layout : null,
    slice: {
      // Positions and residual and curve sides belong together (a rotation
      // changes all three): kept with the saved layout, kept for surviving
      // nodes and edges when the same engine lays the model out again, and
      // dropped with another engine's boxes.
      ...(sameEngine
        ? {
            positions: kept,
            residualSides: Object.fromEntries(Object.entries(s.residualSides ?? {}).filter(([id]) => ids.has(id))),
            curveSides: Object.fromEntries(Object.entries(s.curveSides ?? {}).filter(([id]) => edgeIds.has(id))),
          }
        : { residualSides: {}, curveSides: {} }),
      edgeStyles: s.edgeStyles ?? {},
      nodeStyles: s.nodeStyles ?? {},
      global: { ...DEFAULT_GLOBAL_STYLE, ...(s.global ?? {}) },
      pValues: s.pValues ?? {},
    },
  };
}
