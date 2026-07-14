import { Sidebar } from '@/components/sidebar';

/**
 * Authenticated dashboard shell (Phase 0).
 * TODO(task#4): wrap with a session check + redirect to /login when unauthenticated.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950/60 px-6">
          <span className="text-sm text-slate-400">Phase 0 shell</span>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
            saboor@xoxodigitals.com
          </span>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
