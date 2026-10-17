/**
 * Pointer selection on the canvas: node press and release (rules in
 * `interaction.ts`), edge clicks, and marquee selection on empty canvas.
 * `wireSelection` lists the gestures.
 */
import { useStore } from '../state/store.js';
import type { Point } from '../layout/index.js';
import type { GroupSelection } from './svg.js';
import { exceedsClickThreshold, nodePointerSelection, type SelectionChange } from './interaction.js';

export interface SelectionWiring {
  destroy(): void;
}

/**
 * Wire pointer events for selection:
 *   - nodes: press and release follow `nodePointerSelection` (pressing a
 *     selected node keeps the group so it can be dragged; a click, meaning
 *     travel under the click threshold, collapses to the node or, with
 *     Shift, toggles it). Dragging itself is handled by `drag.ts`.
 *   - click on an edge = single select edge
 *   - shift+click on an edge = additive
 *   - mousedown on empty canvas + drag = marquee rect select (nodes only)
 *   - click on empty canvas (no drag) = clear selection
 */
export function wireSelection(
  svg: SVGSVGElement,
  marqueeG: GroupSelection,
  redraw: () => void,
): SelectionWiring {
  /** Marquee anchor in SVG coordinates, while a marquee is live. */
  let marqueeStart: { x: number; y: number } | null = null;
  /** The same press in client coordinates, for the click threshold. */
  let marqueeClientStart: Point = { x: 0, y: 0 };
  let marqueeShift = false;
  /** True once the pointer crossed the click threshold (a drag, not a click). */
  let didMarquee = false;

  /** A press on a node, kept until its release decides click vs drag. */
  let nodePress: {
    id: string;
    shift: boolean;
    pointerId: number;
    /** Node selection at press time. */
    selection: ReadonlySet<string>;
    start: Point;
    moved: boolean;
  } | null = null;

  const applyNodeChange = (change: SelectionChange | null): boolean => {
    if (!change) return false;
    const store = useStore.getState();
    store.setSelection(change.nodes);
    if (change.clearEdges) store.clearEdgeSelection();
    return true;
  };

  const endMarquee = (): void => {
    marqueeG.selectAll('rect.marquee').remove();
    marqueeStart = null;
    didMarquee = false;
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Element;
    const nodeEl = target.closest('g.node') as SVGGElement | null;
    const edgeEl = target.closest('g.edge') as SVGGElement | null;

    if (nodeEl) {
      const id = nodeEl.getAttribute('data-id');
      if (!id) return;
      const selection = new Set(useStore.getState().selection);
      nodePress = {
        id,
        shift: event.shiftKey,
        pointerId: event.pointerId,
        selection,
        start: { x: event.clientX, y: event.clientY },
        moved: false,
      };
      if (applyNodeChange(nodePointerSelection(selection, id, event.shiftKey, 'press', false))) {
        redraw();
      }
      return;
    }

    if (edgeEl) {
      const id = edgeEl.getAttribute('data-id');
      if (!id) return;
      const store = useStore.getState();
      if (event.shiftKey) {
        store.toggleEdgeSelection(id);
      } else {
        store.setEdgeSelection([id]);
        store.clearSelection();
      }
      redraw();
      return;
    }

    // Empty canvas - start marquee.
    if (event.button !== 0) return;
    const pt = clientToSvg(svg, event.clientX, event.clientY);
    marqueeStart = pt;
    marqueeClientStart = { x: event.clientX, y: event.clientY };
    marqueeShift = event.shiftKey;
    didMarquee = false;
    if (!event.shiftKey) {
      useStore.getState().clearAllSelection();
      redraw();
    }
    svg.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!marqueeStart) return;
    const pt = clientToSvg(svg, event.clientX, event.clientY);
    const x = Math.min(marqueeStart.x, pt.x);
    const y = Math.min(marqueeStart.y, pt.y);
    const w = Math.abs(pt.x - marqueeStart.x);
    const h = Math.abs(pt.y - marqueeStart.y);
    // Click versus drag uses the same client-space rule as node presses.
    if (!didMarquee) {
      didMarquee = exceedsClickThreshold(marqueeClientStart, { x: event.clientX, y: event.clientY });
    }

    const join = marqueeG.selectAll<SVGRectElement, null>('rect.marquee').data([null]);
    join
      .enter()
      .append('rect')
      .attr('class', 'marquee')
      .attr('fill', 'rgba(59,130,246,0.1)')
      .attr('stroke', '#3b82f6')
      .attr('stroke-dasharray', '4 2')
      .merge(join as never)
      .attr('x', x)
      .attr('y', y)
      .attr('width', w)
      .attr('height', h);
  };

  // Node presses are tracked on the window: during a drag the pointer can
  // leave the canvas before it is released.
  const onWindowPointerMove = (event: PointerEvent) => {
    if (!nodePress || event.pointerId !== nodePress.pointerId || nodePress.moved) return;
    nodePress.moved = exceedsClickThreshold(nodePress.start, { x: event.clientX, y: event.clientY });
  };

  const onWindowPointerUp = (event: PointerEvent) => {
    if (!nodePress || event.pointerId !== nodePress.pointerId) return;
    const press = nodePress;
    nodePress = null;
    const moved =
      press.moved || exceedsClickThreshold(press.start, { x: event.clientX, y: event.clientY });
    if (applyNodeChange(nodePointerSelection(press.selection, press.id, press.shift, 'release', moved))) {
      redraw();
    }
  };

  const onWindowPointerCancel = (event: PointerEvent) => {
    if (nodePress && event.pointerId === nodePress.pointerId) nodePress = null;
  };

  // A cancelled pointer (for example a touch taken over by the browser)
  // ends the marquee without changing the selection.
  const onPointerCancel = () => {
    if (marqueeStart) endMarquee();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!marqueeStart) return;
    const end = clientToSvg(svg, event.clientX, event.clientY);
    const x1 = Math.min(marqueeStart.x, end.x);
    const y1 = Math.min(marqueeStart.y, end.y);
    const x2 = Math.max(marqueeStart.x, end.x);
    const y2 = Math.max(marqueeStart.y, end.y);
    const moved =
      didMarquee || exceedsClickThreshold(marqueeClientStart, { x: event.clientX, y: event.clientY });
    endMarquee();

    if (!moved) return;

    const positions = useStore.getState().positions;
    const hits = new Set<string>();
    for (const [id, p] of Object.entries(positions)) {
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) hits.add(id);
    }
    if (marqueeShift) {
      for (const id of useStore.getState().selection) hits.add(id);
    }
    useStore.getState().setSelection(hits);
    if (!marqueeShift) useStore.getState().clearEdgeSelection();
    redraw();
  };

  svg.addEventListener('pointerdown', onPointerDown as EventListener);
  svg.addEventListener('pointermove', onPointerMove as EventListener);
  svg.addEventListener('pointerup', onPointerUp as EventListener);
  svg.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);

  return {
    destroy() {
      svg.removeEventListener('pointerdown', onPointerDown as EventListener);
      svg.removeEventListener('pointermove', onPointerMove as EventListener);
      svg.removeEventListener('pointerup', onPointerUp as EventListener);
      svg.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
    },
  };
}

function clientToSvg(svg: SVGSVGElement, cx: number, cy: number): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = cx;
  pt.y = cy;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: cx, y: cy };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}
