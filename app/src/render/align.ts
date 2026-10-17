/**
 * Toolbar align and distribute actions on the selected nodes. Each action
 * writes all new positions in one `setNodePositions` call, so it is one
 * undo entry.
 */
import { useStore, type NodePosition } from '../state/store.js';

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';
export type DistributeMode = 'horizontal' | 'vertical';

/**
 * Align every selected node along the specified axis. No-op when fewer
 * than 2 nodes are selected.
 */
export function alignSelected(mode: AlignMode): void {
  const { selection, positions, setNodePositions } = useStore.getState();
  if (selection.size < 2) return;
  const items = Array.from(selection)
    .map((id) => ({ id, p: positions[id] }))
    .filter((x): x is { id: string; p: NodePosition } => !!x.p);
  if (items.length < 2) return;

  const updates: Record<string, NodePosition> = {};
  switch (mode) {
    case 'left': {
      const x = Math.min(...items.map((it) => it.p.x));
      for (const it of items) updates[it.id] = { ...it.p, x };
      break;
    }
    case 'right': {
      const x = Math.max(...items.map((it) => it.p.x + it.p.width));
      for (const it of items) updates[it.id] = { ...it.p, x: x - it.p.width };
      break;
    }
    case 'top': {
      const y = Math.min(...items.map((it) => it.p.y));
      for (const it of items) updates[it.id] = { ...it.p, y };
      break;
    }
    case 'bottom': {
      const y = Math.max(...items.map((it) => it.p.y + it.p.height));
      for (const it of items) updates[it.id] = { ...it.p, y: y - it.p.height };
      break;
    }
    case 'centerX': {
      // Average centerline.
      const cx = items.reduce((acc, it) => acc + it.p.x + it.p.width / 2, 0) / items.length;
      for (const it of items) updates[it.id] = { ...it.p, x: cx - it.p.width / 2 };
      break;
    }
    case 'centerY': {
      const cy = items.reduce((acc, it) => acc + it.p.y + it.p.height / 2, 0) / items.length;
      for (const it of items) updates[it.id] = { ...it.p, y: cy - it.p.height / 2 };
      break;
    }
  }
  setNodePositions(updates);
}

/**
 * Distribute node centers evenly between the two extremes along the chosen
 * axis. No-op for fewer than 3 nodes.
 */
export function distributeSelected(mode: DistributeMode): void {
  const { selection, positions, setNodePositions } = useStore.getState();
  if (selection.size < 3) return;
  const items = Array.from(selection)
    .map((id) => ({ id, p: positions[id] }))
    .filter((x): x is { id: string; p: NodePosition } => !!x.p);
  if (items.length < 3) return;

  if (mode === 'horizontal') {
    items.sort((a, b) => a.p.x - b.p.x);
    const min = items[0].p.x;
    const max = items[items.length - 1].p.x;
    const step = (max - min) / (items.length - 1);
    const updates: Record<string, NodePosition> = {};
    items.forEach((it, i) => {
      updates[it.id] = { ...it.p, x: min + step * i };
    });
    setNodePositions(updates);
  } else {
    items.sort((a, b) => a.p.y - b.p.y);
    const min = items[0].p.y;
    const max = items[items.length - 1].p.y;
    const step = (max - min) / (items.length - 1);
    const updates: Record<string, NodePosition> = {};
    items.forEach((it, i) => {
      updates[it.id] = { ...it.p, y: min + step * i };
    });
    setNodePositions(updates);
  }
}
