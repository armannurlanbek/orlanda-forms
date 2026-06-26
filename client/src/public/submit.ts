// Public submit transport (§13.1). Builds the multipart/form-data body and
// POSTs it via the frozen api.postForm helper.
//
// FormData shape:
//   answers          (text)  JSON of the canonical answers object (§15.1).
//                            Attachment entries are { type:'attachment', attachmentIds: [] };
//                            the server fills attachmentIds from the file parts.
//   idempotencyKey   (text)  a crypto.randomUUID() generated once per attempt;
//                            reused on double-tap / retry so no duplicate item.
//   file__<questionId> (file, repeated)  one part per selected file; the field
//                            name is repeated for multi-file attachment questions.
import { api } from '../lib/api';
import type { AnswerEntry, PublicSubmitResponse } from '@orlanda/shared';
import type { SelectedFile } from './files';

export type CanonicalAnswers = Record<string, AnswerEntry>;

export interface SubmitArgs {
  slug: string;
  answers: CanonicalAnswers;
  /** attachment files keyed by questionId, in display order */
  filesByQuestion: Record<string, SelectedFile[]>;
  idempotencyKey: string;
}

export function buildSubmitFormData(args: Omit<SubmitArgs, 'slug'>): FormData {
  const { answers, filesByQuestion, idempotencyKey } = args;
  const form = new FormData();
  form.append('answers', JSON.stringify(answers));
  form.append('idempotencyKey', idempotencyKey);
  for (const [questionId, files] of Object.entries(filesByQuestion)) {
    for (const sf of files) {
      // Repeat the same field name for each file on a multi-file question.
      form.append(`file__${questionId}`, sf.file, sf.file.name);
    }
  }
  return form;
}

export async function submitPublicForm(args: SubmitArgs): Promise<PublicSubmitResponse> {
  const { slug, ...rest } = args;
  const form = buildSubmitFormData(rest);
  return api.postForm<PublicSubmitResponse>(
    `/api/public/forms/${encodeURIComponent(slug)}/submit`,
    form,
  );
}
