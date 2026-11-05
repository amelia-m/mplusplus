/**
 * Column assignment for the `sem` engine (docs/diagram-conventions.md D6,
 * D7): which column each structural variable goes in, the order within a
 * column, which indicators belong to which latent, and the side of a latent
 * its indicators sit on. Pure, so the placement in `sem.ts` stays testable.
 */
import type { ModelGraph } from '../model/graph.js';
import type { Side } from './index.js';

export interface SemColumns {
  /** Structural (non-indicator) node ids per column, left to right. */
  columns: string[][];
  /** Indicator ids per latent, each indicator under its first factor only. */
  indicators: Map<string, string[]>;
}

/**
 * Columns from Mplus's levels for every node that has one. A node without
 * a level (all of them when the header lacks the line) is an indicator if
 * an observed variable a factor loads on, and is otherwise put in the
 * column given by the longest directed path reaching it. Within a column,
 * nodes keep Mplus's variable order.
 */
export function semColumns(graph: ModelGraph): SemColumns {
  const order = new Map(
    graph.source.header.allVariables.map((v, k) => [v.toLowerCase(), k] as const),
  );
  const byOrder = (a: string, b: string): number =>
    (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity);

  const levelOf = new Map(graph.nodes.map((n) => [n.id, n.level]));
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const loaded = new Set(
    graph.edges.filter((e) => e.kind === 'BY' && kindOf.get(e.to) === 'observed').map((e) => e.to),
  );
  const isIndicator = new Set(
    graph.nodes
      .filter((n) => (n.level === null ? loaded.has(n.id) : n.level === -1))
      .map((n) => n.id),
  );

  const indicators = new Map<string, string[]>();
  const placed = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind !== 'BY' || !isIndicator.has(e.to) || placed.has(e.to)) continue;
    placed.add(e.to);
    const list = indicators.get(e.from) ?? [];
    list.push(e.to);
    indicators.set(e.from, list);
  }

  const structural = graph.nodes.map((n) => n.id).filter((id) => !isIndicator.has(id));
  const depth = structural.some((id) => levelOf.get(id) === null)
    ? longestPathDepth(graph, new Set(structural))
    : new Map<string, number>();

  const columns: string[][] = [];
  for (const id of structural) {
    const c = levelOf.get(id) ?? depth.get(id) ?? 0;
    (columns[c] ??= []).push(id);
  }
  return { columns: columns.filter(Boolean).map((c) => c.sort(byOrder)), indicators };
}

/**
 * Depth of each node along directed BY and ON edges among `nodes`: 0 for a
 * node no path reaches, else one more than its deepest parent. A path that
 * returns to a node already on it (a feedback loop) stops there.
 */
function longestPathDepth(graph: ModelGraph, nodes: Set<string>): Map<string, number> {
  const parents = new Map<string, string[]>();
  for (const e of graph.edges) {
    if ((e.kind !== 'BY' && e.kind !== 'ON') || !nodes.has(e.from) || !nodes.has(e.to)) continue;
    parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  }
  const depth = new Map<string, number>();
  const onPath = new Set<string>();
  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    onPath.add(id);
    let d = 0;
    for (const p of parents.get(id) ?? []) {
      if (!onPath.has(p)) d = Math.max(d, visit(p) + 1);
    }
    onPath.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of nodes) visit(id);
  return depth;
}

/**
 * The side a latent's indicators go on, read from Mplus's diagrams: right
 * when there is one column, left in the first column, right in the last,
 * and in a middle column below, or above for the first of several latents
 * stacked there.
 */
export function indicatorSide(
  column: number,
  columnCount: number,
  indexInColumn: number,
  latentsInColumn: number,
): Side {
  if (columnCount === 1) return 'right';
  if (column === 0) return 'left';
  if (column === columnCount - 1) return 'right';
  return latentsInColumn > 1 && indexInColumn === 0 ? 'top' : 'bottom';
}

/**
 * The residual side for a variable in the middle column of a diagram with
 * an odd number of columns (one column included). Left is Amelia's proposal
 * (2026-11-04: "I'm thinking default left"), awaiting her confirmation.
 */
export const MIDDLE_COLUMN_RESIDUAL_SIDE: Side = 'left';

/**
 * The outer edge for a variable in `column` of `columnCount` columns
 * (docs/diagram-conventions.md D18): left in the left half, right in the
 * right half, `MIDDLE_COLUMN_RESIDUAL_SIDE` in the middle column. Halves
 * are counted in columns, not in drawn width; an even count has no middle.
 */
export function outerSide(column: number, columnCount: number): Side {
  const middle = (columnCount - 1) / 2;
  if (column === middle) return MIDDLE_COLUMN_RESIDUAL_SIDE;
  return column < middle ? 'left' : 'right';
}
