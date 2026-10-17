import ELK from 'elkjs/lib/elk.bundled.js';
import type { ModelGraph } from '../model/graph.js';
import type {
  EdgeLayout,
  LayoutEngine,
  LayoutOpts,
  LayoutResult,
  NodeLayout,
  Point,
} from './index.js';

/**
 * ELK-backed layered layout. Algorithm `layered` with direction `RIGHT`
 * tends to produce zero edge crossings on the SEM models in the corpus.
 */
export const elkEngine: LayoutEngine = {
  name: 'elk-layered',
  async layout(graph: ModelGraph, opts: LayoutOpts): Promise<LayoutResult> {
    const elk = new ELK();
    const nodeWidth = opts.nodeWidth ?? 120;
    const nodeHeight = opts.nodeHeight ?? 56;

    const root = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.spacing.nodeNode': '40',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      },
      children: graph.nodes.map((n) => ({
        id: n.id,
        width: nodeWidth,
        height: nodeHeight,
      })),
      edges: graph.edges.map((e) => ({
        id: e.id,
        sources: [e.from],
        targets: [e.to],
      })),
    };

    const result = await elk.layout(root);
    const nodes: NodeLayout[] = (result.children ?? []).map((c) => ({
      id: c.id,
      x: c.x ?? 0,
      y: c.y ?? 0,
      width: c.width ?? nodeWidth,
      height: c.height ?? nodeHeight,
    }));

    const edges: EdgeLayout[] = (result.edges ?? []).map((e) => {
      // ELK's edge sections give us start/end + intermediate bend points.
      // We only retain the bends - the endpoints are recomputed at the
      // node boundary by the renderer.
      const section = e.sections?.[0];
      const bend: Point[] = section?.bendPoints?.map((p) => ({ x: p.x, y: p.y })) ?? [];
      return { id: e.id ?? '', bend };
    });

    return {
      nodes,
      edges,
      width: result.width ?? opts.width,
      height: result.height ?? opts.height,
    };
  },
};
