/**
 * Range inputs that scrub a value live and record one undo entry per scrub,
 * following the slider recipe in `state/gesture.ts`:
 *   input -> token ??= beginGesture(); apply value
 *   change / pointerup / pointercancel / blur -> endGesture(token), applying
 *     nothing
 */
import { beginGesture, endGesture, onGestureEnd, type GestureToken } from '../state/gesture.js';
import { parseNumberInput, type NumberSpec } from './numberInput.js';

/**
 * Wire `slider` so each `input` applies its value inside one undo gesture.
 *
 * The first `input` begins the gesture. It ends on the slider's `change` or
 * `blur`, or on a window `pointerup`, `pointercancel` or `blur`, whichever
 * comes first, so it ends even if `change` never fires (for example the
 * pointer is released outside the slider, or the slider is removed from the
 * page mid-scrub). `change` applies nothing itself: a range input always
 * fires `input` with the same value first, and re-applying it after a
 * `pointerup` had already ended the gesture would add a second undo entry.
 */
export function wireLiveSlider(
  slider: HTMLInputElement,
  spec: NumberSpec,
  apply: (v: number) => void,
): void {
  // The gesture this slider owns while a scrub is live, else null. Ending
  // passes it, so the slider can never end a gesture it did not begin.
  let token: GestureToken | null = null;
  const end = (): void => endGesture(token);

  slider.addEventListener('input', () => {
    const v = parseNumberInput(slider.value, spec);
    if (v === null) return;
    if (!token) {
      // `null` when another gesture is active: the value then applies inside
      // that gesture, and this slider hooks nothing it would have to end.
      token = beginGesture();
      if (token) {
        const own = token;
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        window.addEventListener('blur', end);
        // However this gesture ends (here or by load-time cleanup), drop the
        // window hooks. Other gestures ending leave them in place.
        const off = onGestureEnd((ended) => {
          if (ended !== own) return;
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          window.removeEventListener('blur', end);
          off();
          token = null;
        });
      }
    }
    try {
      apply(v);
    } catch (err) {
      end();
      throw err;
    }
  });
  slider.addEventListener('change', end);
  slider.addEventListener('blur', end);
}

/** Display form of a numeric value: at most three decimals, no float noise. */
export function formatNumber(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}
