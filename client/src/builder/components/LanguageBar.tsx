// Editing-language switcher (§ multilingual forms). Shown in the builder
// header whenever the form offers more than one language; lets staff pick
// which language's text the canvas/settings editors currently show. This is
// transient builder UI state (`editingLang`) — never sent to the server.
import { languageInfo } from '@orlanda/shared';
import { useBuilderStore } from '../store';

export function LanguageBar(): JSX.Element | null {
  const form = useBuilderStore((s) => s.form);
  const editingLang = useBuilderStore((s) => s.editingLang);
  const setEditingLang = useBuilderStore((s) => s.setEditingLang);

  const offered = form.languages.length ? form.languages : [form.defaultLang];
  if (offered.length <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label="Editing language"
      className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5"
    >
      {offered.map((code) => (
        <button
          key={code}
          role="tab"
          aria-selected={editingLang === code}
          type="button"
          onClick={() => setEditingLang(code)}
          className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
            editingLang === code ? 'bg-accent text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {languageInfo(code)?.nativeName ?? code}
          {code === form.defaultLang ? ' •' : ''}
        </button>
      ))}
    </div>
  );
}
