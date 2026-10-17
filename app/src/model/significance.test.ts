import { describe, it, expect } from 'vitest';
import { isSignificant } from './significance.js';
import type { GraphEdge } from './graph.js';

const makeEdge = (value: number, se: number): GraphEdge => ({
  id: 'e',
  from: 'a',
  to: 'b',
  kind: 'ON',
  free: false,
  fixed: null,
  constraint: null,
  unstd: { value, se },
  stdyx: null,
});

describe('isSignificant', () => {
  it('returns true when |t| > 1.96 at alpha=0.05', () => {
    expect(isSignificant(makeEdge(0.5, 0.2))).toBe(true); // t = 2.5
  });

  it('returns false when |t| < 1.96 at alpha=0.05', () => {
    expect(isSignificant(makeEdge(0.1, 0.2))).toBe(false); // t = 0.5
  });

  it('uses the 2.576 threshold at alpha=0.01', () => {
    expect(isSignificant(makeEdge(0.5, 0.21), 0.01)).toBe(false); // t ~ 2.38
    expect(isSignificant(makeEdge(0.5, 0.18), 0.01)).toBe(true); // t ~ 2.78
  });

  it('handles negative coefficients via |t|', () => {
    expect(isSignificant(makeEdge(-0.5, 0.2))).toBe(true);
  });

  it('returns null when SE is zero or absent', () => {
    expect(isSignificant(makeEdge(1, 0))).toBe(null);
    const noEst: GraphEdge = { ...makeEdge(0, 1), unstd: null, stdyx: null };
    expect(isSignificant(noEst)).toBe(null);
  });

  it('prefers .out p-values when source=auto and pValue is provided', () => {
    const sig = isSignificant(makeEdge(0.01, 1), 0.05, 'auto', { pValue: 0.001 });
    expect(sig).toBe(true);
    const ns = isSignificant(makeEdge(10, 0.0001), 0.05, 'auto', { pValue: 0.9 });
    expect(ns).toBe(false);
  });

  it("returns null under source='out' when no p-value is available", () => {
    expect(isSignificant(makeEdge(0.5, 0.2), 0.05, 'out')).toBe(null);
  });
});
