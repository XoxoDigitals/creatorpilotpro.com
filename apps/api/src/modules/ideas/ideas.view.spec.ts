import { describe, expect, it } from 'vitest';
import { displayIdeaTitle, toIdeaView } from './ideas.view';

type IdeaRow = Parameters<typeof toIdeaView>[0];

function ideaRow(overrides: Partial<IdeaRow> = {}): IdeaRow {
  return {
    id: 'idea-1',
    accountId: 'acc-1',
    sourceCompetitorVideoIds: [],
    title: 'A finished package',
    angle: 'angle',
    hook: 'hook',
    rationale: 'rationale',
    topicSummary: 'English summary of what the episode is about.',
    category: 'RELEVANT',
    viralScore: 80,
    status: 'IN_PRODUCTION',
    packageStatus: 'READY',
    requestedVideoDurationSec: 60,
    requestedClipDurationSec: 10,
    rejectionReason: null,
    decidedById: null,
    decidedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    brief: null,
    contentItems: [],
    ...overrides,
  } as IdeaRow;
}

describe('displayIdeaTitle', () => {
  it('keeps plain titles clean and on one line', () => {
    expect(displayIdeaTitle('  A Specific\nTitle   With Extra Spacing  ')).toBe(
      'A Specific Title With Extra Spacing',
    );
  });

  it('recovers a title from fenced model JSON', () => {
    expect(
      displayIdeaTitle(
        '```json\n[{"title":"The Hidden Detail That Changes Everything Overnight"}]\n```',
      ),
    ).toBe('The Hidden Detail That Changes Everything Overnight');
  });

  it('preserves the fallback for malformed legacy rows', () => {
    expect(displayIdeaTitle('```json\n[{"angle":"missing title"}]\n```')).toBe('Untitled Idea');
  });
});

describe('toIdeaView final upload state', () => {
  it('reports no assets and no content item before an upload', () => {
    const view = toIdeaView(ideaRow());
    expect(view.hasFinalVideo).toBe(false);
    expect(view.hasThumbnail).toBe(false);
    expect(view.contentItemId).toBeNull();
  });

  it('exposes the content item holding the final video', () => {
    const view = toIdeaView(
      ideaRow({
        contentItems: [
          { id: 'content-empty', assets: [] },
          {
            id: 'content-final',
            assets: [
              { kind: 'FINAL', localPath: '/hot/final.mp4' },
              { kind: 'THUMBNAIL', localPath: '/hot/thumb.jpg' },
            ],
          },
        ],
      }),
    );
    expect(view.hasFinalVideo).toBe(true);
    expect(view.hasThumbnail).toBe(true);
    expect(view.contentItemId).toBe('content-final');
  });

  it('exposes content status and the earliest pending slot for schedule tags', () => {
    const view = toIdeaView(
      ideaRow({
        contentItems: [
          {
            id: 'content-final',
            status: 'SCHEDULED',
            assets: [{ kind: 'FINAL', localPath: '/hot/final.mp4' }],
            publishTargets: [
              { status: 'SCHEDULED', scheduledAt: new Date('2026-02-02T10:00:00.000Z') },
              { status: 'SCHEDULED', scheduledAt: new Date('2026-02-01T10:00:00.000Z') },
              { status: 'DRAFT', scheduledAt: new Date('2026-01-20T10:00:00.000Z') },
            ],
          },
        ],
      }),
    );
    expect(view.contentStatus).toBe('SCHEDULED');
    expect(view.scheduledAt).toBe('2026-02-01T10:00:00.000Z');
    expect(view.publishedAt).toBeNull();
  });

  it('reports the most recent publish and drops published targets from the schedule', () => {
    const view = toIdeaView(
      ideaRow({
        contentItems: [
          {
            id: 'content-final',
            status: 'PUBLISHED',
            assets: [{ kind: 'FINAL', localPath: '/hot/final.mp4' }],
            publishTargets: [
              {
                status: 'PUBLISHED',
                scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
                publishedAt: new Date('2026-02-01T10:05:00.000Z'),
              },
              {
                status: 'PUBLISHED',
                scheduledAt: new Date('2026-02-03T10:00:00.000Z'),
                publishedAt: new Date('2026-02-03T10:04:00.000Z'),
              },
            ],
          },
        ],
      }),
    );
    expect(view.contentStatus).toBe('PUBLISHED');
    expect(view.scheduledAt).toBeNull();
    expect(view.publishedAt).toBe('2026-02-03T10:04:00.000Z');
  });

  it('treats an asset row without a stored path as missing', () => {
    const view = toIdeaView(
      ideaRow({
        contentItems: [
          {
            id: 'content-partial',
            assets: [
              { kind: 'FINAL', localPath: '/hot/final.mp4' },
              { kind: 'THUMBNAIL', localPath: null },
            ],
          },
        ],
      }),
    );
    expect(view.hasFinalVideo).toBe(true);
    expect(view.hasThumbnail).toBe(false);
    expect(view.contentItemId).toBe('content-partial');
  });
});

describe('toIdeaView topicSummary', () => {
  it('exposes the stored English topic summary', () => {
    expect(toIdeaView(ideaRow()).topicSummary).toBe(
      'English summary of what the episode is about.',
    );
  });
});
