import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Data Deletion & User Requests — ${LEGAL_META.productName}`,
};

export default function DataDeletionPage() {
  return (
    <LegalDoc title="Data Deletion & User Data Requests" active="/legal/data-deletion">
      <LegalNote />
      <LegalSection title="1. Overview">
        <p>
          This page explains how to delete your {LEGAL_META.productName} account data and how to revoke
          platform access (Meta, Google/YouTube, TikTok). Meta app review commonly requires a public
          data-deletion instructions URL — this page is intended for that purpose.
        </p>
      </LegalSection>
      <LegalSection title="2. Delete or request deletion of your account">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Sign in to {LEGAL_META.productName} at {LEGAL_META.siteUrl}.</li>
          <li>
            Ask a workspace Owner/Admin to remove your user, or email{' '}
            <a className="underline" href={`mailto:${LEGAL_META.privacyEmail}`}>
              {LEGAL_META.privacyEmail}
            </a>{' '}
            from your registered email with subject “Data deletion request”.
          </li>
          <li>
            Include your account email, workspace name (if known), and whether you want user deletion,
            full workspace deletion, or specific connected-account deletion.
          </li>
          <li>
            We will verify ownership and delete or anonymize personal data within a reasonable period
            (target: 30 days), except data we must retain for legal, security, or backup integrity.
          </li>
        </ol>
      </LegalSection>
      <LegalSection title="3. Disconnect social platforms &amp; revoke OAuth">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>In-app:</strong> open the connected account’s settings and disconnect, or ask an
            admin to remove the account connection (deletes stored tokens for that connection).
          </li>
          <li>
            <strong>Meta / Facebook:</strong> Facebook Settings → Settings &amp; privacy → Settings →
            Apps and Websites → remove {LEGAL_META.productName} / your Meta app.
          </li>
          <li>
            <strong>Google / YouTube:</strong> Google Account → Security → Third-party access → remove
            access for your Google Cloud OAuth client / app.
          </li>
          <li>
            <strong>TikTok:</strong> TikTok app or web settings → Security / Manage apps → revoke the
            app authorization.
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="4. Meta data deletion callback (operator note)">
        <p>
          If your Meta app configuration requires a Data Deletion Request Callback URL, point it to your
          implemented API callback (configure in Meta Developer Console) and keep this page as the
          user-facing instructions URL. Example public instructions URL:{' '}
          <code className="rounded bg-zinc-100 px-1 text-sm">
            {LEGAL_META.siteUrl}/legal/data-deletion
          </code>
          . Implement and document the callback endpoint separately in your API deployment.
        </p>
      </LegalSection>
      <LegalSection title="5. What we delete">
        <p>
          Upon a verified request we delete or anonymize profile fields, session data, and OAuth tokens;
          remove or detach content records where feasible; and purge media we store solely for your
          workspace subject to backup windows. Aggregated analytics without personal identifiers may
          remain.
        </p>
      </LegalSection>
      <LegalSection title="6. Related policies">
        <p>
          <Link className="underline" href="/legal/privacy">
            Privacy Policy
          </Link>
          {' · '}
          <Link className="underline" href="/legal/platforms">
            Platform disclosures
          </Link>
          {' · '}
          <Link className="underline" href="/legal/youtube-api">
            YouTube API Limited Use
          </Link>
        </p>
      </LegalSection>
      <LegalSection title="7. Contact">
        <p>
          {LEGAL_META.privacyEmail} · {LEGAL_META.address}
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
