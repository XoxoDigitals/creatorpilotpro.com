import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Platform Disclosures — ${LEGAL_META.productName}`,
};

export default function PlatformsPage() {
  return (
    <LegalDoc title="Platform Compliance Disclosures" active="/legal/platforms">
      <LegalNote />
      <p>
        {LEGAL_META.productName} connects to third-party platforms using OAuth and official APIs. This
        page summarizes how we use platform data. Also see the{' '}
        <Link className="underline" href="/legal/privacy">
          Privacy Policy
        </Link>
        ,{' '}
        <Link className="underline" href="/legal/data-deletion">
          Data Deletion
        </Link>
        , and dedicated{' '}
        <Link className="underline" href="/legal/youtube-api">
          YouTube API Limited Use
        </Link>{' '}
        page.
      </p>

      <LegalSection title="Facebook / Meta">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>APIs:</strong> Meta Graph API for Page connection, publishing (e.g., Reels/video),
            and permitted Page insights where enabled.
          </li>
          <li>
            <strong>Permissions purpose:</strong> obtain Page access tokens, publish content you
            schedule or approve, and read status/insights needed to operate the workspace.
          </li>
          <li>
            <strong>Use of Meta data:</strong> solely to provide the Service to your workspace. We do
            not sell Meta data. We do not use Meta data for independent advertising or credit decisions.
          </li>
          <li>
            <strong>Deletion:</strong> disconnect in-app and/or remove the app in Facebook Settings; or
            submit a request via{' '}
            <Link className="underline" href="/legal/data-deletion">
              Data Deletion
            </Link>
            .
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Google / YouTube">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>APIs:</strong> Google OAuth and YouTube Data API (and related Google API Services)
            for channel authorization and video upload/management features you enable.
          </li>
          <li>
            <strong>Limited Use:</strong> {LEGAL_META.productName} complies with the{' '}
            <a
              className="underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              rel="noopener noreferrer"
              target="_blank"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. Full statement:{' '}
            <Link className="underline" href="/legal/youtube-api">
              YouTube API Limited Use
            </Link>
            .
          </li>
          <li>
            We acknowledge the{' '}
            <a
              className="underline"
              href="https://www.youtube.com/t/terms"
              rel="noopener noreferrer"
              target="_blank"
            >
              YouTube Terms of Service
            </a>{' '}
            and Google’s{' '}
            <a
              className="underline"
              href="https://policies.google.com/privacy"
              rel="noopener noreferrer"
              target="_blank"
            >
              Privacy Policy
            </a>
            .
          </li>
          <li>
            <strong>Deletion / revoke:</strong> disconnect in-app; revoke in Google Account third-party
            access; or request deletion via our Data Deletion page.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="TikTok">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>APIs:</strong> TikTok Login Kit / Content Posting API (or successor APIs) for
            account authorization and video publish flows you enable.
          </li>
          <li>
            <strong>Permissions purpose:</strong> identify the TikTok user/account, upload and publish
            videos, and check publish status as needed for the Service.
          </li>
          <li>
            <strong>Retention:</strong> tokens and TikTok identifiers are retained while the account
            remains connected and deleted/invalidated on disconnect or account deletion, subject to
            short backup windows.
          </li>
          <li>
            <strong>Deletion:</strong> disconnect in-app, revoke in TikTok app settings, or use{' '}
            <Link className="underline" href="/legal/data-deletion">
              Data Deletion
            </Link>
            .
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Platform compliance: {LEGAL_META.privacyEmail}
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
