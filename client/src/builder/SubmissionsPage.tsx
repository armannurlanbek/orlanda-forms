// Submissions viewer (/app/forms/:id/submissions). Table of SubmissionRow[] —
// timestamp, status, linked Monday item (deep link, new tab), AI reasoning
// (internal), error. "Retry failed" per failed/partial row -> POST
// /api/submissions/:id/retry then refetch. ALL answer/reasoning/error text is
// rendered as PLAIN TEXT (never dangerouslySetInnerHTML) (§16.7).
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormDetail, SubmissionRow, SubmissionStatus } from '@orlanda/shared';
import { ApiError, api } from '../lib/api';
import { AppHeader } from './components/AppHeader';
import { Badge, Button, Card, Spinner } from './components/ui';
import { ToastProvider, useToast } from './components/Toast';

const STATUS_TONE: Record<SubmissionStatus, 'green' | 'amber' | 'red' | 'slate' | 'blue'> = {
  received: 'slate',
  item_created: 'blue',
  files_pending: 'amber',
  mapped: 'green',
  partial: 'amber',
  failed: 'red',
};

function StatusBadge({ status }: { status: SubmissionStatus }): JSX.Element {
  return <Badge tone={STATUS_TONE[status]}>{status.replace(/_/g, ' ')}</Badge>;
}

function answersToText(answers: Record<string, unknown>): string {
  // Compact, plain-text rendering of the answer map (never raw HTML).
  return Object.entries(answers)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

function SubmissionRowItem({
  row,
  onRetry,
  retrying,
}: {
  row: SubmissionRow;
  onRetry: (id: string) => void;
  retrying: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const canRetry = row.status === 'failed' || row.status === 'partial';
  return (
    <>
      <tr className="border-t border-slate-200 align-top">
        <td className="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
          {new Date(row.createdAt).toLocaleString()}
        </td>
        <td className="px-3 py-2">
          <StatusBadge status={row.status} />
        </td>
        <td className="px-3 py-2 text-sm">
          {row.mondayItemUrl ? (
            <a
              href={row.mondayItemUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              {row.mondayItemId ?? 'Open item'}
            </a>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-sm text-red-700">
          {row.errorMessage ? <span>{row.errorMessage}</span> : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Hide' : 'Details'}
            </Button>
            {canRetry ? (
              <Button size="sm" disabled={retrying} onClick={() => onRetry(row.id)}>
                {retrying ? <Spinner /> : null}
                Retry
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={5} className="px-3 py-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Answers</div>
                <pre className="whitespace-pre-wrap break-words rounded bg-white p-3 text-xs text-slate-800">
                  {answersToText(row.answers) || '—'}
                </pre>
              </div>
              <div className="space-y-3">
                {row.aiReasoning ? (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">AI reasoning (internal)</div>
                    <p className="whitespace-pre-wrap break-words rounded bg-white p-3 text-xs text-slate-700">
                      {row.aiReasoning}
                    </p>
                  </div>
                ) : null}
                {row.droppedColumns && row.droppedColumns.length > 0 ? (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Dropped columns</div>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {row.droppedColumns.map((d, i) => (
                        <li key={i}>
                          <span className="font-mono">{d.columnId}</span>: {d.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {row.attachments.length > 0 ? (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Attachments</div>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {row.attachments.map((a) => (
                        <li key={a.id}>
                          {a.originalFilename} ({Math.round(a.sizeBytes / 1024)} KB){' '}
                          {a.uploadedToMonday ? (
                            <Badge tone="green">on Monday</Badge>
                          ) : (
                            <Badge tone="amber">pending</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SubmissionsInner(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const formQuery = useQuery({
    queryKey: ['form', id],
    queryFn: () => api.get<FormDetail>(`/api/forms/${id}`),
    enabled: !!id,
  });

  const subsQuery = useQuery({
    queryKey: ['submissions', id],
    queryFn: () => api.get<SubmissionRow[]>(`/api/forms/${id}/submissions`),
    enabled: !!id,
  });

  const retryMutation = useMutation({
    mutationFn: (submissionId: string) => api.post(`/api/submissions/${submissionId}/retry`),
    onMutate: (submissionId: string) => setRetryingId(submissionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submissions', id] });
      toast('Retry queued.', 'success');
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Retry failed.', 'error'),
    onSettled: () => setRetryingId(null),
  });

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <AppHeader>
        <button
          type="button"
          onClick={() => navigate(`/app/forms/${id}`)}
          className="text-sm text-slate-500 hover:text-slate-800 hover:underline"
        >
          ← Builder
        </button>
      </AppHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Submissions</h1>
            {formQuery.data ? <p className="text-sm text-slate-500">{formQuery.data.title}</p> : null}
          </div>
          <Button onClick={() => subsQuery.refetch()} disabled={subsQuery.isFetching}>
            {subsQuery.isFetching ? <Spinner /> : null}
            Refresh
          </Button>
        </div>

        {subsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Spinner className="mr-2" /> Loading submissions…
          </div>
        ) : subsQuery.isError ? (
          <Card className="p-6">
            <p className="text-sm text-red-700">Could not load submissions.</p>
            <Button className="mt-3" onClick={() => subsQuery.refetch()}>
              Retry
            </Button>
          </Card>
        ) : subsQuery.data && subsQuery.data.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Monday item</th>
                    <th className="px-3 py-2">Error</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subsQuery.data.map((row) => (
                    <SubmissionRowItem
                      key={row.id}
                      row={row}
                      retrying={retryingId === row.id}
                      onRetry={(sid) => retryMutation.mutate(sid)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card className="p-12 text-center text-slate-500">No submissions yet.</Card>
        )}
      </main>
    </div>
  );
}

export function SubmissionsPage(): JSX.Element {
  return (
    <ToastProvider>
      <SubmissionsInner />
    </ToastProvider>
  );
}
