// Welcome screen (§4 public side, screen 1): Orlanda logo + welcomeText + Start
// button. Privacy notice shown here before submission (§16.9). All builder text
// rendered as plain text (never dangerouslySetInnerHTML) (§16.7).
import type { PublicFormDTO } from '@orlanda/shared';
import { ScreenShell } from './ScreenShell';
import { resolveLogoUrl } from '../theme';

const DEFAULT_PRIVACY =
  'Your responses and any files you upload are processed by Orlanda Engineering to handle this submission. By continuing, you agree to this use of your information.';

interface Props {
  form: PublicFormDTO;
  onStart: () => void;
}

export function WelcomeScreen({ form, onStart }: Props): JSX.Element {
  const logoUrl = resolveLogoUrl(form.theme);
  const privacy = form.privacyNotice?.trim() || DEFAULT_PRIVACY;

  return (
    <ScreenShell
      screenKey="welcome"
      heading={form.title}
      beforeHeading={
        <div className="mb-6 flex flex-col items-center text-center">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Orlanda Engineering"
              className="mb-3 max-h-20 w-auto object-contain"
            />
          ) : (
            <span className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-primary">
              Orlanda Engineering
            </span>
          )}
        </div>
      }
      headingClassName="text-center text-2xl font-bold text-brand-text"
    >
      {form.description && (
        <p className="mt-2 text-center text-base text-brand-text/80">{form.description}</p>
      )}

      {form.welcomeText && (
        <p className="mt-4 whitespace-pre-line text-center text-base text-brand-text/90">
          {form.welcomeText}
        </p>
      )}

      <button
        type="button"
        onClick={onStart}
        className="mt-8 flex min-h-tap w-full items-center justify-center rounded-lg bg-brand-primary px-6 py-3 text-base font-semibold text-brand-onPrimary shadow-sm transition-colors hover:opacity-90"
      >
        {form.welcomeButtonLabel || 'Start'}
      </button>

      <p className="mt-6 text-center text-xs leading-relaxed text-brand-text/60">{privacy}</p>
    </ScreenShell>
  );
}
