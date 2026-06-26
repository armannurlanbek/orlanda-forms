// A single sortable question in the center canvas. dnd-kit useSortable provides
// the drag handle transform; inline-edit label/help/required + per-type option
// editing. Selecting a card drives the right-hand mapping panel.
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { QuestionType } from '@orlanda/shared';
import type { DraftQuestion } from '../store';
import { useBuilderStore } from '../store';
import { Badge, Button, IconButton, Input, Label, Textarea } from './ui';
import { GripIcon, TrashIcon, XIcon } from './icons';

const TYPE_LABEL: Record<QuestionType, string> = {
  text: 'Text',
  long_text: 'Long text',
  number: 'Number',
  single_select: 'Single select',
  multi_select: 'Multi select',
  attachment: 'Attachment',
};

function OptionsEditor({ q }: { q: DraftQuestion }): JSX.Element {
  const updateQuestion = useBuilderStore((s) => s.updateQuestion);
  const opts = q.options.options ?? [];

  function setOpts(next: string[]): void {
    updateQuestion(q.key, { options: { ...q.options, options: next } });
  }

  return (
    <div className="mt-3 rounded-md bg-slate-50 p-3">
      <Label>Options</Label>
      <div className="space-y-2">
        {opts.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={opt}
              aria-label={`Option ${i + 1}`}
              onChange={(e) => {
                const next = [...opts];
                next[i] = e.target.value;
                setOpts(next);
              }}
            />
            <IconButton
              tone="danger"
              aria-label={`Remove option ${i + 1}`}
              onClick={() => setOpts(opts.filter((_, idx) => idx !== i))}
            >
              <XIcon size={16} />
            </IconButton>
          </div>
        ))}
      </div>
      <Button size="sm" className="mt-2" onClick={() => setOpts([...opts, `Option ${opts.length + 1}`])}>
        Add option
      </Button>
      {q.type === 'multi_select' ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={`${q.key}-min`}>Min selections</Label>
            <Input
              id={`${q.key}-min`}
              type="number"
              inputMode="numeric"
              value={q.options.minSelections ?? ''}
              onChange={(e) =>
                updateQuestion(q.key, {
                  options: { ...q.options, minSelections: e.target.value === '' ? undefined : Number(e.target.value) },
                })
              }
            />
          </div>
          <div>
            <Label htmlFor={`${q.key}-max`}>Max selections</Label>
            <Input
              id={`${q.key}-max`}
              type="number"
              inputMode="numeric"
              value={q.options.maxSelections ?? ''}
              onChange={(e) =>
                updateQuestion(q.key, {
                  options: { ...q.options, maxSelections: e.target.value === '' ? undefined : Number(e.target.value) },
                })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NumberConfig({ q }: { q: DraftQuestion }): JSX.Element {
  const updateQuestion = useBuilderStore((s) => s.updateQuestion);
  const num = (v: string): number | undefined => (v === '' ? undefined : Number(v));
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-3">
      <div>
        <Label htmlFor={`${q.key}-numin`}>Min</Label>
        <Input
          id={`${q.key}-numin`}
          type="number"
          inputMode="decimal"
          value={q.options.min ?? ''}
          onChange={(e) => updateQuestion(q.key, { options: { ...q.options, min: num(e.target.value) } })}
        />
      </div>
      <div>
        <Label htmlFor={`${q.key}-numax`}>Max</Label>
        <Input
          id={`${q.key}-numax`}
          type="number"
          inputMode="decimal"
          value={q.options.max ?? ''}
          onChange={(e) => updateQuestion(q.key, { options: { ...q.options, max: num(e.target.value) } })}
        />
      </div>
      <div>
        <Label htmlFor={`${q.key}-step`}>Step</Label>
        <Input
          id={`${q.key}-step`}
          type="number"
          inputMode="decimal"
          value={q.options.step ?? ''}
          onChange={(e) => updateQuestion(q.key, { options: { ...q.options, step: num(e.target.value) } })}
        />
      </div>
    </div>
  );
}

export function QuestionCard({ q, index }: { q: DraftQuestion; index: number }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.key });
  const updateQuestion = useBuilderStore((s) => s.updateQuestion);
  const removeQuestion = useBuilderStore((s) => s.removeQuestion);
  const select = useBuilderStore((s) => s.select);
  const selectedKey = useBuilderStore((s) => s.selectedKey);
  const isSelected = selectedKey === q.key;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const hasOptions = q.type === 'single_select' || q.type === 'multi_select';

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => select(q.key)}
      onFocusCapture={() => select(q.key)}
      className={`rounded-lg border bg-white p-4 shadow-card transition-colors ${
        isSelected ? 'border-accent ring-1 ring-accent' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="mt-1 cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripIcon size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">#{index + 1}</span>
              <Badge tone="slate">{TYPE_LABEL[q.type]}</Badge>
              {q.required ? <Badge tone="amber">Required</Badge> : null}
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Delete question"
              onClick={(e) => {
                e.stopPropagation();
                removeQuestion(q.key);
              }}
            >
              <TrashIcon size={16} />
              Delete
            </Button>
          </div>

          <Label htmlFor={`${q.key}-label`}>Label</Label>
          <Input
            id={`${q.key}-label`}
            value={q.label}
            onChange={(e) => updateQuestion(q.key, { label: e.target.value })}
          />

          <div className="mt-2">
            <Label htmlFor={`${q.key}-help`}>Help text</Label>
            <Textarea
              id={`${q.key}-help`}
              rows={2}
              value={q.helpText}
              onChange={(e) => updateQuestion(q.key, { helpText: e.target.value })}
            />
          </div>

          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-accent"
              checked={q.required}
              onChange={(e) => updateQuestion(q.key, { required: e.target.checked })}
            />
            Required
          </label>

          {hasOptions ? <OptionsEditor q={q} /> : null}
          {q.type === 'number' ? <NumberConfig q={q} /> : null}
        </div>
      </div>
    </div>
  );
}
