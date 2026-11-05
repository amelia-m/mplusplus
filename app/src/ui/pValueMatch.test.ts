import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { countMatchedPValues, countPValueEdges, mplusTitle, outAttachNote, titlesDiffer } from './pValueMatch.js';
import { parseDgm } from '../parser/dgm.js';
import { buildGraph } from '../model/graph.js';
import { buildPValueMap, parseOut } from '../parser/out.js';

const p = { unstd: 0.01, stdyx: 0.02 };
const graph = { edges: [{ id: 'ON:x->y' }, { id: 'BY:f->y1' }, { id: 'WITH:a->b' }] };

describe('countMatchedPValues (Z7)', () => {
  it('counts only keys that are edge ids in the current graph', () => {
    const pValues = {
      'ON:x->y': p,
      'BY:f->y1': p,
      'ON:q->r': p, // not in the graph
      'WITH:a->b': p,
      'WITH:b->a': p, // reverse key for the same symmetric edge
    };
    expect(countMatchedPValues(pValues, graph)).toBe(3);
  });

  it('returns 0 when nothing matches', () => {
    expect(countMatchedPValues({ 'ON:q->r': p }, graph)).toBe(0);
    expect(countMatchedPValues({}, graph)).toBe(0);
  });

  it('does not count a key whose unstd and stdyx are both null (F5)', () => {
    const none = { unstd: null, stdyx: null };
    expect(countMatchedPValues({ 'ON:x->y': none, 'BY:f->y1': none }, graph)).toBe(0);
    expect(countMatchedPValues({ 'ON:x->y': none, 'BY:f->y1': { unstd: null, stdyx: 0.3 } }, graph)).toBe(1);
    expect(countMatchedPValues({ 'WITH:a->b': { unstd: 0.2, stdyx: null } }, graph)).toBe(1);
  });
});

const FIXTURES = resolve(__dirname, '../../test/fixtures');
const DGM_DIR = resolve(__dirname, '../../../dgm');
const read = (path: string) => readFileSync(path, 'utf8');

describe('countPValueEdges', () => {
  // The fixture pairs come from one Mplus run each, so every edge that can
  // carry a p-value has one: m must equal n, or the note would warn wrongly.
  // syn_sem has two loadings Mplus fixed at 1 (fb -> b1, fc -> c1): they
  // carry a STDYX p-value only, and still count.
  it.each([
    ['syn_sem.dgm', 'sample.out'],
    ['syn_twofactor.dgm', 'syn_twofactor.out'],
  ])('equals the matched count for %s with its own .out (%s)', (dgm, out) => {
    const g = buildGraph(parseDgm(read(resolve(DGM_DIR, dgm))));
    const pValues = buildPValueMap(parseOut(read(resolve(FIXTURES, out))));
    const m = countPValueEdges(g);
    expect(m).toBeGreaterThan(0);
    expect(countMatchedPValues(pValues, g)).toBe(m);
  });
});

describe('mplusTitle', () => {
  it('joins a multi-line TITLE of a .dgm up to the next command', () => {
    const dgm = 'VERSION 1.1.0\nINPUT\nTITLE:\n first line\n   second  line ! a comment\nDATA:\n FILE IS x.dat;\nINPUT_END\n';
    expect(mplusTitle(dgm, 'dgm')).toBe('first line second line');
  });

  it('reads a shortened TITL header and text on the header line', () => {
    expect(mplusTitle('titl: Pilot model\nVARIABLE: NAMES = y;\nINPUT_END\n', 'dgm')).toBe('Pilot model');
  });

  it('reads the TITLE of a .out from its input echo only', () => {
    const out = [
      'Mplus VERSION 8.11',
      'INPUT INSTRUCTIONS',
      '  TITLE: echo title',
      '    continued',
      '  DATA: FILE IS x.dat;',
      'INPUT READING TERMINATED NORMALLY',
      'TITLE: not the echo',
    ].join('\n');
    expect(mplusTitle(out, 'out')).toBe('echo title continued');
  });

  it('is null with no TITLE, an empty TITLE, or a .out without an echo (NOECHO)', () => {
    expect(mplusTitle('DATA: FILE IS x.dat;\nINPUT_END\n', 'dgm')).toBeNull();
    expect(mplusTitle('TITLE:\nDATA: FILE IS x.dat;\nINPUT_END\n', 'dgm')).toBeNull();
    expect(mplusTitle('Mplus VERSION 8.11\nMODEL RESULTS\n', 'out')).toBeNull();
  });

  it('gives the same title for syn_sem.dgm and its .out', () => {
    const fromDgm = mplusTitle(read(resolve(DGM_DIR, 'syn_sem.dgm')), 'dgm');
    const fromOut = mplusTitle(read(resolve(FIXTURES, 'sample.out')), 'out');
    expect(fromDgm).toBe('mplusplus synthetic fixture: SEM with constraints (invented model and names; simulated data only)');
    expect(titlesDiffer(fromDgm, fromOut)).toBe(false);
  });
});

describe('titlesDiffer', () => {
  it('ignores case, surrounding space and runs of whitespace', () => {
    expect(titlesDiffer('  Pilot  Model ', 'pilot model')).toBe(false);
  });

  it('is true for different titles', () => {
    expect(titlesDiffer('Pilot model', 'Main model')).toBe(true);
  });

  it('is never true when either title is missing', () => {
    expect(titlesDiffer(null, 'Main model')).toBe(false);
    expect(titlesDiffer('Pilot model', null)).toBe(false);
    expect(titlesDiffer(null, null)).toBe(false);
  });
});

describe('outAttachNote', () => {
  const base = { outName: 'run.out', diagramName: 'run.dgm', outTitle: 'Model A', diagramTitle: 'model a' };

  it('notes, without a warning, when every edge matched and the titles agree', () => {
    expect(outAttachNote({ ...base, matched: 19, attachable: 19 })).toEqual({
      text: 'Attached p-values from run.out to run.dgm (19 of 19 edges). Undo removes them.',
      warning: false,
    });
  });

  it('warns when only some edges matched', () => {
    expect(outAttachNote({ ...base, matched: 6, attachable: 19 })).toEqual({
      text: 'Attached p-values from run.out to run.dgm, but only 6 of 19 edges matched; this .out may be from another model. Undo removes them.',
      warning: true,
    });
  });

  it('warns when the TITLEs differ, even with every edge matched', () => {
    expect(outAttachNote({ ...base, diagramTitle: 'Model B', matched: 19, attachable: 19 })).toEqual({
      text: "Attached p-values from run.out to run.dgm (19 of 19 edges), but its TITLE differs from run.dgm's; this .out may be from another model. Undo removes them.",
      warning: true,
    });
  });

  it('names both reasons when some edges matched and the TITLEs differ', () => {
    const note = outAttachNote({ ...base, diagramTitle: 'Model B', matched: 6, attachable: 19 });
    expect(note.warning).toBe(true);
    expect(note.text).toContain("only 6 of 19 edges matched and its TITLE differs from run.dgm's");
  });

  it('names both files when the open diagram is itself a .out', () => {
    const note = outAttachNote({ ...base, outName: 'second.out', diagramName: 'first.out', matched: 4, attachable: 4 });
    expect(note.text).toBe('Attached p-values from second.out to first.out (4 of 4 edges). Undo removes them.');
  });

  it('does not warn about titles when either file has none', () => {
    expect(outAttachNote({ ...base, diagramTitle: null, matched: 3, attachable: 3 }).warning).toBe(false);
  });

  it('says the p-values were already attached, without offering Undo, when nothing changed', () => {
    expect(outAttachNote({ ...base, matched: 19, attachable: 19, changed: false })).toEqual({
      text: 'The p-values from run.out were already attached to run.dgm (19 of 19 edges). Nothing changed.',
      warning: false,
    });
  });

  it('never prints more matched edges than attachable ones', () => {
    expect(outAttachNote({ ...base, matched: 5, attachable: 4 }).text).toContain('(5 of 5 edges)');
  });
});
