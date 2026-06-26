// API contracts shared by client and server. The public DTO whitelist (§16.6)
// is the security boundary for the unauthenticated form endpoint.

import type { MappingMode, FormStatus, QuestionType, Role, SubmissionStatus, QuestionConfig } from './types';
import type { Theme } from './theme';
import type { AllowlistColumn } from './monday';

// ── Public (unauthenticated) — render-safe ONLY (§16.6) ─────────────────────
export interface PublicQuestionDTO {
  id: string;
  order: number;
  type: QuestionType;
  label: string;
  helpText?: string | null;
  required: boolean;
  options?: QuestionConfig | null;
}

export interface PublicFormDTO {
  slug: string;
  title: string;
  description?: string | null;
  welcomeText?: string | null;
  welcomeButtonLabel: string;
  thankYouText?: string | null;
  privacyNotice?: string | null;
  theme: Theme;
  questions: PublicQuestionDTO[];
}

export interface PublicSubmitResponse {
  ok: true;
}

// ── Auth ────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface LoginInput {
  email: string;
  password: string;
}

// ── Builder: forms ───────────────────────────────────────────────────────────
export interface FormSummary {
  id: string;
  slug: string;
  title: string;
  status: FormStatus;
  mappingMode: MappingMode;
  submissionCount: number;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionInput {
  id?: string; // absent => create; present => upsert
  type: QuestionType;
  label: string;
  helpText?: string | null;
  required: boolean;
  options?: QuestionConfig | null;
  // Direct mode mapping: { columnId, columnType, ...perTypeExtras } (§12.3).
  directMapping?: { columnId: string; columnType: string; [k: string]: unknown } | null;
}

export interface FormDetail {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  status: FormStatus;
  boardId?: string | null;
  mappingMode: MappingMode;
  aiPrompt?: string | null;
  aiAllowedColumns?: AllowlistColumn[] | null;
  welcomeText?: string | null;
  welcomeButtonLabel: string;
  thankYouText?: string | null;
  privacyNotice?: string | null;
  theme: Theme;
  dailySubmissionCap: number;
  questions: (QuestionInput & { id: string; order: number })[];
  createdAt: string;
  updatedAt: string;
}

// Full-form save (§17.1): questions is a COMPLETE ordered array. The server
// upserts by id, creates id-less entries, deletes any omitted question, and
// derives `order` from array index. Do NOT send a separate order field.
export interface SaveFormInput {
  title: string;
  description?: string | null;
  boardId?: string | null;
  mappingMode: MappingMode;
  aiPrompt?: string | null;
  aiAllowedColumns?: AllowlistColumn[] | null;
  welcomeText?: string | null;
  welcomeButtonLabel?: string;
  thankYouText?: string | null;
  privacyNotice?: string | null;
  theme?: Theme | null;
  dailySubmissionCap?: number;
  questions: QuestionInput[];
}

// ── Builder: submissions (internal — may contain PII + reasoning) ────────────
export interface SubmissionRow {
  id: string;
  status: SubmissionStatus;
  mondayItemId?: string | null;
  mondayItemUrl?: string | null;
  aiReasoning?: string | null;
  errorMessage?: string | null;
  droppedColumns?: { columnId: string; reason: string }[] | null;
  answers: Record<string, unknown>;
  attachments: { id: string; questionId: string; originalFilename: string; mimeType: string; sizeBytes: number; uploadedToMonday: boolean }[];
  clientIp?: string | null;
  createdAt: string;
}

// ── Preview / dry-run mapping (§18.9 / §20) ─────────────────────────────────
export interface DroppedColumn {
  columnId: string;
  reason: string;
}

export interface PreviewMappingResult {
  itemName: string;
  columnValues: Record<string, unknown>;
  dropped: DroppedColumn[];
  reasoning?: string | null;
}

// Standard API error envelope.
export interface ApiError {
  error: string;
  code?: string;
  fields?: Record<string, string>;
}

// Reserved slugs that may never be used as a form slug (§15.3.2 / §17.6).
export const RESERVED_SLUGS = [
  'api',
  'app',
  'assets',
  'static',
  'login',
  'logout',
  'admin',
  'public',
  'health',
  'healthz',
];
