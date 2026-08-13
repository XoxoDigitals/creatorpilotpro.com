import Link from 'next/link';
import { cookies } from 'next/headers';
import { Syne, DM_Sans } from 'next/font/google';
import { LEGAL_META, LEGAL_NAV } from '@/lib/legal-meta';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: `${LEGAL_META.productName} — Create, schedule, and publish social video`,
  description:
    'AI ideas, creative packages, scheduling, and multi-platform publishing for YouTube, Facebook, and TikTok.',
};

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-marketing-display',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-marketing-body',
  display: 'swap',
});

export default async function HomePage() {
  const hasSession = (await cookies()).has('scp_session');
  const primaryHref = hasSession ? '/dashboard' : '/login';
  const primaryLabel = hasSession ? 'Open dashboard' : 'Get started';
  const secondaryHref = hasSession ? '/legal' : '/login';
  const secondaryLabel = hasSession ? 'Policies' : 'Sign in';

  return (
    <div className={`${syne.variable} ${dmSans.variable} marketing min-h-screen`}>
      <a href="#main" className="marketing-skip">
        Skip to content
      </a>

      <header className="marketing-nav">
        <div className="marketing-wrap marketing-nav-inner">
          <span className="marketing-brand-mark" aria-hidden>
            SCP
          </span>
          <nav className="marketing-nav-links">
            <a href="#product">Product</a>
            <a href="#platforms">Platforms</a>
            <Link href="/legal">Legal</Link>
            <Link href={primaryHref} className="marketing-nav-cta">
              {hasSession ? 'Dashboard' : 'Sign in'}
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="marketing-hero" aria-labelledby="hero-brand">
          <div className="marketing-hero-atmosphere" aria-hidden />
          <div className="marketing-wrap marketing-hero-grid">
            <div className="marketing-hero-copy">
              <p id="hero-brand" className="marketing-brand">
                {LEGAL_META.productName}
              </p>
              <h1 className="marketing-headline">Ship social video without the ops chaos.</h1>
              <p className="marketing-lede">
                One workspace to ideate with AI, package creatives, schedule, and publish to YouTube,
                Facebook, and TikTok.
              </p>
              <div className="marketing-cta-row">
                <Link href={primaryHref} className="marketing-btn-primary">
                  {primaryLabel}
                </Link>
                <Link href={secondaryHref} className="marketing-btn-ghost">
                  {secondaryLabel}
                </Link>
              </div>
            </div>
            <div className="marketing-hero-visual" aria-hidden>
              <div className="marketing-reel">
                <div className="marketing-reel-track">
                  <span>Ideas</span>
                  <span>Packages</span>
                  <span>Schedule</span>
                  <span>Publish</span>
                  <span>Ideas</span>
                  <span>Packages</span>
                  <span>Schedule</span>
                  <span>Publish</span>
                </div>
              </div>
              <div className="marketing-stage">
                <div className="marketing-stage-bar">
                  <i />
                  <i />
                  <i />
                  <span>live pipeline</span>
                </div>
                <ul className="marketing-stage-list">
                  <li>
                    <em>01</em> Research &amp; AI ideas
                  </li>
                  <li>
                    <em>02</em> Creative packages
                  </li>
                  <li>
                    <em>03</em> Review &amp; schedule
                  </li>
                  <li>
                    <em>04</em> Multi-platform publish
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="product" className="marketing-section" aria-labelledby="product-title">
          <div className="marketing-wrap">
            <h2 id="product-title" className="marketing-section-title">
              What it does
            </h2>
            <p className="marketing-section-lede">
              Built for teams that run high-volume social video — from idea to published post.
            </p>
            <ol className="marketing-feature-list">
              <li>
                <strong>AI ideas</strong>
                <span>Mine reference channels and generate briefable concepts.</span>
              </li>
              <li>
                <strong>Packages</strong>
                <span>Turn approved ideas into scripts, assets, and voiceover-ready packages.</span>
              </li>
              <li>
                <strong>Schedule</strong>
                <span>Cadence, day windows, and randomized post times per account.</span>
              </li>
              <li>
                <strong>Multi-platform publish</strong>
                <span>Native uploads via YouTube, Meta, and TikTok APIs — your apps, your tokens.</span>
              </li>
            </ol>
          </div>
        </section>

        <section id="platforms" className="marketing-section marketing-section-alt" aria-labelledby="platforms-title">
          <div className="marketing-wrap">
            <h2 id="platforms-title" className="marketing-section-title">
              Platforms
            </h2>
            <p className="marketing-section-lede">Connect the channels you already run.</p>
            <ul className="marketing-platforms">
              <li>
                <span className="marketing-platform-name">YouTube</span>
                <span>Direct upload via Google / YouTube Data API</span>
              </li>
              <li>
                <span className="marketing-platform-name">Facebook</span>
                <span>Pages &amp; Reels via Meta Graph API</span>
              </li>
              <li>
                <span className="marketing-platform-name">TikTok</span>
                <span>Content Posting API with your TikTok app</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="marketing-trust" aria-labelledby="trust-title">
          <div className="marketing-wrap marketing-trust-inner">
            <h2 id="trust-title" className="marketing-section-title">
              Trust &amp; compliance
            </h2>
            <p className="marketing-section-lede">
              Policies for privacy, platform OAuth data use, and account deletion — required for Meta,
              Google, and TikTok app review.
            </p>
            <div className="marketing-trust-links">
              <Link href="/legal/privacy">Privacy</Link>
              <Link href="/legal/terms">Terms</Link>
              <Link href="/legal/data-deletion">Data deletion</Link>
              <Link href="/legal/youtube-api">YouTube Limited Use</Link>
              <Link href="/legal/platforms">Platform disclosures</Link>
              <Link href="/legal">All policies</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="marketing-footer">
        <div className="marketing-wrap">
          <div className="marketing-footer-top">
            <p className="marketing-footer-brand">{LEGAL_META.productName}</p>
            <Link href="/login" className="marketing-btn-ghost marketing-btn-compact">
              Sign in
            </Link>
          </div>
          <ul className="marketing-footer-legal">
            {LEGAL_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.short ?? item.label}</Link>
              </li>
            ))}
          </ul>
          <p className="marketing-footer-meta">
            © {new Date().getFullYear()} {LEGAL_META.companyName} ·{' '}
            <a href={`mailto:${LEGAL_META.privacyEmail}`}>{LEGAL_META.privacyEmail}</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
