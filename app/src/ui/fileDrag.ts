/**
 * Decisions for the window drag-and-drop handlers in `main.ts`. Pure so
 * they can be tested without a DOM.
 */
import { isTextEntry, type TextEntryTarget } from './textEntry.js';

/** Whether a drag carries files, from its `DataTransfer.types`. */
export function isFileDrag(types: Iterable<string> | null | undefined): boolean {
  return types != null && Array.from(types).includes('Files');
}

/**
 * Whether the window takes over a `dragover` / `drop` (calls
 * `preventDefault`). A file drag always is taken over, wherever it is, so a
 * dropped file is loaded rather than opened by the browser. Any other drag
 * (a link, text) is taken over too, so dropping a link cannot navigate away
 * from the diagram, except over a text-entry field (`isTextEntry`), which
 * keeps the browser's own drop so dragging text into a field still works.
 * `target` is the element under the pointer, or null when it is not an
 * HTML element (the SVG canvas, say).
 */
export function interceptsWindowDrag(
  types: Iterable<string> | null | undefined,
  target: TextEntryTarget | null,
): boolean {
  if (isFileDrag(types)) return true;
  return !(target && isTextEntry(target));
}
