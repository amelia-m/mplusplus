/**
 * Node dragging with d3-drag. One shared drag behaviour and one drag session
 * at a time, both held at module scope; a drag that moves nodes is one undo
 * gesture (`state/gesture.ts`).
 * The decisions (click threshold, which pointer may start, group positions)
 * are pure functions in `interaction.ts`.
 */
import { drag, type D3DragEvent, type DragBehavior } from 'd3-drag';
import { select } from 'd3-selection';
import type { Point } from '../layout/index.js';
import type { GroupSelection } from './svg.js';
import { useStore, type NodePosition } from '../state/store.js';
import { beginGesture, endGesture, type GestureToken } from '../state/gesture.js';
import {
  clientToLocal,
  dragShouldMove,
  dragStartAction,
  groupDragPositions,
  type AffineMatrix,
  type DragPointerId,
} from './interaction.js';

interface DragSubject {
  id: string;
}

type NodeDragEvent = D3DragEvent<SVGGElement, unknown, DragSubject>;

interface DragSession {
  /** The pointer driving this drag, as d3-drag identifies it. */
  pointer: DragPointerId;
  /** The nodes this drag moves, decided at the press. */
  ids: string[];
  /**
   * Positions of the dragged nodes when the drag began (the first threshold
   * crossing). Read then, not at the press, so a store change between press
   * and threshold (an undo, say) is not overwritten with stale positions.
   */
  starts: Map<string, NodePosition>;
  /**
   * The press point in the container's coordinate space (the space of d3's
   * `event.x/y`), or `null` until the drag begins. It is mapped from
   * `clientStart` at the first threshold crossing, through the container's
   * screen CTM as it is then, not taken from the press event: a viewBox
   * refit between press and crossing (after an undo, say) changes that
   * mapping, and a press point kept in the old one would make the nodes
   * jump. The nodes move by the full pointer travel since the press, so the
   * grab offset holds. Non-null exactly when the drag has begun.
   */
  pointerStart: Point | null;
  /** Press point in client coordinates, for the click threshold and `pointerStart`. */
  clientStart: Point;
  /** The element d3-drag measures `event.x/y` in: the node's parent. */
  container: ParentNode | null;
  /**
   * The undo gesture this drag owns, from `beginGesture` when the drag
   * began. `null` before that, or if another gesture was already active (the
   * drag's changes then belong to that gesture, which this drag must not end).
   */
  gesture: GestureToken | null;
  detach(): void;
}

/**
 * The one active drag session. It lives at module scope, not in the
 * `wireNodeDrag` closure, because `wireNodeDrag` runs on every redraw: a
 * per-closure session would let a stale session from an earlier wiring
 * outlive a new one and keep its gesture open.
 */
let session: DragSession | null = null;

/** The redraw callback of the latest `wireNodeDrag` call. */
let redraw: () => void = () => {};

/** End the active session: detach its listeners and end the gesture it owns, if any. */
function finishSession(): DragSession | null {
  const s = session;
  if (!s) return null;
  session = null;
  s.detach();
  endGesture(s.gesture);
  return s;
}

/**
 * Cancel the node drag in progress, if any: detach its listeners and end
 * the undo gesture it owns. Later events from that pointer are ignored
 * until it is pressed again. Positions already written stay; the caller
 * redraws. Call it before replacing the diagram (file load, Re-run layout)
 * so a drag cannot write stale positions into the new one. A no-op when no
 * drag is active.
 */
export function cancelNodeDrag(): void {
  finishSession();
}

/** The screen CTM of `el` (an SVG element), or null when it has none. */
function screenCtm(el: unknown): AffineMatrix | null {
  const g = el as { getScreenCTM?: () => AffineMatrix | null } | null;
  return typeof g?.getScreenCTM === 'function' ? g.getScreenCTM() : null;
}

/** The pointer's client position for a d3-drag event (mouse or touch). */
function clientPoint(event: NodeDragEvent): Point | null {
  const src = event.sourceEvent as MouseEvent | TouchEvent | null | undefined;
  if (!src) return null;
  if ('changedTouches' in src) {
    for (const t of Array.from(src.changedTouches)) {
      if (t.identifier === event.identifier) return { x: t.clientX, y: t.clientY };
    }
    return null;
  }
  return { x: src.clientX, y: src.clientY };
}

function onStart(this: SVGGElement, event: NodeDragEvent): void {
  const pointer = event.identifier as DragPointerId;
  const action = dragStartAction(session ? session.pointer : null, pointer);
  if (action === 'ignore') return;
  if (action === 'replace') {
    const stale = finishSession();
    if (stale?.pointerStart) redraw();
  }
  const clientStart = clientPoint(event);
  if (!clientStart) return;

  const { selection } = useStore.getState();
  const id = event.subject.id;
  const ids = selection.has(id) ? Array.from(selection) : [id];

  const onCancel = (): void => {
    const s = finishSession();
    if (s?.pointerStart) redraw();
  };
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onCancel);
  session = {
    pointer,
    ids,
    starts: new Map(),
    pointerStart: null,
    clientStart,
    container: this.parentNode,
    gesture: null,
    detach() {
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
    },
  };
}

function onDrag(event: NodeDragEvent): void {
  const s = session;
  if (!s || event.identifier !== s.pointer) return;
  try {
    let origin = s.pointerStart;
    if (!origin) {
      const now = clientPoint(event);
      if (!now || !dragShouldMove(s.clientStart, now, false)) return;
      const { positions } = useStore.getState();
      for (const nid of s.ids) {
        const p = positions[nid];
        if (p) s.starts.set(nid, p);
      }
      origin = clientToLocal(s.clientStart, screenCtm(s.container));
      s.pointerStart = origin;
      s.gesture = beginGesture();
    }
    const updates = groupDragPositions(s.starts, origin, { x: event.x, y: event.y });
    useStore.getState().setNodePositions(updates);
    redraw();
  } catch (err) {
    finishSession();
    throw err;
  }
}

function onEnd(event: NodeDragEvent): void {
  const s = session;
  if (!s || event.identifier !== s.pointer) return;
  try {
    if (s.pointerStart) redraw();
  } finally {
    finishSession();
  }
}

/**
 * The one d3-drag behaviour, shared by every wiring. d3-drag keeps the
 * touches it is tracking in the behaviour's own `gestures` map and binds
 * `touchmove` / `touchend` on the node itself, so binding a new behaviour
 * on each redraw would replace those listeners mid-gesture with ones that
 * know no touch: the drag would stop and its end would be lost. Rebinding
 * the same behaviour re-installs the same listeners and keeps the map.
 * Created on first use so importing this module touches no DOM.
 */
let behaviour: DragBehavior<SVGGElement, unknown, DragSubject> | null = null;

function nodeDragBehaviour(): DragBehavior<SVGGElement, unknown, DragSubject> {
  behaviour ??= drag<SVGGElement, unknown, DragSubject>()
    .subject(function () {
      return { id: this.getAttribute('data-id') ?? '' };
    })
    .on('start', onStart)
    .on('drag', onDrag)
    .on('end', onEnd);
  return behaviour;
}

/**
 * Apply d3-drag to every `g.node` so dragging updates positions in the
 * store, then calls `redrawFn` (kept in module state, so the latest wiring's
 * callback is the one used, even by a drag that began before it). The drag
 * moves the current node selection when the pressed node is part of it,
 * otherwise just that node. Which nodes are selected is decided on
 * `pointerdown` by `selection.ts`, which runs before d3-drag's `mousedown` /
 * `touchstart` start handler.
 *
 * Nothing moves until the pointer crosses the click threshold
 * (`dragShouldMove`), so a click with a little jitter neither moves the node
 * nor adds an undo entry. On the first crossing the drag reads the nodes'
 * start positions, maps the press point into the container's current
 * coordinate space, begins one undo gesture (see `state/gesture.ts`) and
 * moves the nodes by the full pointer travel since the press, which keeps
 * the grab offset; an undo or viewBox refit between press and crossing
 * does not make them jump. The gesture ends on drag end,
 * on `pointercancel` or window `blur`, if updating the drag throws, when a
 * new drag by the same pointer starts (the old end was missed), and on
 * `cancelNodeDrag` (file load, Re-run layout). A second pointer while a
 * drag is active (multi-touch) is ignored (`dragStartAction`).
 *
 * Safe to call on every redraw: it rebinds one shared behaviour (see
 * `nodeDragBehaviour`), so a touch drag in progress keeps going.
 *
 * The subject carries no x/y, so d3 reports `event.x` / `event.y` as the
 * pointer position in the nodes' coordinate space.
 */
export function wireNodeDrag(nodesG: GroupSelection, redrawFn: () => void): void {
  redraw = redrawFn;
  const nodes = nodesG.selectAll<SVGGElement, unknown>('g.node');
  nodes.call(nodeDragBehaviour() as never);
  // Also visually flag draggable cursor.
  nodes.each(function () {
    select(this).style('cursor', 'grab');
  });
}
