// Direct-mode type-compatibility hint (§17.3). Uses compatLevel() from shared so
// the builder hint agrees with the server formatter. ok=green, warn=amber,
// block=red (selection disallowed by the caller).
import type { QuestionType } from '@orlanda/shared';
import { compatLevel } from '@orlanda/shared';
import { Badge } from './ui';

export function CompatBadge({
  questionType,
  columnType,
}: {
  questionType: QuestionType;
  columnType: string;
}): JSX.Element {
  const level = compatLevel(questionType, columnType);
  if (level === 'ok') return <Badge tone="green">Compatible</Badge>;
  if (level === 'warn') return <Badge tone="amber">Values may not map cleanly</Badge>;
  return <Badge tone="red">Incompatible</Badge>;
}
