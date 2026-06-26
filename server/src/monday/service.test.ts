import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── In-memory BoardSchemaCache stand-in (mock Prisma before importing service) ─
interface CacheRow {
  boardId: string;
  schema: unknown;
  fetchedAt: Date;
}
const cacheStore = new Map<string, CacheRow>();
const upsertSpy = vi.fn();
const fetchFindSpy = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    boardSchemaCache: {
      findUnique: async ({ where }: { where: { boardId: string } }) => {
        fetchFindSpy(where.boardId);
        return cacheStore.get(where.boardId) ?? null;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { boardId: string };
        create: CacheRow;
        update: { schema: unknown; fetchedAt: Date };
      }) => {
        upsertSpy(where.boardId);
        const existing = cacheStore.get(where.boardId);
        if (existing) {
          existing.schema = update.schema;
          existing.fetchedAt = update.fetchedAt;
        } else {
          cacheStore.set(where.boardId, { ...create });
        }
        return cacheStore.get(where.boardId)!;
      },
      deleteMany: async ({ where }: { where: { boardId: string } }) => {
        cacheStore.delete(where.boardId);
        return { count: 1 };
      },
    },
  },
}));

import {
  SCHEMA_TTL_MS,
  addFileToColumn,
  createItem,
  fetchBoardSchema,
  getBoardSchema,
  invalidateBoardSchema,
  itemUrl,
  listBoards,
  sanitizeFilename,
} from './service';
import { MondayError } from './errors';

const BOARD_DATA = {
  boards: [
    {
      id: '99',
      name: 'Board 99',
      columns: [{ id: 'status_x', title: 'Status', type: 'status', settings_str: '{"labels":{"0":"New","1":"Done"}}' }],
      groups: [{ id: 'g1', title: 'Group 1' }],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  cacheStore.clear();
  upsertSpy.mockClear();
  fetchFindSpy.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listBoards', () => {
  it('returns id+name pairs and drops empty ids', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { boards: [{ id: '1', name: 'A' }, { id: '', name: 'X' }] } }));
    const boards = await listBoards();
    expect(boards).toEqual([{ id: '1', name: 'A' }]);
  });
});

describe('fetchBoardSchema (raw, no cache)', () => {
  it('maps the GraphQL response and never reads the cache', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: BOARD_DATA }));
    const schema = await fetchBoardSchema('99');
    expect(schema.id).toBe('99');
    expect(schema.columns[0].id).toBe('status_x');
    expect(fetchFindSpy).not.toHaveBeenCalled();
  });
});

describe('getBoardSchema — cache + TTL + single-flight (§15.2)', () => {
  it('fetches on a cold miss and stores into the cache', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: BOARD_DATA }));
    const schema = await getBoardSchema('99');
    expect(schema.id).toBe('99');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  it('serves a fresh cached row without hitting the network', async () => {
    cacheStore.set('99', { boardId: '99', schema: BOARD_DATA.boards[0], fetchedAt: new Date() });
    const schema = await getBoardSchema('99');
    expect(schema.id).toBe('99');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches when the cached row is older than the TTL', async () => {
    cacheStore.set('99', {
      boardId: '99',
      schema: BOARD_DATA.boards[0],
      fetchedAt: new Date(Date.now() - SCHEMA_TTL_MS - 1000),
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: BOARD_DATA }));
    await getBoardSchema('99');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('single-flights: concurrent callers past TTL trigger exactly one fetch', async () => {
    let resolveFetch: (v: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const p1 = getBoardSchema('77');
    const p2 = getBoardSchema('77');
    const p3 = getBoardSchema('77');
    resolveFetch(jsonResponse({ data: { boards: [{ ...BOARD_DATA.boards[0], id: '77' }] } }));
    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.id).toBe('77');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('forceRefresh bypasses a fresh cached row and refetches', async () => {
    cacheStore.set('99', { boardId: '99', schema: BOARD_DATA.boards[0], fetchedAt: new Date() });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: BOARD_DATA }));
    await getBoardSchema('99', { forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('invalidateBoardSchema (§15.2.2/.3)', () => {
  it('removes the cached row so the next call refetches', async () => {
    cacheStore.set('99', { boardId: '99', schema: BOARD_DATA.boards[0], fetchedAt: new Date() });
    await invalidateBoardSchema('99');
    expect(cacheStore.has('99')).toBe(false);
  });
});

describe('createItem — column_values serialization (§12.4)', () => {
  it('passes column_values as a single JSON-string variable (no double-stringify)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { create_item: { id: '555' } } }));
    const columnValues = { status_x: { label: 'Done' }, text_x: 'hi' };
    const { itemId } = await createItem({ boardId: '99', itemName: 'Item', columnValues });
    expect(itemId).toBe('555');

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // column_values is a STRING, and parsing it reproduces the plain object.
    expect(typeof sentBody.variables.columnValues).toBe('string');
    expect(JSON.parse(sentBody.variables.columnValues)).toEqual(columnValues);
    // Nested objects must not be pre-stringified.
    expect(JSON.parse(sentBody.variables.columnValues).status_x).toEqual({ label: 'Done' });
  });

  it('passes groupId through when provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { create_item: { id: '1' } } }));
    await createItem({ boardId: '99', itemName: 'X', columnValues: {}, groupId: 'g1' });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.variables.groupId).toBe('g1');
  });

  it('throws (retryable) when the body has no create_item id even on HTTP 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { create_item: null } }));
    await expect(createItem({ boardId: '99', itemName: 'X', columnValues: {} })).rejects.toMatchObject({
      retryable: true,
    });
  });
});

describe('error classification surfaced through the client (§14.4)', () => {
  it('classifies ComplexityException as retryable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'ComplexityException: budget exhausted' }] }));
    await expect(createItem({ boardId: '99', itemName: 'X', columnValues: {} })).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('classifies a validation/invalid-label error as terminal (non-retryable)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: [{ message: 'invalid value, please check your label' }] }),
    );
    await expect(createItem({ boardId: '99', itemName: 'X', columnValues: {} })).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('treats HTTP 5xx as retryable regardless of body terseness', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'oops' }] }, 502));
    await expect(createItem({ boardId: '99', itemName: 'X', columnValues: {} })).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('treats a network failure as a retryable MondayError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const err = await createItem({ boardId: '99', itemName: 'X', columnValues: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(MondayError);
    expect(err.retryable).toBe(true);
  });
});

describe('addFileToColumn (§13.3)', () => {
  it('uploads a file via multipart and returns the asset id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { add_file_to_column: { id: 'asset_1' } } }));
    const { assetId } = await addFileToColumn({
      itemId: '555',
      columnId: 'files_x',
      file: Buffer.from('hello'),
      filename: 'report.pdf',
      mimeType: 'application/pdf',
    });
    expect(assetId).toBe('asset_1');
    // No JSON Content-Type header (fetch sets the multipart boundary).
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers.Authorization).toBeTruthy();
  });

  it('propagates a terminal Monday error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'unknown column' }] }));
    await expect(
      addFileToColumn({ itemId: '1', columnId: 'c', file: Buffer.from('x'), filename: 'a.png', mimeType: 'image/png' }),
    ).rejects.toMatchObject({ retryable: false });
  });
});

describe('sanitizeFilename', () => {
  it('strips path separators and traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a/b/c\\d.txt')).toBe('d.txt');
  });
  it('strips NUL and CR/LF', () => {
    expect(sanitizeFilename('na me\r\n.txt')).toBe('name.txt');
  });
  it('falls back to "file" for empty/dot names', () => {
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('...')).toBe('file');
  });
  it('caps very long names', () => {
    expect(sanitizeFilename('a'.repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe('itemUrl', () => {
  it('builds the deep link', () => {
    expect(itemUrl('99', '555')).toBe('https://monday.com/boards/99/pulses/555');
  });
});
