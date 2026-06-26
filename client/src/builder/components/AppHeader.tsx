// Top bar for authed builder pages: brand, current user, logout. Logout calls
// POST /api/auth/logout, refetches auth (clears `me`), then routes to login.
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button } from './ui';

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
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-base font-bold text-slate-900">Orlanda Forms</span>
        {children}
      </div>
      <div className="flex items-center gap-3">
        {user ? <span className="hidden text-sm text-slate-500 sm:inline">{user.email}</span> : null}
        <Button size="sm" onClick={logout}>
          Log out
        </Button>
      </div>
    </header>
  );
}
