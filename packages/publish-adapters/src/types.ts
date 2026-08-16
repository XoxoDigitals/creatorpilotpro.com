export type Platform = 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK';

/** A publish_targets row projection passed to an adapter (docs/03 Domain 4). */
export interface PublishTarget {
  id: string;
  contentItemId: string;
  accountId: string;
  platform: Platform;
  /** Decrypted platform auth payload (OAuth tokens / PostQued ref). */
  auth: Record<string, unknown>;
  scheduledAt?: Date | null;
}

export interface LocalFile {
  path: string;
  bytes: number;
  mimeType: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

/** Final per-account metadata resolved from the Channel Profile templates. */
export interface ResolvedMetadata {
  title: string;
  description: string;
  tags: string[];
  keywords?: string[];
  /** YouTube categoryId (e.g. "22" People & Blogs). */
  category?: string;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  aiLabel?: boolean;
  /** Local path to a custom thumbnail image (YouTube thumbnails.set). */
  thumbnailPath?: string;
  /** YouTube status.selfDeclaredMadeForKids. */
  madeForKids?: boolean;
  /** YouTube snippet.defaultLanguage (BCP-47 / ISO 639-1). */
  defaultLanguage?: string;
  /** YouTube snippet.defaultAudioLanguage. */
  defaultAudioLanguage?: string;
  /** Recording / video location country (ISO 3166-1 alpha-2) → recordingDetails. */
  recordingCountry?: string;
}

export interface PlatformIssue {
  code: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'BLOCK';
}

export interface PlatformConstraints {
  maxDurationSec: number;
  maxBytes: number;
  maxTitleLength: number;
  maxTags: number;
  allowedFormats: string[];
}

/** Publisher adapter interface (docs/06 §1). Metadata validated vs getConstraints() before upload. */
export interface PublishAdapter {
  platform: Platform;
  publish(
    target: PublishTarget,
    media: LocalFile,
    meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }>;
  verify(platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }>;
  updateMetadata?(postId: string, meta: ResolvedMetadata): Promise<void>;
  delete?(postId: string): Promise<void>;
  getConstraints(): PlatformConstraints;
}
