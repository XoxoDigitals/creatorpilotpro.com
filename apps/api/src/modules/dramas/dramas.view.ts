import type { DramaSeries, DramaEpisode } from '@scp/db';

// ---------------------------------------------------------------------------
// Episode stats helper
// ---------------------------------------------------------------------------

export interface EpisodeStats {
  total: number;
  generated: number;
  inProduction: number;
  uploaded: number;
  published: number;
}

function computeEpisodeStats(
  episodes: Array<{ status: DramaEpisode['status'] }>,
): EpisodeStats {
  const stats: EpisodeStats = {
    total: episodes.length,
    generated: 0,
    inProduction: 0,
    uploaded: 0,
    published: 0,
  };
  for (const ep of episodes) {
    if (ep.status === 'GENERATED') stats.generated++;
    else if (ep.status === 'IN_PRODUCTION') stats.inProduction++;
    else if (ep.status === 'UPLOADED') stats.uploaded++;
    else if (ep.status === 'PUBLISHED') stats.published++;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// DramaSeriesView (list item)
// ---------------------------------------------------------------------------

export interface DramaSeriesView {
  id: string;
  accountId: string;
  title: string;
  genre: string;
  theme: string;
  audience: string;
  episodeCount: number;
  episodeDurationSec: number;
  styleReferences: string | null;
  hasBible: boolean;
  characterSheetCount: number;
  status: DramaSeries['status'];
  episodeStats: EpisodeStats;
  createdAt: string;
  updatedAt: string;
}

export function toDramaSeriesView(
  s: DramaSeries & { episodes: Array<{ status: DramaEpisode['status'] }> },
): DramaSeriesView {
  const sheets = Array.isArray(s.characterSheets) ? s.characterSheets : [];
  return {
    id: s.id,
    accountId: s.accountId,
    title: s.title,
    genre: s.genre,
    theme: s.theme,
    audience: s.audience,
    episodeCount: s.episodeCount,
    episodeDurationSec: s.episodeDurationSec,
    styleReferences: s.styleReferences,
    hasBible: s.seriesBible !== null,
    characterSheetCount: sheets.length,
    status: s.status,
    episodeStats: computeEpisodeStats(s.episodes),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// DramaEpisodeView
// ---------------------------------------------------------------------------

export interface DramaEpisodeView {
  id: string;
  seriesId: string;
  number: number;
  summary: string | null;
  script: string | null;
  scenePrompts: unknown[];
  narration: string | null;
  productionNotes: string | null;
  recap: string | null;
  generatedAt: string | null;
  contentItemId: string | null;
  status: DramaEpisode['status'];
  createdAt: string;
}

/** Map a DramaEpisode to its view. `truncateScript` limits the script to 200 chars (for lists). */
export function toDramaEpisodeView(
  e: DramaEpisode,
  options?: { truncateScript?: boolean },
): DramaEpisodeView {
  const truncate = options?.truncateScript ?? false;
  const script =
    truncate && e.script && e.script.length > 200
      ? e.script.slice(0, 200) + '…'
      : e.script;
  const scenePrompts = Array.isArray(e.scenePrompts) ? e.scenePrompts : [];
  return {
    id: e.id,
    seriesId: e.seriesId,
    number: e.number,
    summary: e.summary,
    script,
    scenePrompts: scenePrompts as unknown[],
    narration: e.narration,
    productionNotes: e.productionNotes,
    recap: e.recap,
    generatedAt: e.generatedAt ? e.generatedAt.toISOString() : null,
    contentItemId: e.contentItemId,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// DramaSeriesDetailView (single series with full data)
// ---------------------------------------------------------------------------

export interface DramaSeriesDetailView extends DramaSeriesView {
  seriesBible: unknown | null;
  characterSheets: unknown[];
  episodes: DramaEpisodeView[];
}

export function toDramaSeriesDetailView(
  s: DramaSeries & { episodes: DramaEpisode[] },
): DramaSeriesDetailView {
  const base = toDramaSeriesView(s);
  const sheets = Array.isArray(s.characterSheets) ? s.characterSheets : [];
  return {
    ...base,
    seriesBible: s.seriesBible,
    characterSheets: sheets as unknown[],
    episodes: s.episodes.map((e) => toDramaEpisodeView(e)),
  };
}
