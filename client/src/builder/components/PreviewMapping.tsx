// Preview-mapping (§18.9): dry-run POST /api/forms/:id/preview-mapping; show the
// would-be column_values + dropped report + (AI) reasoning. All values rendered
// as plain text (§16.7) — never raw HTML.
import { useState } from 'react';
import type { PreviewMappingResult } from '@orlanda/shared';
import { languageDir } from '@orlanda/shared';
import { ApiError, api } from '../../lib/api';
import { useBuilderStore } from '../store';
import { Badge, Button, Modal, Spinner } from './ui';

export function PreviewMapping({ formId }: { formId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewMappingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mapping is always computed from the default-language (canonical) values —
  // translations are display-only and never reach the mapping orchestrator
  // (§ multilingual forms). We still honor the builder's current editing
  // language for the preview container's reading direction, for consistency
  // with the public form's own RTL handling.
  const editingLang = useBuilderStore((s) => s.editingLang);

  async function run(): Promise<void> {
    setLoading(true);
    setError(null);
    setResult(null);
    setOpen(true);
    try {
      const res = await api.post<PreviewMappingResult>(`/api/forms/${formId}/preview-mapping`);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Preview failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={run}>
        Preview mapping
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Mapping preview">
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-slate-500">
            <Spinner /> Running dry-run…
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : result ? (
          <div dir={languageDir(editingLang)} className="space-y-4 text-sm">
            <div>
              <span className="font-semibold text-slate-700">Item name:</span>{' '}
              <span className="text-slate-900">{result.itemName}</span>
            </div>
            <div>
              <div className="mb-1 font-semibold text-slate-700">Column values</div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-xs text-slate-800">
                {JSON.stringify(result.columnValues, null, 2)}
              </pre>
            </div>
            {result.dropped.length > 0 ? (
              <div>
                <div className="mb-1 font-semibold text-slate-700">
                  Dropped <Badge tone="amber">{result.dropped.length}</Badge>
                </div>
                <ul className="space-y-1">
                  {result.dropped.map((d, i) => (
                    <li key={i} className="text-slate-700">
                      <span className="font-mono text-xs">{d.columnId}</span>: {d.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {result.reasoning ? (
              <div>
                <div className="mb-1 font-semibold text-slate-700">AI reasoning</div>
                <p className="whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-xs text-slate-700">
                  {result.reasoning}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
