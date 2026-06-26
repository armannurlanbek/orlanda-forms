import { describe, expect, it } from 'vitest';
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  backoffMs,
  computeBackoff,
  decideFinalStatus,
  reentryStatus,
} from './status';

describe('backoffMs', () => {
  it('is 5s on the first failure (attempts=0)', () => {
    expect(backoffMs(0)).toBe(BACKOFF_BASE_MS);
  });

  it('doubles per attempt', () => {
    expect(backoffMs(1)).toBe(2 * BACKOFF_BASE_MS); // 10s
    expect(backoffMs(2)).toBe(4 * BACKOFF_BASE_MS); // 20s
    expect(backoffMs(3)).toBe(8 * BACKOFF_BASE_MS); // 40s
    expect(backoffMs(4)).toBe(16 * BACKOFF_BASE_MS); // 80s
  });

  it('caps at 10 minutes', () => {
    // 2^7 * 5s = 640s > 600s cap.
    expect(backoffMs(7)).toBe(BACKOFF_CAP_MS);
    expect(backoffMs(100)).toBe(BACKOFF_CAP_MS);
    expect(backoffMs(1_000_000)).toBe(BACKOFF_CAP_MS);
  });

  it('clamps negative / fractional attempts to the floor', () => {
    expect(backoffMs(-5)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(1.9)).toBe(2 * BACKOFF_BASE_MS);
  });

  it('never returns NaN or a non-finite value', () => {
    for (const a of [0, 1, 5, 10, 31, 64, 1e9]) {
      const v = backoffMs(a);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe('computeBackoff', () => {
  it('returns a Date offset from now by backoffMs', () => {
    const now = new Date('2026-06-25T00:00:00.000Z');
    expect(computeBackoff(0, now).getTime()).toBe(now.getTime() + BACKOFF_BASE_MS);
    expect(computeBackoff(2, now).getTime()).toBe(now.getTime() + 4 * BACKOFF_BASE_MS);
  });
});

describe('decideFinalStatus', () => {
  it('mapped when all files uploaded, nothing dropped, no terminal failure', () => {
    expect(
      decideFinalStatus({
        hadDroppedColumns: false,
        totalFiles: 3,
        uploadedFiles: 3,
        hadTerminalFileFailure: false,
      }),
    ).toBe('mapped');
  });

  it('mapped when there are no files at all and nothing dropped', () => {
    expect(
      decideFinalStatus({
        hadDroppedColumns: false,
        totalFiles: 0,
        uploadedFiles: 0,
        hadTerminalFileFailure: false,
      }),
    ).toBe('mapped');
  });

  it('files_pending when files remain and none terminally failed', () => {
    expect(
      decideFinalStatus({
        hadDroppedColumns: false,
        totalFiles: 3,
        uploadedFiles: 1,
        hadTerminalFileFailure: false,
      }),
    ).toBe('files_pending');
  });

  it('files_pending even when columns were dropped, while files still upload', () => {
    // Dropped columns only matter once the file step is done; keep it resumable.
    expect(
      decideFinalStatus({
        hadDroppedColumns: true,
        totalFiles: 2,
        uploadedFiles: 0,
        hadTerminalFileFailure: false,
      }),
    ).toBe('files_pending');
  });

  it('partial when columns were dropped but all files uploaded', () => {
    expect(
      decideFinalStatus({
        hadDroppedColumns: true,
        totalFiles: 1,
        uploadedFiles: 1,
        hadTerminalFileFailure: false,
      }),
    ).toBe('partial');
  });

  it('partial when a file terminally failed (even with files still outstanding)', () => {
    // A terminal file failure ends the file step — no point staying pending.
    expect(
      decideFinalStatus({
        hadDroppedColumns: false,
        totalFiles: 3,
        uploadedFiles: 2,
        hadTerminalFileFailure: true,
      }),
    ).toBe('partial');
  });

  it('partial when a file terminally failed and nothing else is wrong', () => {
    expect(
      decideFinalStatus({
        hadDroppedColumns: false,
        totalFiles: 2,
        uploadedFiles: 2,
        hadTerminalFileFailure: true,
      }),
    ).toBe('partial');
  });
});

describe('reentryStatus', () => {
  it('resumes a partial submission at the file step (item already exists)', () => {
    expect(reentryStatus('partial', true)).toBe('files_pending');
  });

  it('restarts a failed submission from the top when no item was created', () => {
    expect(reentryStatus('failed', false)).toBe('received');
  });

  it('resumes a failed submission at the file step if an item somehow exists', () => {
    expect(reentryStatus('failed', true)).toBe('files_pending');
  });

  it('never re-enters a fully-mapped submission', () => {
    expect(reentryStatus('mapped', true)).toBe('mapped');
  });

  it('leaves already-claimable states unchanged', () => {
    expect(reentryStatus('received', false)).toBe('received');
    expect(reentryStatus('item_created', true)).toBe('item_created');
    expect(reentryStatus('files_pending', true)).toBe('files_pending');
  });
});
