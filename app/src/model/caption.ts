import type { DgmFile } from '../parser/dgm.js';

/**
 * Notes drawn on the diagram for facts the boxes and arrows cannot show, one
 * line per fact. Mplus's Diagrammer does not show that an analysis was
 * weighted, so this goes beyond its output.
 */
export function modelCaptions(dgm: Pick<DgmFile, 'weights'>): string[] {
  return dgm.weights.map(({ option, variables }) =>
    option === 'WEIGHT' ? `Weighted: ${variables}` : `Weighted: ${variables} (${option})`,
  );
}
