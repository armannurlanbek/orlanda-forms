import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// DELETE /api/submissions/:id must not delete a submission a worker is actively
// processing (fresh `lockedAt`) — otherwise the row can vanish mid-create_item
// and orphan a Monday item (§14.2/§14.3) — and a row that disappears between the
// read and the delete (Prisma P2025) must map to 404, not 500. We mock prisma so
// these are pure-logic checks with no DB, and stub the auth/CSRF middleware +
// worker so the route can be exercised directly.
const { findUniqueMock, deleteMock, nudgeMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  deleteMock: vi.fn(),
  nudgeMock: vi.fn(),
}));

vi.mock('../db/prisma', () => ({
  prisma: {
    submission: { findUnique: findUniqueMock, delete: deleteMock },
  },
}));

vi.mock('../worker', () => ({ nudge: nudgeMock }));

// Pass-through auth/CSRF so the route logic (not the guards) is under test.
vi.mock('../auth/middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  csrfProtect: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { submissionsRouter, canDeleteSubmission } from './routes';
import { errorHandler } from '../http/errors';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/submissions', submissionsRouter);
  app.use(errorHandler);
  return app;
}

// Mirrors the worker's STALE_LOCK_MS (server/src/worker/index.ts) — a lock older
// than this belongs to a crashed worker and is safe to delete.
const STALE_LOCK_MS = 2 * 60_000;

describe('DELETE /api/submissions/:id', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    deleteMock.mockReset();
    nudgeMock.mockReset();
  });

  it('deletes a terminal/unlocked submission → 200 and calls prisma.delete', async () => {
    findUniqueMock.mockResolvedValue({ id: 's1', lockedAt: null });
    deleteMock.mockResolvedValue({ id: 's1' });

    const res = await request(makeApp()).delete('/api/submissions/s1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('deletes a submission whose lock is STALE (crashed worker) → 200', async () => {
    const staleLock = new Date(Date.now() - (STALE_LOCK_MS + 60_000));
    findUniqueMock.mockResolvedValue({ id: 's1', lockedAt: staleLock });
    deleteMock.mockResolvedValue({ id: 's1' });

    const res = await request(makeApp()).delete('/api/submissions/s1');

    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a submission with a FRESH lock → 409 and does NOT delete', async () => {
    findUniqueMock.mockResolvedValue({ id: 's1', lockedAt: new Date() });

    const res = await request(makeApp()).delete('/api/submissions/s1');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/still being processed/i);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing submission and never calls delete', async () => {
    findUniqueMock.mockResolvedValue(null);

    const res = await request(makeApp()).delete('/api/submissions/missing');

    expect(res.status).toBe(404);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('maps a delete race (Prisma P2025) to 404, not 500', async () => {
    findUniqueMock.mockResolvedValue({ id: 's1', lockedAt: null });
    deleteMock.mockRejectedValue({ code: 'P2025' });

    const res = await request(makeApp()).delete('/api/submissions/s1');

    expect(res.status).toBe(404);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('lets a non-P2025 delete error surface (500)', async () => {
    findUniqueMock.mockResolvedValue({ id: 's1', lockedAt: null });
    deleteMock.mockRejectedValue(new Error('connection reset'));

    const res = await request(makeApp()).delete('/api/submissions/s1');

    expect(res.status).toBe(500);
  });
});

describe('canDeleteSubmission', () => {
  const now = new Date('2026-07-08T00:00:00.000Z');

  it('allows deletion when there is no lock', () => {
    expect(canDeleteSubmission({ lockedAt: null }, now)).toBe(true);
  });

  it('refuses a fresh lock', () => {
    expect(canDeleteSubmission({ lockedAt: now }, now)).toBe(false);
  });

  it('treats the exact stale boundary as still-held (mirrors the worker strict check)', () => {
    const boundary = new Date(now.getTime() - STALE_LOCK_MS);
    expect(canDeleteSubmission({ lockedAt: boundary }, now)).toBe(false);
  });

  it('allows deletion once the lock is older than the stale window', () => {
    const stale = new Date(now.getTime() - (STALE_LOCK_MS + 1));
    expect(canDeleteSubmission({ lockedAt: stale }, now)).toBe(true);
  });
});
