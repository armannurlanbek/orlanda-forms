import { describe, it, expect } from 'vitest';
import type { AnswersMap, MondayBoardSchema, MondayColumn, QuestionDef } from '@orlanda/shared';
import { loadJsonFixture } from '../test/fixtures';
import { buildDirectColumnValues, DirectMapping } from './direct';
import { parseBoardResponse } from './schema';

interface BoardFixture {
  data: { boards: { id: string; name: string; columns: MondayColumn[]; groups: { id: string; title: string }[] }[] };
}
interface ExpectedFixture {
  columnValues: Record<string, unknown>;
}

const board = loadJsonFixture<BoardFixture>('board-schema.json');
const schema: MondayBoardSchema = parseBoardResponse(board.data);
const expected = loadJsonFixture<ExpectedFixture>('expected-column-values.json').columnValues;

// One question per supported column type, mapped 1:1 to the fixture columns.
const questions: QuestionDef[] = [
  { id: 'q_text', order: 0, type: 'text', label: 'Notes', required: false },
  { id: 'q_long', order: 1, type: 'long_text', label: 'Details', required: false },
  { id: 'q_num', order: 2, type: 'number', label: 'Quantity', required: false },
  { id: 'q_status', order: 3, type: 'single_select', label: 'Status', required: false },
  { id: 'q_dropdown', order: 4, type: 'multi_select', label: 'Categories', required: false },
  { id: 'q_date', order: 5, type: 'text', label: 'Due Date', required: false },
  { id: 'q_email', order: 6, type: 'text', label: 'Email', required: false },
  { id: 'q_link', order: 7, type: 'text', label: 'Website', required: false },
  { id: 'q_phone', order: 8, type: 'text', label: 'Phone', required: false },
  { id: 'q_checkbox', order: 9, type: 'single_select', label: 'Confirmed', required: false },
  { id: 'q_file', order: 10, type: 'attachment', label: 'Attachments', required: false },
];

const directMappingByQuestionId: Record<string, DirectMapping> = {
  q_text: { columnId: 'text_mkv1', columnType: 'text' },
  q_long: { columnId: 'long_text_mkv2', columnType: 'long_text' },
  q_num: { columnId: 'numbers_mkv3', columnType: 'numbers' },
  q_status: { columnId: 'status_mkv4', columnType: 'status' },
  q_dropdown: { columnId: 'dropdown_mkv5', columnType: 'dropdown' },
  q_date: { columnId: 'date_mkv6', columnType: 'date' },
  q_email: { columnId: 'email_mkv7', columnType: 'email' },
  q_link: { columnId: 'link_mkv8', columnType: 'link' },
  q_phone: { columnId: 'phone_mkv9', columnType: 'phone', countryShortName: 'US' },
  q_checkbox: { columnId: 'checkbox_mkva', columnType: 'checkbox' },
  q_file: { columnId: 'files_mkvb', columnType: 'file' },
};

const answers: AnswersMap = {
  q_text: { type: 'text', value: 'Cracked render on north elevation' },
  q_long: { type: 'long_text', value: 'Visible cracking approx 1.2m.\nRecommend further inspection.' },
  q_num: { type: 'number', value: 42 },
  q_status: { type: 'single_select', value: 'Done' },
  q_dropdown: { type: 'multi_select', value: ['Plumbing', 'Electrical'] },
  q_date: { type: 'text', value: '2026-06-25' },
  q_email: { type: 'text', value: 'surveyor@example.com' },
  q_link: { type: 'text', value: 'https://example.com' },
  q_phone: { type: 'text', value: '+1 (555) 123-4567' },
  q_checkbox: { type: 'single_select', value: 'true' },
  q_file: { type: 'attachment', attachmentIds: ['att_1'] },
};

describe('buildDirectColumnValues — golden against fixtures (§12)', () => {
  it('reproduces expected-column-values.json and excludes the file column', () => {
    const res = buildDirectColumnValues({
      questions,
      answers,
      directMappingByQuestionId,
      schema,
      formTitle: 'Site Surveys',
    });
    expect(res.columnValues).toEqual(expected);
    expect(res.dropped).toEqual([]);
  });

  it('records file columns separately and never in column_values (§12.2)', () => {
    const res = buildDirectColumnValues({
      questions,
      answers,
      directMappingByQuestionId,
      schema,
      formTitle: 'Site Surveys',
    });
    expect(res.fileColumnsByQuestionId).toEqual({ q_file: 'files_mkvb' });
    expect(res.columnValues).not.toHaveProperty('files_mkvb');
  });

  it('uses the first non-empty text answer as the item name', () => {
    const res = buildDirectColumnValues({
      questions,
      answers,
      directMappingByQuestionId,
      schema,
      formTitle: 'Site Surveys',
    });
    expect(res.itemName).toBe('Cracked render on north elevation');
  });
});

describe('buildDirectColumnValues — drop + fallback behavior (§12.1/§18.7)', () => {
  it('drops a value that fails the per-type check, keeping the rest', () => {
    const res = buildDirectColumnValues({
      questions: [
        { id: 'q_num', order: 0, type: 'text', label: 'Qty', required: false },
        { id: 'q_text', order: 1, type: 'text', label: 'Notes', required: false },
      ],
      answers: {
        q_num: { type: 'text', value: 'not-a-number' },
        q_text: { type: 'text', value: 'kept' },
      },
      directMappingByQuestionId: {
        q_num: { columnId: 'numbers_mkv3', columnType: 'numbers' },
        q_text: { columnId: 'text_mkv1', columnType: 'text' },
      },
      schema,
      formTitle: 'Site Surveys',
    });
    expect(res.columnValues).toEqual({ text_mkv1: 'kept' });
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0].columnId).toBe('numbers_mkv3');
  });

  it('drops a status label not in the schema allowed labels', () => {
    const res = buildDirectColumnValues({
      questions: [{ id: 'q_status', order: 0, type: 'single_select', label: 'Status', required: false }],
      answers: { q_status: { type: 'single_select', value: 'Imaginary' } },
      directMappingByQuestionId: { q_status: { columnId: 'status_mkv4', columnType: 'status' } },
      schema,
      formTitle: 'Site Surveys',
    });
    expect(res.columnValues).toEqual({});
    expect(res.dropped[0].columnId).toBe('status_mkv4');
  });

  it('falls back to "<formTitle> — <date>" when no text answer is present', () => {
    const res = buildDirectColumnValues({
      questions: [{ id: 'q_num', order: 0, type: 'number', label: 'Qty', required: false }],
      answers: { q_num: { type: 'number', value: 7 } },
      directMappingByQuestionId: { q_num: { columnId: 'numbers_mkv3', columnType: 'numbers' } },
      schema,
      formTitle: 'My Form',
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(res.itemName).toBe(`My Form — ${today}`);
  });

  it('ignores questions without a mapping but still uses them for item name', () => {
    const res = buildDirectColumnValues({
      questions: [
        { id: 'q_text', order: 0, type: 'text', label: 'Notes', required: false },
        { id: 'q_num', order: 1, type: 'number', label: 'Qty', required: false },
      ],
      answers: {
        q_text: { type: 'text', value: 'name from here' },
        q_num: { type: 'number', value: 1 },
      },
      directMappingByQuestionId: {
        q_num: { columnId: 'numbers_mkv3', columnType: 'numbers' },
      },
      schema,
      formTitle: 'My Form',
    });
    expect(res.itemName).toBe('name from here');
    expect(res.columnValues).toEqual({ numbers_mkv3: '1' });
  });
});

describe('parseBoardResponse + schema mapping', () => {
  it('maps the raw boards response into MondayBoardSchema', () => {
    expect(schema.id).toBe('1234567890');
    expect(schema.columns.find((c) => c.id === 'status_mkv4')?.type).toBe('status');
    expect(schema.groups.map((g) => g.id)).toContain('topics');
  });

  it('throws when no board is present', () => {
    expect(() => parseBoardResponse({ boards: [] })).toThrow();
  });
});
