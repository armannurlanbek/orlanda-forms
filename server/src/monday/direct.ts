// Direct-mode column_values builder (§12 / §14.2.3). Pure — no network.
//
// Walks the form's questions + the client's validated answers and the per-
// question Direct mapping, producing the plain column_values object (keyed by
// columnId) that the caller JSON.stringify()'s once into the create_item
// variable. File-column mappings are NOT placed in column_values (§12.2); they
// are returned separately so the caller can run the assets flow after the item
// exists (§13.3). Values that fail the §12 per-type shape/label check are
// dropped into `dropped` (§12.1 / §18.7), never sent malformed.
//
// The mapper dispatches purely on the STORED columnType (§12.3); it never
// re-derives a column's type from the live schema. The schema is consulted only
// to resolve allowedLabels for status/dropdown columns.

import {
  isLinkColumn,
  type AnswersMap,
  type ColumnValues,
  type DroppedColumn,
  type MondayBoardSchema,
  type QuestionDef,
} from '@orlanda/shared';
import { formatColumnValue, parseAllowedLabels, parseLinkedBoardIds } from './formatter';

/** Per-question Direct mapping, as stored on Question.directMapping (§12.3). */
export interface DirectMapping {
  columnId: string;
  columnType: string;
  /** ISO-2 default country for phone columns (§12.3). */
  countryShortName?: string;
  /** Board-relation/connect columns: resolve the answer to a linked item (by
   *  name) on `boardId`. boardId may be omitted and derived from settings_str. */
  link?: { boardId?: string; threshold?: number };
}

/**
 * A board-relation/connect mapping that needs an async name->item-id lookup
 * before its value can be written. Resolved by the orchestrator (§ linked items).
 */
export interface PendingLink {
  columnId: string;
  questionId: string;
  boardId: string | null;
  query: string;
  threshold?: number;
}

export interface BuildDirectParams {
  questions: QuestionDef[];
  answers: AnswersMap;
  directMappingByQuestionId: Record<string, DirectMapping>;
  schema: MondayBoardSchema;
  formTitle: string;
}

export interface BuildDirectResult {
  itemName: string;
  columnValues: ColumnValues;
  dropped: DroppedColumn[];
  /** questionId -> file columnId, for the post-item assets flow (§13.3). */
  fileColumnsByQuestionId: Record<string, string>;
  /** board-relation/connect mappings needing async name resolution. */
  pendingLinks: PendingLink[];
}

/** Extract the human value an answer carries, normalized for the formatter. */
function humanValueFor(answer: AnswersMap[string]): unknown {
  switch (answer.type) {
    case 'text':
    case 'long_text':
    case 'single_select':
      return answer.value;
    case 'number':
      return answer.value;
    case 'multi_select':
      return answer.value; // array — dropdown formatter expects an array
    case 'attachment':
      // Attachments never produce a column_values entry (handled separately).
      return answer.attachmentIds;
    default:
      return undefined;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Build the Direct-mode column_values for a submission (§12).
 *
 * For each answered question with a mapping:
 *  - file columns are recorded into `fileColumnsByQuestionId` and EXCLUDED from
 *    column_values (§12.2);
 *  - everything else is run through `formatColumnValue(columnType, humanValue,
 *    { allowedLabels, countryShortName })`. On `ok:false` it is pushed to
 *    `dropped` with the formatter's reason.
 *
 * `itemName` is the first non-empty text/long_text answer, else
 * `"<formTitle> — <YYYY-MM-DD>"`.
 */
export function buildDirectColumnValues(params: BuildDirectParams): BuildDirectResult {
  const { questions, answers, directMappingByQuestionId, schema, formTitle } = params;

  const columnValues: ColumnValues = {};
  const dropped: DroppedColumn[] = [];
  const fileColumnsByQuestionId: Record<string, string> = {};
  const pendingLinks: PendingLink[] = [];
  const columnById = new Map(schema.columns.map((c) => [c.id, c]));

  let itemName = '';

  for (const q of questions) {
    const answer = answers[q.id];
    if (answer === undefined) continue;

    // Capture item-name candidate from the first non-empty text/long_text answer.
    if (!itemName && (answer.type === 'text' || answer.type === 'long_text') && isNonEmptyString(answer.value)) {
      itemName = answer.value.trim();
    }

    const mapping = directMappingByQuestionId[q.id];
    if (!mapping) continue;

    // File columns are set via the assets flow, never via column_values (§12.2).
    if (mapping.columnType === 'file') {
      fileColumnsByQuestionId[q.id] = mapping.columnId;
      continue;
    }

    // Board-relation/connect columns need an async name->item-id lookup; emit a
    // pending link for the orchestrator to resolve, instead of formatting now.
    if (isLinkColumn(mapping.columnType)) {
      const schemaCol = columnById.get(mapping.columnId);
      const boardId =
        mapping.link?.boardId ?? parseLinkedBoardIds(schemaCol?.settings_str)[0] ?? null;
      const query = String(humanValueFor(answer) ?? '').trim();
      if (query) {
        pendingLinks.push({
          columnId: mapping.columnId,
          questionId: q.id,
          boardId,
          query,
          threshold: mapping.link?.threshold,
        });
      }
      continue;
    }

    const humanValue = humanValueFor(answer);

    // Resolve allowed labels from the schema column's verbatim settings_str.
    const schemaCol = columnById.get(mapping.columnId);
    const allowedLabels = schemaCol
      ? parseAllowedLabels(schemaCol.settings_str, mapping.columnType)
      : [];

    const result = formatColumnValue(mapping.columnType, humanValue, {
      allowedLabels: allowedLabels.length > 0 ? allowedLabels : undefined,
      countryShortName: mapping.countryShortName,
    });

    if (!result.ok) {
      dropped.push({ columnId: mapping.columnId, reason: result.reason });
      continue;
    }
    columnValues[mapping.columnId] = result.value;
  }

  if (!itemName) {
    itemName = `${formTitle} — ${new Date().toISOString().slice(0, 10)}`;
  }

  return { itemName, columnValues, dropped, fileColumnsByQuestionId, pendingLinks };
}
