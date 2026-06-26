// Builder login (/app/login). email/password -> POST /api/auth/login; on
// success refetch the auth context and go to /app. Generic error on failure
// (no user enumeration). If already authed, redirect to /app.
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { AuthUser } from '@orlanda/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, Input, Label, Spinner } from './components/ui';
import { BrandMark } from './components/AppHeader';

export function LoginPage(): JSX.Element {
  const { user, loading, refetch } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once the auth context picks up the new session, leave the login page.
  useEffect(() => {
    if (!loading && user) navigate('/app', { replace: true });
  }, [loading, user, navigate]);

  if (!loading && user) return <Navigate to="/app" replace />;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post<AuthUser>('/api/auth/login', { email: email.trim(), password });
      refetch();
      navigate('/app', { replace: true });
    } catch {
      // Generic message regardless of cause (§16.3 — no account enumeration).
      setError('Invalid email or password.');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-b from-accent-50 to-slate-50 p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6">
          <BrandMark />
          <p className="mt-3 text-sm text-slate-500">Sign in to the builder.</p>
        </div>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div>
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
            {submitting ? <Spinner /> : null}
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
