import { describe, expect, it } from 'vitest';
import { boundaryPoint } from './geometry.js';

const node = { x: 0, y: 0, width: 120, height: 56 };
const cx = 60;
const cy = 28;
const rx = 60;
const ry = 28;

describe('boundaryPoint (Y5)', () => {
  it('ellipse: a 45 degree ray meets the ellipse outline', () => {
    const p = boundaryPoint(node, 'ellipse', { x: cx + 100, y: cy + 100 });
    const onEllipse = ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2;
    expect(Math.abs(onEllipse - 1)).toBeLessThan(0.01);
    expect(p.x - cx).toBeCloseTo(p.y - cy, 9);
  });

  it('diamond: a 45 degree ray meets the diamond outline', () => {
    const p = boundaryPoint(node, 'diamond', { x: cx + 100, y: cy + 100 });
    const onDiamond = Math.abs(p.x - cx) / rx + Math.abs(p.y - cy) / ry;
    expect(Math.abs(onDiamond - 1)).toBeLessThan(0.01);
  });

  it('rect: unchanged, a 45 degree ray meets the bottom edge', () => {
    const p = boundaryPoint(node, 'rect', { x: cx + 100, y: cy + 100 });
    expect(p).toEqual({ x: cx + 28, y: 56 });
    const r = boundaryPoint(node, 'rounded-rect', { x: cx + 100, y: cy + 100 });
    expect(r).toEqual(p);
  });

  it('axis-aligned rays hit the extreme points for every shape', () => {
    for (const shape of ['ellipse', 'diamond', 'rect', 'rounded-rect'] as const) {
      const right = boundaryPoint(node, shape, { x: 500, y: cy });
      expect(right.x).toBeCloseTo(120, 9);
      expect(right.y).toBeCloseTo(cy, 9);
    }
  });

  it('pulls the point back along the ray by the gap', () => {
    const p = boundaryPoint(node, 'ellipse', { x: 500, y: cy }, 4);
    expect(p.x).toBeCloseTo(116, 9);
  });

  it('returns the centre when the anchor is the centre', () => {
    expect(boundaryPoint(node, 'ellipse', { x: cx, y: cy })).toEqual({ x: cx, y: cy });
  });
});
