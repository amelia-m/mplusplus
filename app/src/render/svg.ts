/**
 * SVG rendering with d3-selection joins. `setupSvg` creates the layer
 * groups (edges under nodes, marquee on top); `renderGraph` draws edges and
 * nodes from a `RenderState`, using effective styles (`styles.ts`) and
 * significance (`model/significance.ts`), and mints arrowhead markers per
 * colour. A node's shape element is updated in place unless its shape type
 * changes.
 */
import { select, type Selection } from 'd3-selection';
import { isSymmetricKind, type ModelGraph, type GraphEdge, type GraphNode } from '../model/graph.js';
import type { LayoutResult, NodeLayout, Point } from '../layout/index.js';
import {
  effectiveEdgeStyle,
  effectiveNodeStyle,
  activeEstimate,
  strokeDashArray,
  type EdgeStyle,
  type NodeShape,
  type NodeStyle,
  type GlobalStyle,
  type EdgeStyleOverride,
  type NodeStyleOverride,
  type SignificanceInputs,
} from './styles.js';
import { isSignificant, type SignificanceSource } from '../model/significance.js';
import { boundaryPoint } from './geometry.js';
import { overlayGeometry, type CurveGeometry, type OverlayGeometry } from './residual.js';
import type { CaptionPlacement } from '../ui/viewBox.js';

const NODE_W = 120;
const NODE_H = 56;
const ARROW_GAP = 4;

export interface RenderState {
  graph: ModelGraph;
  layout: LayoutResult;
  global: GlobalStyle;
  edgeStyles: Record<string, EdgeStyleOverride>;
  nodeStyles: Record<string, NodeStyleOverride>;
  /** P-values keyed by edge id, separate per coefficient mode. */
  pValues: Record<string, { unstd: number | null; stdyx: number | null }>;
  /** Currently selected node ids (for selection visuals). */
  nodeSelection: Set<string>;
  /** Currently selected edge ids. */
  edgeSelection: Set<string>;
}

export type SvgSelection = Selection<SVGSVGElement, unknown, null, undefined>;
export type GroupSelection = Selection<SVGGElement, unknown, null, undefined>;

/**
 * Initialize the SVG container with arrowhead markers and the standard
 * group ordering (edges underneath nodes). Returns selection handles for
 * later d3 joins.
 */
export function setupSvg(svg: SVGSVGElement): {
  edgesG: GroupSelection;
  nodesG: GroupSelection;
  captionG: GroupSelection;
  marqueeG: GroupSelection;
  defsG: Selection<SVGDefsElement, unknown, null, undefined>;
} {
  const root = select(svg);
  root.selectAll('*').remove();

  const defs = root.append('defs');

  // Order matters: edges below nodes; marquee on top of everything.
  const edgesG = root.append('g').attr('class', 'edges') as GroupSelection;
  const nodesG = root.append('g').attr('class', 'nodes') as GroupSelection;
  const captionG = root.append('g').attr('class', 'caption') as GroupSelection;
  const marqueeG = root.append('g').attr('class', 'marquee') as GroupSelection;

  return { edgesG, nodesG, captionG, marqueeG, defsG: defs };
}

/**
 * Draw the diagram's caption lines and return the widest one's length, 0
 * with none. Styled with attributes, not page CSS, so it stays part of the
 * SVG itself.
 */
export function renderCaption(
  captionG: GroupSelection,
  lines: string[],
  place: Pick<CaptionPlacement, 'at' | 'fontSize' | 'lineHeight'>,
): number {
  const text = captionG
    .selectAll<SVGTextElement, string>('text')
    .data(lines)
    .join('text')
    .attr('x', place.at.x)
    .attr('y', (_, i) => place.at.y + i * place.lineHeight)
    .attr('font-family', 'sans-serif')
    .attr('font-size', place.fontSize)
    .attr('fill', '#444')
    .attr('pointer-events', 'none')
    .text((d) => d);
  return Math.max(0, ...text.nodes().map((n) => n.getComputedTextLength()));
}

/**
 * Per-color arrowhead markers are minted on demand into `defs`. `id` is
 * stable per (kind, color) so the same marker is reused across re-renders.
 */
function arrowMarkerId(kind: 'default' | 'open', color: string, atStart: boolean): string {
  const slug = color.replace(/[^a-zA-Z0-9]/g, '');
  return `mk-${kind}-${slug}${atStart ? '-start' : ''}`;
}

/**
 * The marker for an arrowhead of `kind` and `color`. `atStart` gives the
 * one for a path's start, pointing backwards, for two-headed covariances.
 */
function ensureArrowMarker(
  defs: Selection<SVGDefsElement, unknown, null, undefined>,
  kind: 'default' | 'open',
  color: string,
  atStart = false,
): string {
  const id = arrowMarkerId(kind, color, atStart);
  if (!defs.select(`#${id}`).empty()) return id;
  const m = defs
    .append('marker')
    .attr('id', id)
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 9)
    .attr('refY', 0)
    .attr('markerWidth', 9)
    .attr('markerHeight', 9)
    .attr('orient', atStart ? 'auto-start-reverse' : 'auto')
    .attr('markerUnits', 'userSpaceOnUse');
  if (kind === 'default') {
    m.append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', color);
  } else {
    m.append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.2);
  }
  return id;
}

export function renderGraph(
  edgesG: GroupSelection,
  nodesG: GroupSelection,
  defsG: Selection<SVGDefsElement, unknown, null, undefined>,
  state: RenderState,
): OverlayGeometry {
  const nodeIndex = new Map<string, NodeLayout>();
  for (const n of state.layout.nodes) nodeIndex.set(n.id, n);

  const shapeOf = nodeShapeLookup(state.graph, state.nodeStyles);
  const overlay = overlayGeometry(state.layout, state.graph.edges, shapeOf, ARROW_GAP);
  renderEdges(edgesG, defsG, state, nodeIndex, shapeOf, overlay);
  renderResiduals(edgesG, defsG, state, overlay);
  renderNodes(nodesG, state);
  // Returned so the view fit uses the same geometry without recomputing it.
  return overlay;
}

/** Each node's outline, its style override applied; `rect` for an unknown id. */
export function nodeShapeLookup(
  graph: ModelGraph,
  nodeStyles: Record<string, NodeStyleOverride>,
): (id: string) => NodeShape {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  return (id) => {
    const n = nodes.get(id);
    return n ? nodeShape(n, effectiveNodeStyle(n, nodeStyles[id])) : 'rect';
  };
}

/**
 * Residual arrows with their values, in their own group inside the edge
 * layer. Values follow the coefficient mode, falling back to the other
 * estimate, and hide with the coefficients.
 */
function renderResiduals(
  edgesG: GroupSelection,
  defsG: Selection<SVGDefsElement, unknown, null, undefined>,
  state: RenderState,
  overlay: OverlayGeometry,
): void {
  const layer = edgesG.selectAll<SVGGElement, null>('g.residuals').data([null]).join('g').attr('class', 'residuals');
  const color = '#111111';
  const marker = `url(#${ensureArrowMarker(defsG, 'default', color)})`;
  const nodes = new Map(state.graph.nodes.map((n) => [n.id, n]));
  const data = Array.from(overlay.residuals, ([id, geom]) => ({ id, geom }));
  const g = layer
    .selectAll<SVGGElement, (typeof data)[number]>('g.residual')
    .data(data, (d) => d.id)
    .join((enter) => {
      const e = enter.append('g').attr('class', 'residual');
      e.append('path').attr('fill', 'none');
      e.append('text').attr('class', 'residual-label');
      return e;
    });
  g.select('path')
    .attr('d', (d) => `M ${d.geom.tail.x} ${d.geom.tail.y} L ${d.geom.tip.x} ${d.geom.tip.y}`)
    .attr('stroke', color)
    .attr('stroke-width', 1)
    .attr('marker-end', marker);
  g.select<SVGTextElement>('text')
    .attr('x', (d) => d.geom.labelAnchor.x)
    .attr('y', (d) => d.geom.labelAnchor.y + 4)
    .attr('text-anchor', (d) => d.geom.textAnchor)
    .attr('font-family', 'system-ui, sans-serif')
    .attr('font-size', 12)
    .attr('fill', color)
    .attr('display', state.global.showCoefficients ? null : 'none')
    .text((d) => {
      const r = nodes.get(d.id)?.residual;
      const est = state.global.coefMode === 'stdyx' ? (r?.stdyx ?? r?.unstd) : (r?.unstd ?? r?.stdyx);
      return est ? est.value.toFixed(state.global.decimals) : '';
    });
}

function renderNodes(nodesG: GroupSelection, state: RenderState): void {
  const join = nodesG
    .selectAll<SVGGElement, GraphNode>('g.node')
    .data(state.graph.nodes, (d) => d.id);

  join.exit().remove();

  const enter = join
    .enter()
    .append('g')
    .attr('class', (d) => `node node-${d.kind}`)
    .attr('data-id', (d) => d.id);

  // Shape group holding the node's single outline element. `drawNodeShape`
  // updates that element in place and replaces it only when the outline
  // needs a different element type.
  enter.append('g').attr('class', 'node-shape');
  enter.append('text').attr('class', 'node-label');

  const merged = enter.merge(join);

  const positions = new Map(state.layout.nodes.map((n) => [n.id, n]));
  merged.attr('transform', (d) => {
    const layout = positions.get(d.id);
    return layout ? `translate(${layout.x}, ${layout.y})` : null;
  });

  merged.each(function (d) {
    const g = select(this);
    const style = effectiveNodeStyle(d, state.nodeStyles[d.id]);
    drawNodeShape(g.select<SVGGElement>('g.node-shape'), d, style);

    const lbl = g.select<SVGTextElement>('text.node-label');
    lbl
      .attr('x', NODE_W / 2)
      .attr('y', NODE_H / 2 + Math.round(style.labelFontSize / 3))
      .attr('text-anchor', 'middle')
      .attr('font-family', style.labelFontFamily)
      .attr('font-size', style.labelFontSize)
      .attr('fill', style.labelFontColor)
      .text(d.label);

    g.classed('selected', state.nodeSelection.has(d.id));
  });
}

/** The SVG element and geometry attributes that draw a node outline. */
export interface NodeShapeSpec {
  tag: 'ellipse' | 'rect' | 'polygon';
  /** Every geometry attribute the element type uses; null removes it. */
  attrs: Record<string, string | number | null>;
}

/**
 * Element and geometry for a node outline of the given size. Outlines that
 * share an element type (`rect`, `rounded-rect`) list the same attribute
 * keys, so switching between them in place leaves nothing stale.
 */
export function nodeShapeSpec(shape: NodeShape, width: number, height: number): NodeShapeSpec {
  switch (shape) {
    case 'ellipse':
      return { tag: 'ellipse', attrs: { cx: width / 2, cy: height / 2, rx: width / 2, ry: height / 2 } };
    case 'rect':
      return { tag: 'rect', attrs: { width, height, rx: null, ry: null } };
    case 'rounded-rect':
      return { tag: 'rect', attrs: { width, height, rx: 12, ry: 12 } };
    case 'diamond':
      return {
        tag: 'polygon',
        attrs: { points: `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}` },
      };
  }
}

/**
 * Draw a node's outline into its shape group. The existing element is kept
 * and updated in place unless the outline needs a different element type,
 * so a press never removes the element under the pointer.
 */
function drawNodeShape(
  shapeG: Selection<SVGGElement, unknown, null, undefined>,
  node: GraphNode,
  style: NodeStyle,
): void {
  const spec = nodeShapeSpec(nodeShape(node, style), NODE_W, NODE_H);
  let el = shapeG.select<SVGElement>(':scope > *');
  if (el.empty() || el.node()!.tagName.toLowerCase() !== spec.tag) {
    shapeG.selectAll('*').remove();
    el = shapeG.append<SVGElement>(spec.tag);
  }
  for (const [name, value] of Object.entries(spec.attrs)) el.attr(name, value);
  el
    .attr('fill', style.fill)
    .attr('stroke', style.stroke)
    .attr('stroke-width', style.strokeWidth)
    .attr('stroke-dasharray', strokeDashArray(style.strokeStyle, style.strokeWidth));
}

/** The outline a node is drawn with: its override, else the kind default. */
function nodeShape(node: GraphNode, style: NodeStyle): NodeShape {
  return style.shape ?? (node.kind === 'latent' ? 'ellipse' : 'rect');
}

interface EdgeGeom {
  edge: GraphEdge;
  source: NodeLayout;
  target: NodeLayout;
  sourceShape: NodeShape;
  targetShape: NodeShape;
  bend: Point[];
  /** Set when the layout draws this edge as a covariance curve. */
  curve: CurveGeometry | null;
}

function renderEdges(
  edgesG: GroupSelection,
  defsG: Selection<SVGDefsElement, unknown, null, undefined>,
  state: RenderState,
  index: Map<string, NodeLayout>,
  shapeOf: (id: string) => NodeShape,
  overlay: OverlayGeometry,
): void {
  const layoutEdges = new Map(state.layout.edges.map((e) => [e.id, e]));
  const geoms: EdgeGeom[] = [];
  for (const edge of state.graph.edges) {
    const source = index.get(edge.from);
    const target = index.get(edge.to);
    if (!source || !target) continue;
    const lay = layoutEdges.get(edge.id);
    geoms.push({
      edge,
      source,
      target,
      sourceShape: shapeOf(edge.from),
      targetShape: shapeOf(edge.to),
      bend: lay?.bend ?? [],
      curve: overlay.curves.get(edge.id) ?? null,
    });
  }

  const join = edgesG
    .selectAll<SVGGElement, EdgeGeom>('g.edge')
    .data(geoms, (d) => d.edge.id);

  join.exit().remove();

  const enter = join
    .enter()
    .append('g')
    .attr('class', (d) => `edge edge-${d.edge.kind.toLowerCase()}`)
    .attr('data-id', (d) => d.edge.id);

  // Hit area first so it sits beneath the visible stroke.
  enter.append('path').attr('class', 'edge-hit').attr('fill', 'none').attr('stroke', 'transparent').attr('stroke-width', 14);
  enter.append('path').attr('class', 'edge-path').attr('fill', 'none');
  enter.append('text').attr('class', 'edge-label');
  enter.append('text').attr('class', 'edge-constraint');

  const merged = enter.merge(join);

  merged.each(function (d) {
    const sel = select(this);
    const path = sel.select<SVGPathElement>('path.edge-path');
    const hit = sel.select<SVGPathElement>('path.edge-hit');
    const label = sel.select<SVGTextElement>('text.edge-label');
    const constraint = sel.select<SVGTextElement>('text.edge-constraint');

    const { d: pathD, mid } = d.curve ?? computePath(d);
    const sigInputs = computeSignificanceInputs(d.edge, state);
    const style = effectiveEdgeStyle(state.global, sigInputs, state.edgeStyles[d.edge.id]);
    // Covariances are two-headed and drawn in their own style, solid by
    // default (docs/diagram-conventions.md D3).
    const twoHeaded = isSymmetricKind(d.edge.kind);

    let marker: string | null = null;
    let startMarker: string | null = null;
    if (style.arrowhead !== 'none') {
      const kind = style.arrowhead === 'open' ? 'open' : 'default';
      marker = `url(#${ensureArrowMarker(defsG, kind, style.stroke)})`;
      if (twoHeaded) startMarker = `url(#${ensureArrowMarker(defsG, kind, style.stroke, true)})`;
    }

    path
      .attr('d', pathD)
      .attr('stroke', style.stroke)
      .attr('stroke-width', style.strokeWidth)
      .attr('stroke-dasharray', strokeDashArray(style.strokeStyle, style.strokeWidth))
      .attr('marker-start', startMarker)
      .attr('marker-end', marker);
    hit.attr('d', pathD);

    const labelText = formatLabel(d.edge, state.global, style);
    const showLabel = state.global.showCoefficients && style.labelVisible && labelText.length > 0;
    label
      .attr('x', mid.x)
      .attr('y', mid.y - 6)
      .attr('text-anchor', 'middle')
      .attr('font-family', style.labelFontFamily)
      .attr('font-size', style.labelFontSize)
      .attr('fill', style.labelFontColor)
      .attr('display', showLabel ? null : 'none')
      .text(labelText);

    constraint
      .attr('x', mid.x)
      .attr('y', mid.y + 10)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'system-ui, sans-serif')
      .attr('font-size', 10)
      .attr('font-style', 'italic')
      .attr('fill', '#6b7280')
      .text(d.edge.constraint ? `(${d.edge.constraint})` : '');

    sel.classed('selected', state.edgeSelection.has(d.edge.id));
  });
}

export function computeSignificanceInputs(
  edge: GraphEdge,
  state: Pick<RenderState, 'global' | 'pValues'>,
): SignificanceInputs {
  const est = activeEstimate(edge, state.global.coefMode);
  const pEntry = state.pValues[edge.id];
  const pValue =
    pEntry != null ? (state.global.coefMode === 'stdyx' ? pEntry.stdyx : pEntry.unstd) : null;

  const source = mapSource(state.global.pSource);
  const sig = isSignificant(edge, state.global.alpha, source, { pValue });

  let sign: 1 | -1 | 0 | null = null;
  if (est) sign = est.value > 0 ? 1 : est.value < 0 ? -1 : 0;
  else if (edge.fixed != null) sign = edge.fixed > 0 ? 1 : edge.fixed < 0 ? -1 : 0;

  const magnitude = est ? Math.abs(est.value) : edge.fixed != null ? Math.abs(edge.fixed) : null;

  return { significant: sig, sign, magnitude };
}

function mapSource(g: GlobalStyle['pSource']): SignificanceSource {
  if (g === 'pvalue') return 'pvalue';
  if (g === 'tstat') return 'tstat';
  return 'auto';
}

function formatLabel(edge: GraphEdge, g: GlobalStyle, style: EdgeStyle): string {
  const decimals = style.decimals ?? g.decimals;
  const est = activeEstimate(edge, g.coefMode);
  if (!est) {
    if (edge.fixed != null) return edge.fixed.toFixed(decimals);
    return '';
  }
  return est.value.toFixed(decimals);
}

function computePath(g: EdgeGeom): { d: string; mid: Point } {
  const sCenter: Point = { x: g.source.x + g.source.width / 2, y: g.source.y + g.source.height / 2 };
  const tCenter: Point = { x: g.target.x + g.target.width / 2, y: g.target.y + g.target.height / 2 };
  const startAnchor = g.bend[0] ?? tCenter;
  const endAnchor = g.bend[g.bend.length - 1] ?? sCenter;

  // A two-headed covariance needs the same gap at its start as at its end.
  const startGap = isSymmetricKind(g.edge.kind) ? ARROW_GAP : 0;
  const start = boundaryPoint(g.source, g.sourceShape, startAnchor, startGap);
  const end = boundaryPoint(g.target, g.targetShape, endAnchor, ARROW_GAP);

  const c1Source = g.bend[0] ?? end;
  const c2Source = g.bend[g.bend.length - 1] ?? start;
  const dx1 = c1Source.x - start.x;
  const dy1 = c1Source.y - start.y;
  const dx2 = c2Source.x - end.x;
  const dy2 = c2Source.y - end.y;
  const c1: Point = { x: start.x + dx1 / 2, y: start.y + dy1 / 2 };
  const c2: Point = { x: end.x + dx2 / 2, y: end.y + dy2 / 2 };

  const segs = [`M ${start.x} ${start.y}`];
  if (g.bend.length === 0) {
    segs.push(`C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`);
  } else {
    segs.push(`C ${c1.x} ${c1.y}, ${g.bend[0].x} ${g.bend[0].y}, ${g.bend[0].x} ${g.bend[0].y}`);
    for (let i = 1; i < g.bend.length; i++) {
      const p = g.bend[i];
      segs.push(`L ${p.x} ${p.y}`);
    }
    segs.push(`L ${end.x} ${end.y}`);
  }

  const mid: Point =
    g.bend.length > 0
      ? g.bend[Math.floor(g.bend.length / 2)]
      : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

  return { d: segs.join(' '), mid };
}

export const NODE_DIMENSIONS = { width: NODE_W, height: NODE_H };
