import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Cookie Policy — ${LEGAL_META.productName}`,
};

export default function CookiePolicyPage() {
  return (
    <LegalDoc title="Cookie Policy" active="/legal/cookies">
      <LegalNote />
      <LegalSection title="1. Overview">
        <p>
          {LEGAL_META.productName} uses cookies, local storage, and similar technologies to keep you
          signed in, remember preferences, and secure the Service. This policy should be read with our{' '}
          <Link className="underline" href="/legal/privacy">
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="2. What we use">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Session cookie (`scp_session` or equivalent):</strong> authenticates your browser
            session after login. Essential for the product to function.
          </li>
          <li>
            <strong>Local / session storage:</strong> may store UI preferences, draft wizard state, or
            short-lived client flags. Not used to sell advertising profiles.
          </li>
          <li>
            <strong>Security / CSRF protections:</strong> tokens or headers associated with authenticated
            requests where applicable.
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="3. Why we use them">
        <p>
          Essential operation (login, authorization), preference persistence, and abuse prevention. We
          do not currently rely on third-party advertising cookies for the core product. If analytics
          cookies are added later, update this policy and obtain consent where required.
        </p>
      </LegalSection>
      <LegalSection title="4. Your choices">
        <p>
          You can clear cookies and site data in your browser. Blocking the session cookie will prevent
          sign-in. Workspace admins control who may create accounts; signing out ends the session
          cookie’s usefulness.
        </p>
      </LegalSection>
      <LegalSection title="5. Contact">
        <p>
          Questions: {LEGAL_META.privacyEmail}
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
