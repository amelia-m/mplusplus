/**
 * The app store: Zustand wrapped in zundo's `temporal` middleware for undo
 * and redo. Holds the graph, layout, authoritative node `positions`,
 * selection, sparse style overrides, global style and `.out` p-values.
 * `historySlice` and `historyEqual` define what an undo entry is;
 * continuous interactions go through `gesture.ts`, and undo and redo
 * through `history.ts`.
 */
import { create } from 'zustand';
import { temporal } from 'zundo';
import type { ModelGraph, GraphEdge, GraphNode } from '../model/graph.js';
import type { LayoutResult } from '../layout/index.js';
import {
  DEFAULT_GLOBAL_STYLE,
  type EdgeStyleOverride,
  type GlobalStyle,
  type NodeStyleOverride,
} from '../render/styles.js';
import { mergeRecord, valueEqual } from './valueEqual.js';

export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PValueEntry {
  unstd: number | null;
  stdyx: number | null;
}

export interface AppState {
  graph: ModelGraph | null;
  layout: LayoutResult | null;
  /** Authoritative node positions; these supersede the layout result once a
   *  layout has been "loaded". Drag and align operations mutate these. */
  positions: Record<string, NodePosition>;
  /** Selected node ids. */
  selection: Set<string>;
  /** Selected edge ids. */
  edgeSelection: Set<string>;
  /** Per-object style overrides; sparse. */
  edgeStyles: Record<string, EdgeStyleOverride>;
  nodeStyles: Record<string, NodeStyleOverride>;
  /** Global styling + significance preferences. */
  global: GlobalStyle;
  /** P-values attached from a parsed `.out` file, keyed by edge id. */
  pValues: Record<string, PValueEntry>;
}

export interface AppActions {
  loadGraph(graph: ModelGraph, layout: LayoutResult): void;
  setNodePosition(id: string, pos: NodePosition): void;
  setNodePositions(updates: Record<string, NodePosition>): void;
  setSelection(ids: Iterable<string>): void;
  addToSelection(id: string): void;
  clearSelection(): void;
  setEdgeSelection(ids: Iterable<string>): void;
  toggleEdgeSelection(id: string): void;
  addToEdgeSelection(id: string): void;
  clearEdgeSelection(): void;
  clearAllSelection(): void;
  setEdgeStyle(id: string, patch: EdgeStyleOverride): void;
  setEdgeStyles(ids: Iterable<string>, patch: EdgeStyleOverride): void;
  setNodeStyle(id: string, patch: NodeStyleOverride): void;
  setNodeStyles(ids: Iterable<string>, patch: NodeStyleOverride): void;
  resetStyles(): void;
  setGlobal(patch: Partial<GlobalStyle>): void;
  setPValues(map: Record<string, PValueEntry>): void;
}

/** The part of the state that undo/redo tracks. */
export type HistorySlice = Pick<
  AppState,
  'positions' | 'edgeStyles' | 'nodeStyles' | 'global' | 'pValues'
>;

/** Maximum number of undo entries kept. */
export const HISTORY_LIMIT = 100;

/**
 * The undo-relevant slice of the state. Selection state and graph identity
 * are not undo-relevant; style maps, positions, global style and p-values
 * all participate in history. Shared by the temporal options and
 * `state/gesture.ts` so both agree on what an entry is.
 */
export function historySlice(s: AppState): HistorySlice {
  return {
    positions: s.positions,
    edgeStyles: s.edgeStyles,
    nodeStyles: s.nodeStyles,
    global: s.global,
    pValues: s.pValues,
  };
}

/**
 * True when two history slices hold the same values. Actions keep a field's
 * object when no value in it changes, so the reference check settles the
 * common case (selection-only updates, no-op writes) cheaply; the value
 * comparison catches a slice that changed and came back, such as a drag
 * that ends where it started, so it adds no undo entry either.
 */
export function historyEqual(a: HistorySlice, b: HistorySlice): boolean {
  const same = <K extends keyof HistorySlice>(k: K): boolean => a[k] === b[k] || valueEqual(a[k], b[k]);
  return same('positions') && same('edgeStyles') && same('nodeStyles') && same('global') && same('pValues');
}

/**
 * `override` without its `undefined` fields, or `null` when nothing is left.
 * An `undefined` field means "not overridden", so it is not stored (merged
 * over a base style it would replace the base value with `undefined`).
 */
function compactOverride<T extends object>(override: T): T | null {
  const out: Record<string, unknown> = {};
  let empty = true;
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    out[k] = v;
    empty = false;
  }
  return empty ? null : (out as T);
}

/**
 * Apply `patch` to the overrides of each id in `ids`. A field set to
 * `undefined` in `patch` clears that field, and an override left with no
 * fields is deleted, so the map never holds an empty record. Returns
 * `styles` itself when no value changes, so the action can skip the write.
 */
function patchStyles<T extends object>(
  styles: Record<string, T>,
  ids: Iterable<string>,
  patch: T,
): Record<string, T> {
  let next: Record<string, T> | null = null;
  for (const id of ids) {
    const has = Object.hasOwn(styles, id);
    const merged = compactOverride({ ...(styles[id] ?? {}), ...patch } as T);
    if (merged === null) {
      if (!has) continue;
      next ??= { ...styles };
      delete next[id];
    } else if (!has || !valueEqual(styles[id], merged)) {
      next ??= { ...styles };
      next[id] = merged;
    }
  }
  return next ?? styles;
}

export const useStore = create<AppState & AppActions>()(
  // zundo's temporal middleware wraps the store and exposes a separate
  // `temporal` API for undo/redo.
  temporal(
    (set, get) => ({
      graph: null,
      layout: null,
      positions: {},
      selection: new Set<string>(),
      edgeSelection: new Set<string>(),
      edgeStyles: {},
      nodeStyles: {},
      global: { ...DEFAULT_GLOBAL_STYLE },
      pValues: {},

      loadGraph(graph, layout) {
        const positions: Record<string, NodePosition> = {};
        for (const n of layout.nodes) {
          positions[n.id] = { x: n.x, y: n.y, width: n.width, height: n.height };
        }
        set({
          graph,
          layout,
          positions,
          selection: new Set(),
          edgeSelection: new Set(),
          edgeStyles: {},
          nodeStyles: {},
          pValues: {},
        });
      },

      // Every history action below writes nothing when no value changes, so
      // a no-op (an identical align, Reset with no overrides, a clamped
      // value equal to the current one) adds no undo entry and wakes no
      // subscriber.
      setNodePosition(id, pos) {
        get().setNodePositions({ [id]: pos });
      },

      setNodePositions(updates) {
        const cur = get().positions;
        const positions = mergeRecord(cur, updates);
        if (positions !== cur) set({ positions });
      },

      setSelection(ids) {
        set({ selection: new Set(ids) });
      },

      addToSelection(id) {
        const next = new Set(get().selection);
        next.add(id);
        set({ selection: next });
      },

      clearSelection() {
        set({ selection: new Set() });
      },

      setEdgeSelection(ids) {
        set({ edgeSelection: new Set(ids) });
      },

      toggleEdgeSelection(id) {
        const next = new Set(get().edgeSelection);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        set({ edgeSelection: next });
      },

      addToEdgeSelection(id) {
        const next = new Set(get().edgeSelection);
        next.add(id);
        set({ edgeSelection: next });
      },

      clearEdgeSelection() {
        set({ edgeSelection: new Set() });
      },

      clearAllSelection() {
        set({ selection: new Set(), edgeSelection: new Set() });
      },

      setEdgeStyle(id, patch) {
        get().setEdgeStyles([id], patch);
      },

      setEdgeStyles(ids, patch) {
        const cur = get().edgeStyles;
        const edgeStyles = patchStyles(cur, ids, patch);
        if (edgeStyles !== cur) set({ edgeStyles });
      },

      setNodeStyle(id, patch) {
        get().setNodeStyles([id], patch);
      },

      setNodeStyles(ids, patch) {
        const cur = get().nodeStyles;
        const nodeStyles = patchStyles(cur, ids, patch);
        if (nodeStyles !== cur) set({ nodeStyles });
      },

      resetStyles() {
        const { edgeStyles, nodeStyles } = get();
        if (valueEqual(edgeStyles, {}) && valueEqual(nodeStyles, {})) return;
        set({ edgeStyles: {}, nodeStyles: {} });
      },

      setGlobal(patch) {
        const cur = get().global;
        const global = { ...cur, ...patch };
        if (!valueEqual(global, cur)) set({ global });
      },

      setPValues(map) {
        const cur = get().pValues;
        const pValues = mergeRecord(cur, map);
        if (pValues !== cur) set({ pValues });
      },
    }),
    {
      // Arrow wrapper keeps the store type inferred from the creator.
      partialize: (s) => historySlice(s),
      equality: historyEqual,
      limit: HISTORY_LIMIT,
    },
  ),
);

export type GraphLookups = {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
};

export function buildLookups(graph: ModelGraph): GraphLookups {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  return { nodes, edges };
}
