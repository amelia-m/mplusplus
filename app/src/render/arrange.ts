/**
 * Toolbar arrange actions: rotate or flip the selected nodes, or the whole
 * diagram when nothing is selected, and grow a selection of factors to
 * their measurement blocks. Each rotation is one store write, so one undo
 * entry. The geometry is `layout/transform.ts`.
 */
import { withIndicators, type TransformOp } from '../layout/transform.js';
import { useStore } from '../state/store.js';

/** The nodes an arrange action applies to: the selection, or every node when none is selected. */
export function arrangeTargets(selection: ReadonlySet<string>, allIds: string[]): string[] {
  return selection.size > 0 ? [...selection] : allIds;
}

export function arrangeSelected(op: TransformOp): void {
  const { graph, selection, transformNodes } = useStore.getState();
  if (!graph) return;
  transformNodes(arrangeTargets(selection, graph.nodes.map((n) => n.id)), op);
}

/** Add the indicators of every selected factor to the selection. */
export function selectBlocks(): void {
  const { graph, selection, setSelection } = useStore.getState();
  if (!graph || selection.size === 0) return;
  const grown = withIndicators(graph, selection);
  if (grown.size !== selection.size) setSelection(grown);
}
