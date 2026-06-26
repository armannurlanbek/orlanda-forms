// Client-side mirror of the publish preconditions (§15.3.4) so the builder can
// guide the user before hitting the server. The server remains authoritative;
// we surface its ApiError.fields/message on failure too.
import { compatLevel } from '@orlanda/shared';
import { useBuilderStore } from '../store';

export interface PublishReadiness {
  ready: boolean;
  issues: string[];
}

export function usePublishReadiness(): PublishReadiness {
  const form = useBuilderStore((s) => s.form);
  const questions = useBuilderStore((s) => s.questions);

  const issues: string[] = [];

  if (!form.boardId) issues.push('Select a target Monday board.');
  if (questions.length === 0) issues.push('Add at least one question.');

  // Files upload to a File column in BOTH modes — the AI never maps files (§12.2).
  for (const q of questions) {
    if (q.type === 'attachment' && q.directMapping?.columnType !== 'file') {
      issues.push(`Map file uploads in "${q.label || 'untitled'}" to a File column.`);
    }
  }

  if (form.mappingMode === 'direct') {
    for (const q of questions) {
      // Attachments are covered by the File-column rule above.
      if (q.required && q.type !== 'attachment') {
        if (!q.directMapping) {
          issues.push(`Map required question "${q.label || 'untitled'}" to a column.`);
        } else if (compatLevel(q.type, q.directMapping.columnType) === 'block') {
          issues.push(`Required question "${q.label || 'untitled'}" maps to an incompatible column.`);
        }
      }
    }
  } else if (form.mappingMode === 'ai') {
    if (!form.aiPrompt.trim()) issues.push('Add AI mapping instructions.');
  }

  return { ready: issues.length === 0, issues };
}
