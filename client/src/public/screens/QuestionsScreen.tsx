// Questions screen (§4 public side, screen 2): every question rendered per its
// type (§17.4), inline validation, file UX for attachments, and a Submit button
// with a submitting state. Validation reuses the shared validator via the
// usePublicForm hook. On submit-with-errors we focus the first invalid field.
import { useRef } from 'react';
import type { PublicFormDTO } from '@orlanda/shared';
import { ScreenShell } from './ScreenShell';
import { QuestionWidget } from '../widgets/QuestionWidget';
import type { UsePublicFormResult } from '../usePublicForm';

interface Props {
  form: PublicFormDTO;
  controller: UsePublicFormResult;
  submitting: boolean;
  formError: string | null;
  onSubmit: () => void;
}

export function QuestionsScreen({
  form,
  controller,
  submitting,
  formError,
  onSubmit,
}: Props): JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const firstInvalid = controller.validateAll();
    if (firstInvalid) {
      // Focus the first invalid control (input/select/textarea/button) in its field.
      const field = formRef.current?.querySelector<HTMLElement>(
        `#q-${cssEscape(firstInvalid)}-input, [id^="q-${cssEscape(firstInvalid)}-input"]`,
      );
      field?.focus();
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    onSubmit();
  };

  const sorted = [...form.questions].sort((a, b) => a.order - b.order);

  return (
    <ScreenShell screenKey="questions" heading={form.title}>
      {form.description && (
        <p className="mt-1 mb-4 text-base text-brand-text/70">{form.description}</p>
      )}

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-6">
        {sorted.map((q, i) => (
          <QuestionWidget
            key={q.id}
            question={q}
            index={i}
            value={controller.raw[q.id]}
            files={controller.files}
            error={controller.errors[q.id]}
            onChange={controller.setValue}
            onToggleMulti={controller.toggleMulti}
            onAddFiles={controller.addFiles}
            onRemoveFile={controller.removeFile}
            onBlurValidate={controller.validateField}
          />
        ))}

        {formError && (
          <p
            role="alert"
            aria-live="assertive"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="flex min-h-tap w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-6 py-3 text-base font-semibold text-brand-onPrimary shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting && <Spinner />}
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </form>
    </ScreenShell>
  );
}

function Spinner(): JSX.Element {
  return (
    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}

/** Minimal CSS.escape fallback for safe attribute-selector interpolation. */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
