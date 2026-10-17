import { describe, expect, it } from 'vitest';
import { classifyHistoryKey, type HistoryKeyEvent } from './historyKeys.js';

const key = (k: string, mods: Partial<HistoryKeyEvent> = {}): HistoryKeyEvent => ({
  key: k,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('classifyHistoryKey (Z4)', () => {
  it('Ctrl+Z and Cmd+Z undo', () => {
    expect(classifyHistoryKey(key('z'), null)).toBe('undo');
    expect(classifyHistoryKey(key('z', { ctrlKey: false, metaKey: true }), null)).toBe('undo');
  });

  it('compares case-insensitively: Ctrl+Z with Caps Lock undoes', () => {
    expect(classifyHistoryKey(key('Z'), null)).toBe('undo');
  });

  it('Ctrl+Shift+Z redoes (the browser reports key "Z")', () => {
    expect(classifyHistoryKey(key('Z', { shiftKey: true }), null)).toBe('redo');
    expect(classifyHistoryKey(key('z', { shiftKey: true }), null)).toBe('redo');
  });

  it('Ctrl+Y and Ctrl+Shift+Y redo', () => {
    expect(classifyHistoryKey(key('y'), null)).toBe('redo');
    expect(classifyHistoryKey(key('Y'), null)).toBe('redo');
    expect(classifyHistoryKey(key('Y', { shiftKey: true }), null)).toBe('redo');
  });

  it('needs Ctrl or Cmd', () => {
    expect(classifyHistoryKey(key('z', { ctrlKey: false }), null)).toBe('none');
  });

  it('ignores Alt combinations (AltGr reports Ctrl+Alt on Windows)', () => {
    expect(classifyHistoryKey(key('z', { altKey: true }), null)).toBe('none');
  });

  it('ignores other keys', () => {
    expect(classifyHistoryKey(key('x'), null)).toBe('none');
  });

  it('returns none when focus is in a text-entry field or contenteditable (F1)', () => {
    for (const type of ['text', 'number', 'search', 'email', 'url', 'tel', 'password']) {
      expect(classifyHistoryKey(key('z'), { tagName: 'INPUT', type })).toBe('none');
    }
    // A missing or unknown type defaults to text.
    expect(classifyHistoryKey(key('z'), { tagName: 'INPUT' })).toBe('none');
    expect(classifyHistoryKey(key('z'), { tagName: 'input', type: 'bogus' })).toBe('none');
    expect(classifyHistoryKey(key('z'), { tagName: 'INPUT', type: 'NUMBER' })).toBe('none');
    expect(classifyHistoryKey(key('z'), { tagName: 'TEXTAREA' })).toBe('none');
    expect(classifyHistoryKey(key('y'), { tagName: 'textarea' })).toBe('none');
    expect(classifyHistoryKey(key('z'), { tagName: 'DIV', isContentEditable: true })).toBe('none');
  });

  it('acts when focus is on a non-text control: range, checkbox, radio, color, file, button, select (F1)', () => {
    for (const type of ['range', 'checkbox', 'radio', 'color', 'file', 'button', 'submit', 'reset', 'RANGE']) {
      expect(classifyHistoryKey(key('z'), { tagName: 'INPUT', type })).toBe('undo');
    }
    expect(classifyHistoryKey(key('z'), { tagName: 'SELECT' })).toBe('undo');
    expect(classifyHistoryKey(key('y'), { tagName: 'select', type: 'select-one' })).toBe('redo');
  });

  it('acts when focus is elsewhere', () => {
    expect(classifyHistoryKey(key('z'), { tagName: 'BODY' })).toBe('undo');
    expect(classifyHistoryKey(key('y'), { tagName: 'svg', isContentEditable: false })).toBe('redo');
  });
});
