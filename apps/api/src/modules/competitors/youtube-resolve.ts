/**
 * Resolve a YouTube channel from a pasted URL, @handle, or raw channel ID
 * via the YouTube Data API (same key as competitor polling).
 */
import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@scp/db';
import { decryptSecret, loadMasterKey } from '../../common/crypto/crypto.util';

export interface ResolvedYouTubeChannel {
  youtubeChannelId: string;
  name: string;
  channelUrl: string;
}

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

/** Normalize pasted input into a handle, UC… id, or channel path fragment. */
export function parseYouTubeChannelInput(raw: string): {
  kind: 'id' | 'handle' | 'username' | 'custom';
  value: string;
  channelUrl: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) throw new BadRequestException('Provide a YouTube channel URL or @handle.');

  // Raw channel ID
  if (/^UC[\w-]{20,}$/.test(trimmed)) {
    return {
      kind: 'id',
      value: trimmed,
      channelUrl: `https://www.youtube.com/channel/${trimmed}`,
    };
  }

  // Bare @handle
  if (/^@[\w.-]+$/.test(trimmed)) {
    return {
      kind: 'handle',
      value: trimmed.slice(1),
      channelUrl: `https://www.youtube.com/@${trimmed.slice(1)}`,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    // Treat as handle without @
    if (/^[\w.-]+$/.test(trimmed)) {
      return {
        kind: 'handle',
        value: trimmed,
        channelUrl: `https://www.youtube.com/@${trimmed}`,
      };
    }
    throw new BadRequestException('Could not parse YouTube channel URL or handle.');
  }

  if (!/(^|\.)youtube\.com$/.test(url.hostname) && url.hostname !== 'youtu.be') {
    throw new BadRequestException('Only YouTube channel URLs are supported.');
  }

  const path = url.pathname.replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);

  if (parts[0] === 'channel' && parts[1] && /^UC[\w-]{20,}$/.test(parts[1])) {
    return {
      kind: 'id',
      value: parts[1],
      channelUrl: `https://www.youtube.com/channel/${parts[1]}`,
    };
  }
  if (parts[0]?.startsWith('@')) {
    return {
      kind: 'handle',
      value: parts[0].slice(1),
      channelUrl: `https://www.youtube.com/@${parts[0].slice(1)}`,
    };
  }
  if (parts[0] === 'c' && parts[1]) {
    return {
      kind: 'custom',
      value: parts[1],
      channelUrl: `https://www.youtube.com/c/${parts[1]}`,
    };
  }
  if (parts[0] === 'user' && parts[1]) {
    return {
      kind: 'username',
      value: parts[1],
      channelUrl: `https://www.youtube.com/user/${parts[1]}`,
    };
  }
  if (parts.length === 1 && parts[0]) {
    return {
      kind: 'handle',
      value: parts[0].replace(/^@/, ''),
      channelUrl: `https://www.youtube.com/@${parts[0].replace(/^@/, '')}`,
    };
  }

  throw new BadRequestException('Could not parse YouTube channel URL or handle.');
}

export async function resolveYouTubeChannel(
  prisma: PrismaClient,
  raw: string,
): Promise<ResolvedYouTubeChannel> {
  const parsed = parseYouTubeChannelInput(raw);
  const apiKey = await getYouTubeApiKey(prisma);
  if (!apiKey) {
    throw new BadRequestException(
      'YouTube Data API key is not configured (system setting youtubeDataApiKey or YOUTUBE_DATA_API_KEY).',
    );
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('part', 'snippet');

  if (parsed.kind === 'id') {
    url.searchParams.set('id', parsed.value);
  } else if (parsed.kind === 'handle') {
    url.searchParams.set('forHandle', parsed.value);
  } else if (parsed.kind === 'username') {
    url.searchParams.set('forUsername', parsed.value);
  } else {
    // Custom /c/ URLs: search then resolve first channel result
    const search = new URL('https://www.googleapis.com/youtube/v3/search');
    search.searchParams.set('key', apiKey);
    search.searchParams.set('part', 'snippet');
    search.searchParams.set('type', 'channel');
    search.searchParams.set('q', parsed.value);
    search.searchParams.set('maxResults', '1');
    const searchRes = await fetch(search.toString());
    if (!searchRes.ok) {
      throw new BadRequestException(`YouTube API search failed (${searchRes.status}).`);
    }
    const searchBody = (await searchRes.json()) as {
      items?: Array<{ snippet?: { channelId?: string; title?: string } }>;
    };
    const hit = searchBody.items?.[0]?.snippet;
    if (!hit?.channelId) {
      throw new BadRequestException('No YouTube channel found for that URL.');
    }
    return {
      youtubeChannelId: hit.channelId,
      name: hit.title ?? parsed.value,
      channelUrl: parsed.channelUrl,
    };
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new BadRequestException(`YouTube API lookup failed (${res.status}).`);
  }
  const body = (await res.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string } }>;
  };
  const item = body.items?.[0];
  if (!item?.id) {
    throw new BadRequestException('No YouTube channel found for that URL or handle.');
  }
  return {
    youtubeChannelId: item.id,
    name: item.snippet?.title ?? parsed.value,
    channelUrl: parsed.channelUrl,
  };
}
