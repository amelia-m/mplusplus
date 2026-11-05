import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { placeSem } from '../layout/sem.js';
import type { LayoutResult, Point, Side } from '../layout/index.js';
import type { GraphEdge } from '../model/graph.js';
import {
  curveGeometry,
  overlayGeometry,
  overlayPoints,
  curveLabelHalfWidth,
  quadraticAt,
  residualGeometry,
  RESIDUAL_LENGTH,
  tailCurveGeometry,
  type CurveGeometry,
} from './residual.js';

const box = { x: 100, y: 200, width: 120, height: 56 };

describe('residualGeometry - compact arrow', () => {
  it('points into the right side of a box, its value beyond the tail', () => {
    const r = residualGeometry('compact-arrow', box, 'rect', 'right');
    expect(r.tip).toEqual({ x: 220, y: 228 });
    expect(r.tail).toEqual({ x: 220 + RESIDUAL_LENGTH, y: 228 });
    expect(r.labelAnchor.x).toBeGreaterThan(r.tail.x);
    expect(r.textAnchor).toBe('start');
  });

  it('comes into a latent from the upper left, its tip on the outline', () => {
    const r = residualGeometry('compact-arrow', box, 'ellipse', 'top');
    const [cx, cy, rx, ry] = [160, 228, 60, 28];
    expect(((r.tip.x - cx) / rx) ** 2 + ((r.tip.y - cy) / ry) ** 2).toBeCloseTo(1, 6);
    expect(r.tail.x).toBeLessThan(r.tip.x);
    expect(r.tail.y).toBeLessThan(r.tip.y);
  });

  it('moves with the box (a dragged node keeps its residual)', () => {
    const before = residualGeometry('compact-arrow', box, 'rect', 'bottom');
    const after = residualGeometry('compact-arrow', { ...box, x: box.x + 30, y: box.y - 10 }, 'rect', 'bottom');
    for (const k of ['tail', 'tip', 'labelAnchor'] as const) {
      expect(after[k].x - before[k].x).toBeCloseTo(30, 9);
      expect(after[k].y - before[k].y).toBeCloseTo(-10, 9);
    }
  });
});

describe('curveGeometry', () => {
  it('bulges to the given side, beyond both ends', () => {
    const c = curveGeometry({ x: 0, y: 0 }, { x: 0, y: 100 }, 'left');
    expect(c.control.x).toBeLessThan(0);
    expect(c.mid.x).toBeLessThan(0);
    expect(c.d.startsWith('M 0 0 Q')).toBe(true);
  });

  it('bulges further for ends further apart, so a long curve clears the column between', () => {
    const near = curveGeometry({ x: 0, y: 0 }, { x: 0, y: 100 }, 'right');
    const far = curveGeometry({ x: 0, y: 0 }, { x: 0, y: 300 }, 'right');
    expect(far.control.x).toBeGreaterThan(near.control.x);
  });
});

describe('tailCurveGeometry', () => {
  type Box = { x: number; y: number; width: number; height: number };
  const W = 120;
  const H = 56;
  const tailOf = (b: Box, side: Side) => residualGeometry('compact-arrow', b, 'rect', side).tail;
  /** 20 points strictly between the ends of the curve, none of which may sit in a box. */
  const inside = (c: CurveGeometry, a: Point, b: Point, boxes: Box[]) =>
    Array.from({ length: 20 }, (_, i) => quadraticAt(a, c.control, b, (i + 1) / 21)).filter((p) =>
      boxes.some((bx) => p.x >= bx.x && p.x <= bx.x + bx.width && p.y >= bx.y && p.y <= bx.y + bx.height),
    );
  /** Cosine of the angle between the control point's offset from the middle of the chord and the chord. */
  const lean = (c: CurveGeometry, a: Point, b: Point) => {
    const [ox, oy] = [c.control.x - (a.x + b.x) / 2, c.control.y - (a.y + b.y) / 2];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    return (ox * dx + oy * dy) / (Math.hypot(ox, oy) * Math.hypot(dx, dy));
  };

  const stacked: Box[] = [
    { x: 100, y: 0, width: W, height: H },
    { x: 100, y: 116, width: W, height: H },
  ];
  const sideBySide: Box[] = [
    { x: 0, y: 100, width: W, height: H },
    { x: 180, y: 100, width: W, height: H },
  ];

  it.each([
    ['stacked boxes, residuals at Top', stacked, 'top'],
    ['stacked boxes, residuals at Bottom', stacked, 'bottom'],
    ['side by side boxes, residuals at Left', sideBySide, 'left'],
    ['side by side boxes, residuals at Right', sideBySide, 'right'],
  ] as const)(
    'bows sideways clear of both boxes for %s (bug: a straight line through a box, syn_sem x1, x2)',
    (_, boxes, side) => {
      const [a, b] = [tailOf(boxes[0], side), tailOf(boxes[1], side)];
      const c = tailCurveGeometry(a, b, side, boxes);
      expect(Math.abs(lean(c, a, b))).toBeLessThan(1e-9);
      expect(Math.hypot(c.control.x - (a.x + b.x) / 2, c.control.y - (a.y + b.y) / 2)).toBeGreaterThan(0);
      expect(inside(c, a, b, boxes)).toEqual([]);
    },
  );

  it('bows sideways clear of both boxes when stacked boxes are offset diagonally, residuals at Top', () => {
    const boxes: Box[] = [stacked[0], { ...stacked[1], x: 150 }];
    const [a, b] = [tailOf(boxes[0], 'top'), tailOf(boxes[1], 'top')];
    const c = tailCurveGeometry(a, b, 'top', boxes);
    expect(Math.abs(lean(c, a, b))).toBeLessThan(1e-9);
    expect(inside(c, a, b, boxes)).toEqual([]);
  });

  it('keeps the side-based curve for stacked boxes with residuals at Left or Right', () => {
    for (const side of ['left', 'right'] as const) {
      const [a, b] = [tailOf(stacked[0], side), tailOf(stacked[1], side)];
      expect(tailCurveGeometry(a, b, side, stacked)).toEqual(curveGeometry(a, b, side));
    }
  });

  it('keeps the side-based curve for boxes offset further across than along, residuals at Top', () => {
    const boxes: Box[] = [stacked[0], { ...stacked[1], x: 300 }];
    const [a, b] = [tailOf(boxes[0], 'top'), tailOf(boxes[1], 'top')];
    expect(tailCurveGeometry(a, b, 'top', boxes)).toEqual(curveGeometry(a, b, 'top'));
  });

  it('gives finite numbers for two tails at the same point', () => {
    const p = { x: 10, y: 20 };
    const c = tailCurveGeometry(p, p, 'top', stacked);
    for (const v of [c.control.x, c.control.y, c.mid.x, c.mid.y]) expect(Number.isFinite(v)).toBe(true);
    expect(c.d).not.toContain('NaN');
  });
});

describe('overlayGeometry', () => {
  it('draws a covariance between residuals at Top of stacked boxes clear of both boxes', () => {
    const nodes = [
      { id: 'x1', x: 100, y: 0, width: 120, height: 56 },
      { id: 'x2', x: 100, y: 116, width: 120, height: 56 },
    ];
    const edge: GraphEdge = {
      id: 'COVAR:x2->x1', from: 'x2', to: 'x1', kind: 'COVAR',
      free: false, fixed: null, constraint: null, unstd: null, stdyx: null,
    };
    const layout: LayoutResult = {
      nodes,
      edges: [{ id: edge.id, curve: { side: 'top', attach: 'residual' } }],
      residuals: [{ id: 'x1', side: 'top' }, { id: 'x2', side: 'top' }],
      width: 220,
      height: 172,
    };
    const o = overlayGeometry(layout, [edge], () => 'rect', 3);
    const c = o.curves.get(edge.id)!;
    const [a, b] = [o.residuals.get('x2')!.tail, o.residuals.get('x1')!.tail];
    expect(c.d.startsWith(`M ${a.x} ${a.y} Q`)).toBe(true);
    expect(c.control.x).not.toBeCloseTo(a.x, 3);
    for (let i = 1; i <= 20; i++) {
      const p = quadraticAt(a, c.control, b, i / 21);
      for (const n of nodes) expect(p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height).toBe(false);
    }
  });

  it('runs a covariance of two dependent variables between their residual tails (syn_path d1, d2)', () => {
    const g = buildGraph(parseDgm(readFileSync(join(resolve(__dirname, '../../../dgm'), 'syn_path.dgm'), 'utf8')));
    const layout = placeSem(g, 120, 56);
    const o = overlayGeometry(layout, g.edges, () => 'rect');
    const edge = g.edges.find((e) => (e.kind === 'WITH' || e.kind === 'COVAR') && [e.from, e.to].sort().join() === 'd1,d2')!;
    const tail = o.residuals.get(edge.from)!.tail;
    expect(o.curves.get(edge.id)!.d.startsWith(`M ${tail.x} ${tail.y} Q`)).toBe(true);
    expect(overlayPoints(o)).toContainEqual(o.curves.get(edge.id)!.control);
    // Room for the curve's value label either side of its midpoint, so a long
    // label on a curve at the diagram's edge is not cut off by the view fit.
    const mid = o.curves.get(edge.id)!.mid;
    expect(overlayPoints(o, 90)).toEqual(expect.arrayContaining([{ x: mid.x - 90, y: mid.y }, { x: mid.x + 90, y: mid.y }]));
  });
});

describe('curveLabelHalfWidth', () => {
  const s = { showCoefficients: true, showCovarianceLabels: true, showSE: true, showCI: false, decimals: 3, fontSize: 10 };
  it('is 0 when covariance labels or all coefficients are hidden', () => {
    expect(curveLabelHalfWidth({ ...s, showCovarianceLabels: false })).toBe(0);
    expect(curveLabelHalfWidth({ ...s, showCoefficients: false })).toBe(0);
  });
  it('grows with the SE and the limits: `-0.123 (0.045) [-0.035, 0.211]` at 31 characters', () => {
    expect(curveLabelHalfWidth({ ...s, showSE: false })).toBeCloseTo((6 * 0.62 * 10) / 2, 6);
    expect(curveLabelHalfWidth({ ...s, showCI: true })).toBeCloseTo((31 * 0.62 * 10) / 2, 6);
  });
});
