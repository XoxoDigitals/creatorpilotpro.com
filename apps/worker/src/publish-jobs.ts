/**
 * Shared publish-engine job contract (docs/06 §3–4). Both the API (producer),
 * the dispatcher, and the worker processor use these payload types so a job's
 * shape is defined in exactly one place.
 *
 * All publish-engine jobs ride the single `publish` queue as a discriminated
 * union on `kind`:
 *  - `publish`: dispatch a target now (enqueued with singletonKey = publishTargetId).
 *  - `verify` : post-publish check at +15m / +24h (enqueued with startAfter).
 */

export interface PublishJob {
  kind: 'publish';
  publishTargetId: string;
}

export type VerifyPhase = 'T+15m' | 'T+24h';

export interface VerifyJob {
  kind: 'verify';
  publishTargetId: string;
  platformPostId: string;
  phase: VerifyPhase;
}

export type PublishQueueJob = PublishJob | VerifyJob;

/** Seconds after publish success to run each verify pass (docs/06 §4 step 3). */
export const VERIFY_DELAYS_SEC: Record<VerifyPhase, number> = {
  'T+15m': 15 * 60,
  'T+24h': 24 * 60 * 60,
};

export function isPublishJob(data: unknown): data is PublishJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'publish' &&
    typeof (data as PublishJob).publishTargetId === 'string'
  );
}

export function isVerifyJob(data: unknown): data is VerifyJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'verify' &&
    typeof (data as VerifyJob).publishTargetId === 'string' &&
    typeof (data as VerifyJob).platformPostId === 'string'
  );
}
