import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Acceptable Use Policy — ${LEGAL_META.productName}`,
};

export default function AcceptableUsePage() {
  return (
    <LegalDoc title="Acceptable Use Policy" active="/legal/acceptable-use">
      <LegalNote />
      <LegalSection title="1. Purpose">
        <p>
          This Acceptable Use Policy (“AUP”) applies to all use of {LEGAL_META.productName}. Violations
          may result in suspension or termination under our{' '}
          <Link className="underline" href="/legal/terms">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="2. Prohibited activities">
        <ul className="list-disc space-y-2 pl-5">
          <li>Illegal content or activity, including fraud, malware, or exploitation of minors.</li>
          <li>Harassment, hate, threats, or content that platforms prohibit.</li>
          <li>Infringement of copyright, trademark, or other IP rights.</li>
          <li>Spam, deceptive engagement schemes, or coordinated inauthentic behavior.</li>
          <li>Attempting to bypass rate limits, security controls, or another customer’s workspace.</li>
          <li>Scraping or misuse of platform APIs beyond authorized scopes and policies.</li>
          <li>Uploading content you do not have rights to publish.</li>
          <li>Using the Service to violate YouTube, Meta, TikTok, or other platform terms.</li>
        </ul>
      </LegalSection>
      <LegalSection title="3. Platform rules">
        <p>
          You must follow each destination platform’s community and developer rules when connecting
          accounts or publishing. See{' '}
          <Link className="underline" href="/legal/platforms">
            Platform disclosures
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="4. Reporting">
        <p>
          Report abuse to {LEGAL_META.supportEmail} or {LEGAL_META.privacyEmail}. Include URLs,
          account identifiers, and a description of the issue.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
