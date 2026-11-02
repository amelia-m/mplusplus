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
});
