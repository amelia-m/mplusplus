/**
 * The canvas viewBox follows the diagram: the bounds of the node boxes and
 * edge bend points plus padding, so nodes dragged or laid out beyond the
 * initial area, and edges routed outside the nodes, stay visible.
 *
 * This content box is recomputed on every redraw: it is what a fit shows
 * and what an export draws. What the canvas shows (zoom and pan, and when it
 * fits) is `render/zoom.ts`.
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

export interface CaptionPlacement {
  /** `vb` with room added underneath for the caption's lines. */
  viewBox: ViewBox;
  /** Start of the first line's baseline. */
  at: Point;
  fontSize: number;
  /** Distance between baselines. */
  lineHeight: number;
}

/** Smallest caption, and the view width it shrinks to per unit of font size. */
const CAPTION_MIN_FONT = 14;
const CAPTION_WIDTHS_PER_FONT = 70;

/**
 * Place `lines` lines of caption under the content. A fit and an export
 * scale the content to the canvas or the page, so a fixed font size would be
 * unreadable on a wide diagram: the size follows the content's width.
 */
export function placeCaption(vb: ViewBox, lines: number): CaptionPlacement {
  const fontSize = Math.max(CAPTION_MIN_FONT, vb.width / CAPTION_WIDTHS_PER_FONT);
  const lineHeight = 1.2 * fontSize;
  return {
    viewBox: { ...vb, height: vb.height + lines * lineHeight },
    at: { x: vb.x + VIEWBOX_PADDING, y: vb.y + vb.height + 0.9 * fontSize },
    fontSize,
    lineHeight,
  };
}

/** `vb` widened if needed so text from `textX`, `textWidth` long, keeps the padding. */
export function widenToFit(vb: ViewBox, textX: number, textWidth: number): ViewBox {
  const right = textX + textWidth + VIEWBOX_PADDING;
  return { ...vb, width: Math.max(vb.width, right - vb.x) };
}

export function formatViewBox(vb: ViewBox): string {
  return `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;
}
