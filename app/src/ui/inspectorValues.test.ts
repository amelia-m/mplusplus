import { describe, expect, it } from 'vitest';
import { edgeInspectorStyle, nodeInspectorStyle, type InspectorSource } from './inspectorValues.js';
import {
  DEFAULT_GLOBAL_STYLE,
  DEFAULT_NODE_STYLE_LATENT,
  DEFAULT_NODE_STYLE_OBSERVED,
} from '../render/styles.js';
import type { GraphEdge, ModelGraph } from '../model/graph.js';

const edge = (over: Partial<GraphEdge>): GraphEdge => ({
  id: 'ON:x->y',
  from: 'x',
  to: 'y',
  kind: 'ON',
  free: true,
  fixed: null,
  constraint: null,
  unstd: { value: -0.5, se: 0.1 },
  stdyx: null,
  ...over,
} as GraphEdge);

const graph = {
  nodes: [
    { id: 'f', label: 'F', kind: 'latent' },
    { id: 'x', label: 'X', kind: 'observed' },
  ],
  edges: [
    edge({}),
    edge({ id: 'ON:f->y', from: 'f', unstd: { value: 0.1, se: 1 } }),
  ],
} as unknown as ModelGraph;

const source = (over: Partial<InspectorSource> = {}): InspectorSource => ({
  graph,
  selection: new Set(),
  edgeSelection: new Set(),
  nodeStyles: {},
  edgeStyles: {},
  global: { ...DEFAULT_GLOBAL_STYLE },
  pValues: {},
  ...over,
});

describe('inspector shows the effective style (Z5)', () => {
  it('node defaults depend on the node kind, not one hard-coded constant', () => {
    expect(nodeInspectorStyle(source({ selection: new Set(['f']) }))?.fill).toBe(
      DEFAULT_NODE_STYLE_LATENT.fill,
    );
    expect(nodeInspectorStyle(source({ selection: new Set(['x']) }))?.stroke).toBe(
      DEFAULT_NODE_STYLE_OBSERVED.stroke,
    );
  });

  it('node overrides are merged over the default', () => {
    const s = nodeInspectorStyle(
      source({ selection: new Set(['f']), nodeStyles: { f: { strokeWidth: 4 } } }),
    );
    expect(s?.strokeWidth).toBe(4);
    expect(s?.fill).toBe(DEFAULT_NODE_STYLE_LATENT.fill);
  });

  it('a significant negative edge shows the negative colour and the global base width', () => {
    const g = { ...DEFAULT_GLOBAL_STYLE, baseEdgeWidth: 2.5 };
    const s = edgeInspectorStyle(source({ edgeSelection: new Set(['ON:x->y']), global: g }));
    expect(s?.stroke).toBe(g.negativeColor);
    expect(s?.strokeWidth).toBe(2.5);
  });

  it('a non-significant edge shows the NS colour, width and dashing', () => {
    const s = edgeInspectorStyle(source({ edgeSelection: new Set(['ON:f->y']) }));
    expect(s?.stroke).toBe(DEFAULT_GLOBAL_STYLE.nsColor);
    expect(s?.strokeWidth).toBe(DEFAULT_GLOBAL_STYLE.nsStrokeWidth);
    expect(s?.strokeStyle).toBe('dashed');
  });

  it('edge overrides win over the derived default', () => {
    const s = edgeInspectorStyle(
      source({ edgeSelection: new Set(['ON:x->y']), edgeStyles: { 'ON:x->y': { stroke: '#123456' } } }),
    );
    expect(s?.stroke).toBe('#123456');
  });

  it('returns null with nothing selected or an unknown id', () => {
    expect(nodeInspectorStyle(source())).toBeNull();
    expect(edgeInspectorStyle(source({ edgeSelection: new Set(['ON:q->r']) }))).toBeNull();
  });
});
