// Form Builder (/app/forms/new and /app/forms/:id). 3-panel on desktop, tabbed
// on mobile. Hydrates a Zustand store from GET /api/forms/:id; explicit Save
// (full ordered questions array, §17.1) via PUT; Publish gated on a saved,
// non-dirty, ready form (§15.3.4 / §17.1). Dirty state warns on navigate-away.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormDetail } from '@orlanda/shared';
import { ApiError, api } from '../lib/api';
import { useBuilderStore } from './store';
import { useBeforeUnloadGuard, useGuardedNavigate } from './hooks/useUnsavedGuard';
import { usePublishReadiness } from './hooks/usePublishReadiness';
import { AppHeader } from './components/AppHeader';
import { Badge, Button, Input, Spinner } from './components/ui';
import { ToastProvider, useToast } from './components/Toast';
import { PreviewMapping } from './components/PreviewMapping';
import { Palette } from './panels/Palette';
import { Canvas } from './panels/Canvas';
import { SettingsPanel } from './panels/SettingsPanel';

type MobileTab = 'add' | 'questions' | 'settings';

function BuilderInner(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();

  const isNew = id === undefined; // matched /app/forms/new
  const store = useBuilderStore();
  const { dirty, formId, status, slug } = store;
  const readiness = usePublishReadiness();

  const [mobileTab, setMobileTab] = useState<MobileTab>('questions');
  const guardedNavigate = useGuardedNavigate(dirty);
  useBeforeUnloadGuard(dirty);

  // /app/forms/new => create a draft first, then redirect to its id route.
  const createMutation = useMutation({
    mutationFn: () => api.post<FormDetail>('/api/forms', { title: 'Untitled form' }),
    onSuccess: (detail) => {
      qc.invalidateQueries({ queryKey: ['forms'] });
      store.hydrate(detail);
      navigate(`/app/forms/${detail.id}`, { replace: true });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not create form.', 'error'),
  });

  useEffect(() => {
    if (isNew && !createMutation.isPending && store.formId === null) {
      createMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  // Load existing form into the store.
  const detailQuery = useQuery({
    queryKey: ['form', id],
    queryFn: () => api.get<FormDetail>(`/api/forms/${id}`),
    enabled: !!id,
  });

  useEffect(() => {
    if (detailQuery.data) store.hydrate(detailQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailQuery.data]);

  // Reset the store when leaving the builder so the next form starts clean.
  useEffect(() => {
    return () => store.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!formId) throw new Error('Form not ready');
      return api.put<FormDetail>(`/api/forms/${formId}`, store.toSaveInput());
    },
    onSuccess: (detail) => {
      store.markSaved(detail);
      qc.invalidateQueries({ queryKey: ['forms'] });
      qc.setQueryData(['form', detail.id], detail);
      toast('Form saved.', 'success');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        const first = Object.values(err.fields)[0];
        toast(first ?? err.message, 'error');
      } else {
        toast(err instanceof ApiError ? err.message : 'Save failed.', 'error');
      }
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => {
      if (!formId) throw new Error('Form not ready');
      return api.post<FormDetail>(`/api/forms/${formId}/publish`);
    },
    onSuccess: (detail) => {
      store.markSaved(detail);
      qc.invalidateQueries({ queryKey: ['forms'] });
      qc.setQueryData(['form', detail.id], detail);
      toast('Form published.', 'success');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        const msgs = Object.values(err.fields);
        toast(msgs[0] ?? err.message, 'error');
      } else {
        toast(err instanceof ApiError ? err.message : 'Publish failed.', 'error');
      }
    },
  });

  function onPublish(): void {
    if (dirty) {
      toast('Save your changes before publishing.', 'error');
      return;
    }
    if (!readiness.ready) {
      toast(readiness.issues[0] ?? 'Form is not ready to publish.', 'error');
      return;
    }
    publishMutation.mutate();
  }

  // Loading states for create/load.
  if (isNew && store.formId === null) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <Spinner className="mr-2" /> Creating form…
      </div>
    );
  }
  if (id && detailQuery.isLoading && !store.loaded) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <Spinner className="mr-2" /> Loading form…
      </div>
    );
  }
  if (id && detailQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-600">
        <p>Could not load this form.</p>
        <Button onClick={() => navigate('/app')}>Back to dashboard</Button>
      </div>
    );
  }

  const saving = saveMutation.isPending;
  const publishing = publishMutation.isPending;
  const publishDisabled = dirty || !readiness.ready || publishing || !formId;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <AppHeader>
        <button
          type="button"
          onClick={() => guardedNavigate('/app')}
          className="text-sm text-slate-500 hover:text-slate-800 hover:underline"
        >
          ← Forms
        </button>
      </AppHeader>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Input
            aria-label="Form title"
            className="max-w-xs"
            value={store.form.title}
            placeholder="Untitled form"
            onChange={(e) => store.setField('title', e.target.value)}
          />
          {status === 'published' ? <Badge tone="green">Published</Badge> : <Badge tone="slate">Draft</Badge>}
          {dirty ? <Badge tone="amber">Unsaved changes</Badge> : <Badge tone="slate">Saved</Badge>}
          {slug && status === 'published' ? (
            <a
              href={`${window.location.origin}/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden truncate text-sm text-blue-700 hover:underline sm:inline"
            >
              /{slug}
            </a>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {formId ? <PreviewMapping formId={formId} /> : null}
          <Button
            variant="secondary"
            onClick={() => guardedNavigate(`/app/forms/${formId}/submissions`)}
            disabled={!formId}
          >
            Submissions
          </Button>
          <Button variant="primary" onClick={() => saveMutation.mutate()} disabled={saving || !formId}>
            {saving ? <Spinner /> : null}
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="primary"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={onPublish}
            disabled={publishDisabled}
            title={dirty ? 'Save before publishing' : readiness.ready ? '' : readiness.issues[0]}
          >
            {publishing ? <Spinner /> : null}
            Publish
          </Button>
        </div>
      </div>

      {/* Readiness hints */}
      {!readiness.ready ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          To publish: {readiness.issues.join(' · ')}
        </div>
      ) : null}

      {/* Mobile tab switcher */}
      <div className="flex border-b border-slate-200 bg-white lg:hidden">
        {(['add', 'questions', 'settings'] as MobileTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setMobileTab(t)}
            className={`flex-1 px-3 py-2 text-sm font-medium ${
              mobileTab === t ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500'
            }`}
          >
            {t === 'add' ? 'Add' : t === 'questions' ? 'Questions' : 'Settings'}
          </button>
        ))}
      </div>

      {/* Panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left palette */}
        <aside
          className={`${mobileTab === 'add' ? 'block' : 'hidden'} w-full overflow-auto border-r border-slate-200 bg-white p-4 lg:block lg:w-56`}
        >
          <Palette />
        </aside>

        {/* Center canvas */}
        <main
          className={`${mobileTab === 'questions' ? 'block' : 'hidden'} flex-1 overflow-auto p-4 lg:block`}
        >
          <Canvas />
        </main>

        {/* Right settings + mapping */}
        <aside
          className={`${mobileTab === 'settings' ? 'block' : 'hidden'} w-full overflow-auto border-l border-slate-200 bg-white p-4 lg:block lg:w-96`}
        >
          <SettingsPanel />
        </aside>
      </div>
    </div>
  );
}

export function FormBuilderPage(): JSX.Element {
  return (
    <ToastProvider>
      <BuilderInner />
    </ToastProvider>
  );
}
