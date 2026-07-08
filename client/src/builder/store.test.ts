// Store tests for the slug guard in toSaveInput (Findings #2 & #7). DOM-free —
// drives the zustand store directly via its own actions.
import { beforeEach, describe, expect, it } from 'vitest';
import { useBuilderStore } from './store';

describe('toSaveInput slug guard', () => {
  beforeEach(() => {
    useBuilderStore.getState().reset();
  });

  it('drops an invalid slug so it can never 400 the whole save (Finding #2)', () => {
    // "ab" is too short (< SLUG_MIN_LENGTH), so slugError() is non-null.
    useBuilderStore.getState().setField('slug', 'ab');
    expect(useBuilderStore.getState().toSaveInput().slug).toBeUndefined();
  });

  it('sends a valid slug unchanged', () => {
    useBuilderStore.getState().setField('slug', 'my-form');
    expect(useBuilderStore.getState().toSaveInput().slug).toBe('my-form');
  });

  it('coerces an empty slug to undefined so the server keeps the current one (Finding #7)', () => {
    useBuilderStore.getState().setField('slug', '');
    expect(useBuilderStore.getState().toSaveInput().slug).toBeUndefined();
  });
});

describe('multilingual forms: languages + translations', () => {
  beforeEach(() => {
    useBuilderStore.getState().reset();
  });

  it('round-trips languages + translations through toSaveInput', () => {
    const s = useBuilderStore.getState();
    s.reset();
    s.addLanguage('ar'); // en default + ar
    s.setTranslatedFormField('ar', 'title', 'عنوان');
    const out = useBuilderStore.getState().toSaveInput();
    expect(out.languages).toContain('ar');
    expect(out.defaultLang).toBe('en');
    expect(out.translations?.ar?.title).toBe('عنوان');
  });

  it('removeLanguage drops its translations', () => {
    const s = useBuilderStore.getState();
    s.reset();
    s.addLanguage('ar');
    s.setTranslatedFormField('ar', 'title', 'x');
    s.removeLanguage('ar');
    const out = useBuilderStore.getState().toSaveInput();
    expect(out.languages).not.toContain('ar');
    expect(out.translations?.ar).toBeUndefined();
  });
});
