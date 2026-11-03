import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph, type ModelGraph } from '../model/graph.js';
import { indicatorSide, semColumns } from './semColumns.js';

const DGM_DIR = resolve(__dirname, '../../../dgm');
const load = (name: string): ModelGraph => buildGraph(parseDgm(readFileSync(join(DGM_DIR, name), 'utf8')));
const withoutLevels = (g: ModelGraph): ModelGraph => ({
  ...g,
  nodes: g.nodes.map((n) => ({ ...n, level: null })),
});

describe('indicatorSide - where a latent\'s indicators go (D7)', () => {
  it('puts them right when the model has one column', () => {
    expect(indicatorSide(0, 1, 0, 2)).toBe('right');
  });
  it('puts them left in the first of several columns and right in the last', () => {
    expect(indicatorSide(0, 3, 0, 1)).toBe('left');
    expect(indicatorSide(2, 3, 0, 1)).toBe('right');
  });
  it('puts them below in a middle column, above for the first of several latents there', () => {
    expect(indicatorSide(1, 3, 0, 1)).toBe('bottom');
    expect(indicatorSide(1, 4, 0, 2)).toBe('top');
    expect(indicatorSide(1, 4, 1, 2)).toBe('bottom');
  });
});

describe('semColumns', () => {
  it('takes columns and stacking from Mplus\'s levels (syn_sem.dgm)', () => {
    const { columns, indicators } = semColumns(load('syn_sem.dgm'));
    expect(columns).toEqual([['z1'], ['fa'], ['fb'], ['fc'], ['x1', 'x2']]);
    expect(indicators.get('fb')).toEqual(['b1', 'b2', 'b3', 'b4']);
  });

  it('stacks a column in Mplus\'s variable order (ms_fig2.dgm)', () => {
    expect(semColumns(load('ms_fig2.dgm')).columns[0]).toEqual(['eth_1', 'civ_1']);
  });

  it('computes columns from the paths when the levels are missing (syn_sem.dgm)', () => {
    const { columns, indicators } = semColumns(withoutLevels(load('syn_sem.dgm')));
    expect(columns).toEqual([['z1'], ['fa'], ['fb'], ['fc'], ['x1', 'x2']]);
    expect(indicators.get('fa')).toEqual(['a1', 'a2', 'a3']);
  });

  // The fallback for a missing level line (a model loaded from its .out
  // alone, another Mplus version) is meant to place every variable in the
  // column Mplus's line gives. Checked on every fixture, and on the local
  // User's Guide and published-model runs in docs/reference/ when present
  // (40 distinct models across both folders on 2026-11-03, all the same).
  // Columns are compared as laid out, with empty columns closed up, not
  // the line's raw numbers. The indicator lists and the order within a
  // column come from code both paths share, so they are pinned by the
  // literal tests above, not here.
  const REPO = resolve(__dirname, '../../..');
  const REFERENCE_DIR = join(REPO, 'docs/reference');
  const walk = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return walk(p); // symbolic links are neither, so they are skipped
        return e.isFile() && e.name.toLowerCase().endsWith('.dgm') ? [p] : [];
      });
    } catch {
      return []; // an unreadable local folder adds no cases
    }
  };
  // Distinct contents only: the local folder holds reruns and copies.
  const seen = new Set<string>();
  const corpus = [...walk(DGM_DIR), ...(existsSync(REFERENCE_DIR) ? walk(REFERENCE_DIR) : [])].filter((path) => {
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
  for (const path of corpus) {
    const name = relative(REPO, path).split('\\').join('/');
    it(`places every variable in the column Mplus's level line gives, without the line (${name})`, (ctx) => {
      const graph = buildGraph(parseDgm(readFileSync(path, 'utf8')));
      // A file with no complete line has nothing to compare with: reported as skipped, not passed.
      if (graph.nodes.some((n) => n.level === null)) ctx.skip();
      expect(semColumns(withoutLevels(graph)).columns).toEqual(semColumns(graph).columns);
    });
  }

  it('keeps a second-order factor\'s first-order factors structural without levels (BY between latents)', () => {
    const g = withoutLevels(load('syn_sem.dgm'));
    g.edges.push({ ...g.edges[0], id: 'BY:fa->fb', from: 'fa', to: 'fb', kind: 'BY' });
    const { columns, indicators } = semColumns(g);
    expect(columns.flat()).toContain('fb');
    expect(indicators.get('fa')).not.toContain('fb');
  });

  it('keeps Mplus\'s columns when one node has no level (all levels were dropped)', () => {
    const g = load('syn_sem.dgm');
    g.nodes.push({ id: 'extra', label: 'extra', kind: 'observed', level: null, residual: null });
    g.edges.push({ ...g.edges[0], id: 'ON:fc->extra', from: 'fc', to: 'extra', kind: 'ON' });
    const { columns } = semColumns(g);
    expect(columns.slice(0, 4)).toEqual([['z1'], ['fa'], ['fb'], ['fc']]);
    expect(columns.flat()).toContain('extra');
  });

  it('terminates on a feedback loop without levels', () => {
    const g = withoutLevels(load('syn_path.dgm'));
    g.edges.push({ ...g.edges.find((e) => e.kind === 'ON')!, id: 'ON:d1->m1', from: 'd1', to: 'm1' });
    const { columns } = semColumns(g);
    expect(columns.flat().sort()).toEqual(['d1', 'd2', 'k1', 'k2', 'k3', 'm1']);
  });

  it('lists a cross-loading indicator under its first factor only', () => {
    const g = load('syn_sem.dgm');
    g.edges.push({ ...g.edges[0], id: 'BY:fb->a3', from: 'fb', to: 'a3', kind: 'BY' });
    const { indicators } = semColumns(g);
    expect(indicators.get('fa')).toContain('a3');
    expect(indicators.get('fb')).not.toContain('a3');
  });
});
