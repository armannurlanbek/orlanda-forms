// Public submit handler internals (§13 / §14 / §16). All abuse/size/file checks
// run BEFORE any Anthropic or Monday call (§14.2); the request only ever
// persists the submission + attachment bytes and nudges the worker. The async
// mapping outcome is never revealed to the public client (§5.7 / §14.2.9).

import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import type { Form, Question } from '@prisma/client';
import {
  ANTHROPIC_GUARDS,
  UPLOAD_LIMITS,
  validateAnswers,
  type AnswersMap,
  type QuestionConfig,
  type QuestionDef,
} from '@orlanda/shared';
import { prisma } from '../db/prisma';
import { badRequest, notFound, tooManyRequests } from '../http/errors';
import { anonymizeIp, getClientIp } from '../http/clientIp';
import { sanitizeFilename, validateUpload } from '../files/validate';

const FILE_FIELD_PREFIX = 'file__';

// The client-supplied idempotency key (§14.1) MUST be a well-formed RFC-4122
// UUID (any version 1-5, standard 8-4-4-4-12 layout with version/variant
// nibbles). Validating it before any DB work stops malformed/abusive keys from
// reaching the unique index or consuming the per-form cap.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && UUID_RE.test(key);
}

interface ParsedFile {
  questionId: string;
  buffer: Buffer;
  originalname: string;
  // Resolved after content validation:
  sanitizedFilename: string;
  mimeType: string;
  sizeBytes: number;
}

function toQuestionDef(q: Question): QuestionDef {
  return {
    id: q.id,
    order: q.order,
    type: q.type,
    label: q.label,
    helpText: q.helpText,
    required: q.required,
    options: (q.options as QuestionConfig | null) ?? null,
  };
}

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Per-form daily cap (§16.1). Atomically increment today's counter and reject
 * (429) when it goes over the form's cap. We increment first (claiming a slot)
 * and refuse when the post-increment count exceeds the cap, so concurrent
 * requests cannot both slip past the boundary.
 */
async function enforceDailyCap(form: Form, now: Date): Promise<void> {
  const cap = form.dailySubmissionCap;
  const key = `form-daily:${form.id}:${utcDayKey(now)}`;
  const counter = await prisma.usageCounter.upsert({
    where: { key },
    create: { key, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (counter.count > cap) {
    // Roll back the speculative increment so the counter reflects reality.
    await prisma.usageCounter.update({ where: { key }, data: { count: { decrement: 1 } } });
    throw tooManyRequests('This form is not accepting submissions right now.');
  }
}

/** Group multer files by their `file__<questionId>` field name. */
function groupFiles(files: Express.Multer.File[]): ParsedFile[] {
  const out: ParsedFile[] = [];
  for (const f of files) {
    if (!f.fieldname.startsWith(FILE_FIELD_PREFIX)) {
      throw badRequest('Unexpected file field.');
    }
    const questionId = f.fieldname.slice(FILE_FIELD_PREFIX.length);
    if (!questionId) throw badRequest('Malformed file field.');
    out.push({
      questionId,
      buffer: f.buffer,
      originalname: f.originalname,
      sanitizedFilename: '',
      mimeType: '',
      sizeBytes: f.size,
    });
  }
  return out;
}

/** Spend/size guards on the non-file body (§16.1). */
function enforceBodyGuards(answersRaw: string, answers: Record<string, unknown>): void {
  if (Buffer.byteLength(answersRaw, 'utf8') > ANTHROPIC_GUARDS.maxRequestBodyBytes) {
    throw badRequest('Submission is too large.');
  }
  const keys = Object.keys(answers);
  if (keys.length > ANTHROPIC_GUARDS.maxAnswers) {
    throw badRequest('Too many answers.');
  }
  for (const v of Object.values(answers)) {
    if (v && typeof v === 'object') {
      const entry = v as Record<string, unknown>;
      if (typeof entry.value === 'string' && entry.value.length > ANTHROPIC_GUARDS.maxAnswerChars) {
        throw badRequest('An answer is too long.');
      }
      if (Array.isArray(entry.value)) {
        for (const el of entry.value) {
          if (typeof el === 'string' && el.length > ANTHROPIC_GUARDS.maxAnswerChars) {
            throw badRequest('An answer is too long.');
          }
        }
      }
    }
  }
}

/** File constraints (§16.2): count/size/total + magic-byte allowlist. */
function enforceAndValidateFiles(files: ParsedFile[]): void {
  if (files.length > UPLOAD_LIMITS.maxFilesPerSubmission) {
    throw badRequest('Too many files.');
  }
  let total = 0;
  for (const f of files) {
    if (f.buffer.length > UPLOAD_LIMITS.maxFileBytes) {
      throw badRequest('A file is too large.');
    }
    total += f.buffer.length;
    const res = validateUpload(f.buffer, f.originalname, UPLOAD_LIMITS.allowedExtensions);
    if (!res.ok) {
      // Generic message — never echo why an untrusted upload was rejected in
      // detail beyond a safe summary.
      throw badRequest('A file could not be accepted.');
    }
    f.sanitizedFilename = sanitizeFilename(f.originalname);
    f.mimeType = res.mime;
    f.sizeBytes = f.buffer.length;
  }
  if (total > UPLOAD_LIMITS.maxTotalBytes) {
    throw badRequest('Files exceed the total size limit.');
  }
}

export interface SubmitOutcome {
  /** true when this call created a new submission and should nudge the worker. */
  created: boolean;
}

/**
 * Resolve the published, live form for a slug or throw 404 (§16.6). A form that
 * is missing, not published, or soft-deleted is indistinguishable to the public.
 */
export async function getPublishedForm(slug: string): Promise<Form> {
  const form = await prisma.form.findFirst({
    where: { slug, status: 'published', deletedAt: null },
  });
  if (!form) throw notFound('Form not found.');
  return form;
}

/**
 * Process a multipart public submit (§14.2). Returns whether a new submission
 * was created (so the route can nudge the worker). The client always sees the
 * same generic success regardless.
 */
export async function handleSubmit(req: Request, form: Form): Promise<SubmitOutcome> {
  // 1. Idempotency key (§14.1): must be present AND a well-formed UUID. Validate
  //    BEFORE any DB work (cap counter, lookups, inserts) so a malformed key is
  //    rejected with a 400 without touching the database.
  const idempotencyKey =
    typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
  if (!idempotencyKey) throw badRequest('Missing idempotency key.');
  if (!isValidIdempotencyKey(idempotencyKey)) throw badRequest('Invalid idempotency key.');

  // 2. Per-form daily cap — before any further work (§16.1).
  await enforceDailyCap(form, new Date());

  // 3. Parse parts.
  const files = groupFiles((req.files as Express.Multer.File[] | undefined) ?? []);
  const answersRaw = typeof req.body?.answers === 'string' ? req.body.answers : '';

  let answers: Record<string, unknown>;
  try {
    const parsed = JSON.parse(answersRaw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('answers must be an object');
    }
    answers = parsed as Record<string, unknown>;
  } catch {
    throw badRequest('Invalid answers payload.');
  }

  enforceBodyGuards(answersRaw, answers);

  // 4. File constraints (magic-byte + allowlist) — resolves sanitized name/mime.
  enforceAndValidateFiles(files);

  // 5. Idempotency (§14.1): if this key already produced a submission, return the
  //    SAME generic success without creating a second row or item.
  const existing = await prisma.submission.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { created: false };
  }

  const questions = await prisma.question.findMany({
    where: { formId: form.id },
    orderBy: { order: 'asc' },
  });
  const questionDefs = questions.map(toQuestionDef);
  const questionById = new Map(questions.map((q) => [q.id, q]));

  // Each file's question must exist on this form and be an attachment question.
  for (const f of files) {
    const q = questionById.get(f.questionId);
    if (!q || q.type !== 'attachment') {
      throw badRequest('A file was uploaded for an invalid question.');
    }
  }

  const clientIp = anonymizeIp(getClientIp(req));

  // 6. Persist-first transaction (§14.2.1): submission + attachments + bytes in
  //    ONE local tx, with attachment ids written into answers[questionId]. No
  //    external call inside the tx (§14.3).
  let submissionId: string;
  try {
    submissionId = await prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({
        data: {
          formId: form.id,
          idempotencyKey,
          answers: {} as Prisma.InputJsonValue, // filled after attachment ids known
          status: 'received',
          clientIp,
        },
      });

      // One Attachment row per file; collect ids per question.
      const idsByQuestion: Record<string, string[]> = {};
      for (const f of files) {
        const att = await tx.attachment.create({
          data: {
            submissionId: submission.id,
            questionId: f.questionId,
            originalFilename: f.originalname.slice(0, 500),
            sanitizedFilename: f.sanitizedFilename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            bytes: f.buffer,
            status: 'stored',
          },
        });
        (idsByQuestion[f.questionId] ??= []).push(att.id);
      }

      // Merge resolved attachment ids into the answers payload (§11.2 / §13.1).
      const merged = mergeAttachmentIds(answers, idsByQuestion, questionById);

      await tx.submission.update({
        where: { id: submission.id },
        data: { answers: merged as unknown as Prisma.InputJsonValue },
      });

      return submission.id;
    });
  } catch (err) {
    // A concurrent double-POST with the same key may race the create. Resolve to
    // the existing submission and return the same generic success (§14.1).
    if (isUniqueKeyConflict(err)) {
      return { created: false };
    }
    throw err;
  }

  // 7. Authoritative validation (§15.1) — runs AFTER persist so the row is never
  //    lost. Validate answers + attachment ownership. On failure mark failed and
  //    surface a GENERIC 400 (no internal detail).
  const reloaded = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { attachments: true },
  });
  const storedAnswers = (reloaded?.answers as unknown as AnswersMap) ?? {};
  const result = validateAnswers(questionDefs, storedAnswers);

  let ownershipOk = true;
  if (result.ok && reloaded) {
    const ownedByQuestion = new Map<string, Set<string>>();
    for (const a of reloaded.attachments) {
      (ownedByQuestion.get(a.questionId) ?? ownedByQuestion.set(a.questionId, new Set()).get(a.questionId)!).add(a.id);
    }
    for (const q of questions) {
      const entry = storedAnswers[q.id];
      if (entry && entry.type === 'attachment') {
        const owned = ownedByQuestion.get(q.id) ?? new Set<string>();
        if (!entry.attachmentIds.every((id) => owned.has(id))) {
          ownershipOk = false;
          break;
        }
      }
    }
  }

  if (!result.ok || !ownershipOk) {
    await prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'failed', errorMessage: 'Validation failed.' },
    });
    throw badRequest('Your submission could not be accepted. Please check your answers.');
  }

  // 8. Success — worker handles mapping off the request path (§18.6).
  return { created: true };
}

function isUniqueKeyConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}

/**
 * Write resolved attachment ids into the answers map for each attachment
 * question (§11.2). For attachment questions the client's `value`/`attachmentIds`
 * is ignored — only server-resolved ids count.
 */
function mergeAttachmentIds(
  answers: Record<string, unknown>,
  idsByQuestion: Record<string, string[]>,
  questionById: Map<string, Question>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...answers };
  for (const q of questionById.values()) {
    if (q.type !== 'attachment') continue;
    const ids = idsByQuestion[q.id] ?? [];
    merged[q.id] = { type: 'attachment', attachmentIds: ids };
  }
  return merged;
}
