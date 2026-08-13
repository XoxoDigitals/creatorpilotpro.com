import Link from 'next/link';
import { LEGAL_META, LEGAL_NAV, type LegalHref } from '@/lib/legal-meta';

export function LegalHeader({ active }: { active?: LegalHref }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight text-zinc-900 hover:text-zinc-700">
          {LEGAL_META.productName}
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-zinc-500">
          <Link href="/legal" className={active === '/legal' ? 'text-zinc-900' : 'hover:text-zinc-800'}>
            Legal
          </Link>
          <Link href="/login" className="hover:text-zinc-800">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function LegalFooter() {
  return (
    <footer className="mt-16 border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
        <p className="text-xs font-medium text-zinc-700">{LEGAL_META.productName} — Legal</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {LEGAL_NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="text-xs text-zinc-500 hover:text-zinc-800">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-zinc-400">
          © {new Date().getFullYear()} {LEGAL_META.companyName}. Template policies — customize before production.
        </p>
      </div>
    </footer>
  );
}

export function LegalDoc({
  title,
  children,
  active,
}: {
  title: string;
  children: React.ReactNode;
  active?: LegalHref;
}) {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <LegalHeader active={active} />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-6 sm:py-14">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          Effective {LEGAL_META.effectiveDate}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-zinc-500">
          Operated by {LEGAL_META.companyName}. Contact:{' '}
          <a className="underline decoration-zinc-300 hover:decoration-zinc-500" href={`mailto:${LEGAL_META.privacyEmail}`}>
            {LEGAL_META.privacyEmail}
          </a>
        </p>
        <div className="legal-prose mt-10 space-y-6 text-[15px] leading-relaxed text-zinc-700">{children}</div>
      </main>
      <LegalFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{title}</h2>
      {children}
    </section>
  );
}

export function LegalNote() {
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      This page is a compliance template. Replace placeholders (company name, address, emails, effective
      date) in <code className="rounded bg-amber-100 px-1">apps/web/src/lib/legal-meta.ts</code> or via{' '}
      <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_LEGAL_*</code> env vars, then have counsel
      review before relying on it.
    </p>
  );
}
