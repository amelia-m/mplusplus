import { describe, it, expect } from 'vitest';
import { mergeLayout } from './merge.js';
import type { LayoutResult } from './index.js';

const layout: LayoutResult = {
  nodes: [{ id: 'a', x: 0, y: 0, width: 10, height: 10 }],
  edges: [
    { id: 'WITH:a->b', curve: { side: 'bottom', attach: 'residual' } },
    { id: 'ON:a->b', bend: [] },
  ],
  residuals: [
    { id: 'a', side: 'right' },
    { id: 'b', side: 'right' },
  ],
  width: 10,
  height: 10,
};

describe('mergeLayout', () => {
  it('draws stored positions and stored residual and curve sides over the computed ones', () => {
    const m = mergeLayout(layout, {
      positions: { a: { x: 5, y: 6, width: 10, height: 10 } },
      residualSides: { a: 'top' },
      curveSides: { 'WITH:a->b': 'left' },
    });
    expect(m.nodes[0]).toMatchObject({ x: 5, y: 6 });
    expect(m.residuals).toEqual([
      { id: 'a', side: 'top' },
      { id: 'b', side: 'right' },
    ]);
    expect(m.edges[0].curve).toEqual({ side: 'left', attach: 'residual' });
    expect(m.edges[1]).toBe(layout.edges[1]);
  });
});
