/**
 * Company / compliance placeholders for public legal pages and footers.
 * Fill these (or set the NEXT_PUBLIC_* env vars) before app-store / OAuth review.
 */
export const LEGAL_META = {
  /** Legal entity name shown on policies. */
  companyName: process.env.NEXT_PUBLIC_LEGAL_COMPANY_NAME ?? '[Company Name]',
  /** Product / brand name. */
  productName: 'SocialCreatorPilot',
  /** Primary privacy / legal contact. */
  privacyEmail: process.env.NEXT_PUBLIC_LEGAL_EMAIL ?? 'privacy@example.com',
  /** Optional support contact (falls back to privacyEmail in copy). */
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@example.com',
  /** Mailing address for notices. */
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS ?? '[Street Address], [City], [Country]',
  /** ISO-ish effective date string shown on policies. */
  effectiveDate: process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE ?? '2026-01-01',
  /** Public site origin (no trailing slash) — used in deletion / callback examples. */
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://example.com').replace(/\/$/, ''),
} as const;

export type LegalHref =
  | '/legal'
  | '/legal/privacy'
  | '/legal/terms'
  | '/legal/cookies'
  | '/legal/acceptable-use'
  | '/legal/data-processing'
  | '/legal/data-deletion'
  | '/legal/platforms'
  | '/legal/youtube-api'
  | '/legal/community-guidelines'
  | '/legal/copyright'
  | '/legal/security';

export const LEGAL_NAV: { href: LegalHref; label: string; short?: string }[] = [
  { href: '/legal/privacy', label: 'Privacy Policy', short: 'Privacy' },
  { href: '/legal/terms', label: 'Terms of Service', short: 'Terms' },
  { href: '/legal/cookies', label: 'Cookie Policy', short: 'Cookies' },
  { href: '/legal/acceptable-use', label: 'Acceptable Use Policy', short: 'Acceptable Use' },
  { href: '/legal/data-processing', label: 'Data Processing & Subprocessors', short: 'Data Processing' },
  { href: '/legal/data-deletion', label: 'Data Deletion & User Requests', short: 'Data Deletion' },
  { href: '/legal/platforms', label: 'Platform Disclosures', short: 'Platforms' },
  { href: '/legal/youtube-api', label: 'YouTube API Limited Use', short: 'YouTube API' },
  { href: '/legal/community-guidelines', label: 'Community Guidelines', short: 'Community' },
  { href: '/legal/copyright', label: 'Copyright / DMCA', short: 'Copyright' },
  { href: '/legal/security', label: 'Security Overview', short: 'Security' },
];
