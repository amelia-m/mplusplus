import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseOut, buildPValueMap } from './out.js';

// Synthetic fixture: real Mplus 8.11 output for an invented model fitted to
// data simulated with Mplus MONTECARLO (see dgm/README.md, syn_sem). It has
// the real report layout: MODEL RESULTS, then STANDARDIZED MODEL RESULTS with
// separate STDYX, STDY and STD subsections.
const FIXTURE = resolve(__dirname, '../../test/fixtures/sample.out');

describe('parseOut', () => {
  const text = readFileSync(FIXTURE, 'utf8');
  const parsed = parseOut(text);

  it('parses BY rows into latent->indicator with p-values', () => {
    const a1 = parsed.unstd.find((r) => r.block === 'BY' && r.from === 'fa' && r.to === 'a1');
    expect(a1).toBeDefined();
    expect(a1!.estimate).toBeCloseTo(0.805, 3);
    expect(a1!.se).toBeCloseTo(0.044, 3);
    expect(a1!.pValue).toBe(0);
  });

  it('parses ON rows into predictor->dependent', () => {
    const onRow = parsed.unstd.find((r) => r.block === 'ON' && r.from === 'fc' && r.to === 'x1');
    expect(onRow).toBeDefined();
    expect(onRow!.estimate).toBeCloseTo(0.57, 3);
    expect(onRow!.pValue).toBe(0);
  });

  it('parses WITH rows, including a non-significant one', () => {
    const w = parsed.unstd.find((r) => r.block === 'WITH' && r.from === 'x2' && r.to === 'x1');
    expect(w).toBeDefined();
    expect(w!.estimate).toBeCloseTo(-0.006, 3);
    expect(w!.pValue).toBeCloseTo(0.816, 3);
  });

  it('parses Residual Variances rows with no `to`', () => {
    const res = parsed.unstd.find((r) => r.block === 'Residual Variances' && r.from === 'a1');
    expect(res).toBeDefined();
    expect(res!.to).toBeNull();
    expect(res!.estimate).toBeCloseTo(0.489, 3);
  });

  it('reads STDYX values from the real layout, where STDYX has its own header line', () => {
    // Regression: the section header regex needed STDYX on the same line as
    // STANDARDIZED MODEL RESULTS, so real Mplus output gave no STDYX rows.
    const a1 = parsed.stdyx.find((r) => r.block === 'BY' && r.from === 'fa' && r.to === 'a1');
    expect(a1?.estimate).toBeCloseTo(0.766, 3);
    const onRow = parsed.stdyx.find((r) => r.block === 'ON' && r.from === 'fc' && r.to === 'x1');
    expect(onRow?.estimate).toBeCloseTo(0.431, 3);
  });

  it('does not fold STDY or STD rows into STDYX', () => {
    // STD gives fa->a1 = 0.833; STDYX gives 0.766. Exactly one STDYX row.
    const rows = parsed.stdyx.filter((r) => r.block === 'BY' && r.from === 'fa' && r.to === 'a1');
    expect(rows).toHaveLength(1);
    expect(rows[0].estimate).toBeCloseTo(0.766, 3);
  });

  it('does not bleed past QUALITY OF NUMERICAL RESULTS section', () => {
    expect(parsed.unstd.some((r) => /condition/i.test(r.from))).toBe(false);
    expect(parsed.stdyx.some((r) => /condition/i.test(r.from))).toBe(false);
  });

  it('still reads the older single-line STDYX header', () => {
    const text = [
      'STANDARDIZED MODEL RESULTS (STDYX Standardization)',
      '                    Estimate       S.E.  Est./S.E.    P-Value',
      '',
      ' F        BY',
      '    Y1                 0.800      0.050     16.000      0.000',
      '',
    ].join('\n');
    expect(parseOut(text).stdyx.map((r) => r.to)).toEqual(['y1']);
  });
});

describe('buildPValueMap', () => {
  const map = buildPValueMap(parseOut(readFileSync(FIXTURE, 'utf8')));

  it('keys edges by `kind:from->to` matching the graph builder', () => {
    expect(map['BY:fa->a1']).toBeDefined();
    expect(map['BY:fa->a1'].unstd).toBe(0);
    expect(map['BY:fa->a1'].stdyx).toBe(0);
    expect(map['ON:fc->x1']).toBeDefined();
    expect(map['ON:fc->x1'].unstd).toBe(0);
  });

  it('records WITH edges under both orderings', () => {
    expect(map['WITH:x2->x1'].unstd).toBeCloseTo(0.816, 3);
    expect(map['WITH:x1->x2']).toEqual(map['WITH:x2->x1']);
  });

  it('omits variance-style rows from the p-value map', () => {
    expect(Object.keys(map).some((k) => k.endsWith('->'))).toBe(false);
  });

  it('records WITH rows under COVAR keys in both orderings (X4)', () => {
    expect(map['COVAR:x2->x1']).toEqual(map['WITH:x2->x1']);
    expect(map['COVAR:x1->x2']).toEqual(map['WITH:x2->x1']);
  });
});

describe('p-values outside [0, 1] (X5)', () => {
  it('stores the Mplus 999.000 placeholder for a fixed parameter as null', () => {
    const parsed = parseOut(readFileSync(FIXTURE, 'utf8'));
    const b1 = parsed.unstd.find((r) => r.block === 'BY' && r.from === 'fb' && r.to === 'b1');
    expect(b1).toBeDefined();
    expect(b1!.pValue).toBeNull();
    const map = buildPValueMap(parsed);
    expect(map['BY:fb->b1'].unstd).toBeNull();
    // The STDYX row for the same loading has a real p-value.
    expect(map['BY:fb->b1'].stdyx).toBe(0);
  });

  it('keeps 0 and 1, nulls negative and >1 values', () => {
    const text = [
      'MODEL RESULTS',
      '                    Estimate       S.E.  Est./S.E.    P-Value',
      '',
      ' F        BY',
      '    Y1                 1.000      0.000    999.000    999.000',
      '    Y2                 0.800      0.050     16.000      0.000',
      '    Y3                 0.010      0.100      0.100      1.000',
      '    Y4                 0.500      0.100      5.000     -0.500',
      '    Y5                 0.500      0.100      5.000      1.001',
      '',
    ].join('\n');
    const map = buildPValueMap(parseOut(text));
    expect(map['BY:f->y1'].unstd).toBeNull();
    expect(map['BY:f->y2'].unstd).toBe(0);
    expect(map['BY:f->y3'].unstd).toBe(1);
    expect(map['BY:f->y4'].unstd).toBeNull();
    expect(map['BY:f->y5'].unstd).toBeNull();
  });
});
