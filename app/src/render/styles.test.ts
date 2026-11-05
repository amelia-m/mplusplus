import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { displayNamePairs, displayNamePatch, effectiveNodeStyle, nodeLabelText } from './styles.js';
import { buildGraph, type GraphNode } from '../model/graph.js';
import { parseDgm } from '../parser/dgm.js';

const graph = buildGraph(parseDgm(readFileSync(resolve(__dirname, '../../../dgm/syn_sem.dgm'), 'utf8')));
const fa = graph.nodes.find((n) => n.id === 'fa')!;
const node = (id: string, label: string): Pick<GraphNode, 'id' | 'label'> => ({ id, label });

describe('display names (Amelia, 2026-11-02 and 2026-11-03)', () => {
  it('draws the display name in place of the Mplus name, and leaves the node id alone', () => {
    const override = displayNamePatch(fa, 'Anxiety');
    expect(nodeLabelText(fa, effectiveNodeStyle(fa, override))).toBe('Anxiety');
    expect(fa.id).toBe('fa');
    // Without a display name the Mplus name is drawn.
    expect(nodeLabelText(fa, effectiveNodeStyle(fa, undefined))).toBe(fa.label);
  });

  it('stores nothing for an empty, whitespace-only or Mplus-equal name, and trims the rest', () => {
    const f = node('f1', 'F1');
    expect(displayNamePatch(f, '')).toEqual({ displayName: undefined });
    expect(displayNamePatch(f, '   ')).toEqual({ displayName: undefined });
    expect(displayNamePatch(f, ' F1 ')).toEqual({ displayName: undefined });
    expect(displayNamePatch(f, '  Self-efficacy ')).toEqual({ displayName: 'Self-efficacy' });
  });

  it('keeps a change of case as a display name, since case is just an alias', () => {
    expect(displayNamePatch(node('f1', 'F1'), 'f1')).toEqual({ displayName: 'f1' });
  });

  it('pairs only the renamed variables with their Mplus names, in graph order', () => {
    const nodes = [node('a', 'A'), node('b', 'B'), node('c', 'C')];
    const styles = { c: { displayName: 'Gamma' }, b: { fill: '#fff' }, a: { displayName: 'Alpha' } };
    expect(displayNamePairs(nodes, styles)).toEqual([
      { displayName: 'Alpha', mplusName: 'A' },
      { displayName: 'Gamma', mplusName: 'C' },
    ]);
  });
});
