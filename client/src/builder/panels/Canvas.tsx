// Center canvas — dnd-kit sortable list of questions. Reordering updates the
// Zustand store immediately (optimistic, local-only until Save) (§17.2).
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useBuilderStore } from '../store';
import { QuestionCard } from '../components/QuestionCard';

export function Canvas(): JSX.Element {
  const questions = useBuilderStore((s) => s.questions);
  const reorder = useBuilderStore((s) => s.reorder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorder(String(active.id), String(over.id));
    }
  }

  return (
    <div className="space-y-3">
      {questions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No questions yet. Add one from the palette on the left.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={questions.map((q) => q.key)} strategy={verticalListSortingStrategy}>
            {questions.map((q, i) => (
              <QuestionCard key={q.key} q={q} index={i} />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
