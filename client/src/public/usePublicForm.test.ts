// Pure-logic test for the multilingual public form's initial-language
// selection. DOM-free — drives resolveInitialLang() directly (no React, no
// localStorage, no navigator) since it's an exported pure helper.
import { describe, expect, it } from 'vitest';
import { resolveInitialLang } from './usePublicForm';

describe('resolveInitialLang', () => {
  const dto = { slug: 's', defaultLang: 'en', languages: ['en', 'ar'] };

  it('uses a remembered offered language', () => {
    expect(resolveInitialLang(dto, ['en-US'], 'ar')).toBe('ar');
  });

  it('ignores a remembered language no longer offered', () => {
    expect(resolveInitialLang(dto, ['en-US'], 'fr')).toBe('en'); // detect en
  });

  it('detects from navigator when nothing remembered', () => {
    expect(resolveInitialLang(dto, ['ar-EG', 'en'], null)).toBe('ar');
  });
});
