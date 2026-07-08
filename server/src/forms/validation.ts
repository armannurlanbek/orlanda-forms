// Full-form save validation (§17.1) + publish preconditions (§15.3.4).
//
// `validateSaveInput` is a Zod gate for the SaveFormInput body (the questions
// array, per-type option configs, and the directMapping shape). It does NOT
// touch the DB — object existence/auth is handled in the service.
//
// `checkPublishPreconditions` is pure (form + questions in, {ok, errors} out)
// so it can be unit-tested without a DB and reused by the publish endpoint.

import { z } from 'zod';
import type { SaveFormInput } from '@orlanda/shared';
import { QUESTION_TYPES, isSupportedLanguage } from '@orlanda/shared';
import type { Form, Question } from '@prisma/client';
import { badRequest } from '../http/errors';

// ── SaveFormInput zod schema ─────────────────────────────────────────────────

const questionConfigSchema = z
  .object({
    options: z.array(z.string()).optional(),
    minSelections: z.number().int().nonnegative().optional(),
    maxSelections: z.number().int().nonnegative().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    maxLength: z.number().int().nonnegative().optional(),
  })
  .strict()
  .nullable()
  .optional();

// Direct-mode mapping (§12.3): columnId + columnType required, extra per-type
// keys (e.g. countryShortName) allowed through.
const directMappingSchema = z
  .object({
    columnId: z.string().min(1),
    columnType: z.string().min(1),
  })
  .passthrough()
  .nullable()
  .optional();

// Per-question translations (§Task 9), shaped after shared `QuestionTextTranslation`
// (`shared/src/i18n.ts`): keyed by language code, each entry may override the
// question's label/helpText/optionLabels for that language. Without this field
// zod strips `translations` from every question on save (it was previously
// undeclared here), so it NEVER persisted even though the top-level form schema
// declared it — that mismatch is why only form-level translations survived.
const questionTranslationsSchema = z
  .record(
    z.string(),
    z.object({
      label: z.string().nullable().optional(),
      helpText: z.string().nullable().optional(),
      optionLabels: z.record(z.string(), z.string()).optional(),
    }),
  )
  .nullable()
  .optional();

const questionSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: z.enum(QUESTION_TYPES as [string, ...string[]]),
    label: z.string().min(1, 'Question label is required.'),
    helpText: z.string().nullable().optional(),
    required: z.boolean(),
    options: questionConfigSchema,
    translations: questionTranslationsSchema,
    directMapping: directMappingSchema,
  })
  .superRefine((q, ctx) => {
    // Select questions must declare a non-empty options list.
    if (q.type === 'single_select' || q.type === 'multi_select') {
      const opts = q.options?.options ?? [];
      if (opts.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${q.type} question "${q.label}" must define at least one option.`,
          path: ['options', 'options'],
        });
      }
    }
  });

const allowlistColumnSchema = z
  .object({
    columnId: z.string().min(1),
    title: z.string(),
    type: z.string(),
    allowedLabels: z.array(z.string()).optional(),
  })
  .passthrough();

// Theme is validated/normalized via normalizeTheme() in the service so invalid
// colors throw there; here we only accept it as a loose object passthrough.
const saveFormInputSchema = z
  .object({
    title: z.string().min(1, 'Title is required.'),
    slug: z.string().optional(),
    description: z.string().nullable().optional(),
    boardId: z.string().nullable().optional(),
    mappingMode: z.enum(['direct', 'ai']),
    aiPrompt: z.string().nullable().optional(),
    aiAllowedColumns: z.array(allowlistColumnSchema).nullable().optional(),
    welcomeText: z.string().nullable().optional(),
    welcomeButtonLabel: z.string().optional(),
    thankYouText: z.string().nullable().optional(),
    privacyNotice: z.string().nullable().optional(),
    theme: z.unknown().nullable().optional(),
    dailySubmissionCap: z.number().int().positive().optional(),
    // Multilingual forms (display-only — §Task 9): languages is the full
    // offered set INCLUDING defaultLang; empty means single-language.
    defaultLang: z.string().optional(),
    languages: z.array(z.string()).optional(),
    translations: z.record(z.string(), z.record(z.string(), z.string().nullable().optional())).optional(),
    questions: z.array(questionSchema),
  })
  .strict()
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

    // Validate a translations object's language keys against the offered set,
    // for BOTH the form-level `translations` and each question's `translations`.
    // - Single-language form (`languages: []`): no translations allowed at all
    //   (previously silently accepted arbitrary/unsupported keys as dead data).
    // - Multilingual form: every key must be one of the offered languages.
    const checkTranslationKeys = (
      translations: Record<string, unknown> | null | undefined,
      path: (string | number)[],
    ) => {
      const keys = Object.keys(translations ?? {});
      if (keys.length === 0) return;
      if (langs.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: 'Translations are not allowed on a single-language form.',
        });
        return;
      }
      for (const key of keys) {
        if (!langs.includes(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `Translation for a non-offered language: ${key}.`,
          });
        }
      }
    };

    checkTranslationKeys(val.translations, ['translations']);
    val.questions.forEach((q, i) => {
      checkTranslationKeys(q.translations, ['questions', i, 'translations']);
    });
  });

/**
 * Validate + parse a SaveFormInput body. Throws AppError(400) with field-keyed
 * messages on failure (the central error handler surfaces `fields`).
 */
export function validateSaveInput(body: unknown): SaveFormInput {
  const parsed = saveFormInputSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_form';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest('Invalid form data.', fields);
  }
  // The zod output is structurally a SaveFormInput (theme stays unknown until
  // normalizeTheme runs in the service).
  return parsed.data as unknown as SaveFormInput;
}

// ── Publish preconditions (§15.3.4) ──────────────────────────────────────────

export interface PublishCheck {
  ok: boolean;
  errors: string[];
}

/** Does a question carry a structurally-valid Direct mapping? (§12.3) */
function hasValidDirectMapping(q: Pick<Question, 'directMapping'>): boolean {
  const m = q.directMapping;
  if (!m || typeof m !== 'object') return false;
  const v = m as Record<string, unknown>;
  return typeof v.columnId === 'string' && v.columnId.length > 0 &&
    typeof v.columnType === 'string' && v.columnType.length > 0;
}

/** Does a question map to a Monday `file` column? Attachments need this in ANY
 *  mapping mode — the AI never maps files (§12.2), so a file column is the only
 *  way an upload reaches Monday. */
function hasValidFileMapping(q: Pick<Question, 'directMapping'>): boolean {
  const m = q.directMapping;
  if (!m || typeof m !== 'object') return false;
  const v = m as Record<string, unknown>;
  return v.columnType === 'file' && typeof v.columnId === 'string' && v.columnId.length > 0;
}

/**
 * Pure publish-precondition check (§15.3.4):
 *  - boardId is set,
 *  - at least one question exists,
 *  - every attachment question maps to a `file` column (BOTH modes — §12.2),
 *  - direct mode: every REQUIRED non-attachment question has a valid directMapping,
 *  - ai mode: aiPrompt is non-empty.
 */
export function checkPublishPreconditions(
  form: Pick<Form, 'boardId' | 'mappingMode' | 'aiPrompt'>,
  questions: Pick<Question, 'label' | 'required' | 'directMapping' | 'type'>[],
): PublishCheck {
  const errors: string[] = [];

  if (!form.boardId || form.boardId.trim() === '') {
    errors.push('A Monday board must be selected before publishing.');
  }

  if (questions.length === 0) {
    errors.push('Add at least one question before publishing.');
  }

  // Files are uploaded via a deterministic file-column mapping in EVERY mode —
  // the AI never maps files (§12.2). Without a file column an attachment's
  // uploads would be silently dropped, so require one before publishing.
  for (const q of questions) {
    if (q.type === 'attachment' && !hasValidFileMapping(q)) {
      errors.push(`Attachment question "${q.label}" needs a File column so uploads can be saved.`);
    }
  }

  if (form.mappingMode === 'direct') {
    // Attachments are covered by the file-column rule above; don't double-report.
    const unmapped = questions.filter(
      (q) => q.required && q.type !== 'attachment' && !hasValidDirectMapping(q),
    );
    for (const q of unmapped) {
      errors.push(`Required question "${q.label}" needs a column mapping.`);
    }
  } else if (form.mappingMode === 'ai') {
    if (!form.aiPrompt || form.aiPrompt.trim() === '') {
      errors.push('An AI mapping prompt is required before publishing.');
    }
  }

  return { ok: errors.length === 0, errors };
}
