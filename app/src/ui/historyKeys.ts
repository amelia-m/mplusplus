/**
 * Classifies a keydown as an undo or redo shortcut. Pure so it can be tested
 * without a DOM; `main.ts` passes the event and its target.
 */

export type HistoryKeyAction = 'undo' | 'redo' | 'none';

export interface HistoryKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The parts of the focused element that decide whether keys belong to it. */
export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
  /** An `input`'s `type` attribute; missing or unknown means text. */
  type?: string;
}

/**
 * `input` types that are not text entry. These controls have no text undo of
 * their own, so Ctrl+Z / Ctrl+Y on them undo the diagram. Every other type,
 * including a missing or unknown one (the browser treats it as text), keeps
 * the keys for its own editing.
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

/** True when the focused element edits text and so owns Ctrl+Z / Ctrl+Y. */
function isTextEntry(target: KeyTarget): boolean {
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((target.type ?? 'text').toLowerCase());
  return false;
}

/**
 * Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo. Keys compare
 * case-insensitively (Shift or Caps Lock report "Z"). Returns `none` when
 * focus is in a text-entry control (a text-like `input`, a `textarea`, or a
 * contenteditable), which handles its own editing keys, and for Alt
 * combinations (AltGr reports Ctrl+Alt on Windows). Non-text controls such
 * as sliders, checkboxes, colour pickers and `select` do not block undo.
 */
export function classifyHistoryKey(e: HistoryKeyEvent, target: KeyTarget | null): HistoryKeyAction {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return 'none';
  if (target && isTextEntry(target)) return 'none';
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y') return 'redo';
  return 'none';
}
