import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph, matchEdgeForRow } from './graph.js';

const DGM_DIR = resolve(__dirname, '../../../dgm');
const fixtures = readdirSync(DGM_DIR).filter((f) => f.endsWith('.dgm'));

const IDENT = /^[a-z_][a-z0-9_]*$/;

describe('buildGraph - corpus', () => {
  for (const name of fixtures) {
    it(`builds a well-formed graph for ${name}`, () => {
      const graph = buildGraph(parseDgm(readFileSync(join(DGM_DIR, name), 'utf8')));

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      for (const n of graph.nodes) expect(n.id, `node id ${n.id}`).toMatch(IDENT);

      // Every edge endpoint resolves to a node; one symmetric edge per pair.
      const ids = new Set(graph.nodes.map((n) => n.id));
      const pairs = new Set<string>();
      for (const e of graph.edges) {
        expect(ids.has(e.from), `missing source ${e.from}`).toBe(true);
        expect(ids.has(e.to), `missing target ${e.to}`).toBe(true);
        if (e.kind !== 'WITH' && e.kind !== 'COVAR') continue;
        const key = [e.from, e.to].sort().join('|');
        expect(pairs.has(key), `duplicate symmetric edge ${e.id}`).toBe(false);
        pairs.add(key);
      }
    });
  }
});

// syn_sem.dgm / syn_twofactor.dgm: synthetic fixtures (invented models and
// names, data simulated with Mplus MONTECARLO). See dgm/README.md.
describe('buildGraph - syn_sem.dgm', () => {
  const text = readFileSync(join(DGM_DIR, 'syn_sem.dgm'), 'utf8');
  const dgm = parseDgm(text);
  const graph = buildGraph(dgm);

  it('classifies latents and observed correctly', () => {
    expect(graph.nodes.find((n) => n.id === 'fa')?.kind).toBe('latent');
    expect(graph.nodes.find((n) => n.id === 'fc')?.kind).toBe('latent');
    expect(graph.nodes.find((n) => n.id === 'a1')?.kind).toBe('observed');
  });

  it('attaches unstd and stdyx estimates to BY edges', () => {
    const faA1 = graph.edges.find((e) => e.kind === 'BY' && e.from === 'fa' && e.to === 'a1');
    expect(faA1).toBeDefined();
    expect(faA1!.unstd?.value).toBeCloseTo(0.805, 3);
    expect(faA1!.stdyx?.value).toBeCloseTo(0.766, 3);
  });

  it('attaches constraint labels (la, lb) from code-91 rows', () => {
    const a2 = graph.edges.find((e) => e.kind === 'BY' && e.from === 'fa' && e.to === 'a2');
    expect(a2?.constraint).toBe('la');
    const b2 = graph.edges.find((e) => e.kind === 'BY' && e.from === 'fb' && e.to === 'b2');
    expect(b2?.constraint).toBe('lb');
  });

  it('builds ON edges in predictor->dependent direction', () => {
    const fcOnFb = graph.edges.find((e) => e.kind === 'ON' && e.from === 'fb' && e.to === 'fc');
    expect(fcOnFb).toBeDefined();
    expect(fcOnFb!.unstd?.value).toBeCloseTo(0.38, 3);
  });

  it('keeps a declared WITH and synthesizes COVAR for an undeclared code-2 pair', () => {
    expect(graph.edges.some((e) => e.kind === 'WITH' && e.from === 'c4' && e.to === 'b4')).toBe(true);
    const covar = graph.edges.filter((e) => e.kind === 'COVAR');
    expect(covar.map((e) => [e.from, e.to].sort().join('|'))).toEqual(['x1|x2']);
  });
});

describe('buildGraph - syn_twofactor.dgm', () => {
  it('synthesizes COVAR for the default factor covariance', () => {
    const graph = buildGraph(parseDgm(readFileSync(join(DGM_DIR, 'syn_twofactor.dgm'), 'utf8')));
    const covar = graph.edges.filter((e) => e.kind === 'COVAR');
    expect(covar.map((e) => [e.from, e.to].sort().join('|'))).toEqual(['fp|fq']);
  });
});

// syn_path.dgm / syn_range.dgm: synthetic fixtures (Mplus 8.11). See dgm/README.md.
describe('buildGraph - syn_path.dgm (no latents: every path lost its estimate)', () => {
  it('puts an unstandardized and a STDYX estimate on every regression path', () => {
    const graph = buildGraph(parseDgm(readFileSync(join(DGM_DIR, 'syn_path.dgm'), 'utf8')));
    const on = graph.edges.filter((e) => e.kind === 'ON');
    expect(on.map((e) => e.id).sort()).toEqual(
      ['ON:k1->d2', 'ON:k1->m1', 'ON:k2->m1', 'ON:k3->d1', 'ON:m1->d1', 'ON:m1->d2'],
    );
    for (const e of on) {
      expect(e.unstd, e.id).not.toBeNull();
      expect(e.stdyx, e.id).not.toBeNull();
    }
    expect(graph.nodes.every((n) => n.kind === 'observed')).toBe(true);
  });
});

describe('buildGraph - syn_range.dgm (list ranges became one node named y1-y3)', () => {
  const graph = buildGraph(parseDgm(readFileSync(join(DGM_DIR, 'syn_range.dgm'), 'utf8')));

  it('gives one BY edge per indicator, each with its estimate', () => {
    const by = graph.edges.filter((e) => e.kind === 'BY');
    expect(by.map((e) => e.id).sort()).toEqual([
      'BY:fg->g1', 'BY:fg->g2', 'BY:fg->g3', 'BY:fg->g4',
      'BY:fh->h1', 'BY:fh->h2', 'BY:fh->h3', 'BY:fh->h4',
    ]);
    for (const e of by) expect(e.unstd, e.id).not.toBeNull();
    expect(by.find((e) => e.id === 'BY:fg->g2')!.free).toBe(true);
    expect(by.filter((e) => e.constraint === 'lh').map((e) => e.to).sort()).toEqual(['h2', 'h3', 'h4']);
  });

  it('expands latent ranges on both sides of ON, and synthesizes no fallback ON edges', () => {
    const on = graph.edges.filter((e) => e.kind === 'ON');
    expect(on.map((e) => e.id).sort()).toEqual(
      ['ON:fg->t2', 'ON:fh->t2', 'ON:t1->fg', 'ON:t1->fh'],
    );
    for (const e of on) expect(e.unstd, e.id).not.toBeNull();
  });

  it('builds nodes from the expanded USEVARIABLES range `g1-t2` (no node g1-t2, none for the unused e1)', () => {
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      ['fg', 'fh', 'g1', 'g2', 'g3', 'g4', 'h1', 'h2', 'h3', 'h4', 't1', 't2'],
    );
  });
});

/** Minimal synthetic .dgm: latent `f` over y1..y3, caller-supplied model and rows. */
function synthGraph(model: string, rows: string[] = []) {
  const text = [
    'TITLE: synthetic',
    'VARIABLE: NAMES = y1 y2 y3;',
    'USEVARIABLES = y1 y2 y3;',
    'MODEL:',
    model,
    'INPUT_END',
    '2',
    'y1 y2 y3 f',
    '1',
    'f',
    'y1 y2 y3',
    ...rows,
    '',
  ].join('\n');
  return buildGraph(parseDgm(text));
}

describe('buildGraph - start values (X1)', () => {
  it('`f BY y1 y2*0.8 y3` gives node y2 and a free BY edge, no stray ON edge', () => {
    const g = synthGraph('f BY y1 y2*0.8 y3;', [
      '1 1 f y1 1.000 0.000',
      '1 1 f y2 0.800 0.050',
      '1 1 f y3 0.700 0.050',
    ]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['f', 'y1', 'y2', 'y3']);
    expect(g.edges.filter((e) => e.kind === 'ON')).toEqual([]);
    const y2 = g.edges.find((e) => e.id === 'BY:f->y2');
    expect(y2).toBeDefined();
    expect(y2!.free).toBe(true);
    expect(y2!.unstd?.value).toBeCloseTo(0.8, 3);
  });
});

describe('buildGraph - symmetric edges are deduplicated (X3)', () => {
  it('`y1 WITH y2; y2 WITH y1;` gives one WITH edge', () => {
    const g = synthGraph('f BY y1 y2 y3;\ny1 WITH y2;\ny2 WITH y1;');
    const withs = g.edges.filter((e) => e.kind === 'WITH');
    expect(withs).toHaveLength(1);
    expect(withs[0].id).toBe('WITH:y1->y2');
  });

  it('keeps modifiers from both declarations on the single WITH edge, and matches covariance rows in either order to it', () => {
    // Code 2 rows are not attached as estimates yet (TODO.md); this checks
    // only that a reversed covariance row finds the declared WITH edge
    // instead of synthesizing a second COVAR or ON edge.
    const g = synthGraph('f BY y1 y2 y3;\ny1 WITH y2*;\ny2 WITH y1 (c1);', [
      '2 1 y2 y1 0.300 0.100',
      '2 1 y1 y2 0.300 0.100',
    ]);
    const withs = g.edges.filter((e) => e.kind === 'WITH');
    expect(withs).toHaveLength(1);
    expect(withs[0].id).toBe('WITH:y1->y2');
    expect(withs[0].free).toBe(true);
    expect(withs[0].constraint).toBe('c1');
    expect(g.edges.filter((e) => e.kind === 'ON' || e.kind === 'COVAR')).toEqual([]);
  });

  it('synthesizes one COVAR edge for code-2 rows given in both orders', () => {
    const g = synthGraph('f BY y1 y2 y3;', ['2 1 y1 y3 0.100 0.020', '2 1 y3 y1 0.100 0.020']);
    expect(g.edges.filter((e) => e.kind === 'COVAR')).toHaveLength(1);
  });
});

describe('buildGraph - estimate rows prefer exact direction (P1)', () => {
  it.each([
    [['2 1 y1 y3 0.100 0.020', '1 1 y3 y1 0.400 0.090']],
    [['1 1 y3 y1 0.400 0.090', '2 1 y1 y3 0.100 0.020']],
  ])('a reversed code-1 row next to a COVAR pair gives its own ON edge (rows %j)', (rows) => {
    const g = synthGraph('f BY y1 y2 y3;', rows);
    const on = g.edges.filter((e) => e.kind === 'ON');
    expect(on.map((e) => e.id)).toEqual(['ON:y3->y1']);
    expect(on[0].unstd?.value).toBeCloseTo(0.4, 3);
    const covars = g.edges.filter((e) => e.kind === 'COVAR');
    expect(covars).toHaveLength(1);
    expect(covars[0].unstd).toBeNull();
    expect(covars[0].stdyx).toBeNull();
  });

  it.each([1, 11, 21, 31])(
    'a directed row of code %i with only a reversed WITH pair synthesizes an ON edge',
    (code) => {
      const g = synthGraph('f BY y1 y2 y3;\ny1 WITH y2;', [`${code} 1 y2 y1 0.250 0.080`]);
      expect(g.edges.filter((e) => e.kind !== 'BY').map((e) => e.id).sort()).toEqual(
        ['ON:y2->y1', 'WITH:y1->y2'],
      );
    },
  );

  it('a code-11 row with only a reversed WITH pair puts its STDYX estimate on the ON edge', () => {
    const g = synthGraph('f BY y1 y2 y3;\ny1 WITH y2;', ['11 1 y2 y1 0.250 0.080']);
    expect(g.edges.find((e) => e.id === 'ON:y2->y1')?.stdyx?.value).toBeCloseTo(0.25, 3);
    expect(g.edges.find((e) => e.kind === 'WITH')?.stdyx).toBeNull();
  });
});

describe('buildGraph - constraint-label rows by parameter type (9x)', () => {
  it.each(['92 1 y2 y1 cv', '92 1 y1 y2 cv'])(
    'a code-92 row labels the WITH edge in either order, `%s` (92 rows were dropped)',
    (row) => {
      const g = synthGraph('f BY y1 y2 y3;\ny1 WITH y2;', [row]);
      expect(g.edges.find((e) => e.kind === 'WITH')?.constraint).toBe('cv');
      expect(g.edges.filter((e) => e.kind === 'ON' || e.kind === 'COVAR')).toEqual([]);
    },
  );

  it('an unmatched code-92 row synthesizes a labelled COVAR edge', () => {
    const g = synthGraph('f BY y1 y2 y3;', ['92 1 y1 y3 cv']);
    const covars = g.edges.filter((e) => e.kind === 'COVAR');
    expect(covars.map((e) => e.constraint)).toEqual(['cv']);
  });

  it('a code-91 row labels the ON edge, not a WITH between the same pair (it took any exact edge)', () => {
    const g = synthGraph('f BY y1 y2 y3;\ny1 WITH y2;\ny2 ON y1;', ['91 1 y1 y2 b']);
    expect(g.edges.find((e) => e.id === 'ON:y1->y2')?.constraint).toBe('b');
    expect(g.edges.find((e) => e.kind === 'WITH')?.constraint).toBeNull();
  });

  it('label rows of variances (94, 95) attach to no edge', () => {
    const before = synthGraph('f BY y1 y2 y3;').edges;
    const g = synthGraph('f BY y1 y2 y3;', ['94 1 y1 rv', '95 1 f lv']);
    expect(g.edges).toEqual(before);
  });
});

describe('buildGraph - estimate rows prefer an edge of the matching type (F1.1)', () => {
  it.each(['y2 WITH y1;', 'y1 WITH y2;'])(
    '`%s y1 ON y2;` puts rows `1`/`11 1 y2 y1` on the ON edge, not the WITH (estimates on WITH bug)',
    (decl) => {
      const g = synthGraph(`f BY y1 y2 y3;\n${decl}\ny1 ON y2;`, [
        '1 1 y2 y1 0.500 0.100',
        '11 1 y2 y1 0.400 0.100',
      ]);
      const on = g.edges.find((e) => e.id === 'ON:y2->y1');
      expect(on?.unstd?.value).toBeCloseTo(0.5, 3);
      expect(on?.stdyx?.value).toBeCloseTo(0.4, 3);
      const w = g.edges.find((e) => e.kind === 'WITH');
      expect(w?.unstd).toBeNull();
      expect(w?.stdyx).toBeNull();
    },
  );

  it.each(['y2 WITH y1;', 'y1 WITH y2;'])(
    'a directed row next to `%s` with no declared ON gives the ON edge (it landed on `y2 WITH y1`)',
    (decl) => {
      const g = synthGraph(`f BY y1 y2 y3;\n${decl}`, ['1 1 y2 y1 0.500 0.100']);
      expect(g.edges.find((e) => e.id === 'ON:y2->y1')?.unstd?.value).toBeCloseTo(0.5, 3);
      expect(g.edges.find((e) => e.kind === 'WITH')?.unstd).toBeNull();
    },
  );

  it.each([2, 12, 22, 32, 92])(
    'a covariance row of code %i prefers a reversed WITH edge over an exact ON edge',
    (code) => {
      const edges = synthGraph('f BY y1 y2 y3;\ny2 ON y1;\ny2 WITH y1;').edges;
      expect(matchEdgeForRow(code, 'y1', 'y2', edges)?.id).toBe('WITH:y2->y1');
    },
  );

  it.each(['2 1 y1 y2 0.100 0.020', '2 1 y2 y1 0.100 0.020', '12 1 y1 y2 0.300 0.050'])(
    'a covariance row `%s` next to an ON edge gives a COVAR edge (it was absorbed by `ON:y1->y2`)',
    (row) => {
      const g = synthGraph('f BY y1 y2 y3;\ny2 ON y1;', [row]);
      expect(g.edges.filter((e) => e.kind === 'COVAR')).toHaveLength(1);
      expect(g.edges.filter((e) => e.kind === 'ON').map((e) => e.id)).toEqual(['ON:y1->y2']);
    },
  );
});
