import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { assertTransition, canTransition } from './content-state';

describe('content state machine', () => {
  it('allows documented forward edges', () => {
    expect(canTransition('REVIEW_PENDING', 'APPROVED')).toBe(true);
    expect(canTransition('REVIEW_PENDING', 'REJECTED')).toBe(true);
    expect(canTransition('APPROVED', 'SCHEDULED')).toBe(true);
    expect(canTransition('SCHEDULED', 'PUBLISHING')).toBe(true);
    expect(canTransition('PUBLISHING', 'PUBLISHED')).toBe(true);
    expect(canTransition('PUBLISHING', 'DRAFT')).toBe(true);
    expect(canTransition('DRAFT', 'SCHEDULED')).toBe(true);
  });

  it('treats a no-op transition (from === to) as allowed', () => {
    expect(canTransition('APPROVED', 'APPROVED')).toBe(true);
  });

  it('rejects illegal edges', () => {
    expect(canTransition('REJECTED', 'APPROVED')).toBe(false);
    expect(canTransition('PUBLISHED', 'SCHEDULED')).toBe(false);
    expect(canTransition('REVIEW_PENDING', 'PUBLISHED')).toBe(false);
  });

  it('assertTransition throws a 400 on an illegal edge', () => {
    expect(() => assertTransition('REJECTED', 'APPROVED')).toThrow(BadRequestException);
    expect(() => assertTransition('APPROVED', 'SCHEDULED')).not.toThrow();
  });
});
