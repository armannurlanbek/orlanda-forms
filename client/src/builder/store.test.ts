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
