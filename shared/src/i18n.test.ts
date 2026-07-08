import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  languageInfo,
  languageDir,
  primarySubtag,
  pickInitialLanguage,
} from './i18n';

describe('language registry', () => {
  it('has unique lowercase ISO codes and a valid dir', () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const l of SUPPORTED_LANGUAGES) {
      expect(l.code).toMatch(/^[a-z]{2}$/);
      expect(['ltr', 'rtl']).toContain(l.dir);
      expect(l.nativeName.length).toBeGreaterThan(0);
    }
  });
  it('marks Arabic and Hebrew as rtl, English as ltr', () => {
    expect(languageDir('ar')).toBe('rtl');
    expect(languageDir('he')).toBe('rtl');
    expect(languageDir('en')).toBe('ltr');
    expect(languageDir('zz')).toBe('ltr'); // unknown falls back to ltr
  });
  it('looks up and validates codes', () => {
    expect(languageInfo('ru')?.nativeName).toBe('Русский');
    expect(isSupportedLanguage('ar')).toBe(true);
    expect(isSupportedLanguage('zz')).toBe(false);
  });
});

describe('pickInitialLanguage', () => {
  const offered = ['en', 'ar', 'ru'];
  it('matches by primary subtag', () => {
    expect(primarySubtag('ar-EG')).toBe('ar');
    expect(pickInitialLanguage(offered, ['ar-EG', 'en'], 'en')).toBe('ar');
    expect(pickInitialLanguage(offered, ['ru'], 'en')).toBe('ru');
  });
  it('falls back to defaultLang when nothing matches', () => {
    expect(pickInitialLanguage(offered, ['fr-FR', 'zz'], 'en')).toBe('en');
    expect(pickInitialLanguage(offered, [], 'ar')).toBe('ar');
  });
});

import { localizedOptionLabel, resolveText } from './i18n';
import type { QuestionTranslations } from './i18n';

describe('resolution helpers', () => {
  it('resolveText falls back on empty/undefined translation', () => {
    expect(resolveText('Base', 'Traducido')).toBe('Traducido');
    expect(resolveText('Base', '')).toBe('Base');
    expect(resolveText('Base', undefined)).toBe('Base');
    expect(resolveText('Base', null)).toBe('Base');
  });
  it('localizedOptionLabel returns base for the default language', () => {
    const t: QuestionTranslations = { ar: { optionLabels: { Yes: 'نعم' } } };
    expect(localizedOptionLabel('Yes', t, 'en', 'en')).toBe('Yes'); // default lang
    expect(localizedOptionLabel('Yes', t, 'ar', 'en')).toBe('نعم');
    expect(localizedOptionLabel('No', t, 'ar', 'en')).toBe('No'); // untranslated -> base
    expect(localizedOptionLabel('Yes', undefined, 'ar', 'en')).toBe('Yes');
  });
});
