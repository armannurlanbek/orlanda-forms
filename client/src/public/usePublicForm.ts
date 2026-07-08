// Public-form answer state + validation orchestration.
//
// Validation policy (§17.4 / item 4 of the brief):
//   - For text/long_text/number/single_select/multi_select we defer to the
//     SHARED validateAnswers() — the single source of truth (no divergent rules).
//   - For attachment questions the client holds File objects (not ids), so the
//     shared validator (which checks attachmentIds) cannot see them. We therefore
//     do the "≥1 file for required attachment" check here; the server fills ids.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UPLOAD_LIMITS,
  validateAnswers,
  languageDir,
  pickInitialLanguage,
  uiStrings,
  formatUiString,
  type AnswerEntry,
  type LanguageDir,
  type PublicFormDTO,
  type PublicQuestionDTO,
  type QuestionDef,
  type ValidationCode,
} from '@orlanda/shared';
import { checkFile, makeSelectedFile, type SelectedFile } from './files';

export type RawValue = string | string[] | undefined;
/** Raw per-question UI values (strings/arrays); attachments tracked separately. */
export type RawAnswers = Record<string, RawValue>;
export type FilesByQuestion = Record<string, SelectedFile[]>;
export type Errors = Record<string, string>;

/** Build the canonical answers object (§15.1) the validator + server expect. */
export function buildCanonicalAnswers(
  questions: PublicQuestionDTO[],
  raw: RawAnswers,
): Record<string, AnswerEntry> {
  const out: Record<string, AnswerEntry> = {};
  for (const q of questions) {
    const v = raw[q.id];
    switch (q.type) {
      case 'text':
        out[q.id] = { type: 'text', value: typeof v === 'string' ? v : '' };
        break;
      case 'long_text':
        out[q.id] = { type: 'long_text', value: typeof v === 'string' ? v : '' };
        break;
      case 'number':
        // Leave the raw string; the shared validator coerces via parseNumeric.
        out[q.id] = { type: 'number', value: (typeof v === 'string' ? v : '') as unknown as number };
        break;
      case 'single_select':
        out[q.id] = { type: 'single_select', value: typeof v === 'string' ? v : '' };
        break;
      case 'multi_select':
        out[q.id] = { type: 'multi_select', value: Array.isArray(v) ? v : [] };
        break;
      case 'attachment':
        // Client never has ids; server fills them from the file parts.
        out[q.id] = { type: 'attachment', attachmentIds: [] };
        break;
    }
  }
  return out;
}

/** Attachment-only validation the shared validator can't do (no ids client-side). */
function validateAttachments(
  questions: PublicQuestionDTO[],
  files: FilesByQuestion,
  lang: string,
): Errors {
  const errors: Errors = {};
  for (const q of questions) {
    if (q.type !== 'attachment') continue;
    const selected = files[q.id] ?? [];
    if (q.required && selected.length === 0) {
      errors[q.id] = uiStrings(lang).uploadRequired;
    }
  }
  return errors;
}

/** Localize a stable ValidationCode (from the shared validateAnswers()) into
 *  the visitor's active language, falling back to English via uiStrings(). */
function localizedFieldMessage(code: ValidationCode, q: QuestionDef, lang: string): string {
  const s = uiStrings(lang);
  const cfg = q.options ?? {};
  switch (code) {
    case 'maxLength':
      return formatUiString(s.maxLength, cfg.maxLength ?? 0);
    case 'min':
      return formatUiString(s.min, cfg.min ?? cfg.minSelections ?? 0);
    case 'max':
      return formatUiString(s.max, cfg.max ?? cfg.maxSelections ?? 0);
    default:
      return (s as unknown as Record<string, string>)[code] ?? s.invalid;
  }
}

export interface UsePublicFormResult {
  raw: RawAnswers;
  files: FilesByQuestion;
  errors: Errors;
  setValue: (questionId: string, value: RawValue) => void;
  toggleMulti: (questionId: string, option: string, checked: boolean) => void;
  addFiles: (questionId: string, list: FileList | File[]) => void;
  removeFile: (questionId: string, fileId: string) => void;
  validateField: (questionId: string) => void;
  /** Validate everything; returns first invalid questionId (for focus) or null. */
  validateAll: () => string | null;
  canonical: () => Record<string, AnswerEntry>;
}

export function usePublicForm(
  questions: PublicQuestionDTO[],
  activeLang: string,
): UsePublicFormResult {
  const [raw, setRaw] = useState<RawAnswers>({});
  const [files, setFiles] = useState<FilesByQuestion>({});
  const [errors, setErrors] = useState<Errors>({});

  // QuestionDef[] for the shared validator — structurally compatible with DTO.
  const defs = useMemo<QuestionDef[]>(() => questions as unknown as QuestionDef[], [questions]);

  const canonical = useCallback(
    () => buildCanonicalAnswers(questions, raw),
    [questions, raw],
  );

  // Validate one question without disturbing the others' errors.
  const validateField = useCallback(
    (questionId: string) => {
      const q = questions.find((x) => x.id === questionId);
      if (!q) return;
      setErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        if (q.type === 'attachment') {
          const selected = files[questionId] ?? [];
          if (q.required && selected.length === 0) next[questionId] = uiStrings(activeLang).uploadRequired;
          return next;
        }
        const result = validateAnswers(defs, buildCanonicalAnswers([q], raw));
        const code = result.codes?.[questionId];
        if (code) next[questionId] = localizedFieldMessage(code, q, activeLang);
        return next;
      });
    },
    [questions, defs, raw, files, activeLang],
  );

  const validateAll = useCallback((): string | null => {
    const shared = validateAnswers(defs, buildCanonicalAnswers(questions, raw));
    const merged: Errors = {};
    for (const q of questions) {
      const code = shared.codes?.[q.id];
      if (code) merged[q.id] = localizedFieldMessage(code, q, activeLang);
    }
    // Attachment-specific messages win over the shared validator's for attachment
    // questions — the client can't see attachmentIds so shared validation of that
    // field is meaningless (mirrors the previous, pre-i18n merge order).
    const attach = validateAttachments(questions, files, activeLang);
    Object.assign(merged, attach);
    // Drop the _form key from being attributed to a field.
    delete merged._form;
    setErrors(merged);
    // First invalid field in display order (for focus management).
    for (const q of questions) {
      if (merged[q.id]) return q.id;
    }
    return null;
  }, [defs, questions, raw, files, activeLang]);

  const setValue = useCallback((questionId: string, value: RawValue) => {
    setRaw((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const toggleMulti = useCallback((questionId: string, option: string, checked: boolean) => {
    setRaw((prev) => {
      const current = Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : [];
      const set = new Set(current);
      if (checked) set.add(option);
      else set.delete(option);
      return { ...prev, [questionId]: Array.from(set) };
    });
  }, []);

  const addFiles = useCallback((questionId: string, list: FileList | File[]) => {
    const incoming = Array.from(list);
    setFiles((prev) => {
      const existing = prev[questionId] ?? [];
      const allExisting = Object.values(prev).flat();
      let totalCount = allExisting.length;
      let totalBytes = allExisting.reduce((s, f) => s + f.file.size, 0);
      const accepted: SelectedFile[] = [];
      let firstError: string | null = null;

      for (const file of incoming) {
        const perFile = checkFile(file);
        if (perFile) {
          firstError ??= `${file.name}: ${perFile}`;
          continue;
        }
        if (totalCount + 1 > UPLOAD_LIMITS.maxFilesPerSubmission) {
          firstError ??= `Max ${UPLOAD_LIMITS.maxFilesPerSubmission} files total`;
          break;
        }
        if (totalBytes + file.size > UPLOAD_LIMITS.maxTotalBytes) {
          firstError ??= `Max ${Math.round(UPLOAD_LIMITS.maxTotalBytes / (1024 * 1024))} MB total`;
          continue;
        }
        accepted.push(makeSelectedFile(file));
        totalCount += 1;
        totalBytes += file.size;
      }

      // Surface the first specific rejection inline beneath the field.
      setErrors((e) => {
        const next = { ...e };
        if (firstError) next[questionId] = firstError;
        else if (accepted.length > 0) delete next[questionId];
        return next;
      });

      if (accepted.length === 0) return prev;
      return { ...prev, [questionId]: [...existing, ...accepted] };
    });
  }, []);

  const removeFile = useCallback((questionId: string, fileId: string) => {
    setFiles((prev) => {
      const existing = prev[questionId] ?? [];
      const target = existing.find((f) => f.id === fileId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const remaining = existing.filter((f) => f.id !== fileId);
      const next = { ...prev, [questionId]: remaining };
      return next;
    });
    // Clear any stale "type not allowed / too big" message after removal.
    setErrors((e) => {
      const next = { ...e };
      delete next[questionId];
      return next;
    });
  }, []);

  return {
    raw,
    files,
    errors,
    setValue,
    toggleMulti,
    addFiles,
    removeFile,
    validateField,
    validateAll,
    canonical,
  };
}

// ── Active display language (multilingual forms) ────────────────────────────
// Translations are display-only (see @orlanda/shared i18n.ts): switching
// activeLang never touches `raw`/`files`/canonical() — the base option/value
// strings built above are unaffected by which language is on screen.

const LANG_STORAGE_PREFIX = 'orlanda.lang.';

function langStorageKey(slug: string): string {
  return `${LANG_STORAGE_PREFIX}${slug}`;
}

function readRememberedLang(slug: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(langStorageKey(slug)) : null;
  } catch {
    return null; // private-browsing / storage disabled
  }
}

/**
 * Pure initial-language selection: a still-offered remembered choice wins;
 * otherwise the first browser-preferred language that is offered; otherwise
 * the form's default. DOM-free — safe to unit test directly.
 */
export function resolveInitialLang(
  dto: Pick<PublicFormDTO, 'defaultLang' | 'languages'>,
  navigatorLangs: readonly string[],
  remembered: string | null,
): string {
  if (remembered && dto.languages.includes(remembered)) return remembered;
  return pickInitialLanguage(dto.languages, navigatorLangs, dto.defaultLang);
}

export interface UseActiveLangResult {
  activeLang: string;
  setActiveLang: (code: string) => void;
  dir: LanguageDir;
}

/**
 * The visitor's active display language + writing direction for the public
 * form, with an instant client-side toggle. Persisted per-slug in
 * localStorage so a repeat visit keeps the visitor's choice.
 */
export function useActiveLang(
  form: Pick<PublicFormDTO, 'slug' | 'defaultLang' | 'languages'>,
): UseActiveLangResult {
  const [activeLang, setActiveLangState] = useState<string>(form.defaultLang);

  useEffect(() => {
    const remembered = readRememberedLang(form.slug);
    const navLangs =
      typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
    setActiveLangState(resolveInitialLang(form, navLangs, remembered));
    // Re-run detection only when the form identity/offered set changes, not on
    // every render (form.defaultLang/languages are stable for a given slug).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.slug]);

  const setActiveLang = useCallback(
    (code: string): void => {
      setActiveLangState(code);
      try {
        localStorage.setItem(langStorageKey(form.slug), code);
      } catch {
        /* ignore — private browsing / storage disabled */
      }
    },
    [form.slug],
  );

  return { activeLang, setActiveLang, dir: languageDir(activeLang) };
}
