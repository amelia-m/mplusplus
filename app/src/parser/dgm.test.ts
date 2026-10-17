import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from './dgm.js';

const DGM_DIR = resolve(__dirname, '../../../dgm');
const fixtures = readdirSync(DGM_DIR).filter((f) => f.endsWith('.dgm'));

describe('parseDgm - corpus smoke tests', () => {
  for (const name of fixtures) {
    it(`parses ${name} without error and yields non-empty results`, () => {
      const text = readFileSync(join(DGM_DIR, name), 'utf8');
      const dgm = parseDgm(text);

      expect(dgm.inputBlock.length).toBeGreaterThan(0);
      expect(dgm.variables.length).toBeGreaterThan(0);
      expect(dgm.useVar.length).toBeGreaterThan(0);
      expect(dgm.modelStatements.length).toBeGreaterThan(0);
      expect(dgm.estimates.length).toBeGreaterThan(0);
      expect(dgm.latents.length).toBeGreaterThan(0);
      expect(dgm.observed.length).toBeGreaterThan(0);

      // Every BY statement should have at least one indicator term.
      for (const s of dgm.modelStatements) {
        if (s.op === 'BY') {
          expect(s.lhs.length).toBeGreaterThan(0);
          expect(s.rhs.length).toBeGreaterThan(0);
        }
      }

      // Estimate codes seen in this file should be a subset of the
      // expected vocabulary: the last digit is the parameter type (1 loading
      // or regression, 2 covariance, 4 residual variance, 5 latent variance),
      // the tens digit the estimate type (0 unstandardized, 1 STDYX, 2 STDY,
      // 3 STD); 91 is a constraint label. 2x codes appear in Mplus output
      // run with OUTPUT: STANDARDIZED.
      const allowed = new Set([1, 2, 4, 5, 11, 12, 14, 15, 21, 22, 24, 25, 31, 32, 34, 35, 91]);
      for (const e of dgm.estimates) {
        expect(allowed.has(e.code)).toBe(true);
      }
    });
  }
});

// syn_sem.dgm: synthetic fixture (invented model and names, data simulated
// with Mplus MONTECARLO, fitted with Mplus 8.11). See dgm/README.md.
describe('parseDgm - syn_sem.dgm specific', () => {
  const text = readFileSync(join(DGM_DIR, 'syn_sem.dgm'), 'utf8');
  const dgm = parseDgm(text);

  it('extracts the three latents from the groupings header', () => {
    expect(dgm.latents).toEqual(['fa', 'fb', 'fc']);
  });

  it('captures BY statement modifiers (free, constraint)', () => {
    const faBy = dgm.modelStatements.find((s) => s.op === 'BY' && s.lhs.toLowerCase() === 'fa');
    expect(faBy).toBeDefined();
    const a1 = faBy!.rhs.find((t) => t.name.toLowerCase() === 'a1');
    expect(a1?.free).toBe(true);
    const a2 = faBy!.rhs.find((t) => t.name.toLowerCase() === 'a2');
    expect(a2?.constraint).toBe('la');
    const fbBy = dgm.modelStatements.find((s) => s.op === 'BY' && s.lhs.toLowerCase() === 'fb');
    const b3 = fbBy!.rhs.find((t) => t.name.toLowerCase() === 'b3');
    expect(b3?.constraint).toBe('lb');
  });

  it('parses ON statements with multiple LHS tokens (x1 x2 ON fc)', () => {
    const onStmts = dgm.modelStatements.filter(
      (s) => s.op === 'ON' && s.rhs.some((r) => r.name.toLowerCase() === 'fc'),
    );
    const lhsNames = onStmts.map((s) => s.lhs.toLowerCase());
    expect(lhsNames).toEqual(expect.arrayContaining(['x1', 'x2']));
  });

  it('parses estimate rows of all observed shapes', () => {
    const code1 = dgm.estimates.filter((e) => e.code === 1);
    const code91 = dgm.estimates.filter((e) => e.code === 91);
    const code4 = dgm.estimates.filter((e) => e.code === 4);

    expect(code1.length).toBeGreaterThan(0);
    expect(code91.length).toBeGreaterThan(0);
    expect(code4.length).toBeGreaterThan(0);

    // code 4 rows are residual variance (no `to`).
    expect(code4.every((e) => e.to === null)).toBe(true);
    // code 91 rows have a constraint label and no value/SE.
    expect(code91.every((e) => e.constraintLabel !== null)).toBe(true);
    expect(code91.every((e) => e.value === null && e.se === null)).toBe(true);

    // Spot-check one numeric value.
    const faA1 = code1.find((e) => e.from === 'fa' && e.to === 'a1');
    expect(faA1?.value).toBeCloseTo(0.805, 3);
    expect(faA1?.se).toBeCloseTo(0.044, 3);
  });

  it('keeps equality-constraint labels on BY terms and on code-91 rows', () => {
    const fbBy = dgm.modelStatements.find((s) => s.op === 'BY' && s.lhs.toLowerCase() === 'fb');
    const constraints = fbBy!.rhs.filter((t) => t.constraint != null).map((t) => t.constraint);
    expect(constraints).toEqual(['lb', 'lb']);
    const labels91 = new Set(
      dgm.estimates.filter((e) => e.code === 91).map((e) => e.constraintLabel ?? ''),
    );
    expect([...labels91].sort()).toEqual(['la', 'lb']);
  });
});

/** Minimal synthetic .dgm: one latent `f` measured by y1..y3. */
function synthDgm(input: string, rows: string[] = []): string {
  return [
    'TITLE: synthetic',
    input,
    'INPUT_END',
    '2',
    'y1 y2 y3 f',
    '1',
    'f',
    'y1 y2 y3',
    ...rows,
    '',
  ].join('\n');
}

describe('parseDgm - start values in term lists', () => {
  const termsOf = (model: string) => {
    const dgm = parseDgm(
      synthDgm(`VARIABLE: NAMES = y1 y2 y3;\nUSEVARIABLES = y1 y2 y3;\nMODEL:\n${model}`),
    );
    const by = dgm.modelStatements.find((s) => s.op === 'BY');
    expect(by).toBeDefined();
    return by!.rhs;
  };

  it('reads `y2*0.8` as a free term named y2 with start value 0.8', () => {
    const rhs = termsOf('f BY y1 y2*0.8 y3;');
    expect(rhs.map((t) => t.name)).toEqual(['y1', 'y2', 'y3']);
    const y2 = rhs[1];
    expect(y2.free).toBe(true);
    expect(y2.start).toBeCloseTo(0.8, 10);
    expect(y2.fixed).toBeNull();
  });

  it('accepts leading-dot and negative start values', () => {
    const rhs = termsOf('f BY y1 y2*.5 y3*-1.25;');
    expect(rhs.map((t) => t.name)).toEqual(['y1', 'y2', 'y3']);
    expect(rhs[1].start).toBeCloseTo(0.5, 10);
    expect(rhs[2].start).toBeCloseTo(-1.25, 10);
  });

  it('keeps a bare `y2*` free with no start value', () => {
    const y2 = termsOf('f BY y1 y2* y3;')[1];
    expect(y2.name).toBe('y2');
    expect(y2.free).toBe(true);
    expect(y2.start).toBeNull();
  });

  it('keeps `y2@1` as a fixed term', () => {
    const y2 = termsOf('f BY y1 y2@1 y3;')[1];
    expect(y2.name).toBe('y2');
    expect(y2.free).toBe(false);
    expect(y2.fixed).toBe(1);
  });

  it('keeps the constraint label on `y2*0.8 (lab)` and `y2*0.8(lab)`', () => {
    for (const model of ['f BY y1 y2*0.8 (lab) y3;', 'f BY y1 y2*0.8(lab) y3;']) {
      const rhs = termsOf(model);
      expect(rhs.map((t) => t.name)).toEqual(['y1', 'y2', 'y3']);
      expect(rhs[1].constraint).toBe('lab');
      expect(rhs[1].start).toBeCloseTo(0.8, 10);
    }
  });
});

describe('parseDgm - ARE / IS option syntax', () => {
  it('parses `NAMES ARE` and `USEVARIABLES ARE` like `=`', () => {
    const dgm = parseDgm(
      synthDgm('VARIABLE: NAMES ARE y1 y2 y3;\nUSEVARIABLES ARE y1 y2;\nMODEL:\nf BY y1 y2;'),
    );
    expect(dgm.variables).toEqual(['y1', 'y2', 'y3']);
    expect(dgm.useVar).toEqual(['y1', 'y2']);
  });

  it('parses `NAMES IS` and `USEVARIABLES IS` (any case)', () => {
    const dgm = parseDgm(
      synthDgm('variable: names is y1 y2 y3;\nusevariables is y1 y3;\nmodel:\nf by y1 y3;'),
    );
    expect(dgm.variables).toEqual(['y1', 'y2', 'y3']);
    expect(dgm.useVar).toEqual(['y1', 'y3']);
  });

  it('still parses `=` with and without surrounding spaces', () => {
    const dgm = parseDgm(
      synthDgm('VARIABLE: NAMES=y1 y2 y3;\nUSEVAR = y1 y2;\nMODEL:\nf BY y1 y2;'),
    );
    expect(dgm.variables).toEqual(['y1', 'y2', 'y3']);
    expect(dgm.useVar).toEqual(['y1', 'y2']);
  });
});

describe('parseDgm - modifiers with missing or negative values (R7, R8)', () => {
  const statementsOf = (model: string) =>
    parseDgm(
      synthDgm(`VARIABLE: NAMES = y1 y2 y3;\nUSEVARIABLES = y1 y2 y3;\nMODEL:\n${model}`),
    ).modelStatements;

  it('leaves `fixed` null for `y2@` with no value in a term list', () => {
    const by = statementsOf('f BY y1 y2@ y3;').find((s) => s.op === 'BY')!;
    expect(by.rhs.map((t) => t.name)).toEqual(['y1', 'y2', 'y3']);
    expect(by.rhs[1].fixed).toBeNull();
  });

  it('still reads `y2@0` as fixed at 0', () => {
    const by = statementsOf('f BY y1 y2@0 y3;').find((s) => s.op === 'BY')!;
    expect(by.rhs[1].fixed).toBe(0);
  });

  it('leaves `fixed` null for a standalone `y1@;`', () => {
    const self = statementsOf('y1@;').find((s) => s.lhs === 'y1')!;
    expect(self).toBeDefined();
    expect(self.rhs[0].fixed).toBeNull();
  });

  it('accepts a negative standalone start value `y1*-0.3;`', () => {
    const self = statementsOf('y1*-0.3;').find((s) => s.lhs === 'y1')!;
    expect(self).toBeDefined();
    expect(self.rhs[0].free).toBe(true);
    expect(self.rhs[0].start).toBeCloseTo(-0.3, 10);
  });

  it('accepts a negative standalone fixed value `y1@-1;`', () => {
    const self = statementsOf('y1@-1;').find((s) => s.lhs === 'y1')!;
    expect(self).toBeDefined();
    expect(self.rhs[0].fixed).toBe(-1);
  });
});

describe('parseDgm - one modifier grammar for term lists and standalone pins (P2)', () => {
  const statementsOf = (model: string) =>
    parseDgm(
      synthDgm(`VARIABLE: NAMES = y1 y2 y3;\nUSEVARIABLES = y1 y2 y3;\nMODEL:\n${model}`),
    ).modelStatements;
  const byTerms = (model: string) => statementsOf(model).find((s) => s.op === 'BY')!.rhs;

  it('reads `y2@ 1` as y2 fixed at 1, not a variable named 1', () => {
    const rhs = byTerms('f BY y1 y2@ 1 y3;');
    expect(rhs.map((t) => t.name)).toEqual(['y1', 'y2', 'y3']);
    expect(rhs[1].fixed).toBe(1);
  });

  it('reads `y2* 0.8` as y2 free with start 0.8, not a variable named 0.8', () => {
    const rhs = byTerms('f BY y1 y2* 0.8 y3;');
    expect(rhs.map((t) => t.name)).toEqual(['y1', 'y2', 'y3']);
    expect(rhs[1].free).toBe(true);
    expect(rhs[1].start).toBeCloseTo(0.8, 10);
  });

  it('reads `y2 @ 1` (modifier and value as their own tokens)', () => {
    const rhs = byTerms('f BY y1 y2 @ 1 y3;');
    expect(rhs.map((t) => t.name)).toEqual(['y1', 'y2', 'y3']);
    expect(rhs[1].fixed).toBe(1);
  });

  it('parses a standalone pin with an exponent, `y1@1e-3;`', () => {
    const self = statementsOf('y1@1e-3;').find((s) => s.lhs === 'y1');
    expect(self).toBeDefined();
    expect(self!.rhs[0].fixed).toBeCloseTo(0.001, 12);
  });

  it('parses a standalone start value plus pin, `y1*0.5@1;`', () => {
    const self = statementsOf('y1*0.5@1;').find((s) => s.lhs === 'y1');
    expect(self).toBeDefined();
    expect(self!.rhs[0].name).toBe('y1');
    expect(self!.rhs[0].free).toBe(true);
    expect(self!.rhs[0].start).toBeCloseTo(0.5, 10);
    expect(self!.rhs[0].fixed).toBe(1);
  });

  it('parses a standalone pin with a spaced value, `y1@ 0.5;`', () => {
    const self = statementsOf('y1@ 0.5;').find((s) => s.lhs === 'y1');
    expect(self).toBeDefined();
    expect(self!.rhs[0].fixed).toBeCloseTo(0.5, 10);
  });
});
