/**
 * Edge significance: from a `.out` p-value when one is given and the source
 * setting allows it, otherwise from the t statistic (estimate / SE) against
 * 1.96 (alpha 0.05) or 2.576 (alpha 0.01). Returns `null` when it cannot be
 * decided (no usable estimate, or the `pvalue` source without a p-value).
 */
import type { GraphEdge } from './graph.js';

/**
 * `auto`    : prefer .out p-value if present, fall back to t-stat.
 * `tstat`   : always use t = est/SE; ignore any provided p-value.
 * `pvalue`  : require a p-value; if none, return null (UI greys out).
 * `out`     : legacy alias for `pvalue` - kept for backward compatibility
 *             with earlier tests/callers.
 */
export type SignificanceSource = 'auto' | 'tstat' | 'pvalue' | 'out';

export interface SignificanceContext {
  /** P-value attached from a parsed `.out` file, in the active coefficient mode. */
  pValue?: number | null;
}

const Z_05 = 1.96;
const Z_01 = 2.576;

export function isSignificant(
  edge: GraphEdge,
  alpha: 0.05 | 0.01 = 0.05,
  source: SignificanceSource = 'auto',
  ctx: SignificanceContext = {},
): boolean | null {
  const wantsP = source === 'pvalue' || source === 'out';
  const allowsP = wantsP || source === 'auto';

  if (allowsP && ctx.pValue != null && Number.isFinite(ctx.pValue)) {
    return ctx.pValue < alpha;
  }
  if (wantsP) return null;

  const est = edge.unstd ?? edge.stdyx;
  if (!est || est.se === 0 || !Number.isFinite(est.se)) return null;

  const t = est.value / est.se;
  const threshold = alpha === 0.01 ? Z_01 : Z_05;
  return Math.abs(t) > threshold;
}
