/**
 * Structural equality for the plain data the store keeps (numbers, strings,
 * booleans, null, plain objects and arrays). Store actions use it to skip
 * writes that change no value, and `historyEqual` uses it so a gesture that
 * ends where it started adds no undo entry.
 */

/**
 * True when `a` and `b` hold the same value. Objects compare key by key over
 * the union of their keys, so a key set to `undefined` equals a missing key
 * (a style override `{ shape: undefined }` means the same as `{}`). NaN
 * equals NaN. Not meant for class instances, Maps or Sets.
 */
export function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of Object.keys(ra)) if (!valueEqual(ra[k], rb[k])) return false;
  for (const k of Object.keys(rb)) if (!(k in ra) && rb[k] !== undefined) return false;
  return true;
}

/**
 * `{ ...cur, ...updates }`, or `cur` itself when no update changes a value,
 * so an action can skip the write.
 */
export function mergeRecord<T>(cur: Record<string, T>, updates: Record<string, T>): Record<string, T> {
  for (const k of Object.keys(updates)) {
    if (!valueEqual(cur[k], updates[k])) return { ...cur, ...updates };
  }
  return cur;
}
