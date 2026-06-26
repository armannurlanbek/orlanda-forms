// Left palette — add a question of each supported type to the canvas.
import type { QuestionType } from '@orlanda/shared';
import { useBuilderStore } from '../store';

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
            className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-slate-400 hover:bg-slate-50"
          >
            <span className="font-medium text-slate-800">{it.label}</span>
            <span className="text-xs text-slate-400">{it.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
