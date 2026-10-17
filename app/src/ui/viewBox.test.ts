import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEWBOX, contentViewBox, formatViewBox } from './viewBox.js';

const box = (x: number, y: number, width = 120, height = 56) => ({ x, y, width, height });

describe('contentViewBox (Z2)', () => {
  it('returns the default viewBox for an empty graph', () => {
    expect(contentViewBox([])).toEqual(DEFAULT_VIEWBOX);
  });

  it('covers every node plus padding on each side', () => {
    const vb = contentViewBox([box(0, 0), box(300, 200)], { padding: 20 });
    expect(vb).toEqual({ x: -20, y: -20, width: 420 + 40, height: 256 + 40 });
  });

  it('follows content that moved to negative coordinates', () => {
    const vb = contentViewBox([box(-500, -100), box(100, 50)], { padding: 10 });
    expect(vb.x).toBe(-510);
    expect(vb.y).toBe(-110);
    expect(vb.x + vb.width).toBe(100 + 120 + 10);
    expect(vb.y + vb.height).toBe(50 + 56 + 10);
  });

  it('ignores nodes with non-finite geometry', () => {
    const vb = contentViewBox([box(0, 0), box(Number.NaN, 5), box(Infinity, 0)], { padding: 0 });
    expect(vb).toEqual({ x: 0, y: 0, width: 120, height: 56 });
  });

  it('falls back to the default when no node has finite geometry', () => {
    expect(contentViewBox([box(Number.NaN, 0)])).toEqual(DEFAULT_VIEWBOX);
  });

  it('includes edge bend points that lie outside the node boxes (F3)', () => {
    // Two nodes side by side; an edge between them routes above and to the
    // left of both through bend points.
    const vb = contentViewBox([box(0, 0), box(300, 0)], {
      padding: 10,
      points: [
        { x: -80, y: -150 },
        { x: 500, y: -150 },
      ],
    });
    expect(vb.x).toBe(-90);
    expect(vb.y).toBe(-160);
    expect(vb.x + vb.width).toBe(510);
    expect(vb.y + vb.height).toBe(56 + 10);
  });

  it('ignores non-finite bend points and does not fit to points alone when there are no nodes', () => {
    const vb = contentViewBox([box(0, 0)], { padding: 0, points: [{ x: Number.NaN, y: 999 }] });
    expect(vb).toEqual({ x: 0, y: 0, width: 120, height: 56 });
    expect(contentViewBox([], { points: [{ x: 5000, y: 5000 }] })).toEqual(DEFAULT_VIEWBOX);
  });

  it('formats as an SVG viewBox attribute', () => {
    expect(formatViewBox({ x: -20, y: 5, width: 300, height: 100 })).toBe('-20 5 300 100');
  });
});
