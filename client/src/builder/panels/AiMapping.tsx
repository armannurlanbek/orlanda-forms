// AI-mode mapping (§17.3 / §18.3): a mapping-rules prompt + a multi-select
// allowlist of board columns the AI may write to (-> FormDetail.aiAllowedColumns
// as AllowlistColumn[]). The live schema (columns, types, status/dropdown
// labels) is shown below as read-only reference.
//
// Linked-items feature: board-relation/connect columns (isLinkColumn) may be
// allow-listed — when included we record their linked board id in
// AllowlistColumn.linkBoardId so the AI search tool knows which board to match
// against. Mirror/lookup columns (isMirrorColumn) are READ-ONLY: shown for
// reference but not selectable, with a hint to allow the link column instead.
import type { AllowlistColumn, MondayBoardSchema } from '@orlanda/shared';
import { isLinkColumn, isMirrorColumn } from '@orlanda/shared';
import { useBuilderStore } from '../store';
import { parseColumnLabels, parseLinkedBoardId } from '../hooks/useMonday';
import { Label, Select, Textarea } from '../components/ui';

export function AiMapping({ schema }: { schema: MondayBoardSchema | undefined }): JSX.Element {
  const aiPrompt = useBuilderStore((s) => s.form.aiPrompt);
  const allowed = useBuilderStore((s) => s.form.aiAllowedColumns);
  const setField = useBuilderStore((s) => s.setField);
  const questions = useBuilderStore((s) => s.questions);
  const updateQuestion = useBuilderStore((s) => s.updateQuestion);

  const allowedIds = new Set(allowed.map((a) => a.columnId));
  // Attachments are never mapped by the AI (§12.2); they upload to a Monday
  // `file` column chosen here, exactly like Direct mode.
  const attachmentQuestions = questions.filter((q) => q.type === 'attachment');
  const fileColumns = schema ? schema.columns.filter((c) => c.type === 'file') : [];

  function toggle(columnId: string): void {
    if (!schema) return;
    if (allowedIds.has(columnId)) {
      setField('aiAllowedColumns', allowed.filter((a) => a.columnId !== columnId));
      return;
    }
    const col = schema.columns.find((c) => c.id === columnId);
    if (!col) return;
    // Read-only mirror columns are never writable, so never allow-listed.
    if (isMirrorColumn(col.type)) return;
    const labels = parseColumnLabels(col.settings_str);
    // For link columns, record which board the AI should search by name.
    const linkBoardId = isLinkColumn(col.type) ? parseLinkedBoardId(col.settings_str) : undefined;
    const entry: AllowlistColumn = {
      columnId: col.id,
      title: col.title,
      type: col.type,
      ...(labels.length ? { allowedLabels: labels } : {}),
      ...(linkBoardId ? { linkBoardId } : {}),
    };
    setField('aiAllowedColumns', [...allowed, entry]);
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="ai-prompt">Mapping instructions</Label>
        <Textarea
          id="ai-prompt"
          rows={6}
          placeholder="Describe how answers should map to board columns. e.g. Put the company name into the Item Name; map the budget answer to the Budget column…"
          value={aiPrompt}
          onChange={(e) => setField('aiPrompt', e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          The AI may only write to the columns you allow below. Client answers are treated as data, never instructions.
        </p>
      </div>

      <div>
        <Label>Columns the AI may write to</Label>
        {!schema ? (
          <p className="text-sm text-slate-500">Select a board to choose writable columns.</p>
        ) : (
          <div className="max-h-48 space-y-1 overflow-auto rounded-md border border-slate-200 p-2">
            {schema.columns.map((c) => {
              // Mirror columns are read-only: info row, not a selectable allowlist entry.
              if (isMirrorColumn(c.type)) {
                return (
                  <div key={c.id} className="rounded px-1.5 py-1 text-sm">
                    <div className="flex items-center gap-2 text-slate-400">
                      <input type="checkbox" disabled checked={false} aria-label={`${c.title} (read-only mirror)`} />
                      <span className="font-medium">{c.title}</span>
                      <span className="text-xs">({c.type})</span>
                    </div>
                    <p className="ml-6 text-xs text-slate-400">
                      Read-only mirror — map to its Connect Boards column instead.
                    </p>
                  </div>
                );
              }
              return (
                <div key={c.id} className="rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-accent"
                      checked={allowedIds.has(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="font-medium text-slate-800">{c.title}</span>
                    <span className="text-xs text-slate-400">({c.type})</span>
                  </label>
                  {isLinkColumn(c.type) && allowedIds.has(c.id) ? (
                    <p className="ml-6 text-xs text-slate-500">
                      The AI will search the linked board by name and link the best match.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {attachmentQuestions.length > 0 ? (
        <div>
          <Label>File uploads → File column</Label>
          <p className="mb-2 text-xs text-slate-500">
            The AI never maps file uploads. Choose which Monday File column each attachment question uploads to,
            or its files will be skipped.
          </p>
          {!schema ? (
            <p className="text-sm text-slate-500">Select a board to choose File columns.</p>
          ) : fileColumns.length === 0 ? (
            <p className="text-sm text-amber-700">
              This board has no File columns. Add one in Monday to receive uploads.
            </p>
          ) : (
            <div className="space-y-3">
              {attachmentQuestions.map((q, i) => (
                <div key={q.key} className="rounded-md border border-slate-200 p-3">
                  <Label htmlFor={`ai-file-${q.key}`}>
                    #{i + 1} {q.label || '(untitled)'}
                  </Label>
                  <Select
                    id={`ai-file-${q.key}`}
                    value={q.directMapping?.columnId ?? ''}
                    onChange={(e) => {
                      const columnId = e.target.value;
                      updateQuestion(q.key, {
                        directMapping: columnId ? { columnId, columnType: 'file' } : null,
                      });
                    }}
                  >
                    <option value="">— Not mapped —</option>
                    {fileColumns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} ({c.type})
                      </option>
                    ))}
                  </Select>
                  {!q.directMapping ? (
                    <p className="mt-1 text-xs text-red-600">Uploads will be skipped until a File column is chosen.</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {schema ? (
        <div>
          <Label>Board schema reference</Label>
          <div className="max-h-56 space-y-2 overflow-auto rounded-md bg-slate-50 p-3 text-xs">
            {schema.columns.map((c) => {
              const labels = parseColumnLabels(c.settings_str);
              return (
                <div key={c.id} className="border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                  <div className="font-medium text-slate-800">
                    {c.title} <span className="text-slate-400">· {c.type}</span>
                  </div>
                  {labels.length ? (
                    <div className="mt-0.5 text-slate-500">Labels: {labels.join(', ')}</div>
                  ) : null}
                  {isMirrorColumn(c.type) ? (
                    <div className="mt-0.5 text-slate-400">Read-only mirror — map to its Connect Boards column instead.</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
