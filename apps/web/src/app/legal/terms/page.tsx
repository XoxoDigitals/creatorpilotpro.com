import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Terms of Service — ${LEGAL_META.productName}`,
};

export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Service" active="/legal/terms">
      <LegalNote />
      <LegalSection title="1. Agreement">
        <p>
          By accessing {LEGAL_META.productName} (“Service”) operated by {LEGAL_META.companyName}, you
          agree to these Terms. If you use the Service on behalf of an organization, you represent that
          you have authority to bind that organization.
        </p>
      </LegalSection>
      <LegalSection title="2. Accounts">
        <p>
          You must provide accurate account information, keep credentials confidential, and promptly
          revoke access for users who leave your organization. Workspace owners are responsible for
          activity under their accounts.
        </p>
      </LegalSection>
      <LegalSection title="3. Acceptable use">
        <p>
          You must comply with our{' '}
          <Link className="underline" href="/legal/acceptable-use">
            Acceptable Use Policy
          </Link>{' '}
          and{' '}
          <Link className="underline" href="/legal/community-guidelines">
            Community Guidelines
          </Link>
          , as well as applicable law and each destination platform’s terms (YouTube, Meta, TikTok, etc.).
        </p>
      </LegalSection>
      <LegalSection title="4. Content ownership">
        <p>
          You retain ownership of content you upload or generate for your workspace. You grant us a
          limited license to host, process, transmit, and display that content solely to operate the
          Service (including AI features you enable and publishing to platforms you connect). Platform
          terms may also apply to content you publish through those APIs.
        </p>
      </LegalSection>
      <LegalSection title="5. Platform API compliance">
        <p>
          Features that connect to third-party platforms rely on your authorization and your compliance
          with those platforms’ developer policies. We may suspend integrations that violate platform
          rules or place the Service at risk. See{' '}
          <Link className="underline" href="/legal/platforms">
            Platform disclosures
          </Link>{' '}
          and{' '}
          <Link className="underline" href="/legal/youtube-api">
            YouTube API Limited Use
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="6. AI features">
        <p>
          AI outputs may be inaccurate or incomplete. You are responsible for reviewing content before
          publishing and for ensuring it does not infringe others’ rights.
        </p>
      </LegalSection>
      <LegalSection title="7. Availability &amp; changes">
        <p>
          We strive for reliable operation but do not guarantee uninterrupted availability. We may
          modify or discontinue features with reasonable notice when practicable.
        </p>
      </LegalSection>
      <LegalSection title="8. Disclaimers">
        <p>
          THE SERVICE IS PROVIDED “AS IS” WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE MAXIMUM EXTENT
          PERMITTED BY LAW.
        </p>
      </LegalSection>
      <LegalSection title="9. Limitation of liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, {LEGAL_META.companyName.toUpperCase()} WILL NOT BE
          LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF
          PROFITS, REVENUE, DATA, OR GOODWILL. OUR AGGREGATE LIABILITY ARISING OUT OF THE SERVICE WILL
          NOT EXCEED THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE TWELVE (12) MONTHS BEFORE THE CLAIM
          (OR USD $100 IF YOU HAVE NOT PAID FEES).
        </p>
      </LegalSection>
      <LegalSection title="10. Indemnity">
        <p>
          You will defend and indemnify us against claims arising from your content, your use of
          connected platforms, or your violation of these Terms or law.
        </p>
      </LegalSection>
      <LegalSection title="11. Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate access for violations
          of these Terms or risk to the Service or platforms. Data deletion options are described in{' '}
          <Link className="underline" href="/legal/data-deletion">
            Data Deletion
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="12. Governing law">
        <p>
          These Terms are governed by the laws of [Governing Jurisdiction], excluding conflict-of-law
          rules. Courts in [Venue] will have exclusive jurisdiction, unless mandatory consumer law
          provides otherwise.
        </p>
      </LegalSection>
      <LegalSection title="13. Contact">
        <p>
          Legal: {LEGAL_META.privacyEmail} · {LEGAL_META.address}
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
