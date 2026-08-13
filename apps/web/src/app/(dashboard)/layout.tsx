import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { ToastProvider } from '@/components/ui/toast';
import { getCurrentUser } from '@/lib/server-api';

/** Authenticated dashboard shell. Middleware gates access; this resolves the
 *  session user for the sidebar (redirects if the cookie is stale). */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-zinc-50">
        <Sidebar user={user} />
        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
