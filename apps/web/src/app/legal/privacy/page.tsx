import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Privacy Policy — ${LEGAL_META.productName}`,
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDoc title="Privacy Policy" active="/legal/privacy">
      <LegalNote />
      <LegalSection title="1. Who we are">
        <p>
          {LEGAL_META.productName} (“Service”) is operated by {LEGAL_META.companyName} (“we”, “us”).
          This policy explains what data we collect, how we use it, and your choices. Contact:{' '}
          <a className="underline" href={`mailto:${LEGAL_META.privacyEmail}`}>
            {LEGAL_META.privacyEmail}
          </a>
          . Address: {LEGAL_META.address}.
        </p>
      </LegalSection>
      <LegalSection title="2. Data we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account data:</strong> name, email, role, workspace membership, authentication
            credentials (hashed passwords or equivalent).
          </li>
          <li>
            <strong>Social account connection data:</strong> platform account IDs, handles, page/channel
            metadata, and OAuth access/refresh tokens needed to publish and read permitted analytics.
          </li>
          <li>
            <strong>Content &amp; operations data:</strong> drafts, ideas, packages, captions, media
            metadata, schedules, publish statuses, and related logs.
          </li>
          <li>
            <strong>AI processing inputs/outputs:</strong> prompts, reference channel summaries, generated
            ideas/scripts, and configuration you provide for generation features.
          </li>
          <li>
            <strong>Technical data:</strong> IP address, device/browser type, approximate location derived
            from IP, cookies/local storage identifiers, and diagnostic logs.
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="3. How we use data">
        <p>We use data to provide and improve the Service, including to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Authenticate users and enforce access controls.</li>
          <li>Connect platform accounts and publish or schedule content you authorize.</li>
          <li>Run AI-assisted ideation and packaging features you enable.</li>
          <li>Monitor reliability, prevent abuse, and respond to support requests.</li>
          <li>Comply with law and platform developer terms.</li>
        </ul>
        <p>
          We do <strong>not</strong> sell personal data. We do not use Google / YouTube user data for
          advertising or independent AI model training beyond operating the Service features you request.
          See our{' '}
          <Link className="underline" href="/legal/youtube-api">
            YouTube API Limited Use
          </Link>{' '}
          disclosure.
        </p>
      </LegalSection>
      <LegalSection title="4. OAuth tokens &amp; platform APIs">
        <p>
          When you connect YouTube (Google), Facebook/Meta, or TikTok, we store encrypted OAuth tokens
          and use them only to perform actions you initiate or schedule (e.g., upload, status checks,
          permitted analytics). You may disconnect accounts in the product and revoke access in each
          platform’s security settings. See{' '}
          <Link className="underline" href="/legal/platforms">
            Platform disclosures
          </Link>{' '}
          and{' '}
          <Link className="underline" href="/legal/data-deletion">
            Data deletion
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="5. Cookies &amp; similar technologies">
        <p>
          We use session cookies and local storage for authentication and preferences. Details are in the{' '}
          <Link className="underline" href="/legal/cookies">
            Cookie Policy
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="6. Retention">
        <p>
          We retain account and operational data while your workspace is active and for a reasonable
          period afterward for backups, dispute resolution, and legal compliance. OAuth tokens are
          deleted or invalidated when you disconnect an account or delete your user/workspace, subject
          to short-lived backup retention.
        </p>
      </LegalSection>
      <LegalSection title="7. Sharing">
        <p>
          We share data with subprocessors that help host and operate the Service (see{' '}
          <Link className="underline" href="/legal/data-processing">
            Data Processing &amp; Subprocessors
          </Link>
          ), with platforms when you authorize publishing, and when required by law. We do not sell
          personal information.
        </p>
      </LegalSection>
      <LegalSection title="8. Your rights">
        <p>
          Depending on your location, you may have rights to access, correct, export, or delete personal
          data, and to object to or restrict certain processing. Email{' '}
          <a className="underline" href={`mailto:${LEGAL_META.privacyEmail}`}>
            {LEGAL_META.privacyEmail}
          </a>{' '}
          or use the{' '}
          <Link className="underline" href="/legal/data-deletion">
            Data Deletion / User Data Request
          </Link>{' '}
          page. We may verify your identity before fulfilling requests.
        </p>
      </LegalSection>
      <LegalSection title="9. International transfers">
        <p>
          If we process data in countries other than your own, we use appropriate safeguards as required
          by applicable law (e.g., contractual clauses). Update this section with your actual hosting
          regions.
        </p>
      </LegalSection>
      <LegalSection title="10. Changes">
        <p>
          We may update this policy and will revise the effective date above. Material changes should be
          communicated via the Service or email when appropriate.
        </p>
      </LegalSection>
      <LegalSection title="11. Contact">
        <p>
          Privacy inquiries: {LEGAL_META.privacyEmail}
          <br />
          Support: {LEGAL_META.supportEmail}
          <br />
          Mail: {LEGAL_META.address}
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
