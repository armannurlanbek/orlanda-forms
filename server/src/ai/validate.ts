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
    // wire-shaped object (e.g. { label } / { date }) for a scalar column is a
    // contract violation → drop.
    if (isLikelyWireShape(col.type, rawValue)) {
      dropped.push({ columnId, reason: 'model emitted Monday wire JSON instead of a human value' });
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

// Heuristic: detect the model returning wire JSON for a scalar column type.
function isLikelyWireShape(columnType: string, value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as object);
  if (columnType === 'status' && keys.includes('label')) return true;
  if (columnType === 'numbers') return true; // numbers must be a JSON number, not an object
  if (columnType === 'text' || columnType === 'long_text') return true; // must be a string
  return false;
}
