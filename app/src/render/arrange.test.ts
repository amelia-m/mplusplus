import { describe, it, expect } from 'vitest';
import { arrangeTargets } from './arrange.js';

const edges = [
  { id: 'ON:a->b', from: 'a', to: 'b' },
  { id: 'WITH:b->c', from: 'b', to: 'c' },
] as never;
const all = ['a', 'b', 'c', 'd'];

describe('arrangeTargets', () => {
  it('turns the selected nodes when there are any', () => {
    expect(arrangeTargets(new Set(['a']), new Set(['WITH:b->c']), edges, all)).toEqual(['a']);
  });
  it('turns the ends of the selected edges when only edges are selected, not the whole diagram', () => {
    expect(arrangeTargets(new Set(), new Set(['WITH:b->c']), edges, all).sort()).toEqual(['b', 'c']);
  });
  it('turns the whole diagram when nothing is selected', () => {
    expect(arrangeTargets(new Set(), new Set(), edges, all)).toEqual(all);
  });
});
