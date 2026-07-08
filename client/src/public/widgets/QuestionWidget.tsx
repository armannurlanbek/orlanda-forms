// Per-type input widget dispatcher (§17.4). One control per question type:
//   text          -> single-line input
//   long_text     -> auto-grow textarea
//   number        -> inputMode numeric, min/max/step
//   single_select -> radio group, or native <select> when options > 7
//   multi_select  -> checkbox group, honoring min/max selection hints
//   attachment    -> file control (§17.5, mobile-first)
import { useEffect, useRef } from 'react';
import { localizedOptionLabel, resolveText, type PublicQuestionDTO } from '@orlanda/shared';
import { Field, controlClass, type FieldIds } from './Field';
import { AttachmentWidget } from './AttachmentWidget';
import type { RawValue, FilesByQuestion } from '../usePublicForm';
import type { SelectedFile } from '../files';

const NATIVE_SELECT_THRESHOLD = 7;

interface Props {
  question: PublicQuestionDTO;
  index: number;
  value: RawValue;
  files: FilesByQuestion;
  error?: string;
  /** Multilingual forms: the visitor's active display language and the form's
   *  base language. Display-only — the submitted answer always stays the base
   *  option string; only the visible label is localized (canonical submit). */
  activeLang: string;
  defaultLang: string;
  onChange: (questionId: string, value: RawValue) => void;
  onToggleMulti: (questionId: string, option: string, checked: boolean) => void;
  onAddFiles: (questionId: string, list: FileList | File[]) => void;
  onRemoveFile: (questionId: string, fileId: string) => void;
  onBlurValidate: (questionId: string) => void;
}

export function QuestionWidget(props: Props): JSX.Element {
  const { question: q, error, activeLang, defaultLang, onBlurValidate } = props;
  const baseId = `q-${q.id}`;
  const cfg = q.options ?? {};
  const blur = () => onBlurValidate(q.id);

  // Resolve the question's own label/help in the active language, falling
  // back to the base (default-language) text when untranslated.
  const qt = activeLang === defaultLang ? undefined : q.translations?.[activeLang];
  const label = resolveText(q.label, qt?.label);
  const helpText = resolveText(q.helpText, qt?.helpText);

  return (
    <Field
      label={label}
      helpText={helpText}
      required={q.required}
      error={error}
      baseId={baseId}
      asGroup={q.type === 'single_select' || q.type === 'multi_select' || q.type === 'attachment'}
    >
      {(ids) => {
        switch (q.type) {
          case 'text':
            return <TextControl q={q} ids={ids} {...props} onBlur={blur} />;
          case 'long_text':
            return <LongTextControl q={q} ids={ids} {...props} onBlur={blur} />;
          case 'number':
            return <NumberControl q={q} ids={ids} cfg={cfg} {...props} onBlur={blur} />;
          case 'single_select':
            return <SingleSelectControl q={q} ids={ids} {...props} onBlur={blur} />;
          case 'multi_select':
            return <MultiSelectControl q={q} ids={ids} {...props} />;
          case 'attachment':
            return (
              <AttachmentWidget
                question={q}
                ids={ids}
                files={props.files[q.id] ?? []}
                onAddFiles={props.onAddFiles}
                onRemoveFile={props.onRemoveFile}
              />
            );
          default:
            return null;
        }
      }}
    </Field>
  );
}

type SharedCtrl = {
  q: PublicQuestionDTO;
  ids: FieldIds;
  value: RawValue;
  activeLang: string;
  defaultLang: string;
  onChange: (questionId: string, value: RawValue) => void;
  onBlur?: () => void;
};

function TextControl({ q, ids, value, onChange, onBlur }: SharedCtrl): JSX.Element {
  const cfg = q.options ?? {};
  return (
    <input
      id={ids.inputId}
      type="text"
      className={controlClass(ids.hasError)}
      value={typeof value === 'string' ? value : ''}
      maxLength={cfg.maxLength}
      required={q.required}
      aria-required={q.required}
      aria-invalid={ids.hasError || undefined}
      aria-describedby={ids.describedBy}
      onChange={(e) => onChange(q.id, e.target.value)}
      onBlur={onBlur}
    />
  );
}

function LongTextControl({ q, ids, value, onChange, onBlur }: SharedCtrl): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Auto-grow: reset then size to scrollHeight on every change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={ids.inputId}
      rows={3}
      className={`${controlClass(ids.hasError)} resize-none overflow-hidden`}
      value={typeof value === 'string' ? value : ''}
      required={q.required}
      aria-required={q.required}
      aria-invalid={ids.hasError || undefined}
      aria-describedby={ids.describedBy}
      onChange={(e) => onChange(q.id, e.target.value)}
      onBlur={onBlur}
    />
  );
}

function NumberControl({
  q,
  ids,
  cfg,
  value,
  onChange,
  onBlur,
}: SharedCtrl & { cfg: NonNullable<PublicQuestionDTO['options']> }): JSX.Element {
  const allowsDecimal = cfg.step === undefined || cfg.step % 1 !== 0;
  return (
    <input
      id={ids.inputId}
      type="text"
      inputMode={allowsDecimal ? 'decimal' : 'numeric'}
      // A loose pattern keeps numeric keypad on mobile while letting the shared
      // validator (parseNumeric) own the real rules.
      pattern="[0-9.,-]*"
      className={controlClass(ids.hasError)}
      value={typeof value === 'string' ? value : ''}
      required={q.required}
      aria-required={q.required}
      aria-invalid={ids.hasError || undefined}
      aria-describedby={ids.describedBy}
      min={cfg.min}
      max={cfg.max}
      step={cfg.step}
      onChange={(e) => onChange(q.id, e.target.value)}
      onBlur={onBlur}
    />
  );
}

function SingleSelectControl({
  q,
  ids,
  value,
  activeLang,
  defaultLang,
  onChange,
  onBlur,
}: SharedCtrl): JSX.Element {
  const opts = q.options?.options ?? [];
  const selected = typeof value === 'string' ? value : '';
  // Canonical submit: `value`/onChange always carry the BASE option string —
  // only the visible label text is localized via localizedOptionLabel().

  if (opts.length > NATIVE_SELECT_THRESHOLD) {
    return (
      <select
        id={ids.inputId}
        className={controlClass(ids.hasError)}
        value={selected}
        required={q.required}
        aria-required={q.required}
        aria-invalid={ids.hasError || undefined}
        aria-describedby={ids.describedBy}
        onChange={(e) => onChange(q.id, e.target.value)}
        onBlur={onBlur}
      >
        <option value="">Select an option…</option>
        {opts.map((opt) => (
          <option key={opt} value={opt}>
            {localizedOptionLabel(opt, q.translations, activeLang, defaultLang)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-required={q.required}
      aria-invalid={ids.hasError || undefined}
      aria-describedby={ids.describedBy}
      className="space-y-2"
    >
      {opts.map((opt, i) => {
        const id = `${ids.inputId}-${i}`;
        return (
          <label
            key={opt}
            htmlFor={id}
            className="flex min-h-tap cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5 has-[:checked]:border-brand-primary"
          >
            <input
              id={id}
              type="radio"
              name={ids.inputId}
              value={opt}
              checked={selected === opt}
              className="h-5 w-5 accent-brand-primary"
              onChange={() => onChange(q.id, opt)}
              onBlur={onBlur}
            />
            <span className="text-base text-brand-text">
              {localizedOptionLabel(opt, q.translations, activeLang, defaultLang)}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function MultiSelectControl({
  q,
  ids,
  value,
  activeLang,
  defaultLang,
  onToggleMulti,
}: SharedCtrl & {
  onToggleMulti: (questionId: string, option: string, checked: boolean) => void;
}): JSX.Element {
  const opts = q.options?.options ?? [];
  const cfg = q.options ?? {};
  const selected = new Set(Array.isArray(value) ? value : []);
  const hint =
    cfg.minSelections || cfg.maxSelections
      ? `Select ${cfg.minSelections ?? 0}${cfg.maxSelections ? `–${cfg.maxSelections}` : '+'} options`
      : null;

  return (
    <div
      role="group"
      aria-required={q.required}
      aria-invalid={ids.hasError || undefined}
      aria-describedby={ids.describedBy}
      className="space-y-2"
    >
      {hint && <p className="mb-1 text-sm text-brand-text/80">{hint}</p>}
      {opts.map((opt, i) => {
        const id = `${ids.inputId}-${i}`;
        const checked = selected.has(opt);
        return (
          <label
            key={opt}
            htmlFor={id}
            className="flex min-h-tap cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5 has-[:checked]:border-brand-primary"
          >
            <input
              id={id}
              type="checkbox"
              value={opt}
              checked={checked}
              className="h-5 w-5 accent-brand-primary"
              onChange={(e) => onToggleMulti(q.id, opt, e.target.checked)}
            />
            <span className="text-base text-brand-text">
              {localizedOptionLabel(opt, q.translations, activeLang, defaultLang)}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// Re-export the SelectedFile type so callers can keep imports local if needed.
export type { SelectedFile };
