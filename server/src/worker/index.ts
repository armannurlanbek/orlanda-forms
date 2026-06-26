// Submission worker + scheduled jobs (§14 / §16.9 / §18.6). In-process polling
// loop that drives the resumable state machine off persisted Postgres state.
// Single-instance (the role agent ensures only the primary runs the app), so a
// DB poller is sufficient and crash-safe — no Redis.
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../db/prisma';
import { processSubmission } from '../submissions/pipeline';
import { purgeExpiredTokens } from '../auth/tokens';

const POLL_MS = 2_000;
const STALE_LOCK_MS = 2 * 60_000; // reclaim a submission whose worker crashed
const JOBS_INTERVAL_MS = 60 * 60_000; // hourly
const MAX_PER_TICK = 10;

let started = false;
let pollTimer: NodeJS.Timeout | null = null;
let jobsTimer: NodeJS.Timeout | null = null;
let ticking = false;

/** Claim and process one due submission. Returns false when none are due. */
async function claimAndProcessOne(): Promise<boolean> {
  const now = new Date();
  const stale = new Date(now.getTime() - STALE_LOCK_MS);

  const candidate = await prisma.submission.findFirst({
    where: {
      status: { in: ['received', 'item_created', 'files_pending'] },
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }] },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!candidate) return false;

  // Conditional claim guards against reclaiming a still-active lock.
  const claim = await prisma.submission.updateMany({
    where: { id: candidate.id, OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }] },
    data: { lockedAt: now },
  });
  if (claim.count === 0) return false;

  try {
    await processSubmission(candidate.id);
  } catch (err) {
    logger.error({ err, submissionId: candidate.id }, 'worker: processSubmission threw');
  } finally {
    await prisma.submission
      .update({ where: { id: candidate.id }, data: { lockedAt: null } })
      .catch(() => undefined);
  }
  return true;
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    let processed = 0;
    while (processed < MAX_PER_TICK && (await claimAndProcessOne())) processed++;
  } catch (err) {
    logger.error({ err }, 'worker tick error');
  } finally {
    ticking = false;
  }
}

export function startWorker(): void {
  if (started) return;
  started = true;
  pollTimer = setInterval(() => void tick(), POLL_MS);
  pollTimer.unref?.();
  logger.info('submission worker started');
}

/** Trigger an immediate processing pass (called after submit / retry). */
export function nudge(): void {
  setImmediate(() => void tick());
}

async function runScheduledJobs(): Promise<void> {
  try {
    // (a) Retention purge (§16.9): delete old submissions (attachments cascade).
    const cutoff = new Date(Date.now() - env.SUBMISSION_RETENTION_DAYS * 86_400_000);
    const purged = await prisma.submission.deleteMany({ where: { createdAt: { lt: cutoff } } });

    // (b) Denylist sweep.
    const tokens = await purgeExpiredTokens();

    // (c) Stored-file cleanup (§13.2): for mapped submissions older than 24h,
    //     release attachment bytes (keep metadata) — the files live on Monday now.
    const fileCutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const oldMapped = await prisma.submission.findMany({
      where: { status: 'mapped', updatedAt: { lt: fileCutoff } },
      select: { id: true },
    });
    let cleaned = 0;
    if (oldMapped.length > 0) {
      const res = await prisma.attachment.updateMany({
        where: { submissionId: { in: oldMapped.map((s) => s.id) }, uploadedToMonday: true },
        data: { bytes: Buffer.alloc(0) },
      });
      cleaned = res.count;
    }

    logger.info(
      { purgedSubmissions: purged.count, purgedTokens: tokens, cleanedAttachments: cleaned },
      'scheduled jobs run',
    );
  } catch (err) {
    logger.error({ err }, 'scheduled jobs error');
  }
}

export function startScheduledJobs(): void {
  jobsTimer = setInterval(() => void runScheduledJobs(), JOBS_INTERVAL_MS);
  jobsTimer.unref?.();
  // Run once shortly after startup.
  setTimeout(() => void runScheduledJobs(), 10_000).unref?.();
  logger.info('scheduled jobs started');
}

export async function stopWorker(): Promise<void> {
  started = false;
  if (pollTimer) clearInterval(pollTimer);
  if (jobsTimer) clearInterval(jobsTimer);
  pollTimer = null;
  jobsTimer = null;
}
