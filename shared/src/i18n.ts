// Curated language registry + browser-language detection (multilingual forms).
// Single source of truth for the builder picker, public detection, and RTL.

export type LanguageDir = 'ltr' | 'rtl';

export interface LanguageInfo {
  code: string; // ISO 639-1, lowercase
  name: string; // English name
  nativeName: string; // endonym
  dir: LanguageDir;
}

export const SUPPORTED_LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', dir: 'rtl' },
  { code: 'kk', name: 'Kazakh', nativeName: 'Қазақша', dir: 'ltr' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', dir: 'ltr' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', dir: 'ltr' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', dir: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
];

export const DEFAULT_APP_LANGUAGE = 'en';

const BY_CODE = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]));

export function languageInfo(code: string): LanguageInfo | undefined {
  return BY_CODE.get(code);
}
export function isSupportedLanguage(code: string): boolean {
  return BY_CODE.has(code);
}
export function languageDir(code: string): LanguageDir {
  return BY_CODE.get(code)?.dir ?? 'ltr';
}

/** 'ar-EG' -> 'ar'; lowercased. */
export function primarySubtag(tag: string): string {
  return tag.toLowerCase().split('-')[0];
}

/**
 * Best initial language: the first navigator language (by primary subtag) that
 * is in `supported`; otherwise `defaultLang`. Pure — safe to unit test.
 */
export function pickInitialLanguage(
  supported: readonly string[],
  navigatorLangs: readonly string[],
  defaultLang: string,
): string {
  const set = new Set(supported);
  for (const tag of navigatorLangs) {
    const primary = primarySubtag(tag);
    if (set.has(primary)) return primary;
  }
  return defaultLang;
}

// ── Translation payloads (stored as JSON on Form/Question; non-default langs) ──
export interface FormTextTranslation {
  title?: string;
  description?: string;
  welcomeText?: string;
  welcomeButtonLabel?: string;
  thankYouText?: string;
  privacyNotice?: string;
}
export type FormTranslations = Record<string, FormTextTranslation>;

export interface QuestionTextTranslation {
  label?: string;
  helpText?: string;
  /** base option string -> shown label in this language. Unknown keys ignored. */
  optionLabels?: Record<string, string>;
}
export type QuestionTranslations = Record<string, QuestionTextTranslation>;

/** The translated value if it is a non-empty string; otherwise the base value. */
export function resolveText<T extends string | null | undefined>(
  base: T,
  translated: string | null | undefined,
): T | string {
  return translated !== undefined && translated !== null && translated !== '' ? translated : base;
}

/** Shown label for a base option in `lang`, falling back to the base string. */
export function localizedOptionLabel(
  baseOption: string,
  translations: QuestionTranslations | undefined | null,
  lang: string,
  defaultLang: string,
): string {
  if (lang === defaultLang || !translations) return baseOption;
  const label = translations[lang]?.optionLabels?.[baseOption];
  return label !== undefined && label !== '' ? label : baseOption;
}
