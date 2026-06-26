// Canonical answer shapes (§15.1) + the single authoritative validator used by
// BOTH client (pre-submit) and server (untrusted-input gate). The server adds
// one extra check the client cannot do: attachment ownership (§15.1.6).

import { z } from 'zod';
import type { QuestionDef, QuestionType } from './types';

// ── Canonical per-type answer shapes ────────────────────────────────────────
export const TextAnswer = z.object({ type: z.literal('text'), value: z.string() });
export const LongTextAnswer = z.object({ type: z.literal('long_text'), value: z.string() });
export const NumberAnswer = z.object({ type: z.literal('number'), value: z.number() });
export const SingleSelectAnswer = z.object({
  type: z.literal('single_select'),
  value: z.string(),
});
export const MultiSelectAnswer = z.object({
  type: z.literal('multi_select'),
  value: z.array(z.string()),
});
export const AttachmentAnswer = z.object({
  type: z.literal('attachment'),
  attachmentIds: z.array(z.string()),
});

export const AnswerEntry = z.discriminatedUnion('type', [
  TextAnswer,
  LongTextAnswer,
  NumberAnswer,
  SingleSelectAnswer,
  MultiSelectAnswer,
  AttachmentAnswer,
]);
export type AnswerEntry = z.infer<typeof AnswerEntry>;

export type AnswersMap = Record<string, AnswerEntry>;

export interface ValidationResult {
  ok: boolean;
  /** per-question error messages, keyed by questionId */
  errors: Record<string, string>;
  /** normalized answers (e.g. number coercion) — only meaningful when ok */
  normalized: AnswersMap;
}

/**
 * Parse a possibly-locale-formatted numeric string/number into a finite number.
 * Accepts "1,5" (comma decimal) and "1.5". Returns null if not numeric/finite.
 */
export function parseNumeric(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  // If it contains a comma but no dot, treat comma as decimal separator.
  let normalized = trimmed;
  if (normalized.includes(',') && !normalized.includes('.')) {
    normalized = normalized.replace(',', '.');
  } else {
    // otherwise strip thousands commas
    normalized = normalized.replace(/,/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Authoritative answer validation (§15.1). The client imports this for
 * pre-submit checks; the server runs it as the untrusted-input gate and then
 * additionally verifies attachment ownership.
 *
 * @param questions current questions for the form (source of truth for options)
 * @param answers   raw answers object from the client (untrusted)
 */
export function validateAnswers(
  questions: QuestionDef[],
  answers: unknown,
): ValidationResult {
  const errors: Record<string, string> = {};
  const normalized: AnswersMap = {};

  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return { ok: false, errors: { _form: 'Invalid answers payload.' }, normalized: {} };
  }
  const raw = answers as Record<string, unknown>;
  const byId = new Map(questions.map((q) => [q.id, q]));

  // 1. Reject unknown keys (prevents injection into AI prompt / column_values).
  for (const key of Object.keys(raw)) {
    if (!byId.has(key)) {
      errors[key] = 'Unknown question.';
    }
  }

  for (const q of questions) {
    const entry = raw[q.id];

    // 2. Required-field handling.
    const present = entry !== undefined && entry !== null;
    const entryObj = (present && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined);

    if (!present) {
      if (q.required) errors[q.id] = 'This field is required.';
      continue;
    }
    if (!entryObj) {
      errors[q.id] = 'Invalid answer.';
      continue;
    }

    // 8. type must equal the question's declared type.
    if (entryObj.type !== q.type) {
      errors[q.id] = `Expected answer of type ${q.type}.`;
      continue;
    }

    const cfg = q.options ?? {};
    const type = q.type as QuestionType;

    switch (type) {
      case 'text':
      case 'long_text': {
        const value = typeof entryObj.value === 'string' ? entryObj.value.trim() : '';
        if (q.required && value === '') {
          errors[q.id] = 'This field is required.';
          break;
        }
        if (cfg.maxLength && value.length > cfg.maxLength) {
          errors[q.id] = `Maximum ${cfg.maxLength} characters.`;
          break;
        }
        normalized[q.id] = { type, value };
        break;
      }
      case 'number': {
        if (isBlank(entryObj.value)) {
          if (q.required) errors[q.id] = 'This field is required.';
          break;
        }
        const n = parseNumeric(entryObj.value);
        if (n === null) {
          errors[q.id] = 'Must be a number.';
          break;
        }
        if (cfg.min !== undefined && n < cfg.min) {
          errors[q.id] = `Must be at least ${cfg.min}.`;
          break;
        }
        if (cfg.max !== undefined && n > cfg.max) {
          errors[q.id] = `Must be at most ${cfg.max}.`;
          break;
        }
        normalized[q.id] = { type: 'number', value: n };
        break;
      }
      case 'single_select': {
        const value = typeof entryObj.value === 'string' ? entryObj.value : '';
        if (isBlank(value)) {
          if (q.required) errors[q.id] = 'Please choose an option.';
          break;
        }
        const opts = cfg.options ?? [];
        if (!opts.includes(value)) {
          errors[q.id] = 'Invalid option selected.';
          break;
        }
        normalized[q.id] = { type: 'single_select', value };
        break;
      }
      case 'multi_select': {
        const value = Array.isArray(entryObj.value) ? (entryObj.value as unknown[]) : null;
        if (value === null) {
          errors[q.id] = 'Invalid selection.';
          break;
        }
        if (value.length === 0) {
          if (q.required) errors[q.id] = 'Please choose at least one option.';
          else normalized[q.id] = { type: 'multi_select', value: [] };
          break;
        }
        const opts = cfg.options ?? [];
        const strs = value.map((v) => String(v));
        const allValid = strs.every((v) => opts.includes(v));
        const hasDupes = new Set(strs).size !== strs.length;
        if (!allValid) {
          errors[q.id] = 'Invalid option selected.';
          break;
        }
        if (hasDupes) {
          errors[q.id] = 'Duplicate options selected.';
          break;
        }
        if (cfg.minSelections && strs.length < cfg.minSelections) {
          errors[q.id] = `Select at least ${cfg.minSelections}.`;
          break;
        }
        if (cfg.maxSelections && strs.length > cfg.maxSelections) {
          errors[q.id] = `Select at most ${cfg.maxSelections}.`;
          break;
        }
        normalized[q.id] = { type: 'multi_select', value: strs };
        break;
      }
      case 'attachment': {
        const ids = Array.isArray(entryObj.attachmentIds)
          ? (entryObj.attachmentIds as unknown[]).map((v) => String(v))
          : null;
        if (ids === null) {
          errors[q.id] = 'Invalid attachment answer.';
          break;
        }
        if (ids.length === 0) {
          if (q.required) errors[q.id] = 'Please upload a file.';
          else normalized[q.id] = { type: 'attachment', attachmentIds: [] };
          break;
        }
        // Ownership (ids belong to this submission+question) is checked server-side.
        normalized[q.id] = { type: 'attachment', attachmentIds: ids };
        break;
      }
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, normalized };
}
