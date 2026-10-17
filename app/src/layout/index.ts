/**
 * Layout types (`LayoutResult`, `NodeLayout`, `EdgeLayout`) and the layout
 * engine registry. `main.ts` registers the ELK engine (`elk.ts`) and looks
 * it up by name. A layout result is only the initial placement; after
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

export interface EdgeLayout {
  id: string;
  /** Optional bend points between source and target (excludes endpoints). */
  bend?: Point[];
}

export interface LayoutResult {
  nodes: NodeLayout[];
  edges: EdgeLayout[];
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

/**
 * Registry of available layout engines. Only the ELK adapter (`elk-layered`)
 * ships today; further engines register here through `registerLayoutEngine`.
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
