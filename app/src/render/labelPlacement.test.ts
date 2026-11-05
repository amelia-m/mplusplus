import { describe, expect, it } from 'vitest';
import {
  labelBoxAt,
  overlapArea,
  placeLabels,
  pointOnPath,
  segmentLengthInBox,
  T_MAX,
  T_MIN,
  type PathLabel,
  type ResidualLabel,
} from './labelPlacement.js';
import { quadraticAt } from './residual.js';

/** A 40 by 10 label sitting just above its point, as an edge value does. */
const rel = { x: -20, y: -16, width: 40, height: 10 };
const horizontal = (id: string, y: number): PathLabel => ({
  kind: 'path',
  id,
  path: { kind: 'polyline', points: [{ x: 0, y }, { x: 200, y }] },
  t0: 0.5,
  rel,
});
const noObstacles = { boxes: [], segments: [] };

describe('pointOnPath', () => {
  it('measures a polyline by length and follows a curve as quadraticAt does', () => {
    const bent = { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }] } as const;
    expect(pointOnPath(bent, 0.5)).toEqual({ x: 20, y: 0 });
    expect(pointOnPath(bent, 0.875)).toEqual({ x: 30, y: 5 });
    const [a, control, b] = [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }];
    expect(pointOnPath({ kind: 'quadratic', a, control, b }, 0.3)).toEqual(quadraticAt(a, control, b, 0.3));
  });
});

describe('segmentLengthInBox', () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  it('gives the length of the part inside, 0 for a segment outside', () => {
    expect(segmentLengthInBox({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBeCloseTo(10, 9);
    expect(segmentLengthInBox({ x: -5, y: -5 }, { x: 15, y: 15 }, box)).toBeCloseTo(Math.hypot(10, 10), 9);
    expect(segmentLengthInBox({ x: -5, y: 20 }, { x: 15, y: 20 }, box)).toBe(0);
  });
});

describe('placeLabels', () => {
  it('leaves labels with nothing in their way where they are', () => {
    const p = placeLabels([horizontal('a', 0), horizontal('b', 100)], noObstacles);
    expect(p.offsets.get('a')).toEqual({ x: 0, y: 0 });
    expect(p.offsets.get('b')).toEqual({ x: 0, y: 0 });
    expect(p.unresolved).toEqual([]);
  });

  it('slides two labels on close parallel paths apart, each along its own path within t 0.2 to 0.8', () => {
    const labels = [horizontal('a', 0), horizontal('b', 4)];
    expect(overlapArea(labelBoxAt(labels[0], { x: 0, y: 0 }), labelBoxAt(labels[1], { x: 0, y: 0 }))).toBeGreaterThan(0);
    const p = placeLabels(labels, noObstacles);
    const [ba, bb] = labels.map((l) => labelBoxAt(l, p.offsets.get(l.id)!));
    expect(overlapArea(ba, bb)).toBe(0);
    for (const l of labels) {
      const t = p.t.get(l.id)!;
      expect(t).toBeGreaterThanOrEqual(T_MIN);
      expect(t).toBeLessThanOrEqual(T_MAX);
      const base = pointOnPath(l.path, l.t0);
      const o = p.offsets.get(l.id)!;
      expect({ x: base.x + o.x, y: base.y + o.y }).toEqual(pointOnPath(l.path, t));
    }
    expect(p.unresolved).toEqual([]);
  });

  it('moves a residual value off an arrowhead and off a path running through it', () => {
    const value: ResidualLabel = {
      kind: 'residual',
      id: 'res:x',
      anchor: { x: 100, y: 100 },
      dir: { x: -1, y: 0 },
      rel: { x: -30, y: -6, width: 30, height: 12 },
    };
    const arrowhead = { x: 80, y: 95, width: 10, height: 10 };
    const path = { a: { x: 60, y: 90 }, b: { x: 60, y: 110 }, owner: 'edge:other' };
    const own = { a: { x: 100, y: 100 }, b: { x: 140, y: 100 }, owner: 'res:x' };
    const before = labelBoxAt(value, { x: 0, y: 0 });
    expect(overlapArea(before, arrowhead)).toBeGreaterThan(0);
    const p = placeLabels([value], { boxes: [arrowhead], segments: [path, own] });
    const after = labelBoxAt(value, p.offsets.get('res:x')!);
    expect(overlapArea(after, arrowhead)).toBe(0);
    expect(segmentLengthInBox(path.a, path.b, after)).toBe(0);
    expect(p.unresolved).toEqual([]);
  });

  it('keeps a label in place and reports it when nothing in reach is clear', () => {
    const wall = { x: -1000, y: -1000, width: 2000, height: 2000 };
    const p = placeLabels([horizontal('a', 0)], { boxes: [wall], segments: [] });
    expect(p.offsets.get('a')).toEqual({ x: 0, y: 0 });
    expect(p.unresolved).toEqual(['a']);
  });
});
