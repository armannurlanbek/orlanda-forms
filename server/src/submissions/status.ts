// Pure helpers for the resumable submission state machine (§14). No DB, no
// network — directly unit-tested in status.test.ts.

import type { SubmissionStatus } from '@orlanda/shared';

/** Base backoff unit and ceiling for retryable Monday errors (§14.4). */
export const BACKOFF_BASE_MS = 5_000; // 5s
export const BACKOFF_CAP_MS = 10 * 60_000; // 10 min

/**
 * Exponential backoff with a hard cap (§14.4): `min(2^attempts * 5s, 10min)`,
 * measured in milliseconds from `now`.
 *
 * `attempts` is the number of attempts ALREADY made (0 on the first failure).
 * The exponent is clamped so the intermediate `2^attempts` never overflows
 * before the cap is applied.
 */
export function backoffMs(attempts: number): number {
  const safeAttempts = Math.max(0, Math.floor(attempts));
  // 2^31 * base already dwarfs the cap; clamp the exponent to stay finite.
  const exp = Math.min(safeAttempts, 31);
  const raw = Math.pow(2, exp) * BACKOFF_BASE_MS;
  return Math.min(raw, BACKOFF_CAP_MS);
}

/** The `nextAttemptAt` Date for a submission that just hit a retryable error. */
export function computeBackoff(attempts: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + backoffMs(attempts));
}

export interface FinalizeInput {
  /** AI dropped unknown columns, or a column was dropped after create_item. */
  hadDroppedColumns: boolean;
  /** total number of attachments expected to be uploaded for this submission. */
  totalFiles: number;
  /** attachments already confirmed uploaded to Monday. */
  uploadedFiles: number;
  /** at least one file hit a terminal (non-retryable) upload failure. */
  hadTerminalFileFailure: boolean;
}

/**
 * Decide the post-item submission status (§14.2.7 / §18.7). The Monday item
 * already exists when this runs.
 *
 * - Files still pending (and no terminal failure on them) → `files_pending`
 *   (the worker will resume the upload step on the next tick/retry).
 * - All work done with nothing dropped and no terminal file failure → `mapped`.
 * - Otherwise (something intentionally dropped, or a terminal file failure) →
 *   `partial` — terminal unless a builder retries.
 */
export function decideFinalStatus(
  input: FinalizeInput,
): Extract<SubmissionStatus, 'mapped' | 'partial' | 'files_pending'> {
  const filesOutstanding = input.uploadedFiles < input.totalFiles;

  // If files remain to upload and none of them have terminally failed, the
  // submission is not yet final — keep it resumable at the file step.
  if (filesOutstanding && !input.hadTerminalFileFailure) {
    return 'files_pending';
  }

  // Item exists; decide between fully-mapped and partial.
  if (input.hadDroppedColumns || input.hadTerminalFileFailure) {
    return 'partial';
  }
  return 'mapped';
}

/**
 * The status a submission should re-enter at when a builder hits "Retry"
 * (§14.2.8). The worker only claims `received | item_created | files_pending`,
 * so terminal `partial`/`failed` must be moved back into that set or a retry is
 * a silent no-op. If the Monday item already exists we resume at the file step
 * (the pipeline skips create_item when mondayItemId is set); otherwise we
 * restart from the top. A `mapped` submission never re-enters.
 */
export function reentryStatus(status: SubmissionStatus, hasMondayItem: boolean): SubmissionStatus {
  if (status === 'mapped') return 'mapped';
  if (status === 'partial' || status === 'failed') {
    return hasMondayItem ? 'files_pending' : 'received';
  }
  // Already in the claimable set (received / item_created / files_pending).
  return status;
}
