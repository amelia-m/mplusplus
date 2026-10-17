import { describe, expect, it } from 'vitest';
import { interceptsWindowDrag, isFileDrag } from './fileDrag.js';

describe('isFileDrag (Q5)', () => {
  it('is true only when the drag carries files', () => {
    expect(isFileDrag(['Files'])).toBe(true);
    expect(isFileDrag(['text/uri-list', 'Files'])).toBe(true);
    expect(isFileDrag(['text/plain'])).toBe(false);
    expect(isFileDrag(['text/plain', 'text/html'])).toBe(false);
    expect(isFileDrag([])).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });
});

describe('interceptsWindowDrag (F2.6)', () => {
  const link = ['text/uri-list', 'text/plain'];

  it('intercepts a link or text drop outside editable fields (a dropped link navigated away)', () => {
    expect(interceptsWindowDrag(link, null)).toBe(true);
    expect(interceptsWindowDrag(link, { tagName: 'svg' })).toBe(true);
    expect(interceptsWindowDrag(['text/plain'], { tagName: 'DIV' })).toBe(true);
    expect(interceptsWindowDrag(link, { tagName: 'INPUT', type: 'range' })).toBe(true);
    expect(interceptsWindowDrag(link, { tagName: 'SELECT' })).toBe(true);
    expect(interceptsWindowDrag(undefined, { tagName: 'DIV' })).toBe(true);
  });

  it('leaves a non-file drop onto an editable field to the browser', () => {
    expect(interceptsWindowDrag(link, { tagName: 'INPUT', type: 'text' })).toBe(false);
    expect(interceptsWindowDrag(link, { tagName: 'INPUT' })).toBe(false);
    expect(interceptsWindowDrag(['text/plain'], { tagName: 'textarea' })).toBe(false);
    expect(interceptsWindowDrag(['text/plain'], { tagName: 'DIV', isContentEditable: true })).toBe(false);
  });

  it('always intercepts a file drag, even over an editable field', () => {
    expect(interceptsWindowDrag(['Files'], { tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(interceptsWindowDrag(['Files'], { tagName: 'TEXTAREA' })).toBe(true);
  });
});
