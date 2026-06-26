import { describe, it, expect } from 'vitest';
import { formatColumnValue, parseAllowedLabels } from './formatter';
import { loadJsonFixture } from '../test/fixtures';
import type { MondayColumn } from '@orlanda/shared';

interface BoardFixture {
  data: { boards: { columns: MondayColumn[] }[] };
}
interface ExpectedFixture {
  columnValues: Record<string, unknown>;
}

const board = loadJsonFixture<BoardFixture>('board-schema.json');
const columns = board.data.boards[0].columns;
const colById = new Map(columns.map((c) => [c.id, c]));
const expected = loadJsonFixture<ExpectedFixture>('expected-column-values.json').columnValues;

// Human inputs that should reproduce the golden expected-column-values.json.
const humanInputs: Record<string, unknown> = {
  text_mkv1: 'Cracked render on north elevation',
  long_text_mkv2: 'Visible cracking approx 1.2m.\nRecommend further inspection.',
  numbers_mkv3: 42,
  status_mkv4: 'Done',
  dropdown_mkv5: ['Plumbing', 'Electrical'],
  date_mkv6: '2026-06-25',
  email_mkv7: 'surveyor@example.com',
  link_mkv8: 'https://example.com',
  phone_mkv9: '+1 (555) 123-4567',
  checkbox_mkva: true,
};

describe('formatColumnValue — golden against fixtures (§12/§19)', () => {
  it('reproduces expected-column-values.json for every supported column', () => {
    const built: Record<string, unknown> = {};
    for (const [columnId, raw] of Object.entries(humanInputs)) {
      const col = colById.get(columnId)!;
      const allowedLabels = parseAllowedLabels(col.settings_str, col.type);
      const res = formatColumnValue(col.type, raw, { allowedLabels, countryShortName: 'US' });
      expect(res.ok, `${columnId} should format`).toBe(true);
      if (res.ok) built[columnId] = res.value;
    }
    expect(built).toEqual(expected);
  });

  it('excludes file columns from column_values (§12.2)', () => {
    const res = formatColumnValue('file', 'whatever');
    expect(res.ok).toBe(false);
  });
});

describe('formatColumnValue — validation/drop behavior (§12.1/§18.7)', () => {
  it('drops status labels not in allowed labels', () => {
    const res = formatColumnValue('status', 'Imaginary', { allowedLabels: ['New', 'Done'] });
    expect(res.ok).toBe(false);
  });
  it('drops non-numeric numbers', () => {
    expect(formatColumnValue('numbers', 'abc').ok).toBe(false);
  });
  it('drops invalid dates', () => {
    expect(formatColumnValue('date', '2026-13-40').ok).toBe(false);
    expect(formatColumnValue('date', 'not-a-date').ok).toBe(false);
  });
  it('drops people columns (never inferred from free text)', () => {
    expect(formatColumnValue('people', 'John Smith').ok).toBe(false);
  });
  it('unchecks checkbox with falsey value', () => {
    expect(formatColumnValue('checkbox', false)).toEqual({ ok: true, value: {} });
  });
  it('formats dropdown single selection as an array', () => {
    const res = formatColumnValue('dropdown', 'Plumbing', { allowedLabels: ['Plumbing'] });
    expect(res).toEqual({ ok: true, value: { labels: ['Plumbing'] } });
  });
  it('parseAllowedLabels reads status + dropdown shapes', () => {
    const status = colById.get('status_mkv4')!;
    const dropdown = colById.get('dropdown_mkv5')!;
    expect(parseAllowedLabels(status.settings_str, 'status')).toContain('Done');
    expect(parseAllowedLabels(dropdown.settings_str, 'dropdown')).toEqual(['Plumbing', 'Electrical', 'Structural']);
  });
});
