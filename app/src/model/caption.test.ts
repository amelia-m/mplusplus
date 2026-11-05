import { describe, it, expect } from 'vitest';
import { modelCaptions } from './caption.js';

describe('modelCaptions', () => {
  it('names the variable, and any option other than WEIGHT, one line each', () => {
    const weights = [
      { option: 'WEIGHT', variables: 'w' },
      { option: 'REPWEIGHTS', variables: 'r1-r4' },
    ];
    expect(modelCaptions({ weights })).toEqual(['Weighted: w', 'Weighted: r1-r4 (REPWEIGHTS)']);
  });

  it('says nothing for an unweighted analysis', () => {
    expect(modelCaptions({ weights: [] })).toEqual([]);
  });

  it('says first that a model read from a .out alone was laid out from it', () => {
    expect(modelCaptions({ weights: [{ option: 'WEIGHT', variables: 'w' }], origin: 'out' })).toEqual([
      "Laid out from the .out; Mplus's Diagrammer may place it differently",
      'Weighted: w',
    ]);
  });
});
