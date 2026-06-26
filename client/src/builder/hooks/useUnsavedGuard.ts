// Warn-on-navigate-away when the builder has unsaved edits (§17.1).
//
// The app mounts a plain <BrowserRouter> (not a data router), so react-router's
// useBlocker is unavailable. We cover the two real exit paths instead:
//   1. Full page unload (reload / close tab / typed URL / external nav) -> the
//      native `beforeunload` event, which shows the browser's own confirm.
//   2. In-app route changes -> a guarded navigate (`useGuardedNavigate`) that
//      every builder navigation button routes through; it confirms before
//      leaving when dirty. This is the SPA equivalent of a router blocker.
import { useCallback, useEffect } from 'react';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';

export const UNSAVED_MESSAGE = 'You have unsaved changes. Leave this page and discard them?';

/** Installs the native beforeunload guard while `dirty` is true. */
export function useBeforeUnloadGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

/**
 * Returns a navigate() that confirms before leaving when `dirty` is true.
 * Use for all in-app builder navigation so unsaved edits aren't lost.
 */
export function useGuardedNavigate(dirty: boolean): (to: To, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  return useCallback(
    (to: To, options?: NavigateOptions) => {
      if (dirty && !window.confirm(UNSAVED_MESSAGE)) return;
      navigate(to, options);
    },
    [dirty, navigate],
  );
}
