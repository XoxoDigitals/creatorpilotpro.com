/**
 * Domain view types for the account-centric UI (docs/11-UI-DESIGN.md §4).
 *
 * These interfaces are the contract the Phase 1 API client will satisfy. The
 * mock layer (`mock-data.ts`) produces values shaped exactly like these, so
 * swapping the mock for real fetches is mechanical — no type or component change.
 */

export type Platform = 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK';

/** Chosen at connect time; decides which workspace tabs an account exposes. */
export type ContentType = 'AI' | 'REPURPOSED' | 'MIXED';

export type HealthStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

/** Connection/token state surfaced by the health monitor (FR-A4). */
export type ConnectionStatus = 'CONNECTED' | 'EXPIRING' | 'DISCONNECTED';

export interface Account {
  id: string;
  name: string;
  handle: string;
  platform: Platform;
  contentType: ContentType;
  /** null → render initials avatar. */
  avatarUrl: string | null;
  health: HealthStatus;
  connection: ConnectionStatus;
  /** ISO timestamp; null when not applicable. Drives the expiry countdown. */
  tokenExpiresAt: string | null;
  followers: number;
  views30d: number;
  scheduledCount: number;
  openIncidents: number;
  monetized: boolean;
  paused: boolean;
  createdAt: string;
}

export type PostStatus = 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED';

export interface Post {
  id: string;
  accountId: string;
  title: string;
  status: PostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  views: number | null;
  /** Tailwind hue used for the thumbnail placeholder chip. */
  accent: string;
}

export type ReviewKind = 'INGESTED_VIDEO' | 'PRODUCED_VIDEO' | 'IDEA' | 'METADATA';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ReviewItem {
  id: string;
  accountId: string;
  kind: ReviewKind;
  title: string;
  submittedAt: string;
  status: ReviewStatus;
  sourceUrl: string | null;
  rightsNote: string | null;
  durationSec: number | null;
}

export type IdeaStage = 'SUGGESTED' | 'APPROVED' | 'IN_PRODUCTION' | 'UPLOADED' | 'PUBLISHED';

export interface Idea {
  id: string;
  accountId: string;
  title: string;
  angle: string;
  hook: string;
  stage: IdeaStage;
  /** 0–100 predicted-performance heuristic from idea generation (FR-D2). */
  predictedScore: number;
  createdAt: string;
}

export type SourceType = 'WATCHED_PROFILE' | 'BULK_IMPORT';
export type SourceStatus = 'ACTIVE' | 'ERROR' | 'PAUSED';

export interface Source {
  id: string;
  accountId: string;
  type: SourceType;
  url: string;
  label: string;
  checkIntervalHours: number;
  lastCheckedAt: string | null;
  newItems: number;
  status: SourceStatus;
}

export type DramaStatus = 'PLANNING' | 'IN_PRODUCTION' | 'PUBLISHING' | 'COMPLETE';

export interface DramaSeries {
  id: string;
  accountId: string;
  title: string;
  genre: string;
  episodes: number;
  producedEpisodes: number;
  status: DramaStatus;
  createdAt: string;
}

export type IncidentKind = 'AUTH' | 'RATE_LIMIT' | 'COPYRIGHT' | 'PUBLISH_ERROR' | 'POLICY';
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type IncidentStatus = 'OPEN' | 'RESOLVED';

export interface Incident {
  id: string;
  accountId: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  detail: string;
  createdAt: string;
  resolvedAt: string | null;
}

export type TaskStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'DONE';

export interface WorkerTask {
  id: string;
  accountId: string;
  title: string;
  assignee: string;
  status: TaskStatus;
  assignedAt: string;
  dueAt: string | null;
}

/** Which tabs an account's contentType unlocks (docs/11 §1 table). */
export const TAB_VISIBILITY: Record<
  ContentType,
  { sources: boolean; ideas: boolean; dramas: boolean }
> = {
  AI: { sources: false, ideas: true, dramas: true },
  REPURPOSED: { sources: true, ideas: false, dramas: false },
  MIXED: { sources: true, ideas: true, dramas: true },
};
