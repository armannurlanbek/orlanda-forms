// Accessible field scaffold (§17.7): label[for], help text via aria-describedby,
// required marker (visible + aria-required), and an inline error with
// role="alert"/aria-live="polite". Children receive the ids to wire up.
import type { ReactNode } from 'react';

export interface FieldIds {
  inputId: string;
  helpId: string | undefined;
  errorId: string | undefined;
  /** combined aria-describedby string (help + error), or undefined */
  describedBy: string | undefined;
  hasError: boolean;
}

interface FieldProps {
  label: string;
  helpText?: string | null;
  required: boolean;
  error?: string;
  /** base id used to derive input/help/error ids */
  baseId: string;
  /** render the control; receives wiring ids */
  children: (ids: FieldIds) => ReactNode;
  /** for radio/checkbox groups use a <fieldset>/<legend> instead of <label> */
  asGroup?: boolean;
}

export function Field({
  label,
  helpText,
  required,
  error,
  baseId,
  children,
  asGroup = false,
}: FieldProps): JSX.Element {
  const inputId = `${baseId}-input`;
  const helpId = helpText ? `${baseId}-help` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const ids: FieldIds = { inputId, helpId, errorId, describedBy, hasError: Boolean(error) };

  const labelNode = (
    <>
      {label}
      {required && (
        <span className="ml-1 text-red-600" aria-hidden="true">
          *
        </span>
      )}
    </>
  );

  return (
    <div className="mb-6">
      {asGroup ? (
        <fieldset>
          <legend className="mb-2 block text-base font-medium text-brand-text">{labelNode}</legend>
          {helpText && (
            <p id={helpId} className="mb-2 text-sm text-brand-text/80">
              {helpText}
            </p>
          )}
          {children(ids)}
        </fieldset>
      ) : (
        <>
          <label htmlFor={inputId} className="mb-2 block text-base font-medium text-brand-text">
            {labelNode}
          </label>
          {helpText && (
            <p id={helpId} className="mb-2 text-sm text-brand-text/80">
              {helpText}
            </p>
          )}
          {children(ids)}
        </>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="mt-2 text-sm font-medium text-red-600"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Shared input/textarea classes; red ring on error, themed focus elsewhere. */
export function controlClass(hasError: boolean): string {
  return [
    'block w-full rounded-lg border bg-white px-3 py-2.5 text-base text-brand-text',
    'min-h-tap placeholder:text-brand-text/40',
    'focus:outline-none focus-visible:outline focus-visible:outline-2',
    hasError ? 'border-red-500' : 'border-slate-300',
  ].join(' ');
}
