/**
 * Shared parse-and-clamp for every numeric control (number inputs and
 * sliders), so they all treat odd input the same way.
 */

export interface NumberSpec {
  min: number;
  max: number;
  /** Round to the nearest integer (for counts such as Decimals). */
  integer?: boolean;
}

/**
 * Parse a control's raw value. Returns `null` when the text is empty or not
 * a finite number, meaning "leave the stored value unchanged". Otherwise the
 * value is rounded (integer controls) and then clamped to `[min, max]`.
 */
export function parseNumberInput(raw: string, spec: NumberSpec): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const v = spec.integer ? Math.round(n) : n;
  return Math.min(spec.max, Math.max(spec.min, v));
}
