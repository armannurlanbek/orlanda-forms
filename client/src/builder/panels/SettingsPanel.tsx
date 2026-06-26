// Right panel — Settings + Mapping. Board selection + schema refresh, the
// Direct/AI mode toggle and the matching mapping UI, welcome/thank-you/privacy
// content, theme colors (with AA warnings), logo upload, and the daily cap.
import type { MappingMode, Theme } from '@orlanda/shared';
import { meetsAA } from '@orlanda/shared';
import { useBuilderStore } from '../store';
import { useBoardSchema, useBoards, useRefreshBoardSchema } from '../hooks/useMonday';
import { DirectMapping } from './DirectMapping';
import { AiMapping } from './AiMapping';
import { ColorField } from '../components/ColorField';
import { LogoUpload } from '../components/LogoUpload';
import { Button, Input, Label, Select, Spinner, Textarea } from '../components/ui';
import { RefreshIcon } from '../components/icons';

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

export function SettingsPanel(): JSX.Element {
  const form = useBuilderStore((s) => s.form);
  const setField = useBuilderStore((s) => s.setField);
  const setMappingMode = useBuilderStore((s) => s.setMappingMode);
  const setTheme = useBuilderStore((s) => s.setTheme);

  const boardsQuery = useBoards();
  const schemaQuery = useBoardSchema(form.boardId);
  const refresh = useRefreshBoardSchema(form.boardId);

  function patchTheme(next: Partial<Theme['colors']>): void {
    const merged: Theme = { ...form.theme, colors: { ...form.theme.colors, ...next } };
    setTheme(merged);
  }

  const primaryAA = meetsAA(form.theme.colors.primary, form.theme.colors.onPrimary);
  const textAA = meetsAA(form.theme.colors.text, form.theme.colors.bg);

  return (
    <div className="space-y-5">
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
        <div className="space-y-3">
          <div>
            <Label htmlFor="welcome-text">Welcome text</Label>
            <Textarea
              id="welcome-text"
              rows={2}
              value={form.welcomeText}
              onChange={(e) => setField('welcomeText', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="welcome-btn">Start button label</Label>
            <Input
              id="welcome-btn"
              value={form.welcomeButtonLabel}
              onChange={(e) => setField('welcomeButtonLabel', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="thankyou-text">Thank-you text</Label>
            <Textarea
              id="thankyou-text"
              rows={2}
              value={form.thankYouText}
              onChange={(e) => setField('thankYouText', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="privacy-text">Privacy notice</Label>
            <Textarea
              id="privacy-text"
              rows={2}
              value={form.privacyNotice}
              onChange={(e) => setField('privacyNotice', e.target.value)}
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
