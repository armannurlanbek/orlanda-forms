// Builder auth context. Wraps GET /api/auth/me; RequireAuth guards builder routes.
import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import type { AuthUser } from '@orlanda/shared';
import { ApiError, api } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, refetch: () => {} });

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<AuthUser | null> => {
      try {
        return await api.get<AuthUser>('/api/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const value: AuthState = {
    user: data ?? null,
    loading: isLoading,
    refetch: () => qc.invalidateQueries({ queryKey: ['me'] }),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="flex h-full items-center justify-center text-slate-500">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/app/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
