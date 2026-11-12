import { checkedUnzip } from './checked-zip.ts';
import { validateNativeBusinessFacts } from './native-archive-facts.ts';

export const MAX_NATIVE_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_NATIVE_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024, MAX_LINE_BYTES = 8 * 1024 * 1024;
const journalTables = ['sessions', 'blocks', 'ends', 'shots', 'unscored_counts', 'mutation_receipts', 'import_batches',
  'imported_groups', 'imported_rows', 'imported_end_sources', 'progress_baselines', 'session_plans', 'technique_documents',
  'technique_versions', 'technique_uses', 'rank_assignments', 'diary_notes', 'achievement_enrollments', 'achievement_grants', 'personal_record_events'];
const equipmentTables = ['equipment_items', 'equipment_revisions'];
const sourcePattern = /^sources\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv\.gz$/;
const hashPattern = /^[0-9a-f]{64}$/;
const bad = (reason: string): never => { throw new Error(reason); };
export type NativeJson = null | boolean | number | string | NativeJson[] | { [key: string]: NativeJson };
export type NativeArchiveRow = { [key: string]: NativeJson };
export type NativeArchiveManifest = {
  formatVersion: number; journalSchema: number; equipmentSchema: 1; preferencesFormat: 1;
  createdAtMs: number; appVersion: string; rowCounts: Record<string, number>;
  payloads: { path: string; bytes: number; sha256: string }[];
};
export type NativeArchiveInspection = {
  manifest: NativeArchiveManifest;
  tables: Record<string, NativeArchiveRow[]>;
  preferences: NativeArchiveRow;
  sources: Record<string, Uint8Array>;
  summary: { sessions: number; blocks: number; ends: number; shots: number; unscoredArrows: number;
    equipmentItems: number; sourceFiles: number; totalRows: number; verifiedBytes: number;
    validation: 'envelope-and-core-relations' | 'android-business-facts'; unverified: string[] };
};

/** Paths follow Android ArchiveEnvelopeVerifier, including each historical schema's table set. */
export function nativeArchiveTablePaths(schema: number): string[] {
  if (!Number.isInteger(schema) || schema < 3 || schema > 16) bad('unsupported_archive_version');
  const count = schema === 3 ? 10 : schema === 4 ? 11 : schema === 5 ? 12 : schema <= 7 ? 15 :
    schema === 8 ? 16 : schema === 9 ? 17 : schema <= 11 ? 19 : 20;
  return [...journalTables.slice(0, count).map(name => `data/journal/${name}.jsonl`),
    ...equipmentTables.map(name => `data/equipment/${name}.jsonl`)];
}
const allPaths = new Set([...nativeArchiveTablePaths(16), 'data/preferences.json']);
function object(value: NativeJson | undefined): NativeArchiveRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('expected_object');
  return value;
}
function exactKeys(value: NativeArchiveRow, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) bad('unexpected_json_fields');
}
function integer(value: NativeJson | undefined, reason = 'invalid_integer'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return bad(reason);
  return value;
}
function identifier(value: NativeJson | undefined): string {
  if (typeof value !== 'string' || !value.length || value.length > 128) return bad('invalid_identifier');
  return value;
}

const integerFields = new WeakMap<object, Set<string>>();
/** Match Android's strict JSON dialect, while refusing Long values JavaScript cannot preserve. */
function parseJson(bytes: Uint8Array, integersOnly = false): NativeJson {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return bad('invalid_utf8'); }
  let at = 0;
  const white = () => { while (at < text.length && /[ \t\r\n]/.test(text[at])) at++; };
  const take = (token: string) => { white(); if (text[at] !== token) return false; at++; return true; };
  function string(): string {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '\\') { at++; continue; }
      if (c === '"') {
        let result: string;
        try { result = JSON.parse(text.slice(start, at)); } catch { return bad('invalid_json'); }
        for (let index = 0; index < result.length; index++) {
          const unit = result.charCodeAt(index);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = result.charCodeAt(++index);
            if (!(next >= 0xdc00 && next <= 0xdfff)) bad('invalid_json');
          } else if (unit >= 0xdc00 && unit <= 0xdfff) bad('invalid_json');
        }
        return result;
      }
    }
    return bad('invalid_json');
  }
  function value(depth: number): NativeJson {
    if (depth > 48) bad('invalid_json');
    white();
    if (text[at] === '"') return string();
    if (take('{')) {
      const result: NativeArchiveRow = Object.create(null);
      const integers = new Set<string>();
      integerFields.set(result, integers);
      if (!take('}')) while (true) {
        white(); if (text[at] !== '"') bad('invalid_json');
        const key = string();
        if (Object.hasOwn(result, key) || !take(':')) bad('invalid_json');
        white();
        const valueStart = at;
        result[key] = value(depth + 1);
        if (typeof result[key] === 'number' && /^-?(?:0|[1-9]\d*)$/.test(text.slice(valueStart, at))) integers.add(key);
        if (take('}')) break;
        if (!take(',')) bad('invalid_json');
      }
      return result;
    }
    if (take('[')) {
      const result: NativeJson[] = [];
      if (!take(']')) while (true) {
        result.push(value(depth + 1)); if (take(']')) break; if (!take(',')) bad('invalid_json');
      }
      return result;
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(token, at)) { at += token.length; return result; }
    }
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at))?.[0];
    if (!token) return bad('invalid_json');
    at += token.length;
    if (integersOnly && /[.eE]/.test(token)) bad('invalid_integer');
    const result = Number(token);
    if (!Number.isFinite(result)) bad('invalid_json');
    if (!/[.eE]/.test(token) && !Number.isSafeInteger(result)) bad('unsafe_integer');
    return result;
  }
  const result = value(0); white(); if (at !== text.length) bad('invalid_json');
  return result;
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function manifest(bytes: Uint8Array): NativeArchiveManifest {
  if (!bytes.length || bytes.length > MAX_MANIFEST_BYTES) bad('invalid_manifest_size');
  const root = object(parseJson(bytes, true));
  exactKeys(root, ['formatVersion', 'journalSchema', 'equipmentSchema', 'preferencesFormat', 'createdAtMs', 'appVersion', 'rowCounts', 'payloads']);
  const format = integer(root.formatVersion), schema = integer(root.journalSchema);
  if (format < 1 || format > 14 || schema !== format + 2 || root.equipmentSchema !== 1 || root.preferencesFormat !== 1) bad('unsupported_archive_version');
  integer(root.createdAtMs);
  if (typeof root.appVersion !== 'string' || !root.appVersion.length || root.appVersion.length > 100) bad('invalid_app_version');
  const counts = object(root.rowCounts), paths = nativeArchiveTablePaths(schema);
  exactKeys(counts, paths);
  for (const count of Object.values(counts)) if (integer(count, 'invalid_row_count') < 0) bad('invalid_row_count');
  const payloads = root.payloads;
  if (!Array.isArray(payloads) || payloads.length + 1 > 20_000) return bad('invalid_payload_metadata');
  for (const raw of payloads) {
    const payload = object(raw); exactKeys(payload, ['path', 'bytes', 'sha256']);
    if (typeof payload.path !== 'string' || typeof payload.sha256 !== 'string' || !hashPattern.test(payload.sha256) ||
      integer(payload.bytes, 'invalid_payload_metadata') < 0) bad('invalid_payload_metadata');
  }
  return root as unknown as NativeArchiveManifest;
}
function rows(bytes: Uint8Array, expected: number): NativeArchiveRow[] {
  const result: NativeArchiveRow[] = [];
  let start = 0;
  for (let at = 0; at < bytes.length; at++) {
    if (bytes[at] !== 10) { if (at - start >= MAX_LINE_BYTES) bad('row_too_large'); continue; }
    if (at === start) bad('empty_jsonl_row');
    if (result.length >= expected) bad('row_count_mismatch');
    const row = object(parseJson(bytes.subarray(start, at)));
    // Native SELECT * exports SQLite scalar values. Keep every field, including unmapped columns.
    if (Object.values(row).some(value => value !== null && !['string', 'number'].includes(typeof value))) bad('unsupported_sql_value');
    result.push(row); start = at + 1;
  }
  if (start !== bytes.length) bad('unterminated_jsonl_row');
  if (result.length !== expected) bad('row_count_mismatch');
  return result;
}
function preferences(bytes: Uint8Array): NativeArchiveRow {
  const root = object(parseJson(bytes)); exactKeys(root, ['format', 'values']);
  if (root.format !== 1) bad('unsupported_preferences_version');
  for (const [key, raw] of Object.entries(object(root.values))) {
    if (!key.length || key.length > 200 || /[\x00-\x1f]/.test(key)) bad('invalid_preference_key');
    const entry = object(raw); exactKeys(entry, ['type', 'value']);
    const value = entry.value;
    const valid = entry.type === 'string' ? typeof value === 'string' : entry.type === 'boolean' ? typeof value === 'boolean' :
      entry.type === 'int' ? typeof value === 'number' && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647 :
      entry.type === 'long' ? typeof value === 'number' && Number.isSafeInteger(value) :
      entry.type === 'float' ? typeof value === 'number' && Number.isFinite(Math.fround(value)) :
      entry.type === 'double' ? typeof value === 'number' :
      entry.type === 'stringSet' ? Array.isArray(value) && value.every(item => typeof item === 'string') && new Set(value).size === value.length :
      entry.type === 'bytes' ? typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) : false;
    if (!valid) bad('invalid_preference_value');
  }
  return root;
}
function validateCore(tables: Record<string, NativeArchiveRow[]>): number {
  const journal = (name: string) => tables[`data/journal/${name}.jsonl`] ?? [];
  const ids = new Map<string, Set<string>>();
  const keys: Record<string, string[]> = {
    unscored_counts: ['endId'], mutation_receipts: ['operationId'], imported_rows: ['batchId', 'sourceRecord'],
    imported_end_sources: ['endId'], progress_baselines: ['blockId'], session_plans: ['sessionId'],
    achievement_enrollments: ['sessionId'], achievement_grants: ['key'], equipment_revisions: ['itemId', 'revision'],
  };
  for (const [path, values] of Object.entries(tables)) {
    const name = path.slice(path.lastIndexOf('/') + 1, -6), seen = new Set<string>();
    for (const row of values) {
      const parts = (keys[name] ?? ['id']).map(key => key === 'revision' || key === 'sourceRecord' ? integer(row[key]) : identifier(row[key]));
      const id = JSON.stringify(parts); if (seen.has(id)) bad('duplicate_identifier'); seen.add(id);
      if (name === 'progress_baselines') identifier(row.baselineId);
      if (name === 'imported_rows') identifier(row.shotId);
    }
    ids.set(name, seen);
  }
  const has = (table: string, id: NativeJson | undefined) => ids.get(table)?.has(JSON.stringify([identifier(id)]));
  const scoped = new Set<string>();
  for (const [table, parent, foreign, order] of [
    ['blocks', 'sessions', 'sessionId', 'ordinal'], ['ends', 'blocks', 'blockId', 'ordinal'], ['shots', 'ends', 'endId', 'inputIndex'],
  ]) for (const row of journal(table)) {
    if (!has(parent, row[foreign])) bad('broken_relationship');
    if (integer(row[order]) < 0) bad('invalid_row_order');
    const key = JSON.stringify([table, row[foreign], row[order]]);
    if (scoped.has(key)) bad('invalid_row_order'); scoped.add(key);
  }
  const endById = new Map(journal('ends').map(row => [identifier(row.id), row]));
  const blockById = new Map(journal('blocks').map(row => [identifier(row.id), row]));
  const sessionsWithBlocks = new Set(journal('blocks').map(row => identifier(row.sessionId)));
  if (journal('sessions').some(row => !sessionsWithBlocks.has(identifier(row.id)))) bad('session_without_block');
  const shotIndices = new Map<string, number[]>();
  for (const row of journal('shots')) {
    const end = identifier(row.endId), indices = shotIndices.get(end) ?? [];
    const parent = endById.get(end)!;
    if (blockById.get(identifier(parent.blockId))!.mode !== 'scored') bad('shot_in_count_mode');
    indices.push(integer(row.inputIndex)); shotIndices.set(end, indices);
  }
  for (const end of journal('ends')) {
    const count = integer(end.plannedCount), indices = shotIndices.get(identifier(end.id)) ?? [];
    if (count < 1 || count > 1_000_000 || indices.length > count) bad('invalid_end_count');
    if (indices.some(index => index >= indices.length)) bad('invalid_shot_order');
  }
  let unscored = 0;
  for (const row of journal('unscored_counts')) {
    const end = endById.get(identifier(row.endId)), count = integer(row.count);
    if (!end) return bad('broken_relationship');
    if (blockById.get(identifier(end.blockId))!.mode !== 'count_only') bad('invalid_count');
    if (count < 0 || count > integer(end.plannedCount) || shotIndices.has(identifier(row.endId))) bad('invalid_count');
    unscored += count;
    if (!Number.isSafeInteger(unscored)) bad('unsafe_integer');
  }
  return unscored;
}

/** Read-only inspection and validation against an isolated SQLite copy of the Android schema. */
export async function inspectNativeArchive(bytes: Uint8Array, limits: { maxInputBytes?: number; maxExpandedBytes?: number } = {}): Promise<NativeArchiveInspection> {
  const maxExpandedBytes = limits.maxExpandedBytes ?? MAX_NATIVE_EXPANDED_BYTES;
  const files = checkedUnzip(bytes, {
    maxInputBytes: limits.maxInputBytes ?? MAX_NATIVE_ARCHIVE_BYTES, maxExpandedBytes, maxEntries: 20_000,
    allowedName: name => name === 'manifest.json' || allPaths.has(name) || sourcePattern.test(name),
    maxEntryBytes: name => name === 'manifest.json' ? MAX_MANIFEST_BYTES : name === 'data/preferences.json' ? 1024 * 1024 : maxExpandedBytes,
  });
  if (!files['manifest.json']) bad('missing_manifest');
  const decoded = manifest(files['manifest.json']), required = new Set([...nativeArchiveTablePaths(decoded.journalSchema), 'data/preferences.json']);
  const expected = new Set<string>(['manifest.json']);
  let declaredBytes = files['manifest.json'].length;
  for (const payload of decoded.payloads) {
    if (expected.has(payload.path)) bad('duplicate_archive_path');
    if (!required.has(payload.path) && !sourcePattern.test(payload.path)) bad('unexpected_payload');
    expected.add(payload.path); declaredBytes += payload.bytes;
    if (declaredBytes > maxExpandedBytes) bad('archive_too_large');
    const data = files[payload.path];
    if (!data) bad('missing_payload');
    if (data.length !== payload.bytes) bad('payload_size_mismatch');
    if (await sha256(data) !== payload.sha256) bad('payload_checksum_mismatch');
  }
  if ([...required].some(path => !expected.has(path))) bad('missing_required_payload');
  if (Object.keys(files).some(path => !expected.has(path))) bad('unexpected_payload');
  const tables: Record<string, NativeArchiveRow[]> = Object.create(null), sources: Record<string, Uint8Array> = Object.create(null);
  for (const path of nativeArchiveTablePaths(decoded.journalSchema)) tables[path] = rows(files[path], decoded.rowCounts[path]);
  for (const path of Object.keys(files)) if (sourcePattern.test(path)) sources[path] = files[path];
  const expectedSources = new Set<string>();
  for (const batch of tables['data/journal/import_batches.jsonl']) {
    const rawPath = batch.rawSourcePath;
    if (typeof rawPath !== 'string' || !sourcePattern.test(rawPath.replace(/^imports\//, 'sources/')) || !rawPath.startsWith('imports/')) return bad('invalid_import_source_path');
    const path = rawPath.replace(/^imports\//, 'sources/');
    if (expectedSources.has(path)) bad('duplicate_import_source'); expectedSources.add(path);
    if (typeof batch.fileHash !== 'string' || !hashPattern.test(batch.fileHash)) bad('invalid_import_batch');
  }
  if (expectedSources.size !== Object.keys(sources).length || [...expectedSources].some(path => !Object.hasOwn(sources, path))) bad('import_source_set_mismatch');
  const unscoredArrows = validateCore(tables), count = (name: string) => tables[`data/journal/${name}.jsonl`].length;
  const decodedPreferences = preferences(files['data/preferences.json']);
  const facts = await validateNativeBusinessFacts(tables, decodedPreferences, sources, decoded.journalSchema, {
    parseJson: text => parseJson(new TextEncoder().encode(text)),
    integerToken: (row, key) => integerFields.get(row)?.has(key) ?? false,
  });
  return { manifest: decoded, tables, preferences: decodedPreferences, sources,
    summary: { sessions: count('sessions'), blocks: count('blocks'), ends: count('ends'), shots: count('shots'), unscoredArrows,
      equipmentItems: tables['data/equipment/equipment_items.jsonl'].length, sourceFiles: Object.keys(sources).length,
      totalRows: Object.values(tables).reduce((total, table) => total + table.length, 0), verifiedBytes: declaredBytes,
      validation: 'android-business-facts', unverified: facts.unverified } };
}
