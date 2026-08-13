import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Community Guidelines — ${LEGAL_META.productName}`,
};

export default function CommunityGuidelinesPage() {
  return (
    <LegalDoc title="Community Guidelines" active="/legal/community-guidelines">
      <LegalNote />
      <LegalSection title="Be responsible publishers">
        <p>
          {LEGAL_META.productName} helps teams create and publish social video. You are responsible for
          what you publish. Respect audiences, creators, and platform rules.
        </p>
      </LegalSection>
      <LegalSection title="Do">
        <ul className="list-disc space-y-2 pl-5">
          <li>Review AI-generated drafts before publishing.</li>
          <li>Use only content and music you have rights to use.</li>
          <li>Disclose sponsorships and brand partnerships where required.</li>
          <li>Respect copyright claims and takedown processes.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Don’t">
        <ul className="list-disc space-y-2 pl-5">
          <li>Post illegal, hateful, or exploitative content.</li>
          <li>Harass individuals or impersonate others.</li>
          <li>Game metrics with bots or deceptive practices.</li>
          <li>Attempt to access other workspaces or abuse APIs.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Enforcement">
        <p>
          Violations may lead to content removal, account suspension, or termination under the{' '}
          <Link className="underline" href="/legal/terms">
            Terms
          </Link>{' '}
          and{' '}
          <Link className="underline" href="/legal/acceptable-use">
            Acceptable Use Policy
          </Link>
          . Report issues to {LEGAL_META.supportEmail}.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
