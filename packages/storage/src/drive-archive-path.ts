/**
 * Google Drive library folder layout under the configured root:
 *
 *   {Account Name}__{accountId}/{yyyy}/{mm}/
 *
 * Month is zero-padded (`08`). Account folder names include the stable account
 * id so re-archives target the same folder; find-or-create also matches by the
 * `__{accountId}` suffix if the display name changes.
 */

const ACCOUNT_ID_SUFFIX = /__([A-Za-z0-9_-]+)$/;

/** Strip Drive/path-hostile characters; keep a readable segment. */
export function sanitizeDriveFolderSegment(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 120)
    .trim();
  return cleaned.length > 0 ? cleaned : 'account';
}

/**
 * Readable + stable account folder name: `{Display Name}__{accountId}`.
 * The trailing id is the identity key for find-or-create / renames.
 */
export function driveAccountFolderName(displayName: string, accountId: string): string {
  const id = accountId.trim();
  if (!id) return sanitizeDriveFolderSegment(displayName) || '_unassigned';
  return `${sanitizeDriveFolderSegment(displayName)}__${id}`;
}

/** Extract account id from a folder name produced by {@link driveAccountFolderName}. */
export function accountIdFromDriveFolderName(folderName: string): string | null {
  const m = ACCOUNT_ID_SUFFIX.exec(folderName.trim());
  return m?.[1] ?? null;
}

export function driveYearMonthParts(date: Date): { year: string; month: string } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return {
    year: String(y),
    month: String(m).padStart(2, '0'),
  };
}

/**
 * Relative path under GOOGLE_DRIVE_ROOT_FOLDER_ID:
 * `{Account Name}__{accountId}/{yyyy}/{mm}`
 */
export function buildDriveArchiveFolderPath(input: {
  accountId: string | null | undefined;
  accountName?: string | null;
  archiveDate?: Date | null;
}): string {
  const date = input.archiveDate ?? new Date();
  const { year, month } = driveYearMonthParts(date);
  const accountId = input.accountId?.trim() || '';
  const accountFolder = accountId
    ? driveAccountFolderName(input.accountName?.trim() || 'account', accountId)
    : '_unassigned';
  return `${accountFolder}/${year}/${month}`;
}

/**
 * Unique Drive object name inside a shared month folder
 * (`{contentItemId}_{kind}{ext}`).
 */
export function driveArchiveFilename(
  contentItemId: string,
  kind: string,
  localPathOrFilename: string,
): string {
  const base = localPathOrFilename.split(/[\\/]/).pop() ?? 'asset.bin';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot) : '';
  const safeKind = kind.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'asset';
  return `${contentItemId}_${safeKind}${ext}`;
}
