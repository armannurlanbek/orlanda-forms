// Public-form theme application (§17.8). Turns a Form's `theme` into the exact
// five CSS variables the public form root expects, falling back to the Orlanda
// DEFAULT_THEME for any unset token. Colors are already validated server-side
// (§16.8); we only ever assign them to CSS custom properties (never raw markup).
import type { CSSProperties } from 'react';
import { DEFAULT_THEME, type Theme } from '@orlanda/shared';

/** CSS-variable map plus the surface colors used for the root element. */
export type ThemeVars = CSSProperties & Record<`--color-${string}`, string>;

export function themeToCssVars(theme: Theme | null | undefined): ThemeVars {
  const colors = { ...DEFAULT_THEME.colors, ...(theme?.colors ?? {}) };
  return {
    '--color-primary': colors.primary,
    '--color-on-primary': colors.onPrimary,
    '--color-bg': colors.bg,
    '--color-text': colors.text,
    '--color-focus': colors.focus,
    // Paint the root surface from the resolved tokens so the themed background
    // and body text apply even where Tailwind brand-* classes are not used.
    backgroundColor: colors.bg,
    color: colors.text,
  };
}

/** Resolve a usable logo URL (app-relative path) or null. */
export function resolveLogoUrl(theme: Theme | null | undefined): string | null {
  const url = theme?.logoUrl ?? DEFAULT_THEME.logoUrl ?? null;
  return url && url.trim() !== '' ? url : null;
}

export { DEFAULT_THEME };
