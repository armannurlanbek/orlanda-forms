// Board-schema mapping helpers (§6 / §18.3). Pure — no network.
//
// `parseBoardResponse` maps the raw `boards(...)` GraphQL `data` payload into the
// shared MondayBoardSchema contract. `toAllowlistColumns` resolves the AI
// writable-column allowlist ({columnId, title, type, allowedLabels}) using
// parseAllowedLabels from the frozen formatter.

import type { AllowlistColumn, MondayBoardSchema, MondayColumn, MondayGroup } from '@orlanda/shared';
import { parseAllowedLabels } from './formatter';

interface RawColumn {
  id?: unknown;
  title?: unknown;
  type?: unknown;
  settings_str?: unknown;
}
interface RawGroup {
  id?: unknown;
  title?: unknown;
}
interface RawBoard {
  id?: unknown;
  name?: unknown;
  columns?: unknown;
  groups?: unknown;
}

/** Shape of `data` returned by `boards(ids:[ID]){ ... }`. */
export interface BoardResponse {
  boards?: RawBoard[] | null;
}

function asStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * Map a raw `boards(...)` response `data` payload into a MondayBoardSchema.
 * Throws if the board is missing (e.g. unknown id / no access) so the caller
 * can surface a clear error rather than caching an empty schema.
 */
export function parseBoardResponse(body: BoardResponse): MondayBoardSchema {
  const board = Array.isArray(body?.boards) ? body.boards[0] : undefined;
  if (!board) {
    throw new Error('Board not found or not accessible');
  }

  const columns: MondayColumn[] = Array.isArray(board.columns)
    ? (board.columns as RawColumn[]).map((c) => ({
        id: asStr(c.id),
        title: asStr(c.title),
        type: asStr(c.type),
        settings_str: typeof c.settings_str === 'string' ? c.settings_str : asStr(c.settings_str),
      }))
    : [];

  const groups: MondayGroup[] = Array.isArray(board.groups)
    ? (board.groups as RawGroup[]).map((g) => ({ id: asStr(g.id), title: asStr(g.title) }))
    : [];

  return {
    id: asStr(board.id),
    name: asStr(board.name),
    columns,
    groups,
  };
}

/**
 * Resolve the AI writable-column allowlist (§18.3) for the given columnIds,
 * pulling allowedLabels for status/dropdown columns from each column's
 * verbatim settings_str. Unknown columnIds are silently skipped.
 */
export function toAllowlistColumns(schema: MondayBoardSchema, columnIds: string[]): AllowlistColumn[] {
  const byId = new Map(schema.columns.map((c) => [c.id, c]));
  const out: AllowlistColumn[] = [];
  for (const id of columnIds) {
    const col = byId.get(id);
    if (!col) continue;
    const allowedLabels = parseAllowedLabels(col.settings_str, col.type);
    const entry: AllowlistColumn = { columnId: col.id, title: col.title, type: col.type };
    if (allowedLabels.length > 0) entry.allowedLabels = allowedLabels;
    out.push(entry);
  }
  return out;
}
