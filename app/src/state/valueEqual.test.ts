import { describe, expect, it } from 'vitest';
import { mergeRecord, valueEqual } from './valueEqual.js';

describe('valueEqual', () => {
  it('compares plain data by value', () => {
    expect(valueEqual({ a: { x: 1, y: [1, 2] } }, { a: { x: 1, y: [1, 2] } })).toBe(true);
    expect(valueEqual({ a: { x: 1 } }, { a: { x: 2 } })).toBe(false);
    expect(valueEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(valueEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(valueEqual([], {})).toBe(false);
    expect(valueEqual(null, {})).toBe(false);
    expect(valueEqual(NaN, NaN)).toBe(true);
    expect(valueEqual(1, '1')).toBe(false);
  });

  it('treats a key set to undefined like a missing key', () => {
    expect(valueEqual({ shape: undefined }, {})).toBe(true);
    expect(valueEqual({}, { shape: undefined })).toBe(true);
    expect(valueEqual({ shape: null }, {})).toBe(false);
  });
});

describe('mergeRecord', () => {
  it('returns the same object when nothing changes, a new one otherwise', () => {
    const cur = { a: { x: 1 }, b: { x: 2 } };
    expect(mergeRecord(cur, {})).toBe(cur);
    expect(mergeRecord(cur, { a: { x: 1 } })).toBe(cur);
    const next = mergeRecord(cur, { a: { x: 5 } });
    expect(next).not.toBe(cur);
    expect(next).toEqual({ a: { x: 5 }, b: { x: 2 } });
  });
});
