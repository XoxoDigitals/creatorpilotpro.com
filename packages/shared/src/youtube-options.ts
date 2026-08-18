import { formatPublishCopyLanguageRules } from './content-languages.js';

/** Common YouTube Data API v3 video category IDs. */
export const YOUTUBE_CATEGORIES = [
  { id: '1', label: 'Film & Animation' },
  { id: '2', label: 'Autos & Vehicles' },
  { id: '10', label: 'Music' },
  { id: '15', label: 'Pets & Animals' },
  { id: '17', label: 'Sports' },
  { id: '19', label: 'Travel & Events' },
  { id: '20', label: 'Gaming' },
  { id: '22', label: 'People & Blogs' },
  { id: '23', label: 'Comedy' },
  { id: '24', label: 'Entertainment' },
  { id: '25', label: 'News & Politics' },
  { id: '26', label: 'Howto & Style' },
  { id: '27', label: 'Education' },
  { id: '28', label: 'Science & Technology' },
  { id: '29', label: 'Nonprofits & Activism' },
] as const;

/** Common recording / audience countries (ISO 3166-1 alpha-2). */
export const YOUTUBE_COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'IN', label: 'India' },
  { code: 'PK', label: 'Pakistan' },
  { code: 'BR', label: 'Brazil' },
  { code: 'MX', label: 'Mexico' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' },
  { code: 'ID', label: 'Indonesia' },
  { code: 'PH', label: 'Philippines' },
  { code: 'NG', label: 'Nigeria' },
  { code: 'ZA', label: 'South Africa' },
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'SA', label: 'Saudi Arabia' },
  { code: 'TR', label: 'Turkey' },
  { code: 'PL', label: 'Poland' },
  { code: 'SE', label: 'Sweden' },
] as const;

/**
 * YouTube AI-owner package description (videoDescription).
 * Long detailed caption + keywords; documentaries also get research links for claims.
 */
export function formatYoutubeAiDescriptionRules(options: {
  documentary?: boolean;
  language?: string | null;
}): string {
  const sources = options.documentary
    ? `
- After the synopsis, add a Sources / Research section. For every factual claim (dates, numbers, court cases, company actions, laws, official reports), include a research link to a reputable public source (government, court docket, academic, major news). Use a real well-known URL only when you are sure of it. If the exact URL is uncertain, cite Organization + title + year — never invent a fake link.
- Aim for 4–10 sources, one per major claim. No affiliate or spam links.`
    : '';
  return `YouTube AI-mode videoDescription (publish caption — ${formatPublishCopyLanguageRules(options.language)}):
- Do not write a 1–3 sentence blurb. Write a LONG, detailed description (about 900–1800 characters, up to ~4000 if the story needs it) that actually explains the video: hook, what happens, who/what is involved, why it matters, and the takeaway.
- Structure:
  1) Opening hook (2–4 sentences)
  2) Detailed synopsis covering the story beats (several short paragraphs)
  3) What the viewer will learn / why it matters${
    options.documentary ? '\n  4) Sources / Research links (required when the video makes factual claims)' : ''
  }
  ${options.documentary ? '5' : '4'}) Keywords line: start with "Keywords:" then 8–15 comma-separated search phrases (no #)
  ${options.documentary ? '6' : '5'}) Blank line, then 3–8 hashtags
  ${options.documentary ? '7' : '6'}) Light CTA (subscribe / next video) if natural
- Keywords must appear IN the description (the Keywords: line), not only in YouTube tags.
- Do not paste the full voiceover script. Do not invent biography or facts beyond the idea / topicSummary.${sources}`.trim();
}
