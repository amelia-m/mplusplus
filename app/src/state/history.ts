/**
 * The one entry point for undo and redo, shared by the keyboard shortcuts
 * and the toolbar buttons, so both follow the same rules.
 */
import { isGestureActive } from './gesture.js';
import { useStore } from './store.js';

interface TemporalHistory {
  undo(): void;
  redo(): void;
}

// Same cast shape as elsewhere: zundo attaches `temporal` as a sibling store.
const temporal = (): TemporalHistory =>
  (useStore as unknown as { temporal: { getState(): TemporalHistory } }).temporal.getState();

/**
 * Undo one step. Does nothing while a gesture (a drag or a slider scrub) is
 * active: undoing mid-gesture would be overwritten by the gesture's next
 * change and its end would push a stale snapshot. Returns false when it
 * refused for that reason, so the caller can skip the redraw.
 */
export function undoHistory(): boolean {
  if (isGestureActive()) return false;
  temporal().undo();
  return true;
}

/** Redo one step, under the same gesture rule as `undoHistory`. */
export function redoHistory(): boolean {
  if (isGestureActive()) return false;
  temporal().redo();
  return true;
}
