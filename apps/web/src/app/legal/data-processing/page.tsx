import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Data Processing & Subprocessors — ${LEGAL_META.productName}`,
};

export default function DataProcessingPage() {
  return (
    <LegalDoc title="Data Processing & Subprocessors" active="/legal/data-processing">
      <LegalNote />
      <LegalSection title="1. Roles">
        <p>
          For personal data you upload or connect through {LEGAL_META.productName}, {LEGAL_META.companyName}{' '}
          typically acts as a <strong>processor</strong> (or service provider) on behalf of your
          organization (the controller), except where we determine purposes independently (e.g.,
          account administration, security, billing), in which case we act as a controller. A formal
          Data Processing Addendum (DPA) can be executed on request — contact {LEGAL_META.privacyEmail}.
        </p>
      </LegalSection>
      <LegalSection title="2. Processing summary">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Subject matter:</strong> social content operations, scheduling, publishing, AI
            ideation/packaging, and related account administration.
          </li>
          <li>
            <strong>Duration:</strong> for the term of your use plus limited backup/legal retention.
          </li>
          <li>
            <strong>Nature:</strong> storage, transmission, display, automated processing (including AI
            providers you configure), and deletion on request where feasible.
          </li>
          <li>
            <strong>Types of data:</strong> account identifiers, OAuth tokens, content metadata, media
            references, logs — see the{' '}
            <Link className="underline" href="/legal/privacy">
              Privacy Policy
            </Link>
            .
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="3. Subprocessors (template)">
        <p>Replace with your actual vendors before production:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>[Cloud host / VPS provider]</strong> — application &amp; database hosting.
          </li>
          <li>
            <strong>[Object storage provider]</strong> — media asset storage (if used).
          </li>
          <li>
            <strong>[Email / SMTP provider]</strong> — transactional email (if used).
          </li>
          <li>
            <strong>[AI API provider(s)]</strong> — generation features you enable (keys may be
            customer-provided).
          </li>
          <li>
            <strong>YouTube / Google, Meta, TikTok</strong> — destination platforms when you authorize
            connections (they process data under their own terms).
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="4. Security measures">
        <p>
          High-level controls are described in our{' '}
          <Link className="underline" href="/legal/security">
            Security Overview
          </Link>
          . Tokens and secrets are encrypted at rest where the product design provides for it.
        </p>
      </LegalSection>
      <LegalSection title="5. Contact">
        <p>
          DPA / subprocessors: {LEGAL_META.privacyEmail}
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
