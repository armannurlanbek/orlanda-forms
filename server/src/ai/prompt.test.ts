import { describe, it, expect } from 'vitest';
import { buildStableBlock, buildUserContent } from './prompt';
import type { AllowlistColumn } from '@orlanda/shared';
import type { QuestionDef } from '@orlanda/shared';
import type { AnswersMap } from '@orlanda/shared';

const allowlist: AllowlistColumn[] = [
  { columnId: 'text_c', title: 'Notes', type: 'text' },
  { columnId: 'status_c', title: 'Status', type: 'status', allowedLabels: ['New', 'Done'] },
  { columnId: 'num_c', title: 'Qty', type: 'numbers' },
];

const questions: QuestionDef[] = [
  { id: 'q1', order: 0, type: 'text', label: 'Describe the issue', required: true },
  { id: 'q2', order: 1, type: 'single_select', label: 'Pick a status', required: false },
];

const answers: AnswersMap = {
  q1: { type: 'text', value: 'Cracked render on north elevation' },
  q2: { type: 'single_select', value: 'Done' },
};

describe('buildStableBlock — cached prefix (§18.5)', () => {
  const block = buildStableBlock({ aiPrompt: 'Map survey answers to the board.', allowlist });

  it('is byte-stable across repeated builds (no timestamps / per-request data)', () => {
    const again = buildStableBlock({ aiPrompt: 'Map survey answers to the board.', allowlist });
    expect(block).toBe(again);
  });

  it('contains no submission ids, timestamps, or per-submission answer values', () => {
    // Today's date and any ISO timestamp must not leak into the cached prefix.
    expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // ISO timestamp
    expect(block).not.toContain('Cracked render'); // a per-submission answer value
  });

  it('embeds the governing prompt and the allow-listed columns', () => {
    expect(block).toContain('Map survey answers to the board.');
    expect(block).toContain('text_c');
    expect(block).toContain('status_c');
    expect(block).toContain('"allowedLabels"');
    expect(block).toContain('New');
  });

  it('includes the mapping rules, human-value conventions, and injection guardrail', () => {
    expect(block).toMatch(/only write to columns/i);
    expect(block).toMatch(/human values/i);
    expect(block).toMatch(/untrusted/i);
    expect(block).toMatch(/emit_mapping/);
  });

  it('changes when the governing prompt or allow-list changes (cache key sensitivity)', () => {
    expect(buildStableBlock({ aiPrompt: 'Different prompt.', allowlist })).not.toBe(block);
    expect(
      buildStableBlock({
        aiPrompt: 'Map survey answers to the board.',
        allowlist: allowlist.slice(0, 1),
      }),
    ).not.toBe(block);
  });
});

describe('buildUserContent — per-submission untrusted data (§18.4/§16.10)', () => {
  const user = buildUserContent({ questions, answers });

  it('frames the answers explicitly as untrusted data', () => {
    expect(user).toMatch(/untrusted/i);
  });

  it('includes each question id, label, and its answer value', () => {
    expect(user).toContain('q1');
    expect(user).toContain('Describe the issue');
    expect(user).toContain('Cracked render on north elevation');
    expect(user).toContain('q2');
    expect(user).toContain('Done');
  });

  it('represents an unanswered question with a null value rather than omitting it', () => {
    const partial = buildUserContent({
      questions,
      answers: { q1: { type: 'text', value: 'only one answered' } },
    });
    expect(partial).toContain('"value": null');
  });

  it('does not emit raw attachment ids as mappable values', () => {
    const withAttachment = buildUserContent({
      questions: [{ id: 'qa', order: 0, type: 'attachment', label: 'Files', required: false }],
      answers: { qa: { type: 'attachment', attachmentIds: ['att-1', 'att-2'] } },
    });
    expect(withAttachment).not.toContain('att-1');
    expect(withAttachment).toMatch(/not mappable/i);
  });
});
