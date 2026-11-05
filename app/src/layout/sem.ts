/**
 * The `sem` layout engine: columns and stacking from `semColumns`, each
 * latent's indicators fanned out on the side `indicatorSide` gives, paths
 * left straight, residuals and covariance curves placed on free sides
 * (docs/diagram-conventions.md D2, D4-D8, D12, D18). Sides are stored, not
 * coordinates, so the renderer can follow dragged nodes.
 */
import { isSymmetricKind, type ModelGraph } from '../model/graph.js';
import type {
  EdgeLayout,
  LayoutEngine,
  LayoutOpts,
  LayoutResult,
  NodeLayout,
  ResidualLayout,
  Side,
} from './index.js';
import { indicatorSide, outerSide, semColumns } from './semColumns.js';

/** Between neighbouring indicators of one fan. */
const INDICATOR_GAP = 24;
/** Between a latent and its fan: room for the loadings' value labels. */
const FAN_GAP = 110;
/** Room beyond a fan for its residual arrows and their values. */
const RESIDUAL_ROOM = 70;
/** Between stacked blocks in one column. */
const BLOCK_GAP = 60;
/** Between columns: room for the paths' value labels. */
const COLUMN_GAP = 150;

interface Block {
  /** Distance from the block's left edge to the structural node's centre. */
  left: number;
  right: number;
  height: number;
  /** Positions relative to the structural node's centre x and the block's top. */
  place: (cx: number, top: number) => NodeLayout[];
}

export const semEngine: LayoutEngine = {
  name: 'sem',
  async layout(graph: ModelGraph, opts: LayoutOpts): Promise<LayoutResult> {
    return placeSem(graph, opts.nodeWidth ?? 120, opts.nodeHeight ?? 56);
  },
};

export function placeSem(graph: ModelGraph, w: number, h: number): LayoutResult {
  const { columns, indicators } = semColumns(graph);
  const box = (id: string, x: number, y: number): NodeLayout => ({ id, x, y, width: w, height: h });
  const fanSide = new Map<string, Side>();

  const blockFor = (id: string, column: number, latentIndex: number, latentCount: number): Block => {
    const fan = indicators.get(id) ?? [];
    if (fan.length === 0) {
      return { left: w / 2, right: w / 2, height: h, place: (cx, top) => [box(id, cx - w / 2, top)] };
    }
    const side = indicatorSide(column, columns.length, latentIndex, latentCount);
    fanSide.set(id, side);
    const row = fan.length * w + (fan.length - 1) * INDICATOR_GAP;
    const stack = fan.length * h + (fan.length - 1) * INDICATOR_GAP;
    const across = (cx: number, y: number) =>
      fan.map((f, k) => box(f, cx - row / 2 + k * (w + INDICATOR_GAP), y));
    const down = (x: number, top: number) => fan.map((f, k) => box(f, x, top + k * (h + INDICATOR_GAP)));
    switch (side) {
      case 'bottom':
        return {
          left: Math.max(w, row) / 2,
          right: Math.max(w, row) / 2,
          height: h + FAN_GAP + h + RESIDUAL_ROOM,
          place: (cx, top) => [box(id, cx - w / 2, top), ...across(cx, top + h + FAN_GAP)],
        };
      case 'top':
        return {
          left: Math.max(w, row) / 2,
          right: Math.max(w, row) / 2,
          height: RESIDUAL_ROOM + h + FAN_GAP + h,
          place: (cx, top) => [
            ...across(cx, top + RESIDUAL_ROOM),
            box(id, cx - w / 2, top + RESIDUAL_ROOM + h + FAN_GAP),
          ],
        };
      case 'left':
      case 'right': {
        const height = Math.max(h, stack);
        const reach = w / 2 + FAN_GAP + w + RESIDUAL_ROOM;
        const fanX = (cx: number) => (side === 'left' ? cx - w / 2 - FAN_GAP - w : cx + w / 2 + FAN_GAP);
        return {
          left: side === 'left' ? reach : w / 2,
          right: side === 'right' ? reach : w / 2,
          height,
          place: (cx, top) => [box(id, cx - w / 2, top + (height - h) / 2), ...down(fanX(cx), top)],
        };
      }
    }
  };

  // Lay each column's blocks top to bottom, aligned on one centre line.
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const laidColumns = columns.map((ids, c) => {
    const latents = ids.filter((id) => kindOf.get(id) === 'latent');
    const blocks = ids.map((id) => blockFor(id, c, latents.indexOf(id), latents.length));
    const left = Math.max(...blocks.map((b) => b.left));
    const right = Math.max(...blocks.map((b) => b.right));
    const height = blocks.reduce((sum, b) => sum + b.height, 0) + BLOCK_GAP * (blocks.length - 1);
    return { blocks, left, right, height };
  });
  const tallest = Math.max(0, ...laidColumns.map((c) => c.height));

  const nodes: NodeLayout[] = [];
  const columnNodes: NodeLayout[][] = [];
  let x = 0;
  for (const col of laidColumns) {
    let top = (tallest - col.height) / 2;
    const here: NodeLayout[] = [];
    for (const b of col.blocks) {
      here.push(...b.place(x + col.left, top));
      top += b.height + BLOCK_GAP;
    }
    nodes.push(...here);
    columnNodes.push(here);
    x += col.left + col.right + COLUMN_GAP;
  }
  clearSkippedColumns(graph, columnNodes, h);
  // A node no column or fan holds (a graph Mplus did not describe) gets a
  // column of its own, so it is still drawn.
  const placed = new Set(nodes.map((n) => n.id));
  graph.nodes
    .filter((n) => !placed.has(n.id))
    .forEach((n, k) => nodes.push(box(n.id, x, k * (h + BLOCK_GAP))));

  const residuals = residualSides(graph, columns, indicators, fanSide);
  const edges = edgeLayouts(graph, nodes, residuals, fanSide);
  const right = Math.max(0, ...nodes.map((n) => n.x + n.width));
  const bottom = Math.max(0, ...nodes.map((n) => n.y + n.height));
  return { nodes, edges, residuals, width: right, height: bottom };
}

/**
 * A path that skips a column must not run behind a box in it: move that
 * column down, a half box at a time, until the path clears it, as Mplus
 * lowers `fb` in `syn_sem` so the path `fa -> fc` passes above. Columns are
 * moved left to right, each once its own crossings are cleared; the steps
 * are capped so a crowded model still finishes.
 */
function clearSkippedColumns(graph: ModelGraph, columnNodes: NodeLayout[][], h: number): void {
  const column = new Map<string, number>();
  columnNodes.forEach((ns, c) => ns.forEach((n) => column.set(n.id, c)));
  const at = new Map(columnNodes.flat().map((n) => [n.id, n]));
  const mid = (n: NodeLayout) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
  const skipping = graph.edges.filter((e) => {
    if (e.kind !== 'BY' && e.kind !== 'ON') return false;
    const [a, b] = [column.get(e.from), column.get(e.to)];
    return a !== undefined && b !== undefined && Math.abs(a - b) > 1;
  });
  for (let c = 1; c < columnNodes.length - 1; c++) {
    const crossed = (): boolean =>
      skipping.some((e) => {
        const [a, b] = [column.get(e.from)!, column.get(e.to)!];
        if (Math.min(a, b) >= c || Math.max(a, b) <= c) return false;
        const [p, q] = [mid(at.get(e.from)!), mid(at.get(e.to)!)];
        return columnNodes[c].some((n) => segmentCrossesBox(p, q, n));
      });
    for (let step = 0; step < 40 && crossed(); step++) {
      for (const n of columnNodes[c]) n.y += h / 2;
    }
  }
}

/** Does the segment p-q pass through box `b` (Liang-Barsky clipping)? */
export function segmentCrossesBox(
  p: { x: number; y: number },
  q: { x: number; y: number },
  b: NodeLayout,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const checks: [number, number][] = [
    [-dx, p.x - b.x],
    [dx, b.x + b.width - p.x],
    [-dy, p.y - b.y],
    [dy, b.y + b.height - p.y],
  ];
  for (const [pk, qk] of checks) {
    if (pk === 0) {
      if (qk < 0) return false;
      continue;
    }
    const t = qk / pk;
    if (pk < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Residual sides (D18): an indicator's points away from its factor, which
 * is the outer edge too, since fans sit on a free outer side (D7): up for
 * a fan above its factor, down for one below. An observed variable in a
 * column points to the diagram's outer edge (`outerSide`); one outside any
 * column is drawn right of everything, so it points right. Latents keep
 * Mplus's top, or the bottom when their own indicators are above (D12).
 */
function residualSides(
  graph: ModelGraph,
  columns: string[][],
  indicators: Map<string, string[]>,
  fanSide: Map<string, Side>,
): ResidualLayout[] {
  const factorOf = new Map<string, string>();
  for (const [latent, fan] of indicators) for (const f of fan) factorOf.set(f, latent);
  const columnOf = new Map<string, number>();
  columns.forEach((ids, c) => ids.forEach((id) => columnOf.set(id, c)));
  return graph.nodes
    .filter((n) => n.residual !== null)
    .map((n): ResidualLayout => {
      const factor = factorOf.get(n.id);
      // A factor laid out outside any column has no fan side; its
      // indicators then follow the rule for other variables.
      const away = factor !== undefined ? fanSide.get(factor) : undefined;
      if (away !== undefined) return { id: n.id, side: away };
      if (n.kind === 'observed') {
        const c = columnOf.get(n.id);
        return { id: n.id, side: c === undefined ? 'right' : outerSide(c, columns.length) };
      }
      return { id: n.id, side: fanSide.get(n.id) === 'top' ? 'bottom' : 'top' };
    });
}

/**
 * Directed paths are straight (no bends). A covariance becomes a curve:
 * between residuals when both ends are dependent variables with residuals
 * (D5), otherwise between the nodes. It bulges to the residuals' side when
 * both face the same way; else to a free side (D8): for a pair one above
 * the other, left unless a left fan is there; for a pair side by side,
 * bottom when both residuals point down, else top.
 */
function edgeLayouts(
  graph: ModelGraph,
  nodes: NodeLayout[],
  residuals: ResidualLayout[],
  fanSide: Map<string, Side>,
): EdgeLayout[] {
  const dependent = new Set(
    graph.edges.filter((d) => d.kind === 'BY' || d.kind === 'ON').map((d) => d.to),
  );
  const residualSide = new Map(residuals.map((r) => [r.id, r.side]));
  const at = new Map(nodes.map((n) => [n.id, n]));
  return graph.edges.map((e): EdgeLayout => {
    if (!isSymmetricKind(e.kind)) return { id: e.id, bend: [] };
    const a = residualSide.get(e.from);
    const b = residualSide.get(e.to);
    const attach =
      dependent.has(e.from) && dependent.has(e.to) && a !== undefined && b !== undefined
        ? 'residual'
        : 'node';
    if (attach === 'residual' && a === b) return { id: e.id, bend: [], curve: { side: a!, attach } };
    const pa = at.get(e.from)!;
    const pb = at.get(e.to)!;
    const stacked = Math.abs(pa.y - pb.y) >= Math.abs(pa.x - pb.x);
    let side: Side;
    if (stacked) {
      side = fanSide.get(e.from) === 'left' || fanSide.get(e.to) === 'left' ? 'right' : 'left';
    } else {
      side = a === 'bottom' && b === 'bottom' ? 'bottom' : 'top';
    }
    return { id: e.id, bend: [], curve: { side, attach } };
  });
}
