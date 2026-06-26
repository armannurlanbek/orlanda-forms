// Top bar for authed builder pages: brand, current user, logout. Logout calls
// POST /api/auth/logout, refetches auth (clears `me`), then routes to login.
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button } from './ui';
import { LogoutIcon } from './icons';

/** Compact Orlanda Forms brand lockup: accent tile + wordmark. */
export function BrandMark(): JSX.Element {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[13px] font-bold text-white shadow-sm"
      >
        OF
      </span>
      <span className="text-base font-bold tracking-tight text-slate-900">Orlanda Forms</span>
    </span>
  );
}

export function AppHeader({ children }: { children?: React.ReactNode }): JSX.Element {
  const { user, refetch } = useAuth();
  const navigate = useNavigate();

  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Even if the call fails, drop local session state and return to login.
    }
    refetch();
    navigate('/app/login', { replace: true });
  }

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/app" className="shrink-0 rounded-md" aria-label="Go to dashboard">
          <BrandMark />
        </Link>
        {children}
      </div>
      <div className="flex items-center gap-3">
        {user ? <span className="hidden text-sm text-slate-500 sm:inline">{user.email}</span> : null}
        <Button size="sm" onClick={logout}>
          <LogoutIcon size={16} />
          Log out
        </Button>
      </div>
    </header>
  );
}
