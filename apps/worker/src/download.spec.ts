import { describe, expect, it } from 'vitest';
import { sameAccountDupWhere } from './download.js';

describe('sameAccountDupWhere', () => {
  it('scopes to the target account and ignores soft-deleted watched sources', () => {
    expect(
      sameAccountDupWhere({
        id: 'sv1',
        watchedSourceId: 'ws1',
        watchedSource: { targetAccountId: 'acct1' },
      }),
    ).toEqual({ watchedSource: { targetAccountId: 'acct1', deletedAt: null } });
  });

  it('falls back to the same live watched source when no account is bound', () => {
    expect(
      sameAccountDupWhere({
        id: 'sv1',
        watchedSourceId: 'ws1',
        watchedSource: { targetAccountId: null },
      }),
    ).toEqual({ watchedSourceId: 'ws1', watchedSource: { deletedAt: null } });
  });

  it('only compares orphans against other orphans', () => {
    expect(
      sameAccountDupWhere({
        id: 'sv1',
        watchedSourceId: null,
        watchedSource: null,
      }),
    ).toEqual({ watchedSourceId: null });
  });
});
