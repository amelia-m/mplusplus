/**
 * The canvas viewBox follows the diagram: the bounds of the node boxes and
 * edge bend points plus padding, so nodes dragged or laid out beyond the
 * initial area, and edges routed outside the nodes, stay visible.
 *
 * `main.ts` refits after every change. That fit policy (when to fit, whether
 * to zoom past 1:1, whether edits may shrink or re-centre the view) awaits a
 * decision; see "Canvas fit policy" in TODO.md.
 */
import type { Point } from '../layout/index.js';

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Used before a file is loaded and for a graph with no drawable node. */
export const DEFAULT_VIEWBOX: Readonly<ViewBox> = { x: 0, y: 0, width: 1200, height: 800 };

/** Room around the content for strokes, arrowheads and edge labels. */
export const VIEWBOX_PADDING = 40;

export interface ContentViewBoxOptions {
  /**
   * Edge geometry drawn outside the node boxes: the layout's bend points.
   * Every other point the renderer draws an edge through lies inside the
   * hull of these and the node boxes (boundary points sit on node outlines,
   * Bezier control points are midpoints, and the label anchor is a bend
   * point or the midpoint of the endpoints), so these are enough.
   */
  points?: Iterable<Point>;
  padding?: number;
}

/**
 * Bounds of the node boxes and edge points, plus padding. Falls back to the
 * default when no node has finite geometry: with no node no edge is drawn,
 * so points alone never set the view.
 */
export function contentViewBox(boxes: Iterable<Box>, options: ContentViewBoxOptions = {}): ViewBox {
  const padding = options.padding ?? VIEWBOX_PADDING;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    const x2 = b.x + b.width;
    const y2 = b.y + b.height;
    if (![b.x, b.y, x2, y2].every(Number.isFinite)) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }
  if (minX > maxX || minY > maxY) return { ...DEFAULT_VIEWBOX };
  for (const p of options.points ?? []) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + 2 * padding,
    height: maxY - minY + 2 * padding,
  };
}

export function formatViewBox(vb: ViewBox): string {
  return `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;
}
