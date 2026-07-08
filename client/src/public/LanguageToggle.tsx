// Instant language switcher for the public form (multilingual forms). Renders
// nothing for a single-language form. Display-only: switching never touches
// already-entered answers or what eventually gets submitted (§ canonical
// submit — see usePublicForm.ts / widgets/QuestionWidget.tsx).
import { languageInfo, uiStrings } from '@orlanda/shared';

interface Props {
  /** offered set incl. default, display order (PublicFormDTO.languages) */
  languages: string[];
  activeLang: string;
  onChange: (code: string) => void;
}

export function LanguageToggle({ languages, activeLang, onChange }: Props): JSX.Element | null {
  if (languages.length <= 1) return null;
  const label = uiStrings(activeLang).languageLabel;

  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {languages.map((code) => {
        const info = languageInfo(code);
        const active = code === activeLang;
        return (
          <button
            key={code}
            type="button"
            onClick={() => onChange(code)}
            aria-pressed={active}
            lang={code}
            className={`min-h-tap rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
              active
                ? 'bg-brand-primary text-brand-onPrimary'
                : 'text-brand-text/70 hover:text-brand-text'
            }`}
          >
            {info?.nativeName ?? code}
          </button>
        );
      })}
    </div>
  );
}
