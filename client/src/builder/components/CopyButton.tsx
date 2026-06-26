// Copy-to-clipboard with a transient "Copied" state. Uses the async Clipboard
// API with a textarea fallback for non-secure contexts.
import { useState } from 'react';
import { Button } from './ui';

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export function CopyButton({
  value,
  label = 'Copy link',
  disabled,
}: {
  value: string;
  label?: string;
  disabled?: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      disabled={disabled}
      aria-label={copied ? 'Copied' : label}
      onClick={async () => {
        try {
          await copyText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
    >
      {copied ? 'Copied!' : label}
    </Button>
  );
}
