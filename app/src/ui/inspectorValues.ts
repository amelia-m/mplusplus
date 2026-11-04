/**
 * The values the inspector shows: the effective style of the first selected
 * node or edge, that is the default (kind-based for nodes, significance-,
 * sign- and magnitude-based for edges) merged with any override. These are
 * the styles the renderer draws, except the WITH/COVAR dash and arrowhead
 * forced in `svg.ts` (see TODO.md).
 */
import type { AppState } from '../state/store.js';
import type { Side } from '../layout/index.js';
import { computeSignificanceInputs } from '../render/svg.js';
import {
  effectiveEdgeStyle,
  effectiveNodeStyle,
  type EdgeStyle,
  type NodeStyle,
} from '../render/styles.js';

export type InspectorSource = Pick<
  AppState,
  'graph' | 'selection' | 'edgeSelection' | 'nodeStyles' | 'edgeStyles' | 'global' | 'pValues'
>;

const firstOf = (ids: ReadonlySet<string>): string | undefined => ids.values().next().value;

export function nodeInspectorStyle(s: InspectorSource): NodeStyle | null {
  const id = firstOf(s.selection);
  const node = id != null ? s.graph?.nodes.find((n) => n.id === id) : undefined;
  return node ? effectiveNodeStyle(node, s.nodeStyles[node.id]) : null;
}

export function edgeInspectorStyle(s: InspectorSource): EdgeStyle | null {
  const id = firstOf(s.edgeSelection);
  const edge = id != null ? s.graph?.edges.find((e) => e.id === id) : undefined;
  if (!edge) return null;
  return effectiveEdgeStyle(s.global, computeSignificanceInputs(edge, s), s.edgeStyles[edge.id]);
}

/** A residual side as the inspector offers it: '' is the layout's own choice. */
export type ResidualSideChoice = Side | '';

/** The selected nodes that have a residual drawn, in selection order. */
export function residualIds(s: Pick<AppState, 'layout'>, selection: ReadonlySet<string>): string[] {
  const drawn = new Set((s.layout?.residuals ?? []).map((r) => r.id));
  return [...selection].filter((id) => drawn.has(id));
}

/**
 * The side choice to show for `ids`: the first one's stored side, or ''
 * when the layout decides it (no stored side).
 */
export function residualSideChoice(s: Pick<AppState, 'residualSides'>, ids: string[]): ResidualSideChoice {
  return ids.length > 0 ? (s.residualSides[ids[0]] ?? '') : '';
}
