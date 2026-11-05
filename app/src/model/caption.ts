import type { DgmFile } from '../parser/dgm.js';

/**
 * The note for a diagram read from a `.out` alone (Amelia, 2026-11-03): it
 * is laid out without Mplus's own placement, so it may not look like the
 * Diagrammer's.
 */
export const OUT_ORIGIN_NOTE = "Laid out from the .out; Mplus's Diagrammer may place it differently";

/**
 * Notes drawn on the diagram for facts the boxes and arrows cannot show, one
 * line per fact. Mplus's Diagrammer does not show that an analysis was
 * weighted, so this goes beyond its output.
 */
export function modelCaptions(dgm: Pick<DgmFile, 'weights' | 'origin'>): string[] {
  const weights = dgm.weights.map(({ option, variables }) =>
    option === 'WEIGHT' ? `Weighted: ${variables}` : `Weighted: ${variables} (${option})`,
  );
  return dgm.origin === 'out' ? [OUT_ORIGIN_NOTE, ...weights] : weights;
}
