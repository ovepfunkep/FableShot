import { checkedUnzip } from './checked-zip.ts';

/** Validate the envelope before decompression; names are never used as filesystem paths. */
export function readMyTargetsZip(bytes: Uint8Array): { database: Uint8Array; ignoredAttachments: number } {
  const contents = checkedUnzip(bytes, {
    maxInputBytes: 25 * 1024 * 1024,
    maxExpandedBytes: 100 * 1024 * 1024,
    maxEntries: 2000,
    allowLeadingSlash: true,
    allowedName: name => name === 'data.db' || /^[A-Za-z0-9_-]+\.(jpg|jpeg|png)$/i.test(name),
    maxEntryBytes: name => (name === 'data.db' ? 25 : 100) * 1024 * 1024,
  });
  if (!contents['data.db']) throw new Error('archive_database_missing');
  return { database: contents['data.db'], ignoredAttachments: Object.keys(contents).length - 1 };
}
