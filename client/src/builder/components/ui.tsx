// Shared, dependency-free UI primitives for the builder. Plain Tailwind, no
// raw-HTML injection anywhere (§16.7). Buttons/inputs are keyboard-accessible
// and use the global focus-ring (index.css :focus-visible, themed to the indigo
// accent). The builder chrome uses the fixed `accent` palette (NOT the per-form
// brand theme, which belongs to the public form).
import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/50 border border-transparent shadow-sm',
  secondary:
    'bg-white text-slate-800 hover:bg-slate-50 border border-slate-300 disabled:opacity-50',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border border-transparent',
  danger:
    'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 border border-transparent shadow-sm',
  success:
    'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300 border border-transparent shadow-sm',
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
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${sz} ${className}`}
      {...rest}
    />
  );
}

/** Square icon-only button. `aria-label` is REQUIRED for accessibility. */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string;
  tone?: 'default' | 'danger';
}

export function IconButton({ className = '', tone = 'default', ...rest }: IconButtonProps): JSX.Element {
  const toneCls =
    tone === 'danger'
      ? 'text-slate-500 hover:bg-red-50 hover:text-red-600'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800';
  return (
    <button
      type="button"
      className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneCls} ${className}`}
      {...rest}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-accent disabled:cursor-not-allowed disabled:bg-slate-50 ${className}`}
        {...rest}
      />
    );
  },
);

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return (
    <textarea
      className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-accent disabled:cursor-not-allowed disabled:bg-slate-50 ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }): JSX.Element {
  return (
    <select
      className={`w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-accent disabled:cursor-not-allowed disabled:bg-slate-50 ${className}`}
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

type BadgeTone = 'green' | 'amber' | 'red' | 'slate' | 'blue' | 'accent';
const BADGE_TONES: Record<BadgeTone, string> = {
  green: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-blue-100 text-blue-800 border-blue-200',
  accent: 'bg-accent-50 text-accent-700 border-accent-200',
};

export function Badge({ tone = 'slate', children }: { tone?: BadgeTone; children: ReactNode }): JSX.Element {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`rounded-lg border border-slate-200 bg-white shadow-card ${className}`}>{children}</div>;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: overlay + centered card, role="dialog" aria-modal,
 * Escape to close, backdrop click to close, focus moved in on open and restored
 * on close, and Tab trapped within the dialog.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    // Move focus into the dialog (first focusable, else the dialog itself).
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        const active = document.activeElement as HTMLElement;
        if (e.shiftKey && active === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && active === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`mt-12 w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-lg'} rounded-xl border border-slate-200 bg-white shadow-pop outline-none`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          <IconButton aria-label="Close dialog" onClick={onClose}>
            <XCloseGlyph />
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

// Tiny inline close glyph so this file stays dependency-free; pages use the
// shared icons module for everything else.
function XCloseGlyph(): JSX.Element {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
