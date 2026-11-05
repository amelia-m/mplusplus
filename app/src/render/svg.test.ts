import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  arrowheadBox,
  computeDiagramLabels,
  computeSignificanceInputs,
  edgeLabelShown,
  formatLabel,
  nodeShapeSpec,
  residualLabelId,
  type DiagramLabels,
} from './svg.js';
import { DEFAULT_GLOBAL_STYLE, type GlobalStyle } from './styles.js';
import { buildGraph, type GraphEdge } from '../model/graph.js';
import { parseDgm } from '../parser/dgm.js';
import { placeSem } from '../layout/sem.js';
import { labelBoxAt, overlapArea, pointOnPath, T_MAX, T_MIN } from './labelPlacement.js';
import type { Box } from './geometry.js';

// syn_cint.dgm: the synthetic syn_sem model run with OUTPUT: CINTERVAL (Mplus 8.11).
const cint = buildGraph(parseDgm(readFileSync(resolve(__dirname, '../../../dgm/syn_cint.dgm'), 'utf8')));
const edgeById = (id: string): GraphEdge => cint.edges.find((e) => e.id === id)!;

describe('formatLabel (SE and confidence limits on edge labels)', () => {
  const g = (patch: Partial<GlobalStyle>): GlobalStyle => ({ ...DEFAULT_GLOBAL_STYLE, decimals: 2, ...patch });
  const noOverride = { decimals: null };
  const faA1 = edgeById('BY:fa->a1'); // 0.805 (0.044) [0.719, 0.891]

  it.each([
    [{ showSE: true, showCI: false }, '0.81 (0.04)'],
    [{ showSE: false, showCI: true }, '0.81 [0.72, 0.89]'],
    [{ showSE: true, showCI: true }, '0.81 (0.04) [0.72, 0.89]'],
    [{ showSE: false, showCI: false }, '0.81'],
  ])('with %j gives %s', (patch, text) => {
    expect(formatLabel(faA1, g(patch), noOverride)).toBe(text);
  });

  it('shows a fixed parameter (SE 0) as its value alone, without SE or limits', () => {
    expect(formatLabel(edgeById('BY:fb->b1'), g({ showSE: true, showCI: true }), noOverride)).toBe('1.00');
  });

  it('shows a value whose SE Mplus did not give (999.000) alone', () => {
    const edge = { ...faA1, unstd: { value: 0.5, se: Number.NaN, ci: null }, stdyx: null };
    expect(formatLabel(edge, g({ showSE: true }), noOverride)).toBe('0.50');
  });

  it('takes the SE and limits from the active coefficient mode, on a covariance too', () => {
    const c4b4 = edgeById('WITH:c4->b4');
    const both = { showSE: true, showCI: true, decimals: 3 };
    expect(formatLabel(c4b4, g({ ...both, coefMode: 'unstd' }), noOverride)).toBe('0.123 (0.022) [0.079, 0.167]');
    expect(formatLabel(c4b4, g({ ...both, coefMode: 'stdyx' }), noOverride)).toBe('0.282 (0.045) [0.193, 0.371]');
  });

  it('uses the edge style decimals over the global ones', () => {
    expect(formatLabel(faA1, g({ showSE: true }), { decimals: 3 })).toBe('0.805 (0.044)');
  });
});

describe('edgeLabelShown', () => {
  const visible = { labelVisible: true };
  const hideCov = { ...DEFAULT_GLOBAL_STYLE, showCovarianceLabels: false };

  it('hides covariance labels, and only those, when the covariance toggle is off', () => {
    expect(edgeLabelShown({ kind: 'WITH' }, hideCov, visible, '0.12')).toBe(false);
    expect(edgeLabelShown({ kind: 'COVAR' }, hideCov, visible, '0.12')).toBe(false);
    expect(edgeLabelShown({ kind: 'ON' }, hideCov, visible, '0.12')).toBe(true);
    expect(edgeLabelShown({ kind: 'WITH' }, DEFAULT_GLOBAL_STYLE, visible, '0.12')).toBe(true);
  });

  it('hides every label when coefficients are off, a style hides it, or it has no text', () => {
    expect(edgeLabelShown({ kind: 'ON' }, { ...DEFAULT_GLOBAL_STYLE, showCoefficients: false }, visible, '0.12')).toBe(false);
    expect(edgeLabelShown({ kind: 'ON' }, DEFAULT_GLOBAL_STYLE, { labelVisible: false }, '0.12')).toBe(false);
    expect(edgeLabelShown({ kind: 'ON' }, DEFAULT_GLOBAL_STYLE, visible, '')).toBe(false);
  });
});

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

describe('label collision pass (avoidLabelOverlaps)', () => {
  const fixture = (name: string) => {
    const graph = buildGraph(parseDgm(readFileSync(resolve(__dirname, `../../../dgm/${name}.dgm`), 'utf8')));
    return { graph, layout: placeSem(graph, 120, 56) };
  };
  const labelsOf = (name: string, avoidLabelOverlaps: boolean): DiagramLabels =>
    computeDiagramLabels({
      ...fixture(name),
      global: { ...DEFAULT_GLOBAL_STYLE, avoidLabelOverlaps },
      edgeStyles: {},
      nodeStyles: {},
      pValues: {},
      nodeSelection: new Set(),
      edgeSelection: new Set(),
    });
  const boxes = (d: DiagramLabels): Map<string, Box> => new Map(d.labels.map((l) => [l.id, labelBoxAt(l, d.offsets.get(l.id)!)]));
  const overlappingPairs = (d: DiagramLabels): string[] => {
    const b = Array.from(boxes(d));
    return b.flatMap(([id, p], i) => b.slice(i + 1).filter(([, q]) => overlapArea(p, q) > 0).map(([jd]) => `${id} x ${jd}`));
  };
  /** Arrowheads at both ends of each covariance curve, from the curve's own label path. */
  const curveEnds = (d: DiagramLabels): Box[] =>
    d.labels.flatMap((l) =>
      l.kind === 'path' && l.path.kind === 'quadratic'
        ? [arrowheadBox(l.path.a, l.path.control), arrowheadBox(l.path.b, l.path.control)]
        : [],
    );
  const valuesOnCurveEnds = (d: DiagramLabels): string[] => {
    const ends = curveEnds(d);
    return Array.from(boxes(d))
      .filter(([id, b]) => id.startsWith('res:') && ends.some((e) => overlapArea(b, e) > 0))
      .map(([id]) => id)
      .sort();
  };

  it.each(['syn_sem', 'syn_path'])('leaves no two label boxes overlapping in %s', (name) => {
    expect(overlappingPairs(labelsOf(name, true))).toEqual([]);
  });

  it('separates the fanned loading labels of syn_sem, which overlap without the pass', () => {
    expect(overlappingPairs(labelsOf('syn_sem', false))).toContain('edge:BY:fa->a1 x edge:BY:fa->a2');
  });

  it.each([
    ['syn_sem', ['x1', 'x2', 'c4']],
    ['syn_path', ['d1', 'd2']],
  ])('moves the residual values of %s off covariance curve ends (seen 2026-11-02: %j)', (name, ids) => {
    const before = valuesOnCurveEnds(labelsOf(name, false));
    expect(before).toEqual(expect.arrayContaining(ids.map(residualLabelId)));
    expect(valuesOnCurveEnds(labelsOf(name, true))).toEqual([]);
  });

  it('keeps every label where it was with the toggle off', () => {
    for (const name of ['syn_sem', 'syn_path']) {
      const d = labelsOf(name, false);
      expect(d.labels.length).toBeGreaterThan(0);
      for (const l of d.labels) expect(d.offsets.get(l.id)).toEqual({ x: 0, y: 0 });
    }
  });

  it('keeps each coefficient label on its own path, between t 0.2 and 0.8 when moved', () => {
    const d = labelsOf('syn_sem', true);
    let moved = 0;
    for (const l of d.labels) {
      if (l.kind !== 'path') continue;
      const t = d.t.get(l.id)!;
      const o = d.offsets.get(l.id)!;
      const base = pointOnPath(l.path, l.t0);
      const at = pointOnPath(l.path, t);
      expect(base.x + o.x).toBeCloseTo(at.x, 9);
      expect(base.y + o.y).toBeCloseTo(at.y, 9);
      if (t !== l.t0) {
        moved++;
        expect(t).toBeGreaterThanOrEqual(T_MIN);
        expect(t).toBeLessThanOrEqual(T_MAX);
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('leaves out hidden values, keeping only the constraint labels, which stay drawn', () => {
    const { graph, layout } = fixture('syn_sem');
    const constrained = graph.edges.filter((e) => e.constraint).map((e) => `edge:${e.id}`);
    expect(constrained.length).toBeGreaterThan(0);
    const d = computeDiagramLabels({
      graph,
      layout,
      global: { ...DEFAULT_GLOBAL_STYLE, showCoefficients: false },
      edgeStyles: {},
      nodeStyles: {},
      pValues: {},
      nodeSelection: new Set(),
      edgeSelection: new Set(),
    });
    expect(d.labels.map((l) => l.id).sort()).toEqual(constrained.sort());
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
