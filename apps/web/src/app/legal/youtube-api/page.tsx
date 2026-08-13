import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `YouTube API Services — Limited Use — ${LEGAL_META.productName}`,
};

export default function YoutubeApiPage() {
  return (
    <LegalDoc title="YouTube API Services — Limited Use Disclosure" active="/legal/youtube-api">
      <LegalNote />
      <LegalSection title="Compliance statement">
        <p>
          {LEGAL_META.productName}, operated by {LEGAL_META.companyName}, uses YouTube API Services
          (via Google OAuth and related Google APIs) to let authorized users connect YouTube channels
          and upload or manage videos they choose to publish through the Service.
        </p>
        <p>
          <strong>
            {LEGAL_META.productName}’s use and transfer to any other app of information received from
            Google APIs will adhere to the{' '}
            <a
              className="underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              rel="noopener noreferrer"
              target="_blank"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </strong>
        </p>
      </LegalSection>
      <LegalSection title="What Google / YouTube data we access">
        <ul className="list-disc space-y-2 pl-5">
          <li>Basic profile / account identifiers needed to associate a channel with a workspace.</li>
          <li>Channel metadata required to confirm the connected destination.</li>
          <li>
            Scopes required to upload and manage videos you authorize (exact scopes depend on your
            Google Cloud OAuth client configuration).
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="How we use that data (Limited Use)">
        <ul className="list-disc space-y-2 pl-5">
          <li>Provide or improve user-facing features that are prominent in the Service’s interface.</li>
          <li>Do not use Google user data for serving advertisements.</li>
          <li>
            Do not sell Google user data. Do not use or transfer Google user data for independent
            purposes unrelated to providing or improving the Service’s user-facing features.
          </li>
          <li>
            Human access to Google user data is limited to cases such as user-requested support,
            security/compliance investigations, or where required by law — consistent with Limited Use.
          </li>
          <li>
            We do not allow unauthorized humans or other apps to read Google user data obtained via our
            OAuth client except as permitted by the Policy.
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="Policies we acknowledge">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <a
              className="underline"
              href="https://www.youtube.com/t/terms"
              rel="noopener noreferrer"
              target="_blank"
            >
              YouTube Terms of Service
            </a>
          </li>
          <li>
            <a
              className="underline"
              href="https://developers.google.com/youtube/terms/api-services-terms-of-service"
              rel="noopener noreferrer"
              target="_blank"
            >
              YouTube API Services Terms of Service
            </a>
          </li>
          <li>
            <a
              className="underline"
              href="https://policies.google.com/privacy"
              rel="noopener noreferrer"
              target="_blank"
            >
              Google Privacy Policy
            </a>
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="Revoking access &amp; deleting data">
        <p>
          Users can disconnect YouTube accounts in the Service and revoke access in their Google Account
          security settings. Deletion instructions:{' '}
          <Link className="underline" href="/legal/data-deletion">
            Data Deletion &amp; User Data Requests
          </Link>
          . Broader privacy practices:{' '}
          <Link className="underline" href="/legal/privacy">
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="Contact">
        <p>
          {LEGAL_META.privacyEmail} · {LEGAL_META.address}
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
