/**
 * Light and dark page theme. `auto` follows the system setting; `light`
 * and `dark` override it and are remembered in this browser. Only the
 * page around the diagram changes: the canvas stays a white sheet in
 * both, since the diagram's colors are the user's styles and what an
 * export would show.
 */
export type ThemeChoice = 'auto' | 'light' | 'dark';

export const THEME_KEY = 'mplusplus.theme';

const ORDER: ThemeChoice[] = ['auto', 'light', 'dark'];

/** The choice after `choice` when the theme button is pressed. */
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
}

/** A stored value read back as a choice; anything else is `auto`. */
export function parseTheme(value: string | null): ThemeChoice {
  return ORDER.includes(value as ThemeChoice) ? (value as ThemeChoice) : 'auto';
}

/** The button's text for `choice`. */
export function themeLabel(choice: ThemeChoice): string {
  return { auto: 'Theme: Auto', light: 'Theme: Light', dark: 'Theme: Dark' }[choice];
}
