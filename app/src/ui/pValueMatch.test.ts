import { describe, expect, it } from 'vitest';
import { countMatchedPValues } from './pValueMatch.js';

const p = { unstd: 0.01, stdyx: 0.02 };
const graph = { edges: [{ id: 'ON:x->y' }, { id: 'BY:f->y1' }, { id: 'WITH:a->b' }] };

describe('countMatchedPValues (Z7)', () => {
  it('counts only keys that are edge ids in the current graph', () => {
    const pValues = {
      'ON:x->y': p,
      'BY:f->y1': p,
      'ON:q->r': p, // not in the graph
      'WITH:a->b': p,
      'WITH:b->a': p, // reverse key for the same symmetric edge
    };
    expect(countMatchedPValues(pValues, graph)).toBe(3);
  });

  it('returns 0 when nothing matches', () => {
    expect(countMatchedPValues({ 'ON:q->r': p }, graph)).toBe(0);
    expect(countMatchedPValues({}, graph)).toBe(0);
  });

  it('does not count a key whose unstd and stdyx are both null (F5)', () => {
    const none = { unstd: null, stdyx: null };
    expect(countMatchedPValues({ 'ON:x->y': none, 'BY:f->y1': none }, graph)).toBe(0);
    expect(countMatchedPValues({ 'ON:x->y': none, 'BY:f->y1': { unstd: null, stdyx: 0.3 } }, graph)).toBe(1);
    expect(countMatchedPValues({ 'WITH:a->b': { unstd: 0.2, stdyx: null } }, graph)).toBe(1);
  });
});
