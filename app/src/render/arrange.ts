/**
 * Toolbar arrange actions: rotate or flip the selected nodes, or the whole
 * diagram when nothing is selected, and grow a selection of factors to
 * their measurement blocks. Each rotation is one store write, so one undo
 * entry. The geometry is `layout/transform.ts`.
 */
import type { GraphEdge } from '../model/graph.js';
import { withIndicators, type TransformOp } from '../layout/transform.js';
import { isGestureActive } from '../state/gesture.js';
import { useStore } from '../state/store.js';

/**
 * The nodes an arrange action applies to: the selected nodes; else the
 * ends of the selected edges; else, with nothing selected, every node.
 */
export function arrangeTargets(
  selection: ReadonlySet<string>,
  edgeSelection: ReadonlySet<string>,
  edges: GraphEdge[],
  allIds: string[],
): string[] {
  if (selection.size > 0) return [...selection];
  if (edgeSelection.size > 0) {
    return [...new Set(edges.filter((e) => edgeSelection.has(e.id)).flatMap((e) => [e.from, e.to]))];
  }
  return allIds;
}

/** Rotate or flip; false when it waited out a drag or scrub in progress (like undo, it never lands inside one). */
export function arrangeSelected(op: TransformOp): boolean {
  if (isGestureActive()) return false;
  const { graph, selection, edgeSelection, transformNodes } = useStore.getState();
  if (!graph) return true;
  transformNodes(arrangeTargets(selection, edgeSelection, graph.edges, graph.nodes.map((n) => n.id)), op);
  return true;
}

export type SelectBlocksResult = 'added' | 'no-selection' | 'no-factor' | 'complete';

/** Add everything the selected factors measure to the selection, and say what happened. */
export function selectBlocks(): SelectBlocksResult {
  const { graph, selection, setSelection } = useStore.getState();
  if (!graph || selection.size === 0) return 'no-selection';
  const latents = new Set(graph.nodes.filter((n) => n.kind === 'latent').map((n) => n.id));
  if (![...selection].some((id) => latents.has(id))) return 'no-factor';
  const grown = withIndicators(graph, selection);
  if (grown.size === selection.size) return 'complete';
  setSelection(grown);
  return 'added';
}
