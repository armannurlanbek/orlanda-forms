import { describe, expect, it } from 'vitest';
import type { Form, Question } from '@prisma/client';
import { AppError } from '../http/errors';
import { checkPublishPreconditions, validateSaveInput } from './validation';

// Minimal valid SaveFormInput body.
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'My Form',
    mappingMode: 'direct',
    questions: [
      { type: 'text', label: 'Name', required: true },
    ],
    ...overrides,
  };
}

describe('validateSaveInput', () => {
  it('accepts a minimal valid body', () => {
    const out = validateSaveInput(validBody());
    expect(out.title).toBe('My Form');
    expect(out.questions).toHaveLength(1);
  });

  it('rejects a missing title with a field error', () => {
    try {
      validateSaveInput(validBody({ title: '' }));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(400);
      expect((err as AppError).fields?.title).toBeTruthy();
    }
  });

  it('rejects an unknown top-level field (strict)', () => {
    expect(() => validateSaveInput(validBody({ surprise: 1 }))).toThrow(AppError);
  });

  it('rejects an invalid question type', () => {
    expect(() =>
      validateSaveInput(validBody({ questions: [{ type: 'rating', label: 'X', required: false }] })),
    ).toThrow(AppError);
  });

  it('requires options on select questions', () => {
    try {
      validateSaveInput(
        validBody({ questions: [{ type: 'single_select', label: 'Pick', required: false }] }),
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(Object.keys((err as AppError).fields ?? {}).length).toBeGreaterThan(0);
    }
  });

  it('accepts select questions with options', () => {
    const out = validateSaveInput(
      validBody({
        questions: [
          { type: 'single_select', label: 'Pick', required: false, options: { options: ['A', 'B'] } },
        ],
      }),
    );
    expect(out.questions[0].options?.options).toEqual(['A', 'B']);
  });

  it('accepts a directMapping with extra per-type keys', () => {
    const out = validateSaveInput(
      validBody({
        questions: [
          {
            type: 'text',
            label: 'Phone',
            required: false,
            directMapping: { columnId: 'phone', columnType: 'phone', countryShortName: 'US' },
          },
        ],
      }),
    );
    expect(out.questions[0].directMapping?.columnId).toBe('phone');
  });
});

// ── Language set (Task 9 — multilingual forms) ───────────────────────────────
describe('validateSaveInput — language set', () => {
  it('rejects an unsupported language code', () => {
    expect(() =>
      validateSaveInput(validBody({ defaultLang: 'en', languages: ['en', 'zz'] })),
    ).toThrow(AppError);
  });

  it('rejects when defaultLang is not in a non-empty languages set', () => {
    expect(() =>
      validateSaveInput(validBody({ defaultLang: 'ar', languages: ['en', 'ru'] })),
    ).toThrow(AppError);
  });

  it('rejects a translation keyed for a language not in the offered set', () => {
    expect(() =>
      validateSaveInput(
        validBody({
          defaultLang: 'en',
          languages: ['en', 'ru'],
          translations: { ar: { title: 'x' } },
        }),
      ),
    ).toThrow(AppError);
  });

  it('rejects a duplicate language in the offered set', () => {
    expect(() =>
      validateSaveInput(validBody({ defaultLang: 'en', languages: ['en', 'en'] })),
    ).toThrow(AppError);
  });

  it('accepts a valid multilingual set', () => {
    const out = validateSaveInput(
      validBody({
        defaultLang: 'en',
        languages: ['en', 'ar'],
        translations: { ar: { title: 'x' } },
      }),
    );
    expect(out.defaultLang).toBe('en');
    expect(out.languages).toEqual(['en', 'ar']);
    expect(out.translations).toEqual({ ar: { title: 'x' } });
  });

  it('accepts a single-language form (empty languages)', () => {
    const out = validateSaveInput(validBody({ defaultLang: 'en', languages: [] }));
    expect(out.languages).toEqual([]);
  });

  it('accepts an omitted language set entirely (defaults applied downstream)', () => {
    const out = validateSaveInput(validBody({}));
    expect(out.defaultLang).toBeUndefined();
    expect(out.languages).toBeUndefined();
  });

  // Regression lock: `questionSchema` previously had no `translations` field
  // and wasn't `.passthrough()`, so zod silently stripped
  // `questions[i].translations` on every save — question label/helpText/
  // optionLabels translations never persisted (form-level translations
  // survived only because the top-level schema declared the field, masking
  // the bug). This must parse successfully AND the parsed output must still
  // carry the question's translations through untouched.
  it('parses and preserves per-question translations (previously stripped by zod)', () => {
    const out = validateSaveInput(
      validBody({
        defaultLang: 'en',
        languages: ['en', 'ar'],
        questions: [
          {
            type: 'text',
            label: 'Name',
            required: true,
            translations: { ar: { label: 'الاسم', optionLabels: { Yes: 'نعم' } } },
          },
        ],
      }),
    );
    expect(out.questions[0].translations?.ar?.label).toBe('الاسم');
    expect(out.questions[0].translations?.ar?.optionLabels).toEqual({ Yes: 'نعم' });
  });

  it('rejects a question translation keyed for a language not in the offered set', () => {
    expect(() =>
      validateSaveInput(
        validBody({
          defaultLang: 'en',
          languages: ['en', 'ar'],
          questions: [
            {
              type: 'text',
              label: 'Name',
              required: true,
              translations: { zz: { label: 'Nom' } },
            },
          ],
        }),
      ),
    ).toThrow(AppError);
  });

  it('rejects any form-level translations on a single-language form', () => {
    expect(() =>
      validateSaveInput(
        validBody({ defaultLang: 'en', languages: [], translations: { ar: { title: 'x' } } }),
      ),
    ).toThrow(AppError);
  });

  it('rejects any question-level translations on a single-language form', () => {
    expect(() =>
      validateSaveInput(
        validBody({
          defaultLang: 'en',
          languages: [],
          questions: [
            { type: 'text', label: 'Name', required: true, translations: { ar: { label: 'x' } } },
          ],
        }),
      ),
    ).toThrow(AppError);
  });
});

// ── checkPublishPreconditions ─────────────────────────────────────────────────

function form(overrides: Partial<Form> = {}): Pick<Form, 'boardId' | 'mappingMode' | 'aiPrompt'> {
  return {
    boardId: 'board-1',
    mappingMode: 'direct',
    aiPrompt: null,
    ...overrides,
  } as Pick<Form, 'boardId' | 'mappingMode' | 'aiPrompt'>;
}

function question(
  overrides: Partial<Question> = {},
): Pick<Question, 'label' | 'required' | 'directMapping' | 'type'> {
  return {
    label: 'Q',
    type: 'text',
    required: false,
    directMapping: null,
    ...overrides,
  } as Pick<Question, 'label' | 'required' | 'directMapping' | 'type'>;
}

describe('checkPublishPreconditions', () => {
  it('passes a fully-mapped direct form', () => {
    const res = checkPublishPreconditions(form(), [
      question({ required: true, directMapping: { columnId: 'c1', columnType: 'text' } }),
    ]);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('fails when no board is selected', () => {
    const res = checkPublishPreconditions(form({ boardId: null }), [question()]);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /board/i.test(e))).toBe(true);
  });

  it('fails with no questions', () => {
    const res = checkPublishPreconditions(form(), []);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /question/i.test(e))).toBe(true);
  });

  it('fails when a required direct question lacks a mapping', () => {
    const res = checkPublishPreconditions(form(), [
      question({ label: 'Name', required: true, directMapping: null }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /Name/.test(e))).toBe(true);
  });

  it('ignores optional questions without a mapping in direct mode', () => {
    const res = checkPublishPreconditions(form(), [
      question({ required: false, directMapping: null }),
      question({ required: true, directMapping: { columnId: 'c1', columnType: 'text' } }),
    ]);
    expect(res.ok).toBe(true);
  });

  it('treats a partial directMapping (missing columnType) as unmapped', () => {
    const res = checkPublishPreconditions(form(), [
      question({ required: true, directMapping: { columnId: 'c1' } as unknown as Question['directMapping'] }),
    ]);
    expect(res.ok).toBe(false);
  });

  it('ai mode requires a non-empty aiPrompt', () => {
    const empty = checkPublishPreconditions(form({ mappingMode: 'ai', aiPrompt: '   ' }), [question()]);
    expect(empty.ok).toBe(false);
    expect(empty.errors.some((e) => /prompt/i.test(e))).toBe(true);

    const good = checkPublishPreconditions(
      form({ mappingMode: 'ai', aiPrompt: 'Map answers to columns.' }),
      [question({ required: true, directMapping: null })], // mapping not needed in ai mode
    );
    expect(good.ok).toBe(true);
  });

  it('ai mode requires a file column for attachment questions (AI never maps files)', () => {
    const res = checkPublishPreconditions(
      form({ mappingMode: 'ai', aiPrompt: 'Map answers to columns.' }),
      [question({ label: 'Photos', type: 'attachment', directMapping: null })],
    );
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /Photos/.test(e) && /file/i.test(e))).toBe(true);
  });

  it('ai mode passes when attachment questions have a file column mapped', () => {
    const res = checkPublishPreconditions(
      form({ mappingMode: 'ai', aiPrompt: 'Map answers to columns.' }),
      [
        question({ required: true, directMapping: null }), // AI-mapped, fine
        question({
          label: 'Photos',
          type: 'attachment',
          directMapping: { columnId: 'files_1', columnType: 'file' },
        }),
      ],
    );
    expect(res.ok).toBe(true);
  });

  it('direct mode also requires attachment questions to map a file column', () => {
    const res = checkPublishPreconditions(form(), [
      question({ label: 'Photos', type: 'attachment', required: false, directMapping: null }),
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /Photos/.test(e) && /file/i.test(e))).toBe(true);
  });
});
