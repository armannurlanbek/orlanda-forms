// Dashboard (/app). Lists forms via React Query; "New Form" creates a draft and
// routes into the builder; per-form public link with copy button; logout in the
// header. Public link is only meaningful once published.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormDetail, FormSummary } from '@orlanda/shared';
import { ApiError, api } from '../lib/api';
import { AppHeader } from './components/AppHeader';
import { CopyButton } from './components/CopyButton';
import { Badge, Button, Card, Spinner } from './components/ui';
import { ToastProvider, useToast } from './components/Toast';

function publicUrl(slug: string): string {
  return `${window.location.origin}/${slug}`;
}

function StatusBadge({ status }: { status: FormSummary['status'] }): JSX.Element {
  return status === 'published' ? <Badge tone="green">Published</Badge> : <Badge tone="slate">Draft</Badge>;
}

function DashboardInner(): JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  const formsQuery = useQuery({
    queryKey: ['forms'],
    queryFn: () => api.get<FormSummary[]>('/api/forms'),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<FormDetail>('/api/forms', { title: 'Untitled form' }),
    onMutate: () => setCreating(true),
    onSuccess: (detail) => {
      qc.invalidateQueries({ queryKey: ['forms'] });
      navigate(`/app/forms/${detail.id}`);
    },
    onError: (err) => {
      setCreating(false);
      toast(err instanceof ApiError ? err.message : 'Could not create form.', 'error');
    },
  });

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Forms</h1>
          <Button variant="primary" disabled={creating} onClick={() => createMutation.mutate()}>
            {creating ? <Spinner /> : null}
            New form
          </Button>
        </div>

        {formsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Spinner className="mr-2" /> Loading forms…
          </div>
        ) : formsQuery.isError ? (
          <Card className="p-6">
            <p className="text-sm text-red-700">Could not load forms. Please try again.</p>
            <Button className="mt-3" onClick={() => formsQuery.refetch()}>
              Retry
            </Button>
          </Card>
        ) : formsQuery.data && formsQuery.data.length > 0 ? (
          <ul className="space-y-3">
            {formsQuery.data.map((f) => (
              <li key={f.id}>
                <Card className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/app/forms/${f.id}`}
                          className="truncate text-base font-semibold text-slate-900 hover:underline"
                        >
                          {f.title || 'Untitled form'}
                        </Link>
                        <StatusBadge status={f.status} />
                        <Badge tone="blue">{f.mappingMode === 'ai' ? 'AI' : 'Direct'}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                        <span>
                          {f.submissionCount} submission{f.submissionCount === 1 ? '' : 's'}
                        </span>
                        {f.status === 'published' ? (
                          <a
                            href={publicUrl(f.slug)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-blue-700 hover:underline"
                          >
                            {publicUrl(f.slug)}
                          </a>
                        ) : (
                          <span className="text-slate-400">Not published yet</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <CopyButton
                        value={publicUrl(f.slug)}
                        disabled={f.status !== 'published'}
                        label="Copy link"
                      />
                      <Link to={`/app/forms/${f.id}/submissions`}>
                        <Button size="sm">Submissions</Button>
                      </Link>
                      <Link to={`/app/forms/${f.id}`}>
                        <Button size="sm" variant="primary">
                          Edit
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <p className="text-slate-600">No forms yet.</p>
            <Button variant="primary" disabled={creating} onClick={() => createMutation.mutate()}>
              Create your first form
            </Button>
          </Card>
        )}
      </main>
    </div>
  );
}

export function DashboardPage(): JSX.Element {
  return (
    <ToastProvider>
      <DashboardInner />
    </ToastProvider>
  );
}
