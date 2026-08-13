import type { Metadata } from 'next';
import { LegalDoc, LegalNote, LegalSection } from '@/components/legal/legal-shell';
import { LEGAL_META } from '@/lib/legal-meta';

export const metadata: Metadata = {
  title: `Copyright / DMCA — ${LEGAL_META.productName}`,
};

export default function CopyrightPage() {
  return (
    <LegalDoc title="Copyright / DMCA Policy" active="/legal/copyright">
      <LegalNote />
      <LegalSection title="1. Respect for IP">
        <p>
          {LEGAL_META.companyName} respects intellectual property rights. Users may not upload or
          publish content that infringes copyrights, trademarks, or other rights.
        </p>
      </LegalSection>
      <LegalSection title="2. Notification of infringement (DMCA-style)">
        <p>
          If you believe content available through the Service infringes your copyright, send a notice
          to our designated agent including:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Your physical or electronic signature.</li>
          <li>Identification of the copyrighted work claimed to be infringed.</li>
          <li>Identification of the material claimed to be infringing and information reasonably
            sufficient to locate it (URL, account, post ID).</li>
          <li>Your contact information (address, telephone, email).</li>
          <li>A statement that you have a good-faith belief the use is not authorized.</li>
          <li>
            A statement, under penalty of perjury, that the information in the notice is accurate and
            that you are the owner or authorized to act on the owner’s behalf.
          </li>
        </ul>
        <p className="mt-3">
          Designated contact (template): {LEGAL_META.privacyEmail}
          <br />
          Mail: {LEGAL_META.address}
        </p>
      </LegalSection>
      <LegalSection title="3. Counter-notice">
        <p>
          If your material was removed and you believe it was a mistake or misidentification, you may
          submit a counter-notice with the information required by applicable law (including DMCA 17
          U.S.C. §512 where it applies). We may restore material consistent with the statute.
        </p>
      </LegalSection>
      <LegalSection title="4. Repeat infringers">
        <p>
          We may terminate accounts of users who are repeat infringers in appropriate circumstances.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
