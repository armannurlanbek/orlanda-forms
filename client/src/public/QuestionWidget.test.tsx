// @vitest-environment jsdom
//
// Canonical-submit invariant (multilingual forms): a translated option LABEL
// is shown to the visitor, but the answer VALUE emitted to onChange must
// always stay the BASE option string — never the translated label. This is
// the single most important guarantee of the i18n feature (translations are
// display-only; Monday mapping/validation never sees a translated string).
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { PublicQuestionDTO } from '@orlanda/shared';
import { QuestionWidget } from './widgets/QuestionWidget';

const baseQuestion: PublicQuestionDTO = {
  id: 'q1',
  order: 0,
  type: 'single_select',
  label: 'Choose',
  required: true,
  options: { options: ['Yes', 'No'] },
  translations: { ar: { optionLabels: { Yes: 'نعم', No: 'لا' } } },
};

function renderWidget(question: PublicQuestionDTO, onChange = vi.fn()) {
  render(
    <QuestionWidget
      question={question}
      index={0}
      value={undefined}
      files={{}}
      error={undefined}
      activeLang="ar"
      defaultLang="en"
      onChange={onChange}
      onToggleMulti={vi.fn()}
      onAddFiles={vi.fn()}
      onRemoveFile={vi.fn()}
      onBlurValidate={vi.fn()}
    />,
  );
  return onChange;
}

describe('QuestionWidget — localized option label, canonical option value', () => {
  it('shows the translated option label but submits the base value', () => {
    const onChange = renderWidget(baseQuestion);

    const yesOption = screen.getByText('نعم'); // Arabic label is shown
    expect(yesOption).toBeInTheDocument();
    expect(screen.queryByText('Yes')).not.toBeInTheDocument();

    fireEvent.click(yesOption);

    // The emitted answer is the BASE option string, never the translated label.
    expect(onChange).toHaveBeenCalledWith('q1', 'Yes');
  });

  it('falls back to the base option string when untranslated', () => {
    renderWidget(baseQuestion);
    // 'No' has a translation ('لا') in this fixture, so instead assert the
    // fallback path with a question missing the ar translation for a key.
    const noTranslations: PublicQuestionDTO = {
      ...baseQuestion,
      translations: { ar: { optionLabels: { Yes: 'نعم' } } }, // No: untranslated
    };
    renderWidget(noTranslations);
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('renders the translated question label, falling back to base help text', () => {
    const translated: PublicQuestionDTO = {
      ...baseQuestion,
      helpText: 'Pick one',
      translations: { ar: { label: 'اختر' } }, // helpText untranslated -> falls back
    };
    renderWidget(translated);
    expect(screen.getByText('اختر')).toBeInTheDocument();
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });
});
