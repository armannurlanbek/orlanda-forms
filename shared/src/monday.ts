// Monday.com column types, board-schema shapes, and the Direct-mode
// type-compatibility matrix (§12, §17.3). The actual value FORMATTER lives in
// the server (server/src/monday/formatter.ts); these are the shared contracts so
// the builder UI's compatibility hints agree with the server's formatting.

import type { QuestionType } from './types';

// Column types the app understands. The Direct formatter + AI engine emit the
// wire shapes for these (§12). Anything else is treated as terminal-invalid.
export type MondayColumnType =
  | 'text'
  | 'long_text'
  | 'numbers'
  | 'status'
  | 'dropdown'
  | 'date'
  | 'email'
  | 'phone'
  | 'link'
  | 'checkbox'
  | 'people'
  | 'timeline'
  | 'connect_boards'
  | 'file';

export interface MondayColumn {
  id: string;
  title: string;
  type: string; // raw type string from Monday (may be outside our union)
  settings_str: string; // verbatim — status/dropdown labels + file settings live here
}

export interface MondayGroup {
  id: string;
  title: string;
}

export interface MondayBoardSchema {
  id: string;
  name: string;
  columns: MondayColumn[];
  groups: MondayGroup[];
}

// A column the builder has allow-listed for AI writes (§18.3).
export interface AllowlistColumn {
  columnId: string;
  title: string;
  type: string;
  allowedLabels?: string[]; // for status/dropdown
  /** For board-relation/connect columns: the board this column links to (so the
   *  AI search tool / Direct resolver knows which board to search). */
  linkBoardId?: string;
}

// The object that is JSON.stringify()'d into the column_values GraphQL variable.
export type ColumnValues = Record<string, unknown>;

// Direct-mode hint level for a (questionType -> columnType) pairing (§17.3).
export type CompatLevel = 'ok' | 'warn' | 'block';

// MUST agree with the §12 formatting table. §12 is authoritative on payloads.
const COMPAT: Record<QuestionType, Partial<Record<string, CompatLevel>>> = {
  // text / single_select may also map to a board-relation column: the answer
  // (e.g. a project name) is resolved to a linked item, which populates any
  // mirror that reflects that relation (§ linked-items feature).
  text: { text: 'ok', long_text: 'ok', board_relation: 'ok', connect_boards: 'ok', numbers: 'warn', status: 'warn', dropdown: 'warn', email: 'warn', phone: 'warn' },
  long_text: { long_text: 'ok', text: 'ok', status: 'warn', dropdown: 'warn' },
  number: { numbers: 'ok', text: 'warn', long_text: 'warn' },
  single_select: { status: 'ok', dropdown: 'ok', board_relation: 'ok', connect_boards: 'ok', text: 'warn', long_text: 'warn' },
  multi_select: { dropdown: 'ok', long_text: 'warn', text: 'warn' },
  attachment: { file: 'ok' },
};

/** Returns the compatibility level for mapping a question type to a column type. */
export function compatLevel(questionType: QuestionType, columnType: string): CompatLevel {
  return COMPAT[questionType]?.[columnType] ?? 'block';
}

// Board-relation/connect columns are the WRITABLE link to another board; a
// mirror/lookup column is READ-ONLY and is populated indirectly by setting the
// link column it reflects.
export const LINK_COLUMN_TYPES = ['board_relation', 'connect_boards'];
export const MIRROR_COLUMN_TYPES = ['mirror', 'lookup'];

/** A board-relation/connect column — writable, links items on another board. */
export function isLinkColumn(columnType: string): boolean {
  return LINK_COLUMN_TYPES.includes(columnType);
}

/** A mirror/lookup column — read-only; populate via its link column instead. */
export function isMirrorColumn(columnType: string): boolean {
  return MIRROR_COLUMN_TYPES.includes(columnType);
}

/** Column types the Direct formatter can emit a value for (file handled separately). */
export const FORMATTABLE_COLUMN_TYPES: MondayColumnType[] = [
  'text',
  'long_text',
  'numbers',
  'status',
  'dropdown',
  'date',
  'email',
  'phone',
  'link',
  'checkbox',
  'people',
  'timeline',
  'connect_boards',
];
