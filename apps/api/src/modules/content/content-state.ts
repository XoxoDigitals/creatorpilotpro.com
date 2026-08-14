import { BadRequestException } from '@nestjs/common';
import type { ContentItemStatus } from '@scp/db';

/**
 * Legal content_items state-machine edges (docs/03 Domain 4, docs/04 §4).
 * Enforced in the service layer — illegal transitions are rejected + audited,
 * never silently applied.
 */
export const ALLOWED_TRANSITIONS: Record<ContentItemStatus, ContentItemStatus[]> = {
  INGESTED: ['REVIEW_PENDING', 'APPROVED', 'REJECTED'],
  REVIEW_PENDING: ['APPROVED', 'REJECTED'],
  // APPROVED → REVIEW_PENDING: reviewer withdraws approval before the AI pipeline
  // has produced a script (e.g. wrong video, needs to fix title/rights first).
  APPROVED: ['ANALYZING', 'SCHEDULED', 'REJECTED', 'REVIEW_PENDING'],
  ANALYZING: ['SCRIPT_READY', 'FAILED'],
  SCRIPT_READY: ['SCRIPT_APPROVED', 'REJECTED', 'FAILED', 'REVIEW_PENDING', 'ANALYZING'],
  SCRIPT_APPROVED: ['TTS_DONE', 'FAILED', 'ANALYZING', 'REVIEW_PENDING'],
  TTS_DONE: ['RENDERED', 'FAILED', 'ANALYZING', 'SCRIPT_APPROVED', 'REVIEW_PENDING'],
  // RENDERED / METADATA_READY → REVIEW_PENDING: schedule-to-publish always
  // re-enters the human Review queue before any target may go live.
  // → ANALYZING / SCRIPT_APPROVED: owner regenerate of script / voiceover.
  // → TTS_DONE: re-render with the existing voiceover (mix settings / bed only).
  RENDERED: [
    'METADATA_READY',
    'FAILED',
    'REVIEW_PENDING',
    'ANALYZING',
    'SCRIPT_APPROVED',
    'TTS_DONE',
  ],
  METADATA_READY: [
    'SCHEDULED',
    'FAILED',
    'RENDERED',
    'REVIEW_PENDING',
    'ANALYZING',
    'SCRIPT_APPROVED',
    'TTS_DONE',
  ],
  // SCHEDULED → REVIEW_PENDING: reclaim targets that never had a publish Review.
  SCHEDULED: ['PUBLISHING', 'DRAFT', 'REJECTED', 'REVIEW_PENDING'],
  PUBLISHING: ['PUBLISHED', 'DRAFT', 'FAILED'],
  PUBLISHED: [],
  DRAFT: ['SCHEDULED', 'REJECTED', 'REVIEW_PENDING'],
  REJECTED: [],
  // FAILED → APPROVED / ANALYZING / RENDERED: retry the specific AI step that
  //   failed while preserving `currentStep` so cached outputs re-hit and don't
  //   burn credits (see ContentService.retryAiPipeline).
  // FAILED → SCRIPT_APPROVED: retry TTS after a voiceover failure (Incident center).
  // FAILED → TTS_DONE: retry render when VOICEOVER already exists.
  // FAILED → REVIEW_PENDING: hard reset back to the human gate (clears state);
  //   only use when you want the whole pipeline to run from scratch.
  FAILED: [
    'SCHEDULED',
    'REJECTED',
    'REVIEW_PENDING',
    'APPROVED',
    'ANALYZING',
    'RENDERED',
    'SCRIPT_APPROVED',
    'TTS_DONE',
  ],
};

export function canTransition(from: ContentItemStatus, to: ContentItemStatus): boolean {
  return from === to || (ALLOWED_TRANSITIONS[from]?.includes(to) ?? false);
}

export function assertTransition(from: ContentItemStatus, to: ContentItemStatus): void {
  if (!canTransition(from, to)) {
    throw new BadRequestException(`Illegal content transition: ${from} → ${to}`);
  }
}
