import { describe, it, expect } from 'vitest';
import { arrangeTargets, selectBlocks } from './arrange.js';
import { useStore } from '../state/store.js';

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

describe('selectBlocks', () => {
  const graph = {
    nodes: [
      { id: 'f', kind: 'latent' },
      { id: 'y1', kind: 'observed' },
      { id: 'x', kind: 'observed' },
    ],
    edges: [{ id: 'BY:f->y1', from: 'f', to: 'y1', kind: 'BY' }],
  } as never;
  const run = (selection: string[]) => {
    useStore.setState({ graph, selection: new Set(selection) });
    return [selectBlocks(), [...useStore.getState().selection].sort()];
  };
  it('says why nothing was added: no selection, no factor selected, or the block already selected', () => {
    expect(run([])).toEqual(['no-selection', []]);
    expect(run(['x'])).toEqual(['no-factor', ['x']]);
    expect(run(['f', 'y1'])).toEqual(['complete', ['f', 'y1']]);
    expect(run(['f'])).toEqual(['added', ['f', 'y1']]);
  });
});
