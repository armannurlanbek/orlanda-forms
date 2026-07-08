import { describe, it, expect, vi, beforeEach } from 'vitest';

// The authenticated submissions-list endpoint must confirm the form exists (and
// is not soft-deleted) BEFORE returning any submissions, so a missing form gives
// a consistent 404 (§16.5: 404, never 403) rather than an empty list. We mock
// prisma so this is a pure-logic check with no DB.
const {
  formFindFirstMock,
  submissionFindManyMock,
  questionFindManyMock,
  transactionMock,
  txFormUpdateMock,
  txQuestionDeleteManyMock,
  txQuestionUpdateMock,
  txQuestionCreateMock,
  validateSaveInputMock,
} = vi.hoisted(() => ({
  formFindFirstMock: vi.fn(),
  submissionFindManyMock: vi.fn(),
  questionFindManyMock: vi.fn(),
  transactionMock: vi.fn(),
  txFormUpdateMock: vi.fn(),
  txQuestionDeleteManyMock: vi.fn(),
  txQuestionUpdateMock: vi.fn(),
  txQuestionCreateMock: vi.fn(),
  validateSaveInputMock: vi.fn(),
}));

vi.mock('../db/prisma', () => ({
  prisma: {
    form: { findFirst: formFindFirstMock },
    submission: { findMany: submissionFindManyMock },
    question: { findMany: questionFindManyMock },
    $transaction: transactionMock,
  },
}));

// saveForm's own zod gate (validateSaveInput) is Task 9's concern — it is
// exercised directly in validation.test.ts. Here we bypass it with a passthrough
// so this file can test saveForm's PERSISTENCE of the i18n fields in isolation.
vi.mock('./validation', () => ({
  validateSaveInput: validateSaveInputMock,
  checkPublishPreconditions: vi.fn(),
}));

import { getFormDetail, saveForm } from './service';
import { listSubmissions } from './service';
import { AppError } from '../http/errors';

describe('listSubmissions — form-existence gate (§16.5)', () => {
  beforeEach(() => {
    formFindFirstMock.mockReset();
    submissionFindManyMock.mockReset();
  });

  it('throws 404 for a missing/soft-deleted form before querying submissions', async () => {
    formFindFirstMock.mockResolvedValue(null); // missing or deletedAt != null

    await expect(listSubmissions('missing-id')).rejects.toBeInstanceOf(AppError);
    await expect(listSubmissions('missing-id')).rejects.toMatchObject({ status: 404 });

    // The form lookup excludes soft-deleted rows...
    expect(formFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'missing-id', deletedAt: null },
    });
    // ...and the submissions query must never run for a missing form.
    expect(submissionFindManyMock).not.toHaveBeenCalled();
  });

  it('lists submissions only after confirming the form exists', async () => {
    formFindFirstMock.mockResolvedValue({ id: 'f1', boardId: null });
    submissionFindManyMock.mockResolvedValue([]);

    const rows = await listSubmissions('f1');

    expect(rows).toEqual([]);
    expect(formFindFirstMock).toHaveBeenCalledWith({ where: { id: 'f1', deletedAt: null } });
    expect(submissionFindManyMock).toHaveBeenCalledTimes(1);
  });
});

// ── getFormDetail — i18n round-trip (Task 8) ─────────────────────────────────
// toFormDetail must surface defaultLang/languages/translations (form + per
// question) exactly as stored — the DTO fields added in Phase A are useless
// unless the builder read path actually returns them.
describe('getFormDetail — i18n fields', () => {
  beforeEach(() => {
    formFindFirstMock.mockReset();
    questionFindManyMock.mockReset();
  });

  it('returns defaultLang, languages, and translations for the form and its questions', async () => {
    formFindFirstMock.mockResolvedValue({
      id: 'f1',
      slug: 'my-form',
      title: 'My Form',
      description: null,
      status: 'draft',
      boardId: null,
      mappingMode: 'direct',
      aiPrompt: null,
      aiAllowedColumns: null,
      welcomeText: null,
      welcomeButtonLabel: 'Start',
      thankYouText: null,
      privacyNotice: null,
      theme: null,
      dailySubmissionCap: 200,
      defaultLang: 'en',
      languages: ['en', 'ar'],
      translations: { ar: { title: 'عنوان' } },
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
    questionFindManyMock.mockResolvedValue([
      {
        id: 'q1',
        formId: 'f1',
        order: 0,
        type: 'text',
        label: 'Name',
        helpText: null,
        required: true,
        options: null,
        directMapping: null,
        translations: { ar: { label: 'الاسم' } },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);

    const detail = await getFormDetail('f1');

    expect(detail.defaultLang).toBe('en');
    expect(detail.languages).toEqual(['en', 'ar']);
    expect(detail.translations).toEqual({ ar: { title: 'عنوان' } });
    expect(detail.questions[0].translations).toEqual({ ar: { label: 'الاسم' } });
  });

  it('surfaces a null translations column as null (not undefined-crashing)', async () => {
    formFindFirstMock.mockResolvedValue({
      id: 'f2',
      slug: 'single-lang',
      title: 'Single Lang',
      description: null,
      status: 'draft',
      boardId: null,
      mappingMode: 'direct',
      aiPrompt: null,
      aiAllowedColumns: null,
      welcomeText: null,
      welcomeButtonLabel: 'Start',
      thankYouText: null,
      privacyNotice: null,
      theme: null,
      dailySubmissionCap: 200,
      defaultLang: 'en',
      languages: [],
      translations: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
    questionFindManyMock.mockResolvedValue([]);

    const detail = await getFormDetail('f2');

    expect(detail.languages).toEqual([]);
    expect(detail.translations).toBeNull();
  });
});

// ── saveForm — i18n persistence (Task 8) ─────────────────────────────────────
// validateSaveInput itself is Task 9's concern (validation.test.ts); here we
// bypass it with a passthrough so we can assert saveForm's Prisma writes carry
// the incoming defaultLang/languages/translations through to the transaction.
describe('saveForm — i18n persistence', () => {
  beforeEach(() => {
    formFindFirstMock.mockReset();
    questionFindManyMock.mockReset();
    transactionMock.mockReset();
    txFormUpdateMock.mockReset();
    txQuestionDeleteManyMock.mockReset();
    txQuestionUpdateMock.mockReset();
    txQuestionCreateMock.mockReset();
    validateSaveInputMock.mockReset();

    // getLiveFormOrThrow is called twice (once at the top of saveForm, once
    // again inside the getFormDetail() re-read at the end).
    formFindFirstMock.mockResolvedValue({
      id: 'f1',
      slug: 'my-form',
      title: 'My Form',
      description: null,
      status: 'draft',
      boardId: null,
      mappingMode: 'direct',
      aiPrompt: null,
      aiAllowedColumns: null,
      welcomeText: null,
      welcomeButtonLabel: 'Start',
      thankYouText: null,
      privacyNotice: null,
      theme: null,
      dailySubmissionCap: 200,
      defaultLang: 'en',
      languages: ['en', 'ar'],
      translations: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<void>) =>
      cb({
        form: { update: txFormUpdateMock },
        question: {
          deleteMany: txQuestionDeleteManyMock,
          update: txQuestionUpdateMock,
          create: txQuestionCreateMock,
        },
      }),
    );
  });

  it('persists defaultLang, languages, and translations on the form update', async () => {
    // No existing questions to delete/keep for this case.
    questionFindManyMock.mockResolvedValueOnce([]); // existing-ids check in saveForm
    questionFindManyMock.mockResolvedValueOnce([]); // getFormDetail re-read

    validateSaveInputMock.mockReturnValue({
      title: 'My Form',
      mappingMode: 'direct',
      defaultLang: 'en',
      languages: ['en', 'ar'],
      translations: { ar: { title: 'عنوان' } },
      questions: [],
    });

    await saveForm('f1', {});

    expect(txFormUpdateMock).toHaveBeenCalledTimes(1);
    const call = txFormUpdateMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.defaultLang).toBe('en');
    expect(call.data.languages).toEqual(['en', 'ar']);
    expect(call.data.translations).toEqual({ ar: { title: 'عنوان' } });
  });

  it('defaults defaultLang to "en" and languages to [] when omitted', async () => {
    questionFindManyMock.mockResolvedValueOnce([]);
    questionFindManyMock.mockResolvedValueOnce([]);

    validateSaveInputMock.mockReturnValue({
      title: 'My Form',
      mappingMode: 'direct',
      questions: [],
    });

    await saveForm('f1', {});

    const call = txFormUpdateMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.defaultLang).toBe('en');
    expect(call.data.languages).toEqual([]);
  });

  it('persists per-question translations on create', async () => {
    questionFindManyMock.mockResolvedValueOnce([]); // no existing questions
    questionFindManyMock.mockResolvedValueOnce([]); // getFormDetail re-read

    validateSaveInputMock.mockReturnValue({
      title: 'My Form',
      mappingMode: 'direct',
      questions: [
        {
          type: 'text',
          label: 'Name',
          required: true,
          translations: { ar: { label: 'الاسم' } },
        },
      ],
    });

    await saveForm('f1', {});

    expect(txQuestionCreateMock).toHaveBeenCalledTimes(1);
    const call = txQuestionCreateMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.translations).toEqual({ ar: { label: 'الاسم' } });
  });

  it('persists per-question translations on update', async () => {
    questionFindManyMock.mockResolvedValueOnce([{ id: 'q1' }]); // existing question
    questionFindManyMock.mockResolvedValueOnce([]); // getFormDetail re-read

    validateSaveInputMock.mockReturnValue({
      title: 'My Form',
      mappingMode: 'direct',
      questions: [
        {
          id: 'q1',
          type: 'text',
          label: 'Name',
          required: true,
          translations: { ar: { label: 'الاسم المحدث' } },
        },
      ],
    });

    await saveForm('f1', {});

    expect(txQuestionUpdateMock).toHaveBeenCalledTimes(1);
    const call = txQuestionUpdateMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.translations).toEqual({ ar: { label: 'الاسم المحدث' } });
  });
});
