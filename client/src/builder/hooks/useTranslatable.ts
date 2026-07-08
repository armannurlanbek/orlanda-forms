// Language-aware read/write for builder text fields (§ multilingual forms).
// When `editingLang === form.defaultLang`, a binding reads/writes the base
// column exactly as before Phase D; otherwise it reads/writes that language's
// translation, exposing the base text as `placeholder` for reference so the
// author always sees what they are translating. Question STRUCTURE (type,
// option list/count, mapping) is only ever edited in the default language —
// these hooks cover text only (form chrome + question label/help).
import type { FormTextTranslation } from '@orlanda/shared';
import type { DraftQuestion } from '../store';
import { useBuilderStore } from '../store';

export type TranslatableFormField = keyof FormTextTranslation;
export type TranslatableQuestionField = 'label' | 'helpText';

export interface FieldBinding {
  value: string;
  onChange: (value: string) => void;
  /** The base-language text, shown as a placeholder while editing a translation. */
  placeholder: string | undefined;
  isDefault: boolean;
}

/** Binding for a form-level translatable field (title, welcomeText, etc.). */
export function useTranslatableFormField(field: TranslatableFormField): FieldBinding {
  const form = useBuilderStore((s) => s.form);
  const editingLang = useBuilderStore((s) => s.editingLang);
  const setField = useBuilderStore((s) => s.setField);
  const setTranslatedFormField = useBuilderStore((s) => s.setTranslatedFormField);

  const isDefault = editingLang === form.defaultLang;
  const base = form[field];

  return {
    value: isDefault ? base : (form.translations[editingLang]?.[field] ?? ''),
    onChange: (v) => {
      if (isDefault) setField(field, v);
      else setTranslatedFormField(editingLang, field, v);
    },
    placeholder: isDefault ? undefined : base,
    isDefault,
  };
}

/** Binding for a question's translatable text field (label, helpText). */
export function useTranslatableQuestionField(q: DraftQuestion, field: TranslatableQuestionField): FieldBinding {
  const form = useBuilderStore((s) => s.form);
  const editingLang = useBuilderStore((s) => s.editingLang);
  const updateQuestion = useBuilderStore((s) => s.updateQuestion);
  const setTranslatedQuestionField = useBuilderStore((s) => s.setTranslatedQuestionField);

  const isDefault = editingLang === form.defaultLang;
  const base = q[field];

  return {
    value: isDefault ? base : (q.translations[editingLang]?.[field] ?? ''),
    onChange: (v) => {
      if (isDefault) {
        if (field === 'label') updateQuestion(q.key, { label: v });
        else updateQuestion(q.key, { helpText: v });
      } else {
        setTranslatedQuestionField(q.key, editingLang, field, v);
      }
    },
    placeholder: isDefault ? undefined : base,
    isDefault,
  };
}
