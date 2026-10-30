/**
 * Whether an element edits text. Shared by the undo/redo keys (a text field
 * keeps Ctrl+Z for its own editing) and the window drop handlers (a text
 * field accepts dropped text). Pure so it can be tested without a DOM;
 * `describeTarget` reads the fields from a real element.
 */

/** The parts of an element that decide whether it edits text. */
export interface TextEntryTarget {
  tagName?: string;
  isContentEditable?: boolean;
  /** An `input`'s `type` attribute; missing or unknown means text. */
  type?: string;
}

/**
 * `input` types that are not text entry. Every other type, including a
 * missing or unknown one (the browser treats it as text), edits text.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** True for a text-like `input`, a `textarea` or a contenteditable element. */
export function isTextEntry(target: TextEntryTarget): boolean {
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((target.type ?? 'text').toLowerCase());
  return false;
}

/** The `TextEntryTarget` fields of an event target, or null for a non-HTML target. */
export function describeTarget(target: EventTarget | null): TextEntryTarget | null {
  if (!(target instanceof HTMLElement)) return null;
  return {
    tagName: target.tagName,
    isContentEditable: target.isContentEditable,
    type: target instanceof HTMLInputElement ? target.type : undefined,
  };
}
