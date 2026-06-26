// High-level Monday service (§6 / §11 / §13.3 / §15.2). The ONLY module the rest
// of the server uses to talk to Monday. Tokens never leave here.
//
// Exposes board listing, schema fetch with a single-flight cache (BoardSchemaCache,
// ~10-min TTL), item creation (column_values as one JSON-string variable per §12.4),
// and the two-step file-to-column assets flow (§13.3).

import type { MondayBoardSchema } from '@orlanda/shared';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../db/prisma';
import { mondayGraphQL } from './client';
import { MondayError, classifyMondayBody } from './errors';
import { BoardResponse, parseBoardResponse } from './schema';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const API_VERSION = '2024-10';
const FILE_UPLOAD_TIMEOUT_MS = 60_000;

/** Cache freshness window for board schemas (§15.2 / §20: ~10 min). */
export const SCHEMA_TTL_MS = 10 * 60 * 1000;

// ── Board listing ────────────────────────────────────────────────────────────

interface BoardsListResponse {
  boards?: { id?: unknown; name?: unknown }[] | null;
}

const LIST_BOARDS_QUERY = `
  query ListBoards {
    boards(limit: 200, state: active, order_by: used_at) {
      id
      name
    }
  }
`;

/** List the boards the configured token can see. */
export async function listBoards(): Promise<{ id: string; name: string }[]> {
  const data = await mondayGraphQL<BoardsListResponse>(LIST_BOARDS_QUERY);
  const boards = Array.isArray(data.boards) ? data.boards : [];
  return boards
    .map((b) => ({ id: String(b?.id ?? ''), name: String(b?.name ?? '') }))
    .filter((b) => b.id.length > 0);
}

// ── Board schema (raw fetch) ─────────────────────────────────────────────────

const BOARD_SCHEMA_QUERY = `
  query BoardSchema($ids: [ID!]) {
    boards(ids: $ids) {
      id
      name
      columns {
        id
        title
        type
        settings_str
      }
      groups {
        id
        title
      }
    }
  }
`;

/** Fetch a board's schema directly from Monday — no cache (§15.2). */
export async function fetchBoardSchema(boardId: string): Promise<MondayBoardSchema> {
  const data = await mondayGraphQL<BoardResponse>(BOARD_SCHEMA_QUERY, { ids: [boardId] });
  return parseBoardResponse(data);
}

// ── Board schema (cached, single-flight) ─────────────────────────────────────

/**
 * In-flight fetch registry keyed by boardId so concurrent callers past the TTL
 * trigger EXACTLY ONE Monday fetch and the rest await the same promise (§15.2.1).
 * Process-local; the DB row (BoardSchemaCache) is the cross-process/TTL store.
 */
const inflight = new Map<string, Promise<MondayBoardSchema>>();

function isFresh(fetchedAt: Date): boolean {
  return Date.now() - fetchedAt.getTime() < SCHEMA_TTL_MS;
}

/** Fetch from Monday, persist into BoardSchemaCache, and return the schema. */
async function refreshAndStore(boardId: string): Promise<MondayBoardSchema> {
  const schema = await fetchBoardSchema(boardId);
  await prisma.boardSchemaCache.upsert({
    where: { boardId },
    create: { boardId, schema: schema as unknown as object, fetchedAt: new Date() },
    update: { schema: schema as unknown as object, fetchedAt: new Date() },
  });
  return schema;
}

/**
 * Get a board's schema via the BoardSchemaCache (§15.2).
 *
 * - Serves a cached row while it is within TTL (~10 min).
 * - On a miss/stale row (or `forceRefresh`), fetches from Monday.
 * - Single-flight: concurrent callers for the same boardId that need a fetch
 *   await one shared in-flight promise — no thundering herd.
 */
export async function getBoardSchema(
  boardId: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<MondayBoardSchema> {
  if (!opts.forceRefresh) {
    const cached = await prisma.boardSchemaCache.findUnique({ where: { boardId } });
    if (cached && isFresh(cached.fetchedAt)) {
      return cached.schema as unknown as MondayBoardSchema;
    }
  }

  // Coalesce concurrent fetches for the same board onto one promise.
  const existing = inflight.get(boardId);
  if (existing && !opts.forceRefresh) return existing;

  const promise = refreshAndStore(boardId).finally(() => {
    // Only clear the slot if it still points at this promise (avoids clobbering
    // a newer force-refresh that overwrote it).
    if (inflight.get(boardId) === promise) inflight.delete(boardId);
  });
  inflight.set(boardId, promise);
  return promise;
}

/** Drop the cached schema row for a board (§15.2.2 / §15.2.3). */
export async function invalidateBoardSchema(boardId: string): Promise<void> {
  inflight.delete(boardId);
  await prisma.boardSchemaCache.deleteMany({ where: { boardId } });
}

// ── Item creation ────────────────────────────────────────────────────────────

interface CreateItemResponse {
  create_item?: { id?: unknown } | null;
}

const CREATE_ITEM_MUTATION = `
  mutation CreateItem($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON) {
    create_item(
      board_id: $boardId
      group_id: $groupId
      item_name: $itemName
      column_values: $columnValues
      create_labels_if_missing: false
    ) {
      id
    }
  }
`;

/**
 * Create an item on a board (§6 / §12.4). `columnValues` is the plain object
 * keyed by columnId; it is serialized ONCE here with JSON.stringify() and passed
 * as a single JSON-string GraphQL variable. Nested values (e.g. status) are NOT
 * double-stringified.
 *
 * Success requires an `errors`-free body AND a `create_item.id` (§14.4.3).
 */
export async function createItem(input: {
  boardId: string;
  itemName: string;
  columnValues: Record<string, unknown>;
  groupId?: string;
}): Promise<{ itemId: string }> {
  const data = await mondayGraphQL<CreateItemResponse>(CREATE_ITEM_MUTATION, {
    boardId: input.boardId,
    groupId: input.groupId ?? null,
    itemName: input.itemName,
    columnValues: JSON.stringify(input.columnValues ?? {}),
  });

  const itemId = data?.create_item?.id;
  if (itemId === undefined || itemId === null || String(itemId).length === 0) {
    // errors-free 200 but no entity id — not success (§14.4.3). Transient.
    throw new MondayError('create_item returned no item id', { retryable: true, raw: data });
  }
  return { itemId: String(itemId) };
}

// ── File-to-column assets flow (§13.3) ───────────────────────────────────────

const ADD_FILE_MUTATION =
  'mutation AddFileToColumn($itemId: ID!, $columnId: String!, $file: File!) {' +
  ' add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) { id } }';

/**
 * Sanitize an uploaded filename before it crosses into the multipart request:
 * strip path separators, `..`, NUL, and CR/LF; cap length. Never trust the
 * client-supplied name.
 */
export function sanitizeFilename(name: string): string {
  let n = (name ?? '').replace(/[ \x00-\x1f\x7f]/g, '');
  // Drop any directory component (handles both / and \ separators).
  n = n.split(/[\\/]/).pop() ?? '';
  // Collapse any residual `..` sequences.
  n = n.replace(/\.{2,}/g, '.');
  n = n.trim();
  if (!n || n === '.' ) n = 'file';
  if (n.length > 200) {
    const dot = n.lastIndexOf('.');
    if (dot > 0 && n.length - dot <= 12) {
      const ext = n.slice(dot);
      n = n.slice(0, 200 - ext.length) + ext;
    } else {
      n = n.slice(0, 200);
    }
  }
  return n;
}

interface AddFileResponse {
  add_file_to_column?: { id?: unknown } | null;
}

/**
 * Upload one file to a `file` column on an existing item (§13.3). Distinct
 * multipart request to the Monday file API (GraphQL multipart spec). The item
 * MUST already exist (the caller guarantees this). Token never logged.
 *
 * Success requires an `errors`-free body AND an `add_file_to_column.id`.
 */
export async function addFileToColumn(input: {
  itemId: string;
  columnId: string;
  file: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ assetId: string }> {
  const filename = sanitizeFilename(input.filename);
  const variables = {
    itemId: input.itemId,
    columnId: input.columnId,
    // `file` is supplied via the multipart `map` referencing variables.file.
    file: null,
  };

  const form = new FormData();
  form.append('query', ADD_FILE_MUTATION);
  form.append('variables', JSON.stringify(variables));
  form.append('map', JSON.stringify({ image: ['variables.file'] }));
  const blob = new Blob([new Uint8Array(input.file)], { type: input.mimeType || 'application/octet-stream' });
  form.append('image', blob, filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FILE_UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: env.MONDAY_API_TOKEN,
        'API-Version': API_VERSION,
        // NOTE: do NOT set Content-Type; fetch sets the multipart boundary.
      },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    const message = aborted ? 'Monday file upload timed out' : 'Monday file upload network error';
    logger.warn({ msg: message }, 'monday file upload failed (transport)');
    throw new MondayError(message, { retryable: true });
  } finally {
    clearTimeout(timer);
  }

  let body: { data?: AddFileResponse; errors?: unknown; error_message?: unknown; error_code?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new MondayError(`Monday file upload returned an unparseable response (HTTP ${res.status})`, {
      retryable: res.status >= 500 || res.status === 429,
    });
  }

  const classification = classifyMondayBody(body);
  if (!classification.ok && classification.error) {
    if ((res.status >= 500 || res.status === 429) && !classification.error.retryable) {
      classification.error.retryable = true;
    }
    logger.warn({ msg: classification.error.message, retryable: classification.error.retryable }, 'monday file upload error');
    throw classification.error;
  }

  const assetId = body?.data?.add_file_to_column?.id;
  if (assetId === undefined || assetId === null || String(assetId).length === 0) {
    throw new MondayError('add_file_to_column returned no asset id', { retryable: true, raw: body });
  }
  return { assetId: String(assetId) };
}

// ── Deep link ────────────────────────────────────────────────────────────────

/** Best-effort deep link to an item (§3 / §11.3 surfacing). */
export function itemUrl(boardId: string, itemId: string): string {
  return `https://monday.com/boards/${boardId}/pulses/${itemId}`;
}
