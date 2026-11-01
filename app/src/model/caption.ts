import type { DgmFile } from '../parser/dgm.js';

/**
 * The note drawn on the diagram for a fact the boxes and arrows cannot show,
 * or `null` when there is nothing to say. Mplus's Diagrammer does not show
 * that an analysis was weighted, so this goes beyond its output.
 */
export function modelCaption(dgm: DgmFile): string | null {
  return dgm.weight === null ? null : `Weighted: ${dgm.weight}`;
}
