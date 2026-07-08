// Right panel — Settings + Mapping. Board selection + schema refresh, the
// Direct/AI mode toggle and the matching mapping UI, welcome/thank-you/privacy
// content, theme colors (with AA warnings), logo upload, and the daily cap.
import { useState } from 'react';
import type { MappingMode, Theme } from '@orlanda/shared';
import { SUPPORTED_LANGUAGES, languageInfo, meetsAA, slugError } from '@orlanda/shared';
import { useBuilderStore } from '../store';
import { useBoardSchema, useBoards, useRefreshBoardSchema } from '../hooks/useMonday';
import { useTranslatableFormField } from '../hooks/useTranslatable';
import { DirectMapping } from './DirectMapping';
import { AiMapping } from './AiMapping';
import { ColorField } from '../components/ColorField';
import { LogoUpload } from '../components/LogoUpload';
import { Badge, Button, Input, Label, Select, Spinner, Textarea } from '../components/ui';
import { RefreshIcon, TrashIcon } from '../components/icons';

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="border-b border-slate-200 pb-5">
      <h3 className="mb-3 text-sm font-bold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function ModeToggle({ mode, onChange }: { mode: MappingMode; onChange: (m: MappingMode) => void }): JSX.Element {
  return (
    <div role="tablist" aria-label="Mapping mode" className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
      {(['direct', 'ai'] as MappingMode[]).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          type="button"
          onClick={() => onChange(m)}
          className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
            mode === m ? 'bg-accent text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {m === 'direct' ? 'Direct' : 'AI'}
        </button>
      ))}
    </div>
  );
}

// Languages section: offered set + default language + inline-confirm removal
// (§ multilingual forms). `languages` is the full offered set INCLUDING the
// default; an empty store value means single-language (just the default).
function LanguageSettings(): JSX.Element {
  const form = useBuilderStore((s) => s.form);
  const addLanguage = useBuilderStore((s) => s.addLanguage);
  const removeLanguage = useBuilderStore((s) => s.removeLanguage);
  const setDefaultLang = useBuilderStore((s) => s.setDefaultLang);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const offered = form.languages.length ? form.languages : [form.defaultLang];
  const addable = SUPPORTED_LANGUAGES.filter((l) => !offered.includes(l.code));
  const extras = offered.filter((code) => code !== form.defaultLang);

  return (
    <Section title="Languages">
      <div className="space-y-3">
        <div>
          <Label htmlFor="default-lang">Default language</Label>
          <Select id="default-lang" value={form.defaultLang} onChange={(e) => setDefaultLang(e.target.value)}>
            {offered.map((code) => (
              <option key={code} value={code}>
                {languageInfo(code)?.nativeName ?? code}
              </option>
            ))}
          </Select>
        </div>

        {extras.length > 0 ? (
          <div>
            <Label>Also offered</Label>
            <div className="flex flex-wrap items-center gap-2">
              {extras.map((code) => (
                <div key={code} className="flex items-center gap-1">
                  <Badge tone="slate">{languageInfo(code)?.nativeName ?? code}</Badge>
                  {confirmRemove === code ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          removeLanguage(code);
                          setConfirmRemove(null);
                        }}
                      >
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${languageInfo(code)?.name ?? code}`}
                      onClick={() => setConfirmRemove(code)}
                    >
                      <TrashIcon size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {addable.length > 0 ? (
          <div>
            <Label htmlFor="add-lang">Add language</Label>
            <Select
              id="add-lang"
              value=""
              onChange={(e) => {
                if (e.target.value) addLanguage(e.target.value);
              }}
            >
              <option value="">— Add a language —</option>
              {addable.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <p className="text-xs text-slate-500">
          Visitors see the form in their browser&rsquo;s language and can switch; untranslated text falls back to
          the default.
        </p>
      </div>
    </Section>
  );
}

export function SettingsPanel(): JSX.Element {
  const form = useBuilderStore((s) => s.form);
  const status = useBuilderStore((s) => s.status);
  // The persisted (last-saved) slug — used to tell the user that clearing the
  // field keeps their current public link rather than removing it (Finding #7).
  const savedSlug = useBuilderStore((s) => s.slug);
  const setField = useBuilderStore((s) => s.setField);
  const setMappingMode = useBuilderStore((s) => s.setMappingMode);
  const setTheme = useBuilderStore((s) => s.setTheme);
  const editingLang = useBuilderStore((s) => s.editingLang);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const slugErr = form.slug ? slugError(form.slug) : null;

  const boardsQuery = useBoards();
  const schemaQuery = useBoardSchema(form.boardId);
  const refresh = useRefreshBoardSchema(form.boardId);

  function patchTheme(next: Partial<Theme['colors']>): void {
    const merged: Theme = { ...form.theme, colors: { ...form.theme.colors, ...next } };
    setTheme(merged);
  }

  const primaryAA = meetsAA(form.theme.colors.primary, form.theme.colors.onPrimary);
  const textAA = meetsAA(form.theme.colors.text, form.theme.colors.bg);

  // Language-aware bindings for the Content section (§ multilingual forms):
  // when editing a non-default language these read/write form.translations
  // instead of the base column, with the base text shown as a placeholder.
  const welcomeTextField = useTranslatableFormField('welcomeText');
  const welcomeBtnField = useTranslatableFormField('welcomeButtonLabel');
  const thankYouField = useTranslatableFormField('thankYouText');
  const privacyField = useTranslatableFormField('privacyNotice');

  return (
    <div className="space-y-5">
      <LanguageSettings />

      <Section title="Public link">
        <Label htmlFor="form-slug">Custom link</Label>
        <div className="flex items-center gap-1">
          <span className="shrink-0 text-sm text-slate-400">{origin}/</span>
          <Input
            id="form-slug"
            value={form.slug}
            placeholder="my-form"
            aria-invalid={slugErr ? true : undefined}
            onChange={(e) => setField('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'))}
          />
        </div>
        {slugErr ? (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {slugErr}
          </p>
        ) : !form.slug && savedSlug ? (
          <p className="mt-1 break-all text-xs text-slate-500">
            Leave blank to keep the current public link: {origin}/{savedSlug}
          </p>
        ) : (
          <p className="mt-1 break-all text-xs text-slate-500">
            Public URL: {origin}/{form.slug || '…'}
          </p>
        )}
        {status === 'published' ? (
          <p className="mt-1 text-xs text-amber-700">
            Changing the link retires the current published URL — old links will stop working.
          </p>
        ) : null}
      </Section>

      <Section title="Target board">
        <Label htmlFor="board-select">Monday board</Label>
        <Select
          id="board-select"
          value={form.boardId ?? ''}
          onChange={(e) => setField('boardId', e.target.value || null)}
        >
          <option value="">— Select a board —</option>
          {boardsQuery.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        {boardsQuery.isLoading ? <p className="mt-1 text-xs text-slate-400">Loading boards…</p> : null}
        {boardsQuery.isError ? <p className="mt-1 text-xs text-red-600">Could not load boards.</p> : null}

        {form.boardId ? (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? <Spinner /> : <RefreshIcon size={15} />}
              Refresh schema
            </Button>
            {schemaQuery.isFetching ? <span className="text-xs text-slate-400">Loading schema…</span> : null}
            {schemaQuery.isError ? <span className="text-xs text-red-600">Schema unavailable.</span> : null}
          </div>
        ) : null}
      </Section>

      <Section title="Mapping mode">
        <ModeToggle mode={form.mappingMode} onChange={setMappingMode} />
        <div className="mt-4">
          {form.mappingMode === 'direct' ? (
            <DirectMapping schema={schemaQuery.data} />
          ) : (
            <AiMapping schema={schemaQuery.data} />
          )}
        </div>
      </Section>

      <Section title="Content">
        {!welcomeTextField.isDefault ? (
          <p className="mb-3 text-xs text-slate-500">
            Editing {languageInfo(editingLang)?.nativeName ?? editingLang}. Leave a field blank to fall back to the
            default-language text shown as its placeholder.
          </p>
        ) : null}
        <div className="space-y-3">
          <div>
            <Label htmlFor="welcome-text">Welcome text</Label>
            <Textarea
              id="welcome-text"
              rows={2}
              value={welcomeTextField.value}
              placeholder={welcomeTextField.placeholder}
              onChange={(e) => welcomeTextField.onChange(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="welcome-btn">Start button label</Label>
            <Input
              id="welcome-btn"
              value={welcomeBtnField.value}
              placeholder={welcomeBtnField.placeholder}
              onChange={(e) => welcomeBtnField.onChange(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="thankyou-text">Thank-you text</Label>
            <Textarea
              id="thankyou-text"
              rows={2}
              value={thankYouField.value}
              placeholder={thankYouField.placeholder}
              onChange={(e) => thankYouField.onChange(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="privacy-text">Privacy notice</Label>
            <Textarea
              id="privacy-text"
              rows={2}
              value={privacyField.value}
              placeholder={privacyField.placeholder}
              onChange={(e) => privacyField.onChange(e.target.value)}
            />
          </div>
        </div>
      </Section>

      <Section title="Branding & theme">
        <div className="space-y-3">
          <LogoUpload
            logoUrl={form.theme.logoUrl}
            onUploaded={(url) => setTheme({ ...form.theme, logoUrl: url })}
            onClear={() => setTheme({ ...form.theme, logoUrl: null })}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ColorField id="c-primary" label="Primary" value={form.theme.colors.primary} onChange={(v) => patchTheme({ primary: v })} />
            <ColorField id="c-onprimary" label="On primary" value={form.theme.colors.onPrimary} onChange={(v) => patchTheme({ onPrimary: v })} />
            <ColorField id="c-bg" label="Background" value={form.theme.colors.bg} onChange={(v) => patchTheme({ bg: v })} />
            <ColorField id="c-text" label="Text" value={form.theme.colors.text} onChange={(v) => patchTheme({ text: v })} />
            <ColorField id="c-focus" label="Focus ring" value={form.theme.colors.focus} onChange={(v) => patchTheme({ focus: v })} />
          </div>
          {!primaryAA ? (
            <p role="alert" className="text-xs text-amber-700">
              Primary / On-primary contrast is below AA (4.5:1). Button text may be hard to read.
            </p>
          ) : null}
          {!textAA ? (
            <p role="alert" className="text-xs text-amber-700">
              Text / Background contrast is below AA (4.5:1). Body text may be hard to read.
            </p>
          ) : null}
        </div>
      </Section>

      <Section title="Limits">
        <Label htmlFor="daily-cap">Daily submission cap (0 = unlimited)</Label>
        <Input
          id="daily-cap"
          type="number"
          inputMode="numeric"
          min={0}
          value={form.dailySubmissionCap}
          onChange={(e) => setField('dailySubmissionCap', Math.max(0, Number(e.target.value) || 0))}
        />
      </Section>
    </div>
  );
}
