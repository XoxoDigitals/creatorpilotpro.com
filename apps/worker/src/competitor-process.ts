/**
 * Competitor channel poller (Phase 4, docs/01 FR-D1). Fetches channel uploads
 * from YouTube via the Data API (uploads playlist + pagination), upserts
 * CompetitorVideo rows, and optionally fetches captions. Gracefully degrades
 * when the YouTube API key is absent — raises an incident instead of crashing.
 *
 * Uses playlistItems (cheap, paginated) rather than search.list (100 quota units
 * and a ~500 soft cap). Capped at MAX_VIDEOS_PER_POLL for quota safety.
 *
 * Failure handling mirrors watcher.ts: consecutive failures auto-pause the
 * channel to ERROR after a threshold, with an incident raised.
 */
import type PgBoss from 'pg-boss';
import { decryptSecret, loadMasterKey } from '@scp/shared/crypto';
import { QUEUE } from '@scp/shared';
import { getPrisma, raiseIncident, type PrismaClient } from './publish-support.js';

const FAILURE_THRESHOLD = 3;
/** YouTube playlistItems maxResults upper bound. */
const PAGE_SIZE = 50;
/**
 * Soft cap per poll. playlistItems is 1 quota unit/page; videos.list is 1/page
 * of details. 200 ≈ 4+4 units plus 1 for channels.list — well within default
 * daily quota while covering a reasonable channel history for idea gen.
 */
const MAX_VIDEOS_PER_POLL = 200;

/** Env YOUTUBE_DATA_API_KEY, else encrypted system setting youtubeDataApiKey. */
async function getYouTubeApiKey(prisma: PrismaClient): Promise<string | null> {
  const fromEnv = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const row = await prisma.systemSetting.findUnique({ where: { key: 'youtubeDataApiKey' } });
  if (!row) return null;
  const val = row.value as unknown;

  // Secret settings are stored as { __enc, __preview } (same as platform_apps.*).
  if (val && typeof val === 'object' && '__enc' in (val as object)) {
    const enc = (val as { __enc?: unknown }).__enc;
    if (typeof enc !== 'string' || !enc) return null;
    try {
      const masterKey = loadMasterKey(process.env.MASTER_KEY);
      const parsed = JSON.parse(decryptSecret(enc, masterKey)) as { apiKey?: unknown };
      if (typeof parsed.apiKey === 'string' && parsed.apiKey.trim()) {
        return parsed.apiKey.trim();
      }
    } catch {
      return null;
    }
    return null;
  }

  if (typeof val === 'string' && val.trim()) return val.trim();
  if (val && typeof val === 'object' && 'apiKey' in (val as object)) {
    const key = (val as { apiKey?: unknown }).apiKey;
    if (typeof key === 'string' && key.trim()) return key.trim();
  }
  return null;
}

interface PlaylistItem {
  snippet: {
    title: string;
    publishedAt: string;
    resourceId: { videoId: string };
  };
}

interface YouTubeVideoItem {
  id: string;
  contentDetails: { duration: string };
  statistics: { viewCount: string };
}

function parseIsoDuration(iso: string): number | null {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0');
}

async function fetchUploadsPlaylistId(apiKey: string, youtubeChannelId: string): Promise<string> {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('id', youtubeChannelId);
  url.searchParams.set('part', 'contentDetails');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`YouTube channels API returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  const uploads = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) {
    throw new Error(`No uploads playlist for channel ${youtubeChannelId}`);
  }
  return uploads;
}

async function fetchPlaylistVideos(
  apiKey: string,
  uploadsPlaylistId: string,
): Promise<PlaylistItem[]> {
  const items: PlaylistItem[] = [];
  let pageToken: string | undefined;

  while (items.length < MAX_VIDEOS_PER_POLL) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('playlistId', uploadsPlaylistId);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('maxResults', String(Math.min(PAGE_SIZE, MAX_VIDEOS_PER_POLL - items.length)));
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`YouTube playlistItems API returned ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      items?: PlaylistItem[];
      nextPageToken?: string;
    };

    for (const item of data.items ?? []) {
      if (item.snippet?.resourceId?.videoId) items.push(item);
      if (items.length >= MAX_VIDEOS_PER_POLL) break;
    }

    if (!data.nextPageToken || items.length >= MAX_VIDEOS_PER_POLL) break;
    pageToken = data.nextPageToken;
  }

  return items;
}

async function fetchVideoDetails(
  apiKey: string,
  videoIds: string[],
): Promise<Map<string, YouTubeVideoItem>> {
  const detailsMap = new Map<string, YouTubeVideoItem>();
  for (let i = 0; i < videoIds.length; i += PAGE_SIZE) {
    const batch = videoIds.slice(i, i + PAGE_SIZE);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('part', 'contentDetails,statistics');

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`YouTube videos API returned ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { items?: YouTubeVideoItem[] };
    for (const v of data.items ?? []) detailsMap.set(v.id, v);
  }
  return detailsMap;
}

export async function runCompetitorPoll(competitorChannelId: string, boss: PgBoss): Promise<void> {
  const prisma = getPrisma();

  const channel = await prisma.competitorChannel.findUnique({
    where: { id: competitorChannelId },
  });
  if (!channel || channel.deletedAt || channel.status !== 'ACTIVE') {
    console.log(`[worker:competitor] channel ${competitorChannelId} not active — skipping`);
    return;
  }

  const apiKey = await getYouTubeApiKey(prisma);
  if (!apiKey) {
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      title: `Competitor poll skipped: YouTube Data API key not configured`,
      detail: { competitorChannelId, channelName: channel.name },
    });
    console.warn(`[worker:competitor] YouTube API key not configured — skipping poll for ${channel.name}`);
    return;
  }

  try {
    const uploadsPlaylistId = await fetchUploadsPlaylistId(apiKey, channel.youtubeChannelId);
    const items = await fetchPlaylistVideos(apiKey, uploadsPlaylistId);

    if (items.length === 0) {
      await prisma.competitorChannel.update({
        where: { id: competitorChannelId },
        data: { lastCheckedAt: new Date(), consecutiveFailures: 0 },
      });
      console.log(`[worker:competitor] ${channel.name}: no videos found`);
      return;
    }

    const videoIds = items.map((i) => i.snippet.resourceId.videoId);
    const detailsMap = await fetchVideoDetails(apiKey, videoIds);

    let upserted = 0;
    for (const item of items) {
      const videoId = item.snippet.resourceId.videoId;
      const details = detailsMap.get(videoId);

      await prisma.competitorVideo.upsert({
        where: {
          competitorChannelId_videoId: { competitorChannelId, videoId },
        },
        create: {
          competitorChannelId,
          videoId,
          title: item.snippet.title,
          views: BigInt(details?.statistics?.viewCount ?? '0'),
          publishedAt: new Date(item.snippet.publishedAt),
          durationSec: details ? parseIsoDuration(details.contentDetails.duration) : null,
          transcriptSource: 'NONE',
        },
        update: {
          title: item.snippet.title,
          views: BigInt(details?.statistics?.viewCount ?? '0'),
        },
      });
      upserted++;
    }

    await prisma.competitorChannel.update({
      where: { id: competitorChannelId },
      data: { lastCheckedAt: new Date(), consecutiveFailures: 0 },
    });

    console.log(
      `[worker:competitor] ${channel.name}: upserted ${upserted} video(s)` +
        (upserted >= MAX_VIDEOS_PER_POLL ? ` (capped at ${MAX_VIDEOS_PER_POLL})` : ''),
    );

    // Refresh channel performance memory after successful poll (skips if fingerprint unchanged).
    try {
      await boss.send(
        QUEUE.AI,
        { kind: 'competitor_performance', competitorChannelId, force: false },
        { singletonKey: `comp-perf-${competitorChannelId}` },
      );
    } catch (enqueueErr) {
      console.warn(
        `[worker:competitor] failed to enqueue performance analysis for ${channel.name}:`,
        enqueueErr instanceof Error ? enqueueErr.message : enqueueErr,
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker:competitor] poll failed for ${channel.name}:`, errMsg);

    const failures = channel.consecutiveFailures + 1;
    const autoPause = failures >= FAILURE_THRESHOLD;

    await prisma.competitorChannel.update({
      where: { id: competitorChannelId },
      data: {
        consecutiveFailures: failures,
        lastCheckedAt: new Date(),
        ...(autoPause ? { status: 'ERROR', errorNote: errMsg.slice(0, 500) } : {}),
      },
    });

    if (autoPause) {
      await raiseIncident(prisma, {
        kind: 'SYSTEM',
        title: `Competitor channel "${channel.name}" auto-paused after ${FAILURE_THRESHOLD} failures`,
        detail: { competitorChannelId, lastError: errMsg },
      });
    }
  }
}
