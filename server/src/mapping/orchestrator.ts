// Mapping orchestrator — the single branch point between Direct (§12) and AI
// (§18) mapping. Consumed by BOTH the submission worker (which then writes to
// Monday) and the builder preview-mapping endpoint (which does NOT). Keeping it
// here means preview and the real write can never diverge.

import type {
  AllowlistColumn,
  AnswersMap,
  ColumnValues,
  DroppedColumn,
  MappingMode,
  MondayBoardSchema,
  QuestionDef,
} from '@orlanda/shared';
import { buildDirectColumnValues, type DirectMapping } from '../monday/direct';
import { formatColumnValue } from '../monday/formatter';
import { resolveLinkedItem } from '../monday/linkedItems';
import { runAiMapping } from '../ai/engine';

export interface BuildMappingResult {
  itemName: string;
  columnValues: ColumnValues;
  dropped: DroppedColumn[];
  reasoning: string | null;
  /** questionId -> file columnId for the post-item assets flow (§13.3). */
  fileColumnsByQuestionId: Record<string, string>;
  renderedPrompt: string | null; // audit (§18.9), AI mode only
  rawResponse: string | null; // audit (§18.9), AI mode only
}

export interface BuildMappingParams {
  mappingMode: MappingMode;
  formTitle: string;
  questions: QuestionDef[];
  answers: AnswersMap;
  schema: MondayBoardSchema;
  /**
   * Per-question Direct mappings. In BOTH modes, attachment questions carry a
   * file-column mapping here (the AI never touches files — §12.2). In Direct
   * mode this also carries every non-file column mapping.
   */
  directMappingByQuestionId: Record<string, DirectMapping>;
  /** AI mode only: governing prompt + the writable-column allowlist (§18.3). */
  ai?: { aiPrompt: string; allowlist: AllowlistColumn[] };
}

function defaultItemName(formTitle: string): string {
  return `${formTitle} — ${new Date().toISOString().slice(0, 10)}`;
}

/** Collect attachment->file-column mappings (always Direct, both modes). */
function fileColumns(directMappingByQuestionId: Record<string, DirectMapping>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [qid, m] of Object.entries(directMappingByQuestionId)) {
    if (m.columnType === 'file') out[qid] = m.columnId;
  }
  return out;
}

export async function buildMapping(params: BuildMappingParams): Promise<BuildMappingResult> {
  if (params.mappingMode === 'direct') {
    const r = buildDirectColumnValues({
      questions: params.questions,
      answers: params.answers,
      directMappingByQuestionId: params.directMappingByQuestionId,
      schema: params.schema,
      formTitle: params.formTitle,
    });

    // Resolve board-relation/connect links (name -> linked item id). On no/
    // ambiguous match the link is skipped and recorded -> submission ends partial.
    const columnValues = { ...r.columnValues };
    const dropped = [...r.dropped];
    for (const link of r.pendingLinks) {
      if (!link.boardId) {
        dropped.push({ columnId: link.columnId, reason: 'no linked board configured for this column' });
        continue;
      }
      const res = await resolveLinkedItem(link.boardId, link.query, { threshold: link.threshold });
      if (res.itemId) {
        const formatted = formatColumnValue('board_relation', res.itemId);
        if (formatted.ok) columnValues[link.columnId] = formatted.value;
        else dropped.push({ columnId: link.columnId, reason: formatted.reason });
      } else {
        dropped.push({ columnId: link.columnId, reason: `link not set for "${link.query}": ${res.reason}` });
      }
    }

    return {
      itemName: r.itemName,
      columnValues,
      dropped,
      reasoning: null,
      fileColumnsByQuestionId: r.fileColumnsByQuestionId,
      renderedPrompt: null,
      rawResponse: null,
    };
  }

  // AI mode (§18). File columns still come from the Direct mapping.
  if (!params.ai) throw new Error('AI mapping requires ai params (aiPrompt + allowlist)');
  const res = await runAiMapping({
    aiPrompt: params.ai.aiPrompt,
    allowlist: params.ai.allowlist,
    questions: params.questions,
    answers: params.answers,
    defaultItemName: defaultItemName(params.formTitle),
  });
  return {
    itemName: res.itemName,
    columnValues: res.columnValues,
    dropped: res.dropped,
    reasoning: res.reasoning,
    fileColumnsByQuestionId: fileColumns(params.directMappingByQuestionId),
    renderedPrompt: res.renderedPrompt,
    rawResponse: res.rawResponse,
  };
}
