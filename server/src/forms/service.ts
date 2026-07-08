// Forms service (§9/§15/§17.1/§18.9). Owns all Prisma access + DTO shaping for
// the builder forms API so the route handlers stay thin. Builders are org-wide
// trusted (§16.5): any authenticated builder may act on any form; a missing or
// soft-deleted form returns 404 (never 403).

import type {
  AllowlistColumn,
  AnswersMap,
  FormDetail,
  FormSummary,
  PreviewMappingResult,
  QuestionInput,
  SaveFormInput,
  SubmissionRow,
} from '@orlanda/shared';
import { DEFAULT_THEME, normalizeTheme, slugError } from '@orlanda/shared';
import { Prisma } from '@prisma/client';
import type { Form, Question, Submission, Attachment } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { badRequest, notFound } from '../http/errors';
import { getBoardSchema } from '../monday/service';
import { itemUrl } from '../monday/service';
import { loadMappingInputs } from '../mapping/inputs';
import { buildMapping } from '../mapping/orchestrator';
import { validateSaveInput, checkPublishPreconditions } from './validation';
import { generateUniqueSlug } from './slug';

const APP_ORIGIN = new URL(env.APP_URL).origin;

// ── DTO mappers ──────────────────────────────────────────────────────────────

function publicUrlFor(slug: string): string {
  return `${APP_ORIGIN}/${slug}`;
}

function toFormSummary(form: Form, submissionCount: number): FormSummary {
  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    status: form.status,
    mappingMode: form.mappingMode,
    submissionCount,
    publicUrl: publicUrlFor(form.slug),
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  };
}

function toQuestionDetail(q: Question): QuestionInput & { id: string; order: number } {
  return {
    id: q.id,
    order: q.order,
    type: q.type,
    label: q.label,
    helpText: q.helpText,
    required: q.required,
    options: (q.options as QuestionInput['options']) ?? null,
    directMapping: (q.directMapping as QuestionInput['directMapping']) ?? null,
  };
}

function toFormDetail(form: Form, questions: Question[]): FormDetail {
  const ordered = [...questions].sort((a, b) => a.order - b.order);
  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    description: form.description,
    status: form.status,
    boardId: form.boardId,
    mappingMode: form.mappingMode,
    aiPrompt: form.aiPrompt,
    aiAllowedColumns: (form.aiAllowedColumns as AllowlistColumn[] | null) ?? null,
    welcomeText: form.welcomeText,
    welcomeButtonLabel: form.welcomeButtonLabel,
    thankYouText: form.thankYouText,
    privacyNotice: form.privacyNotice,
    theme: normalizeTheme(form.theme),
    dailySubmissionCap: form.dailySubmissionCap,
    questions: ordered.map(toQuestionDetail),
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  };
}

// ── Lookups ──────────────────────────────────────────────────────────────────

/** Fetch a non-soft-deleted form or throw 404 (§16.5: 404, never 403). */
async function getLiveFormOrThrow(id: string): Promise<Form> {
  const form = await prisma.form.findFirst({ where: { id, deletedAt: null } });
  if (!form) throw notFound('Form not found.');
  return form;
}

// ── List (GET /api/forms) ────────────────────────────────────────────────────

export async function listForms(): Promise<FormSummary[]> {
  const forms = await prisma.form.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });
  // One count query per form keeps the contract simple; the dashboard list is
  // small. groupBy would also work if this ever grows.
  const counts = await prisma.submission.groupBy({
    by: ['formId'],
    where: { formId: { in: forms.map((f) => f.id) } },
    _count: { _all: true },
  });
  const countByForm = new Map(counts.map((c) => [c.formId, c._count._all]));
  return forms.map((f) => toFormSummary(f, countByForm.get(f.id) ?? 0));
}

// ── Create (POST /api/forms) ─────────────────────────────────────────────────

export async function createForm(createdById: string, title?: string): Promise<FormDetail> {
  const cleanTitle = (title ?? '').trim() || 'Untitled form';

  // Generate a unique slug and retry the insert on the unique-constraint race
  // (§15.3.1) rather than trusting the pre-check alone.
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = await generateUniqueSlug(cleanTitle);
    try {
      const form = await prisma.form.create({
        data: {
          title: cleanTitle,
          slug,
          createdById,
          dailySubmissionCap: env.FORM_DAILY_CAP_DEFAULT,
          theme: DEFAULT_THEME as unknown as Prisma.InputJsonValue,
        },
      });
      return toFormDetail(form, []);
    } catch (err) {
      if (isUniqueSlugConflict(err)) continue; // raced — pick a fresh slug
      throw err;
    }
  }
  throw badRequest('Could not generate a unique slug. Try a different title.');
}

function isUniqueSlugConflict(err: unknown): boolean {
  // Prisma P2002 unique-constraint violation on Form.slug.
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}

// ── Detail (GET /api/forms/:id) ──────────────────────────────────────────────

export async function getFormDetail(id: string): Promise<FormDetail> {
  const form = await getLiveFormOrThrow(id);
  const questions = await prisma.question.findMany({
    where: { formId: id },
    orderBy: { order: 'asc' },
  });
  return toFormDetail(form, questions);
}

// ── Full-form save (PUT /api/forms/:id) — §17.1 ──────────────────────────────

export async function saveForm(id: string, body: unknown): Promise<FormDetail> {
  const form = await getLiveFormOrThrow(id);
  const input: SaveFormInput = validateSaveInput(body);

  // normalizeTheme throws on an invalid color → surface as 400.
  let theme;
  try {
    theme = normalizeTheme(input.theme ?? undefined);
  } catch (err) {
    throw badRequest((err as Error).message || 'Invalid theme.');
  }

  // Custom public link: the builder may rename the slug. Validated + globally
  // unique here (overrides the old "immutable once published" rule — changing a
  // published form's slug intentionally retires the old URL; the builder warns).
  let slugUpdate: { slug?: string } = {};
  if (typeof input.slug === 'string') {
    const candidate = input.slug.trim().toLowerCase();
    if (candidate !== form.slug) {
      const err = slugError(candidate);
      if (err) throw badRequest(err, { slug: err });
      slugUpdate = { slug: candidate };
    }
  }

  const existing = await prisma.question.findMany({
    where: { formId: id },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((q) => q.id));
  const keepIds = new Set(input.questions.filter((q) => q.id).map((q) => q.id as string));

  // Questions whose id is absent from the incoming array are deleted (§17.1).
  const toDelete = [...existingIds].filter((qid) => !keepIds.has(qid));

  try {
    await prisma.$transaction(async (tx) => {
      await tx.form.update({
        where: { id },
        data: {
          ...slugUpdate,
          title: input.title,
          description: input.description ?? null,
        boardId: input.boardId ?? null,
        mappingMode: input.mappingMode,
        aiPrompt: input.aiPrompt ?? null,
        aiAllowedColumns:
          input.aiAllowedColumns == null
            ? Prisma.JsonNull
            : (input.aiAllowedColumns as unknown as Prisma.InputJsonValue),
        welcomeText: input.welcomeText ?? null,
        welcomeButtonLabel: input.welcomeButtonLabel ?? 'Start',
        thankYouText: input.thankYouText ?? null,
        privacyNotice: input.privacyNotice ?? null,
        theme: theme as unknown as Prisma.InputJsonValue,
        ...(input.dailySubmissionCap !== undefined
          ? { dailySubmissionCap: input.dailySubmissionCap }
          : {}),
      },
    });

    if (toDelete.length > 0) {
      await tx.question.deleteMany({ where: { id: { in: toDelete }, formId: id } });
    }

    // Upsert in array order; `order` is derived from the index (§17.1) — any
    // client-sent order is ignored.
    for (let order = 0; order < input.questions.length; order++) {
      const q = input.questions[order];
      const data = {
        order,
        type: q.type,
        label: q.label,
        helpText: q.helpText ?? null,
        required: q.required,
        options:
          q.options == null ? Prisma.JsonNull : (q.options as unknown as Prisma.InputJsonValue),
        directMapping:
          q.directMapping == null
            ? Prisma.JsonNull
            : (q.directMapping as unknown as Prisma.InputJsonValue),
      };
      if (q.id && existingIds.has(q.id)) {
        await tx.question.update({ where: { id: q.id }, data });
      } else {
        await tx.question.create({ data: { ...data, formId: id } });
      }
    }
    });
  } catch (err) {
    // Slug raced another form between validation and commit — surface cleanly.
    if (isUniqueSlugConflict(err)) {
      throw badRequest('That link is already taken.', { slug: 'That link is already taken.' });
    }
    throw err;
  }

  void form;
  return getFormDetail(id);
}

// ── Soft delete (DELETE /api/forms/:id) — §15.3.5 ────────────────────────────

export async function softDeleteForm(id: string): Promise<void> {
  await getLiveFormOrThrow(id); // 404 if missing/already deleted
  // Soft-delete only: never cascade-destroy submission history or sever the
  // mondayItemId links (§15.3.5).
  await prisma.form.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ── Publish (POST /api/forms/:id/publish) — §15.3.4 ──────────────────────────

export async function publishForm(id: string): Promise<FormDetail> {
  const form = await getLiveFormOrThrow(id);
  const questions = await prisma.question.findMany({ where: { formId: id } });

  const check = checkPublishPreconditions(form, questions);
  if (!check.ok) {
    // Field-keyed errors help the builder surface each failure (§15.3.4).
    const fields: Record<string, string> = {};
    check.errors.forEach((msg, i) => {
      fields[`precondition.${i}`] = msg;
    });
    throw badRequest(check.errors.join(' '), fields);
  }

  // Publishing freezes the slug (§15.3.3); no slug change here.
  await prisma.form.update({ where: { id }, data: { status: 'published' } });
  return getFormDetail(id);
}

// ── Preview mapping (POST /api/forms/:id/preview-mapping) — §18.9 ────────────

export async function previewMapping(
  id: string,
  sampleAnswers?: unknown,
): Promise<PreviewMappingResult> {
  const form = await getLiveFormOrThrow(id);
  const questions = await prisma.question.findMany({
    where: { formId: id },
    orderBy: { order: 'asc' },
  });

  const inputs = loadMappingInputs(form, questions);

  // Board schema is required to build/validate column values. If no board is
  // selected yet, fail cleanly with a clear message instead of crashing.
  if (!form.boardId) {
    throw badRequest('Select a Monday board before previewing the mapping.');
  }

  let schema;
  try {
    schema = await getBoardSchema(form.boardId);
  } catch (err) {
    throw badRequest(
      `Could not load the Monday board schema: ${(err as Error).message ?? 'unknown error'}`,
    );
  }

  const answers = await resolveSampleAnswers(id, questions, sampleAnswers);

  try {
    const result = await buildMapping({
      mappingMode: inputs.mappingMode,
      formTitle: inputs.formTitle,
      questions: inputs.questions,
      answers,
      schema,
      directMappingByQuestionId: inputs.directMappingByQuestionId,
      ai: inputs.ai,
    });
    return {
      itemName: result.itemName,
      columnValues: result.columnValues,
      dropped: result.dropped,
      reasoning: result.reasoning,
    };
  } catch (err) {
    // AI / mapping failures must not surface as a 500 — return a clean message.
    throw badRequest(`Preview mapping failed: ${(err as Error).message ?? 'unknown error'}`);
  }
}

/**
 * Choose answers for the dry-run: explicit sampleAnswers from the request, else
 * the most recent submission's stored answers, else synthesized placeholders.
 */
async function resolveSampleAnswers(
  formId: string,
  questions: Question[],
  sampleAnswers: unknown,
): Promise<AnswersMap> {
  if (sampleAnswers && typeof sampleAnswers === 'object' && !Array.isArray(sampleAnswers)) {
    return sampleAnswers as AnswersMap;
  }

  const latest = await prisma.submission.findFirst({
    where: { formId },
    orderBy: { createdAt: 'desc' },
    select: { answers: true },
  });
  if (latest?.answers && typeof latest.answers === 'object' && !Array.isArray(latest.answers)) {
    return latest.answers as unknown as AnswersMap;
  }

  return synthesizeAnswers(questions);
}

/** Build simple placeholder answers from the questions (preview-only). */
function synthesizeAnswers(questions: Question[]): AnswersMap {
  const answers: AnswersMap = {};
  for (const q of questions) {
    const cfg = (q.options as { options?: string[] } | null) ?? null;
    switch (q.type) {
      case 'text':
        answers[q.id] = { type: 'text', value: 'Sample text' };
        break;
      case 'long_text':
        answers[q.id] = { type: 'long_text', value: 'Sample long text answer.' };
        break;
      case 'number':
        answers[q.id] = { type: 'number', value: 42 };
        break;
      case 'single_select':
        answers[q.id] = { type: 'single_select', value: cfg?.options?.[0] ?? 'Option A' };
        break;
      case 'multi_select':
        answers[q.id] = {
          type: 'multi_select',
          value: cfg?.options?.slice(0, 1) ?? ['Option A'],
        };
        break;
      case 'attachment':
        answers[q.id] = { type: 'attachment', attachmentIds: [] };
        break;
    }
  }
  return answers;
}

// ── Submissions (GET /api/forms/:id/submissions) ─────────────────────────────

type SubmissionWithAttachments = Submission & { attachments: Attachment[] };

function toSubmissionRow(form: Form, sub: SubmissionWithAttachments): SubmissionRow {
  const mondayItemUrl =
    form.boardId && sub.mondayItemId ? itemUrl(form.boardId, sub.mondayItemId) : null;
  return {
    id: sub.id,
    status: sub.status,
    mondayItemId: sub.mondayItemId,
    mondayItemUrl,
    aiReasoning: sub.aiReasoning,
    errorMessage: sub.errorMessage,
    droppedColumns:
      (sub.droppedColumns as { columnId: string; reason: string }[] | null) ?? null,
    answers: (sub.answers as Record<string, unknown>) ?? {},
    attachments: sub.attachments.map((a) => ({
      id: a.id,
      questionId: a.questionId,
      originalFilename: a.originalFilename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedToMonday: a.uploadedToMonday,
    })),
    clientIp: sub.clientIp,
    createdAt: sub.createdAt.toISOString(),
  };
}

export async function listSubmissions(id: string): Promise<SubmissionRow[]> {
  const form = await getLiveFormOrThrow(id);
  const subs = await prisma.submission.findMany({
    where: { formId: id },
    orderBy: { createdAt: 'desc' },
    include: { attachments: true },
  });
  return subs.map((s) => toSubmissionRow(form, s));
}
