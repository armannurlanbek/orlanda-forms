// Public-form answer state + validation orchestration.
//
// Validation policy (§17.4 / item 4 of the brief):
//   - For text/long_text/number/single_select/multi_select we defer to the
//     SHARED validateAnswers() — the single source of truth (no divergent rules).
//   - For attachment questions the client holds File objects (not ids), so the
//     shared validator (which checks attachmentIds) cannot see them. We therefore
//     do the "≥1 file for required attachment" check here; the server fills ids.
import { useCallback, useMemo, useState } from 'react';
import {
  UPLOAD_LIMITS,
  validateAnswers,
  type AnswerEntry,
  type PublicQuestionDTO,
  type QuestionDef,
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
): Errors {
  const errors: Errors = {};
  for (const q of questions) {
    if (q.type !== 'attachment') continue;
    const selected = files[q.id] ?? [];
    if (q.required && selected.length === 0) {
      errors[q.id] = 'Please add at least one file.';
    }
  }
  return errors;
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

export function usePublicForm(questions: PublicQuestionDTO[]): UsePublicFormResult {
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
          if (q.required && selected.length === 0) next[questionId] = 'Please add at least one file.';
          return next;
        }
        const result = validateAnswers(defs, buildCanonicalAnswers([q], raw));
        if (result.errors[questionId]) next[questionId] = result.errors[questionId];
        return next;
      });
    },
    [questions, defs, raw, files],
  );

  const validateAll = useCallback((): string | null => {
    const shared = validateAnswers(defs, buildCanonicalAnswers(questions, raw));
    const attach = validateAttachments(questions, files);
    const merged: Errors = { ...shared.errors, ...attach };
    // Drop the _form key from being attributed to a field.
    delete merged._form;
    setErrors(merged);
    // First invalid field in display order (for focus management).
    for (const q of questions) {
      if (merged[q.id]) return q.id;
    }
    return null;
  }, [defs, questions, raw, files]);

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
