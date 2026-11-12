import { zipSync } from 'fflate';
import { checkedUnzip } from './checked-zip.ts';
import { ACTIVE_DATA_KEY, DATA_KEYS, LEGACY_DATA_KEYS, RECOVERY_DATA_KEY, appStorage } from './app-storage.ts';
import type { DataRecords, StoredData } from './app-storage.ts';
import { DIARY_KEY, isDiary, loadDiary, NATIVE_ARCHIVE_BYTE_LIMIT } from './persistence.ts';
import type { Diary, NativeArchiveReference } from './persistence.ts';
import { isLibrary } from './equipment.ts';
import { isPreset } from './conditions.ts';
import { isTechniqueLibrary } from './technique.ts';
import { valid as validPreferences } from './preferences.ts';
import { isTechniqueDisplaySettings } from './technique-settings.ts';
import { isSettings as isTimerSettings } from './timer.ts';
import { getNativeSource, putNativeSource } from './native-source-store.ts';

const MAX_WEB_ONLY_BYTES = 12 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = MAX_WEB_ONLY_BYTES + NATIVE_ARCHIVE_BYTE_LIMIT;
const MAX_UNPACKED_BYTES = 32 * 1024 * 1024;
const payloadPath = 'data/web/records.json';
const nativePath = 'sources/android.zip';
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
type WebManifest = { format: 'fableshot-web-archive'; version: 1 | 2; appVersion: string; createdAt: string;
  payloads: { path: string; bytes: number; sha256: string }[] };
export type WebArchivePreview = { manifest: WebManifest; records: DataRecords; summary: ArchiveSummary; nativeSource?: Uint8Array };
export type ArchiveSummary = { trainings: number; arrows: number; bows: number; arrowSets: number; kits: number; techniques: number; notes: number; archivedNotes: number };

export async function archiveDigest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Check declared sizes and paths before allowing the ZIP inflater to allocate a payload. */
export function unpackArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (!bytes.length) throw new Error('Выбранный архив пуст. Сохрани его на телефон и выбери повторно.');
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Архив превышает допустимый размер.');
  try {
    return checkedUnzip(bytes, { maxInputBytes: MAX_ARCHIVE_BYTES, maxExpandedBytes: MAX_UNPACKED_BYTES + NATIVE_ARCHIVE_BYTE_LIMIT,
      maxEntries: 3, allowedName: name => name === 'manifest.json' || name === payloadPath || name === nativePath,
      maxEntryBytes: name => name === nativePath ? NATIVE_ARCHIVE_BYTE_LIMIT : name === payloadPath ? MAX_UNPACKED_BYTES : 1024 * 1024 });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : '';
    throw new Error(code === 'archive_too_large' ? 'Распакованный архив слишком большой.'
      : code === 'archive_unsafe_path' || code === 'archive_duplicate_entry' ? 'В архиве небезопасные или повторяющиеся пути.'
      : 'ZIP повреждён или содержит неподдерживаемые разделы. Данные не изменены.', { cause });
  }
}

export function validateArchiveRecords(records: unknown): ArchiveSummary {
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error('Неверный состав данных архива.');
  const values = records as DataRecords;
  if (Object.keys(values).length !== DATA_KEYS.length || !DATA_KEYS.every(key => Object.hasOwn(values, key)) ||
    Object.values(values).some(raw => raw !== null && typeof raw !== 'string')) throw new Error('Неизвестный раздел или неполный состав архива.');
  const decoded = new Map<string, any>();
  for (const [key, raw] of Object.entries(values)) {
    if (raw === null) continue;
    let value: any;
    try { value = JSON.parse(raw); } catch { throw new Error(`Не удалось прочитать раздел ${key}.`); }
    decoded.set(key, value);
    let valid = false;
    if (key === DIARY_KEY) valid = isDiary(value);
    else if (key === 'app.fableshot.equipment.v1') valid = isLibrary(value);
    else if (key === 'app.fableshot.techniques.v1') valid = isTechniqueLibrary(value);
    else if (key === 'app.fableshot.training-preferences.v1') valid = value?.version === 1 && validPreferences(value.preferences);
    else if (key === 'app.fableshot.technique-settings.v1') valid = value?.version === 1 && isTechniqueDisplaySettings(value.settings);
    else if (key === 'app.fableshot.timer-settings.v1') valid = value?.version === 1 && isTimerSettings(value.settings);
    else if (key === 'app.fableshot.training-presets.v1') valid = value?.version === 1 && Array.isArray(value.presets) && value.presets.length <= 64 &&
      Array.from(value.presets).every(isPreset) && new Set(value.presets.map((item: { id: string }) => item.id)).size === value.presets.length &&
      new Set(value.presets.map((item: { name: string }) => item.name.toLocaleLowerCase('ru-RU'))).size === value.presets.length;
    if (!valid) throw new Error(`Данные раздела ${key} не прошли проверку.`);
  }
  const diary = decoded.get(DIARY_KEY);
  if (!diary || !isDiary(diary)) throw new Error('В архиве отсутствует дневник.');
  const equipment = decoded.get('app.fableshot.equipment.v1');
  const notes = [...(diary.notes ?? []), ...diary.entries.flatMap(entry => entry.notes ?? [])];
  return { trainings: diary.entries.length,
    arrows: diary.entries.reduce((total, entry) => total + entry.practice.rounds.reduce((sum, round) => sum + round.series.reduce((sum, series) => sum + series.shots.length, 0), 0), 0),
    bows: equipment?.bows.length ?? 0, arrowSets: equipment?.arrows.length ?? 0, kits: equipment?.kits.length ?? 0,
    techniques: decoded.get('app.fableshot.techniques.v1')?.documents.length ?? 0,
    notes: notes.length, archivedNotes: notes.filter(note => note.deletedAtMs != null).length };
}

export function captureArchiveRecords(): DataRecords {
  const records = Object.fromEntries(DATA_KEYS.map(key => [key, appStorage.getItem(key)]));
  // Normalize the read-only legacy fallback, without modifying its original key.
  records[DIARY_KEY] = JSON.stringify(loadDiary());
  validateArchiveRecords(records);
  return records;
}

export function nativeArchiveReference(records: DataRecords): NativeArchiveReference | undefined {
  return (JSON.parse(records[DIARY_KEY] ?? 'null') as Diary | null)?.nativeArchive;
}

export async function preserveArchiveSource(records: DataRecords, bytes?: Uint8Array): Promise<void> {
  const reference = nativeArchiveReference(records);
  if (!reference) return;
  const source = bytes ?? await getNativeSource(reference.sha256);
  if (source.length !== reference.bytes || (bytes && await archiveDigest(bytes) !== reference.sha256)) {
    throw new Error('Контрольная сумма исходного архива Android не совпадает.');
  }
  if (bytes) await putNativeSource(bytes);
}

export async function createWebArchive(records: DataRecords, appVersion: string, createdAt = new Date().toISOString()): Promise<Uint8Array> {
  validateArchiveRecords(records);
  const payload = encoder.encode(JSON.stringify(records));
  if (payload.byteLength > MAX_UNPACKED_BYTES) throw new Error('Для архива слишком много данных.');
  const reference = nativeArchiveReference(records);
  const original = reference ? await getNativeSource(reference.sha256) : undefined;
  if (original && original.length !== reference!.bytes) throw new Error('Размер исходного архива Android не совпадает.');
  const manifest: WebManifest = { format: 'fableshot-web-archive', version: original ? 2 : 1, appVersion, createdAt,
    payloads: [{ path: payloadPath, bytes: payload.byteLength, sha256: await archiveDigest(payload) }] };
  if (original) manifest.payloads.push({ path: nativePath, bytes: original.length, sha256: reference!.sha256 });
  const bytes = zipSync({ 'manifest.json': encoder.encode(JSON.stringify(manifest)), [payloadPath]: payload,
    ...(original ? { [nativePath]: [original, { level: 0 }] as const } : {}) }, { level: 6 });
  if (bytes.byteLength > (original ? MAX_ARCHIVE_BYTES : MAX_WEB_ONLY_BYTES)) throw new Error('Архив превышает допустимый размер.');
  await inspectWebArchive(bytes);
  return bytes;
}

export async function inspectWebArchive(bytes: Uint8Array): Promise<WebArchivePreview> {
  const files = unpackArchive(bytes);
  if (!Object.hasOwn(files, 'manifest.json') || files['manifest.json'].length > 1024 * 1024) throw new Error('Не найден допустимый manifest.json.');
  const manifest = JSON.parse(decoder.decode(files['manifest.json'])) as WebManifest;
  if (typeof manifest !== 'object' || manifest === null) throw new Error('Неверный манифест архива.');
  if ('formatVersion' in manifest) throw new Error('Это архив Android. Его перенос подключается отдельно; текущие данные не изменены.');
  const hasNative = manifest.version === 2;
  const payloadCount = hasNative ? 2 : 1;
  if (manifest.format !== 'fableshot-web-archive' || (manifest.version !== 1 && !hasNative) || typeof manifest.appVersion !== 'string' ||
    typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.payloads) || manifest.payloads.length !== payloadCount || Object.keys(files).length !== payloadCount + 1 ||
    (!hasNative && bytes.length > MAX_WEB_ONLY_BYTES)) throw new Error('Неподдерживаемый формат архива.');
  const payload = manifest.payloads[0];
  const content = files[payloadPath];
  if (!content || content.length > MAX_UNPACKED_BYTES || payload?.path !== payloadPath || payload.bytes !== content.length || payload.sha256 !== await archiveDigest(content)) throw new Error('Размер или контрольная сумма архива не совпадают.');
  const records: unknown = JSON.parse(decoder.decode(content));
  const summary = validateArchiveRecords(records);
  const reference = nativeArchiveReference(records as DataRecords);
  const nativeSource = files[nativePath];
  const sourcePayload = manifest.payloads[1];
  if (hasNative !== !!reference || hasNative !== !!nativeSource || (hasNative &&
    (sourcePayload?.path !== nativePath || sourcePayload.bytes !== nativeSource.length || reference!.bytes !== nativeSource.length ||
      sourcePayload.sha256 !== reference!.sha256 || await archiveDigest(nativeSource) !== reference!.sha256))) {
    throw new Error('В резервной копии отсутствует целый исходный архив Android.');
  }
  return { manifest, records: records as DataRecords, summary, ...(nativeSource ? { nativeSource } : {}) };
}

export function archiveSourceToken(source: Pick<Storage, 'getItem'> = localStorage): string {
  return JSON.stringify([ACTIVE_DATA_KEY, ...DATA_KEYS, ...LEGACY_DATA_KEYS].map(key => source.getItem(key)));
}

export function captureArchiveState(allowInvalid = false): { records: DataRecords; token: string } {
  const token = archiveSourceToken();
  const records = Object.fromEntries(DATA_KEYS.map(key => [key, appStorage.getItem(key)]));
  if (records[DIARY_KEY] === null) {
    try { records[DIARY_KEY] = JSON.stringify(loadDiary()); }
    catch (error) { if (!allowInvalid) throw error; }
  }
  if (!allowInvalid) validateArchiveRecords(records);
  if (archiveSourceToken() !== token) throw new Error('Дневник изменился во время подготовки. Повтори действие.');
  return { records, token };
}

export function replaceArchiveRecords(records: DataRecords, expected: { records: DataRecords; token: string }, source: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  validateArchiveRecords(records);
  if (Object.keys(expected.records).length !== DATA_KEYS.length || !DATA_KEYS.every(key => Object.hasOwn(expected.records, key)) ||
    Object.values(expected.records).some(value => value !== null && typeof value !== 'string')) throw new Error('Неверный снимок текущих данных.');
  if (archiveSourceToken(source) !== expected.token) throw new Error('Данные изменились после предпросмотра. Открой архив заново.');
  const state: StoredData = { version: 1, epoch: crypto.randomUUID(), records: structuredClone(records) };
  const previous = { version: 1, savedAt: new Date().toISOString(), records: structuredClone(expected.records), originalSource: expected.token };
  // Failure of either write leaves the old active data intact. No old keys are deleted.
  source.setItem(RECOVERY_DATA_KEY, JSON.stringify(previous));
  if (archiveSourceToken(source) !== expected.token) throw new Error('Дневник изменился при резервировании. Повтори действие.');
  source.setItem(ACTIVE_DATA_KEY, JSON.stringify(state));
}

export function lastRecovery(source: Pick<Storage, 'getItem'> = localStorage): { savedAt: string; records: DataRecords; summary: ArchiveSummary } | null {
  const raw = source.getItem(RECOVERY_DATA_KEY);
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (value?.version !== 1 || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))) throw new Error('Резервная копия повреждена.');
  return { savedAt: value.savedAt, records: value.records, summary: validateArchiveRecords(value.records) };
}
