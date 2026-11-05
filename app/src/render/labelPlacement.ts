/**
 * Label collision pass (Amelia, 2026-11-03): after layout, coefficient labels
 * slide along their own path and residual values move along their residual
 * arrow or sideways, off curve ends, until nothing overlaps. Pure geometry:
 * the renderer builds the label boxes (text widths estimated, since nothing
 * measures text here) and the obstacles, and applies the offsets returned.
 *
 * The pass is greedy and deterministic: each round visits the labels in the
 * order given and moves each to its cheapest candidate position given where
 * the others are; it stops when a round moves nothing, or after
 * `MAX_ROUNDS`. A label with nothing in its way stays where it is, because
 * every move costs a little. When no candidate is clear, the label keeps the
 * least-overlapping one and is listed in `unresolved`.
 */
import type { Point } from '../layout/index.js';
import type { Box } from './geometry.js';
import { quadraticAt } from './residual.js';

/** The line a coefficient label sits on: a polyline, or a quadratic curve. */
export type LabelPath =
  | { kind: 'polyline'; points: readonly Point[] }
  | { kind: 'quadratic'; a: Point; control: Point; b: Point };

/** A coefficient label, kept on its own path at parameter `t`. */
export interface PathLabel {
  kind: 'path';
  id: string;
  path: LabelPath;
  /** Where the label sits with no collision pass. */
  t0: number;
  /** The label's box relative to the point on the path at its `t`. */
  rel: Box;
}

/** A residual value, which moves along its arrow or square to it. */
export interface ResidualLabel {
  kind: 'residual';
  id: string;
  /** The label's box relative to `anchor`. */
  rel: Box;
  anchor: Point;
  /** Unit vector from the arrow's tip to its tail, outward. */
  dir: Point;
}

export type PlacedLabel = PathLabel | ResidualLabel;

/** A path segment; `owner` names the label it belongs to, which ignores it. */
export interface Segment {
  a: Point;
  b: Point;
  owner?: string;
}

export interface Obstacles {
  /** Node boxes and arrowheads: no label should sit on them. */
  boxes: readonly Box[];
  /** Drawn paths: residual values keep off them (coefficient labels sit on theirs). */
  segments: readonly Segment[];
}

export interface Placement {
  /** Offset of each label from its position with no pass, by label id. */
  offsets: Map<string, Point>;
  /** The path parameter chosen for each coefficient label. */
  t: Map<string, number>;
  /** Labels left overlapping something because no candidate was clear. */
  unresolved: string[];
}

/** Range a coefficient label may slide over (Amelia's contract, 2026-11-04). */
export const T_MIN = 0.2;
export const T_MAX = 0.8;
const T_STEP = 0.05;
/** Step and reach of a residual value's moves, along and square to its arrow. */
const RES_STEP = 4;
const RES_REACH = 24;
/** Rounds before the pass gives up; it usually settles in two or three. */
export const MAX_ROUNDS = 8;
/** Space kept around a label box, so labels do not touch. */
const PAD = 1;
/** Cost per pixel of movement: enough to prefer staying, small next to any overlap. */
const MOVE_COST = 0.01;
/** Cost per pixel of path running through a residual value's box. */
const SEGMENT_COST = 10;

/** Width of `text` at `fontSize`, estimated at 0.62 of the size per character, as `curveLabelHalfWidth` does. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * 0.62 * fontSize;
}

/** Point at `t` (0 to 1) along a path; a polyline is measured by length. */
export function pointOnPath(path: LabelPath, t: number): Point {
  if (path.kind === 'quadratic') return quadraticAt(path.a, path.control, path.b, t);
  const pts = path.points;
  if (pts.length === 1) return pts[0];
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = lengths.reduce((s, l) => s + l, 0);
  if (total === 0) return pts[0];
  let along = t * total;
  for (let i = 0; i < lengths.length; i++) {
    if (along <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 0 : Math.min(1, along / lengths[i]);
      return { x: pts[i].x + f * (pts[i + 1].x - pts[i].x), y: pts[i].y + f * (pts[i + 1].y - pts[i].y) };
    }
    along -= lengths[i];
  }
  return pts[pts.length - 1];
}

/** Area two boxes share, 0 when they only touch or are apart. */
export function overlapArea(p: Box, q: Box): number {
  const w = Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x);
  const h = Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Length of the segment from `a` to `b` inside `box` (Liang-Barsky clipping). */
export function segmentLengthInBox(a: Point, b: Point, box: Box): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  let [t0, t1] = [0, 1];
  const edges: [number, number][] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return 0;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1) return 0;
  }
  return (t1 - t0) * Math.hypot(dx, dy);
}

/** A label's box when moved by `offset` from its position with no pass. */
export function labelBoxAt(label: PlacedLabel, offset: Point): Box {
  const at = label.kind === 'path' ? pointOnPath(label.path, label.t0) : label.anchor;
  return shift(label.rel, { x: at.x + offset.x, y: at.y + offset.y });
}

interface Candidate {
  /** Offset from the label's position with no pass. */
  offset: Point;
  t: number | null;
  box: Box;
  move: number;
}

const shift = (b: Box, p: Point): Box => ({ x: b.x + p.x, y: b.y + p.y, width: b.width, height: b.height });
const pad = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m });

function candidates(label: PlacedLabel): Candidate[] {
  if (label.kind === 'path') {
    const base = pointOnPath(label.path, label.t0);
    const ts = [label.t0];
    for (let t = T_MIN; t <= T_MAX + 1e-9; t += T_STEP) {
      const r = Math.round(t * 100) / 100;
      if (Math.abs(r - label.t0) > 1e-9) ts.push(r);
    }
    const list = ts.map((t) => {
      const p = pointOnPath(label.path, t);
      const offset = { x: p.x - base.x, y: p.y - base.y };
      return { offset, t, box: shift(label.rel, p), move: Math.hypot(offset.x, offset.y) };
    });
    // Stable sort: nearest first, the order above breaking ties.
    return list.sort((p, q) => p.move - q.move);
  }
  const n = { x: -label.dir.y, y: label.dir.x };
  const list: Candidate[] = [];
  for (let s = 0; s <= RES_REACH; s += RES_STEP) {
    for (let k = 0; k <= RES_REACH; k += RES_STEP) {
      for (const sign of k === 0 ? [1] : [1, -1]) {
        const offset = { x: label.dir.x * s + n.x * k * sign, y: label.dir.y * s + n.y * k * sign };
        const at = { x: label.anchor.x + offset.x, y: label.anchor.y + offset.y };
        list.push({ offset, t: null, box: shift(label.rel, at), move: Math.hypot(offset.x, offset.y) });
      }
    }
  }
  return list.sort((p, q) => p.move - q.move);
}

function envelope(boxes: readonly Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const touches = (p: Box, q: Box): boolean =>
  p.x <= q.x + q.width && q.x <= p.x + p.width && p.y <= q.y + q.height && q.y <= p.y + p.height;

/**
 * Place `labels` clear of each other and of `obstacles`. Returns each
 * label's offset from its position with no pass (zero for a label left in
 * place), the path parameter of each coefficient label, and the labels no
 * candidate could clear. The same input gives the same output.
 */
export function placeLabels(labels: readonly PlacedLabel[], obstacles: Obstacles): Placement {
  const cands = labels.map(candidates);
  const reach = cands.map((cs) => pad(envelope(cs.map((c) => c.box)), PAD));
  // Only what a label can reach from any candidate can cost it anything.
  const nearBoxes = reach.map((r) => obstacles.boxes.filter((b) => touches(r, b)));
  const nearSegs = labels.map((l, i) =>
    l.kind === 'residual'
      ? obstacles.segments.filter((s) => s.owner !== l.id && touches(reach[i], envelope([{ ...s.a, width: 0, height: 0 }, { ...s.b, width: 0, height: 0 }])))
      : [],
  );
  const neighbors = reach.map((r, i) => reach.flatMap((q, j) => (j !== i && touches(r, q) ? [j] : [])));

  // Obstacles do not move, so what they cost each candidate is worked out once.
  const padded = cands.map((cs) => cs.map((c) => pad(c.box, PAD)));
  const fixedCost = padded.map((bs, i) =>
    bs.map((b) => {
      let cost = 0;
      for (const o of nearBoxes[i]) cost += overlapArea(b, o);
      for (const s of nearSegs[i]) cost += SEGMENT_COST * segmentLengthInBox(s.a, s.b, b);
      return cost;
    }),
  );
  const chosen = cands.map(() => 0);
  const overlapCost = (i: number, c: number): number => {
    const b = padded[i][c];
    let cost = fixedCost[i][c];
    for (const j of neighbors[i]) cost += overlapArea(b, padded[j][chosen[j]]);
    return cost;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      let best = chosen[i];
      const here = overlapCost(i, best);
      // Clear and unmoved is the least any candidate can cost: nothing to try.
      if (here === 0 && cands[i][best].move === 0) continue;
      let bestCost = here + MOVE_COST * cands[i][best].move;
      for (let c = 0; c < cands[i].length; c++) {
        if (c === best) continue;
        const cost = overlapCost(i, c) + MOVE_COST * cands[i][c].move;
        if (cost < bestCost - 1e-9) [best, bestCost] = [c, cost];
      }
      if (best !== chosen[i]) {
        chosen[i] = best;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const offsets = new Map<string, Point>();
  const t = new Map<string, number>();
  const unresolved: string[] = [];
  labels.forEach((l, i) => {
    const c = cands[i][chosen[i]];
    offsets.set(l.id, c.offset);
    if (c.t !== null) t.set(l.id, c.t);
    if (overlapCost(i, chosen[i]) > 0) unresolved.push(l.id);
  });
  return { offsets, t, unresolved };
}
