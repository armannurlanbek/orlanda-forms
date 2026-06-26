// AI mapping engine (§18). Orchestrates: pre-call spend/size guards (§16.1),
// the daily-call ceiling (UsageCounter), the forced-tool-use Anthropic call with
// prompt caching (§18.2/§18.5), parsing of the tool_use block, the pure
// validate+convert step (§18.7, imported — frozen), and a single repair retry
// (§18.2). The API key never leaves the server and is never logged.
//
// Link columns (board_relation/connect_boards) extend this with a bounded
// multi-turn loop and a second tool, `search_linked_board`: the model searches
// the linked board by name, we return ranked candidates, and the model emits the
// chosen item id. We only accept ids we actually returned to the model this
// session (the per-board allow-set), so a hallucinated id can never be written.

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_GUARDS, isLinkColumn } from '@orlanda/shared';
import type { AllowlistColumn } from '@orlanda/shared';
import type { QuestionDef } from '@orlanda/shared';
import type { AnswersMap } from '@orlanda/shared';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { validateAndConvertMapping } from './validate';
import type { AiToolInput } from './validate';
import { AiError } from './errors';
import { buildStableBlock, buildUserContent } from './prompt';
import { formatColumnValue } from '../monday/formatter';
import { rankCandidates, searchBoardItemsByName } from '../monday/linkedItems';
import type { ScoredCandidate } from '../monday/linkedItems';

// Wave-2 agents depend on this EXACT shape — do not change it.
export interface AiMappingResult {
  itemName: string;
  columnValues: Record<string, unknown>; // wire-shaped, ready for create_item
  dropped: { columnId: string; reason: string }[];
  reasoning: string;
  renderedPrompt: string; // system+user, for audit (§18.9)
  rawResponse: string; // raw model output, for audit (§18.9)
}

const TOOL_NAME = 'emit_mapping';
const SEARCH_TOOL_NAME = 'search_linked_board';

// Cap on search round-trips before we force the final mapping (§18). Keeps cost
// bounded even if the model keeps asking to search.
const MAX_SEARCH_ROUNDS = 3;

// How many ranked candidates we surface per search (and add to the allow-set).
const TOP_CANDIDATES = 8;

// JSON schema for the forced tool. additionalProperties:false at the top level;
// columnValues itself allows additional properties (the model keys it by
// allow-listed columnId — the validator drops anything not on the allow-list).
export const EMIT_MAPPING_SCHEMA = {
  type: 'object' as const,
  properties: {
    itemName: {
      type: 'string',
      description: 'A short, human-readable title for the new board item.',
    },
    columnValues: {
      type: 'object',
      description:
        'Map of allow-listed columnId -> human value. Omit columns that have no fitting answer.',
      additionalProperties: true,
    },
    reasoning: {
      type: 'string',
      description: 'A brief explanation of how the answers were mapped to columns.',
    },
  },
  required: ['itemName', 'columnValues', 'reasoning'],
  additionalProperties: false,
};

const TOOL_DESCRIPTION =
  'Emit the mapping of this submission onto the allow-listed Monday.com columns. ' +
  'Provide an item name, the human values keyed by allow-listed columnId, and a brief reasoning.';

// JSON schema for the linked-board search tool (§18 linked-items). The model
// passes the boardId of a link column plus a candidate name from the answers; we
// return ranked items so the model can pick the right id.
export const SEARCH_LINKED_BOARD_SCHEMA = {
  type: 'object' as const,
  properties: {
    boardId: {
      type: 'string',
      description: 'The linkBoardId of the link column you are resolving.',
    },
    query: {
      type: 'string',
      description: 'The candidate name (from the answers) to search for on that board.',
    },
  },
  required: ['boardId', 'query'],
  additionalProperties: false,
};

const SEARCH_TOOL_DESCRIPTION =
  'Search a linked Monday.com board for items whose name matches a query. Returns ' +
  'the top candidates as {id, name, score}. Use the returned id for the link ' +
  "column in emit_mapping. Never invent an id — only use ids this tool returns.";

/**
 * PURE: extract the emit_mapping tool input from an Anthropic message shape.
 * Returns the tool input object when a usable `tool_use` block for our tool is
 * present, otherwise null (caller treats null as "no usable tool use" and
 * triggers the repair retry). No SDK/network — directly testable with a mocked
 * message object.
 */
export function parseToolUse(message: unknown): AiToolInput | null {
  const block = findToolUse(message, TOOL_NAME);
  if (!block) return null;
  const input = block.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return input as AiToolInput;
}

interface ToolUseBlock {
  id?: string;
  name: string;
  input: unknown;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** PURE: find the first tool_use block for `toolName` in a message's content. */
function findToolUse(message: unknown, toolName: string): ToolUseBlock | null {
  if (!message || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; name?: unknown; input?: unknown; id?: unknown };
    if (b.type !== 'tool_use') continue;
    if (b.name !== toolName) continue;
    return { id: typeof b.id === 'string' ? b.id : undefined, name: toolName, input: b.input };
  }
  return null;
}

/** PURE: every tool_use block in a message's content, in order. The model may
 *  issue several in one turn (parallel tool use); each one needs a tool_result. */
function findAllToolUse(message: unknown): ToolUseBlock[] {
  const out: ToolUseBlock[] = [];
  if (!message || typeof message !== 'object') return out;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; name?: unknown; input?: unknown; id?: unknown };
    if (b.type !== 'tool_use') continue;
    if (typeof b.name !== 'string') continue;
    out.push({ id: typeof b.id === 'string' ? b.id : undefined, name: b.name, input: b.input });
  }
  return out;
}

// UTC day key for the daily-call counter (§16.1). Stable, restart-safe.
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Counter key for today's AI-call reservation. Computed once per mapping so the
// reservation and any refund target the exact same row (no midnight drift).
function aiCallCounterKey(now: Date): string {
  return `ai-calls:${dayKey(now)}`;
}

/**
 * Atomically increment today's AI-call counter and enforce the daily ceiling
 * (§16.1/§18.8). Uses an upsert + post-increment read; if the new count exceeds
 * env.AI_DAILY_CALL_LIMIT we throw terminal so the call is never sent. The
 * pre-send reservation is concurrency-safe (two racing requests cannot both slip
 * past the boundary).
 */
async function enforceDailyCeiling(key: string): Promise<void> {
  const counter = await prisma.usageCounter.upsert({
    where: { key },
    create: { key, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (counter.count > env.AI_DAILY_CALL_LIMIT) {
    throw new AiError('AI daily limit reached', true);
  }
}

/**
 * Refund a previously reserved daily-call slot (§16.1). Called ONLY when the
 * Anthropic request itself fails (transport/SDK error) before producing a usable
 * response — i.e. the reserved slot was never spent. Best-effort: a failed
 * refund must never mask the original failure and never throws. We do NOT refund
 * on guard/ceiling rejections (those reject before any call) nor on a successful
 * call that merely returned an unusable tool block (that call consumed quota).
 */
async function refundDailyCeiling(key: string): Promise<void> {
  try {
    await prisma.usageCounter.update({
      where: { key },
      data: { count: { decrement: 1 } },
    });
  } catch {
    // Swallow — the counter drifting up by one is preferable to masking the real
    // Anthropic failure or crashing the worker.
  }
}

// Size guards (§16.1/§18.8) applied BEFORE the call. Throw terminal on breach so
// an oversized/abusive prompt is never sent.
function enforceInputGuards(params: {
  allowlist: AllowlistColumn[];
  questions: QuestionDef[];
  answers: AnswersMap;
  stableBlock: string;
}): void {
  const answerEntries = Object.values(params.answers);

  if (answerEntries.length > ANTHROPIC_GUARDS.maxAnswers) {
    throw new AiError(
      `Too many answers for AI mapping (max ${ANTHROPIC_GUARDS.maxAnswers})`,
      true,
    );
  }

  for (const entry of answerEntries) {
    let chars = 0;
    if (entry.type === 'attachment') {
      chars = entry.attachmentIds.join('').length;
    } else if (Array.isArray(entry.value)) {
      chars = entry.value.join('').length;
    } else {
      chars = String(entry.value).length;
    }
    if (chars > ANTHROPIC_GUARDS.maxAnswerChars) {
      throw new AiError(
        `Answer exceeds max length for AI mapping (max ${ANTHROPIC_GUARDS.maxAnswerChars} chars)`,
        true,
      );
    }
  }

  // The serialized allow-listed board schema must fit the cap. The stable block
  // embeds the schema, so its size is the authoritative measure of the schema
  // payload we would send.
  if (params.stableBlock.length > ANTHROPIC_GUARDS.maxBoardSchemaChars) {
    throw new AiError(
      `Serialized board schema exceeds max size for AI mapping (max ${ANTHROPIC_GUARDS.maxBoardSchemaChars} chars)`,
      true,
    );
  }
}

// The system block param type in the stable SDK (0.32.x) does not surface
// `cache_control`; the field is accepted at the API layer for current models, so
// we attach it via this widened type.
type SystemBlock = Anthropic.TextBlockParam & {
  cache_control?: { type: 'ephemeral' };
};

/**
 * Per-session record of every candidate id we returned to the model for a given
 * boardId. The model may ONLY use ids from this set; anything else is a
 * hallucination and is dropped.
 */
type LinkAllowSet = Map<string, Set<string>>;

function rememberCandidates(allowSet: LinkAllowSet, boardId: string, candidates: ScoredCandidate[]): void {
  let set = allowSet.get(boardId);
  if (!set) {
    set = new Set<string>();
    allowSet.set(boardId, set);
  }
  for (const c of candidates) set.add(String(c.id));
}

/**
 * Execute one search_linked_board tool call. Ranks the linked board's items
 * against the query, remembers the top ids in the allow-set, and returns the
 * candidates the model will see. A failed Monday search (retryable) is treated
 * as "no candidates" so the whole mapping does not crash — the model can still
 * emit without that link (the column is then dropped → partial result). Never
 * logs secrets.
 */
async function runLinkedSearch(
  input: unknown,
  allowSet: LinkAllowSet,
): Promise<{ boardId: string; candidates: { id: string; name: string; score: number }[] }> {
  const obj = (input && typeof input === 'object' ? input : {}) as { boardId?: unknown; query?: unknown };
  const boardId = typeof obj.boardId === 'string' ? obj.boardId : String(obj.boardId ?? '');
  const query = typeof obj.query === 'string' ? obj.query : String(obj.query ?? '');

  if (!boardId || !query) {
    return { boardId, candidates: [] };
  }

  let ranked: ScoredCandidate[];
  try {
    ranked = rankCandidates(query, await searchBoardItemsByName(boardId));
  } catch {
    // Retryable Monday failure → treat as no candidates for this turn. Do not
    // surface the error (and never log the token); the model proceeds without
    // this link and the column is dropped downstream.
    return { boardId, candidates: [] };
  }

  const top = ranked.slice(0, TOP_CANDIDATES);
  rememberCandidates(allowSet, boardId, top);
  return {
    boardId,
    candidates: top.map((c) => ({ id: String(c.id), name: c.name, score: c.score })),
  };
}

/**
 * Validate the emitted link-column values against the per-board allow-set and
 * convert survivors to wire shape via formatColumnValue('board_relation', id).
 * Returns the wire columnValues for the link columns, the drops, and the set of
 * link column ids (so the caller can strip them before the frozen validator).
 */
function resolveLinkColumns(
  toolInput: AiToolInput,
  allowlist: AllowlistColumn[],
  allowSet: LinkAllowSet,
): {
  columnValues: Record<string, unknown>;
  dropped: { columnId: string; reason: string }[];
  linkColumnIds: Set<string>;
} {
  const columnValues: Record<string, unknown> = {};
  const dropped: { columnId: string; reason: string }[] = [];
  const linkColumnIds = new Set<string>();

  const cv =
    toolInput.columnValues && typeof toolInput.columnValues === 'object' && !Array.isArray(toolInput.columnValues)
      ? (toolInput.columnValues as Record<string, unknown>)
      : {};

  for (const col of allowlist) {
    if (!isLinkColumn(col.type)) continue;
    linkColumnIds.add(col.columnId);

    const raw = cv[col.columnId];
    if (raw === undefined || raw === null || raw === '') {
      // Omitted is fine — nothing to add or drop.
      continue;
    }

    // The model may emit a number or a string; normalize to a string id.
    const id = typeof raw === 'number' || typeof raw === 'string' ? String(raw) : '';
    const allowed = col.linkBoardId ? allowSet.get(col.linkBoardId) : undefined;
    if (!id || !allowed || !allowed.has(id)) {
      dropped.push({ columnId: col.columnId, reason: 'linked item id not found via search' });
      continue;
    }

    const res = formatColumnValue('board_relation', id);
    if (res.ok) {
      columnValues[col.columnId] = res.value;
    } else {
      dropped.push({ columnId: col.columnId, reason: 'linked item id not found via search' });
    }
  }

  return { columnValues, dropped, linkColumnIds };
}

/**
 * Strip link columns from a tool input's columnValues so the frozen validator
 * never double-handles them. Returns a new AiToolInput; original untouched.
 */
function withoutLinkColumns(toolInput: AiToolInput, linkColumnIds: Set<string>): AiToolInput {
  const cv =
    toolInput.columnValues && typeof toolInput.columnValues === 'object' && !Array.isArray(toolInput.columnValues)
      ? (toolInput.columnValues as Record<string, unknown>)
      : {};
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cv)) {
    if (!linkColumnIds.has(k)) filtered[k] = v;
  }
  return { ...toolInput, columnValues: filtered };
}

/**
 * Run the AI mapping for a single submission (§18). Throws AiError(terminal) on
 * guard breach, ceiling breach, or a second failed attempt.
 */
export async function runAiMapping(params: {
  aiPrompt: string;
  allowlist: AllowlistColumn[];
  questions: QuestionDef[];
  answers: AnswersMap;
  defaultItemName?: string;
}): Promise<AiMappingResult> {
  const stableBlock = buildStableBlock({
    aiPrompt: params.aiPrompt,
    allowlist: params.allowlist,
  });
  const userContent = buildUserContent({
    questions: params.questions,
    answers: params.answers,
  });

  // 1) Guards BEFORE the call (§16.1/§18.8). Order: cheap size checks first so we
  // never increment the daily counter for a request we would reject anyway.
  enforceInputGuards({
    allowlist: params.allowlist,
    questions: params.questions,
    answers: params.answers,
    stableBlock,
  });

  // 2) Daily call ceiling (atomic increment, §16.1/§18.8). Compute the counter
  //    key once so a refund on a failed call targets the same reserved slot.
  const reservationKey = aiCallCounterKey(new Date());
  await enforceDailyCeiling(reservationKey);

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: ANTHROPIC_GUARDS.callTimeoutMs,
  });

  // System block carries the byte-stable cached prefix (§18.5).
  const system: SystemBlock[] = [
    { type: 'text', text: stableBlock, cache_control: { type: 'ephemeral' } },
  ];

  // Render for audit (§18.9): system + user concatenated.
  const renderedPrompt = `${stableBlock}\n\n---\n\n${userContent}`;

  const hasLinkColumns = params.allowlist.some((c) => isLinkColumn(c.type));

  // The per-session allow-set of candidate ids returned per boardId. Shared
  // across all turns so a final-turn emit can reference earlier searches.
  const allowSet: LinkAllowSet = new Map();

  const finalize = (toolInput: AiToolInput, lastRaw: string): AiMappingResult => {
    // Resolve link columns against the allow-set, then hand the remaining
    // (non-link) columns to the FROZEN validator. Merge both results.
    const link = resolveLinkColumns(toolInput, params.allowlist, allowSet);
    const nonLinkAllowlist = params.allowlist.filter((c) => !isLinkColumn(c.type));
    const nonLinkInput = withoutLinkColumns(toolInput, link.linkColumnIds);
    const outcome = validateAndConvertMapping(nonLinkInput, nonLinkAllowlist, {
      defaultItemName: params.defaultItemName,
    });
    return {
      itemName: outcome.itemName,
      columnValues: { ...outcome.columnValues, ...link.columnValues },
      dropped: [...outcome.dropped, ...link.dropped],
      reasoning: outcome.reasoning,
      renderedPrompt,
      rawResponse: lastRaw,
    };
  };

  // No link columns → keep the original single-call, forced-tool behavior EXACTLY
  // (no extra tool, no loop, no extra cost).
  if (!hasLinkColumns) {
    return runForcedEmit({ client, system, userContent, params, finalize, reservationKey });
  }

  // Link columns present → bounded multi-turn loop with both tools (§18).
  return runLinkedLoop({ client, system, userContent, params, allowSet, finalize, reservationKey });
}

interface LoopCtx {
  client: Anthropic;
  system: SystemBlock[];
  userContent: string;
  params: {
    aiPrompt: string;
    allowlist: AllowlistColumn[];
    questions: QuestionDef[];
    answers: AnswersMap;
    defaultItemName?: string;
  };
  finalize: (toolInput: AiToolInput, lastRaw: string) => AiMappingResult;
  /** Counter key for the reserved daily-call slot, refunded if a call fails. */
  reservationKey: string;
}

/**
 * Original behavior (no link columns): a single forced emit_mapping call plus a
 * single repair retry (§18.2). Unchanged from the pre-link engine.
 */
async function runForcedEmit(ctx: LoopCtx): Promise<AiMappingResult> {
  const { client, system, userContent, finalize, reservationKey } = ctx;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }];

  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await callAnthropic(client, {
      system,
      tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: EMIT_MAPPING_SCHEMA }],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages,
      reservationKey,
    });

    lastRaw = JSON.stringify(msg.content);
    const toolInput = parseToolUse(msg);
    if (toolInput) return finalize(toolInput, lastRaw);

    if (attempt === 0) {
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: REPAIR_MESSAGE });
    }
  }

  throw new AiError('AI mapping failed: model did not return a usable tool call', true);
}

/**
 * Link-aware behavior: tool_choice 'auto' with both tools. Each model turn may
 * either search (we run it, append the tool_result, and continue) or emit (we
 * finalize). Capped at MAX_SEARCH_ROUNDS searches; after the cap we force a final
 * emit_mapping. A single repair retry still applies if the forced call fails.
 */
async function runLinkedLoop(ctx: LoopCtx & { allowSet: LinkAllowSet }): Promise<AiMappingResult> {
  const { client, system, userContent, allowSet, finalize, reservationKey } = ctx;
  const tools: Anthropic.Tool[] = [
    { name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: EMIT_MAPPING_SCHEMA },
    { name: SEARCH_TOOL_NAME, description: SEARCH_TOOL_DESCRIPTION, input_schema: SEARCH_LINKED_BOARD_SCHEMA },
  ];

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }];
  let lastRaw = '';
  let searchRounds = 0;

  // Each loop iteration is one model turn. We allow up to MAX_SEARCH_ROUNDS
  // search round-trips; an emit (or the forced final emit) breaks out.
  // The +2 budget covers the forced final turn and one repair turn.
  for (let turn = 0; turn < MAX_SEARCH_ROUNDS + 2; turn++) {
    const forceEmit = searchRounds >= MAX_SEARCH_ROUNDS;
    const msg = await callAnthropic(client, {
      system,
      tools,
      tool_choice: forceEmit ? { type: 'tool', name: TOOL_NAME } : { type: 'auto' },
      messages,
      reservationKey,
    });
    lastRaw = JSON.stringify(msg.content);

    const emitInput = parseToolUse(msg);
    if (emitInput) return finalize(emitInput, lastRaw);

    // If we just forced emit_mapping but got nothing usable, do one repair turn.
    if (forceEmit) {
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: REPAIR_MESSAGE });
      // Next iteration still has forceEmit true (searchRounds unchanged), giving
      // exactly one repair attempt before the loop budget is exhausted.
      continue;
    }

    // The model may issue several tool_use blocks in one turn (parallel tool
    // use). The Anthropic API requires a tool_result for EVERY tool_use in the
    // preceding assistant message, so we must answer all of them — not just the
    // first — or the next call is rejected (400 tool_use/tool_result mismatch).
    const toolUses = findAllToolUse(msg);
    const searchUses = toolUses.filter((b) => b.id && b.name === SEARCH_TOOL_NAME);
    if (searchUses.length > 0) {
      const toolResults: ToolResultBlock[] = [];
      for (const block of toolUses) {
        if (!block.id) continue;
        if (block.name === SEARCH_TOOL_NAME) {
          const result = await runLinkedSearch(block.input, allowSet);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ candidates: result.candidates }),
          });
        } else {
          // Any other parallel tool_use (only emit_mapping exists, but be
          // defensive) still needs a result so the conversation stays valid.
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Use search_linked_board to look up linked items, then emit_mapping.',
            is_error: true,
          });
        }
      }
      // Count the turn as one search round regardless of how many parallel
      // searches it contained; the loop's turn budget bounds total cost.
      searchRounds += 1;
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // No usable tool call at all → repair once (mirrors the forced path).
    messages.push({ role: 'assistant', content: msg.content });
    messages.push({ role: 'user', content: REPAIR_MESSAGE });
  }

  throw new AiError('AI mapping failed: model did not return a usable tool call', true);
}

const REPAIR_MESSAGE =
  'Your previous response did not include a valid emit_mapping tool call. ' +
  'You MUST call the emit_mapping tool exactly once with itemName, ' +
  'columnValues (human values keyed by allow-listed columnId), and reasoning. ' +
  'For any link column, put the chosen item id (a number you obtained from ' +
  'search_linked_board). Do not write any column outside the allow-list.';

/** Thin wrapper around messages.create that maps SDK/transport errors to a terminal AiError. */
async function callAnthropic(
  client: Anthropic,
  args: {
    system: SystemBlock[];
    tools: Anthropic.Tool[];
    tool_choice: Anthropic.MessageCreateParams['tool_choice'];
    messages: Anthropic.MessageParam[];
    reservationKey: string;
  },
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: ANTHROPIC_GUARDS.maxOutputTokens,
      temperature: 0,
      system: args.system,
      tools: args.tools,
      tool_choice: args.tool_choice,
      messages: args.messages,
    });
  } catch (err) {
    // SDK/transport error: the reserved daily-call slot was never spent on a
    // usable response, so refund it (§16.1) before failing — a transient outage
    // must not permanently consume quota. Then surface a terminal failure (a
    // same-call retry would not change a malformed/forbidden request, and the
    // worker layer handles broader retries via submission status).
    await refundDailyCeiling(args.reservationKey);
    throw new AiError(
      `Anthropic request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      true,
    );
  }
}
