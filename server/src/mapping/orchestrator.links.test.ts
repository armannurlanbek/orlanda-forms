import { describe, it, expect, vi } from 'vitest';

// Mock the live resolver so the orchestrator's Direct link path is testable offline.
vi.mock('../monday/linkedItems', () => ({
  resolveLinkedItem: vi.fn(async (_boardId: string, name: string) =>
    name.toLowerCase().includes('acme')
      ? { itemId: '999', reason: 'exact match', matchName: 'Acme HQ' }
      : { itemId: null, reason: 'no confident match' },
  ),
}));

import { buildMapping } from './orchestrator';
import type { MondayBoardSchema, QuestionDef } from '@orlanda/shared';

const schema: MondayBoardSchema = {
  id: 'target',
  name: 'Target',
  columns: [
    { id: 'connect_1', title: 'Project', type: 'board_relation', settings_str: '{"boardIds":[111]}' },
  ],
  groups: [],
};

const questions: QuestionDef[] = [{ id: 'q_proj', order: 0, type: 'text', label: 'Project', required: true }];

describe('buildMapping — Direct board-relation links', () => {
  it('resolves a matched name into the connect column value', async () => {
    const res = await buildMapping({
      mappingMode: 'direct',
      formTitle: 'F',
      questions,
      answers: { q_proj: { type: 'text', value: 'Acme HQ' } },
      schema,
      directMappingByQuestionId: {
        q_proj: { columnId: 'connect_1', columnType: 'board_relation', link: { boardId: '111' } },
      },
    });
    expect(res.columnValues.connect_1).toEqual({ item_ids: [999] });
    expect(res.dropped).toEqual([]);
  });

  it('skips and records when no item matches (-> partial)', async () => {
    const res = await buildMapping({
      mappingMode: 'direct',
      formTitle: 'F',
      questions,
      answers: { q_proj: { type: 'text', value: 'Unknown Co' } },
      schema,
      directMappingByQuestionId: {
        q_proj: { columnId: 'connect_1', columnType: 'board_relation', link: { boardId: '111' } },
      },
    });
    expect(res.columnValues.connect_1).toBeUndefined();
    expect(res.dropped.some((d) => d.columnId === 'connect_1')).toBe(true);
  });
});
