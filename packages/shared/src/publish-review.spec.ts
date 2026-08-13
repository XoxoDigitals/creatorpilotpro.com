import { describe, expect, it } from 'vitest';
import {
  hasPublishReadyAiMetadata,
  isPublishReviewApproved,
  withPublishReviewApproved,
} from './publish-review.js';

describe('publish-review helpers', () => {
  it('detects the approval stamp', () => {
    expect(isPublishReviewApproved(undefined)).toBe(false);
    expect(isPublishReviewApproved({})).toBe(false);
    expect(isPublishReviewApproved({ publishReviewApproved: true })).toBe(true);
  });

  it('detects AI metadata readiness', () => {
    expect(hasPublishReadyAiMetadata({})).toBe(false);
    expect(hasPublishReadyAiMetadata({ metadata: { title: 'Hi' } })).toBe(true);
    expect(hasPublishReadyAiMetadata({ title: 'Flat title' })).toBe(true);
  });

  it('stamps without wiping prior step data', () => {
    const next = withPublishReviewApproved({ script: 'hello', metadata: { title: 'T' } });
    expect(next.publishReviewApproved).toBe(true);
    expect(next.script).toBe('hello');
    expect(next.metadata).toEqual({ title: 'T' });
  });
});
