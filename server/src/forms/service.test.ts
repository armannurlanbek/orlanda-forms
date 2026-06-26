import { describe, it, expect, vi, beforeEach } from 'vitest';

// The authenticated submissions-list endpoint must confirm the form exists (and
// is not soft-deleted) BEFORE returning any submissions, so a missing form gives
// a consistent 404 (§16.5: 404, never 403) rather than an empty list. We mock
// prisma so this is a pure-logic check with no DB.
const { formFindFirstMock, submissionFindManyMock } = vi.hoisted(() => ({
  formFindFirstMock: vi.fn(),
  submissionFindManyMock: vi.fn(),
}));

vi.mock('../db/prisma', () => ({
  prisma: {
    form: { findFirst: formFindFirstMock },
    submission: { findMany: submissionFindManyMock },
  },
}));

import { listSubmissions } from './service';
import { AppError } from '../http/errors';

describe('listSubmissions — form-existence gate (§16.5)', () => {
  beforeEach(() => {
    formFindFirstMock.mockReset();
    submissionFindManyMock.mockReset();
  });

  it('throws 404 for a missing/soft-deleted form before querying submissions', async () => {
    formFindFirstMock.mockResolvedValue(null); // missing or deletedAt != null

    await expect(listSubmissions('missing-id')).rejects.toBeInstanceOf(AppError);
    await expect(listSubmissions('missing-id')).rejects.toMatchObject({ status: 404 });

    // The form lookup excludes soft-deleted rows...
    expect(formFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'missing-id', deletedAt: null },
    });
    // ...and the submissions query must never run for a missing form.
    expect(submissionFindManyMock).not.toHaveBeenCalled();
  });

  it('lists submissions only after confirming the form exists', async () => {
    formFindFirstMock.mockResolvedValue({ id: 'f1', boardId: null });
    submissionFindManyMock.mockResolvedValue([]);

    const rows = await listSubmissions('f1');

    expect(rows).toEqual([]);
    expect(formFindFirstMock).toHaveBeenCalledWith({ where: { id: 'f1', deletedAt: null } });
    expect(submissionFindManyMock).toHaveBeenCalledTimes(1);
  });
});
