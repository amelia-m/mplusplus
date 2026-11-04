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

/**
 * `p` after `op` around `pivot`, on screen (y down): clockwise turns right
 * of up. A turn swaps the axes, but boxes stay wider than tall, so offsets
 * that become horizontal are stretched by `aspect` (box width over height)
 * and those that become vertical shrink by it; otherwise indicators
 * stacked a box height apart would overlap side by side. The stretch
 * undoes itself, so four quarter turns, or a turn and its opposite, come
 * back exactly.
 */
export function transformPoint(p: Point, pivot: Point, op: TransformOp, aspect = 1): Point {
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  switch (op) {
    case 'rotate-cw':
      return { x: pivot.x - dy * aspect, y: pivot.y + dx / aspect };
    case 'rotate-ccw':
      return { x: pivot.x + dy * aspect, y: pivot.y - dx / aspect };
    case 'flip-h':
      return { x: pivot.x - dx, y: p.y };
    case 'flip-v':
      return { x: p.x, y: pivot.y - dy };
  }
}

/**
 * The point a group turns around: the center of the bounding box of the
 * box centers. Unlike the boxes' own bounding box, it stays put under
 * every turn and flip, even when boxes differ in size.
 */
export function groupPivot(boxes: NodePosition[]): Point {
  const xs = boxes.map((b) => b.x + b.width / 2);
  const ys = boxes.map((b) => b.y + b.height / 2);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
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
 * Turn the nodes `input.ids` by `op` around their pivot (`groupPivot`),
 * with the spacing stretched by the boxes' average aspect (see
 * `transformPoint`). A curve turns only when both its ends do; one
 * reaching outside the group keeps its side.
 */
export function transformGroup(input: TransformInput, op: TransformOp): TransformResult {
  const ids = new Set([...input.ids].filter((id) => input.positions[id]));
  const result: TransformResult = { positions: {}, residualSides: {}, curveSides: {} };
  if (ids.size === 0) return result;
  const boxes = [...ids].map((id) => input.positions[id]);
  const pivot = groupPivot(boxes);
  const aspect = boxes.reduce((n, b) => n + b.width, 0) / boxes.reduce((n, b) => n + b.height, 0);
  for (const id of ids) {
    const b = input.positions[id];
    const c = transformPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, pivot, op, aspect);
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
 * `ids` plus everything each latent among them measures, through BY: its
 * indicators, and for a second-order factor its first-order factors and
 * theirs, so selecting a factor selects its whole measurement block. An
 * indicator that also loads on another factor comes along too.
 */
export function withIndicators(graph: ModelGraph, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const measures = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind === 'BY') measures.set(e.from, [...(measures.get(e.from) ?? []), e.to]);
  }
  const queue = [...out];
  while (queue.length > 0) {
    for (const to of measures.get(queue.pop()!) ?? []) {
      if (!out.has(to)) {
        out.add(to);
        queue.push(to);
      }
    }
  }
  return out;
}

/**
 * New sides for covariance curves drawn between residual tails, after the
 * residuals of `changed` moved: a curve with a changed end bulges to the
 * side both its residuals now share. When its two residuals point
 * different ways it keeps its side (no single bulge would suit both).
 */
export function curveSidesFollowingResiduals(
  curves: Array<{ id: string; from: string; to: string; attach: 'node' | 'residual' }>,
  residualSideOf: (id: string) => Side | undefined,
  changed: ReadonlySet<string>,
): Record<string, Side> {
  const out: Record<string, Side> = {};
  for (const c of curves) {
    if (c.attach !== 'residual' || !(changed.has(c.from) || changed.has(c.to))) continue;
    const a = residualSideOf(c.from);
    if (a && a === residualSideOf(c.to)) out[c.id] = a;
  }
  return out;
}
