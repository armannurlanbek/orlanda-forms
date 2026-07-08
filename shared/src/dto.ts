// API contracts shared by client and server. The public DTO whitelist (§16.6)
// is the security boundary for the unauthenticated form endpoint.

import type { MappingMode, FormStatus, QuestionType, Role, SubmissionStatus, QuestionConfig } from './types';
import type { Theme } from './theme';
import type { AllowlistColumn } from './monday';
import type { FormTranslations, QuestionTranslations } from './i18n';

// ── Public (unauthenticated) — render-safe ONLY (§16.6) ─────────────────────
export interface PublicQuestionDTO {
  id: string;
  order: number;
  type: QuestionType;
  label: string;
  helpText?: string | null;
  required: boolean;
  options?: QuestionConfig | null;
  translations?: QuestionTranslations | null;
}

export interface PublicFormDTO {
  slug: string;
  defaultLang: string;
  languages: string[]; // offered set incl. default (>=1), display order
  translations?: FormTranslations | null;
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
  translations?: QuestionTranslations | null;
  // Direct mode mapping: { columnId, columnType, ...perTypeExtras } (§12.3).
  directMapping?: { columnId: string; columnType: string; [k: string]: unknown } | null;
}

export interface FormDetail {
  id: string;
  slug: string;
  defaultLang: string;
  languages: string[];
  translations?: FormTranslations | null;
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
  /** Optional custom public link (slug). When present and changed, the server
   *  validates + enforces global uniqueness. Omit to keep the current slug. */
  slug?: string;
  defaultLang?: string;
  languages?: string[];
  translations?: FormTranslations | null;
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

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 60;

/**
 * Validate a custom public-link slug. Returns an error message, or null when
 * valid. Single source of truth shared by the builder (live feedback) and the
 * server (authoritative). Rules: lowercase a–z/0–9 and single hyphens, no
 * leading/trailing/double hyphens, length bounds, and not a reserved path.
 */
export function slugError(slug: string): string | null {
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return `Link must be ${SLUG_MIN_LENGTH}–${SLUG_MAX_LENGTH} characters.`;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'Use lowercase letters, numbers and single hyphens only (no spaces).';
  }
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
    return 'That link is reserved — choose another.';
  }
  return null;
}
