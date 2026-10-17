import { describe, expect, it } from 'vitest';
import { computeSignificanceInputs, nodeShapeSpec } from './svg.js';
import { DEFAULT_GLOBAL_STYLE } from './styles.js';
import type { GraphEdge } from '../model/graph.js';

describe('nodeShapeSpec (R5)', () => {
  it('uses one element type per outline, so restyling keeps the element', () => {
    expect(nodeShapeSpec('ellipse', 120, 56).tag).toBe('ellipse');
    expect(nodeShapeSpec('rect', 120, 56).tag).toBe('rect');
    expect(nodeShapeSpec('rounded-rect', 120, 56).tag).toBe('rect');
    expect(nodeShapeSpec('diamond', 120, 56).tag).toBe('polygon');
  });

  it('gives every geometry attribute a value or null, so switching rect styles in place leaves no stale corner radius', () => {
    const rounded = nodeShapeSpec('rounded-rect', 120, 56).attrs;
    const square = nodeShapeSpec('rect', 120, 56).attrs;
    expect(Object.keys(rounded).sort()).toEqual(Object.keys(square).sort());
    expect(rounded.rx).toBe(12);
    expect(square.rx).toBeNull();
    expect(square.ry).toBeNull();
  });

  it('describes the ellipse and diamond geometry for the node box', () => {
    expect(nodeShapeSpec('ellipse', 120, 56).attrs).toEqual({ cx: 60, cy: 28, rx: 60, ry: 28 });
    expect(nodeShapeSpec('diamond', 120, 56).attrs).toEqual({ points: '60,0 120,28 60,56 0,28' });
  });
});

describe('computeSignificanceInputs (Q4)', () => {
  // Type-level contract, checked by `tsc -b`: only `global` and `pValues`
  // are needed, so callers outside the renderer need no placeholder layout.
  it('needs only the global style and p-values', () => {
    const edge = {
      id: 'ON:x->y',
      from: 'x',
      to: 'y',
      kind: 'ON',
      free: true,
      fixed: null,
      constraint: null,
      unstd: { value: -0.5, se: 0.1 },
      stdyx: null,
    } as GraphEdge;
    const inputs = computeSignificanceInputs(edge, { global: { ...DEFAULT_GLOBAL_STYLE }, pValues: {} });
    expect(inputs.sign).toBe(-1);
    expect(inputs.magnitude).toBe(0.5);
  });
});
