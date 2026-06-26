// Direct-mode mapping (§17.3): for each question, pick a board column from the
// live schema. compatLevel drives a hint badge; `block` pairings are disabled in
// the dropdown and flagged invalid. The chosen column is persisted into the
// question's directMapping { columnId, columnType }.
//
// Linked-items feature: board-relation/connect columns (isLinkColumn) are valid
// targets for text/single_select — selecting one links the answer to an item on
// the linked board (and fills any mirror reflecting it). We store the linked
// board id in directMapping.link.boardId. Mirror/lookup columns (isMirrorColumn)
// are READ-ONLY: shown but not selectable, with a hint to map the link column.
import type { MondayBoardSchema, MondayColumn } from '@orlanda/shared';
import { compatLevel, isLinkColumn, isMirrorColumn } from '@orlanda/shared';
import { useBuilderStore } from '../store';
import { parseLinkedBoardId } from '../hooks/useMonday';
import { CompatBadge } from '../components/CompatBadge';
import { Label, Select } from '../components/ui';

export function DirectMapping({ schema }: { schema: MondayBoardSchema | undefined }): JSX.Element {
  const questions = useBuilderStore((s) => s.questions);
  const updateQuestion = useBuilderStore((s) => s.updateQuestion);

  if (!schema) {
    return <p className="text-sm text-slate-500">Select a board to map columns.</p>;
  }

  const colById = new Map(schema.columns.map((c) => [c.id, c]));
  const hasMirrorColumns = schema.columns.some((c) => isMirrorColumn(c.type));

  return (
    <div className="space-y-4">
      {questions.length === 0 ? (
        <p className="text-sm text-slate-500">Add questions to map them to board columns.</p>
      ) : null}
      {questions.map((q, i) => {
        const mapped: MondayColumn | undefined = q.directMapping
          ? colById.get(q.directMapping.columnId)
          : undefined;
        // Live type may differ from the stored type after a schema refresh.
        const liveType = mapped?.type ?? q.directMapping?.columnType ?? '';
        const blockedNow = q.directMapping ? compatLevel(q.type, liveType) === 'block' : false;
        const mappedToLink = !!q.directMapping && isLinkColumn(liveType);
        return (
          <div key={q.key} className="rounded-md border border-slate-200 p-3">
            <Label htmlFor={`map-${q.key}`}>
              #{i + 1} {q.label || '(untitled)'}
            </Label>
            <Select
              id={`map-${q.key}`}
              value={q.directMapping?.columnId ?? ''}
              onChange={(e) => {
                const columnId = e.target.value;
                if (!columnId) {
                  updateQuestion(q.key, { directMapping: null });
                  return;
                }
                const col = colById.get(columnId);
                if (!col) return;
                // Read-only mirror columns are never a write target.
                if (isMirrorColumn(col.type)) return;
                if (isLinkColumn(col.type)) {
                  // Link the answer to an item on the linked board; store the
                  // FIRST board id parsed from settings_str so the resolver knows
                  // which board to search.
                  const boardId = parseLinkedBoardId(col.settings_str);
                  updateQuestion(q.key, {
                    directMapping: {
                      columnId: col.id,
                      columnType: col.type,
                      ...(boardId ? { link: { boardId } } : {}),
                    },
                  });
                  return;
                }
                updateQuestion(q.key, { directMapping: { columnId: col.id, columnType: col.type } });
              }}
            >
              <option value="">— Not mapped —</option>
              {schema.columns.map((c) => {
                // Mirror columns are read-only — surfaced but not selectable.
                if (isMirrorColumn(c.type)) {
                  return (
                    <option key={c.id} value={c.id} disabled>
                      {c.title} ({c.type}) — read-only mirror
                    </option>
                  );
                }
                const level = compatLevel(q.type, c.type);
                return (
                  <option key={c.id} value={c.id} disabled={level === 'block'}>
                    {c.title} ({c.type}){level === 'block' ? ' — incompatible' : ''}
                  </option>
                );
              })}
            </Select>
            {q.directMapping ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CompatBadge questionType={q.type} columnType={liveType} />
                {mapped && mapped.type !== q.directMapping.columnType ? (
                  <span className="text-xs text-amber-700">Column type changed on refresh.</span>
                ) : null}
                {!mapped ? (
                  <span className="text-xs text-red-600">Mapped column no longer exists.</span>
                ) : null}
                {blockedNow ? (
                  <span className="text-xs text-red-600">Fix before publishing.</span>
                ) : null}
              </div>
            ) : null}
            {mappedToLink ? (
              <p className="mt-1.5 text-xs text-slate-500">
                Links by matching the answer to an item name on the linked board; a mirror that reflects this column
                fills automatically.
              </p>
            ) : null}
          </div>
        );
      })}
      {hasMirrorColumns ? (
        <p className="text-xs text-slate-500">
          Read-only mirror — map to its Connect Boards column instead.
        </p>
      ) : null}
    </div>
  );
}
