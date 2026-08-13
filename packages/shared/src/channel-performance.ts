/**
 * Reference-channel performance memory: deterministic signals from title +
 * views (+ publish date), optional AI narrative. Used by the worker analyzer
 * and injected into idea-generation prompts.
 */

export const CHANNEL_PERFORMANCE_VERSION = 1 as const;

export interface PerformanceVideoExample {
  videoId: string;
  title: string;
  views: number;
  publishedAt: string | null;
  /** Approximate views per day since publish (null if undated). */
  viewsPerDay: number | null;
}

export interface TitlePatternRates {
  avgLength: number;
  questionRate: number;
  listOrNumberRate: number;
  curiosityRate: number;
  mysteryRate: number;
}

export interface KeywordCluster {
  keyword: string;
  count: number;
  avgViews: number;
}

export interface DeterministicPerformanceSignals {
  sampleSize: number;
  topVideos: PerformanceVideoExample[];
  /** Bottom quartile by recency-adjusted score — useful as "avoid" contrast. */
  weakVideos: PerformanceVideoExample[];
  titlePatternsTop: TitlePatternRates;
  titlePatternsOverall: TitlePatternRates;
  keywordClusters: KeywordCluster[];
  winningTopics: string[];
  avoidPatterns: string[];
}

export interface AiPerformanceInsights {
  summary: string;
  whyTopPerformed: string[];
  winningHooks: string[];
  avoidPatterns: string[];
  /** Always present: reminds that this is inference from titles/views only. */
  caveat: string;
}

export interface ChannelPerformanceMemory {
  version: typeof CHANNEL_PERFORMANCE_VERSION;
  sampleSize: number;
  /** Hash of videoId|views|title so re-analysis can skip unchanged data. */
  dataFingerprint: string;
  analyzedAt: string;
  deterministic: DeterministicPerformanceSignals;
  aiInsights: AiPerformanceInsights | null;
  aiAvailable: boolean;
}

export interface VideoForPerformanceAnalysis {
  videoId: string;
  title: string;
  views: number | bigint | string;
  publishedAt: Date | string | null;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'from', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'it', 'as',
  'my', 'your', 'our', 'their', 'his', 'her', 'i', 'you', 'we', 'they', 'he', 'she',
  'not', 'no', 'yes', 'vs', 'vs.', 'how', 'why', 'what', 'when', 'where', 'who',
  'will', 'can', 'could', 'should', 'would', 'do', 'does', 'did', 'has', 'have',
  'had', 'up', 'out', 'about', 'into', 'over', 'after', 'before', 'than', 'then',
  'so', 'if', 'just', 'new', 'full', 'part', 'episode', 'ep', 'official', 'video',
]);

const CURIOSITY_RE =
  /\b(secret|secrets|shocking|unbelievable|insane|crazy|truth|revealed|reveal|nobody|never|hidden|exposed|finally|actually|real reason)\b/i;
const MYSTERY_RE =
  /\b(mystery|mysterious|unknown|strange|weird|unexplained|disappeared|vanished|forbidden|dark|haunted)\b/i;
const QUESTION_RE = /\?|^\s*(how|why|what|when|where|who|which|is|are|do|does|did|can|could|will)\b/i;
const LIST_NUMBER_RE =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|top)\b|\d+\s*(ways|tips|things|reasons|secrets|mistakes)/i;

function toViews(v: number | bigint | string): number {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return Number(v) || 0;
  return Number.isFinite(v) ? v : 0;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysSince(publishedAt: Date | null, now: Date): number | null {
  if (!publishedAt) return null;
  const ms = now.getTime() - publishedAt.getTime();
  if (ms < 0) return 0;
  return Math.max(ms / 86_400_000, 1 / 24); // floor at 1 hour so brand-new isn't Inf
}

/** Recency-adjusted score: views / days^0.6 so old megahits don't dominate forever. */
export function recencyAdjustedScore(views: number, publishedAt: Date | null, now = new Date()): number {
  const days = daysSince(publishedAt, now);
  if (days == null) return views;
  return views / Math.pow(days, 0.6);
}

export function fingerprintVideos(videos: VideoForPerformanceAnalysis[]): string {
  const parts = [...videos]
    .map((v) => `${v.videoId}|${toViews(v.views)}|${v.title.trim()}`)
    .sort();
  // FNV-1a 32-bit — stable, fast, no crypto dep in shared.
  let h = 0x811c9dc5;
  const s = parts.join('\n');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function measureTitlePatterns(titles: string[]): TitlePatternRates {
  if (titles.length === 0) {
    return {
      avgLength: 0,
      questionRate: 0,
      listOrNumberRate: 0,
      curiosityRate: 0,
      mysteryRate: 0,
    };
  }
  const n = titles.length;
  let len = 0;
  let q = 0;
  let list = 0;
  let cur = 0;
  let mys = 0;
  for (const t of titles) {
    len += t.length;
    if (QUESTION_RE.test(t)) q++;
    if (LIST_NUMBER_RE.test(t)) list++;
    if (CURIOSITY_RE.test(t)) cur++;
    if (MYSTERY_RE.test(t)) mys++;
  }
  return {
    avgLength: Math.round(len / n),
    questionRate: q / n,
    listOrNumberRate: list / n,
    curiosityRate: cur / n,
    mysteryRate: mys / n,
  };
}

function toExample(
  v: VideoForPerformanceAnalysis,
  now: Date,
): PerformanceVideoExample {
  const views = toViews(v.views);
  const publishedAt = toDate(v.publishedAt);
  const days = daysSince(publishedAt, now);
  return {
    videoId: v.videoId,
    title: v.title,
    views,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    viewsPerDay: days != null ? Math.round(views / days) : null,
  };
}

function buildAvoidPatterns(
  top: TitlePatternRates,
  overall: TitlePatternRates,
  weakTitles: string[],
): string[] {
  const avoid: string[] = [];
  if (overall.avgLength > 0 && top.avgLength + 12 < overall.avgLength) {
    avoid.push('Overly long titles vs top performers');
  }
  if (top.questionRate >= 0.25 && overall.questionRate < top.questionRate * 0.5) {
    avoid.push('Flat statements with no question hook');
  }
  if (top.curiosityRate >= 0.2 && overall.curiosityRate < top.curiosityRate * 0.5) {
    avoid.push('Titles without curiosity / reveal language');
  }
  if (top.listOrNumberRate >= 0.25 && overall.listOrNumberRate < top.listOrNumberRate * 0.5) {
    avoid.push('Vague titles without concrete numbers or lists');
  }
  const weakAvg =
    weakTitles.length > 0
      ? weakTitles.reduce((a, t) => a + t.length, 0) / weakTitles.length
      : 0;
  if (weakAvg > 0 && weakAvg < 28) {
    avoid.push('Very short / generic titles');
  }
  return avoid.slice(0, 5);
}

/**
 * Pure deterministic analysis from title + views (+ publish date).
 * No AI — safe to run after every poll even when providers are down.
 */
export function computeDeterministicPerformance(
  videos: VideoForPerformanceAnalysis[],
  now = new Date(),
): DeterministicPerformanceSignals {
  const scored = videos.map((v) => ({
    v,
    views: toViews(v.views),
    publishedAt: toDate(v.publishedAt),
    score: recencyAdjustedScore(toViews(v.views), toDate(v.publishedAt), now),
  }));
  scored.sort((a, b) => b.score - a.score);

  const topN = Math.min(10, Math.max(3, Math.ceil(scored.length * 0.15)));
  const weakN = Math.min(5, Math.max(2, Math.ceil(scored.length * 0.1)));
  const top = scored.slice(0, topN);
  const weak = scored.slice(-weakN).reverse();

  const topTitles = top.map((s) => s.v.title);
  const allTitles = scored.map((s) => s.v.title);
  const titlePatternsTop = measureTitlePatterns(topTitles);
  const titlePatternsOverall = measureTitlePatterns(allTitles);

  // Keyword clusters weighted by recency-adjusted score among top half.
  const half = scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
  const kwMap = new Map<string, { count: number; viewSum: number }>();
  for (const s of half) {
    const seen = new Set<string>();
    for (const tok of tokenizeTitle(s.v.title)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      const cur = kwMap.get(tok) ?? { count: 0, viewSum: 0 };
      cur.count++;
      cur.viewSum += s.views;
      kwMap.set(tok, cur);
    }
  }
  const minCount = half.length >= 6 ? 2 : 1;
  const keywordClusters = [...kwMap.entries()]
    .map(([keyword, { count, viewSum }]) => ({
      keyword,
      count,
      avgViews: Math.round(viewSum / count),
    }))
    .filter((k) => k.count >= minCount)
    .sort((a, b) => b.count * Math.log10(b.avgViews + 1) - a.count * Math.log10(a.avgViews + 1))
    .slice(0, 12);

  const winningTopics = keywordClusters.slice(0, 6).map((k) => k.keyword);

  return {
    sampleSize: videos.length,
    topVideos: top.map((s) => toExample(s.v, now)),
    weakVideos: weak.map((s) => toExample(s.v, now)),
    titlePatternsTop,
    titlePatternsOverall,
    keywordClusters,
    winningTopics,
    avoidPatterns: buildAvoidPatterns(titlePatternsTop, titlePatternsOverall, weak.map((s) => s.v.title)),
  };
}

export function buildChannelPerformanceMemory(
  videos: VideoForPerformanceAnalysis[],
  aiInsights: AiPerformanceInsights | null,
  aiAvailable: boolean,
  now = new Date(),
): ChannelPerformanceMemory {
  const deterministic = computeDeterministicPerformance(videos, now);
  return {
    version: CHANNEL_PERFORMANCE_VERSION,
    sampleSize: videos.length,
    dataFingerprint: fingerprintVideos(videos),
    analyzedAt: now.toISOString(),
    deterministic,
    aiInsights,
    aiAvailable,
  };
}

/** Human-readable block for idea-generation prompts. */
export function formatChannelPerformanceForPrompt(
  channelName: string,
  memory: ChannelPerformanceMemory | null | undefined,
): string {
  if (!memory?.deterministic) return '';
  const d = memory.deterministic;
  const lines: string[] = [
    `Reference channel "${channelName}" performance memory (from title + views only — not causal proof; invent fresh original ideas, never copy titles):`,
    `Sample size: ${d.sampleSize} videos. Analyzed: ${memory.analyzedAt}.`,
  ];
  if (d.winningTopics.length) {
    lines.push(`Winning topic keywords: ${d.winningTopics.join(', ')}`);
  }
  if (d.avoidPatterns.length) {
    lines.push(`Patterns to avoid: ${d.avoidPatterns.join('; ')}`);
  }
  const tp = d.titlePatternsTop;
  lines.push(
    `Top-title patterns: avg length ${tp.avgLength}; questions ${(tp.questionRate * 100).toFixed(0)}%; lists/numbers ${(tp.listOrNumberRate * 100).toFixed(0)}%; curiosity ${(tp.curiosityRate * 100).toFixed(0)}%; mystery ${(tp.mysteryRate * 100).toFixed(0)}%.`,
  );
  lines.push('Use the same headline structure as the best-performing reference titles (question vs statement, mystery/reveal framing, number/list style, and specificity), but never copy or lightly paraphrase those titles.');
  if (d.topVideos.length) {
    lines.push(
      'Top examples (recency-adjusted): ' +
        d.topVideos
          .slice(0, 5)
          .map((v) => `"${v.title}" (${v.views} views)`)
          .join('; '),
    );
  }
  if (memory.aiInsights) {
    const ai = memory.aiInsights;
    if (ai.summary) lines.push(`AI inference summary: ${ai.summary}`);
    if (ai.whyTopPerformed?.length) {
      lines.push(`Likely reasons top titles worked: ${ai.whyTopPerformed.join('; ')}`);
    }
    if (ai.winningHooks?.length) {
      lines.push(`Winning hooks (inspire, don't copy): ${ai.winningHooks.join('; ')}`);
    }
    if (ai.avoidPatterns?.length) {
      lines.push(`AI avoid patterns: ${ai.avoidPatterns.join('; ')}`);
    }
    lines.push(ai.caveat || 'These insights are inferences from titles and views only.');
  }
  return lines.join('\n');
}

export function parseChannelPerformanceMemory(raw: unknown): ChannelPerformanceMemory | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<ChannelPerformanceMemory>;
  if (m.version !== CHANNEL_PERFORMANCE_VERSION || !m.deterministic) return null;
  return m as ChannelPerformanceMemory;
}

/** Compact UI-friendly summary derived from stored memory. */
export function summarizePerformanceForUi(memory: ChannelPerformanceMemory): {
  summary: string;
  winningTopics: string[];
  winningHooks: string[];
  avoidPatterns: string[];
  topExamples: Array<{ title: string; views: number }>;
  sampleSize: number;
  analyzedAt: string;
  aiAvailable: boolean;
} {
  const d = memory.deterministic;
  const ai = memory.aiInsights;
  const avoid = [
    ...new Set([...(d.avoidPatterns ?? []), ...(ai?.avoidPatterns ?? [])]),
  ].slice(0, 6);
  return {
    summary:
      ai?.summary?.trim() ||
      (d.winningTopics.length
        ? `Top performers skew toward topics like ${d.winningTopics.slice(0, 4).join(', ')} (inferred from titles & views).`
        : `Analyzed ${d.sampleSize} videos by title and views.`),
    winningTopics: d.winningTopics,
    winningHooks: ai?.winningHooks?.length
      ? ai.winningHooks
      : d.topVideos.slice(0, 3).map((v) => v.title),
    avoidPatterns: avoid,
    topExamples: d.topVideos.slice(0, 5).map((v) => ({ title: v.title, views: v.views })),
    sampleSize: d.sampleSize,
    analyzedAt: memory.analyzedAt,
    aiAvailable: memory.aiAvailable,
  };
}



