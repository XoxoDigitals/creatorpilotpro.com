import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountIdFromDriveFolderName,
  buildDriveArchiveFolderPath,
  driveAccountFolderName,
  driveArchiveFilename,
  driveYearMonthParts,
  sanitizeDriveFolderSegment,
} from './drive-archive-path.js';

test('sanitizeDriveFolderSegment strips path-hostile chars', () => {
  assert.equal(sanitizeDriveFolderSegment('  My / Channel: "A"  '), 'My _ Channel_ _A_');
  assert.equal(sanitizeDriveFolderSegment('...'), 'account');
});

test('driveAccountFolderName appends stable account id', () => {
  assert.equal(driveAccountFolderName('Acme Shorts', 'clabc123'), 'Acme Shorts__clabc123');
  assert.equal(accountIdFromDriveFolderName('Acme Shorts__clabc123'), 'clabc123');
  assert.equal(accountIdFromDriveFolderName('_unassigned'), null);
});

test('driveYearMonthParts uses UTC year and zero-padded month', () => {
  assert.deepEqual(driveYearMonthParts(new Date('2026-08-16T12:00:00.000Z')), {
    year: '2026',
    month: '08',
  });
  assert.deepEqual(driveYearMonthParts(new Date('2026-01-05T00:00:00.000Z')), {
    year: '2026',
    month: '01',
  });
});

test('buildDriveArchiveFolderPath builds account/year/month', () => {
  assert.equal(
    buildDriveArchiveFolderPath({
      accountId: 'clabc123',
      accountName: 'Acme Shorts',
      archiveDate: new Date('2026-08-16T12:00:00.000Z'),
    }),
    'Acme Shorts__clabc123/2026/08',
  );
  assert.equal(
    buildDriveArchiveFolderPath({
      accountId: null,
      archiveDate: new Date('2026-03-01T00:00:00.000Z'),
    }),
    '_unassigned/2026/03',
  );
});

test('driveArchiveFilename is unique per content item + kind', () => {
  assert.equal(
    driveArchiveFilename('item1', 'FINAL', '/data/items/item1/final/final.mp4'),
    'item1_final.mp4',
  );
  assert.equal(
    driveArchiveFilename('item1', 'THUMBNAIL', 'thumb.png'),
    'item1_thumbnail.png',
  );
});
