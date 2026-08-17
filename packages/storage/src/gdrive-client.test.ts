import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  buildServiceAccountAssertion,
  driveScopeAllowsFolderBrowse,
  formatDriveApiError,
  normalizeDriveListParentId,
  normalizePrivateKey,
  parseDriveFolderId,
  resolveGDriveConfig,
  resolveStorageBackend,
} from './gdrive-client.js';

test('driveScopeAllowsFolderBrowse accepts full drive / readonly only', () => {
  assert.equal(
    driveScopeAllowsFolderBrowse('https://www.googleapis.com/auth/drive'),
    true,
  );
  assert.equal(
    driveScopeAllowsFolderBrowse(
      'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/drive',
    ),
    true,
  );
  assert.equal(
    driveScopeAllowsFolderBrowse('https://www.googleapis.com/auth/drive.readonly'),
    true,
  );
  assert.equal(
    driveScopeAllowsFolderBrowse('https://www.googleapis.com/auth/drive.file'),
    false,
  );
  assert.equal(driveScopeAllowsFolderBrowse('https://www.googleapis.com/auth/youtube'), false);
});

test('formatDriveApiError maps 404 notFound to reconnect guidance', () => {
  const msg = formatDriveApiError(
    404,
    JSON.stringify({
      error: { code: 404, message: 'File not found: .', errors: [{ reason: 'notFound' }] },
    }),
    'Drive folder list',
  );
  assert.match(msg, /not found/i);
  assert.match(msg, /drive scope|Connect with Google/i);
  assert.match(msg, /parent folder id|empty|\./i);
});

test('parseDriveFolderId extracts URL ids and rejects dot/empty/root', () => {
  assert.equal(
    parseDriveFolderId('https://drive.google.com/drive/folders/1fQ-4iF4ipyx2mB_CR7HTbGC-3x2e5RtH'),
    '1fQ-4iF4ipyx2mB_CR7HTbGC-3x2e5RtH',
  );
  assert.equal(parseDriveFolderId('1fQ-4iF4ipyx2mB_CR7HTbGC-3x2e5RtH'), '1fQ-4iF4ipyx2mB_CR7HTbGC-3x2e5RtH');
  assert.equal(parseDriveFolderId('.'), null);
  assert.equal(parseDriveFolderId(''), null);
  assert.equal(parseDriveFolderId('root'), null);
  assert.equal(parseDriveFolderId('root', { allowRoot: true }), 'root');
});

test('normalizeDriveListParentId defaults empty to root and rejects dot', () => {
  assert.equal(normalizeDriveListParentId(undefined), 'root');
  assert.equal(normalizeDriveListParentId(''), 'root');
  assert.equal(normalizeDriveListParentId('root'), 'root');
  assert.throws(() => normalizeDriveListParentId('.'), /Invalid Drive folder id/);
});

test('resolveGDriveConfig rejects rootFolderId "." as unconfigured', () => {
  assert.equal(
    resolveGDriveConfig(
      {
        clientId: 'id',
        clientSecret: 'secret',
        refreshToken: 'rt',
        rootFolderId: '.',
      },
      {},
    ),
    null,
  );
});

test('normalizePrivateKey unescapes JSON-style \\n', () => {
  const normalized = normalizePrivateKey('-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n');
  assert.equal(
    normalized,
    '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
  );
});

test('resolveGDriveConfig prefers OAuth when oauth fields complete (legacy installs)', () => {
  const cfg = resolveGDriveConfig(
    {
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'rt',
      rootFolderId: 'folder',
    },
    {},
  );
  assert.deepEqual(cfg, {
    auth: 'oauth',
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'rt',
    rootFolderId: 'folder',
  });
});

test('resolveGDriveConfig accepts service account when SA fields complete', () => {
  const cfg = resolveGDriveConfig(
    {
      authMode: 'service_account',
      clientEmail: 'sa@project.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
      rootFolderId: 'folder',
    },
    {},
  );
  assert.ok(cfg);
  assert.equal(cfg.auth, 'service_account');
  if (cfg.auth === 'service_account') {
    assert.equal(cfg.clientEmail, 'sa@project.iam.gserviceaccount.com');
    assert.match(cfg.privateKey, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(cfg.privateKey, /\\n/);
  }
});

test('resolveGDriveConfig authMode=service_account wins when both auth sets present', () => {
  const cfg = resolveGDriveConfig(
    {
      authMode: 'service_account',
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'rt',
      clientEmail: 'sa@project.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
      rootFolderId: 'folder',
    },
    {},
  );
  assert.equal(cfg?.auth, 'service_account');
});

test('resolveGDriveConfig falls back to env bootstrap for SA', () => {
  const cfg = resolveGDriveConfig(null, {
    GOOGLE_DRIVE_CLIENT_EMAIL: 'sa@project.iam.gserviceaccount.com',
    GOOGLE_DRIVE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: 'folder',
  });
  assert.equal(cfg?.auth, 'service_account');
});

test('resolveStorageBackend prefers settings over env', () => {
  assert.equal(resolveStorageBackend({ backend: 'gdrive' }, { STORAGE_BACKEND: 'local' }), 'gdrive');
  assert.equal(resolveStorageBackend({ backend: 'local' }, { STORAGE_BACKEND: 'gdrive' }), 'local');
  assert.equal(resolveStorageBackend({}, { STORAGE_BACKEND: 'gdrive' }), 'gdrive');
  assert.equal(resolveStorageBackend(null, {}), 'local');
});

test('buildServiceAccountAssertion produces a 3-part RS256 JWT', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const jwt = buildServiceAccountAssertion(
    'sa@project.iam.gserviceaccount.com',
    privateKey,
    'https://www.googleapis.com/auth/drive',
    1_700_000_000,
  );
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  assert.ok(parts[0] && parts[1] && parts[2]);
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
    alg: string;
  };
  assert.equal(header.alg, 'RS256');
  const claim = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
    iss: string;
    scope: string;
  };
  assert.equal(claim.iss, 'sa@project.iam.gserviceaccount.com');
  assert.equal(claim.scope, 'https://www.googleapis.com/auth/drive');
});
