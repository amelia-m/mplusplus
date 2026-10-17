import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { elkEngine } from './elk.js';

// Synthetic fixture: invented model, simulated data (see dgm/README.md).
const FIXTURE = resolve(__dirname, '../../../dgm/syn_sem.dgm');

describe('elkEngine', () => {
  it('lays out the syn_sem graph with finite positions', async () => {
    const dgm = parseDgm(readFileSync(FIXTURE, 'utf8'));
    const graph = buildGraph(dgm);
    const result = await elkEngine.layout(graph, {
      width: 1200,
      height: 800,
      nodeWidth: 120,
      nodeHeight: 56,
    });

    expect(result.nodes.length).toBe(graph.nodes.length);
    for (const n of result.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    expect(result.edges.length).toBe(graph.edges.length);
  });

  it('produces few or zero edge crossings on syn_sem', async () => {
    const dgm = parseDgm(readFileSync(FIXTURE, 'utf8'));
    const graph = buildGraph(dgm);
    const result = await elkEngine.layout(graph, {
      width: 1200,
      height: 800,
      nodeWidth: 120,
      nodeHeight: 56,
    });

    const nodeCenters = new Map(
      result.nodes.map((n) => [n.id, { x: n.x + n.width / 2, y: n.y + n.height / 2 }]),
    );
    const segments = graph.edges
      .map((e) => {
        const a = nodeCenters.get(e.from);
        const b = nodeCenters.get(e.to);
        return a && b ? { a, b, id: e.id } : null;
      })
      .filter((x): x is { a: { x: number; y: number }; b: { x: number; y: number }; id: string } => !!x);

    let crossings = 0;
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        if (segmentsCross(segments[i], segments[j])) crossings++;
      }
    }
    // ELK 'layered' is expected to be near-zero. We approximate with
    // straight-line center-to-center segments here; the real renderer uses
    // ELK bend points so the visual crossing count is at most this number
    // and typically zero for this graph.
    // eslint-disable-next-line no-console
    console.log(`[elk] syn_sem straight-line crossings: ${crossings}`);
    expect(crossings).toBeLessThanOrEqual(3);
  });
});

function segmentsCross(
  s1: { a: { x: number; y: number }; b: { x: number; y: number } },
  s2: { a: { x: number; y: number }; b: { x: number; y: number } },
): boolean {
  // Skip segments that share an endpoint - they meet at a node, not cross.
  const eq = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    p.x === q.x && p.y === q.y;
  if (eq(s1.a, s2.a) || eq(s1.a, s2.b) || eq(s1.b, s2.a) || eq(s1.b, s2.b)) return false;

  const d = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(s2.a, s2.b, s1.a);
  const d2 = d(s2.a, s2.b, s1.b);
  const d3 = d(s1.a, s1.b, s2.a);
  const d4 = d(s1.a, s1.b, s2.b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
