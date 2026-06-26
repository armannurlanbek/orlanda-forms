import { describe, it, expect } from 'vitest';
import { validateAndConvertMapping } from './validate';
import { loadJsonFixture } from '../test/fixtures';
import type { AllowlistColumn } from '@orlanda/shared';

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

describe('AI mapping validate + convert — golden against fixtures (§18/§19)', () => {
  const out = validateAndConvertMapping(fx.toolInput, fx.allowlist);

  it('produces the expected wire column_values', () => {
    expect(out.columnValues).toEqual(fx.expected.columnValues);
  });

  it('preserves the item name', () => {
    expect(out.itemName).toBe(fx.expected.itemName);
  });

  it('drops unknown/disallowed columns and records the reason', () => {
    const droppedIds = out.dropped.map((d) => d.columnId).sort();
    const expectedIds = fx.expected.dropped.map((d) => d.columnId).sort();
    expect(droppedIds).toEqual(expectedIds);
  });
});

describe('AI mapping validate — edge cases (§18.7)', () => {
  const allowlist: AllowlistColumn[] = [
    { columnId: 'status_c', title: 'Status', type: 'status', allowedLabels: ['New', 'Done'] },
    { columnId: 'num_c', title: 'Qty', type: 'numbers' },
    { columnId: 'text_c', title: 'Notes', type: 'text' },
  ];

  it('falls back to a default item name when empty', () => {
    const out = validateAndConvertMapping({ itemName: '   ', columnValues: {} }, allowlist, {
      defaultItemName: 'Fallback',
    });
    expect(out.itemName).toBe('Fallback');
  });

  it('drops a status label not in allowedLabels', () => {
    const out = validateAndConvertMapping(
      { itemName: 'x', columnValues: { status_c: 'Imaginary' } },
      allowlist,
    );
    expect(out.columnValues).toEqual({});
    expect(out.dropped[0].columnId).toBe('status_c');
  });

  it('drops model-emitted wire JSON (contract violation)', () => {
    const out = validateAndConvertMapping(
      { itemName: 'x', columnValues: { status_c: { label: 'Done' } } },
      allowlist,
    );
    expect(out.dropped.some((d) => d.columnId === 'status_c')).toBe(true);
  });

  it('converts a valid number to a string', () => {
    const out = validateAndConvertMapping({ itemName: 'x', columnValues: { num_c: 42 } }, allowlist);
    expect(out.columnValues).toEqual({ num_c: '42' });
  });
});
