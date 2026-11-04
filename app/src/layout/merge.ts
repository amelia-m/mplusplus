/**
 * The layout as drawn: the engine's result with the user's edits laid
 * over it. Stored positions replace the computed boxes, and stored
 * residual and curve sides (set in the inspector or by a rotation,
 * `layout/transform.ts`) replace the computed sides. The engine's result
 * stays the initial placement; the store is authoritative after it.
 */
import type { NodePosition } from '../state/store.js';
import type { LayoutResult, Side } from './index.js';

export interface LayoutEdits {
  positions: Record<string, NodePosition>;
  residualSides: Record<string, Side>;
  curveSides: Record<string, Side>;
}

export function mergeLayout(layout: LayoutResult, edits: LayoutEdits): LayoutResult {
  const { positions, residualSides, curveSides } = edits;
  return {
    ...layout,
    nodes: layout.nodes.map((n) => (positions[n.id] ? { ...n, ...positions[n.id] } : n)),
    residuals: layout.residuals?.map((r) => (residualSides[r.id] ? { ...r, side: residualSides[r.id] } : r)),
    edges: layout.edges.map((e) =>
      e.curve && curveSides[e.id] ? { ...e, curve: { ...e.curve, side: curveSides[e.id] } } : e,
    ),
  };
}
