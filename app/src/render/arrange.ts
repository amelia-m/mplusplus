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

export function arrangeSelected(op: TransformOp): void {
  // Like undo, a rotation waits for a drag or scrub to end, so it never lands inside one.
  if (isGestureActive()) return;
  const { graph, selection, edgeSelection, transformNodes } = useStore.getState();
  if (!graph) return;
  transformNodes(arrangeTargets(selection, edgeSelection, graph.edges, graph.nodes.map((n) => n.id)), op);
}

/** Add everything the selected factors measure to the selection; false when that adds nothing. */
export function selectBlocks(): boolean {
  const { graph, selection, setSelection } = useStore.getState();
  if (!graph || selection.size === 0) return false;
  const grown = withIndicators(graph, selection);
  if (grown.size === selection.size) return false;
  setSelection(grown);
  return true;
}
