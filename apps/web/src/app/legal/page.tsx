import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalFooter, LegalHeader, LegalNote } from '@/components/legal/legal-shell';
import { LEGAL_META, LEGAL_NAV } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Legal — ${LEGAL_META.productName}`,
  description: 'Privacy, terms, platform disclosures, and data deletion policies.',
};

export default function LegalIndexPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <LegalHeader active="/legal" />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-6 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Legal &amp; policies</h1>
        <p className="mt-3 text-sm text-zinc-500">
          Policies for {LEGAL_META.productName}, operated by {LEGAL_META.companyName}. Effective{' '}
          {LEGAL_META.effectiveDate}.
        </p>
        <div className="mt-6">
          <LegalNote />
        </div>
        <ul className="mt-10 divide-y divide-zinc-200 border-y border-zinc-200">
          {LEGAL_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex items-center justify-between gap-4 py-3.5 text-sm font-medium text-zinc-900 hover:text-zinc-600"
              >
                <span>{item.label}</span>
                <span className="text-zinc-400" aria-hidden>
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <LegalFooter />
    </div>
  );
}
