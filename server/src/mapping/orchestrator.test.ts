import { describe, it, expect } from 'vitest';
import { buildMapping } from './orchestrator';
import { loadJsonFixture } from '../test/fixtures';
import type { MondayBoardSchema, MondayColumn, QuestionDef } from '@orlanda/shared';

const board = loadJsonFixture<{ data: { boards: { columns: MondayColumn[]; groups: unknown[] }[] } }>(
  'board-schema.json',
);
const schema: MondayBoardSchema = {
  id: '1234567890',
  name: 'fixture',
  columns: board.data.boards[0].columns,
  groups: [],
};

describe('buildMapping — direct branch (no network)', () => {
  it('maps non-file columns and routes attachment questions to file columns', async () => {
    const questions: QuestionDef[] = [
      { id: 'q_name', order: 0, type: 'text', label: 'Name', required: true },
      { id: 'q_status', order: 1, type: 'single_select', label: 'Status', required: false, options: { options: ['Done'] } },
      { id: 'q_file', order: 2, type: 'attachment', label: 'Photo', required: false },
    ];
    const res = await buildMapping({
      mappingMode: 'direct',
      formTitle: 'Site Survey',
      questions,
      answers: {
        q_name: { type: 'text', value: 'Acme Co' },
        q_status: { type: 'single_select', value: 'Done' },
        q_file: { type: 'attachment', attachmentIds: ['att1'] },
      },
      schema,
      directMappingByQuestionId: {
        q_name: { columnId: 'text_mkv1', columnType: 'text' },
        q_status: { columnId: 'status_mkv4', columnType: 'status' },
        q_file: { columnId: 'files_mkvb', columnType: 'file' },
      },
    });

    expect(res.itemName).toBe('Acme Co');
    expect(res.columnValues).toEqual({
      text_mkv1: 'Acme Co',
      status_mkv4: { label: 'Done' },
    });
    expect(res.fileColumnsByQuestionId).toEqual({ q_file: 'files_mkvb' });
    expect(res.dropped).toEqual([]);
    expect(res.reasoning).toBeNull();
  });
});
