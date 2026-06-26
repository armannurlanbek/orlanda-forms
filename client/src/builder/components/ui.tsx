// Shared, dependency-free UI primitives for the builder. Plain Tailwind, no
// raw-HTML injection anywhere (§16.7). Buttons/inputs are keyboard-accessible
// and use the frozen focus-ring (index.css :focus-visible).
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400 border border-transparent',
  secondary:
    'bg-white text-slate-800 hover:bg-slate-50 border border-slate-300 disabled:opacity-50',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border border-transparent',
  danger:
    'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 border border-transparent',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: ButtonProps): JSX.Element {
  const sz = size === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-4 py-2 text-sm';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${sz} ${className}`}
      {...rest}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 ${className}`}
        {...rest}
      />
    );
  },
);

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return (
    <textarea
      className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }): JSX.Element {
  return (
    <select
      className={`w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Label({ children, htmlFor, required }: { children: ReactNode; htmlFor?: string; required?: boolean }): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
      {required ? <span className="ml-0.5 text-red-500">*</span> : null}
    </label>
  );
}

export function Spinner({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

type BadgeTone = 'green' | 'amber' | 'red' | 'slate' | 'blue';
const BADGE_TONES: Record<BadgeTone, string> = {
  green: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-blue-100 text-blue-800 border-blue-200',
};

export function Badge({ tone = 'slate', children }: { tone?: BadgeTone; children: ReactNode }): JSX.Element {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}
