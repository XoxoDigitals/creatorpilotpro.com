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

/** How the account publishes: through PostQued, or the owner's own platform app. */
export type ConnectionMethod = 'POSTQUED' | 'OWN_APP' | 'MANUAL';

export type HealthStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

/** Connection/token state surfaced by the health monitor (FR-A4). */
export type ConnectionStatus = 'CONNECTED' | 'EXPIRING' | 'DISCONNECTED';

export interface Account {
  id: string;
  name: string;
  handle: string;
  platform: Platform;
  contentType: ContentType;
  connectionMethod: ConnectionMethod;
  /** Owner-controlled toggle (wizard or account settings) — independent of contentType. */
  dramasEnabled: boolean;
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
  /** Content item that owns the final video / thumbnail assets. */
  contentItemId: string;
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
  /** Package / publish description when available. */
  description: string | null;
  /** Publish tags when available. */
  tags?: string[];
  submittedAt: string;
  status: ReviewStatus;
  sourceUrl: string | null;
  rightsNote: string | null;
  durationSec: number | null;
  /** For ingested items: the source video the rights note attaches to (docs/04 §3). */
  sourceVideoId: string | null;
  /** True when a stored thumbnail can be previewed via contentThumbnailUrl / embed. */
  hasThumbnail: boolean;
  /** Google Drive preview iframe URL when the video is archived to Drive. */
  videoEmbedUrl?: string | null;
  /** Google Drive preview iframe URL when the thumbnail is archived to Drive. */
  thumbnailEmbedUrl?: string | null;
  /** Earliest held/scheduled publish slot ISO timestamp, if any. */
  scheduledAt: string | null;
}

export type IdeaStage =
  'SUGGESTED' | 'APPROVED' | 'REJECTED' | 'IN_PRODUCTION' | 'UPLOADED' | 'PUBLISHED';
export type IdeaCategory = 'RELEVANT' | 'SIMILAR' | 'UNIQUE';
export type PackageStatus = 'NONE' | 'GENERATING' | 'READY' | 'DONE' | 'FAILED';
export type VoiceoverStatus = 'NONE' | 'GENERATING' | 'READY' | 'FAILED';
export type PackageStage =
  | 'NONE'
  | 'SCRIPT'
  | 'VOICE'
  | 'TRANSCRIPT'
  | 'VISUALS'
  | 'READY'
  | 'FAILED';

/** Mirrors the API ContentItemStatus enum; only the late states matter to the UI. */
export type ContentItemStatus =
  | 'INGESTED'
  | 'REVIEW_PENDING'
  | 'APPROVED'
  | 'ANALYZING'
  | 'SCRIPT_READY'
  | 'SCRIPT_APPROVED'
  | 'TTS_DONE'
  | 'RENDERED'
  | 'METADATA_READY'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'DRAFT'
  | 'REJECTED'
  | 'FAILED';

export interface TimedTranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Idea {
  id: string;
  accountId: string;
  title: string;
  angle: string;
  hook: string;
  rationale: string;
  category: IdeaCategory | null;
  stage: IdeaStage;
  packageStatus: PackageStatus;
  packageStage: PackageStage | null;
  packageStageError: string | null;
  packageStageLabel: string | null;
  requestedVideoDurationSec: number | null;
  requestedClipDurationSec: number | null;
  rejectionReason: string | null;
  decidedAt: string | null;
  /** 0–100 viral potential from idea generation. */
  viralScore: number | null;
  /** @deprecated use viralScore */
  predictedScore: number;
  createdAt: string;
  hasBrief: boolean;
  hasFinalVideo: boolean;
  hasThumbnail: boolean;
  /** Content item the final video + thumbnail attach to, once one exists. */
  contentItemId: string | null;
  /** Status of that content item; drives the scheduled/published header tags. */
  contentStatus: ContentItemStatus | null;
  /** Earliest pending publish slot for the linked content item. */
  scheduledAt: string | null;
  /** Most recent successful publish for the linked content item. */
  publishedAt: string | null;
  voiceoverStatus: VoiceoverStatus | null;
  voiceoverReady: boolean;
  brief: ProductionBrief | null;
}

export interface ProductionBrief {
  id: string;
  ideaId: string;
  researchSummary: string;
  storySummary: string;
  script: string;
  narrationScript: string;
  presentationMode: string;
  sceneBreakdown: ProductionScene[];
  characterPrompts: CharacterPrompt[];
  editingInstructions: string;
  targetDurationSec: number | null;
  videoTitle: string;
  videoDescription: string;
  thumbnailPrompt: string;
  thumbnailNegativePrompt: string;
  /** Locked STATE 8 animation template when documentary collage engine is active. */
  universalVideoPrompt: string;
  /** Optional alternate collage thumbnail prompts (blank-line separated). */
  thumbnailPromptVariants: string;
  voiceoverStatus: VoiceoverStatus;
  voiceoverReady: boolean;
  packageStage: PackageStage;
  packageStageError: string | null;
  packageStageLabel: string;
  timedTranscript: TimedTranscriptSegment[];
  transcriptReady: boolean;
  voiceIdUsed: string | null;
  version: number;
}

export interface DialogueLine {
  speaker: string;
  line: string;
}

export interface ProductionScene {
  sceneIndex: number;
  durationSec: number | null;
  startMs: number | null;
  endMs: number | null;
  narrationSegment: string;
  imagePrompt: string;
  animationPrompt: string;
  /** Still-image avoid list (embedded in imagePrompt). */
  negativePrompt: string;
  /** Video/animation avoid list (embedded in animationPrompt). */
  animationNegativePrompt: string;
  dialogue: DialogueLine[];
}

export interface CharacterPrompt {
  name: string;
  appearance: string;
  wardrobe: string;
  age: string;
  personality: string;
  consistencyDetails: string;
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

export type DramaStatus =
  'PLANNING' | 'BIBLE_GENERATING' | 'BIBLE_READY' | 'IN_PRODUCTION' | 'COMPLETE' | 'FAILED';

export interface DramaSeries {
  id: string;
  accountId: string;
  title: string;
  genre: string;
  theme: string;
  audience: string;
  episodes: number;
  producedEpisodes: number;
  episodeDurationSec: number;
  seriesBible: unknown | null;
  characterSheets: unknown[];
  status: DramaStatus;
  createdAt: string;
}

export type DramaEpisodeStatus =
  'PENDING' | 'GENERATING' | 'GENERATED' | 'IN_PRODUCTION' | 'UPLOADED' | 'PUBLISHED' | 'FAILED';

export interface DramaEpisode {
  id: string;
  seriesId: string;
  number: number;
  summary: string | null;
  script: string | null;
  scenePrompts: unknown[];
  narration: string | null;
  productionNotes: string | null;
  status: DramaEpisodeStatus;
  generatedAt: string | null;
}

export interface CompetitorChannel {
  id: string;
  ownAccountId: string;
  youtubeChannelId: string;
  channelUrl: string | null;
  name: string;
  role: 'COMPETITOR' | 'SOURCE';
  checkIntervalMin: number;
  status: 'ACTIVE' | 'PAUSED' | 'ERROR';
  lastCheckedAt: string | null;
  videoCount: number;
  errorNote: string | null;
  performanceAnalyzedAt: string | null;
  performanceInsights: CompetitorPerformanceInsights | null;
}

export interface CompetitorPerformanceInsights {
  summary: string;
  winningTopics: string[];
  winningHooks: string[];
  avoidPatterns: string[];
  topExamples: Array<{ title: string; views: number }>;
  sampleSize: number;
  analyzedAt: string;
  aiAvailable: boolean;
}

export interface CompetitorVideo {
  id: string;
  videoId: string;
  title: string;
  views: number;
  publishedAt: string | null;
  durationSec: number | null;
  transcriptSource: string;
}

export type IncidentKind = 'AUTH' | 'RATE_LIMIT' | 'COPYRIGHT' | 'PUBLISH_ERROR' | 'POLICY';
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type IncidentStatus = 'OPEN' | 'ACKED' | 'RESOLVED';

export interface Incident {
  id: string;
  accountId: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  detail: string;
  /** False when Retry cannot re-queue anything (show Mark resolved only). */
  retryable: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export type TaskStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'UPLOADED' | 'REVISION_REQUESTED' | 'DONE';

export interface WorkerTask {
  id: string;
  accountId: string;
  title: string;
  assignee: string;
  assigneeId: string;
  status: TaskStatus;
  assignedAt: string;
  uploadedAt: string | null;
  dueAt: string | null;
  briefId: string | null;
  episodeId: string | null;
  revisionNotes: string[];
}

/**
 * Which tabs an account's contentType unlocks (docs/11 §1 table).
 * Ideas is AI-pipeline only; Dramas is a separate per-account toggle
 * (`account.dramasEnabled`), not derived from contentType.
 */
export const TAB_VISIBILITY: Record<ContentType, { sources: boolean; ideas: boolean }> = {
  AI: { sources: false, ideas: true },
  REPURPOSED: { sources: true, ideas: false },
  MIXED: { sources: true, ideas: true },
};
