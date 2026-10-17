/**
 * Whether a drag carries files, from its `DataTransfer.types`. The window
 * drop handlers in `main.ts` take over only such drags, so dragging text
 * into an input still works.
 */
export function isFileDrag(types: Iterable<string> | null | undefined): boolean {
  return types != null && Array.from(types).includes('Files');
}
