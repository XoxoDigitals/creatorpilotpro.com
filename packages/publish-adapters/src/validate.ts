import type {
  LocalFile,
  PlatformConstraints,
  PlatformIssue,
  ResolvedMetadata,
} from './types.js';

/** Derive a lowercase format token from the file extension, falling back to the MIME subtype. */
function detectFormat(media: LocalFile): string {
  const extMatch = /\.([a-z0-9]+)$/i.exec(media.path);
  if (extMatch?.[1]) return extMatch[1].toLowerCase();
  const slash = media.mimeType.indexOf('/');
  return slash >= 0 ? media.mimeType.slice(slash + 1).toLowerCase() : media.mimeType.toLowerCase();
}

/**
 * Pure fail-fast metadata/media validation against a platform's {@link PlatformConstraints}.
 *
 * Belongs to the CALLER (worker/API preflight), NOT the adapter — the adapter assumes
 * validated input (docs/06 §1: "Metadata is validated against getConstraints() before upload").
 * Returns every violation as a {@link PlatformIssue}; a non-empty BLOCK list should stop the upload.
 */
export function validateMetadata(
  meta: ResolvedMetadata,
  media: LocalFile,
  c: PlatformConstraints,
): PlatformIssue[] {
  const issues: PlatformIssue[] = [];

  if (!meta.title || meta.title.trim().length === 0) {
    issues.push({ code: 'title-missing', message: 'Title is required.', severity: 'BLOCK' });
  } else if (meta.title.length > c.maxTitleLength) {
    issues.push({
      code: 'title-too-long',
      message: `Title is ${meta.title.length} chars; max is ${c.maxTitleLength}.`,
      severity: 'BLOCK',
    });
  }

  if (meta.tags.length > c.maxTags) {
    issues.push({
      code: 'too-many-tags',
      message: `${meta.tags.length} tags provided; max is ${c.maxTags}.`,
      severity: 'BLOCK',
    });
  }

  if (media.bytes > c.maxBytes) {
    issues.push({
      code: 'file-too-large',
      message: `File is ${media.bytes} bytes; max is ${c.maxBytes}.`,
      severity: 'BLOCK',
    });
  }

  if (media.durationSec !== undefined && media.durationSec > c.maxDurationSec) {
    issues.push({
      code: 'duration-too-long',
      message: `Media is ${media.durationSec}s; max is ${c.maxDurationSec}s.`,
      severity: 'BLOCK',
    });
  }

  const format = detectFormat(media);
  if (c.allowedFormats.length > 0 && !c.allowedFormats.includes(format)) {
    issues.push({
      code: 'format-unsupported',
      message: `Format "${format}" is not allowed. Allowed: ${c.allowedFormats.join(', ')}.`,
      severity: 'BLOCK',
    });
  }

  return issues;
}
