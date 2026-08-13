/**
 * Publish-Review gate helpers.
 *
 * Scheduling always parks content in REVIEW_PENDING with PENDING targets until
 * a human Approves. Approve stamps `currentStep.publishReviewApproved` so the
 * dispatcher / worker can tell legitimate SCHEDULED rows from legacy bypasses
 * (e.g. AI “Schedule to publish” that previously skipped Review).
 */

export const PUBLISH_REVIEW_APPROVED_KEY = 'publishReviewApproved' as const;

export function isPublishReviewApproved(currentStep: unknown): boolean {
  if (!currentStep || typeof currentStep !== 'object' || Array.isArray(currentStep)) {
    return false;
  }
  return (currentStep as Record<string, unknown>)[PUBLISH_REVIEW_APPROVED_KEY] === true;
}

/** True when the AI package has metadata (ready for a publish Review pass). */
export function hasPublishReadyAiMetadata(currentStep: unknown): boolean {
  if (!currentStep || typeof currentStep !== 'object' || Array.isArray(currentStep)) {
    return false;
  }
  const step = currentStep as Record<string, unknown>;
  if (step.metadata != null && typeof step.metadata === 'object') return true;
  // Flat metadata written by some update paths / parseStepMetadata consumers.
  if (typeof step.title === 'string' && step.title.trim()) return true;
  if (typeof step.description === 'string' && step.description.trim()) return true;
  return false;
}

export function withPublishReviewApproved(currentStep: unknown): Record<string, unknown> {
  const base =
    currentStep && typeof currentStep === 'object' && !Array.isArray(currentStep)
      ? { ...(currentStep as Record<string, unknown>) }
      : {};
  base[PUBLISH_REVIEW_APPROVED_KEY] = true;
  return base;
}
