import { z } from 'zod';

/**
 * content_items state machine (docs/03 Domain 4, docs/04 §1).
 * Main path plus side exits REJECTED / DRAFT / FAILED.
 */
export const ContentStatus = {
  INGESTED: 'INGESTED',
  REVIEW_PENDING: 'REVIEW_PENDING',
  APPROVED: 'APPROVED',
  ANALYZING: 'ANALYZING',
  SCRIPT_READY: 'SCRIPT_READY',
  SCRIPT_APPROVED: 'SCRIPT_APPROVED',
  TTS_DONE: 'TTS_DONE',
  RENDERED: 'RENDERED',
  METADATA_READY: 'METADATA_READY',
  SCHEDULED: 'SCHEDULED',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  // Side exits
  DRAFT: 'DRAFT',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];

export const ContentStatusSchema = z.enum([
  'INGESTED',
  'REVIEW_PENDING',
  'APPROVED',
  'ANALYZING',
  'SCRIPT_READY',
  'SCRIPT_APPROVED',
  'TTS_DONE',
  'RENDERED',
  'METADATA_READY',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'DRAFT',
  'REJECTED',
  'FAILED',
]);

/**
 * Allowed forward transitions on the happy path plus side exits.
 * State machine is enforced in the API service layer (docs/03 cross-cutting),
 * this map is the shared reference. TODO(task#7+): wire into a transition guard.
 */
export const CONTENT_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  INGESTED: ['REVIEW_PENDING', 'FAILED'],
  REVIEW_PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['ANALYZING', 'FAILED'],
  ANALYZING: ['SCRIPT_READY', 'FAILED'],
  SCRIPT_READY: ['SCRIPT_APPROVED', 'REJECTED', 'FAILED'],
  SCRIPT_APPROVED: ['TTS_DONE', 'FAILED'],
  TTS_DONE: ['RENDERED', 'FAILED'],
  RENDERED: ['METADATA_READY', 'FAILED'],
  METADATA_READY: ['SCHEDULED', 'FAILED'],
  SCHEDULED: ['PUBLISHING', 'DRAFT', 'FAILED'],
  PUBLISHING: ['PUBLISHED', 'DRAFT', 'FAILED'],
  PUBLISHED: [],
  DRAFT: ['SCHEDULED', 'REJECTED'],
  REJECTED: [],
  FAILED: ['DRAFT'],
};
