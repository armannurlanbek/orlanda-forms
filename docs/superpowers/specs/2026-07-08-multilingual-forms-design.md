# Multilingual Forms — Design Spec

**Date:** 2026-07-08
**Status:** Approved (brainstorming) — ready for implementation plan
**Feature:** One form, multiple language versions. The public form auto-detects the
visitor's browser language and offers a language toggle; staff enter each language's
text manually in the builder. Right-to-left (Arabic/Hebrew) is supported.

## 1. Goal & scope

A builder creates **one** form and provides its text in several languages. A public
visitor sees the form in the best language for their browser, and can switch language
instantly with a toggle. The **answers, mapping, and Monday output are unaffected by
the visitor's language** — they always use the form's base (default) language values.

**In scope:** per-form curated language set with a default; manual per-language text
entry in the builder; browser-language auto-detection + instant client-side toggle on
the public form; per-field fallback to the default language; right-to-left layout for
RTL languages; localized built-in UI chrome and client-side validation messages.

**Out of scope (YAGNI):** AI auto-translation (staff enter text manually); per-language
links/slugs (one link + toggle instead); translating free-text answers or Monday board
content; localizing the authenticated builder chrome itself (only the *form content*
being edited is multilingual).

## 2. Core decision — translations are display-only

Options are stored as `string[]` and a submitted select answer **is** that string;
the FROZEN `validateAnswers` (`shared/src/answers.ts`) checks `opts.includes(value)`.
Therefore:

- The **base (default) language is the canonical data.** `Question.options`, the
  submitted answer values, and everything downstream stay in the base language.
- Translations only change **what the visitor sees**. Selecting a translated option
  submits the **base** option string.
- Consequence: **Monday always receives base-language values**, regardless of the
  visitor's language. Free-text answers pass through as typed.
- `validateAnswers`, `mapping/orchestrator.ts`, Direct mode, AI mode, the submission
  pipeline, and the internal `SubmissionRow` DTO are **unchanged**.

This is the load-bearing decision: i18n is confined to the presentation layer plus a
small, additive validation-message change.

## 3. Chosen approach (A of 3)

**A — Store translations as JSON on the existing Form/Question rows; ship all
languages in the public DTO; toggle client-side.** (Selected.)
- Minimal schema (a few columns), instant toggle with no refetch, frozen contracts
  untouched, and it matches how `theme`/`options` are already stored as JSON.

Rejected: **B — normalized translation tables** (extra joins/save complexity with no
payoff, since forms load wholesale); **C — server resolves one `?lang=` per request**
(toggle needs a refetch/flicker and still needs the storage model).

## 4. Data model

### 4.1 Shared contract (`shared/src`)

New module `shared/src/i18n.ts` (exported from the package index):

```ts
export type LanguageDir = 'ltr' | 'rtl';
export interface LanguageInfo {
  code: string;        // ISO 639-1, lowercase, e.g. 'en', 'ru', 'ar', 'he'
  name: string;        // English name, e.g. 'Arabic'
  nativeName: string;  // endonym, e.g. 'العربية'
  dir: LanguageDir;
}

// Curated registry — the single source of truth for the builder picker, browser
// detection, and RTL direction. Seed with (at least): en, ru, ar, he, kk, uk, tr,
// de, fr, es. English is the ultimate fallback.
export const SUPPORTED_LANGUAGES: readonly LanguageInfo[];
export const DEFAULT_APP_LANGUAGE = 'en';

export function languageInfo(code: string): LanguageInfo | undefined;
export function isSupportedLanguage(code: string): boolean;

/** Best initial language: first navigator lang (by primary subtag, so 'ar-EG'→'ar')
 *  that is in `supported`; else `defaultLang`. Pure + tested. */
export function pickInitialLanguage(
  supported: readonly string[],
  navigatorLangs: readonly string[],
  defaultLang: string,
): string;
```

Translation shapes (also in `shared`, e.g. `shared/src/i18n.ts` or `dto.ts`):

```ts
export interface FormTextTranslation {
  title?: string;
  description?: string;
  welcomeText?: string;
  welcomeButtonLabel?: string;
  thankYouText?: string;
  privacyNotice?: string;
}
export type FormTranslations = Record<string /*lang*/, FormTextTranslation>;

export interface QuestionTextTranslation {
  label?: string;
  helpText?: string;
  /** base option string -> shown label in this language. Keys MUST be existing
   *  base options; unknown keys are ignored on render. */
  optionLabels?: Record<string, string>;
}
export type QuestionTranslations = Record<string /*lang*/, QuestionTextTranslation>;
```

Resolution helpers (pure, tested), used by the public renderer and builder preview:

```ts
// Returns the effective text for a field, falling back to the base value when the
// language has no translation for it (so half-translated forms still render).
export function localizedFormText(base, translations, lang): ResolvedFormText;
export function localizedQuestionText(baseQ, translations, lang): ResolvedQuestionText;
export function localizedOptionLabel(baseOption, translations, lang): string;
```

Built-in UI strings (fixed public-form chrome + standard validation messages):

```ts
export interface UiStrings {
  submit: string; back: string; next: string; languageLabel: string;
  fileUploadPrompt: string; /* ...upload limit strings... */
  // standard validation messages, keyed to validation error codes (see §7):
  required: string; chooseOption: string; chooseAtLeastOne: string;
  invalidOption: string; mustBeNumber: string; min: string; max: string;
  maxLength: string; uploadRequired: string; /* ... */
}
export const UI_STRINGS: Record<string /*lang*/, UiStrings>; // en, ru, ar, he seeded
export function uiStrings(lang: string): UiStrings; // falls back to English
```

`UI_STRINGS` must cover every language in `SUPPORTED_LANGUAGES`; a language without a
dictionary uses English chrome (acceptable, but seed en/ru/ar/he at minimum).

### 4.2 Prisma (`prisma/schema.prisma`)

```prisma
model Form {
  // ...existing...
  defaultLang  String  @default("en")   // base language of title/options/etc.
  languages    String[] @default([])    // full offered set INCLUDING defaultLang;
                                         // empty => single-language (just the default)
  translations Json?                     // FormTranslations (non-default langs only)
}

model Question {
  // ...existing...
  translations Json?                     // QuestionTranslations (non-default langs)
}
```

Notes:
- `languages` is the **full offered set, including `defaultLang`** (e.g.
  `['en','ar']`). The effective set = `languages.length ? languages : [defaultLang]`.
  Empty `languages` ⇒ single-language (just the default), no toggle. Invariant: when
  non-empty, `defaultLang ∈ languages`. Existing forms are correct with **no backfill**
  (`translations` null, `languages` empty ⇒ behaves exactly as today; `defaultLang`
  defaults to `en`).
- Migration: `prisma migrate dev` adds the columns; container entrypoint runs
  `prisma migrate deploy` as usual. No data backfill required.
- `String[]` uses Postgres scalar lists (already Postgres-only). If a Prisma default of
  a non-empty array is awkward, keep `@default([])` and treat empty as single-language.

## 5. Public form

### 5.1 DTO changes (`shared/src/dto.ts`)

`PublicFormDTO` gains (all render-safe — public text only, upholds §16.6):
```ts
languages: string[];        // offered set incl. default (>=1 entry), display order
defaultLang: string;
translations: FormTranslations;
```
`PublicQuestionDTO` gains:
```ts
translations?: QuestionTranslations;
```

### 5.2 DTO assembly (`server/src/public/routes.ts`)

Extend the existing mapper (~L38–L68): copy `form.defaultLang`, compute
`languages = form.languages.length ? form.languages : [form.defaultLang]`, pass
`form.translations` (parsed, defaulting to `{}`), and per question pass
`q.translations`. No other server logic changes. Translations are already public
content, so no new redaction concerns.

### 5.3 Behavior (`client/src/public/`)

- **State (`usePublicForm.ts`):** add `activeLang`. Initial value =
  `pickInitialLanguage(languages, navigator.languages, defaultLang)` (`languages`
  already includes the default), overridden by a remembered choice in `localStorage`
  (key per slug). A toggle setter updates `activeLang` and persists it. **No refetch**
  — all languages are in the DTO.
- **Rendering:** every builder-defined string is resolved through `localizedFormText`
  / `localizedQuestionText` / `localizedOptionLabel` for `activeLang`, falling back to
  base. Applies in `WelcomeScreen`, `QuestionsScreen`, `ThankYouScreen`, `Field`,
  `QuestionWidget`, `AttachmentWidget`.
- **Toggle UI:** a compact language switcher (segmented control or dropdown) shown
  only when `languages.length > 1`. Uses `nativeName`.
  Placed in `ScreenShell`/header so it persists across screens. Accessible
  (`aria-label` from `uiStrings(activeLang).languageLabel`, keyboard-operable).
- **RTL:** set `dir={languageInfo(activeLang).dir}` on the public form root; audit
  `public.css` for physical-direction rules and convert to logical properties
  (`margin-inline`, `padding-inline-start`, `text-align: start`, etc.) so layout
  mirrors for `rtl`. The `<html lang>`/`dir` may also be set for the public route.
- **Built-in chrome** (submit button, upload prompts, the toggle label, screen
  affordances): from `uiStrings(activeLang)`. The form's own `welcomeButtonLabel` is
  builder content (translated via the form translations), distinct from the generic
  `submit`.
- **Canonical submit (critical):** selecting a translated option stores/submits the
  **base** option string. The widget renders `localizedOptionLabel(baseOption, …)` but
  its value remains `baseOption`. `submit.ts` sends base values; `validateAnswers`
  passes unchanged.

## 6. Builder

### 6.1 Languages section (`client/src/builder/panels/SettingsPanel.tsx`)

New "Languages" section:
- Multi-select of `SUPPORTED_LANGUAGES` (chips showing `nativeName`), representing the
  offered set.
- A **default language** selector (must be one of the selected; determines which text
  the base columns hold). Changing the default is allowed but warns that base text is
  interpreted as the new default language (no automatic content move).
- Removing a language deletes its translations from `translations` / each question's
  `translations` (inline confirm), consistent with existing destructive-action UX.

### 6.2 Per-language editing

- New builder UI state `editingLang` (default = `defaultLang`; **not persisted** to the
  form). A language switcher (segmented control) in the builder header, shown when >1
  language is offered.
- When `editingLang === defaultLang`: fields edit the base columns exactly as today.
- When `editingLang !== defaultLang`: every translatable field edits
  `translations[editingLang]` (form-level) or `question.translations[editingLang]`
  (label/help/`optionLabels`). The base value is shown as placeholder/subtext for
  reference. Question structure, types, options, and mapping are shared and edited only
  in the default language.
- **Preview** (`PreviewMapping` / public preview) renders with `editingLang` and its
  `dir` so RTL/translation are verifiable before publish.

### 6.3 Store (`client/src/builder/store.ts`)

- `BuilderFormState` gains `defaultLang: string`, `languages: string[]`,
  `translations: FormTranslations`. `DraftQuestion` gains `translations:
  QuestionTranslations`.
- `detailToState` reads them from `FormDetail`; `toSaveInput` sends them in
  `SaveFormInput`. Add language-aware setters (e.g. `setTranslatedFormField(lang,
  field, value)`, `setTranslatedQuestionField(qId, lang, field, value)`,
  `setOptionLabel(qId, lang, baseOption, value)`) and `addLanguage/removeLanguage/
  setDefaultLang`. `editingLang` lives in the store as transient UI state.

### 6.4 Builder DTO (`shared/src/dto.ts`)

`FormDetail` and `SaveFormInput` gain `defaultLang`, `languages`, `translations`;
`QuestionInput` gains `translations`.

## 7. Localized validation messages (additive, frozen-safe)

`validateAnswers` currently returns English `errors` strings. To localize client-side
without reshaping the frozen contract, **extend** `ValidationResult` (allowed:
"extend, don't reshape"):

```ts
export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;         // unchanged (English) — server gate
  codes?: Record<string, ValidationCode>; // NEW: stable per-question error code
  normalized: AnswersMap;
}
export type ValidationCode =
  | 'required' | 'chooseOption' | 'chooseAtLeastOne' | 'invalidOption'
  | 'mustBeNumber' | 'min' | 'max' | 'maxLength' | 'duplicate' | 'uploadRequired'
  | 'invalid';
```

`validateAnswers` sets `codes[qId]` alongside each `errors[qId]` (same branches, no
behavior change; `codes` is purely additive). The public form maps `codes` →
`uiStrings(activeLang)` for display (with interpolation for min/max/maxLength). The
server continues to use `errors`/`ok` exactly as before. Codes carrying a numeric
bound (min/max/maxLength) also need the value — include it via message interpolation
(the client has `q.options`).

## 8. Server changes

- `server/src/public/routes.ts`: extend DTO assembly (§5.2).
- `server/src/forms/service.ts`: `toFormDetail` returns `defaultLang`, `languages`,
  `translations`; the public DTO builder returns the new fields; `saveForm` persists
  them.
- `server/src/forms/validation.ts` (`saveFormInputSchema`): validate that
  `defaultLang` and every entry of `languages` are supported codes; when `languages`
  is non-empty, `defaultLang ∈ languages` and entries are unique; `translations` keys ⊆
  offered languages (the non-default ones); `optionLabels` keys need not be validated
  against options (unknown keys ignored on render). Reject unsupported language codes
  with a field error.
- **Unchanged:** mapping orchestrator, Direct/AI engines, submission pipeline, worker,
  `SubmissionRow`, Monday integration.

## 9. Testing

- **shared:** `pickInitialLanguage` (primary-subtag match, fallback); `languageInfo`/
  `isSupportedLanguage`; `localizedFormText`/`localizedQuestionText`/
  `localizedOptionLabel` fallback behavior; `SUPPORTED_LANGUAGES` integrity (unique
  codes, every code has `UI_STRINGS` or documented English fallback, valid `dir`);
  `validateAnswers` now also returns correct `codes` for each error branch, and base
  option values still validate (regression).
- **server:** `saveForm` round-trips `defaultLang`/`languages`/`translations` (form +
  question); public DTO exposes them and `languages` includes the default first;
  unsupported language code → 400; a translated form still validates answers with base
  option values.
- **client:** toggle switches text and `dir`; auto-detect picks the correct initial
  language from a mocked `navigator.languages`; selecting a translated option submits
  the **base** value; a missing translation falls back to base; store round-trips
  translations through `toSaveInput`.

## 10. Implementation phases (for the plan)

1. **shared contract** — `i18n.ts` (registry, detection, resolution, `UI_STRINGS`),
   translation types, DTO fields, `ValidationResult.codes` + `validateAnswers` codes;
   `npm run build:shared`; shared tests.
2. **DB + server** — Prisma migration (Form/Question columns), DTO assembly (public +
   builder), `saveForm` persistence, `saveFormInputSchema` validation; server tests.
3. **public form** — `activeLang` state + detection + localStorage, toggle UI, RTL
   (`dir` + logical CSS), localized chrome + validation, canonical option submit;
   client tests.
4. **builder** — Languages settings section, `editingLang` switcher, per-language
   field editing + preview, store setters/DTO; client tests.
5. **polish** — a11y + keyboard for the toggles, RTL visual sweep at 375/768/1024,
   `prefers-reduced-motion` intact, quick end-to-end smoke (build a 2-language RTL
   form → publish → detect + toggle + submit → Monday gets base values).

## 11. Backward compatibility

Existing forms: `translations` null, `languages` empty, `defaultLang` `"en"` ⇒ single
language, no toggle, identical rendering and submission. No data migration/backfill
needed. The public toggle and builder language UI appear only once a second language
is added.
