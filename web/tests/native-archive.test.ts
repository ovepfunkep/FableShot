import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync, zipSync } from 'fflate';
import { inspectNativeArchive, nativeArchiveTablePaths } from '../src/native-archive.ts';
import type { NativeArchiveManifest, NativeArchiveRow } from '../src/native-archive.ts';
import { getTargetProfile } from '../src/target.ts';

const encode = (text: string) => new TextEncoder().encode(text);
const journal = (name: string) => `data/journal/${name}.jsonl`;
function targetSnapshot() {
  const profile = getTargetProfile('wa-outdoor-full-v1')!;
  return JSON.stringify({ snapshotVersion: 1, profileId: profile.id, profileVersion: 1, geometryType: 'circle',
    scoringRuleVersion: 'wa-outdoor-point-v1', diameterMm: 800, boundaryRule: 'greater-score', boundaryEpsilon: 1e-9,
    supportsX: true, faces: [{ faceId: 'main', zones: profile.zones.map(zone => ({ ...zone, isX: zone.code === 'X' })) }],
    nativeExtension: 'retained verbatim' });
}
async function digest(bytes: Uint8Array) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))).toString('hex');
}
const core: Record<string, NativeArchiveRow[]> = {
  [journal('sessions')]: [{ id: 'session-stable', title: 'Native training', createdAtMs: 1234, state: 'completed',
    sourceKind: 'native', timeSource: 'app_clock', kind: 'training', revision: 2, deletedAtMs: null, numberedArrows: 1,
    startedAtMs: 1234, completedAtMs: 5000, localDate: '2026-11-11', timeZoneId: 'UTC' }],
  [journal('blocks')]: [{ id: 'block-stable', sessionId: 'session-stable', ordinal: 0, mode: 'scored',
    distanceMeters: 18, defaultArrowsPerEnd: 3, targetSnapshotJson: targetSnapshot(), revision: 1,
    targetProfileId: 'wa-outdoor-full-v1', targetProfileVersion: 1, targetDiameterMm: 800, equipmentSnapshotJson: null }],
  [journal('ends')]: [{ id: 'end-stable', blockId: 'block-stable', ordinal: 0, plannedCount: 3, role: 'scored',
    state: 'closed', revision: 1, startsRound: 1, createdAtMs: 1234, closedAtMs: 5000 }],
  [journal('shots')]: [{ id: 'shot-stable', endId: 'end-stable', inputIndex: 0, points: 10, zoneCode: 'X',
    x: .01, y: -.02, physicalArrowNumber: 7, shaftDiameterMm: 5.5, revision: 1, createdAtMs: 1234,
    automaticPoints: 10, automaticRuleVersion: 'wa-outdoor-point-v1:shaft-v1', faceId: 'main', updatedAtMs: null,
    positionSource: 'manual_target', positionStatus: 'known', scoreSource: 'target_computed' }],
};
async function fixture(options: { format?: number; tables?: Record<string, NativeArchiveRow[]>; raw?: Record<string, Uint8Array>;
  editManifest?(manifest: NativeArchiveManifest): void } = {}) {
  const format = options.format ?? 14, paths = nativeArchiveTablePaths(format + 2);
  const files: Record<string, Uint8Array> = {}, rowCounts: Record<string, number> = {};
  for (const path of paths) {
    const rows = options.tables?.[path] ?? [];
    files[path] = encode(rows.map(row => `${JSON.stringify(row)}\n`).join('')); rowCounts[path] = rows.length;
  }
  files['data/preferences.json'] = encode(JSON.stringify({ format: 1, values: { displayName: { type: 'string', value: 'Archer' } } }));
  Object.assign(files, options.raw);
  const manifest: NativeArchiveManifest = { formatVersion: format, journalSchema: format + 2, equipmentSchema: 1,
    preferencesFormat: 1, createdAtMs: 123456, appVersion: '0.15.0', rowCounts,
    payloads: await Promise.all(Object.entries(files).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await digest(bytes) }))) };
  options.editManifest?.(manifest);
  files['manifest.json'] = encode(JSON.stringify(manifest));
  return { files, manifest, bytes: zipSync(files) };
}

test('latest native archive inspection preserves stable IDs, embedded extension fields, coordinates and preferences', async () => {
  const original = await fixture({ tables: core }), result = await inspectNativeArchive(original.bytes);
  assert.equal(result.manifest.formatVersion, 14); assert.equal(result.manifest.journalSchema, 16);
  assert.equal(Object.keys(result.tables).length, 22);
  assert.equal(JSON.parse(String(result.tables[journal('blocks')][0].targetSnapshotJson)).nativeExtension, 'retained verbatim');
  assert.equal(result.tables[journal('shots')][0].id, 'shot-stable');
  assert.equal(result.tables[journal('shots')][0].shaftDiameterMm, 5.5);
  assert.equal(result.tables[journal('blocks')][0].targetSnapshotJson, core[journal('blocks')][0].targetSnapshotJson);
  assert.deepEqual(JSON.parse(JSON.stringify(result.preferences)), { format: 1, values: { displayName: { type: 'string', value: 'Archer' } } });
  assert.equal(result.summary.sessions, 1); assert.equal(result.summary.shots, 1);
  assert.equal(result.summary.validation, 'android-business-facts');
  assert.deepEqual(result.summary.unverified, []);
});

test('all historical formats use exactly the table set required by their native schema', async () => {
  for (let format = 1; format <= 14; format++) {
    const result = await inspectNativeArchive((await fixture({ format })).bytes);
    assert.deepEqual(Object.keys(result.tables), nativeArchiveTablePaths(format + 2));
    assert.equal(result.summary.totalRows, 0);
  }
  assert.equal(nativeArchiveTablePaths(3).length, 12); assert.equal(nativeArchiveTablePaths(16).length, 22);
});

test('payload checksums and sizes are checked independently of ZIP CRC', async () => {
  const { files } = await fixture();
  files[journal('shots')] = encode('{"id":"tampered"}\n');
  await assert.rejects(inspectNativeArchive(zipSync(files)), /payload_size_mismatch/);
  const checksum = await fixture();
  checksum.files['data/preferences.json'][0] ^= 1;
  await assert.rejects(inspectNativeArchive(zipSync(checksum.files)), /payload_checksum_mismatch/);
});

test('manifest exact keys, native version agreement and row counts are enforced', async () => {
  const edits: ((manifest: NativeArchiveManifest) => void)[] = [
    manifest => { (manifest as unknown as Record<string, unknown>).unexpected = true; },
    manifest => { manifest.journalSchema = 15; },
    manifest => { manifest.rowCounts[journal('shots')] = 1; },
    manifest => { delete manifest.rowCounts[journal('shots')]; },
    manifest => { manifest.payloads[0].sha256 = 'A'.repeat(64); },
  ];
  for (const editManifest of edits) await assert.rejects(inspectNativeArchive((await fixture({ editManifest })).bytes));
  const decimal = await fixture();
  decimal.files['manifest.json'] = encode(JSON.stringify(decimal.manifest).replace('"formatVersion":14', '"formatVersion":14.0'));
  await assert.rejects(inspectNativeArchive(zipSync(decimal.files)), /invalid_integer/);
});

test('required, declared and actual entry sets must match; old formats reject newer tables', async () => {
  const missing = await fixture(); delete missing.files[journal('ends')];
  await assert.rejects(inspectNativeArchive(zipSync(missing.files)), /missing_payload/);
  const unlisted = await fixture(); unlisted.files['sources/12345678-1234-1234-1234-123456789abc.csv.gz'] = encode('x');
  await assert.rejects(inspectNativeArchive(zipSync(unlisted.files)), /unexpected_payload/);
  await assert.rejects(inspectNativeArchive((await fixture({ format: 1, raw: { [journal('personal_record_events')]: encode('') } })).bytes), /unexpected_payload/);
  await assert.rejects(inspectNativeArchive((await fixture({ raw: { 'data/unknown.jsonl': encode('') } })).bytes), /archive_unsupported_entry/);
});

test('JSONL rejects empty lines, unterminated rows, nonobjects, duplicate keys and invalid UTF8', async () => {
  for (const raw of ['\n', '{"id":"s"}', '[]\n', '{"id":"s","id":"other"}\n']) {
    const file = await fixture({ raw: { [journal('sessions')]: encode(raw) }, editManifest: manifest => { manifest.rowCounts[journal('sessions')] = 1; } });
    await assert.rejects(inspectNativeArchive(file.bytes));
  }
  const invalid = await fixture({ raw: { [journal('sessions')]: new Uint8Array([0xff, 10]) }, editManifest: manifest => { manifest.rowCounts[journal('sessions')] = 1; } });
  await assert.rejects(inspectNativeArchive(invalid.bytes), /invalid_utf8/);
});

test('unsafe Long values are refused before JavaScript can lose their precision', async () => {
  const integer = await fixture({ raw: { [journal('sessions')]: encode('{"id":"s","createdAtMs":9007199254740993}\n') },
    editManifest: manifest => { manifest.rowCounts[journal('sessions')] = 1; } });
  await assert.rejects(inspectNativeArchive(integer.bytes), /unsafe_integer/);
  const manifest = await fixture();
  manifest.files['manifest.json'] = encode(JSON.stringify(manifest.manifest).replace('"createdAtMs":123456', '"createdAtMs":9223372036854775807'));
  await assert.rejects(inspectNativeArchive(zipSync(manifest.files)), /unsafe_integer/);
});

test('core session-block-end-shot foreign links and unique IDs are required', async () => {
  for (const [table, field] of [['blocks', 'sessionId'], ['ends', 'blockId'], ['shots', 'endId']]) {
    const tables = structuredClone(core); tables[journal(table)][0][field] = 'missing';
    await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /broken_relationship/);
  }
  const duplicates = structuredClone(core); duplicates[journal('shots')].push({ ...duplicates[journal('shots')][0] });
  await assert.rejects(inspectNativeArchive((await fixture({ tables: duplicates })).bytes), /duplicate_identifier/);
  await assert.rejects(inspectNativeArchive((await fixture({ tables: { [journal('sessions')]: core[journal('sessions')] } })).bytes), /session_without_block/);
});

test('core shot order, end capacity and unscored counters are checked without repairing rows', async () => {
  const gap = structuredClone(core); gap[journal('shots')][0].inputIndex = 1;
  await assert.rejects(inspectNativeArchive((await fixture({ tables: gap })).bytes), /invalid_shot_order/);
  const overfilled = structuredClone(core); overfilled[journal('ends')][0].plannedCount = 0;
  await assert.rejects(inspectNativeArchive((await fixture({ tables: overfilled })).bytes), /invalid_end_count/);
  const counted = structuredClone(core); counted[journal('shots')] = [];
  counted[journal('blocks')][0].mode = 'count_only';
  counted[journal('unscored_counts')] = [{ endId: 'end-stable', count: 3, revision: 1, createdAtMs: 1234, updatedAtMs: 5000 }];
  assert.equal((await inspectNativeArchive((await fixture({ tables: counted })).bytes)).summary.unscoredArrows, 3);
  counted[journal('unscored_counts')][0].count = 4;
  await assert.rejects(inspectNativeArchive((await fixture({ tables: counted })).bytes), /invalid_count/);
});

test('retained source payloads match import batches and verify nested gzip plus raw CSV checksums', async () => {
  const path = 'sources/12345678-1234-1234-1234-123456789abc.csv.gz', csv = encode('source,records\n');
  const wrapped = gzipSync(csv), tables = { [journal('import_batches')]: [{ id: 'batch', rawSourcePath: path.replace('sources/', 'imports/'), fileHash: await digest(csv),
    source: 'mytargets', status: 'committed', parserVersion: 'source-v1', importedAtMs: 1234, sourceName: null }] };
  const result = await inspectNativeArchive((await fixture({ tables, raw: { [path]: wrapped } })).bytes);
  assert.deepEqual(result.sources[path], wrapped); assert.equal(result.summary.sourceFiles, 1);
  assert.deepEqual(result.summary.unverified, []);
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /import_source_set_mismatch/);
});

test('preferences retain unknown keys with valid types and reject malformed values', async () => {
  const prefs = { format: 1, values: { futureKey: { type: 'stringSet', value: ['a', 'b'] }, feature: { type: 'boolean', value: true } } };
  const result = await inspectNativeArchive((await fixture({ raw: { 'data/preferences.json': encode(JSON.stringify(prefs)) } })).bytes);
  assert.deepEqual(JSON.parse(JSON.stringify(result.preferences)), prefs);
  prefs.values.futureKey.value = ['a', 'a'];
  await assert.rejects(inspectNativeArchive((await fixture({ raw: { 'data/preferences.json': encode(JSON.stringify(prefs)) } })).bytes), /invalid_preference_value/);
});

test('inspection obeys explicit browser byte budgets', async () => {
  const { bytes } = await fixture();
  await assert.rejects(inspectNativeArchive(bytes, { maxInputBytes: bytes.length - 1 }), /file_too_large/);
  await assert.rejects(inspectNativeArchive(bytes, { maxExpandedBytes: 100 }), /archive_too_large/);
});

test('JSONL rows have the native eight MiB byte ceiling', async () => {
  const oversized = encode(`{"id":"s","note":"${'x'.repeat(8 * 1024 * 1024)}"}\n`);
  const file = await fixture({ raw: { [journal('sessions')]: oversized }, editManifest: manifest => { manifest.rowCounts[journal('sessions')] = 1; } });
  await assert.rejects(inspectNativeArchive(file.bytes), /row_too_large/);
});

test('nonempty historical archives use only Android restore defaults and keep original rows intact', async () => {
  for (let format = 1; format <= 14; format++) {
    const tables = structuredClone(core), schema = format + 2;
    if (schema < 13) delete tables[journal('sessions')][0].numberedArrows;
    if (schema < 14) delete tables[journal('ends')][0].startsRound;
    if (schema < 15) delete tables[journal('shots')][0].shaftDiameterMm;
    const result = await inspectNativeArchive((await fixture({ format, tables })).bytes);
    assert.deepEqual(JSON.parse(JSON.stringify(result.tables[journal('shots')])), tables[journal('shots')]);
    assert.deepEqual(result.summary.unverified, []);
  }
});

test('native restoration rejects missing or unknown columns and INTEGER tokens written as decimals', async () => {
  const missing = structuredClone(core); delete missing[journal('sessions')][0].startedAtMs;
  await assert.rejects(inspectNativeArchive((await fixture({ tables: missing })).bytes), /unexpected_json_fields/);
  const unknown = structuredClone(core); unknown[journal('sessions')][0].unknownColumn = 'x';
  await assert.rejects(inspectNativeArchive((await fixture({ tables: unknown })).bytes), /unexpected_json_fields/);
  const raw = encode(`${JSON.stringify(core[journal('sessions')][0]).replace('"revision":2', '"revision":2.0')}\n`);
  await assert.rejects(inspectNativeArchive((await fixture({ tables: core, raw: { [journal('sessions')]: raw } })).bytes), /invalid_integer_column/);
});

test('additional foreign keys and scoped unique indexes are enforced by the native Room schema', async () => {
  const tables = structuredClone(core);
  const use = { id: 'use', sessionId: 'session-stable', versionId: 'missing', sequence: 1, blockOrdinal: 0, endOrdinal: 0,
    focus1: '', focus2: '', createdAtMs: 1234, worked: '', question: '', rating: null, revision: 1 };
  tables[journal('technique_uses')] = [use];
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /broken_relationship/);
  tables[journal('technique_uses')] = [{ ...use, versionId: null }, { ...use, versionId: null, id: 'second' }];
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /archive_fact_constraint/);
});

test('native rolling plans control end capacity and current blocks require an end', async () => {
  const tables = structuredClone(core); tables[journal('ends')][0].plannedCount = 13;
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /invalid_end/);
  tables[journal('session_plans')] = [{ sessionId: 'session-stable', plannedEnds: 0, roundCount: 1, rolling: 1, roundArrowLimit: 100 }];
  assert.equal((await inspectNativeArchive((await fixture({ tables })).bytes)).summary.sessions, 1);
  tables[journal('sessions')][0].state = 'active';
  tables[journal('blocks')].push({ ...tables[journal('blocks')][0], id: 'next-block', ordinal: 1 });
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /block_without_end/);
  tables[journal('sessions')][0].numberedArrows = 2;
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /invalid_numbered_arrows/);
});

test('target snapshots and shaft-derived scores must match the native catalog and scoring rule', async () => {
  const geometry = structuredClone(core), source = JSON.parse(String(geometry[journal('blocks')][0].targetSnapshotJson));
  source.faces[0].zones[0].outerRadius = .9;
  geometry[journal('blocks')][0].targetSnapshotJson = JSON.stringify(source);
  await assert.rejects(inspectNativeArchive((await fixture({ tables: geometry })).bytes), /invalid_target_geometry/);
  const shaft = structuredClone(core); shaft[journal('shots')][0].automaticPoints = 9;
  await assert.rejects(inspectNativeArchive((await fixture({ tables: shaft })).bytes), /invalid_shaft_score/);
  shaft[journal('shots')][0].shaftDiameterMm = 21;
  await assert.rejects(inspectNativeArchive((await fixture({ tables: shaft })).bytes), /invalid_shaft_diameter/);
});

function nativeNote() {
  return { id: 'note', sessionId: 'session-stable', blockId: 'block-stable', endId: 'end-stable', localDate: '2026-11-11',
    body: 'Keep notes', tagsJson: '["form"]', place: '', feeling: '', conditions: '', createdAtMs: 1234, updatedAtMs: 1234, revision: 1, deletedAtMs: null };
}
test('native diary notes validate parent links, exact dates, tags and nonempty content', async () => {
  const tables = structuredClone(core), note = nativeNote(); tables[journal('diary_notes')] = [note];
  assert.equal((await inspectNativeArchive((await fixture({ tables })).bytes)).summary.totalRows, 5);
  note.tagsJson = '["form","FORM"]';
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /invalid_note_tags/);
  note.tagsJson = '[]'; note.body = '';
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /empty_diary_note/);
  note.body = 'Keep notes'; note.localDate = '2026-02-30';
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /invalid_note_date/);
  note.localDate = '2026-11-11';
  tables[journal('blocks')].push({ ...tables[journal('blocks')][0], id: 'second-block', ordinal: 1 });
  note.blockId = 'second-block';
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /invalid_note_end_link/);
});

function equipmentItem() {
  return { id: 'bow', kind: 'bow', name: 'Native bow', category: 'recurve', model: null, notes: null,
    drawWeightLb: null, drawLengthIn: null, spine: null, lengthMm: null, massGrain: null, diameterMm: null,
    numberedCount: null, bowId: null, arrowsId: null, favorite: 0, archived: 0, revision: 1, createdAtMs: 1, updatedAtMs: 1 };
}
test('equipment validates current revision history and snapshot identity', async () => {
  const tables = structuredClone(core); tables['data/equipment/equipment_items.jsonl'] = [equipmentItem()];
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /missing_equipment_revision/);
  const revision = { itemId: 'bow', revision: 1, snapshotJson: '{"id":"bow","revision":1}', changedAtMs: 1 };
  tables['data/equipment/equipment_revisions.jsonl'] = [revision];
  assert.equal((await inspectNativeArchive((await fixture({ tables })).bytes)).summary.equipmentItems, 1);
  revision.snapshotJson = '{"id":"wrong","revision":1}';
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /equipment_snapshot_mismatch/);
});

function techniqueText() {
  return JSON.stringify({ schema: 1, title: 'Technique', context: '', description: '', phases: [], discussed: null, change: '' });
}
test('technique versions require native ordering, a published primary document and valid authored payloads', async () => {
  const tables = structuredClone(core);
  tables[journal('technique_documents')] = [{ id: 'doc', draftJson: techniqueText(), updatedAtMs: 1, archived: 0, isPrimary: 1 }];
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /unpublished_primary_technique/);
  const version = { id: 'version', documentId: 'doc', number: 2, createdAtMs: 1, payloadJson: techniqueText() };
  tables[journal('technique_versions')] = [version];
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /invalid_technique_version_order/);
  version.number = 1;
  assert.equal((await inspectNativeArchive((await fixture({ tables })).bytes)).summary.sessions, 1);
  version.payloadJson = '{}';
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /invalid_technique_payload/);
});

test('PG1 validates frozen source aggregates, eligibility and current-session exclusion', async () => {
  const tables = structuredClone(core);
  const sources = Array.from({ length: 3 }, (_, index) => ({ sessionId: `earlier-${index}`, revision: 1, title: 'Earlier', count: 12, sum: 108,
    startedAtMs: 100, completedAtMs: 500, sourceKind: 'native' }));
  const baseline = { blockId: 'block-stable', baselineId: 'baseline', policyVersion: 'progress-pg1-v1', frozenAtMs: 1500,
    sessionStartCutoffMs: 1000, conditionsJson: JSON.stringify({ distanceMeters: 18, diameterMm: 800, profileId: 'wa-outdoor-full-v1',
      profileVersion: 1, geometry: 'single-circle-main', rule: 'wa-outdoor-point-v1', maximumPerArrow: 10, bowCategory: 'recurve' }),
    maximumPerArrow: 10, status: 'ready', sourceSessionsJson: JSON.stringify(sources), scoredCount: 36, scoreSum: 324 };
  tables[journal('progress_baselines')] = [baseline];
  assert.equal((await inspectNativeArchive((await fixture({ tables })).bytes)).summary.sessions, 1);
  baseline.scoreSum = 325;
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /invalid_progress_aggregate/);
  baseline.scoreSum = 324; sources[0].sessionId = 'session-stable'; baseline.sourceSessionsJson = JSON.stringify(sources);
  await assert.rejects(inspectNativeArchive((await fixture({ tables })).bytes), /progress_includes_current_session/);
});

test('native known preference contracts enforce types, values and complete preset validity', async () => {
  for (const values of [{ displayName: { type: 'boolean', value: true } }, { designStyle: { type: 'string', value: 'unknown' } },
    { series_timer_seconds_v1: { type: 'int', value: 0 } }, { rank_category_v1: { type: 'string', value: 'any' } },
    { shooting_base_minutes_v1: { type: 'long', value: -1 } }, { training_presets_v1: { type: 'string', value: '{}' } }]) {
    await assert.rejects(inspectNativeArchive((await fixture({ raw: { 'data/preferences.json': encode(JSON.stringify({ format: 1, values })) } })).bytes));
  }
  const raw = encode('{"format":1,"values":{"onboardingCompletedVersion":{"type":"int","value":1.0}}}');
  await assert.rejects(inspectNativeArchive((await fixture({ raw: { 'data/preferences.json': raw } })).bytes), /invalid_integer_value/);
});

test('IANA timezone registry and genuinely unknown target geometry remain explicit unverified domains', async () => {
  const tables = structuredClone(core); tables[journal('sessions')][0].timeZoneId = 'Asia/Novosibirsk';
  tables[journal('blocks')][0].targetProfileId = 'future-native-profile';
  tables[journal('shots')][0].shaftDiameterMm = null;
  const result = await inspectNativeArchive((await fixture({ tables })).bytes);
  assert.deepEqual(result.summary.unverified, ['java-zone-id-registry', 'unknown-target-geometry']);
});

async function sourceFixture(bytes: Uint8Array, hash: string) {
  const path = 'sources/12345678-1234-1234-1234-123456789abc.csv.gz';
  return fixture({ tables: { [journal('import_batches')]: [{ id: 'batch', source: 'mytargets', fileHash: hash, parserVersion: 'v1',
    importedAtMs: 1, sourceName: null, rawSourcePath: path.replace('sources/', 'imports/'), status: 'committed' }] }, raw: { [path]: bytes } });
}
test('nested raw-source hashes, member CRC and ISIZE are verified after envelope checks', async () => {
  const csv = encode('raw,csv\n'), wrapped = gzipSync(csv), hash = await digest(csv);
  await assert.rejects(inspectNativeArchive((await sourceFixture(wrapped, '0'.repeat(64))).bytes), /import_source_checksum_mismatch/);
  const crc = wrapped.slice(); crc[crc.length - 8] ^= 1;
  await assert.rejects(inspectNativeArchive((await sourceFixture(crc, hash)).bytes), /invalid_import_source_gzip/);
  const size = wrapped.slice(); size[size.length - 4] ^= 1;
  await assert.rejects(inspectNativeArchive((await sourceFixture(size, hash)).bytes), /invalid_import_source_gzip/);
  const a = gzipSync(encode('raw,')), b = gzipSync(encode('csv\n')), joined = new Uint8Array(a.length + b.length);
  joined.set(a); joined.set(b, a.length);
  assert.equal((await inspectNativeArchive((await sourceFixture(joined, hash)).bytes)).summary.sourceFiles, 1);
});

test('nested gzip expansion obeys the native 25 MiB limit even with a forged zero ISIZE', async () => {
  const compressed = gzipSync(new Uint8Array(26 * 1024 * 1024));
  compressed.fill(0, compressed.length - 4);
  await assert.rejects(inspectNativeArchive((await sourceFixture(compressed, '0'.repeat(64))).bytes), /import_source_too_large/);
});
