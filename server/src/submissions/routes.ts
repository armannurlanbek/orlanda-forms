// Submission retry (§14.2.8). requireAuth + csrfProtect; org-wide builders.
//   POST /api/submissions/:id/retry   re-enter the resumable state machine.
import { Router } from 'express';
import { requireAuth, csrfProtect } from '../auth/middleware';
import { asyncHandler, notFound, conflict } from '../http/errors';
import { prisma } from '../db/prisma';
import { nudge } from '../worker';
import { reentryStatus } from './status';

// Must match the worker's stale-lock reclaim window (STALE_LOCK_MS in
// server/src/worker/index.ts). A lock older than this belongs to a worker that
// crashed mid-op and is treated as free; a fresher lock means a worker is still
// actively holding the submission. Kept as a local constant because the worker's
// value is not exported.
const STALE_LOCK_MS = 2 * 60_000;

export const submissionsRouter = Router();
submissionsRouter.use(requireAuth);

submissionsRouter.post(
  '/:id/retry',
  csrfProtect,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sub = await prisma.submission.findUnique({ where: { id } });
    if (!sub) throw notFound('Submission not found.');

    // Retry on a fully-mapped submission is a no-op (§14.2.8).
    if (sub.status === 'mapped') {
      res.json({ ok: true, status: 'mapped' });
      return;
    }

    // Move terminal (partial/failed) submissions back into the worker's
    // claimable set, then reset scheduling so it re-enters immediately. The
    // pipeline skips create_item when mondayItemId is set and re-uploads only
    // pending files; restarting from `received` rebuilds the mapping.
    const status = reentryStatus(sub.status, Boolean(sub.mondayItemId));
    await prisma.submission.update({
      where: { id },
      data: { status, nextAttemptAt: new Date(), lockedAt: null, errorMessage: null, attempts: 0 },
    });
    nudge();
    res.json({ ok: true, status });
  }),
);

/**
 * True when a submission is safe to delete (no worker is mid-operation on it).
 *
 * A NULL `lockedAt` means no worker holds it. A STALE lock (older than the
 * worker's reclaim window) belongs to a crashed worker and is likewise safe. A
 * FRESH lock means a worker is actively processing this submission — possibly
 * mid-create_item — and deleting now could orphan a Monday item behind a deleted
 * row (§14.2/§14.3), so it is refused. The comparison mirrors the worker's strict
 * stale check, so the boundary lock counts as still-held.
 */
export function canDeleteSubmission(sub: { lockedAt: Date | null }, now: Date = new Date()): boolean {
  if (!sub.lockedAt) return true;
  return now.getTime() - sub.lockedAt.getTime() > STALE_LOCK_MS;
}

/** Prisma "record to delete does not exist" — the row vanished under us. */
function isRecordNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2025';
}

// DELETE /api/submissions/:id — permanently remove a submission and its
// attachments (Attachment cascades via onDelete: Cascade). This removes the
// LOCAL record only; any Monday item already created is left untouched. Builders
// are org-wide-trusted; a missing submission returns 404 (no enumeration).
//
// Two race guards: (1) refuse (409) while a worker actively holds the submission
// so we never delete the row out from under an in-flight create_item and orphan a
// Monday item; (2) if the row vanishes between the read and the delete, map
// Prisma's P2025 to the same 404 rather than letting it surface as a 500.
submissionsRouter.delete(
  '/:id',
  csrfProtect,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sub = await prisma.submission.findUnique({
      where: { id },
      select: { id: true, lockedAt: true },
    });
    if (!sub) throw notFound('Submission not found.');

    if (!canDeleteSubmission(sub)) {
      throw conflict('This submission is still being processed. Try again in a moment.');
    }

    try {
      await prisma.submission.delete({ where: { id } });
    } catch (err) {
      // Row deleted concurrently (e.g. retention purge) between read and delete.
      if (isRecordNotFound(err)) throw notFound('Submission not found.');
      throw err;
    }
    res.json({ ok: true });
  }),
);
