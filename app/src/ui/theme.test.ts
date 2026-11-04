import { describe, it, expect } from 'vitest';
import { nextTheme, parseTheme } from './theme.js';

describe('theme choice', () => {
  it('cycles auto, light, dark and back to auto', () => {
    expect(nextTheme('auto')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('auto');
  });

  it('reads a stored choice back, and anything else as auto', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme(null)).toBe('auto');
    expect(parseTheme('purple')).toBe('auto');
  });
});
