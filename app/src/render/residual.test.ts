import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { placeSem } from '../layout/sem.js';
import { curveGeometry, overlayGeometry, overlayPoints, residualGeometry, RESIDUAL_LENGTH } from './residual.js';

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

describe('overlayGeometry', () => {
  it('runs a covariance of two dependent variables between their residual tails (syn_path d1, d2)', () => {
    const g = buildGraph(parseDgm(readFileSync(join(resolve(__dirname, '../../../dgm'), 'syn_path.dgm'), 'utf8')));
    const layout = placeSem(g, 120, 56);
    const o = overlayGeometry(layout, g.edges, () => 'rect');
    const edge = g.edges.find((e) => (e.kind === 'WITH' || e.kind === 'COVAR') && [e.from, e.to].sort().join() === 'd1,d2')!;
    const tail = o.residuals.get(edge.from)!.tail;
    expect(o.curves.get(edge.id)!.d.startsWith(`M ${tail.x} ${tail.y} Q`)).toBe(true);
    expect(overlayPoints(o)).toContainEqual(o.curves.get(edge.id)!.control);
  });
});
