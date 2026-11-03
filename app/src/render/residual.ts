/**
 * Pure geometry for residuals and covariance curves, worked out from a
 * node's current box so both follow a dragged node (docs/diagram-conventions.md
 * D4, D5, D8). The layout stores only sides.
 */
import type { LayoutResult, Point, Side } from '../layout/index.js';
import type { GraphEdge } from '../model/graph.js';
import { boundaryPoint, type Box } from './geometry.js';
import type { NodeShape } from './styles.js';

/**
 * How a residual is drawn. One style today, Mplus's short arrow into the
 * variable (Kline's compact form, Raykov Fig 5); another style adds a
 * member here and a case in `residualGeometry`.
 */
export type ResidualStyle = 'compact-arrow';

/** The style residuals are drawn in; a setting once there is a second one. */
export const RESIDUAL_STYLE: ResidualStyle = 'compact-arrow';

/** Length of a residual arrow. */
export const RESIDUAL_LENGTH = 36;
/** Distance from an arrow's tail to its value. */
const LABEL_OFFSET = 6;

export interface ResidualGeometry {
  tail: Point;
  tip: Point;
  labelAnchor: Point;
  textAnchor: 'start' | 'middle' | 'end';
}

/**
 * Direction a residual arrow comes from. A latent's arrives diagonally
 * from the upper or lower left, as Mplus draws it; a box's arrives square
 * to its side.
 */
function residualDirection(shape: NodeShape, side: Side): Point {
  const diagonal = shape === 'ellipse';
  switch (side) {
    case 'right':
      return { x: 1, y: 0 };
    case 'left':
      return { x: -1, y: 0 };
    case 'top':
      return diagonal ? { x: -Math.SQRT1_2, y: -Math.SQRT1_2 } : { x: 0, y: -1 };
    case 'bottom':
      return diagonal ? { x: -Math.SQRT1_2, y: Math.SQRT1_2 } : { x: 0, y: 1 };
  }
}

export function residualGeometry(
  style: ResidualStyle,
  box: Box,
  shape: NodeShape,
  side: Side,
  gap = 0,
): ResidualGeometry {
  switch (style) {
    case 'compact-arrow': {
      const dir = residualDirection(shape, side);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const far = { x: cx + dir.x * (box.width + box.height), y: cy + dir.y * (box.width + box.height) };
      const tip = boundaryPoint(box, shape, far, gap);
      const tail = { x: tip.x + dir.x * RESIDUAL_LENGTH, y: tip.y + dir.y * RESIDUAL_LENGTH };
      const labelAnchor = { x: tail.x + dir.x * LABEL_OFFSET, y: tail.y + dir.y * LABEL_OFFSET };
      const textAnchor = dir.x > 0.5 ? 'start' : dir.x < -0.5 ? 'end' : 'middle';
      return { tail, tip, labelAnchor, textAnchor };
    }
  }
}

export interface CurveGeometry {
  /** SVG path data, a quadratic Bezier from `a` to `b`. */
  d: string;
  control: Point;
  /** Point on the curve halfway along, for the value label. */
  mid: Point;
}

/** Bulge of a curve: a minimum, plus a share of the distance it spans. */
const BULGE_MIN = 30;
const BULGE_SHARE = 0.25;

/**
 * A curve from `a` to `b` bulging towards `side`, beyond both ends, by
 * more the further apart they are, so a curve joining the ends of a tall
 * column passes outside the boxes between them.
 */
export function curveGeometry(a: Point, b: Point, side: Side): CurveGeometry {
  const bulge = BULGE_MIN + BULGE_SHARE * Math.hypot(b.x - a.x, b.y - a.y);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const control: Point =
    side === 'left'
      ? { x: Math.min(a.x, b.x) - bulge, y: my }
      : side === 'right'
        ? { x: Math.max(a.x, b.x) + bulge, y: my }
        : side === 'top'
          ? { x: mx, y: Math.min(a.y, b.y) - bulge }
          : { x: mx, y: Math.max(a.y, b.y) + bulge };
  const mid = { x: 0.25 * a.x + 0.5 * control.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * control.y + 0.25 * b.y };
  return { d: `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`, control, mid };
}

export interface OverlayGeometry {
  residuals: Map<string, ResidualGeometry>;
  curves: Map<string, CurveGeometry>;
}

/**
 * Residuals and covariance curves for the layout's current node boxes.
 * Shared by the renderer and the view fit, so the two agree. A curve
 * attached to residuals runs between their tails; otherwise between the
 * node outlines, each end pointing at the curve's control point.
 */
export function overlayGeometry(
  layout: LayoutResult,
  edges: readonly GraphEdge[],
  shapeOf: (id: string) => NodeShape,
  gap = 0,
): OverlayGeometry {
  const boxes = new Map(layout.nodes.map((n) => [n.id, n]));
  const residuals = new Map<string, ResidualGeometry>();
  for (const r of layout.residuals ?? []) {
    const b = boxes.get(r.id);
    if (b) residuals.set(r.id, residualGeometry(RESIDUAL_STYLE, b, shapeOf(r.id), r.side, gap));
  }
  const curves = new Map<string, CurveGeometry>();
  const centre = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const byId = new Map(edges.map((e) => [e.id, e]));
  for (const l of layout.edges) {
    const e = byId.get(l.id);
    if (!l.curve || !e) continue;
    const [ba, bb] = [boxes.get(e.from), boxes.get(e.to)];
    if (!ba || !bb) continue;
    const [ra, rb] = [residuals.get(e.from), residuals.get(e.to)];
    if (l.curve.attach === 'residual' && ra && rb) {
      curves.set(l.id, curveGeometry(ra.tail, rb.tail, l.curve.side));
      continue;
    }
    const rough = curveGeometry(centre(ba), centre(bb), l.curve.side).control;
    const a = boundaryPoint(ba, shapeOf(e.from), rough, gap);
    const b = boundaryPoint(bb, shapeOf(e.to), rough, gap);
    curves.set(l.id, curveGeometry(a, b, l.curve.side));
  }
  return { residuals, curves };
}

/** Rough width of a value label, so the view fit leaves room for it. */
const LABEL_ROOM = 50;

/**
 * Points the view must contain for the overlay: each residual's tail and
 * value, and each curve's control point (a quadratic curve lies within the
 * triangle of its ends and control point).
 */
export function overlayPoints(o: OverlayGeometry): Point[] {
  const points: Point[] = [];
  for (const r of o.residuals.values()) {
    const dx = r.textAnchor === 'start' ? LABEL_ROOM : r.textAnchor === 'end' ? -LABEL_ROOM : 0;
    points.push(r.tail, r.labelAnchor, { x: r.labelAnchor.x + dx, y: r.labelAnchor.y });
  }
  for (const c of o.curves.values()) points.push(c.control);
  return points;
}
