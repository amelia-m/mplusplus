import { describe, expect, it } from 'vitest';
import { isFileDrag } from './fileDrag.js';

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
