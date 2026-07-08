import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseToolUse, EMIT_MAPPING_SCHEMA } from './engine';
import { AiError } from './errors';
import { validateAndConvertMapping } from './validate';
import { loadJsonFixture } from '../test/fixtures';
import type { AllowlistColumn } from '@orlanda/shared';

// ---------------------------------------------------------------------------
// Mocks for the multi-turn / link-column tests. No real SDK or network calls.
// The Anthropic client is replaced with a programmable queue of message
// responses; prisma's usage counter is stubbed under the ceiling; the linked
// board search is mocked so we control the candidate ids.
// ---------------------------------------------------------------------------

// The mock fns must be created via vi.hoisted so they exist before the hoisted
// vi.mock factories run. Each test programs createMock with a queue of
// message responses, and searchBoardItemsByNameMock with the board's items.
const { createMock, searchBoardItemsByNameMock, usageUpsertMock, usageUpdateMock } = vi.hoisted(
  () => ({
    createMock: vi.fn(),
    searchBoardItemsByNameMock: vi.fn(),
    usageUpsertMock: vi.fn().mockResolvedValue({ key: 'ai-calls:test', count: 1 }),
    usageUpdateMock: vi.fn().mockResolvedValue({ key: 'ai-calls:test', count: 0 }),
  }),
);

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: createMock };
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic };
});

vi.mock('../db/prisma', () => ({
  prisma: {
    usageCounter: {
      // Default returns a count well under any limit so the ceiling never trips.
      upsert: usageUpsertMock,
      // Used by the daily-call refund path on a failed Anthropic call.
      update: usageUpdateMock,
    },
  },
}));

vi.mock('../monday/linkedItems', async () => {
  const actual = await vi.importActual<typeof import('../monday/linkedItems')>('../monday/linkedItems');
  return {
    ...actual,
    // Keep the real rankCandidates/similarity (pure); only the network call is mocked.
    searchBoardItemsByName: searchBoardItemsByNameMock,
  };
});

// NOTE: these tests must NOT make a real network/SDK call. We exercise the pure
// parseToolUse helper with mocked Anthropic message shapes and the fixture, and
// assert the contract of the schema + error type.

interface AiFixture {
  allowlist: AllowlistColumn[];
  toolInput: { itemName: string; columnValues: Record<string, unknown>; reasoning: string };
  expected: {
    itemName: string;
    columnValues: Record<string, unknown>;
    dropped: { columnId: string; reason: string }[];
  };
}

const fx = loadJsonFixture<AiFixture>('ai-mapping-response.json');

// Build a mocked Anthropic message (as the SDK returns) wrapping a tool_use block.
function mockMessage(toolInput: unknown, toolName = 'emit_mapping') {
  return {
    id: 'msg_test',
    role: 'assistant',
    content: [
      { type: 'text', text: 'Here is the mapping.' },
      { type: 'tool_use', id: 'toolu_test', name: toolName, input: toolInput },
    ],
    stop_reason: 'tool_use',
  };
}

describe('parseToolUse — pure extraction of the emit_mapping tool input (§18.2)', () => {
  it('extracts the tool input from a well-formed message', () => {
    const input = parseToolUse(mockMessage(fx.toolInput));
    expect(input).toEqual(fx.toolInput);
  });

  it('feeds the extracted input through the frozen validator to the expected wire output', () => {
    const input = parseToolUse(mockMessage(fx.toolInput));
    expect(input).not.toBeNull();
    const out = validateAndConvertMapping(input!, fx.allowlist);
    expect(out.columnValues).toEqual(fx.expected.columnValues);
    expect(out.itemName).toBe(fx.expected.itemName);
    expect(out.dropped.map((d) => d.columnId).sort()).toEqual(
      fx.expected.dropped.map((d) => d.columnId).sort(),
    );
  });

  it('returns null when there is no tool_use block (triggers repair retry)', () => {
    const textOnly = {
      content: [{ type: 'text', text: 'I cannot do that.' }],
    };
    expect(parseToolUse(textOnly)).toBeNull();
  });

  it('returns null when the tool_use block is for a different tool', () => {
    expect(parseToolUse(mockMessage(fx.toolInput, 'some_other_tool'))).toBeNull();
  });

  it('returns null when tool input is not an object', () => {
    expect(parseToolUse(mockMessage('not an object'))).toBeNull();
    expect(parseToolUse(mockMessage(['array', 'input']))).toBeNull();
    expect(parseToolUse(mockMessage(null))).toBeNull();
  });

  it('returns null for malformed message shapes', () => {
    expect(parseToolUse(null)).toBeNull();
    expect(parseToolUse(undefined)).toBeNull();
    expect(parseToolUse({})).toBeNull();
    expect(parseToolUse({ content: 'not an array' })).toBeNull();
    expect(parseToolUse({ content: [42, 'junk', null] })).toBeNull();
  });

  it('returns the first emit_mapping tool_use when multiple blocks are present', () => {
    const msg = {
      content: [
        { type: 'tool_use', id: 't1', name: 'emit_mapping', input: { itemName: 'A', columnValues: {}, reasoning: '' } },
        { type: 'tool_use', id: 't2', name: 'emit_mapping', input: { itemName: 'B', columnValues: {}, reasoning: '' } },
      ],
    };
    expect(parseToolUse(msg)).toEqual({ itemName: 'A', columnValues: {}, reasoning: '' });
  });
});

describe('EMIT_MAPPING_SCHEMA — forced tool contract (§18.2)', () => {
  it('is a closed object requiring itemName, columnValues, reasoning', () => {
    expect(EMIT_MAPPING_SCHEMA.type).toBe('object');
    expect(EMIT_MAPPING_SCHEMA.additionalProperties).toBe(false);
    expect(EMIT_MAPPING_SCHEMA.required).toEqual(['itemName', 'columnValues', 'reasoning']);
  });

  it('allows arbitrary keys inside columnValues (the validator enforces the allow-list)', () => {
    expect(EMIT_MAPPING_SCHEMA.properties.columnValues.additionalProperties).toBe(true);
    expect(EMIT_MAPPING_SCHEMA.properties.itemName.type).toBe('string');
    expect(EMIT_MAPPING_SCHEMA.properties.reasoning.type).toBe('string');
  });
});

describe('AiError — terminal flag (§18.2)', () => {
  it('carries the terminal flag and is an Error', () => {
    const e = new AiError('boom', true);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AiError);
    expect(e.terminal).toBe(true);
    expect(e.message).toBe('boom');
  });

  it('supports a non-terminal flag', () => {
    expect(new AiError('transient', false).terminal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runAiMapping — link-column multi-turn loop + no-link single forced emit.
// These exercise the engine end-to-end with the mocked SDK + linkedItems.
// ---------------------------------------------------------------------------

// Helper builders for mocked assistant messages.
function emitMsg(toolInput: unknown) {
  return {
    id: 'msg_emit',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_emit', name: 'emit_mapping', input: toolInput }],
    stop_reason: 'tool_use',
  };
}

function searchMsg(input: unknown, id = 'toolu_search') {
  return {
    id: 'msg_search',
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'search_linked_board', input }],
    stop_reason: 'tool_use',
  };
}

describe('runAiMapping — link-column search + emit loop (§18 linked items)', () => {
  beforeEach(() => {
    createMock.mockReset();
    searchBoardItemsByNameMock.mockReset();
  });

  const linkAllowlist: AllowlistColumn[] = [
    { columnId: 'text_a', title: 'Notes', type: 'text' },
    { columnId: 'link_b', title: 'Project', type: 'board_relation', linkBoardId: '555' },
  ];
  const baseParams = {
    aiPrompt: 'Map the submission.',
    questions: [{ id: 'q1', order: 0, type: 'text' as const, label: 'Project name', required: false }],
    answers: { q1: { type: 'text' as const, value: 'Acme' } },
  };

  it('(a) searches, then emits an id IN the allow-set → wired as {item_ids:[id]}', async () => {
    // The board has an item "Acme Corp" with id 999; the model will pick it.
    searchBoardItemsByNameMock.mockResolvedValue([
      { id: '999', name: 'Acme Corp' },
      { id: '111', name: 'Beta LLC' },
    ]);

    // Turn 1: model searches. Turn 2: model emits id 999 (in the allow-set).
    createMock
      .mockResolvedValueOnce(searchMsg({ boardId: '555', query: 'Acme' }))
      .mockResolvedValueOnce(
        emitMsg({
          itemName: 'Acme submission',
          columnValues: { text_a: 'hello', link_b: 999 },
          reasoning: 'matched',
        }),
      );

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    expect(searchBoardItemsByNameMock).toHaveBeenCalledWith('555');
    expect(res.columnValues.link_b).toEqual({ item_ids: [999] });
    expect(res.columnValues.text_a).toBe('hello');
    expect(res.dropped.find((d) => d.columnId === 'link_b')).toBeUndefined();

    // First call used auto tool_choice with BOTH tools; the search tool result
    // was fed back before the emit.
    const firstArgs = createMock.mock.calls[0][0];
    expect(firstArgs.tool_choice).toEqual({ type: 'auto' });
    expect(firstArgs.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      'emit_mapping',
      'search_linked_board',
    ]);
    const secondArgs = createMock.mock.calls[1][0];
    const toolResultTurn = secondArgs.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    expect(toolResultTurn).toBeDefined();
  });

  it('(b) keeps emitting a hallucinated id → dropped after the repair budget', async () => {
    searchBoardItemsByNameMock.mockResolvedValue([{ id: '999', name: 'Acme Corp' }]);

    // Search returns 999, but the model insists on 777 (never returned). The
    // engine bounces it MAX_LINK_REPAIRS (2) times, then finalizes it dropped.
    const bad = emitMsg({ itemName: 'Acme', columnValues: { text_a: 'hi', link_b: 777 }, reasoning: 'guessed' });
    createMock
      .mockResolvedValueOnce(searchMsg({ boardId: '555', query: 'Acme' }))
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(bad);

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    expect(res.columnValues.link_b).toBeUndefined();
    expect(res.columnValues.text_a).toBe('hi');
    expect(res.dropped).toContainEqual({
      columnId: 'link_b',
      reason: 'linked item id not found via search',
    });
  });

  it('bounces an emit whose link id was not searched, then resolves after the model searches', async () => {
    // THE FIX: model emits link_b=999 WITHOUT searching → engine bounces with a
    // corrective tool_result → model searches → re-emits → now accepted (wired).
    searchBoardItemsByNameMock.mockResolvedValue([{ id: '999', name: 'Acme Corp' }]);
    createMock
      .mockResolvedValueOnce(emitMsg({ itemName: 'Acme', columnValues: { link_b: 999 }, reasoning: 'guess' }))
      .mockResolvedValueOnce(searchMsg({ boardId: '555', query: 'Acme' }))
      .mockResolvedValueOnce(emitMsg({ itemName: 'Acme', columnValues: { link_b: 999 }, reasoning: 'searched' }));

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    expect(searchBoardItemsByNameMock).toHaveBeenCalledWith('555');
    expect(res.columnValues.link_b).toEqual({ item_ids: [999] });
    expect(res.dropped.find((d) => d.columnId === 'link_b')).toBeUndefined();

    // The first bounce was an is_error tool_result on the emit tool_use block.
    const secondCall = createMock.mock.calls[1][0];
    const corrective = secondCall.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content[0] as { is_error?: boolean })?.is_error === true,
    );
    expect(corrective).toBeDefined();
  });

  it('resolves a link id emitted in Monday wire shape { item_ids: [...] } after a search', async () => {
    // PROD BUG: the model searches correctly, then emits the board_relation in
    // Monday's wire shape { item_ids: ["999"] } instead of the bare id. The id IS in
    // the allow-set, so it must be unwrapped and accepted — not dropped as "not found".
    searchBoardItemsByNameMock.mockResolvedValue([{ id: '999', name: 'Acme Corp' }]);
    createMock
      .mockResolvedValueOnce(searchMsg({ boardId: '555', query: 'Acme' }))
      .mockResolvedValueOnce(
        emitMsg({ itemName: 'Acme', columnValues: { link_b: { item_ids: ['999'] } }, reasoning: 'wire shape' }),
      );

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    expect(res.columnValues.link_b).toEqual({ item_ids: [999] });
    expect(res.dropped.find((d) => d.columnId === 'link_b')).toBeUndefined();
  });

  it('still drops a wire-shape link id that was never searched (no hallucinated ids)', async () => {
    // Unwrapping the wire shape must NOT weaken the allow-set guard: an id inside
    // { item_ids: [...] } that never came from search is still rejected.
    const bad = emitMsg({
      itemName: 'x',
      columnValues: { text_a: 'x', link_b: { item_ids: ['777'] } },
      reasoning: 'hallucinated wire shape',
    });
    createMock.mockResolvedValueOnce(bad).mockResolvedValueOnce(bad).mockResolvedValueOnce(bad);

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    expect(res.columnValues.link_b).toBeUndefined();
    expect(res.dropped).toContainEqual({
      columnId: 'link_b',
      reason: 'linked item id not found via search',
    });
  });

  it('drops a link id when the model never searches (after the repair budget)', async () => {
    const bad = emitMsg({ itemName: 'No search', columnValues: { text_a: 'x', link_b: 999 }, reasoning: 'no search' });
    createMock.mockResolvedValueOnce(bad).mockResolvedValueOnce(bad).mockResolvedValueOnce(bad);

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    expect(res.columnValues.link_b).toBeUndefined();
    expect(res.dropped).toContainEqual({
      columnId: 'link_b',
      reason: 'linked item id not found via search',
    });
    expect(searchBoardItemsByNameMock).not.toHaveBeenCalled();
  });

  it('a failed Monday search is treated as no candidates → link dropped, mapping survives', async () => {
    searchBoardItemsByNameMock.mockRejectedValue(new Error('rate limit'));

    const bad = emitMsg({
      itemName: 'Acme submission',
      columnValues: { text_a: 'still works', link_b: 999 },
      reasoning: 'search failed',
    });
    createMock
      .mockResolvedValueOnce(searchMsg({ boardId: '555', query: 'Acme' }))
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(bad);

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    expect(res.columnValues.text_a).toBe('still works');
    expect(res.columnValues.link_b).toBeUndefined();
    expect(res.dropped).toContainEqual({
      columnId: 'link_b',
      reason: 'linked item id not found via search',
    });
  });

  it('answers EVERY tool_use when the model issues parallel searches in one turn', async () => {
    // Regression: the model may issue multiple tool_use blocks in a single turn
    // (parallel tool use). The Anthropic API rejects the next call unless EVERY
    // tool_use has a matching tool_result, so the loop must answer all of them.
    searchBoardItemsByNameMock.mockResolvedValue([{ id: '999', name: 'Acme Corp' }]);

    const parallelSearches = {
      id: 'msg_parallel',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'p1', name: 'search_linked_board', input: { boardId: '555', query: 'Acme' } },
        { type: 'tool_use', id: 'p2', name: 'search_linked_board', input: { boardId: '555', query: 'Acme Corp' } },
      ],
      stop_reason: 'tool_use',
    };
    createMock
      .mockResolvedValueOnce(parallelSearches)
      .mockResolvedValueOnce(
        emitMsg({ itemName: 'Acme', columnValues: { link_b: 999 }, reasoning: 'ok' }),
      );

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    // The follow-up user turn must carry a tool_result for BOTH p1 and p2.
    const secondArgs = createMock.mock.calls[1][0];
    const toolResultMsg = secondArgs.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    expect(toolResultMsg).toBeDefined();
    const ids = (toolResultMsg.content as { tool_use_id: string }[])
      .map((b) => b.tool_use_id)
      .sort();
    expect(ids).toEqual(['p1', 'p2']);
    expect(res.columnValues.link_b).toEqual({ item_ids: [999] });
  });

  it('caps search round-trips at 3, then forces emit_mapping', async () => {
    searchBoardItemsByNameMock.mockResolvedValue([{ id: '999', name: 'Acme Corp' }]);

    // Model keeps searching; after 3 searches the engine forces emit_mapping.
    createMock
      .mockResolvedValueOnce(searchMsg({ boardId: '555', query: 'Acme' }, 's1'))
      .mockResolvedValueOnce(searchMsg({ boardId: '555', query: 'Acme' }, 's2'))
      .mockResolvedValueOnce(searchMsg({ boardId: '555', query: 'Acme' }, 's3'))
      .mockResolvedValueOnce(
        emitMsg({ itemName: 'Forced', columnValues: { link_b: 999 }, reasoning: 'forced' }),
      );

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    expect(searchBoardItemsByNameMock).toHaveBeenCalledTimes(3);
    // The 4th create call forced emit_mapping.
    const fourthArgs = createMock.mock.calls[3][0];
    expect(fourthArgs.tool_choice).toEqual({ type: 'tool', name: 'emit_mapping' });
    expect(res.columnValues.link_b).toEqual({ item_ids: [999] });
  });

  it('accepts a parallel search+emit in ONE turn without a spurious is_error bounce', async () => {
    // FIX #6: a single assistant turn carries BOTH a search_linked_board block
    // (that returns the id) AND an emit_mapping block using that id. The search
    // must run first, then the emit is re-evaluated against the updated allow-set
    // and accepted in the SAME turn — no empty reminder, no discarded valid emit.
    searchBoardItemsByNameMock.mockResolvedValue([{ id: '999', name: 'Acme Corp' }]);

    const parallelSearchEmit = {
      id: 'msg_parallel_se',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'se_search', name: 'search_linked_board', input: { boardId: '555', query: 'Acme' } },
        {
          type: 'tool_use',
          id: 'se_emit',
          name: 'emit_mapping',
          input: { itemName: 'Acme', columnValues: { link_b: 999 }, reasoning: 'ok' },
        },
      ],
      stop_reason: 'tool_use',
    };
    createMock.mockResolvedValueOnce(parallelSearchEmit);

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: linkAllowlist });

    // Accepted in the same turn → exactly ONE Anthropic call, link resolved.
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.columnValues.link_b).toEqual({ item_ids: [999] });
    expect(res.dropped.find((d) => d.columnId === 'link_b')).toBeUndefined();

    // No corrective/is_error reminder was ever sent (that would require a 2nd call).
    const sentIsError = createMock.mock.calls.some(
      ([args]: [{ messages: { role: string; content: unknown }[] }]) =>
        args.messages.some(
          (m) =>
            m.role === 'user' &&
            Array.isArray(m.content) &&
            (m.content[0] as { is_error?: boolean })?.is_error === true,
        ),
    );
    expect(sentIsError).toBe(false);
  });

  it('does NOT bounce a link column with no linkBoardId — dropped in a single call', async () => {
    // FIX #5: a link column whose linkBoardId is missing can never be resolved by
    // search (no board to search), so it must NOT trigger a bounce. The emit is
    // accepted on the first turn and the column is simply dropped in finalize.
    const noBoardAllowlist: AllowlistColumn[] = [
      { columnId: 'text_a', title: 'Notes', type: 'text' },
      { columnId: 'link_c', title: 'Project', type: 'board_relation' }, // no linkBoardId
    ];
    createMock.mockResolvedValueOnce(
      emitMsg({ itemName: 'Acme', columnValues: { text_a: 'hi', link_c: 999 }, reasoning: 'guess' }),
    );

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({ ...baseParams, allowlist: noBoardAllowlist });

    // Accepted on the FIRST turn (no wasted search bounce) → exactly one call.
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(searchBoardItemsByNameMock).not.toHaveBeenCalled();

    // The board-less link column can never resolve → dropped, never written.
    expect(res.columnValues.link_c).toBeUndefined();
    expect(res.dropped).toContainEqual({
      columnId: 'link_c',
      reason: 'linked item id not found via search',
    });
    expect(res.columnValues.text_a).toBe('hi');

    // No is_error corrective was sent.
    const sentIsError = createMock.mock.calls.some(
      ([args]: [{ messages: { role: string; content: unknown }[] }]) =>
        args.messages.some(
          (m) =>
            m.role === 'user' &&
            Array.isArray(m.content) &&
            (m.content[0] as { is_error?: boolean })?.is_error === true,
        ),
    );
    expect(sentIsError).toBe(false);
  });
});

describe('runAiMapping — no link columns keep single forced emit (unchanged)', () => {
  beforeEach(() => {
    createMock.mockReset();
    searchBoardItemsByNameMock.mockReset();
  });

  it('(c) makes one forced emit_mapping call with only the emit tool', async () => {
    const allowlist: AllowlistColumn[] = [
      { columnId: 'text_a', title: 'Notes', type: 'text' },
      { columnId: 'num_b', title: 'Qty', type: 'numbers' },
    ];

    createMock.mockResolvedValueOnce(
      emitMsg({ itemName: 'Plain', columnValues: { text_a: 'n', num_b: 5 }, reasoning: 'ok' }),
    );

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({
      aiPrompt: 'Map it.',
      allowlist,
      questions: [],
      answers: {},
    });

    // Exactly one call, forced to emit_mapping, with ONLY the emit tool exposed.
    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0][0];
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'emit_mapping' });
    expect(args.tools.map((t: { name: string }) => t.name)).toEqual(['emit_mapping']);
    expect(searchBoardItemsByNameMock).not.toHaveBeenCalled();

    expect(res.columnValues).toEqual({ text_a: 'n', num_b: '5' });
  });
});

describe('runAiMapping — daily ceiling refund on a failed Anthropic call (§16.1)', () => {
  const allowlist: AllowlistColumn[] = [{ columnId: 'text_a', title: 'Notes', type: 'text' }];
  const params = { aiPrompt: 'Map it.', allowlist, questions: [], answers: {} };

  beforeEach(() => {
    createMock.mockReset();
    searchBoardItemsByNameMock.mockReset();
    usageUpsertMock.mockReset().mockResolvedValue({ key: 'ai-calls:test', count: 1 });
    usageUpdateMock.mockReset().mockResolvedValue({ key: 'ai-calls:test', count: 0 });
  });

  it('refunds (decrements) the reserved slot when messages.create rejects', async () => {
    createMock.mockRejectedValue(new Error('socket hang up'));

    const { runAiMapping } = await import('./engine');
    await expect(runAiMapping(params)).rejects.toBeInstanceOf(AiError);

    // Reserved exactly one slot before the call, then refunded it after the throw.
    expect(usageUpsertMock).toHaveBeenCalledTimes(1);
    expect(usageUpdateMock).toHaveBeenCalledTimes(1);
    expect(usageUpdateMock.mock.calls[0][0]).toMatchObject({
      data: { count: { decrement: 1 } },
    });
  });

  it('does NOT refund when the daily ceiling is exceeded (no call was sent)', async () => {
    // upsert returns a count over the limit → enforceDailyCeiling throws before
    // any Anthropic call is made; there is nothing to refund.
    usageUpsertMock.mockResolvedValue({ key: 'ai-calls:test', count: 1_000_000 });

    const { runAiMapping } = await import('./engine');
    await expect(runAiMapping(params)).rejects.toBeInstanceOf(AiError);

    expect(createMock).not.toHaveBeenCalled();
    expect(usageUpdateMock).not.toHaveBeenCalled();
  });

  it('does NOT refund when the call succeeds but returns no usable tool block', async () => {
    // Both attempts return text only (no tool_use) → terminal "no usable tool
    // call", but the calls SUCCEEDED and consumed quota → no refund.
    const textOnly = {
      id: 'm',
      role: 'assistant',
      content: [{ type: 'text', text: 'I cannot.' }],
      stop_reason: 'end_turn',
    };
    createMock.mockResolvedValue(textOnly);

    const { runAiMapping } = await import('./engine');
    await expect(runAiMapping(params)).rejects.toBeInstanceOf(AiError);

    // Two forced-emit attempts were sent → two reservations (per-call accounting),
    // and neither is refunded (both calls succeeded and consumed quota).
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(usageUpsertMock).toHaveBeenCalledTimes(2);
    expect(usageUpdateMock).not.toHaveBeenCalled();
  });

  it('reserves one daily-call slot PER messages.create call across a linked flow', async () => {
    // FIX #3: the ai-calls:<day> counter must count real Anthropic calls, not
    // mappings. A linked flow that searches then emits makes two messages.create
    // calls → exactly two reservations (one per call, atomic before each send).
    const linkAllowlist: AllowlistColumn[] = [
      { columnId: 'text_a', title: 'Notes', type: 'text' },
      { columnId: 'link_b', title: 'Project', type: 'board_relation', linkBoardId: '555' },
    ];
    searchBoardItemsByNameMock.mockResolvedValue([{ id: '999', name: 'Acme Corp' }]);
    createMock
      .mockResolvedValueOnce({
        id: 'msg_search',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_search', name: 'search_linked_board', input: { boardId: '555', query: 'Acme' } }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        id: 'msg_emit',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_emit', name: 'emit_mapping', input: { itemName: 'Acme', columnValues: { link_b: 999 }, reasoning: 'ok' } }],
        stop_reason: 'tool_use',
      });

    const { runAiMapping } = await import('./engine');
    const res = await runAiMapping({
      aiPrompt: 'Map it.',
      allowlist: linkAllowlist,
      questions: [],
      answers: {},
    });

    expect(res.columnValues.link_b).toEqual({ item_ids: [999] });
    // Two Anthropic calls (search turn + emit turn) → exactly two reservations.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(usageUpsertMock).toHaveBeenCalledTimes(2);
    expect(usageUpsertMock).toHaveBeenCalledTimes(createMock.mock.calls.length);
    // Every call succeeded → no refunds.
    expect(usageUpdateMock).not.toHaveBeenCalled();
  });
});
