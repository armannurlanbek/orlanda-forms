// Public (unauthenticated) form page — the mobile-first 3-screen form (§4).
//   Welcome → Questions → Thank You, with themed colors, smooth transitions
//   (reduced-motion aware), shared-validator validation, and a multipart submit
//   carrying attachment files inline (§13.1).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PublicFormDTO } from '@orlanda/shared';
import { api, ApiError } from '../lib/api';
import { NotFoundPage } from './NotFoundPage';
import { themeToCssVars } from './theme';
import { useActiveLang, usePublicForm } from './usePublicForm';
import { LanguageToggle } from './LanguageToggle';
import { submitPublicForm } from './submit';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { QuestionsScreen } from './screens/QuestionsScreen';
import { ThankYouScreen } from './screens/ThankYouScreen';
import './public.css';

type Screen = 'welcome' | 'questions' | 'thankyou';

export function PublicFormPage(): JSX.Element {
  const { slug = '' } = useParams<{ slug: string }>();

  const query = useQuery<PublicFormDTO, ApiError>({
    queryKey: ['public-form', slug],
    queryFn: () => api.get<PublicFormDTO>(`/api/public/forms/${encodeURIComponent(slug)}`),
    enabled: slug !== '',
    retry: (failureCount, error) => {
      // Never retry 4xx (404/429 are terminal for the user); allow a couple for 5xx.
      if (error instanceof ApiError && error.status < 500) return false;
      return failureCount < 2;
    },
    refetchOnWindowFocus: false,
  });

  if (query.isLoading) return <LoadingState />;

  if (query.isError) {
    const err = query.error;
    if (err instanceof ApiError && err.status === 404) return <NotFoundPage />;
    if (err instanceof ApiError && err.status === 429) {
      return (
        <CenteredMessage
          title="Too many requests"
          body="You've made a lot of requests in a short time. Please wait a little while and try again."
        />
      );
    }
    return (
      <CenteredMessage
        title="Something went wrong"
        body="We couldn't load this form right now. Please try again in a moment."
      />
    );
  }

  // Success but data not yet present (should not happen once !isLoading/!isError).
  if (!query.data) return <LoadingState />;

  return <PublicForm form={query.data} />;
}

function PublicForm({ form }: { form: PublicFormDTO }): JSX.Element {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { activeLang, setActiveLang, dir } = useActiveLang(form);
  const controller = usePublicForm(form.questions, activeLang);
  const themeVars = useMemo(() => themeToCssVars(form.theme), [form.theme]);

  // One idempotency key per submission attempt; reused on double-tap/retry so a
  // duplicate POST never creates a second submission/item (§13.1 / §14.1).
  const idempotencyKeyRef = useRef<string | null>(null);
  const idempotencyKey = useCallback(() => {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = makeUuid();
    return idempotencyKeyRef.current;
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      await submitPublicForm({
        slug: form.slug,
        answers: controller.canonical(),
        filesByQuestion: controller.files,
        idempotencyKey: idempotencyKey(),
      });
      // Success: a fresh attempt would need a new key, but we're done.
      setScreen('thankyou');
    } catch (err) {
      // Keep the SAME idempotencyKey for retry (do not reset the ref).
      const message =
        err instanceof ApiError && err.status === 429
          ? 'Too many submissions right now. Please wait a moment and try again.'
          : 'We could not submit your response. Please check your connection and try again.';
      setFormError(message);
      setSubmitting(false);
    }
  }, [form.slug, controller, idempotencyKey]);

  return (
    <main dir={dir} style={themeVars} className="min-h-full bg-brand-bg text-brand-text">
      {form.languages.length > 1 && (
        <div className="mx-auto flex w-full max-w-md justify-end px-5 pt-4">
          <LanguageToggle languages={form.languages} activeLang={activeLang} onChange={setActiveLang} />
        </div>
      )}
      {screen === 'welcome' && (
        <WelcomeScreen form={form} onStart={() => setScreen('questions')} />
      )}
      {screen === 'questions' && (
        <QuestionsScreen
          form={form}
          controller={controller}
          submitting={submitting}
          formError={formError}
          onSubmit={handleSubmit}
        />
      )}
      {screen === 'thankyou' && <ThankYouScreen form={form} />}
    </main>
  );
}

function makeUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC4122-ish fallback for older mobile browsers without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function LoadingState(): JSX.Element {
  // After a while still loading, surface a "slow network" hint + a way to retry.
  // Single timer, cleaned up on unmount so it never fires after the form loads.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 bg-brand-bg public-safe"
      aria-busy="true"
    >
      <span className="sr-only">Loading form…</span>
      <svg className="h-8 w-8 animate-spin text-brand-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
      </svg>
      {slow && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p aria-live="polite" className="max-w-xs text-sm text-brand-text/80">
            Still loading… check your connection.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-tap items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-base font-medium text-brand-text shadow-sm hover:opacity-90"
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-600">
      <h1 tabIndex={-1} className="text-2xl font-semibold text-slate-800 outline-none">
        {title}
      </h1>
      <p className="mt-2 max-w-sm">{body}</p>
    </div>
  );
}
