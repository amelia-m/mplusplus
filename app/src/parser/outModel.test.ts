import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { parseDgm, type DgmFile } from './dgm.js';
import { OUT_REFUSAL_MESSAGES, outToDgm, readOutModel, unsupportedOutReason } from './outModel.js';
import { buildGraph, type ModelGraph } from '../model/graph.js';

const REPO = resolve(__dirname, '../../..');
const FIXTURES = resolve(__dirname, '../../test/fixtures');
const DGM_DIR = join(REPO, 'dgm');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const dgmFixture = (name: string): string => readFileSync(join(DGM_DIR, name), 'utf8');

const round = (v: number | undefined): number | null => (v === undefined ? null : Math.round(v * 1000) / 1000 || 0);

/**
 * The covariance edges of a `.dgm` that come only from `999.000` rows (the
 * covariances among exogenous variables Mplus lists but does not estimate).
 * A `.out` does not print them; their rule is a separate contract (Amelia,
 * 2026-11-04), so they are the one difference allowed in a paired comparison.
 */
function defaultCovarianceCurves(dgm: DgmFile, graph: ModelGraph): Set<string> {
  const ids = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind !== 'COVAR') continue;
    const rows = dgm.estimates.filter(
      (r) =>
        [2, 12, 22, 32].includes(r.code) &&
        ((r.from.toLowerCase() === e.from && r.to?.toLowerCase() === e.to) ||
          (r.from.toLowerCase() === e.to && r.to?.toLowerCase() === e.from)),
    );
    if (rows.length > 0 && rows.every((r) => r.value === 999)) ids.add(e.id);
  }
  return ids;
}

/** What a paired comparison compares: nodes, edges, estimates to 3 decimals and labels. */
function summary(graph: ModelGraph, skipEdges: Set<string> = new Set()) {
  return {
    nodes: Object.fromEntries(
      [...graph.nodes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((n) => [
          n.id,
          {
            kind: n.kind,
            residual: [round(n.residual?.unstd?.value), round(n.residual?.stdyx?.value)],
          },
        ]),
    ),
    edges: Object.fromEntries(
      graph.edges
        .filter((e) => !skipEdges.has(e.id))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => [
          e.id,
          { kind: e.kind, unstd: round(e.unstd?.value), stdyx: round(e.stdyx?.value), constraint: e.constraint },
        ]),
    ),
  };
}

/** Compare the graph of a `.out` with the graph of the `.dgm` from the same Mplus run. */
function comparePair(dgmText: string, outText: string): void {
  const dgm = parseDgm(dgmText);
  const fromDgm = buildGraph(dgm);
  const fromOut = buildGraph(outToDgm(outText));
  expect(summary(fromOut)).toEqual(summary(fromDgm, defaultCovarianceCurves(dgm, fromDgm)));
}

describe('outToDgm: paired with the .dgm of the same run', () => {
  it('gives the graph syn_sem.dgm gives (sample.out)', () => {
    comparePair(dgmFixture('syn_sem.dgm'), fixture('sample.out'));
  });

  it('gives the graph syn_twofactor.dgm gives (syn_twofactor.out)', () => {
    comparePair(dgmFixture('syn_twofactor.dgm'), fixture('syn_twofactor.out'));
  });

  // Local pairs: Mplus runs in the gitignored docs/reference/mplus-runs/,
  // present only on machines with Mplus. Each `.dgm` there with a `.out` of
  // the same name, from a model this reader supports, is compared.
  const RUNS = join(REPO, 'docs/reference/mplus-runs');
  const walk = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return e.isFile() && e.name.toLowerCase().endsWith('.dgm') ? [p] : [];
      });
    } catch {
      return [];
    }
  };
  const present = existsSync(RUNS);
  const pairs = (present ? walk(RUNS) : []).flatMap((dgmPath) => {
    const dir = resolve(dgmPath, '..');
    const stem = basename(dgmPath).slice(0, -'.dgm'.length).toLowerCase();
    const outName = readdirSync(dir).find((n) => n.toLowerCase() === `${stem}.out`);
    if (!outName) return [];
    const outText = readFileSync(join(dir, outName), 'utf8');
    if (!readOutModel(outText).ok) return [];
    return [{ name: relative(REPO, dgmPath).split('\\').join('/'), dgmText: readFileSync(dgmPath, 'utf8'), outText }];
  });

  it.skipIf(!present)(`compares at least one local pair (${pairs.length} compared)`, () => {
    expect(pairs.length).toBeGreaterThan(0);
  });
  for (const p of pairs) {
    it(`gives the graph the .dgm gives (${p.name})`, () => comparePair(p.dgmText, p.outText));
  }
});

describe('outToDgm: what must survive (sample.out, syn_sem)', () => {
  const graph = buildGraph(outToDgm(fixture('sample.out')));

  it('keeps the covariance Mplus adds by default (X2 WITH X1) as a COVAR edge', () => {
    const e = graph.edges.find((x) => x.id === 'COVAR:x2->x1');
    expect(e?.kind).toBe('COVAR');
    // Its code-2 row from the .out's X2 WITH X1 block, as a .dgm's code-2 row attaches.
    expect(e?.unstd?.value).toBe(-0.006);
    expect(e?.unstd?.se).toBe(0.027);
  });

  it('puts the labels la and lb on the loadings that carry them, and no others', () => {
    const labelled = Object.fromEntries(
      graph.edges.filter((e) => e.constraint !== null).map((e) => [e.id, e.constraint]),
    );
    expect(labelled).toEqual({
      'BY:fa->a2': 'la',
      'BY:fa->a3': 'la',
      'BY:fb->b2': 'lb',
      'BY:fb->b3': 'lb',
    });
  });

  it('marks the model as read from a .out, with no levels', () => {
    const dgm = outToDgm(fixture('sample.out'));
    expect(dgm.origin).toBe('out');
    expect(dgm.header.levels).toBeNull();
  });
});

describe('outToDgm: a .out with no input echo (NOECHO)', () => {
  // The synthetic syn_sem output with its input echo cut out, as NOECHO prints it.
  const noEcho = fixture('sample.out').replace(/INPUT INSTRUCTIONS[\s\S]*?INPUT READING TERMINATED NORMALLY\n?/, '');

  it('still builds the BY and ON edges from the results, with no labels', () => {
    const model = readOutModel(noEcho);
    expect(model.ok && model.echo).toBe(false);
    const graph = buildGraph(outToDgm(noEcho));
    const kinds = Object.fromEntries(graph.edges.map((e) => [e.id, e.kind]));
    expect(kinds['BY:fa->a1']).toBe('BY');
    expect(kinds['ON:z1->fa']).toBe('ON');
    expect(kinds['ON:fc->x2']).toBe('ON');
    // Without the input a declared covariance cannot be told from a default one.
    expect(kinds['COVAR:c4->b4']).toBe('COVAR');
    expect(graph.edges.every((e) => e.constraint === null)).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'fa')?.kind).toBe('latent');
  });
});

describe('unsupportedOutReason: refusals', () => {
  it('refuses a two-group analysis (syn_twogroup.out) with its message', () => {
    const model = readOutModel(fixture('syn_twogroup.out'));
    expect(model).toEqual({ ok: false, reason: 'groups', message: OUT_REFUSAL_MESSAGES.groups });
    expect(OUT_REFUSAL_MESSAGES.groups).toBe(
      'This .out is a multiple-group analysis; only single-group models open on their own so far.',
    );
  });

  it('refuses binary items with thresholds (syn_cat.out) with its message', () => {
    const model = readOutModel(fixture('syn_cat.out'));
    expect(model).toEqual({ ok: false, reason: 'categorical', message: OUT_REFUSAL_MESSAGES.categorical });
  });

  it('accepts the single-group continuous fixtures', () => {
    expect(unsupportedOutReason(fixture('sample.out'))).toBeNull();
    expect(unsupportedOutReason(fixture('syn_twofactor.out'))).toBeNull();
  });

  // The other reasons, on the synthetic syn_sem output with one line of the
  // kind Mplus prints for them added to its summary.
  const sample = fixture('sample.out').replace(/\r\n?/g, '\n');
  const withLine = (line: string) => sample.replace('SUMMARY OF ANALYSIS\n', `SUMMARY OF ANALYSIS\n\n${line}\n`);
  it.each([
    ['montecarlo', 'Number of replications'],
    ['classes', 'Categorical latent variables'],
    ['levels', 'Within Level'],
    ['bayes', 'Estimator                                                    BAYES'],
  ] as const)('refuses %s output', (reason, line) => {
    expect(unsupportedOutReason(withLine(line))).toBe(reason);
  });

  it('does not refuse a continuous model whose echoed TITLE has a line starting with Count, which read as count outcomes', () => {
    const titled = sample.replace(/(INPUT INSTRUCTIONS\n\n)/, '$1  TITLE: a model\n  Count of items per factor: 4\n  Thresholds\n');
    expect(titled).toContain('Count of items per factor');
    expect(unsupportedOutReason(titled)).toBeNull();
  });

  it('refuses an estimation that did not terminate normally', () => {
    expect(unsupportedOutReason(sample.replace('THE MODEL ESTIMATION TERMINATED NORMALLY', ''))).toBe('abnormal');
  });

  it('refuses a .out with no MODEL RESULTS', () => {
    expect(unsupportedOutReason(sample.replace(/^MODEL RESULTS$/m, ''))).toBe('no-results');
  });

  it('throws the message from outToDgm, for a restore', () => {
    expect(() => outToDgm(fixture('syn_cat.out'))).toThrow(OUT_REFUSAL_MESSAGES.categorical);
  });
});
