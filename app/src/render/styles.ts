/**
 * Style defaults and per-object overrides.
 *
 * The store keeps a sparse `Record<id, Partial<EdgeStyle>>` (resp. node).
 * When rendering, defaults are merged underneath the override so callers
 * always see a fully populated style. Node defaults vary by kind. Edge
 * defaults vary by significance + sign + magnitude scaling and are computed
 * in `deriveEdgeBase`; `effectiveEdgeStyle` merges the override on top.
 */

import type { EdgeEstimate, GraphEdge, GraphNode } from '../model/graph.js';

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type ArrowheadStyle = 'default' | 'open' | 'none';
export type NodeShape = 'ellipse' | 'rect' | 'rounded-rect' | 'diamond';

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  arrowhead: ArrowheadStyle;
  labelFontFamily: string;
  labelFontSize: number;
  labelFontColor: string;
  /** `null` = use global default. */
  decimals: number | null;
  labelVisible: boolean;
}

export interface NodeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  /** `null` = derive from kind (latent → ellipse, observed → rect). */
  shape: NodeShape | null;
  labelFontFamily: string;
  labelFontSize: number;
  labelFontColor: string;
  /**
   * The name drawn for the variable, `null` = Mplus's own name (the node's
   * `label`). Only the drawn text changes: the node id stays Mplus's name,
   * so `.out` matching and estimates are unaffected (Amelia, 2026-11-02 and
   * 2026-11-03). Set it through `displayNamePatch`.
   */
  displayName: string | null;
}

export type EdgeStyleOverride = Partial<EdgeStyle>;
export type NodeStyleOverride = Partial<NodeStyle>;

export const FONT_FAMILIES = [
  'Inter',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'system-ui',
] as const;

export const DEFAULT_EDGE_STYLE: EdgeStyle = {
  stroke: '#1f2937',
  strokeWidth: 1.5,
  strokeStyle: 'solid',
  arrowhead: 'default',
  labelFontFamily: 'system-ui',
  labelFontSize: 11,
  labelFontColor: '#111111',
  decimals: null,
  labelVisible: true,
};

export const DEFAULT_NODE_STYLE_LATENT: NodeStyle = {
  fill: '#fef3c7',
  stroke: '#92400e',
  strokeWidth: 1.5,
  strokeStyle: 'solid',
  shape: null,
  labelFontFamily: 'system-ui',
  labelFontSize: 13,
  labelFontColor: '#111111',
  displayName: null,
};

export const DEFAULT_NODE_STYLE_OBSERVED: NodeStyle = {
  fill: '#e0f2fe',
  stroke: '#0369a1',
  strokeWidth: 1.5,
  strokeStyle: 'solid',
  shape: null,
  labelFontFamily: 'system-ui',
  labelFontSize: 13,
  labelFontColor: '#111111',
  displayName: null,
};

export interface GlobalStyle {
  decimals: number;
  coefMode: 'unstd' | 'stdyx';
  showCoefficients: boolean;
  /** Show the standard error after the estimate: `0.81 (0.04)`. */
  showSE: boolean;
  /** Show the 95% confidence limits after the estimate: `0.81 [0.72, 0.89]`. */
  showCI: boolean;
  /** Show the values on covariance (WITH / COVAR) edges. */
  showCovarianceLabels: boolean;
  magnitudeScaling: boolean;
  magnitudeScale: number;
  baseEdgeWidth: number;
  negativeColor: string;
  /** Color used to render NS edges by default. */
  nsColor: string;
  /** Stroke width applied to NS edges (constant; ignores magnitude). */
  nsStrokeWidth: number;
  alpha: 0.05 | 0.01;
  pSource: 'auto' | 'tstat' | 'pvalue';
  /** Slide coefficient labels and residual values clear of each other (`render/labelPlacement.ts`). */
  avoidLabelOverlaps: boolean;
}

export const DEFAULT_GLOBAL_STYLE: GlobalStyle = {
  decimals: 3,
  coefMode: 'unstd',
  showCoefficients: true,
  // Amelia, 2026-10-26: SE shown by default, confidence limits off by default.
  showSE: true,
  showCI: false,
  // Amelia, 2026-10-30: covariance values shown by default, with a toggle to hide them.
  showCovarianceLabels: true,
  magnitudeScaling: false,
  magnitudeScale: 3,
  baseEdgeWidth: 1.5,
  negativeColor: '#b91c1c',
  nsColor: '#9ca3af',
  nsStrokeWidth: 1,
  alpha: 0.05,
  pSource: 'auto',
  // Amelia, 2026-11-03: on by default, off in parity mode (not built yet).
  avoidLabelOverlaps: true,
};

export function defaultNodeStyle(kind: GraphNode['kind']): NodeStyle {
  return kind === 'latent' ? DEFAULT_NODE_STYLE_LATENT : DEFAULT_NODE_STYLE_OBSERVED;
}

/**
 * Significance-aware default edge style. Used as the merge base before any
 * per-edge override. Sign + significance + magnitude scaling all collapse
 * into a concrete `{stroke, strokeWidth, strokeStyle}` triple here so the
 * renderer doesn't have to re-derive them.
 */
export interface SignificanceInputs {
  /** `true` significant, `false` ns, `null` indeterminate (treat as sig). */
  significant: boolean | null;
  /** Active-mode coefficient sign. `null` if no estimate is available. */
  sign: 1 | -1 | 0 | null;
  /** |coef| in active mode, used for magnitude scaling. */
  magnitude: number | null;
}

export function deriveEdgeBase(g: GlobalStyle, sig: SignificanceInputs): EdgeStyle {
  const base = { ...DEFAULT_EDGE_STYLE };
  // NS edges: dashed, light grey, constant thin width.
  if (sig.significant === false) {
    return {
      ...base,
      stroke: g.nsColor,
      strokeWidth: g.nsStrokeWidth,
      strokeStyle: 'dashed',
    };
  }
  // Sig (or indeterminate / fixed-only) - sign + magnitude rules.
  let stroke = base.stroke;
  if (sig.sign === -1) stroke = g.negativeColor;
  let strokeWidth = g.baseEdgeWidth;
  if (g.magnitudeScaling && sig.magnitude != null && Number.isFinite(sig.magnitude)) {
    strokeWidth = g.baseEdgeWidth + g.magnitudeScale * sig.magnitude;
  }
  return { ...base, stroke, strokeWidth };
}

export function effectiveEdgeStyle(
  g: GlobalStyle,
  sig: SignificanceInputs,
  override: EdgeStyleOverride | undefined,
): EdgeStyle {
  const baseDerived = deriveEdgeBase(g, sig);
  return override ? { ...baseDerived, ...override } : baseDerived;
}

export function effectiveNodeStyle(
  node: GraphNode,
  override: NodeStyleOverride | undefined,
): NodeStyle {
  const base = defaultNodeStyle(node.kind);
  return override ? { ...base, ...override } : base;
}

// ---- display names (aliases) ----

/** The text drawn for a node: its display name, else Mplus's name. */
export function nodeLabelText(node: Pick<GraphNode, 'label'>, style: Pick<NodeStyle, 'displayName'>): string {
  return style.displayName ?? node.label;
}

/**
 * The style patch for a display name typed for `node`. Surrounding
 * whitespace is dropped; an empty name, or one equal to Mplus's name
 * (case-sensitive, since changing case is an alias too), means "use the
 * Mplus name" and clears the field, so nothing is stored for it.
 */
export function displayNamePatch(node: Pick<GraphNode, 'label'>, typed: string): NodeStyleOverride {
  const name = typed.trim();
  return { displayName: name === '' || name === node.label ? undefined : name };
}

/** A renamed variable, as the export's provenance lists it. */
export interface DisplayNamePair {
  displayName: string;
  mplusName: string;
}

/**
 * The variables drawn under a name other than Mplus's, in graph order; a
 * stored name equal to Mplus's (which `displayNamePatch` never stores) is
 * left out too.
 */
export function displayNamePairs(
  nodes: readonly Pick<GraphNode, 'id' | 'label'>[],
  nodeStyles: Record<string, NodeStyleOverride>,
): DisplayNamePair[] {
  const pairs: DisplayNamePair[] = [];
  for (const n of nodes) {
    const name = nodeStyles[n.id]?.displayName;
    if (name != null && name !== n.label) pairs.push({ displayName: name, mplusName: n.label });
  }
  return pairs;
}

/**
 * Pick the active estimate for an edge under the current coefficient mode,
 * falling back to the other when the active one is missing.
 */
export function activeEstimate(
  edge: GraphEdge,
  mode: 'unstd' | 'stdyx',
): EdgeEstimate | null {
  if (mode === 'stdyx') return edge.stdyx ?? edge.unstd;
  return edge.unstd ?? edge.stdyx;
}

export function strokeDashArray(style: StrokeStyle, width: number): string | null {
  if (style === 'solid') return null;
  if (style === 'dashed') return `${Math.max(width * 2.5, 4)} ${Math.max(width * 1.8, 3)}`;
  return `${Math.max(width * 0.6, 1)} ${Math.max(width * 1.5, 2)}`;
}
