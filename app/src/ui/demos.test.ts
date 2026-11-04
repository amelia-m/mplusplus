import { describe, it, expect } from 'vitest';
import { DEMOS } from './demos.js';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { buildPValueMap, parseOut } from '../parser/out.js';
import { countMatchedPValues } from './pValueMatch.js';
import { classifyFile } from '../io/load.js';

describe('demo examples', () => {
  it.each(DEMOS.map((d) => [d.label, d] as const))('%s opens a .dgm first, and its .out gives every edge a p-value', (_, demo) => {
    const [first, ...rest] = demo.files;
    // The kinds `handleFile` will route each file by.
    expect(classifyFile(new File([first.text], first.name))).toBe('dgm');
    for (const f of rest) expect(classifyFile(new File([f.text], f.name))).toBe('out');
    const graph = buildGraph(parseDgm(first.text));
    expect(graph.nodes.length).toBeGreaterThan(0);
    // A .out from another run would match few or no edges.
    for (const out of rest) {
      const pValues = buildPValueMap(parseOut(out.text));
      expect(countMatchedPValues(pValues, graph)).toBe(graph.edges.length);
    }
  });
});
