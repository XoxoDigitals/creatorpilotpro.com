import Link from 'next/link';

/**
 * Login placeholder (Phase 0). Real credentials auth (Auth.js + DB sessions)
 * lands in task #4 — this form does not submit anywhere yet.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <h1 className="text-xl font-semibold text-slate-100">SocialCreatorPilot</h1>
        <p className="mt-1 text-sm text-slate-400">Sign in to your workspace</p>

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              disabled
              placeholder="you@example.com"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              disabled
              placeholder="••••••••"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
            />
          </div>
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-md bg-indigo-600/50 px-3 py-2 text-sm font-medium text-white"
          >
            Sign in (coming in task #4)
          </button>
          <p className="text-center text-xs text-slate-500">
            Auth is not wired yet —{' '}
            <Link href="/dashboard" className="text-indigo-400 hover:underline">
              preview the dashboard shell
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
