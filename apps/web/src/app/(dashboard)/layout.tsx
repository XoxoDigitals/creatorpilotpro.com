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
      <div className="flex min-h-screen bg-zinc-50">
        <Sidebar user={user} />
        <main className="min-w-0 flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
