import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph, type ModelGraph } from '../model/graph.js';
import { placeSem, segmentCrossesBox } from './sem.js';
import type { LayoutResult, NodeLayout } from './index.js';

const DGM_DIR = resolve(__dirname, '../../../dgm');
const fixtures = readdirSync(DGM_DIR).filter((f) => f.endsWith('.dgm'));
const load = (name: string): ModelGraph => buildGraph(parseDgm(readFileSync(join(DGM_DIR, name), 'utf8')));
const W = 120;
const H = 56;
const centre = (n: NodeLayout) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

const overlaps = (a: NodeLayout, b: NodeLayout): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Directed paths drawn straight between centres that pass through a box other than their own ends. */
function pathsBehindBoxes(graph: ModelGraph, layout: LayoutResult): string[] {
  const at = new Map(layout.nodes.map((n) => [n.id, n]));
  const hits: string[] = [];
  for (const e of graph.edges) {
    if (e.kind !== 'BY' && e.kind !== 'ON') continue;
    const p = centre(at.get(e.from)!);
    const q = centre(at.get(e.to)!);
    for (const n of layout.nodes) {
      if (n.id !== e.from && n.id !== e.to && segmentCrossesBox(p, q, n)) hits.push(`${e.id} behind ${n.id}`);
    }
  }
  return hits;
}

describe('placeSem - corpus', () => {
  for (const name of fixtures) {
    it(`places every node of ${name} once, with no two boxes overlapping`, () => {
      const graph = load(name);
      const { nodes } = placeSem(graph, W, H);
      expect(nodes.map((n) => n.id).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
      for (const n of nodes) expect([n.x, n.y].every(Number.isFinite), n.id).toBe(true);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          expect(overlaps(nodes[i], nodes[j]), `${nodes[i].id} and ${nodes[j].id}`).toBe(false);
        }
      }
    });

    it(`puts ${name}'s structural variables in Mplus's columns, left to right, in Mplus's order`, () => {
      const graph = load(name);
      const at = new Map(placeSem(graph, W, H).nodes.map((n) => [n.id, centre(n)]));
      const order = graph.source.header.allVariables.map((v) => v.toLowerCase());
      const structural = graph.nodes
        .filter((n) => n.level !== null && n.level >= 0)
        .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      for (const a of structural) {
        for (const b of structural) {
          if (a.level! < b.level!) expect(at.get(a.id)!.x, `${a.id} left of ${b.id}`).toBeLessThan(at.get(b.id)!.x);
        }
      }
      for (let k = 1; k < structural.length; k++) {
        const [a, b] = [structural[k - 1], structural[k]];
        if (a.level === b.level) expect(at.get(a.id)!.y, `${a.id} above ${b.id}`).toBeLessThan(at.get(b.id)!.y);
      }
    });
  }
});

describe('placeSem - indicator sides as Mplus draws them', () => {
  const sideOf = (g: ModelGraph, latent: string, indicator: string): string => {
    const at = new Map(placeSem(g, W, H).nodes.map((n) => [n.id, centre(n)]));
    const [l, i] = [at.get(latent)!, at.get(indicator)!];
    if (Math.abs(i.x - l.x) > Math.abs(i.y - l.y)) return i.x < l.x ? 'left' : 'right';
    return i.y < l.y ? 'top' : 'bottom';
  };
  it('below a middle-column factor (syn_sem fa)', () => expect(sideOf(load('syn_sem.dgm'), 'fa', 'a1')).toBe('bottom'));
  it('right of the factors in a one-column CFA (pcwas_cfa)', () =>
    expect(sideOf(load('pcwas_cfa.dgm'), 'pwas', 'pwas1')).toBe('right'));
  it('left in the first column (ms_fig2 eth_1)', () => expect(sideOf(load('ms_fig2.dgm'), 'eth_1', 'et_anc1')).toBe('left'));
});

describe('placeSem - paths and curves', () => {
  it('draws no path of syn_sem.dgm behind an unrelated box', () => {
    const g = load('syn_sem.dgm');
    expect(pathsBehindBoxes(g, placeSem(g, W, H))).toEqual([]);
  });

  it('keeps every path straight', () => {
    const g = load('syn_sem.dgm');
    for (const e of placeSem(g, W, H).edges) expect(e.bend ?? [], e.id).toEqual([]);
  });

  it('joins a covariance of two dependent variables at their residuals, an exogenous one at the boxes (syn_path)', () => {
    const g = load('syn_path.dgm');
    const edges = new Map(placeSem(g, W, H).edges.map((e) => [e.id, e]));
    const pair = (a: string, b: string) =>
      g.edges.find((e) => (e.kind === 'WITH' || e.kind === 'COVAR') && [e.from, e.to].sort().join() === [a, b].join())!;
    expect(edges.get(pair('d1', 'd2').id)!.curve).toEqual({ side: 'right', attach: 'residual' });
    expect(edges.get(pair('k1', 'k2').id)!.curve).toEqual({ side: 'left', attach: 'node' });
  });

  for (const name of fixtures) {
    it(`joins every covariance of two dependent variables in ${name} at their residuals, whichever way they face`, () => {
      const g = load(name);
      const dependent = new Set(g.edges.filter((e) => e.kind === 'BY' || e.kind === 'ON').map((e) => e.to));
      const withResidual = new Set(g.nodes.filter((n) => n.residual !== null).map((n) => n.id));
      const layout = new Map(placeSem(g, W, H).edges.map((e) => [e.id, e]));
      for (const e of g.edges) {
        if (e.kind !== 'WITH' && e.kind !== 'COVAR') continue;
        const both = [e.from, e.to].every((id) => dependent.has(id) && withResidual.has(id));
        expect(layout.get(e.id)!.curve?.attach, e.id).toBe(both ? 'residual' : 'node');
      }
    });
  }

  it('bends a factor covariance away from a left fan (as in ex5.11, where indicators take the left)', () => {
    const g = load('ms_fig2.dgm');
    const covar = g.edges.find((e) => (e.kind === 'WITH' || e.kind === 'COVAR') && [e.from, e.to].sort().join() === 'civ_1,eth_1');
    expect(covar).toBeDefined();
    const layout = placeSem(g, W, H).edges.find((e) => e.id === covar!.id)!;
    expect(layout.curve?.side).toBe('right');
  });

  it('lays out a model with no levels without overlaps', () => {
    const g = load('syn_sem.dgm');
    const bare = { ...g, nodes: g.nodes.map((n) => ({ ...n, level: null })) };
    const { nodes } = placeSem(bare, W, H);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) expect(overlaps(nodes[i], nodes[j])).toBe(false);
    }
  });
});
