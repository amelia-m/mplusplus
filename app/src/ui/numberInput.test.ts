import { describe, expect, it } from 'vitest';
import { parseNumberInput } from './numberInput.js';

const DECIMALS = { min: 0, max: 6, integer: true };

describe('parseNumberInput (Z3)', () => {
  it('clamps above max: Decimals 101 -> 6', () => {
    expect(parseNumberInput('101', DECIMALS)).toBe(6);
  });

  it('clamps below min: Decimals -1 -> 0', () => {
    expect(parseNumberInput('-1', DECIMALS)).toBe(0);
  });

  it('returns null for empty or whitespace input, so the value is left unchanged', () => {
    expect(parseNumberInput('', DECIMALS)).toBeNull();
    expect(parseNumberInput('   ', DECIMALS)).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseNumberInput('abc', DECIMALS)).toBeNull();
    expect(parseNumberInput('NaN', DECIMALS)).toBeNull();
    expect(parseNumberInput('Infinity', DECIMALS)).toBeNull();
  });

  it('rounds integer controls: Decimals 2.6 -> 3', () => {
    expect(parseNumberInput('2.6', DECIMALS)).toBe(3);
  });

  it('keeps fractional values for non-integer controls', () => {
    expect(parseNumberInput('2.65', { min: 0.5, max: 10 })).toBe(2.65);
    expect(parseNumberInput('0.1', { min: 0.5, max: 10 })).toBe(0.5);
    expect(parseNumberInput('12', { min: 0.5, max: 10 })).toBe(10);
  });

  it('rounds before clamping so the result is always within range', () => {
    expect(parseNumberInput('6.4', DECIMALS)).toBe(6);
    expect(parseNumberInput('-0.4', DECIMALS)).toBe(0);
  });
});
