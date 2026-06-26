// Core enums/types shared by client and server. Keep these in sync with the
// Prisma enums in prisma/schema.prisma.

export type Role = 'admin' | 'builder';
export type FormStatus = 'draft' | 'published';
export type MappingMode = 'direct' | 'ai';

export type QuestionType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'single_select'
  | 'multi_select'
  | 'attachment';

export const QUESTION_TYPES: QuestionType[] = [
  'text',
  'long_text',
  'number',
  'single_select',
  'multi_select',
  'attachment',
];

export type SubmissionStatus =
  | 'received'
  | 'item_created'
  | 'files_pending'
  | 'mapped'
  | 'partial'
  | 'failed';

export type AttachmentStatus = 'stored' | 'uploading' | 'uploaded' | 'failed';

// Per-question configuration stored in Question.options (jsonb).
export interface QuestionConfig {
  options?: string[]; // for single_select / multi_select
  minSelections?: number; // multi_select
  maxSelections?: number; // multi_select
  min?: number; // number
  max?: number; // number
  step?: number; // number
  maxLength?: number; // text / long_text
}

// Normalized question definition the validator and renderers read.
export interface QuestionDef {
  id: string;
  order: number;
  type: QuestionType;
  label: string;
  helpText?: string | null;
  required: boolean;
  options?: QuestionConfig | null;
}

// File upload limits (§16.2). Single source of truth for client + server.
export const UPLOAD_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024, // 10 MB per file
  maxFilesPerSubmission: 5,
  maxTotalBytes: 25 * 1024 * 1024, // 25 MB total per submission
  // extension allowlist (lowercase, no dot)
  allowedExtensions: [
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'csv',
    'txt',
  ],
  // logo uploads are stricter — raster images only (§16.8)
  logoAllowedExtensions: ['png', 'jpg', 'jpeg', 'webp'],
} as const;

// Anthropic spend/size guards (§16.1).
export const ANTHROPIC_GUARDS = {
  maxRequestBodyBytes: 256 * 1024, // excluding file bytes
  maxAnswerChars: 5000,
  maxAnswers: 200,
  maxBoardSchemaChars: 24000, // serialized allowlisted schema cap
  callTimeoutMs: 30000,
  maxOutputTokens: 2048,
} as const;
