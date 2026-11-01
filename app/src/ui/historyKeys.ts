/**
 * Classifies a keydown as an undo or redo shortcut. Pure so it can be tested
 * without a DOM; `main.ts` passes the event and its target.
 */
import { isTextEntry, type TextEntryTarget } from './textEntry.js';

export type HistoryKeyAction = 'undo' | 'redo' | 'none';

export interface HistoryKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * The parts of the focused element that decide whether keys belong to it.
 * A text-entry element (`isTextEntry`) owns Ctrl+Z / Ctrl+Y; non-text
 * controls have no text undo of their own, so the keys undo the diagram.
 */
export type KeyTarget = TextEntryTarget;

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
