import { describe, it, expect } from 'vitest';
import { validateAnswers, parseNumeric } from './answers';
import type { QuestionDef } from './types';

const q = (over: Partial<QuestionDef> & Pick<QuestionDef, 'id' | 'type'>): QuestionDef => ({
  order: 0,
  label: 'L',
  required: false,
  ...over,
});

describe('parseNumeric', () => {
  it('parses dot and comma decimals', () => {
    expect(parseNumeric('1.5')).toBe(1.5);
    expect(parseNumeric('1,5')).toBe(1.5);
    expect(parseNumeric(42)).toBe(42);
  });
  it('rejects non-numeric / non-finite', () => {
    expect(parseNumeric('abc')).toBeNull();
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric(Infinity)).toBeNull();
  });
});

describe('validateAnswers', () => {
  it('rejects unknown keys', () => {
    const r = validateAnswers([q({ id: 'a', type: 'text' })], { z: { type: 'text', value: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.errors.z).toBeDefined();
  });

  it('flags required missing fields', () => {
    const r = validateAnswers([q({ id: 'a', type: 'text', required: true })], {});
    expect(r.ok).toBe(false);
    expect(r.errors.a).toBeDefined();
  });

  it('enforces type match', () => {
    const r = validateAnswers([q({ id: 'a', type: 'text' })], { a: { type: 'number', value: 1 } });
    expect(r.ok).toBe(false);
  });

  it('validates single_select against current options', () => {
    const def = q({ id: 'a', type: 'single_select', options: { options: ['X', 'Y'] }, required: true });
    expect(validateAnswers([def], { a: { type: 'single_select', value: 'X' } }).ok).toBe(true);
    expect(validateAnswers([def], { a: { type: 'single_select', value: 'Z' } }).ok).toBe(false);
  });

  it('validates multi_select: membership, dupes, bounds', () => {
    const def = q({ id: 'a', type: 'multi_select', options: { options: ['A', 'B', 'C'], maxSelections: 2 } });
    expect(validateAnswers([def], { a: { type: 'multi_select', value: ['A', 'B'] } }).ok).toBe(true);
    expect(validateAnswers([def], { a: { type: 'multi_select', value: ['A', 'A'] } }).ok).toBe(false);
    expect(validateAnswers([def], { a: { type: 'multi_select', value: ['A', 'B', 'C'] } }).ok).toBe(false);
    expect(validateAnswers([def], { a: { type: 'multi_select', value: ['Z'] } }).ok).toBe(false);
  });

  it('coerces and bounds numbers', () => {
    const def = q({ id: 'a', type: 'number', options: { min: 0, max: 10 }, required: true });
    const ok = validateAnswers([def], { a: { type: 'number', value: 5 } });
    expect(ok.ok).toBe(true);
    expect(ok.normalized.a).toEqual({ type: 'number', value: 5 });
    expect(validateAnswers([def], { a: { type: 'number', value: 20 } }).ok).toBe(false);
  });

  it('requires attachmentIds when required', () => {
    const def = q({ id: 'a', type: 'attachment', required: true });
    expect(validateAnswers([def], { a: { type: 'attachment', attachmentIds: [] } }).ok).toBe(false);
    expect(validateAnswers([def], { a: { type: 'attachment', attachmentIds: ['x'] } }).ok).toBe(true);
  });
});
