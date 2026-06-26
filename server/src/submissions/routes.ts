// Submission retry (§14.2.8). requireAuth + csrfProtect; org-wide builders.
//   POST /api/submissions/:id/retry   re-enter the resumable state machine.
import { Router } from 'express';
import { requireAuth, csrfProtect } from '../auth/middleware';
import { asyncHandler, notFound } from '../http/errors';
import { prisma } from '../db/prisma';
import { nudge } from '../worker';
import { reentryStatus } from './status';

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

// DELETE /api/submissions/:id — permanently remove a submission and its
// attachments (Attachment cascades via onDelete: Cascade). This removes the
// LOCAL record only; any Monday item already created is left untouched. Builders
// are org-wide-trusted; a missing submission returns 404 (no enumeration).
submissionsRouter.delete(
  '/:id',
  csrfProtect,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sub = await prisma.submission.findUnique({ where: { id }, select: { id: true } });
    if (!sub) throw notFound('Submission not found.');
    await prisma.submission.delete({ where: { id } });
    res.json({ ok: true });
  }),
);
