// Theme tokens (§17.8) + strict server-side color validation (§16.8) + an AA
// contrast helper the builder uses to warn on bad color pairs.

import { z } from 'zod';

export interface ThemeColors {
  primary: string; // buttons / accents  -> --color-primary
  onPrimary: string; // text on primary   -> --color-on-primary
  bg: string; // page background          -> --color-bg
  text: string; // body text              -> --color-text
  focus: string; // focus ring            -> --color-focus
}

export interface Theme {
  logoUrl?: string | null;
  colors: ThemeColors;
}

// Orlanda defaults for any unset token (§17.8).
export const DEFAULT_THEME: Theme = {
  logoUrl: null,
  colors: {
    primary: '#1f4e79',
    onPrimary: '#ffffff',
    bg: '#f7f9fc',
    text: '#1a2330',
    focus: '#2b6cb0',
  },
};

// Strict color pattern: #RGB, #RRGGBB, rgb(...), rgba(...) only (§16.8).
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;
const RGBA = /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)$/;

export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && (HEX.test(value) || RGB.test(value) || RGBA.test(value));
}

const colorSchema = z.string().refine(isValidColor, { message: 'Invalid color value.' });

// logoUrl must be a relative app path (we never fetch remote URLs — SSRF, §16.8).
const logoUrlSchema = z
  .string()
  .refine((v) => v.startsWith('/'), { message: 'logoUrl must be an app-relative path.' })
  .nullable()
  .optional();

export const ThemeSchema = z.object({
  logoUrl: logoUrlSchema,
  colors: z.object({
    primary: colorSchema,
    onPrimary: colorSchema,
    bg: colorSchema,
    text: colorSchema,
    focus: colorSchema,
  }),
});

/** Parse + fill defaults; throws if any provided color is invalid. */
export function normalizeTheme(input: unknown): Theme {
  if (input === null || input === undefined) return DEFAULT_THEME;
  const parsed = ThemeSchema.partial({ colors: true } as never).safeParse(input);
  // Be lenient about missing tokens, strict about invalid ones.
  const obj = (typeof input === 'object' && input ? (input as Record<string, unknown>) : {}) as Partial<Theme>;
  const colors = (obj.colors ?? {}) as Partial<ThemeColors>;
  const out: ThemeColors = { ...DEFAULT_THEME.colors };
  for (const key of Object.keys(out) as (keyof ThemeColors)[]) {
    const v = colors[key];
    if (v !== undefined) {
      if (!isValidColor(v)) throw new Error(`Invalid color for ${key}`);
      out[key] = v;
    }
  }
  let logoUrl = DEFAULT_THEME.logoUrl ?? null;
  if (obj.logoUrl !== undefined && obj.logoUrl !== null) {
    if (typeof obj.logoUrl !== 'string' || !obj.logoUrl.startsWith('/')) {
      throw new Error('Invalid logoUrl');
    }
    logoUrl = obj.logoUrl;
  }
  void parsed;
  return { logoUrl, colors: out };
}

// ── AA contrast helper (§17.8) ──────────────────────────────────────────────
function toRgb(color: string): [number, number, number] | null {
  if (HEX.test(color)) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  const m = color.match(/\d{1,3}/g);
  if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const a = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/** WCAG contrast ratio between two colors (1..21), or null if unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const ra = toRgb(a);
  const rb = toRgb(b);
  if (!ra || !rb) return null;
  const la = luminance(ra);
  const lb = luminance(rb);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True if the pair meets AA for the given text size. */
export function meetsAA(a: string, b: string, large = false): boolean {
  const ratio = contrastRatio(a, b);
  if (ratio === null) return false;
  return ratio >= (large ? 3 : 4.5);
}
