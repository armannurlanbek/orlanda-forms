// Translate the persisted Form + Questions into the inputs buildMapping() needs.
// Used by BOTH the preview endpoint and the worker so they interpret stored
// directMapping / aiAllowedColumns identically.

import type { Form, Question } from '@prisma/client';
import type { AllowlistColumn, MappingMode, QuestionConfig, QuestionDef } from '@orlanda/shared';
import type { DirectMapping } from '../monday/direct';

export interface MappingInputs {
  mappingMode: MappingMode;
  formTitle: string;
  boardId: string | null;
  questions: QuestionDef[];
  directMappingByQuestionId: Record<string, DirectMapping>;
  ai?: { aiPrompt: string; allowlist: AllowlistColumn[] };
}

function toQuestionDef(q: Question): QuestionDef {
  return {
    id: q.id,
    order: q.order,
    type: q.type,
    label: q.label,
    helpText: q.helpText,
    required: q.required,
    options: (q.options as QuestionConfig | null) ?? null,
  };
}

function toDirectMapping(value: unknown): DirectMapping | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.columnId !== 'string' || typeof v.columnType !== 'string') return null;
  let link: DirectMapping['link'];
  if (v.link && typeof v.link === 'object') {
    const l = v.link as Record<string, unknown>;
    link = {
      boardId: typeof l.boardId === 'string' ? l.boardId : undefined,
      threshold: typeof l.threshold === 'number' ? l.threshold : undefined,
    };
  }
  return {
    columnId: v.columnId,
    columnType: v.columnType,
    countryShortName: typeof v.countryShortName === 'string' ? v.countryShortName : undefined,
    link,
  };
}

export function loadMappingInputs(form: Form, questions: Question[]): MappingInputs {
  const directMappingByQuestionId: Record<string, DirectMapping> = {};
  for (const q of questions) {
    const m = toDirectMapping(q.directMapping);
    if (m) directMappingByQuestionId[q.id] = m;
  }

  const inputs: MappingInputs = {
    mappingMode: form.mappingMode,
    formTitle: form.title,
    boardId: form.boardId,
    questions: questions.map(toQuestionDef).sort((a, b) => a.order - b.order),
    directMappingByQuestionId,
  };

  if (form.mappingMode === 'ai') {
    const allowlist = Array.isArray(form.aiAllowedColumns)
      ? (form.aiAllowedColumns as unknown as AllowlistColumn[])
      : [];
    inputs.ai = { aiPrompt: form.aiPrompt ?? '', allowlist };
  }

  return inputs;
}
