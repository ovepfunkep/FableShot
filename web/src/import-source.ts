export type ImportSource = {
  kind: 'mytargets'; fileHash: string; parserVersion: string; sessionId: string;
  sourceRecords: number[]; seriesFingerprints: string[]; overlapFingerprints: string[];
};

export function isImportSource(value: unknown): value is ImportSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<ImportSource>;
  const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
  const fingerprints = (value: unknown) => Array.isArray(value) && value.length <= 1_000_000 && Array.from(value).every(text);
  return source.kind === 'mytargets' && typeof source.fileHash === 'string' && /^[0-9a-f]{64}$/.test(source.fileHash) &&
    text(source.parserVersion) && text(source.sessionId) && Array.isArray(source.sourceRecords) && source.sourceRecords.length <= 1_000_000 &&
    Array.from(source.sourceRecords).every(index => Number.isSafeInteger(index) && index >= 0) &&
    fingerprints(source.seriesFingerprints) && fingerprints(source.overlapFingerprints);
}

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
