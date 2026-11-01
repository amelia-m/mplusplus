import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { modelCaption } from './caption.js';

const fixture = (name: string) =>
  parseDgm(readFileSync(resolve(__dirname, '../../../dgm', name), 'utf8'));

describe('modelCaption', () => {
  it('names the weight variable of a weighted analysis', () => {
    expect(modelCaption(fixture('lcsmcn.dgm'))).toBe('Weighted: weight4');
  });

  it('says nothing for an unweighted analysis', () => {
    expect(modelCaption(fixture('syn_sem.dgm'))).toBeNull();
  });
});
