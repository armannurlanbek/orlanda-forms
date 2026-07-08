# Multilingual Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one form be presented in several languages — the public form auto-detects the visitor's browser language and offers an instant toggle, staff enter each language's text manually, and right-to-left languages render mirrored — without changing how answers map to Monday.

**Architecture:** Translations are **display-only**: the form's default language stays canonical (`Question.options`, submitted answers, Monday values are always base-language). Translations are stored as JSON on the existing `Form`/`Question` rows, shipped whole in the public DTO, and switched client-side. `validateAnswers`, the mapping orchestrator, and the submission pipeline are untouched (`validateAnswers` gains only an additive optional `codes` map for localized client messages).

**Tech Stack:** TypeScript monorepo (`shared` CJS, `server` CJS + Express + Prisma/Postgres, `client` ESM + Vite + React + Zustand). Vitest. TailwindCSS.

## Global Constraints

- `shared` and `server` are CommonJS; `client` is ESM. Run `npm run build:shared` after editing `shared/src` before server/client typecheck/dev/test will see the change.
- The public form consumes a **render-safe DTO only** (§16.6). Only public text may be added to `PublicFormDTO`/`PublicQuestionDTO` — never boardId, mapping mode, AI prompt/reasoning, or internal status.
- FROZEN shapes may be **extended, not reshaped**. `validateAnswers`'s existing `errors`/`ok`/`normalized` must not change; only add the optional `codes` field.
- Language codes are ISO 639-1 lowercase. The curated registry `SUPPORTED_LANGUAGES` in `shared` is the single source of truth for the builder picker, browser detection, and RTL direction.
- `Form.languages` is the **full offered set including `defaultLang`**; empty ⇒ single-language (just the default). Invariant when non-empty: `defaultLang ∈ languages`.
- Preserve `§` spec-reference comments when editing files. Match surrounding code style.
- Single-test command per workspace: `npm run test --workspace <ws> -- <path>`. `vitest run <path> --root <ws>` does NOT resolve — use the `--workspace` form.
- Commit after every task.

---

## File Structure

**shared/src/**
- Create `i18n.ts` — registry, detection, translation types, resolution helpers, UI-string dictionaries.
- Create `i18n.test.ts` — unit tests for the above.
- Modify `answers.ts` — add `ValidationCode` + optional `codes` to `ValidationResult`; populate codes.
- Modify `answers.test.ts` (or create if absent) — assert codes.
- Modify `dto.ts` — add i18n fields to `PublicFormDTO`, `PublicQuestionDTO`, `FormDetail`, `SaveFormInput`, `QuestionInput`.
- Modify `index.ts` — `export * from './i18n'`.

**prisma/**
- Modify `schema.prisma` — `Form.defaultLang/languages/translations`, `Question.translations`.
- Generated migration under `prisma/migrations/`.

**server/src/**
- Modify `public/routes.ts` — DTO assembly adds i18n fields.
- Modify `forms/service.ts` — `toFormDetail` + public DTO builder + `saveForm` persistence.
- Modify `forms/validation.ts` — language validation in `saveFormInputSchema`.
- Modify/extend `forms/*.test.ts`, `public/*.test.ts`.

**client/src/public/**
- Modify `usePublicForm.ts` — `activeLang` state, detection, localStorage.
- Create `LanguageToggle.tsx` — the switcher.
- Modify `PublicFormPage.tsx` / `screens/ScreenShell.tsx` — `dir` + toggle placement.
- Modify `screens/WelcomeScreen.tsx`, `screens/QuestionsScreen.tsx`, `screens/ThankYouScreen.tsx`, `widgets/Field.tsx`, `widgets/QuestionWidget.tsx`, `widgets/AttachmentWidget.tsx` — resolved text + localized chrome/validation + canonical option submit.
- Modify `public.css` — logical properties for RTL.
- Create/modify client tests.

**client/src/builder/**
- Modify `store.ts` — i18n state, `editingLang`, setters, `detailToState`/`toSaveInput`.
- Modify `panels/SettingsPanel.tsx` — Languages section.
- Create `components/LanguageBar.tsx` — `editingLang` switcher.
- Modify question/field editors + preview for per-language editing.
- Create `store.test.ts` additions.

---

## Phase A — Shared contract

### Task 1: Language registry + browser detection

**Files:**
- Create: `shared/src/i18n.ts`
- Test: `shared/src/i18n.test.ts`

**Interfaces:**
- Produces: `LanguageDir`, `LanguageInfo`, `SUPPORTED_LANGUAGES`, `DEFAULT_APP_LANGUAGE`, `languageInfo(code)`, `isSupportedLanguage(code)`, `languageDir(code)`, `primarySubtag(tag)`, `pickInitialLanguage(supported, navigatorLangs, defaultLang)`.

- [ ] **Step 1: Write the failing test**

```ts
// shared/src/i18n.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace shared -- src/i18n.test.ts`
Expected: FAIL (cannot resolve `./i18n`).

- [ ] **Step 3: Write minimal implementation**

```ts
// shared/src/i18n.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace shared -- src/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/i18n.ts shared/src/i18n.test.ts
git commit -m "feat(i18n): language registry + browser-language detection"
```

---

### Task 2: Translation types + resolution helpers

**Files:**
- Modify: `shared/src/i18n.ts`
- Test: `shared/src/i18n.test.ts`

**Interfaces:**
- Produces: `FormTextTranslation`, `FormTranslations`, `QuestionTextTranslation`, `QuestionTranslations`, `resolveText(base, translated)`, `localizedOptionLabel(baseOption, translations, lang, defaultLang)`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test** (append to `shared/src/i18n.test.ts`)

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace shared -- src/i18n.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Write minimal implementation** (append to `shared/src/i18n.ts`)

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace shared -- src/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/i18n.ts shared/src/i18n.test.ts
git commit -m "feat(i18n): translation types + resolution helpers"
```

---

### Task 3: Built-in UI strings dictionary

**Files:**
- Modify: `shared/src/i18n.ts`
- Test: `shared/src/i18n.test.ts`

**Interfaces:**
- Produces: `ValidationCode` (also used by Task 4), `UiStrings`, `UI_STRINGS`, `uiStrings(lang)`, `formatUiString(template, n)`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { UI_STRINGS, uiStrings, formatUiString } from './i18n';

describe('UI strings', () => {
  it('covers every supported language', () => {
    for (const l of SUPPORTED_LANGUAGES) {
      expect(UI_STRINGS[l.code]).toBeDefined();
      expect(UI_STRINGS[l.code].submit.length).toBeGreaterThan(0);
    }
  });
  it('falls back to English for an unknown language', () => {
    expect(uiStrings('zz').submit).toBe(UI_STRINGS.en.submit);
  });
  it('interpolates {n}', () => {
    expect(formatUiString('Max {n} characters.', 5)).toBe('Max 5 characters.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace shared -- src/i18n.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation** (append to `shared/src/i18n.ts`)

```ts
// ── Stable validation codes (populated by validateAnswers; localized client-side) ──
export type ValidationCode =
  | 'required'
  | 'chooseOption'
  | 'chooseAtLeastOne'
  | 'invalidOption'
  | 'duplicate'
  | 'mustBeNumber'
  | 'min'
  | 'max'
  | 'maxLength'
  | 'uploadRequired'
  | 'invalid'
  | 'unknownQuestion';

// ── Built-in public-form chrome + standard validation messages ────────────────
export interface UiStrings {
  languageLabel: string;
  submit: string;
  start: string;
  back: string;
  next: string;
  // validation (min/max/maxLength use {n})
  required: string;
  chooseOption: string;
  chooseAtLeastOne: string;
  invalidOption: string;
  duplicate: string;
  mustBeNumber: string;
  min: string;
  max: string;
  maxLength: string;
  uploadRequired: string;
  invalid: string;
}

const EN: UiStrings = {
  languageLabel: 'Language',
  submit: 'Submit',
  start: 'Start',
  back: 'Back',
  next: 'Next',
  required: 'This field is required.',
  chooseOption: 'Please choose an option.',
  chooseAtLeastOne: 'Please choose at least one option.',
  invalidOption: 'Invalid option selected.',
  duplicate: 'Duplicate options selected.',
  mustBeNumber: 'Must be a number.',
  min: 'Must be at least {n}.',
  max: 'Must be at most {n}.',
  maxLength: 'Maximum {n} characters.',
  uploadRequired: 'Please upload a file.',
  invalid: 'Invalid answer.',
};

const RU: UiStrings = {
  languageLabel: 'Язык',
  submit: 'Отправить',
  start: 'Начать',
  back: 'Назад',
  next: 'Далее',
  required: 'Это поле обязательно.',
  chooseOption: 'Пожалуйста, выберите вариант.',
  chooseAtLeastOne: 'Выберите хотя бы один вариант.',
  invalidOption: 'Выбран недопустимый вариант.',
  duplicate: 'Выбраны повторяющиеся варианты.',
  mustBeNumber: 'Должно быть числом.',
  min: 'Не менее {n}.',
  max: 'Не более {n}.',
  maxLength: 'Максимум {n} символов.',
  uploadRequired: 'Пожалуйста, загрузите файл.',
  invalid: 'Недопустимый ответ.',
};

const AR: UiStrings = {
  languageLabel: 'اللغة',
  submit: 'إرسال',
  start: 'ابدأ',
  back: 'رجوع',
  next: 'التالي',
  required: 'هذا الحقل مطلوب.',
  chooseOption: 'يرجى اختيار خيار.',
  chooseAtLeastOne: 'يرجى اختيار خيار واحد على الأقل.',
  invalidOption: 'تم اختيار خيار غير صالح.',
  duplicate: 'تم اختيار خيارات مكررة.',
  mustBeNumber: 'يجب أن يكون رقمًا.',
  min: 'يجب ألا يقل عن {n}.',
  max: 'يجب ألا يزيد عن {n}.',
  maxLength: 'الحد الأقصى {n} حرفًا.',
  uploadRequired: 'يرجى رفع ملف.',
  invalid: 'إجابة غير صالحة.',
};

const HE: UiStrings = {
  languageLabel: 'שפה',
  submit: 'שליחה',
  start: 'התחלה',
  back: 'חזרה',
  next: 'הבא',
  required: 'שדה חובה.',
  chooseOption: 'יש לבחור אפשרות.',
  chooseAtLeastOne: 'יש לבחור לפחות אפשרות אחת.',
  invalidOption: 'נבחרה אפשרות לא חוקית.',
  duplicate: 'נבחרו אפשרויות כפולות.',
  mustBeNumber: 'חייב להיות מספר.',
  min: 'לפחות {n}.',
  max: 'לכל היותר {n}.',
  maxLength: 'עד {n} תווים.',
  uploadRequired: 'יש להעלות קובץ.',
  invalid: 'תשובה לא חוקית.',
};

// Languages without a full dictionary reuse English chrome (acceptable fallback).
export const UI_STRINGS: Record<string, UiStrings> = {
  en: EN, ru: RU, ar: AR, he: HE,
  kk: EN, uk: RU, tr: EN, de: EN, fr: EN, es: EN,
};

export function uiStrings(lang: string): UiStrings {
  return UI_STRINGS[lang] ?? EN;
}

/** Replace the single `{n}` placeholder with a number. */
export function formatUiString(template: string, n: number | string): string {
  return template.replace('{n}', String(n));
}
```

Note: `kk/uk/tr/de/fr/es` intentionally reuse `EN`/`RU` chrome for now (documented fallback). Replace with real translations later; the test only requires each supported language resolve to a non-empty `UiStrings`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace shared -- src/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/i18n.ts shared/src/i18n.test.ts
git commit -m "feat(i18n): built-in UI-string dictionaries + validation codes"
```

---

### Task 4: Add validation codes to `validateAnswers` (additive)

**Files:**
- Modify: `shared/src/answers.ts`
- Test: `shared/src/answers.test.ts` (create if it does not exist)

**Interfaces:**
- Consumes: `ValidationCode` from `./i18n`.
- Produces: `ValidationResult.codes?: Record<string, ValidationCode>` populated for every error branch. `errors`, `ok`, `normalized` are unchanged.

- [ ] **Step 1: Write the failing test**

First check whether `shared/src/answers.test.ts` exists (`ls shared/src`). If it exists, append; if not, create it with this content:

```ts
// shared/src/answers.test.ts
import { describe, expect, it } from 'vitest';
import { validateAnswers } from './answers';
import type { QuestionDef } from './types';

const q = (over: Partial<QuestionDef>): QuestionDef => ({
  id: 'q1', order: 0, type: 'text', label: 'Q', required: true, options: null, ...over,
});

describe('validateAnswers codes (additive)', () => {
  it('emits a required code and keeps the English error', () => {
    const res = validateAnswers([q({})], {});
    expect(res.ok).toBe(false);
    expect(res.errors.q1).toBe('This field is required.'); // unchanged
    expect(res.codes?.q1).toBe('required');
  });
  it('emits invalidOption for an out-of-list select value', () => {
    const res = validateAnswers(
      [q({ type: 'single_select', required: true, options: { options: ['a', 'b'] } })],
      { q1: { type: 'single_select', value: 'zzz' } },
    );
    expect(res.codes?.q1).toBe('invalidOption');
  });
  it('emits maxLength and still validates a base option value', () => {
    const long = validateAnswers(
      [q({ type: 'text', required: false, options: { maxLength: 3 } })],
      { q1: { type: 'text', value: 'abcd' } },
    );
    expect(long.codes?.q1).toBe('maxLength');

    const ok = validateAnswers(
      [q({ type: 'single_select', required: true, options: { options: ['Yes', 'No'] } })],
      { q1: { type: 'single_select', value: 'Yes' } },
    );
    expect(ok.ok).toBe(true);
    expect(ok.codes).toEqual({}); // no errors -> empty codes map
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace shared -- src/answers.test.ts`
Expected: FAIL (`codes` is undefined).

- [ ] **Step 3: Write minimal implementation**

In `shared/src/answers.ts`:

1. Add the import at the top (with the existing type import):
```ts
import type { QuestionDef, QuestionType } from './types';
import type { ValidationCode } from './i18n';
```

2. Extend the result interface (do NOT remove existing fields):
```ts
export interface ValidationResult {
  ok: boolean;
  /** per-question error messages, keyed by questionId (English; server gate) */
  errors: Record<string, string>;
  /** NEW (additive): stable per-question error code for client-side localization */
  codes?: Record<string, ValidationCode>;
  /** normalized answers (e.g. number coercion) — only meaningful when ok */
  normalized: AnswersMap;
}
```

3. Inside `validateAnswers`, add a `codes` map next to `errors` and a helper that sets both, then replace each `errors[...] = '...'` assignment with `fail(id, code, message)`:
```ts
  const errors: Record<string, string> = {};
  const codes: Record<string, ValidationCode> = {};
  const normalized: AnswersMap = {};

  const fail = (id: string, code: ValidationCode, message: string): void => {
    errors[id] = message;
    codes[id] = code;
  };
```

Then convert every existing error assignment. The complete mapping (message → code) to apply:
- `errors[key] = 'Unknown question.'` → `fail(key, 'unknownQuestion', 'Unknown question.')`
- `errors[q.id] = 'This field is required.'` (both occurrences: required-not-present, and text-empty) → `fail(q.id, 'required', 'This field is required.')`
- `errors[q.id] = 'Invalid answer.'` → `fail(q.id, 'invalid', 'Invalid answer.')`
- `errors[q.id] = \`Expected answer of type ${q.type}.\`` → `fail(q.id, 'invalid', \`Expected answer of type ${q.type}.\`)`
- text/long_text `\`Maximum ${cfg.maxLength} characters.\`` → `fail(q.id, 'maxLength', \`Maximum ${cfg.maxLength} characters.\`)`
- number `'Must be a number.'` → `fail(q.id, 'mustBeNumber', 'Must be a number.')`
- number `\`Must be at least ${cfg.min}.\`` → `fail(q.id, 'min', \`Must be at least ${cfg.min}.\`)`
- number `\`Must be at most ${cfg.max}.\`` → `fail(q.id, 'max', \`Must be at most ${cfg.max}.\`)`
- single_select `'Please choose an option.'` → `fail(q.id, 'chooseOption', 'Please choose an option.')`
- single_select `'Invalid option selected.'` → `fail(q.id, 'invalidOption', 'Invalid option selected.')`
- multi_select `'Invalid selection.'` → `fail(q.id, 'invalid', 'Invalid selection.')`
- multi_select `'Please choose at least one option.'` → `fail(q.id, 'chooseAtLeastOne', 'Please choose at least one option.')`
- multi_select `'Invalid option selected.'` → `fail(q.id, 'invalidOption', 'Invalid option selected.')`
- multi_select `'Duplicate options selected.'` → `fail(q.id, 'duplicate', 'Duplicate options selected.')`
- multi_select `\`Select at least ${cfg.minSelections}.\`` → `fail(q.id, 'min', \`Select at least ${cfg.minSelections}.\`)`
- multi_select `\`Select at most ${cfg.maxSelections}.\`` → `fail(q.id, 'max', \`Select at most ${cfg.maxSelections}.\`)`
- attachment `'Invalid attachment answer.'` → `fail(q.id, 'invalid', 'Invalid attachment answer.')`
- attachment `'Please upload a file.'` → `fail(q.id, 'uploadRequired', 'Please upload a file.')`

4. Update the return statement:
```ts
  return { ok: Object.keys(errors).length === 0, errors, codes, normalized };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace shared -- src/answers.test.ts`
Expected: PASS. Also run the full shared suite to catch regressions: `npm run test --workspace shared`.

- [ ] **Step 5: Commit**

```bash
git add shared/src/answers.ts shared/src/answers.test.ts
git commit -m "feat(i18n): additive validation codes on validateAnswers"
```

---

### Task 5: DTO fields + package export + build

**Files:**
- Modify: `shared/src/dto.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `FormTranslations`, `QuestionTranslations` from `./i18n`.
- Produces: i18n fields on `PublicFormDTO`, `PublicQuestionDTO`, `FormDetail`, `SaveFormInput`, `QuestionInput`; `@orlanda/shared` re-exports everything in `i18n.ts`.

- [ ] **Step 1: Add the import to `shared/src/dto.ts`** (top, next to existing imports)

```ts
import type { FormTranslations, QuestionTranslations } from './i18n';
```

- [ ] **Step 2: Add fields to the DTOs in `shared/src/dto.ts`**

`PublicQuestionDTO` — add after `options`:
```ts
  translations?: QuestionTranslations | null;
```
`PublicFormDTO` — add after `slug`:
```ts
  defaultLang: string;
  languages: string[]; // offered set incl. default (>=1), display order
  translations?: FormTranslations | null;
```
`QuestionInput` — add after `options`:
```ts
  translations?: QuestionTranslations | null;
```
`FormDetail` — add after `slug`:
```ts
  defaultLang: string;
  languages: string[];
  translations?: FormTranslations | null;
```
`SaveFormInput` — add after `slug`:
```ts
  defaultLang?: string;
  languages?: string[];
  translations?: FormTranslations | null;
```

- [ ] **Step 3: Export i18n from the package index**

In `shared/src/index.ts` add (match the existing `export * from './...'` style):
```ts
export * from './i18n';
```

- [ ] **Step 4: Build shared and typecheck**

Run:
```bash
npm run build:shared
npm run typecheck
```
Expected: both succeed. (Server/client still compile — the new DTO fields are optional or will be supplied by later tasks; if `typecheck` flags a server/client site that constructs these DTOs without the new required fields — `PublicFormDTO.defaultLang/languages`, `FormDetail.defaultLang/languages` — that site is fixed in Task 7/8. It is acceptable for this task's `typecheck` to surface those two server construction sites; note them and proceed — they are Task 7/8's deliverables. Do not add client changes here.)

If typecheck fails only at `server/src/public/routes.ts` and `server/src/forms/service.ts` DTO construction, that is expected; continue.

- [ ] **Step 5: Commit**

```bash
git add shared/src/dto.ts shared/src/index.ts shared/dist
git commit -m "feat(i18n): DTO fields + shared i18n exports"
```

---

## Phase B — Database + Server

### Task 6: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration under `prisma/migrations/` (generated)

**Interfaces:**
- Produces: `Form.defaultLang: String`, `Form.languages: String[]`, `Form.translations: Json?`, `Question.translations: Json?`.

- [ ] **Step 1: Edit the schema**

In `model Form` (after `privacyNotice`), add:
```prisma
  // Multilingual forms: base language of title/options/etc.; `languages` is the
  // full offered set INCLUDING defaultLang (empty => single-language). Translations
  // are display-only — answers/mapping stay in the default language.
  defaultLang  String   @default("en")
  languages    String[] @default([])
  translations Json?
```
In `model Question` (after `directMapping`), add:
```prisma
  // Display-only per-language text: QuestionTranslations keyed by lang code.
  translations Json?
```

- [ ] **Step 2: Create the migration**

Run:
```bash
npm run prisma:migrate -- --name multilingual_forms
```
Expected: a new folder `prisma/migrations/<timestamp>_multilingual_forms/` with `ALTER TABLE "Form" ADD COLUMN "defaultLang" ... ADD COLUMN "languages" ... ADD COLUMN "translations" ...` and the `Question` column. Prisma client regenerates.

If the dev DB is not running, generate the SQL only and apply on next deploy; verify the generated SQL adds the four columns with the defaults above. (Container entrypoint already runs `prisma migrate deploy`.)

- [ ] **Step 3: Regenerate the client (if not already)**

Run: `npm run prisma:generate`
Expected: success; `@prisma/client` now types `defaultLang`, `languages`, `translations`.

- [ ] **Step 4: Verify server still typechecks against the new client**

Run: `npm run build:shared && npm run typecheck`
Expected: succeeds except the known DTO-construction sites from Task 5 (fixed next). No Prisma type errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(i18n): Form/Question translation columns + migration"
```

---

### Task 7: Public DTO assembly

**Files:**
- Modify: `server/src/public/routes.ts:38-68`
- Test: `server/src/public/routes.test.ts` (create or extend — check for an existing public test first)

**Interfaces:**
- Consumes: `PublicFormDTO`, `PublicQuestionDTO` (now with i18n fields), `FormTranslations`/`QuestionTranslations`.
- Produces: the public GET-by-slug endpoint returns `defaultLang`, `languages`, `translations`, and per-question `translations`.

- [ ] **Step 1: Write the failing test**

Check for an existing public route test (`ls server/src/public`). Follow the repo's prisma-mock convention (see `server/src/forms/service.test.ts` / `server/src/submissions/routes.test.ts`). Add a test that a form with `languages: ['en','ar']` returns them in the DTO:

```ts
// server/src/public/routes.test.ts (add case)
it('exposes languages, defaultLang and translations in the public DTO', async () => {
  // Arrange a mocked form row with:
  //   defaultLang: 'en', languages: ['en','ar'],
  //   translations: { ar: { title: 'عنوان' } },
  //   questions: [{ ..., translations: { ar: { label: 'الاسم' } } }]
  // Act: GET /:slug
  // Assert: body.defaultLang === 'en'; body.languages === ['en','ar'];
  //         body.translations.ar.title === 'عنوان';
  //         body.questions[0].translations.ar.label === 'الاسم'
});
```
(Fill in the arrange/act using the existing test's harness — mock `prisma.form.findFirst` to return the row, drive the router with supertest.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace server -- src/public/routes.test.ts`
Expected: FAIL (DTO lacks the fields).

- [ ] **Step 3: Implement the assembly change**

In `server/src/public/routes.ts`, the question mapper (~L38) — add `translations`:
```ts
    const questions: PublicQuestionDTO[] = form.questions.map((q) => ({
      id: q.id,
      order: q.order,
      type: q.type,
      label: q.label,
      helpText: q.helpText,
      required: q.required,
      options: (q.options as QuestionConfig) ?? null,
      translations: (q.translations as QuestionTranslations | null) ?? null,
    }));
```
And the DTO (~L59) — add the three form fields:
```ts
    const dto: PublicFormDTO = {
      slug: form.slug,
      defaultLang: form.defaultLang,
      languages: form.languages.length ? form.languages : [form.defaultLang],
      translations: (form.translations as FormTranslations | null) ?? null,
      title: form.title,
      description: form.description,
      welcomeText: form.welcomeText,
      welcomeButtonLabel: form.welcomeButtonLabel,
      thankYouText: form.thankYouText,
      privacyNotice: form.privacyNotice,
      theme,
      questions,
    };
```
Add the imports to the top `@orlanda/shared` import block: `type FormTranslations`, `type QuestionTranslations`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace server -- src/public/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/public/routes.ts server/src/public/routes.test.ts
git commit -m "feat(i18n): expose languages + translations in the public DTO"
```

---

### Task 8: Builder DTO + save persistence

**Files:**
- Modify: `server/src/forms/service.ts` (`toFormDetail`, the public/detail builders, `saveForm`)
- Test: `server/src/forms/service.test.ts`

**Interfaces:**
- Consumes: `SaveFormInput` (with i18n fields), Prisma `Form`/`Question` (with new columns).
- Produces: `getFormDetail`/`saveForm` round-trip `defaultLang`, `languages`, `translations` (form + per-question).

- [ ] **Step 1: Write the failing test**

In `server/src/forms/service.test.ts` add a case that saving a form with `defaultLang:'en'`, `languages:['en','ar']`, `translations:{ar:{title:'عنوان'}}`, and a question with `translations:{ar:{label:'الاسم'}}` persists and re-reads them. Follow the file's existing mock pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace server -- src/forms/service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`toFormDetail` (returns `FormDetail`) — include:
```ts
    defaultLang: form.defaultLang,
    languages: form.languages,
    translations: (form.translations as FormTranslations | null) ?? null,
```
and each mapped question includes `translations: (q.translations as QuestionTranslations | null) ?? null`.

`saveForm` `$transaction` `form.update` `data` — add (alongside `title`, `...slugUpdate`):
```ts
        defaultLang: input.defaultLang ?? 'en',
        languages: input.languages ?? [],
        translations: (input.translations ?? undefined) as Prisma.InputJsonValue | undefined,
```
For each question create/update `data`, include:
```ts
        translations: (data.translations ?? undefined) as Prisma.InputJsonValue | undefined,
```
(where `data.translations` comes from the incoming `QuestionInput.translations`). Add `FormTranslations`/`QuestionTranslations` to the `@orlanda/shared` type import. Use `Prisma.JsonNull` if you need to explicitly clear translations; `undefined` leaves the column unchanged, which is fine on create because the column defaults to NULL.

Guard the language set defensively (belt-and-braces; the schema validation in Task 9 is authoritative): if `input.languages` is provided and non-empty, ensure `input.defaultLang` is included — but do NOT throw here (validation layer owns rejection); just persist what validation already approved.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace server -- src/forms/service.test.ts`
Expected: PASS. Also `npm run typecheck` (the Task 5 DTO-construction sites should now be satisfied).

- [ ] **Step 5: Commit**

```bash
git add server/src/forms/service.ts server/src/forms/service.test.ts
git commit -m "feat(i18n): persist + return form/question translations"
```

---

### Task 9: Save-input language validation

**Files:**
- Modify: `server/src/forms/validation.ts` (`saveFormInputSchema`)
- Test: `server/src/forms/validation.test.ts`

**Interfaces:**
- Consumes: `isSupportedLanguage` from `@orlanda/shared`.
- Produces: `saveFormInputSchema` accepts/normalizes `defaultLang`, `languages`, `translations` and rejects invalid language sets with a field error.

- [ ] **Step 1: Write the failing test**

In `server/src/forms/validation.test.ts` add:
```ts
it('rejects an unsupported language code', () => {
  const res = saveFormInputSchema.safeParse(baseInput({ defaultLang: 'en', languages: ['en', 'zz'] }));
  expect(res.success).toBe(false);
});
it('rejects when defaultLang is not in a non-empty languages set', () => {
  const res = saveFormInputSchema.safeParse(baseInput({ defaultLang: 'ar', languages: ['en', 'ru'] }));
  expect(res.success).toBe(false);
});
it('accepts a valid multilingual set', () => {
  const res = saveFormInputSchema.safeParse(baseInput({ defaultLang: 'en', languages: ['en', 'ar'], translations: { ar: { title: 'x' } } }));
  expect(res.success).toBe(true);
});
it('accepts a single-language form (empty languages)', () => {
  const res = saveFormInputSchema.safeParse(baseInput({ defaultLang: 'en', languages: [] }));
  expect(res.success).toBe(true);
});
```
(Use/define a `baseInput(over)` helper matching the file's existing minimal valid input — title + questions + mappingMode.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace server -- src/forms/validation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the import: `import { isSupportedLanguage } from '@orlanda/shared';`.

Add fields to `saveFormInputSchema` (`.object({...})`):
```ts
    defaultLang: z.string().optional(),
    languages: z.array(z.string()).optional(),
    translations: z.record(z.string(), z.record(z.string(), z.string().nullable().optional())).optional(),
```
Then chain a `.superRefine` on the object (or extend an existing one) enforcing:
```ts
  .superRefine((val, ctx) => {
    const def = val.defaultLang ?? 'en';
    if (!isSupportedLanguage(def)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultLang'], message: 'Unsupported language.' });
    }
    const langs = val.languages ?? [];
    for (const l of langs) {
      if (!isSupportedLanguage(l)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['languages'], message: `Unsupported language: ${l}.` });
      }
    }
    if (new Set(langs).size !== langs.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['languages'], message: 'Duplicate language.' });
    }
    if (langs.length > 0 && !langs.includes(def)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['languages'], message: 'Default language must be included.' });
    }
    for (const key of Object.keys(val.translations ?? {})) {
      if (langs.length > 0 && !langs.includes(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['translations'], message: `Translation for a non-offered language: ${key}.` });
      }
    }
  })
```
(If `saveFormInputSchema` already ends in a refine, add these checks inside it rather than chaining a second one; the note in the file about the schema shape (`z.object({...})`) applies.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace server -- src/forms/validation.test.ts`
Expected: PASS. Then run the full server suite: `npm run test --workspace server`.

- [ ] **Step 5: Commit**

```bash
git add server/src/forms/validation.ts server/src/forms/validation.test.ts
git commit -m "feat(i18n): validate the form language set on save"
```

---

## Phase C — Public form

### Task 10: `activeLang` state + detection + persistence

**Files:**
- Modify: `client/src/public/usePublicForm.ts`
- Test: `client/src/public/usePublicForm.test.ts` (create; DOM-free logic where possible, else extract a pure helper)

**Interfaces:**
- Consumes: `pickInitialLanguage`, `PublicFormDTO`.
- Produces: the public form hook exposes `activeLang: string`, `setActiveLang(code)`, and `dir: LanguageDir`. Initial `activeLang` = remembered choice (localStorage `orlanda.lang.<slug>`) if still offered, else `pickInitialLanguage(dto.languages, navigator.languages, dto.defaultLang)`.

- [ ] **Step 1: Write the failing test**

Extract the selection logic into a pure exported helper so it is testable without React:
```ts
// client/src/public/usePublicForm.test.ts
import { describe, expect, it } from 'vitest';
import { resolveInitialLang } from './usePublicForm';

describe('resolveInitialLang', () => {
  const dto = { slug: 's', defaultLang: 'en', languages: ['en', 'ar'] } as const;
  it('uses a remembered offered language', () => {
    expect(resolveInitialLang(dto as any, ['en-US'], 'ar')).toBe('ar');
  });
  it('ignores a remembered language no longer offered', () => {
    expect(resolveInitialLang(dto as any, ['en-US'], 'fr')).toBe('en'); // detect en
  });
  it('detects from navigator when nothing remembered', () => {
    expect(resolveInitialLang(dto as any, ['ar-EG', 'en'], null)).toBe('ar');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace client -- src/public/usePublicForm.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `usePublicForm.ts`, export the pure helper and wire the hook state:
```ts
import { pickInitialLanguage, languageDir } from '@orlanda/shared';
import type { PublicFormDTO } from '@orlanda/shared';

/** Chosen initial language: a still-offered remembered choice wins; else detect. */
export function resolveInitialLang(
  dto: Pick<PublicFormDTO, 'defaultLang' | 'languages'>,
  navigatorLangs: readonly string[],
  remembered: string | null,
): string {
  if (remembered && dto.languages.includes(remembered)) return remembered;
  return pickInitialLanguage(dto.languages, navigatorLangs, dto.defaultLang);
}
```
Then in the hook (after the form DTO loads), add state:
```ts
const [activeLang, setActiveLangState] = useState<string>(dto.defaultLang);
useEffect(() => {
  const remembered = typeof localStorage !== 'undefined' ? localStorage.getItem(`orlanda.lang.${dto.slug}`) : null;
  const navLangs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  setActiveLangState(resolveInitialLang(dto, navLangs, remembered));
}, [dto.slug]); // eslint-disable-line react-hooks/exhaustive-deps
const setActiveLang = (code: string): void => {
  setActiveLangState(code);
  try { localStorage.setItem(`orlanda.lang.${dto.slug}`, code); } catch { /* ignore */ }
};
const dir = languageDir(activeLang);
```
Return `activeLang`, `setActiveLang`, `dir` from the hook alongside the existing values. (Adapt to the hook's actual shape — it may return an object; add the three keys.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace client -- src/public/usePublicForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/public/usePublicForm.ts client/src/public/usePublicForm.test.ts
git commit -m "feat(i18n): public form active-language detection + persistence"
```

---

### Task 11: Language toggle + RTL direction

**Files:**
- Create: `client/src/public/LanguageToggle.tsx`
- Modify: `client/src/public/PublicFormPage.tsx` and/or `client/src/public/screens/ScreenShell.tsx`

**Interfaces:**
- Consumes: `activeLang`, `setActiveLang`, `dir` from the hook; `SUPPORTED_LANGUAGES`/`languageInfo`, `uiStrings`.
- Produces: `<LanguageToggle languages activeLang onChange />`; the public root carries `dir`.

- [ ] **Step 1: Create the toggle component**

```tsx
// client/src/public/LanguageToggle.tsx
import { languageInfo, uiStrings } from '@orlanda/shared';

export function LanguageToggle({
  languages,
  activeLang,
  onChange,
}: {
  languages: string[];
  activeLang: string;
  onChange: (code: string) => void;
}): JSX.Element | null {
  if (languages.length <= 1) return null;
  const label = uiStrings(activeLang).languageLabel;
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {languages.map((code) => {
        const info = languageInfo(code);
        const active = code === activeLang;
        return (
          <button
            key={code}
            type="button"
            onClick={() => onChange(code)}
            aria-pressed={active}
            lang={code}
            className={`rounded px-2 py-1 text-sm ${active ? 'bg-brand-primary text-brand-onPrimary' : 'text-brand-text/70 hover:text-brand-text'}`}
          >
            {info?.nativeName ?? code}
          </button>
        );
      })}
    </div>
  );
}
```
(Use whatever brand CSS-var classes the public form already uses for buttons — match `WelcomeScreen`/`ScreenShell`.)

- [ ] **Step 2: Wire it + `dir` into the page**

In `PublicFormPage.tsx` (or `ScreenShell.tsx`, wherever the outer form container is), set the direction and render the toggle in the header:
```tsx
<div dir={dir} className={/* existing */}>
  {form.languages.length > 1 ? (
    <LanguageToggle languages={form.languages} activeLang={activeLang} onChange={setActiveLang} />
  ) : null}
  {/* existing screens */}
</div>
```
Pull `activeLang`, `setActiveLang`, `dir` from the hook; pass `activeLang` down to the screens (needed in Task 12).

- [ ] **Step 3: Typecheck + build client**

Run: `npm run build:shared && npm run typecheck`
Expected: passes. (No new test here; behavior is covered by Task 12's rendering test and a manual RTL check in Task 13/Phase E.)

- [ ] **Step 4: Commit**

```bash
git add client/src/public/LanguageToggle.tsx client/src/public/PublicFormPage.tsx client/src/public/screens/ScreenShell.tsx
git commit -m "feat(i18n): public language toggle + dir on the form root"
```

---

### Task 12: Localized rendering + canonical option submit

**Files:**
- Modify: `client/src/public/screens/WelcomeScreen.tsx`, `screens/QuestionsScreen.tsx`, `screens/ThankYouScreen.tsx`, `widgets/Field.tsx`, `widgets/QuestionWidget.tsx`, `widgets/AttachmentWidget.tsx`
- Test: `client/src/public/QuestionWidget.test.tsx` (create — jsdom)

**Interfaces:**
- Consumes: `activeLang`, `defaultLang`, `form.translations`, per-question `translations`; `resolveText`, `localizedOptionLabel`, `uiStrings`, `formatUiString`, `ValidationCode`.
- Produces: all builder text renders in `activeLang` with base fallback; option labels are localized but **submitted values are the base option strings**; validation messages localized from codes.

- [ ] **Step 1: Write the failing test (canonical submit + localized label)**

```tsx
// client/src/public/QuestionWidget.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionWidget } from './widgets/QuestionWidget';

it('shows the translated option label but submits the base value', () => {
  const onChange = vi.fn();
  render(
    <QuestionWidget
      question={{ id: 'q1', order: 0, type: 'single_select', label: 'Choose', required: true, options: { options: ['Yes', 'No'] }, translations: { ar: { optionLabels: { Yes: 'نعم', No: 'لا' } } } }}
      value={undefined}
      onChange={onChange}
      activeLang="ar"
      defaultLang="en"
      error={null}
    />,
  );
  fireEvent.click(screen.getByText('نعم')); // Arabic label shown
  expect(onChange).toHaveBeenCalledWith({ type: 'single_select', value: 'Yes' }); // base value submitted
});
```
(Adapt prop names to the widget's real signature; the essential assertions are: the Arabic label renders, and the emitted answer value is the base `'Yes'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace client -- src/public/QuestionWidget.test.tsx`
Expected: FAIL (widget not yet language-aware).

- [ ] **Step 3: Implement across the public renderer**

Thread `activeLang` and `defaultLang` from `PublicFormPage` → screens → widgets (props). Then in each file:

- **Form-level text** (WelcomeScreen: `welcomeText`, `welcomeButtonLabel`; ThankYouScreen: `thankYouText`; privacy notice; page title): render `resolveText(base, activeLang === defaultLang ? undefined : form.translations?.[activeLang]?.<field>)`. Example for the welcome button:
```tsx
const t = activeLang === defaultLang ? undefined : form.translations?.[activeLang];
const buttonLabel = resolveText(form.welcomeButtonLabel, t?.welcomeButtonLabel);
```
- **Question label/help** (`Field.tsx` / `QuestionWidget.tsx`):
```tsx
const qt = activeLang === defaultLang ? undefined : question.translations?.[activeLang];
const label = resolveText(question.label, qt?.label);
const help = resolveText(question.helpText, qt?.helpText);
```
- **Option labels** (select/multi widgets): render `localizedOptionLabel(opt, question.translations, activeLang, defaultLang)` as the visible text, but keep the option **value** as the base `opt` when building the answer. Never submit the translated label.
- **Built-in chrome**: submit button, upload prompts, generic affordances → `uiStrings(activeLang)`. The form's own start button uses the form's `welcomeButtonLabel` (builder content), not `uiStrings.start`.
- **Validation messages**: where the form currently shows `errors[qId]` from `validateAnswers`, prefer the localized message from the code:
```tsx
import { uiStrings, formatUiString } from '@orlanda/shared';
function localizedError(code: ValidationCode | undefined, q: PublicQuestionDTO, lang: string): string | null {
  if (!code) return null;
  const s = uiStrings(lang);
  switch (code) {
    case 'maxLength': return formatUiString(s.maxLength, q.options?.maxLength ?? 0);
    case 'min': return formatUiString(s.min, q.options?.min ?? q.options?.minSelections ?? 0);
    case 'max': return formatUiString(s.max, q.options?.max ?? q.options?.maxSelections ?? 0);
    default: return (s as Record<string, string>)[code] ?? s.invalid;
  }
}
```
Feed it `validateAnswers(...).codes?.[qId]`. Keep the English `errors` string as a fallback if a code is unexpectedly absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace client -- src/public/QuestionWidget.test.tsx`
Expected: PASS. Also `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add client/src/public
git commit -m "feat(i18n): localized public rendering + canonical option submit"
```

---

### Task 13: RTL layout (logical CSS)

**Files:**
- Modify: `client/src/public/public.css`
- Modify: `client/index.html` (optional — public route `dir`)

**Interfaces:**
- Consumes: `dir` on the form root (Task 11).
- Produces: layout mirrors correctly under `dir="rtl"`.

- [ ] **Step 1: Audit and convert physical properties**

In `public.css` (and any inline Tailwind in the public tree that hardcodes side), replace physical left/right with logical:
- `margin-left/right` → `margin-inline-start/end`; `padding-left/right` → `padding-inline-start/end`.
- `text-align: left/right` → `text-align: start/end`.
- `left:/right:` in absolutely-positioned bits → `inset-inline-start/end`.
- Icon/affordance flips: rely on `dir` on the container; avoid `transform` hacks. For Tailwind, prefer logical utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`) over `ml-*`/`text-left` in the public components.

- [ ] **Step 2: Manual verification**

Run the client dev server (`npm run dev:client`), open a public form with `['en','ar']`, toggle to Arabic, and confirm at 375/768/1024 widths: text right-aligned, controls mirrored, no horizontal scroll, focus rings intact. (No automated test — this is a visual step.)

- [ ] **Step 3: Commit**

```bash
git add client/src/public/public.css client/index.html
git commit -m "feat(i18n): right-to-left layout via logical CSS properties"
```

---

## Phase D — Builder

### Task 14: Builder store — i18n state, setters, round-trip

**Files:**
- Modify: `client/src/builder/store.ts`
- Test: `client/src/builder/store.test.ts` (extend the file created earlier)

**Interfaces:**
- Consumes: `FormTranslations`, `QuestionTranslations`, `isSupportedLanguage`.
- Produces: `BuilderFormState.{defaultLang, languages, translations}`, `DraftQuestion.translations`, transient `editingLang`, setters `setEditingLang`, `addLanguage`, `removeLanguage`, `setDefaultLang`, `setTranslatedFormField(lang, field, value)`, `setTranslatedQuestionField(qId, lang, field, value)`, `setOptionLabel(qId, lang, baseOption, value)`; `detailToState`/`toSaveInput` carry the new fields.

- [ ] **Step 1: Write the failing test** (extend `client/src/builder/store.test.ts`)

```ts
it('round-trips languages + translations through toSaveInput', () => {
  const s = useBuilderStore.getState();
  s.reset();
  s.addLanguage('ar');                         // en default + ar
  s.setTranslatedFormField('ar', 'title', 'عنوان');
  const out = useBuilderStore.getState().toSaveInput();
  expect(out.languages).toContain('ar');
  expect(out.defaultLang).toBe('en');
  expect(out.translations?.ar?.title).toBe('عنوان');
});
it('removeLanguage drops its translations', () => {
  const s = useBuilderStore.getState();
  s.reset(); s.addLanguage('ar'); s.setTranslatedFormField('ar', 'title', 'x');
  s.removeLanguage('ar');
  const out = useBuilderStore.getState().toSaveInput();
  expect(out.languages).not.toContain('ar');
  expect(out.translations?.ar).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace client -- src/builder/store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `BuilderFormState`: `defaultLang: string; languages: string[]; translations: FormTranslations;`. Add to `DraftQuestion`: `translations: QuestionTranslations;`. Add transient store field `editingLang: string` (default `'en'`; not sent to server).

`EMPTY_FORM`: `defaultLang: 'en', languages: [], translations: {}`. New questions default `translations: {}`.

`detailToState`: read `detail.defaultLang ?? 'en'`, `detail.languages ?? []`, `detail.translations ?? {}`, and per question `q.translations ?? {}`; set `editingLang` to the default lang.

`toSaveInput`: include
```ts
defaultLang: form.defaultLang,
languages: form.languages,
translations: form.translations,
```
and per question `translations: q.translations`.

Setters (all immutable updates via zustand `set`):
```ts
setEditingLang: (lang) => set((s) => ({ editingLang: lang })),
addLanguage: (lang) => set((s) => {
  if (!isSupportedLanguage(lang)) return {};
  const languages = s.form.languages.length ? s.form.languages : [s.form.defaultLang];
  if (languages.includes(lang)) return {};
  return { form: { ...s.form, languages: [...languages, lang] } };
}),
removeLanguage: (lang) => set((s) => {
  if (lang === s.form.defaultLang) return {}; // cannot remove the default
  const languages = s.form.languages.filter((l) => l !== lang);
  const { [lang]: _drop, ...translations } = s.form.translations;
  const questions = s.questions.map((q) => {
    const { [lang]: _q, ...qt } = q.translations;
    return { ...q, translations: qt };
  });
  return { form: { ...s.form, languages: languages.length <= 1 ? [] : languages, translations }, questions, editingLang: s.editingLang === lang ? s.form.defaultLang : s.editingLang };
}),
setDefaultLang: (lang) => set((s) => {
  const languages = s.form.languages.includes(lang) ? s.form.languages : [...(s.form.languages.length ? s.form.languages : [s.form.defaultLang]), lang];
  return { form: { ...s.form, defaultLang: lang, languages } };
}),
setTranslatedFormField: (lang, field, value) => set((s) => ({
  form: { ...s.form, translations: { ...s.form.translations, [lang]: { ...s.form.translations[lang], [field]: value } } },
})),
setTranslatedQuestionField: (qId, lang, field, value) => set((s) => ({
  questions: s.questions.map((q) => q.id === qId ? { ...q, translations: { ...q.translations, [lang]: { ...q.translations[lang], [field]: value } } } : q),
})),
setOptionLabel: (qId, lang, baseOption, value) => set((s) => ({
  questions: s.questions.map((q) => q.id === qId ? { ...q, translations: { ...q.translations, [lang]: { ...q.translations[lang], optionLabels: { ...q.translations[lang]?.optionLabels, [baseOption]: value } } } } : q),
})),
```
Add the setter signatures to the store's TS interface. Import `FormTranslations`, `QuestionTranslations`, `isSupportedLanguage` from `@orlanda/shared`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace client -- src/builder/store.test.ts`
Expected: PASS. Also `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add client/src/builder/store.ts client/src/builder/store.test.ts
git commit -m "feat(i18n): builder store language state, setters, and round-trip"
```

---

### Task 15: Languages settings section

**Files:**
- Modify: `client/src/builder/panels/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `SUPPORTED_LANGUAGES`, `languageInfo`; store `form.languages`, `form.defaultLang`, `addLanguage`, `removeLanguage`, `setDefaultLang`.
- Produces: a "Languages" section: pick offered languages, choose the default, remove a language (with inline confirm).

- [ ] **Step 1: Implement the section**

Add a `Section title="Languages"` (near the top, after "Public link"). Render the effective offered set `form.languages.length ? form.languages : [form.defaultLang]`:
- A default-language `Select` (options = offered set, `nativeName` labels) bound to `setDefaultLang`.
- An "Add language" `Select` listing `SUPPORTED_LANGUAGES` not already offered → `addLanguage`.
- For each non-default offered language, a chip with a remove button (inline confirm, matching the SubmissionsPage delete pattern) → `removeLanguage`.
- A one-line hint: "Visitors see the form in their browser's language and can switch; untranslated text falls back to the default."

Use existing `ui.tsx` primitives (`Select`, `Button`, `Badge`, `IconButton`, `TrashIcon`). No new test (behavior is store-covered by Task 14; this is presentational wiring). Keep it accessible (labels, `aria-label` on the remove buttons).

- [ ] **Step 2: Typecheck**

Run: `npm run build:shared && npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add client/src/builder/panels/SettingsPanel.tsx
git commit -m "feat(i18n): builder Languages settings section"
```

---

### Task 16: Editing-language switcher + per-language editing + preview

**Files:**
- Create: `client/src/builder/components/LanguageBar.tsx`
- Modify: the builder header (`client/src/builder/FormBuilderPage.tsx`), the question editor(s), the form-content fields in `SettingsPanel.tsx`, and the preview call site.

**Interfaces:**
- Consumes: store `editingLang`, `setEditingLang`, `form.defaultLang`, `form.languages`, and the translated setters from Task 14; `languageInfo`, `languageDir`.
- Produces: a language bar to switch which language is being edited; when `editingLang !== defaultLang`, translatable fields edit that language's translation with base text as placeholder; preview renders `editingLang` + its `dir`.

- [ ] **Step 1: Create the language bar**

```tsx
// client/src/builder/components/LanguageBar.tsx
import { languageInfo } from '@orlanda/shared';
import { useBuilderStore } from '../store';

export function LanguageBar(): JSX.Element | null {
  const form = useBuilderStore((s) => s.form);
  const editingLang = useBuilderStore((s) => s.editingLang);
  const setEditingLang = useBuilderStore((s) => s.setEditingLang);
  const offered = form.languages.length ? form.languages : [form.defaultLang];
  if (offered.length <= 1) return null;
  return (
    <div role="tablist" aria-label="Editing language" className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
      {offered.map((code) => (
        <button
          key={code}
          role="tab"
          aria-selected={editingLang === code}
          type="button"
          onClick={() => setEditingLang(code)}
          className={`rounded px-3 py-1 text-sm font-medium ${editingLang === code ? 'bg-accent text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          {languageInfo(code)?.nativeName ?? code}{code === form.defaultLang ? ' •' : ''}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount the bar** in the builder header (`FormBuilderPage.tsx`) so it shows on the canvas + settings while >1 language is offered.

- [ ] **Step 3: Make translatable fields language-aware**

Introduce a tiny helper the editors use so the pattern is uniform. For a form-level text input (in `SettingsPanel.tsx`, e.g. welcome text):
```tsx
const editingLang = useBuilderStore((s) => s.editingLang);
const isDefault = editingLang === form.defaultLang;
// value + onChange switch between base column and translation:
const value = isDefault ? form.welcomeText ?? '' : form.translations[editingLang]?.welcomeText ?? '';
const onChange = (v: string) =>
  isDefault ? setField('welcomeText', v) : setTranslatedFormField(editingLang, 'welcomeText', v);
// placeholder shows the base text as reference when editing a translation:
const placeholder = isDefault ? undefined : form.welcomeText ?? '';
```
Apply the same pattern to: form `title`, `description`, `welcomeButtonLabel`, `thankYouText`, `privacyNotice`; question `label`, `helpText`; and each option's label (use `setOptionLabel(qId, editingLang, baseOption, v)` with the base option shown as placeholder). When `isDefault`, editing options edits the base `options` array as today; when not default, only the per-option **label** is editable (structure/count is shared and edited in the default language) — render the base options list read-only with a translation input beside each.

- [ ] **Step 4: Preview honors the editing language**

At the preview call site (`PreviewMapping` / the public preview render), pass `editingLang` as the active language and set `dir={languageDir(editingLang)}` on the preview container, reusing the same resolution helpers as the public form.

- [ ] **Step 5: Typecheck + build client**

Run: `npm run build:shared && npm run typecheck && npm run build --workspace client`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add client/src/builder
git commit -m "feat(i18n): per-language builder editing + preview"
```

---

## Phase E — Integration

### Task 17: Full verification + smoke

**Files:** none (verification only).

- [ ] **Step 1: Build + typecheck + full test**

Run:
```bash
npm run build:shared
npm run typecheck
npm test
```
Expected: all workspaces green (shared i18n + answers-codes, server public/service/validation i18n, client public + store i18n).

- [ ] **Step 2: Client build**

Run: `npm run build --workspace client`
Expected: clean tsc + vite build.

- [ ] **Step 3: Manual end-to-end smoke (Docker or dev)**

- Build a form; in Settings → Languages add Arabic; keep English default.
- Use the language bar to switch to Arabic; translate the title, one question label, and its option labels; leave one field untranslated.
- Publish. Open the public link with an Arabic-preferring browser (or set `navigator.languages`): confirm it opens in Arabic, RTL-mirrored, the untranslated field falls back to English, and the toggle switches instantly.
- Submit a response choosing a translated option; open Submissions and confirm the answer/Monday value is the **base** (English) option string, and mapping behaves exactly as before.

- [ ] **Step 4: Commit any final fixups**

```bash
git add -A
git commit -m "chore(i18n): integration fixups after full-suite verification"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** §4 data model → Tasks 1–6; §5 public form → Tasks 7,10–13; §6 builder → Tasks 14–16; §7 validation codes → Task 4 + Task 12 usage; §8 server → Tasks 7–9; §9 testing → per-task tests + Task 17; §11 backward compat → Task 6 (empty `languages`/null `translations`).
- **Type consistency:** `languages` = full offered set incl. default everywhere (DB, DTO, store); `resolveText`/`localizedOptionLabel`/`pickInitialLanguage`/`uiStrings`/`formatUiString`/`ValidationCode` names are used identically across tasks.
- **Placeholders:** none — every code step shows the code; UI-heavy Tasks 13/15/16 give the concrete pattern + exact files (presentational wiring, store-covered by Task 14).
- **Known intentional cross-task typecheck note:** Task 5 may surface the two server DTO-construction sites; Tasks 7–8 resolve them.
