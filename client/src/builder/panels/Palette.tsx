// Left palette — add a question of each supported type to the canvas.
import type { QuestionType } from '@orlanda/shared';
import { useBuilderStore } from '../store';
import { PlusIcon } from '../components/icons';

const ITEMS: { type: QuestionType; label: string; hint: string }[] = [
  { type: 'text', label: 'Text', hint: 'Single line' },
  { type: 'long_text', label: 'Long Text', hint: 'Paragraph' },
  { type: 'number', label: 'Number', hint: 'Numeric input' },
  { type: 'single_select', label: 'Single Select', hint: 'Pick one' },
  { type: 'multi_select', label: 'Multi Select', hint: 'Pick many' },
  { type: 'attachment', label: 'Attachment', hint: 'File upload' },
];

export function Palette(): JSX.Element {
  const addQuestion = useBuilderStore((s) => s.addQuestion);
  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Add question</h2>
      <div className="space-y-2">
        {ITEMS.map((it) => (
          <button
            key={it.type}
            type="button"
            onClick={() => addQuestion(it.type)}
            className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-accent-200 hover:bg-accent-50"
          >
            <span className="min-w-0">
              <span className="block font-medium text-slate-800">{it.label}</span>
              <span className="block text-xs text-slate-400">{it.hint}</span>
            </span>
            <PlusIcon
              size={16}
              className="shrink-0 text-slate-300 transition-colors group-hover:text-accent"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
