/**
 * Undo gestures: coalesce a continuous interaction (a node drag, a slider
 * scrub) into exactly one undo entry.
 *
 * This module is the only place that touches zundo's `pause` / `resume`.
 *
 * Mechanism (snapshot at begin, push at end): `beginGesture()` snapshots the
 * undo-relevant slice (`historySlice`) and pauses tracking at once, so
 * nothing inside the gesture is recorded by zundo. Ending it resumes
 * tracking and, if the slice differs from the snapshot by value
 * (`historyEqual`, so a drag that ends where it started does not count),
 * pushes the snapshot onto `pastStates` as one entry, trimmed to
 * `HISTORY_LIMIT`, and clears `futureStates`, exactly as zundo does for an
 * ordinary change. This relies
 * only on zundo's public temporal state, not on the order in which zundo
 * and store listeners run.
 *
 * Contract:
 *   - `beginGesture()` starts a gesture and returns a token that owns it.
 *     Calling it while a gesture is active returns `null` and changes
 *     nothing (gestures do not nest).
 *   - `endGesture(token)` ends the gesture only if `token` owns the active
 *     one. A `null` token, a stale token (its gesture already ended) or any
 *     other token is a no-op, so one interaction can never end another's
 *     gesture, and it is safe to call from every handler that might end a
 *     gesture (`change`, `pointerup`, `pointercancel`, `blur`, a `finally`
 *     block).
 *   - `endActiveGesture()` ends whatever gesture is active, owner or not. It
 *     is for cleanup that must not leave a gesture open across a reset (for
 *     example loading a new file); interactions use `endGesture(token)`.
 *   - A gesture that changes history-relevant state adds exactly one undo
 *     entry, holding the pre-gesture state, so one undo restores it.
 *   - Ending a gesture resumes tracking and writes no app state.
 *   - A gesture with no net change (nothing changed, or values changed and
 *     came back) adds no undo entry.
 *   - `onGestureEnd(fn)` calls `fn(token)` after each gesture ends (once per
 *     gesture, with the token that owned it) and returns an unsubscribe
 *     function. UI that defers work while a control is live (for example
 *     rebuilding a panel) can use it. Every listener runs even if an
 *     earlier one throws; the error is rethrown after the last listener,
 *     with the gesture already ended.
 *   - Undo or redo while a gesture is active is not supported; use
 *     `undoHistory` / `redoHistory` in `history.ts`, which refuse it.
 *
 * Typical slider use (`ui/liveSlider.ts`):
 *   input -> token ??= beginGesture(); apply value
 *   change / pointerup / pointercancel / blur -> endGesture(token), applying
 *     nothing (a range input fires `input` with the final value first, and
 *     applying again after a `pointerup` had ended the gesture would add a
 *     second undo entry)
 *
 * Callers must make sure a gesture always ends: wrap work started inside a
 * gesture in try/finally, and end it on cancel paths as well as on success.
 */
import {
  HISTORY_LIMIT,
  historyEqual,
  historySlice,
  useStore,
  type HistorySlice,
} from './store.js';

interface TemporalState {
  pastStates: HistorySlice[];
  futureStates: HistorySlice[];
  pause(): void;
  resume(): void;
}

interface TemporalApi {
  getState(): TemporalState;
  setState(partial: Partial<TemporalState>): void;
}

// zundo attaches `temporal` as a sibling of the store; the typings do not
// surface it, hence the cast (same shape as elsewhere in the app).
const temporal = (): TemporalApi =>
  (useStore as unknown as { temporal: TemporalApi }).temporal;

/** Opaque proof of ownership of one gesture, returned by `beginGesture`. */
export type GestureToken = { readonly __gestureToken: never };

interface ActiveGesture {
  token: GestureToken;
  /** Pre-gesture history slice. */
  snapshot: HistorySlice;
}

let active: ActiveGesture | null = null;
const endListeners = new Set<(token: GestureToken) => void>();

export function beginGesture(): GestureToken | null {
  if (active) return null;
  const token = Object.freeze({}) as GestureToken;
  active = { token, snapshot: historySlice(useStore.getState()) };
  temporal().getState().pause();
  return token;
}

export function endGesture(token: GestureToken | null): void {
  if (!active || token === null || active.token !== token) return;
  finish(active);
}

export function endActiveGesture(): void {
  if (active) finish(active);
}

function finish(g: ActiveGesture): void {
  active = null;
  const t = temporal();
  t.getState().resume();
  if (!historyEqual(g.snapshot, historySlice(useStore.getState()))) {
    const past = [...t.getState().pastStates, g.snapshot];
    t.setState({ pastStates: past.slice(-HISTORY_LIMIT), futureStates: [] });
  }
  // Every listener runs even if one throws, so a failing listener cannot
  // keep another from releasing what it holds (a slider's token, say). The
  // gesture is already over; the first error is rethrown afterwards, or an
  // AggregateError when several listeners threw.
  const errors: unknown[] = [];
  for (const fn of [...endListeners]) {
    try {
      fn(g.token);
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'gesture-end listeners threw');
}

export function isGestureActive(): boolean {
  return active !== null;
}

export function onGestureEnd(fn: (token: GestureToken) => void): () => void {
  endListeners.add(fn);
  return () => {
    endListeners.delete(fn);
  };
}
