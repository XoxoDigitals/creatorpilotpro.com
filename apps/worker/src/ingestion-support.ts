/**
 * Shared helpers for the ingestion processors (docs/04 §1–3): map a watched-source
 * row to a source adapter, and build hot-tier paths for downloaded/processed media.
 * Reuses the incident/notify/prisma helpers from publish-support so the two
 * pipelines stay consistent.
 */
import { join } from 'node:path';
import {
  KuaishouAdapter,
  GenericUrlAdapter,
  type SourceAdapter,
  type WatchedSource as AdapterSource,
} from '@scp/source-adapters';

/** A watched_sources row projected to the adapter's WatchedSource shape. */
export interface WatchedSourceRow {
  id: string;
  type: 'KUAISHOU_PROFILE' | 'GENERIC_URL';
  url: string;
  label: string | null;
  trimStartMs: number;
}

/** Build the source adapter for a watched-source type (docs/04 §1). */
export function buildSourceAdapter(type: WatchedSourceRow['type']): SourceAdapter {
  return type === 'KUAISHOU_PROFILE' ? new KuaishouAdapter() : new GenericUrlAdapter();
}

/** Project a watched-source row into the adapter WatchedSource shape. */
export function toAdapterSource(row: WatchedSourceRow): AdapterSource {
  return {
    id: row.id,
    type: row.type,
    url: row.url,
    trimStartMs: row.trimStartMs,
    ...(row.label ? { label: row.label } : {}),
  };
}

/**
 * Hot-tier path for a raw source download, before a ContentItem exists:
 * `{root}/sources/{sourceVideoId}/{filename}`. Processed output lands under the
 * item tree via storage.hotTierPath once the ContentItem is created.
 */
export function sourceHotPath(root: string, sourceVideoId: string, filename: string): string {
  return join(root, 'sources', sourceVideoId, filename);
}

export {
  getPrisma,
  getMasterKey,
  raiseIncident,
  notifyOwnersAdmins,
  type PrismaClient,
} from './publish-support.js';
