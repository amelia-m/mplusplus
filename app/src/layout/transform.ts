/**
 * Rotating and flipping part or all of a diagram (Amelia, 2026-11-03: 90°
 * steps and flips, applied to the stored positions, so a rotation is
 * undoable, autosaved and edited further like any move). Boxes keep their
 * size and their text stays upright: only box centers move. Residuals and
 * covariance curves keep pointing the same way relative to their boxes,
 * so their sides turn with the boxes. Pure, so it runs in tests.
 */
import type { ModelGraph } from '../model/graph.js';
import type { NodePosition } from '../state/store.js';
import type { Point, Side } from './index.js';

export type TransformOp = 'rotate-cw' | 'rotate-ccw' | 'flip-h' | 'flip-v';

/** Clockwise order of sides; screen y grows downward. */
const CLOCKWISE: Side[] = ['top', 'right', 'bottom', 'left'];

/** Where `side` points after `op`. */
export function transformSide(side: Side, op: TransformOp): Side {
  const i = CLOCKWISE.indexOf(side);
  switch (op) {
    case 'rotate-cw':
      return CLOCKWISE[(i + 1) % 4];
    case 'rotate-ccw':
      return CLOCKWISE[(i + 3) % 4];
    case 'flip-h':
      return side === 'left' ? 'right' : side === 'right' ? 'left' : side;
    case 'flip-v':
      return side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side;
  }
}

/** `p` after `op` around `pivot`, on screen (y down): clockwise turns right of up. */
export function transformPoint(p: Point, pivot: Point, op: TransformOp): Point {
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  switch (op) {
    case 'rotate-cw':
      return { x: pivot.x - dy, y: pivot.y + dx };
    case 'rotate-ccw':
      return { x: pivot.x + dy, y: pivot.y - dx };
    case 'flip-h':
      return { x: pivot.x - dx, y: p.y };
    case 'flip-v':
      return { x: p.x, y: pivot.y - dy };
  }
}

/** Center of the bounding box of `boxes`. */
export function boxesCenter(boxes: NodePosition[]): Point {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

export interface TransformInput {
  /** The nodes to turn. */
  ids: Iterable<string>;
  positions: Record<string, NodePosition>;
  /** Each node's residual side as drawn now, where it has a residual. */
  residualSides: Record<string, Side>;
  /** Each covariance curve as drawn now: its ends and the side it bulges to. */
  curves: Array<{ id: string; from: string; to: string; side: Side }>;
}

export interface TransformResult {
  positions: Record<string, NodePosition>;
  /** New sides for the turned nodes' residuals. */
  residualSides: Record<string, Side>;
  /** New sides for curves with both ends among the turned nodes. */
  curveSides: Record<string, Side>;
}

/**
 * Turn the nodes `input.ids` by `op` around the center of their bounding
 * box. A curve turns only when both its ends do; one reaching outside the
 * group keeps its side.
 */
export function transformGroup(input: TransformInput, op: TransformOp): TransformResult {
  const ids = new Set([...input.ids].filter((id) => input.positions[id]));
  const result: TransformResult = { positions: {}, residualSides: {}, curveSides: {} };
  if (ids.size === 0) return result;
  const pivot = boxesCenter([...ids].map((id) => input.positions[id]));
  for (const id of ids) {
    const b = input.positions[id];
    const c = transformPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, pivot, op);
    result.positions[id] = { ...b, x: c.x - b.width / 2, y: c.y - b.height / 2 };
    const side = input.residualSides[id];
    if (side) result.residualSides[id] = transformSide(side, op);
  }
  for (const c of input.curves) {
    if (ids.has(c.from) && ids.has(c.to)) result.curveSides[c.id] = transformSide(c.side, op);
  }
  return result;
}

/**
 * `ids` plus every observed indicator of each latent among them (its BY
 * targets), so selecting a factor selects its measurement block.
 */
export function withIndicators(graph: ModelGraph, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const observed = new Set(graph.nodes.filter((n) => n.kind === 'observed').map((n) => n.id));
  for (const e of graph.edges) {
    if (e.kind === 'BY' && out.has(e.from) && observed.has(e.to)) out.add(e.to);
  }
  return out;
}
