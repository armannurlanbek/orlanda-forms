// The resumable submission state machine (§14.2). Drives OFF persisted state so
// no completed work is ever re-done, and so a crash/retry resumes precisely:
//   received -> (build mapping) -> create_item [guarded] -> item id persisted
//   immediately -> upload files (per-attachment, idempotent) -> finalize
//   mapped / partial / failed.
//
// HARD RULE (§14.3): no Postgres transaction wraps a Monday HTTP call. Each
// external effect (mondayItemId, each Attachment.uploadedToMonday) is recorded
// in its own small write the instant it succeeds.

import type { Attachment, Form, Question, Submission } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { AnswersMap, DroppedColumn, QuestionConfig, QuestionDef } from '@orlanda/shared';
import { prisma } from '../db/prisma';
import { submissionLogger } from '../config/logger';
import { loadMappingInputs } from '../mapping/inputs';
import { buildMapping } from '../mapping/orchestrator';
import {
  addFileToColumn,
  createItem,
  getBoardSchema,
  invalidateBoardSchema,
} from '../monday/service';
import { MondayError } from '../monday/errors';
import { AiError } from '../ai/errors';
import { computeBackoff, decideFinalStatus } from './status';

type SubmissionWithAttachments = Submission & { attachments: Attachment[] };

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

function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as unknown as Prisma.InputJsonValue);
}

/** Mark a submission failed (terminal, pre-create) with a generic-safe message. */
async function markFailed(id: string, message: string): Promise<void> {
  await prisma.submission.update({
    where: { id },
    data: { status: 'failed', errorMessage: message.slice(0, 2000) },
  });
}

/** Record a retryable error: leave the current state, set a backoff, bump attempts. */
async function scheduleRetry(sub: Submission, message: string): Promise<void> {
  await prisma.submission.update({
    where: { id: sub.id },
    data: {
      attempts: { increment: 1 },
      nextAttemptAt: computeBackoff(sub.attempts),
      errorMessage: message.slice(0, 2000),
    },
  });
}

/**
 * Run one full pass of the state machine for a single claimed submission.
 * Idempotent and resumable: re-entry skips create_item when mondayItemId is set
 * and only uploads attachments still flagged uploadedToMonday=false.
 */
export async function processSubmission(submissionId: string): Promise<void> {
  const log = submissionLogger(submissionId);

  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { attachments: true },
  });
  if (!sub) return;
  if (sub.status === 'mapped' || sub.status === 'partial' || sub.status === 'failed') {
    // Terminal states are not reprocessed (a retry resets them explicitly).
    return;
  }

  const form = await prisma.form.findUnique({ where: { id: sub.formId } });
  if (!form) {
    await markFailed(sub.id, 'Form no longer exists.');
    return;
  }
  if (!form.boardId) {
    await markFailed(sub.id, 'Form has no target board configured.');
    return;
  }

  const questions = await prisma.question.findMany({
    where: { formId: form.id },
    orderBy: { order: 'asc' },
  });

  const answers = (sub.answers as unknown as AnswersMap) ?? {};

  // ── Build mapping (only when the item does not yet exist) ──────────────────
  // Once mondayItemId is set the column_values were already written via
  // create_item, so we must NOT call the AI again. We still need the file-column
  // map for the upload step, which we derive cheaply from stored direct mappings.
  let itemName = '';
  let columnValues: Record<string, unknown> = {};
  let dropped: DroppedColumn[] = (sub.droppedColumns as DroppedColumn[] | null) ?? [];
  let reasoning: string | null = sub.aiReasoning ?? null;
  let renderedPrompt: string | null = sub.aiPromptRendered ?? null;
  let rawResponse: string | null = sub.aiRawResponse ?? null;
  let fileColumnsByQuestionId: Record<string, string> = {};

  const inputs = loadMappingInputs(form, questions);

  if (!sub.mondayItemId) {
    let schema;
    try {
      schema = await getBoardSchema(form.boardId);
    } catch (err) {
      // Schema fetch is a Monday read. Retryable → backoff and resume later.
      if (err instanceof MondayError && err.retryable) {
        log.warn({ err: err.message }, 'board schema fetch retryable; backing off');
        await scheduleRetry(sub, err.message);
        return;
      }
      log.error({ err }, 'board schema fetch terminal');
      await markFailed(sub.id, 'Could not load the target board schema.');
      return;
    }

    try {
      const mapping = await buildMapping({
        mappingMode: inputs.mappingMode,
        formTitle: inputs.formTitle,
        questions: inputs.questions,
        answers,
        schema,
        directMappingByQuestionId: inputs.directMappingByQuestionId,
        ai: inputs.ai,
      });
      itemName = mapping.itemName;
      columnValues = mapping.columnValues;
      dropped = mapping.dropped;
      reasoning = mapping.reasoning;
      renderedPrompt = mapping.renderedPrompt;
      rawResponse = mapping.rawResponse;
      fileColumnsByQuestionId = mapping.fileColumnsByQuestionId;
    } catch (err) {
      if (err instanceof AiError) {
        // AI errors are terminal in this engine (oversize / contract / ceiling).
        log.error({ err: err.message, raw: rawResponse }, 'AI mapping terminal failure');
        await markFailed(sub.id, 'AI mapping failed.');
        return;
      }
      if (err instanceof MondayError && err.retryable) {
        await scheduleRetry(sub, err.message);
        return;
      }
      log.error({ err }, 'mapping failed (terminal)');
      await markFailed(sub.id, 'Mapping failed.');
      return;
    }

    // ── Create item — guarded (§14.2.4) ─────────────────────────────────────
    // Assert mondayItemId IS NULL (it is, in this branch), call create_item,
    // then persist the id + status in the VERY NEXT statement, before anything
    // else, so a crash cannot orphan a Monday item behind a NULL id.
    let created: { itemId: string };
    try {
      created = await createItem({
        boardId: form.boardId,
        itemName,
        columnValues,
      });
    } catch (err) {
      if (err instanceof MondayError && err.retryable) {
        // Keep `received`; the item was NOT created.
        log.warn({ err: err.message }, 'create_item retryable; backing off');
        await scheduleRetry(sub, err.message);
        return;
      }
      const message = err instanceof Error ? err.message : 'create_item failed';
      log.error({ err }, 'create_item terminal failure');
      await maybeInvalidateSchema(form.boardId, message);
      await markFailed(sub.id, 'Could not create the Monday item.');
      return;
    }

    // Immediate dedicated write: item id + audit fields + dropped columns.
    const hasFiles = sub.attachments.length > 0;
    await prisma.submission.update({
      where: { id: sub.id },
      data: {
        mondayItemId: created.itemId,
        status: hasFiles ? 'files_pending' : 'item_created',
        aiReasoning: reasoning ?? null,
        droppedColumns: jsonOrNull(dropped.length > 0 ? dropped : null),
        aiPromptRendered: renderedPrompt ?? null,
        aiRawResponse: rawResponse ?? null,
        errorMessage: null,
        attempts: 0,
        nextAttemptAt: null,
      },
    });
    sub.mondayItemId = created.itemId;
    log.info({ itemId: created.itemId, dropped: dropped.length }, 'monday item created');
  } else {
    // Resume path: item already exists. Recover the file-column map + audit
    // context from persisted state without touching the AI / column_values.
    fileColumnsByQuestionId = fileColumnsFromMappings(inputs.directMappingByQuestionId);
    // Drop stale per-file drops (keyed by attachment questionId) so the upload
    // step below recomputes them — e.g. a builder fixed a missing file column and
    // hit Retry. Genuine column drops (an answer with no fitting column) are kept.
    const attachmentQids = new Set(
      questions.filter((q) => q.type === 'attachment').map((q) => q.id),
    );
    dropped = ((sub.droppedColumns as DroppedColumn[] | null) ?? []).filter(
      (d) => !attachmentQids.has(d.columnId),
    );
  }

  // ── Upload files (§13.3) ───────────────────────────────────────────────────
  const itemId = sub.mondayItemId!;
  let hadTerminalFileFailure = false;
  let hadRetryableFileFailure = false;

  for (const att of sub.attachments) {
    if (att.uploadedToMonday) continue;
    const columnId = fileColumnsByQuestionId[att.questionId];
    if (!columnId) {
      // No file column mapped for this question → cannot upload. Treat as a
      // terminal drop for this file; it contributes to `partial`.
      hadTerminalFileFailure = true;
      dropped = appendDrop(dropped, att.questionId, 'No file column mapped for this question.');
      log.warn({ attachmentId: att.id, questionId: att.questionId }, 'attachment has no mapped file column');
      continue;
    }

    try {
      const { assetId } = await addFileToColumn({
        itemId,
        columnId,
        file: Buffer.from(att.bytes),
        filename: att.sanitizedFilename,
        mimeType: att.mimeType,
      });
      await prisma.attachment.update({
        where: { id: att.id },
        data: { uploadedToMonday: true, mondayAssetId: assetId, status: 'uploaded' },
      });
      att.uploadedToMonday = true;
      log.info({ attachmentId: att.id, assetId }, 'attachment uploaded to monday');
    } catch (err) {
      if (err instanceof MondayError && err.retryable) {
        hadRetryableFileFailure = true;
        log.warn({ attachmentId: att.id, err: err.message }, 'file upload retryable');
        continue;
      }
      // Terminal on this one file: record it and continue (→ partial).
      hadTerminalFileFailure = true;
      const message = err instanceof Error ? err.message : 'file upload failed';
      await prisma.attachment.update({ where: { id: att.id }, data: { status: 'failed' } });
      dropped = appendDrop(dropped, att.questionId, `File upload failed: ${message}`);
      await maybeInvalidateSchema(form.boardId, message);
      log.error({ attachmentId: att.id, err: message }, 'file upload terminal failure');
    }
  }

  const totalFiles = sub.attachments.length;
  const uploadedFiles = sub.attachments.filter((a) => a.uploadedToMonday).length;

  // If any file is still retryable-pending, keep files_pending + backoff so the
  // next tick/retry re-uploads only the ones still false (§13.3.5).
  if (hadRetryableFileFailure && uploadedFiles < totalFiles && !hadTerminalFileFailure) {
    await prisma.submission.update({
      where: { id: sub.id },
      data: {
        status: 'files_pending',
        attempts: { increment: 1 },
        nextAttemptAt: computeBackoff(sub.attempts),
        droppedColumns: jsonOrNull(dropped.length > 0 ? dropped : null),
      },
    });
    return;
  }

  // ── Finalize (§14.2.7 / §18.7) ─────────────────────────────────────────────
  const finalStatus = decideFinalStatus({
    hadDroppedColumns: dropped.length > 0,
    totalFiles,
    uploadedFiles,
    hadTerminalFileFailure,
  });

  await prisma.submission.update({
    where: { id: sub.id },
    data: {
      status: finalStatus,
      droppedColumns: jsonOrNull(dropped.length > 0 ? dropped : null),
      nextAttemptAt: null,
      ...(finalStatus !== 'files_pending' ? { errorMessage: null } : {}),
    },
  });

  if (finalStatus === 'partial') {
    // §22: make every non-clean outcome diagnosable — log dropped/raw context.
    log.warn(
      { status: finalStatus, dropped, aiReasoning: reasoning, hadTerminalFileFailure },
      'submission finalized non-clean',
    );
  } else {
    log.info({ status: finalStatus }, 'submission finalized');
  }
}

/** Collect attachment-question -> file-column mappings from stored direct maps. */
function fileColumnsFromMappings(
  directMappingByQuestionId: Record<string, { columnId: string; columnType: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [qid, m] of Object.entries(directMappingByQuestionId)) {
    if (m.columnType === 'file') out[qid] = m.columnId;
  }
  return out;
}

function appendDrop(dropped: DroppedColumn[], columnId: string, reason: string): DroppedColumn[] {
  return [...dropped, { columnId, reason }];
}

/** If a terminal Monday error indicates a vanished column, refresh next time (§15.2.3). */
async function maybeInvalidateSchema(boardId: string, message: string): Promise<void> {
  const low = message.toLowerCase();
  if (low.includes('column') && (low.includes('exist') || low.includes('not found') || low.includes('unknown'))) {
    try {
      await invalidateBoardSchema(boardId);
    } catch {
      /* best-effort */
    }
  }
}
