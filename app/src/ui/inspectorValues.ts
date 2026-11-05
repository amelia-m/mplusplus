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

/**
 * A residual side as the inspector offers it: '' is the layout's own choice,
 * and 'mixed' says the selected residuals point different ways (shown, never
 * chosen).
 */
export type ResidualSideChoice = Side | '' | 'mixed';

/** The selected nodes that have a residual drawn, in selection order. */
export function residualIds(s: Pick<AppState, 'layout'>, selection: ReadonlySet<string>): string[] {
  const drawn = new Set((s.layout?.residuals ?? []).map((r) => r.id));
  return [...selection].filter((id) => drawn.has(id));
}

/**
 * The side choice to show for `ids`, comparing the sides they are drawn on
 * (the stored side, else the layout's): 'mixed' when those differ (Amelia,
 * 2026-11-04); otherwise the stored choice they share ('' when the layout
 * decides for all of them), or, when some are stored and some not but all
 * land on one side, that side. One id is never 'mixed'.
 */
export function residualSideChoice(
  s: Pick<AppState, 'residualSides' | 'layout'>,
  ids: string[],
): ResidualSideChoice {
  if (ids.length === 0) return '';
  const layoutSide = new Map((s.layout?.residuals ?? []).map((r) => [r.id, r.side]));
  const drawn = ids.map((id) => s.residualSides[id] ?? layoutSide.get(id));
  if (drawn.some((d) => d !== drawn[0])) return 'mixed';
  const stored = ids.map((id): ResidualSideChoice => s.residualSides[id] ?? '');
  if (stored.every((c) => c === stored[0])) return stored[0];
  return drawn[0] ?? '';
}
