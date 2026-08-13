import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Security Overview — ${LEGAL_META.productName}`,
};

export default function SecurityPage() {
  return (
    <LegalDoc title="Security Overview" active="/legal/security">
      <LegalNote />
      <LegalSection title="1. Approach">
        <p>
          {LEGAL_META.productName} is designed as a self-hosted / privately operated social publishing
          workspace. Security controls depend on both the application and your deployment environment.
          This page is a high-level overview, not a certification.
        </p>
      </LegalSection>
      <LegalSection title="2. Application controls (typical)">
        <ul className="list-disc space-y-2 pl-5">
          <li>Authenticated sessions with HTTP-only cookies where configured.</li>
          <li>Role-based access within workspaces.</li>
          <li>Encryption of sensitive secrets (e.g., OAuth tokens, API keys) at rest when enabled by
            deployment configuration.</li>
          <li>Server-side validation of API requests; operational logging for incident response.</li>
        </ul>
      </LegalSection>
      <LegalSection title="3. Operator responsibilities">
        <ul className="list-disc space-y-2 pl-5">
          <li>Keep OS, containers, and dependencies patched.</li>
          <li>Protect DATABASE_URL, MASTER_KEY, SESSION_SECRET, and platform app secrets.</li>
          <li>Use TLS on public endpoints and restrict admin access.</li>
          <li>Configure backups and retention consistent with your{' '}
            <Link className="underline" href="/legal/privacy">
              Privacy Policy
            </Link>
            .
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="4. Reporting vulnerabilities">
        <p>
          Email security findings to {LEGAL_META.privacyEmail} (or a dedicated security@ address you
          configure). Please allow reasonable time for assessment before public disclosure.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
