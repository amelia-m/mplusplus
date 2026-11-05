/**
 * Zoom and pan of the canvas, and when the view fits the diagram.
 *
 * The view is a view, not the diagram: it is not in the undo history and is
 * not autosaved (Amelia, 2026-10-26 and 2026-10-27). A loaded, restored or
 * re-laid-out diagram is fitted; nothing else refits it (Amelia, 2026-10-27,
 * "fit on load, Re-run layout and the Fit button only"), and a fit may zoom
 * past 1:1 (2026-10-30), up to `MAX_SCALE`.
 *
 * Gestures (`wireZoom`): the wheel pans (Shift+wheel pans sideways); Ctrl or
 * Cmd + wheel, and a trackpad pinch (which browsers send as a wheel event
 * with `ctrlKey`), zoom around the pointer; a middle-button drag pans; on
 * touch, two fingers pinch and pan together, while one finger keeps drawing
 * the selection box or dragging a node.
 *
 * The math is pure and tested; `wireZoom` only reads events and applies the
 * result as the SVG `viewBox`. Pointer-to-diagram mapping elsewhere
 * (`selection.ts`, `drag.ts`) goes through the SVG's screen CTM, which
 * follows the viewBox, so their arithmetic stays in diagram units.
 */
import type { Point } from '../layout/index.js';
import type { ViewBox } from '../ui/viewBox.js';

/**
 * Where the canvas looks: the diagram point at the element's top-left
 * corner, and the zoom in CSS pixels per diagram unit (1 is 1:1).
 */
export interface View {
  x: number;
  y: number;
  scale: number;
}

/** The canvas element's content box in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/** Zoom limits for wheel and pinch, in CSS pixels per diagram unit. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

/**
 * `next` kept within the zoom limits. A view already outside them (a fit of
 * a very large diagram is below `MIN_SCALE`) may stay where it is or move
 * back towards the range, but never further out.
 */
export function clampScale(next: number, current: number): number {
  const lo = Math.min(MIN_SCALE, current);
  const hi = Math.max(MAX_SCALE, current);
  return Math.min(hi, Math.max(lo, next));
}

const usable = (size: Size): boolean =>
  Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;

/**
 * The view that shows all of `content`, centered. It zooms past 1:1 for a
 * small diagram, up to `MAX_SCALE`, but is never limited below: the whole
 * diagram must be visible however large it is.
 */
export function fitView(content: ViewBox, size: Size): View {
  const scale = Math.min(MAX_SCALE, size.width / content.width, size.height / content.height);
  return {
    x: content.x + content.width / 2 - size.width / (2 * scale),
    y: content.y + content.height / 2 - size.height / (2 * scale),
    scale,
  };
}

/** The `viewBox` that draws `view` in an element of `size`; its aspect matches the element's. */
export function viewToViewBox(view: View, size: Size): ViewBox {
  return { x: view.x, y: view.y, width: size.width / view.scale, height: size.height / view.scale };
}

/** A point in the element's local CSS pixels (from its top-left) in diagram units. */
export function screenToDiagram(view: View, local: Point): Point {
  return { x: view.x + local.x / view.scale, y: view.y + local.y / view.scale };
}

/** Zoom by `factor` (clamped) keeping the diagram point under `local` in place. */
export function zoomAt(view: View, factor: number, local: Point): View {
  const scale = clampScale(view.scale * factor, view.scale);
  const d = screenToDiagram(view, local);
  return { x: d.x - local.x / scale, y: d.y - local.y / scale, scale };
}

/** Move the view with the pointer: the diagram follows a drag of `dx`, `dy` screen pixels. */
export function panBy(view: View, dx: number, dy: number): View {
  return { x: view.x - dx / view.scale, y: view.y - dy / view.scale, scale: view.scale };
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Two-finger pinch and pan from `start` (the view when the second finger
 * landed): the zoom follows the change in finger distance, and the diagram
 * point under the fingers' starting midpoint stays under their midpoint now.
 * Points are in local CSS pixels.
 */
export function pinchView(start: View, a0: Point, b0: Point, a: Point, b: Point): View {
  const d0 = dist(a0, b0);
  const ratio = d0 > 0 ? dist(a, b) / d0 : 1;
  const scale = clampScale(start.scale * ratio, start.scale);
  const anchor = screenToDiagram(start, mid(a0, b0));
  const m = mid(a, b);
  return { x: anchor.x - m.x / scale, y: anchor.y - m.y / scale, scale };
}

/** The view after the element changed size: same zoom, same diagram point at the center. */
export function resizeView(view: View, from: Size, to: Size): View {
  const c = screenToDiagram(view, { x: from.width / 2, y: from.height / 2 });
  return { x: c.x - to.width / (2 * view.scale), y: c.y - to.height / (2 * view.scale), scale: view.scale };
}

/** The fields of a `WheelEvent` the wheel rule reads. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages (`WheelEvent.DOM_DELTA_*`). */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Pixels per line for a line-mode wheel. */
const LINE_PX = 16;
/** Zoom per pixel of wheel travel, as a power of 2, and its cap per event. */
const ZOOM_PER_PX = 0.01;
const MAX_ZOOM_STEP = 0.5;

/**
 * What a wheel event does: with Ctrl or Cmd (a trackpad pinch sets
 * `ctrlKey`), zoom around the pointer, at most 2^0.5 per event, so a mouse
 * notch and a pinch step both feel even; otherwise pan by the wheel's travel
 * (Shift turns a vertical wheel sideways when the browser has not already).
 * `pageHeight` converts page-mode deltas.
 */
export function wheelAction(
  e: WheelInput,
  pageHeight: number,
): { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number } {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pageHeight : 1;
  let dx = e.deltaX * unit;
  let dy = e.deltaY * unit;
  if (e.ctrlKey || e.metaKey) {
    const step = Math.max(-MAX_ZOOM_STEP, Math.min(MAX_ZOOM_STEP, -dy * ZOOM_PER_PX));
    return { kind: 'zoom', factor: 2 ** step };
  }
  if (e.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  // The wheel scrolls the view over the diagram, so the diagram moves the other way.
  return { kind: 'pan', dx: -dx, dy: -dy };
}

/** The view after a wheel event at `local`. */
export function applyWheel(view: View, e: WheelInput, local: Point, size: Size): View {
  const action = wheelAction(e, size.height);
  return action.kind === 'zoom' ? zoomAt(view, action.factor, local) : panBy(view, action.dx, action.dy);
}

/**
 * When the view fits the diagram, and the view itself. `update` runs on
 * every redraw: it fits when there is no view yet, when the layout object
 * differs from the one last fitted (a load, a restore or Re-run layout:
 * `loadGraph` is the only place the store replaces it), or after
 * `requestFit` (the Fit button); every other redraw (an edit, an undo, an
 * attached `.out`) keeps the view as it is. Not undoable and not saved.
 */
export class ViewController {
  private view: View | null = null;
  private size: Size | null = null;
  private fittedLayout: unknown = undefined;
  private fitRequested = false;
  private content: ViewBox | null = null;

  /** Fit at the next `update`. */
  requestFit(): void {
    this.fitRequested = true;
  }

  /**
   * The `viewBox` to draw with, given the diagram's content box (the fit
   * target, also what an export shows) and the element's size. An element
   * with no size yet (hidden) gets the content box, and is fitted once it has one.
   */
  update(layout: unknown, content: ViewBox, size: Size): ViewBox {
    this.content = content;
    if (!usable(size)) {
      // Hidden: keep any view for when it is shown again.
      return this.view && this.size ? viewToViewBox(this.view, this.size) : content;
    }
    if (!this.view || this.fitRequested || layout !== this.fittedLayout) {
      this.view = fitView(content, size);
      this.fittedLayout = layout;
      this.fitRequested = false;
    } else if (this.size && (this.size.width !== size.width || this.size.height !== size.height)) {
      this.view = resizeView(this.view, this.size, size);
    }
    this.size = size;
    return viewToViewBox(this.view, size);
  }

  /** Change the view with `fn` (a zoom or pan); null when there is no view to change. */
  change(fn: (view: View, size: Size) => View): ViewBox | null {
    if (!this.view || !this.size) return null;
    this.view = fn(this.view, this.size);
    return viewToViewBox(this.view, this.size);
  }

  /** The current view, or null before the first fit. */
  get current(): View | null {
    return this.view;
  }

  /** The content box of the last update: the whole diagram, which exports show. */
  get contentBox(): ViewBox | null {
    return this.content;
  }
}

export interface ZoomWiringHooks {
  /** Show the view: set the canvas's `viewBox`. */
  apply(vb: ViewBox): void;
  /**
   * Stop one-finger gestures (the selection box, a node drag). Called when a
   * second finger lands and on every move of the pinch: d3-drag starts its
   * drag from `touchstart`, which comes after the `pointerdown` that starts
   * the pinch, so a drag begun by the second finger is stopped at its first
   * move, before it has moved anything.
   */
  stopOneFingerGestures(): void;
}

export interface ZoomWiring {
  destroy(): void;
}

/** The element's content-box size, in CSS pixels. */
export function elementSize(el: Element): Size {
  return { width: el.clientWidth, height: el.clientHeight };
}

/** `clientX/Y` in the element's local CSS pixels (inside its border). */
function localPoint(el: Element, clientX: number, clientY: number): Point {
  const r = el.getBoundingClientRect();
  return { x: clientX - r.left - el.clientLeft, y: clientY - r.top - el.clientTop };
}

/**
 * Wire wheel, middle-button and two-finger gestures on `svg` to
 * `controller`. Kept thin: every number comes from the pure functions above.
 */
export function wireZoom(svg: SVGSVGElement, controller: ViewController, hooks: ZoomWiringHooks): ZoomWiring {
  const touches = new Map<number, Point>();
  let pinch: { start: View; a0: Point; b0: Point; ids: [number, number] } | null = null;
  let pan: { pointerId: number; last: Point } | null = null;

  const show = (vb: ViewBox | null): void => {
    if (vb) hooks.apply(vb);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const local = localPoint(svg, e.clientX, e.clientY);
    show(controller.change((v, size) => applyWheel(v, e, local, size)));
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      // The first finger of a new touch: forget any touch whose end was missed.
      if (e.isPrimary) {
        touches.clear();
        pinch = null;
      }
      touches.set(e.pointerId, localPoint(svg, e.clientX, e.clientY));
      if (touches.size === 2 && controller.current) {
        const [[ia, a0], [ib, b0]] = Array.from(touches.entries()) as [[number, Point], [number, Point]];
        pinch = { start: controller.current, a0, b0, ids: [ia, ib] };
        hooks.stopOneFingerGestures();
      }
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      pan = { pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY } };
      svg.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (pan && e.pointerId === pan.pointerId) {
      const dx = e.clientX - pan.last.x;
      const dy = e.clientY - pan.last.y;
      pan.last = { x: e.clientX, y: e.clientY };
      show(controller.change((v) => panBy(v, dx, dy)));
      return;
    }
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, localPoint(svg, e.clientX, e.clientY));
    if (!pinch) return;
    const a = touches.get(pinch.ids[0]);
    const b = touches.get(pinch.ids[1]);
    if (!a || !b) return;
    const p = pinch;
    hooks.stopOneFingerGestures();
    show(controller.change(() => pinchView(p.start, p.a0, p.b0, a, b)));
  };

  const onPointerEnd = (e: PointerEvent): void => {
    if (pan && e.pointerId === pan.pointerId) pan = null;
    if (touches.delete(e.pointerId) && pinch && pinch.ids.includes(e.pointerId)) pinch = null;
  };

  // Windows starts autoscroll on a middle-button mousedown.
  const onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('mousedown', onMouseDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);

  return {
    destroy() {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    },
  };
}
