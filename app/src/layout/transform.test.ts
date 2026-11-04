import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { transformGroup, transformPoint, transformSide, withIndicators } from './transform.js';

const box = (x: number, y: number, width = 20, height = 10) => ({ x, y, width, height });

describe('transformSide', () => {
  it('turns sides clockwise and counter-clockwise, and mirrors them', () => {
    expect(transformSide('top', 'rotate-cw')).toBe('right');
    expect(transformSide('left', 'rotate-cw')).toBe('top');
    expect(transformSide('top', 'rotate-ccw')).toBe('left');
    expect(transformSide('left', 'flip-h')).toBe('right');
    expect(transformSide('top', 'flip-h')).toBe('top');
    expect(transformSide('bottom', 'flip-v')).toBe('top');
    expect(transformSide('right', 'flip-v')).toBe('right');
  });
});

describe('transformPoint', () => {
  it('turns a point a quarter turn on screen, where y grows downward', () => {
    const pivot = { x: 0, y: 0 };
    // A point to the right of the pivot goes below it when turned clockwise.
    expect(transformPoint({ x: 10, y: 0 }, pivot, 'rotate-cw')).toEqual({ x: 0, y: 10 });
    expect(transformPoint({ x: 10, y: 0 }, pivot, 'rotate-ccw')).toEqual({ x: 0, y: -10 });
    expect(transformPoint({ x: 10, y: 3 }, pivot, 'flip-h')).toEqual({ x: -10, y: 3 });
    expect(transformPoint({ x: 10, y: 3 }, pivot, 'flip-v')).toEqual({ x: 10, y: -3 });
  });

  it('comes back after four quarter turns, and after flipping twice', () => {
    const pivot = { x: 7, y: -2 };
    let p = { x: 31, y: 12 };
    for (let i = 0; i < 4; i++) p = transformPoint(p, pivot, 'rotate-cw');
    expect(p).toEqual({ x: 31, y: 12 });
    expect(transformPoint(transformPoint(p, pivot, 'flip-v'), pivot, 'flip-v')).toEqual(p);
  });
});

describe('transformGroup', () => {
  // A factor f with two indicators below it, side by side, residuals below.
  const positions = { f: box(40, 0), a: box(20, 40), b: box(60, 40), other: box(200, 200) };
  const input = {
    ids: ['f', 'a', 'b'],
    positions,
    residualSides: { a: 'bottom' as const, b: 'bottom' as const, f: 'top' as const, other: 'right' as const },
    curves: [
      { id: 'WITH:a->b', from: 'a', to: 'b', side: 'bottom' as const },
      { id: 'WITH:a->other', from: 'a', to: 'other', side: 'right' as const },
    ],
  };

  it('turns a block clockwise around its center, keeping box sizes, so the indicators end up to the left', () => {
    const r = transformGroup(input, 'rotate-cw');
    // Bounding box of the block: x 20..80, y 0..50, so its center is (50, 25).
    const center = (id: string) => ({ x: r.positions[id].x + 10, y: r.positions[id].y + 5 });
    expect(center('f')).toEqual({ x: 70, y: 25 }); // was above the center, now right of it
    expect(center('a')).toEqual({ x: 30, y: 5 });
    expect(center('b')).toEqual({ x: 30, y: 45 });
    expect(r.positions.f.width).toBe(20);
    expect(r.positions.f.height).toBe(10);
    expect(r.positions.other).toBeUndefined();
  });

  it('turns the residual sides of the turned nodes, and only curves with both ends in the group', () => {
    const r = transformGroup(input, 'rotate-cw');
    expect(r.residualSides).toEqual({ a: 'left', b: 'left', f: 'right' });
    expect(r.curveSides).toEqual({ 'WITH:a->b': 'left' });
  });

  it('leaves positions unchanged when the group is empty or unknown', () => {
    expect(transformGroup({ ...input, ids: ['missing'] }, 'flip-h')).toEqual({
      positions: {},
      residualSides: {},
      curveSides: {},
    });
  });
});

describe('withIndicators', () => {
  it("adds a factor's observed indicators, and nothing for an observed variable", () => {
    const text = readFileSync(join(resolve(__dirname, '../../../dgm'), 'syn_sem.dgm'), 'utf8');
    const graph = buildGraph(parseDgm(text));
    expect([...withIndicators(graph, ['fb'])].sort()).toEqual(['b1', 'b2', 'b3', 'b4', 'fb']);
    expect([...withIndicators(graph, ['x1'])]).toEqual(['x1']);
  });
});
