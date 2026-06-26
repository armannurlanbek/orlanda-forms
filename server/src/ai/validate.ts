// AI mapping post-generation validation + conversion (§18.7). PURE — no SDK, no
// network. The model returns HUMAN values; this validates them against the
// allowlist + per-type rules and converts survivors to Monday wire shapes via
// the shared formatter. Anything failing either check is dropped and recorded.

import type { AllowlistColumn, DroppedColumn } from '@orlanda/shared';
import { formatColumnValue } from '../monday/formatter';

export interface AiToolInput {
  itemName?: unknown;
  columnValues?: unknown;
  reasoning?: unknown;
}

export interface MappingOutcome {
  itemName: string;
  /** wire-shaped column_values ready for create_item (after §12 conversion) */
  columnValues: Record<string, unknown>;
  dropped: DroppedColumn[];
  reasoning: string;
}

const DEFAULT_ITEM_NAME = 'Untitled submission';

export function validateAndConvertMapping(
  toolInput: AiToolInput,
  allowlist: AllowlistColumn[],
  opts: { defaultItemName?: string } = {},
): MappingOutcome {
  const byId = new Map(allowlist.map((c) => [c.columnId, c]));

  // Item name always maps; fall back to a default if empty (§18.7).
  const rawName = typeof toolInput.itemName === 'string' ? toolInput.itemName.trim() : '';
  const itemName = rawName || opts.defaultItemName?.trim() || DEFAULT_ITEM_NAME;

  const columnValues: Record<string, unknown> = {};
  const dropped: DroppedColumn[] = [];

  const cv =
    toolInput.columnValues && typeof toolInput.columnValues === 'object' && !Array.isArray(toolInput.columnValues)
      ? (toolInput.columnValues as Record<string, unknown>)
      : {};

  for (const [columnId, rawValue] of Object.entries(cv)) {
    const col = byId.get(columnId);
    if (!col) {
      dropped.push({ columnId, reason: 'column not in allowlist' });
      continue;
    }
    // The model must emit human values, not Monday wire JSON (§18.1). A
    // wire-shaped object/array (e.g. { label } / { date } / { item_ids }) for a
    // SCALAR column is a contract violation → drop, so a hallucinated wire shape
    // can never reach the formatter.
    if (isWireShapeForScalar(col.type, rawValue)) {
      dropped.push({
        columnId,
        reason: 'model emitted a wire-shaped object/array for a scalar column instead of a human value',
      });
      continue;
    }
    const res = formatColumnValue(col.type, rawValue, { allowedLabels: col.allowedLabels });
    if (res.ok) {
      columnValues[columnId] = res.value;
    } else {
      dropped.push({ columnId, reason: res.reason });
    }
  }

  const reasoning = typeof toolInput.reasoning === 'string' ? toolInput.reasoning : '';
  return { itemName, columnValues, dropped, reasoning };
}

// Column types whose LEGITIMATE value is a container (object/array): dropdown
// takes an array of labels (multi-value); board_relation/connect_boards take an
// array of item ids; timeline takes a { from, to } object. EVERY other column is
// SCALAR — its human value must be a primitive (string/number/boolean).
const CONTAINER_COLUMN_TYPES = new Set<string>([
  'dropdown',
  'board_relation',
  'connect_boards',
  'timeline',
]);

/**
 * Explicit, total rejection of wire-shaped values on scalar columns. The model
 * must emit HUMAN values, not Monday wire JSON (§18.1): a scalar column (text,
 * long_text, numbers, status, date, email, link, phone, checkbox) may ONLY
 * receive a primitive, so any object or array is a contract violation. This is a
 * default-deny check — anything that is not a known container type rejects
 * objects/arrays — so a hallucinated wire shape like {"item_ids":[999]},
 * {"label":"x"} or {"date":"..."} can never slip through to the formatter.
 */
function isWireShapeForScalar(columnType: string, value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false; // primitive/null — fine
  return !CONTAINER_COLUMN_TYPES.has(columnType); // object/array on a scalar column → reject
}
