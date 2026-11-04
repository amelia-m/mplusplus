import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { placeSem } from './sem.js';
import {
  curveSidesFollowingResiduals,
  transformGroup,
  transformPoint,
  transformSide,
  withIndicators,
} from './transform.js';

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

  it('comes back after four quarter turns, and after flipping twice, with or without stretch', () => {
    const pivot = { x: 7, y: -2 };
    let p = { x: 31, y: 12 };
    for (let i = 0; i < 4; i++) p = transformPoint(p, pivot, 'rotate-cw', 2.5);
    expect(p.x).toBeCloseTo(31);
    expect(p.y).toBeCloseTo(12);
    p = { x: 31, y: 12 };
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
    // Box centers: f (50, 5), a (30, 45), b (70, 45); their bounding box's
    // center is the pivot (50, 25). Boxes are 20 wide and 10 tall (aspect 2),
    // so offsets that turn horizontal double and those that turn vertical halve.
    const center = (id: string) => ({ x: r.positions[id].x + 10, y: r.positions[id].y + 5 });
    expect(center('f')).toEqual({ x: 90, y: 25 }); // was above the center, now right of it
    expect(center('a')).toEqual({ x: 10, y: 15 });
    expect(center('b')).toEqual({ x: 10, y: 35 });
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

  it('follows BY through a second-order factor to its first-order factors and their indicators', () => {
    const graph = {
      nodes: [],
      edges: [
        { id: '1', from: 'g', to: 'f1', kind: 'BY' },
        { id: '2', from: 'f1', to: 'y1', kind: 'BY' },
        { id: '3', from: 'g', to: 'f2', kind: 'BY' },
        { id: '4', from: 'f2', to: 'y2', kind: 'BY' },
        { id: '5', from: 'f2', to: 'w', kind: 'ON' },
      ],
    } as never;
    expect([...withIndicators(graph, ['g'])].sort()).toEqual(['f1', 'f2', 'g', 'y1', 'y2']);
  });
});

describe('turning keeps groups apart and in place', () => {
  const DGM = resolve(__dirname, '../../../dgm');
  const overlaps = (boxes: { x: number; y: number; width: number; height: number }[]) => {
    let n = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) n++;
      }
    return n;
  };
  for (const file of readdirSync(DGM).filter((f) => f.endsWith('.dgm'))) {
    it(`adds no overlapping boxes when the whole diagram is turned either way (${file})`, () => {
      const graph = buildGraph(parseDgm(readFileSync(join(DGM, file), 'utf8')));
      const placed = placeSem(graph, 120, 56);
      const positions = Object.fromEntries(placed.nodes.map((n) => [n.id, n]));
      const before = overlaps(placed.nodes);
      for (const op of ['rotate-cw', 'rotate-ccw'] as const) {
        const r = transformGroup({ ids: Object.keys(positions), positions, residualSides: {}, curves: [] }, op);
        expect(overlaps(Object.values(r.positions))).toBe(before);
      }
    });
  }

  it('keeps its pivot when boxes differ in size, so two quarter turns make a half turn about the same point', () => {
    const positions = { big: box(0, 0, 80, 80), small: box(200, 10, 120, 56) };
    const turn = (p: typeof positions) =>
      transformGroup({ ids: ['big', 'small'], positions: p, residualSides: {}, curves: [] }, 'rotate-cw').positions as typeof positions;
    const twice = turn(turn(positions));
    const flipped = transformGroup({ ids: ['big', 'small'], positions, residualSides: {}, curves: [] }, 'flip-h').positions;
    const flippedTwice = transformGroup({ ids: ['big', 'small'], positions: flipped, residualSides: {}, curves: [] }, 'flip-v').positions;
    // A half turn equals flipping both ways.
    expect(twice.big.x).toBeCloseTo(flippedTwice.big.x);
    expect(twice.big.y).toBeCloseTo(flippedTwice.big.y);
    expect(twice.small.x).toBeCloseTo(flippedTwice.small.x);
    expect(twice.small.y).toBeCloseTo(flippedTwice.small.y);
  });
});

describe('curveSidesFollowingResiduals', () => {
  const curves = [
    { id: 'c1', from: 'a', to: 'b', attach: 'residual' as const },
    { id: 'c2', from: 'a', to: 'z', attach: 'residual' as const },
    { id: 'c3', from: 'a', to: 'b', attach: 'node' as const },
    { id: 'c4', from: 'x', to: 'y', attach: 'residual' as const },
  ];
  it('moves a curve between residual tails to the side both its residuals now share, and leaves the rest', () => {
    const sides: Record<string, 'left' | 'right'> = { a: 'left', b: 'left', z: 'right', x: 'left', y: 'left' };
    const stored = new Set(['a', 'b']);
    expect(curveSidesFollowingResiduals(curves, (id) => sides[id], new Set(['a', 'b']), stored)).toEqual({ c1: 'left' });
  });

  it('clears the stored side of a curve whose residuals are both back on the layout default', () => {
    const layoutSides: Record<string, 'left' | 'right'> = { a: 'left', b: 'right' };
    expect(curveSidesFollowingResiduals(curves, (id) => layoutSides[id], new Set(['a', 'b']), new Set())).toEqual({
      c1: null,
      c2: null,
    });
  });
});

describe('turning boxes of mixed sizes', () => {
  it('adds no overlaps when wide boxes and round latents are stacked close together', () => {
    const positions: Record<string, { x: number; y: number; width: number; height: number }> = {};
    ['f1', 'f2', 'f3'].forEach((id, i) => (positions[id] = box(0, i * 90, 80, 80)));
    ['y1', 'y2', 'y3'].forEach((id, i) => (positions[id] = box(200, i * 66, 120, 56)));
    const r = transformGroup({ ids: Object.keys(positions), positions, residualSides: {}, curves: [] }, 'rotate-cw');
    const bs = Object.values(r.positions);
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const [a, b] = [bs[i], bs[j]];
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
      }
  });
});
