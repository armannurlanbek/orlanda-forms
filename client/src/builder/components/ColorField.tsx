// A single theme color token editor. Native color picker + free-text (for
// rgb()/rgba()), validated with isValidColor from shared. Shows an inline error
// for invalid values so they never reach the server (§16.8).
import { isValidColor } from '@orlanda/shared';
import { Input, Label } from './ui';

export function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const valid = isValidColor(value);
  // The native <input type="color"> only accepts #rrggbb; fall back to a neutral
  // swatch when the current value is an rgb()/rgba() string it can't show.
  const swatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : '#ffffff';
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!valid}
          className={valid ? '' : 'border-red-400'}
        />
      </div>
      {!valid ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
          Use #RGB, #RRGGBB, rgb() or rgba().
        </p>
      ) : null}
    </div>
  );
}
