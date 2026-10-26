/**
 * Pure decision logic for pointer interaction on nodes. The DOM handlers in
 * `drag.ts` and `selection.ts` stay thin and call into these.
 */
import type { Point } from '../layout/index.js';
import type { Box } from './geometry.js';

/** Pointer travel (screen px) below which a press-and-release is a click. */
export const CLICK_THRESHOLD_PX = 3;

export function exceedsClickThreshold(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= CLICK_THRESHOLD_PX;
}

/**
 * Whether a node drag should move nodes yet. A drag stays a click (no
 * movement, no undo gesture) until the pointer has travelled the click
 * threshold from the press, in client (screen) coordinates, the same rule
 * `selection.ts` uses to tell a click from a drag. Once started it keeps
 * moving, even if the pointer comes back inside the threshold.
 */
export function dragShouldMove(clientStart: Point, clientNow: Point, alreadyStarted: boolean): boolean {
  return alreadyStarted || exceedsClickThreshold(clientStart, clientNow);
}

/** Pointer identity as d3-drag reports it: `'mouse'` or a touch identifier. */
export type DragPointerId = string | number;

/**
 * What a drag `start` does, given the pointer of the active session (null
 * when none is active):
 *   - `begin`:   no session is active; start one.
 *   - `replace`: the same pointer starts again, so the previous session's
 *                end was missed; end it, then start a new one.
 *   - `ignore`:  a different pointer (a second touch) while a session is
 *                active; the active drag keeps going.
 */
export function dragStartAction(
  active: DragPointerId | null,
  incoming: DragPointerId,
): 'begin' | 'replace' | 'ignore' {
  if (active === null) return 'begin';
  return active === incoming ? 'replace' : 'ignore';
}

/**
 * New positions for a group drag: every node moves by the pointer's travel
 * since `pointerStart` (`drag.ts` passes the press point, mapped into the
 * container's space as it is when the drag begins), so the nodes keep
 * their offsets from the pointer and from each other.
 */
export function groupDragPositions(
  start: ReadonlyMap<string, Box>,
  pointerStart: Point,
  pointer: Point,
): Record<string, Box> {
  const dx = pointer.x - pointerStart.x;
  const dy = pointer.y - pointerStart.y;
  const out: Record<string, Box> = {};
  for (const [id, s] of start) {
    out[id] = { x: s.x + dx, y: s.y + dy, width: s.width, height: s.height };
  }
  return out;
}

export interface SelectionChange {
  nodes: Set<string>;
  /** True when the edge selection should be cleared as well. */
  clearEdges: boolean;
}

/**
 * Node selection on press and on release, standard editor behaviour.
 *
 * `selection` is the node selection at the moment of the press, for both
 * phases, so the release can tell whether the node was already selected.
 * Returns null when the selection should not change.
 *
 * Press:
 *   - on a selected node (Shift or not): keep the selection, so a drag that
 *     follows moves the whole group.
 *   - on an unselected node: select only it (Shift: add it).
 * Release:
 *   - after a drag (`moved`): no change.
 *   - click on a node that was selected at press: collapse the selection to
 *     it (Shift: toggle it out).
 *   - click on a node that was unselected at press: no change (the press
 *     already selected it).
 */
export function nodePointerSelection(
  selection: ReadonlySet<string>,
  target: string,
  shift: boolean,
  phase: 'press' | 'release',
  moved: boolean,
): SelectionChange | null {
  const wasSelected = selection.has(target);
  if (phase === 'press') {
    if (wasSelected) return null;
    if (shift) return { nodes: new Set([...selection, target]), clearEdges: false };
    return { nodes: new Set([target]), clearEdges: true };
  }
  if (moved || !wasSelected) return null;
  if (shift) {
    const nodes = new Set(selection);
    nodes.delete(target);
    return { nodes, clearEdges: false };
  }
  return { nodes: new Set([target]), clearEdges: true };
}
