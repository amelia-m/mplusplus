/**
 * The values the inspector shows: the effective style of the first selected
 * node or edge, that is the default (kind-based for nodes, significance-,
 * sign- and magnitude-based for edges) merged with any override. These are
 * the styles the renderer draws, except the WITH/COVAR dash and arrowhead
 * forced in `svg.ts` (see TODO.md).
 */
import type { AppState } from '../state/store.js';
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
