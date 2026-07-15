'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { SessionUser } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post<{ user: SessionUser }>('/auth/login', { email, password });
      // Full navigation so middleware sees the freshly-set cookie.
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white">
            S
          </span>
          <span className="text-lg font-semibold tracking-tight text-zinc-900">
            SocialCreatorPilot
          </span>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm"
        >
          <h1 className="text-base font-semibold text-zinc-900">Sign in</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Welcome back — enter your workspace.</p>

          <div className="mt-6 space-y-4">
            <Field label="Email">
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password">
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>

        <p className="mt-4 text-center text-xs text-zinc-400">
          Access is managed by your workspace owner.
        </p>
      </div>
    </main>
  );
}
