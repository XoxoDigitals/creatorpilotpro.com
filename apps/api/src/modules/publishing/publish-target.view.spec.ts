import { describe, expect, it } from 'vitest';
import { resolveTargetCopy } from './publish-target.view';

describe('resolveTargetCopy', () => {
  const contentTitle = 'Untitled source video';
  const aiStep = {
    metadata: {
      title: 'Building the Ultimate Desktop Mini Hot Pot',
      description: 'Watch us assemble a desktop mini hot pot.',
      tags: ['mini hot pot', 'foodasmr'],
      keywords: ['portable hot pot'],
    },
  };

  it('prefers override title/description/tags when present', () => {
    const copy = resolveTargetCopy(
      {
        title: 'Override title',
        description: 'Override description',
        tags: ['override-tag'],
      },
      aiStep,
      contentTitle,
    );
    expect(copy).toEqual({
      title: 'Override title',
      description: 'Override description',
      tags: ['override-tag'],
    });
  });

  it('falls back to AI metadata when override is empty', () => {
    const copy = resolveTargetCopy({}, aiStep, contentTitle);
    expect(copy.title).toBe('Building the Ultimate Desktop Mini Hot Pot');
    expect(copy.description).toBe('Watch us assemble a desktop mini hot pot.');
    expect(copy.tags).toEqual(['mini hot pot', 'foodasmr']);
  });

  it('ignores override title that only echoes content.title so AI title wins', () => {
    const copy = resolveTargetCopy(
      { title: contentTitle },
      aiStep,
      contentTitle,
    );
    expect(copy.title).toBe('Building the Ultimate Desktop Mini Hot Pot');
    expect(copy.description).toBe('Watch us assemble a desktop mini hot pot.');
    expect(copy.tags).toEqual(['mini hot pot', 'foodasmr']);
  });

  it('parses stringified currentStep.metadata', () => {
    const copy = resolveTargetCopy(
      {},
      { metadata: JSON.stringify(aiStep.metadata) },
      contentTitle,
    );
    expect(copy.title).toBe('Building the Ultimate Desktop Mini Hot Pot');
    expect(copy.description).toContain('desktop mini hot pot');
    expect(copy.tags).toEqual(['mini hot pot', 'foodasmr']);
  });

  it('falls back to keywords when tags are missing', () => {
    const copy = resolveTargetCopy(
      {},
      { metadata: { title: 'T', description: 'D', keywords: ['kw1', 'kw2'] } },
      contentTitle,
    );
    expect(copy.tags).toEqual(['kw1', 'kw2']);
  });
});
