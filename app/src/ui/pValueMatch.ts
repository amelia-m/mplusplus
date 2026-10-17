import type { PValueEntry } from '../state/store.js';

/**
 * Number of edges in the current graph that a `.out` file gives a usable
 * p-value for: the key names an edge and at least one of `unstd` / `stdyx`
 * is present. The `.out` map can hold keys for parameters the diagram does
 * not draw (and both orders of a symmetric pair), and entries with neither
 * p-value attach nothing, so its size overstates what was attached.
 */
export function countMatchedPValues(
  pValues: Readonly<Record<string, PValueEntry | undefined>>,
  graph: { edges: ReadonlyArray<{ id: string }> },
): number {
  let n = 0;
  for (const e of graph.edges) {
    if (!Object.prototype.hasOwnProperty.call(pValues, e.id)) continue;
    const entry = pValues[e.id];
    if (entry && (entry.unstd != null || entry.stdyx != null)) n++;
  }
  return n;
}
