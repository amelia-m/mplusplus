/**
 * Layout types (`LayoutResult`, `NodeLayout`, `EdgeLayout`) and the layout
 * engine registry. `main.ts` registers the engines and looks the chosen
 * one up by name. A layout result is only the initial placement; after
 * loading, the store's `positions` are authoritative.
 */
import type { ModelGraph } from '../model/graph.js';

export interface Point {
  x: number;
  y: number;
}

export interface NodeLayout extends Point {
  id: string;
  width: number;
  height: number;
}

/** A side of a node, or the side a curve bulges towards. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * A node's residual, drawn on `side`. Only the side is stored: the
 * renderer works out the geometry from the node's current position, so the
 * residual follows a dragged node.
 */
export interface ResidualLayout {
  id: string;
  side: Side;
}

export interface EdgeLayout {
  id: string;
  /** Optional bend points between source and target (excludes endpoints). */
  bend?: Point[];
  /**
   * Draw a symmetric edge as a curve bulging towards `side`, between the
   * nodes or between their residuals (docs/diagram-conventions.md D5, D8).
   * Like residuals, it holds no coordinates.
   */
  curve?: { side: Side; attach: 'node' | 'residual' };
}

export interface LayoutResult {
  nodes: NodeLayout[];
  edges: EdgeLayout[];
  /** Residuals to draw; an engine that places none leaves this out. */
  residuals?: ResidualLayout[];
  /** Bounding box of the laid-out graph. */
  width: number;
  height: number;
}

export interface LayoutOpts {
  width: number;
  height: number;
  /** Default node dimensions for engines that need them. */
  nodeWidth?: number;
  nodeHeight?: number;
}

export interface LayoutEngine {
  name: string;
  layout(graph: ModelGraph, opts: LayoutOpts): Promise<LayoutResult>;
}

/** Engine a loaded model is laid out with (docs/diagram-conventions.md D9). */
export const DEFAULT_LAYOUT_ENGINE = 'sem';

/**
 * Registry of available layout engines: `sem` (`sem.ts`) and the ELK
 * adapter (`elk-layered`, `elk.ts`), both registered by `main.ts`.
 */
const registry = new Map<string, LayoutEngine>();

export function registerLayoutEngine(engine: LayoutEngine): void {
  registry.set(engine.name, engine);
}

export function getLayoutEngine(name: string): LayoutEngine | undefined {
  return registry.get(name);
}

export function listLayoutEngines(): LayoutEngine[] {
  return Array.from(registry.values());
}
