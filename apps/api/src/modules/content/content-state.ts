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
  APPROVED: ['ANALYZING', 'SCHEDULED', 'REJECTED'],
  ANALYZING: ['SCRIPT_READY', 'FAILED'],
  SCRIPT_READY: ['SCRIPT_APPROVED', 'REJECTED'],
  SCRIPT_APPROVED: ['TTS_DONE', 'FAILED'],
  TTS_DONE: ['RENDERED', 'FAILED'],
  RENDERED: ['METADATA_READY', 'FAILED'],
  METADATA_READY: ['SCHEDULED', 'FAILED'],
  SCHEDULED: ['PUBLISHING', 'DRAFT', 'REJECTED'],
  PUBLISHING: ['PUBLISHED', 'DRAFT', 'FAILED'],
  PUBLISHED: [],
  DRAFT: ['SCHEDULED', 'REJECTED'],
  REJECTED: [],
  FAILED: ['SCHEDULED', 'REJECTED'],
};

export function canTransition(from: ContentItemStatus, to: ContentItemStatus): boolean {
  return from === to || (ALLOWED_TRANSITIONS[from]?.includes(to) ?? false);
}

export function assertTransition(from: ContentItemStatus, to: ContentItemStatus): void {
  if (!canTransition(from, to)) {
    throw new BadRequestException(`Illegal content transition: ${from} → ${to}`);
  }
}
