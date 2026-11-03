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
 * Columns from Mplus's levels when every node has one; otherwise each
 * structural node's column is the length of the longest directed path
 * reaching it. Within a column, nodes keep Mplus's variable order.
 */
export function semColumns(graph: ModelGraph): SemColumns {
  const order = new Map(
    graph.source.header.allVariables.map((v, k) => [v.toLowerCase(), k] as const),
  );
  const byOrder = (a: string, b: string): number =>
    (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity);

  const fromMplus = graph.nodes.length > 0 && graph.nodes.every((n) => n.level !== null);
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const isIndicator = new Set(
    fromMplus
      ? graph.nodes.filter((n) => n.level === -1).map((n) => n.id)
      : graph.edges
          .filter((e) => e.kind === 'BY' && kindOf.get(e.to) === 'observed')
          .map((e) => e.to),
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
  const column = fromMplus
    ? new Map(graph.nodes.map((n) => [n.id, n.level as number]))
    : longestPathDepth(graph, new Set(structural));

  const columns: string[][] = [];
  for (const id of structural) {
    const c = column.get(id) ?? 0;
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
