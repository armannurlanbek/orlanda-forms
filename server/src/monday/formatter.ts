// Monday column_values formatter (§12). ONE formatter per target column type,
// dispatched on columnType. Used by BOTH the Direct mapper and the AI engine
// (the AI returns human values that are converted here). Pure — no network.
//
// The returned `value` is the plain JS that goes under the columnId in the
// column_values object; the WHOLE object is JSON.stringify()'d once by the
// caller (§12.4) — nested objects here must NOT be pre-stringified.

import { parseNumeric } from '@orlanda/shared';

export type FormatResult = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Extract the allowed labels for a status/dropdown column from its verbatim
 * `settings_str` (§6). status: `{ "labels": { "0": "New", ... } }`.
 * dropdown: `{ "labels": [ { "id":1, "name":"A" }, ... ] }`.
 */
export function parseAllowedLabels(settingsStr: string | undefined | null, columnType: string): string[] {
  if (!settingsStr) return [];
  let settings: unknown;
  try {
    settings = JSON.parse(settingsStr);
  } catch {
    return [];
  }
  const labels = (settings as { labels?: unknown }).labels;
  if (columnType === 'status') {
    if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
      return Object.values(labels as Record<string, unknown>)
        .map((v) => String(v))
        .filter((v) => v.length > 0);
    }
    return [];
  }
  if (columnType === 'dropdown') {
    if (Array.isArray(labels)) {
      return labels.map((l) => String((l as { name?: unknown }).name ?? '')).filter((v) => v.length > 0);
    }
    return [];
  }
  return [];
}

/**
 * Extract the linked board id(s) from a board-relation/connect column's verbatim
 * `settings_str` (`{ "boardIds": [123], ... }`). Returns them as strings.
 */
export function parseLinkedBoardIds(settingsStr: string | undefined | null): string[] {
  if (!settingsStr) return [];
  try {
    const settings = JSON.parse(settingsStr) as { boardIds?: unknown };
    if (Array.isArray(settings.boardIds)) {
      return settings.boardIds.map((b) => String(b)).filter((b) => b.length > 0);
    }
  } catch {
    /* ignore malformed settings */
  }
  return [];
}

export interface FormatOpts {
  /** Allowed labels for status/dropdown (from settings_str or the AI allowlist). */
  allowedLabels?: string[];
  /** ISO-2 country for phone columns (§12). Defaults to 'US'. */
  countryShortName?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', 'yes', '1', 'checked', 'on'].includes(v.trim().toLowerCase());
  return false;
}

/**
 * Format a single human value into a Monday column_values entry for `columnType`.
 * Returns `{ ok:false, reason }` for unsupported types or invalid values — the
 * caller drops these into Submission.droppedColumns (§12.1 / §18.7).
 */
export function formatColumnValue(columnType: string, raw: unknown, opts: FormatOpts = {}): FormatResult {
  switch (columnType) {
    case 'text':
    case 'long_text':
      return { ok: true, value: asString(raw) };

    case 'numbers': {
      if (raw === '' || raw === null || raw === undefined) return { ok: true, value: '' };
      const n = parseNumeric(raw);
      if (n === null) return { ok: false, reason: 'value is not numeric' };
      return { ok: true, value: String(n) };
    }

    case 'status': {
      const label = asString(raw).trim();
      if (!label) return { ok: false, reason: 'empty status label' };
      if (opts.allowedLabels && !opts.allowedLabels.includes(label)) {
        return { ok: false, reason: `label "${label}" not in allowed labels` };
      }
      return { ok: true, value: { label } };
    }

    case 'dropdown': {
      const labels = Array.isArray(raw) ? raw.map(asString) : asString(raw) ? [asString(raw)] : [];
      if (labels.length === 0) return { ok: false, reason: 'no dropdown labels' };
      if (opts.allowedLabels) {
        const bad = labels.find((l) => !opts.allowedLabels!.includes(l));
        if (bad) return { ok: false, reason: `label "${bad}" not in allowed labels` };
      }
      return { ok: true, value: { labels } };
    }

    case 'date': {
      if (typeof raw === 'object' && raw !== null && 'date' in (raw as object)) {
        const obj = raw as { date?: unknown; time?: unknown };
        const date = asString(obj.date);
        if (!isRealDate(date)) return { ok: false, reason: 'invalid date' };
        if (obj.time !== undefined && obj.time !== null && obj.time !== '') {
          const time = asString(obj.time);
          if (!TIME_RE.test(time)) return { ok: false, reason: 'invalid time' };
          return { ok: true, value: { date, time } };
        }
        return { ok: true, value: { date } };
      }
      const date = asString(raw).trim();
      if (!isRealDate(date)) return { ok: false, reason: 'invalid date (expected YYYY-MM-DD)' };
      return { ok: true, value: { date } };
    }

    case 'email': {
      const email = asString(raw).trim();
      if (!email) return { ok: false, reason: 'empty email' };
      return { ok: true, value: { email, text: email } };
    }

    case 'link': {
      const url = asString(raw).trim();
      if (!url) return { ok: false, reason: 'empty link' };
      return { ok: true, value: { url, text: url } };
    }

    case 'phone': {
      const digits = asString(raw).replace(/\D/g, '');
      if (!digits) return { ok: false, reason: 'empty phone' };
      return { ok: true, value: { phone: digits, countryShortName: opts.countryShortName ?? 'US' } };
    }

    case 'checkbox':
      return truthy(raw) ? { ok: true, value: { checked: 'true' } } : { ok: true, value: {} };

    case 'timeline': {
      const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as { from?: unknown; to?: unknown };
      const from = asString(obj.from);
      const to = asString(obj.to);
      if (!isRealDate(from) || !isRealDate(to)) return { ok: false, reason: 'invalid timeline range' };
      return { ok: true, value: { from, to } };
    }

    case 'connect_boards':
    case 'board_relation': {
      const arr = Array.isArray(raw) ? raw : [raw];
      const ids = arr.map((v) => Number(v)).filter((n) => Number.isInteger(n));
      if (ids.length === 0) return { ok: false, reason: 'no valid item ids' };
      return { ok: true, value: { item_ids: ids } };
    }

    case 'people':
      // Never inferred from free text (§12 / §18.1).
      return { ok: false, reason: 'people columns cannot be set from free-text answers' };

    case 'file':
      // File columns are set via the assets flow, never via column_values (§12.2).
      return { ok: false, reason: 'file columns use the assets upload flow, not column_values' };

    default:
      return { ok: false, reason: `unsupported column type "${columnType}"` };
  }
}
