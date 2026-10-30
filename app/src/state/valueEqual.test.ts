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

  it('arrays compare by length and elements, not by key union (an [1] equalled [1, undefined])', () => {
    expect(valueEqual([1], [1, undefined])).toBe(false);
    expect(valueEqual([1, undefined], [1])).toBe(false);
    expect(valueEqual([1, undefined], [1, undefined])).toBe(true);
  });

  it('values that are not plain objects or arrays are equal only when identical (a Map equalled any Map)', () => {
    const m = new Map([['a', 1]]);
    expect(valueEqual(m, m)).toBe(true);
    expect(valueEqual(new Map([['a', 1]]), new Map([['b', 2]]))).toBe(false);
    expect(valueEqual(new Set([1]), new Set([1]))).toBe(false);
    expect(valueEqual(new Date(0), new Date(1))).toBe(false);
    expect(valueEqual(new Map(), {})).toBe(false);
    expect(valueEqual({}, Object.create(null))).toBe(false);
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
