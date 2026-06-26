// Thank-you screen (§4 public side, screen 3): thankYouText confirmation ONLY.
// Nothing internal — no mapping details, no board info, no Monday item link.
import type { PublicFormDTO } from '@orlanda/shared';
import { ScreenShell } from './ScreenShell';

const DEFAULT_THANK_YOU = 'Thank you. Your response has been submitted.';

interface Props {
  form: PublicFormDTO;
}

export function ThankYouScreen({ form }: Props): JSX.Element {
  const message = form.thankYouText?.trim() || DEFAULT_THANK_YOU;

  return (
    <ScreenShell
      screenKey="thankyou"
      heading="Submission received"
      headingClassName="text-center text-2xl font-bold text-brand-text"
      beforeHeading={
        <div className="mb-4 flex justify-center" aria-hidden="true">
          <CheckBadge />
        </div>
      }
    >
      <p className="mt-3 whitespace-pre-line text-center text-base text-brand-text/80">{message}</p>
    </ScreenShell>
  );
}

function CheckBadge(): JSX.Element {
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-700">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}
