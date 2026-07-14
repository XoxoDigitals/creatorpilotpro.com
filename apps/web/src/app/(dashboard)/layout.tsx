import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { RoleBadge } from '@/components/role-badge';
import { getCurrentUser } from '@/lib/server-api';

/** Authenticated dashboard shell. Middleware gates access; this resolves the
 *  session user for the sidebar/header (redirects if the cookie is stale). */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950/60 px-6">
          <span className="text-sm text-slate-400">Dashboard</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-300">{user.name ?? user.email}</span>
            <RoleBadge role={user.role} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
