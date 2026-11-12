import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import type { EquipmentLibrary } from '../src/equipment.ts';
import { mergeMyTargets } from '../src/mytargets-conversion.ts';
import { MYTARGETS_HEADERS, parseMyTargets } from '../src/mytargets-import.ts';
import type { MyTargetsPreview, MyTargetsSeries } from '../src/mytargets-import.ts';
import { isDiary } from '../src/persistence.ts';
import type { Diary } from '../src/persistence.ts';
import { appendShot, emptyPractice } from '../src/practice.ts';

const importedAt = '2026-11-11T10:00:00.000Z';
const options = { importedAt };
const emptyDiary = (): Diary => ({ version: 1, entries: [] });
const emptyEquipment = (): EquipmentLibrary => ({ bows: [], arrows: [], kits: [] });
function end(id: string, records: number[], fingerprint = id): MyTargetsSeries {
  return { sourceId: id, sourceNumber: id, timestamp: '12:00', fingerprint, overlapFingerprint: `overlap:${id}`,
    shots: records.map(record => ({ sourceId: `${id}:s${record}`, sourceRecord: record, points: 9, code: '9',
      point: null, rawPoint: { x: 0, y: 0 } })) };
}
function preview(): MyTargetsPreview {
  return { sourceFormat: 'zip', fileHash: 'a'.repeat(64), parserVersion: 'test-v1', byteLength: 200,
    sessions: [{ sourceId: 't1', title: '  Original title  ', rawDate: '2025-01-02', localDate: '2025-01-02',
      standardRound: '', environment: 'Indoor', fingerprint: 'session-1', rounds: [{ sourceId: 't1:r1',
        conditions: structuredClone(DEFAULT_CONDITIONS), rawConditions: { round: '1', distance: '18 m', target: 'WA (40 cm)',
          bow: '', arrows: '', distanceMeters: 18, targetDiameterMm: 400, sourceTargetId: 0, sourceScoringStyle: 1 },
        plannedArrows: 6, series: [end('t1:r1:e1', [1, 2])] }] }],
    equipment: emptyEquipment(), equipmentSourceRows: [], warnings: [], requiredConfirmations: [], skippedEmptySlots: 4, ignoredAttachments: 0 };
}

test('merge preserves raw title, unknown coordinates, local date and import-time completion without retroactive evidence', () => {
  const source = preview();
  const result = mergeMyTargets(source, emptyDiary(), emptyEquipment(), options);
  assert.equal(result.addedTrainings, 1);
  assert.equal(result.addedShots, 2);
  assert.equal(result.skippedShots, 0);
  assert.equal(isDiary(result.diary), true);
  const entry = result.diary.entries[0];
  assert.equal(entry.title, source.sessions[0].title);
  assert.equal(entry.localDate, '2025-01-02');
  const placeholder = new Date(entry.startedAt);
  assert.equal(placeholder.getHours(), 12);
  assert.equal(placeholder.getFullYear(), 2025);
  assert.equal(placeholder.getMonth(), 0);
  assert.equal(placeholder.getDate(), 2);
  assert.equal(entry.practice.savedAt, importedAt);
  assert.equal(entry.practice.progressBaselines, undefined);
  assert.equal(entry.practice.techniqueUses, undefined);
  assert.deepEqual(entry.practice.rounds[0].series[0].shots[0], { points: 9, code: '9', point: null, imported: true, sourcePoint: { x: 0, y: 0 } });
  assert.deepEqual(entry.source, { kind: 'mytargets', fileHash: source.fileHash, parserVersion: 'test-v1', sessionId: 't1',
    sourceRecords: [1, 2], seriesFingerprints: ['t1:r1:e1'], overlapFingerprints: ['overlap:t1:r1:e1'] });
});

test('repeated import and changed grouping cannot reimport exact file/source records', () => {
  const source = preview();
  const first = mergeMyTargets(source, emptyDiary(), emptyEquipment(), options);
  source.sessions[0].sourceId = 'changed-boundary';
  const repeated = mergeMyTargets(source, first.diary, first.equipment, options);
  assert.equal(repeated.addedTrainings, 0);
  assert.equal(repeated.addedShots, 0);
  assert.equal(repeated.skippedShots, 2);
  assert.deepEqual(repeated.diary, first.diary);
  assert.equal(mergeMyTargets(source, first.diary, first.equipment, { ...options, allowOverlaps: true }).addedShots, 0);
  const stable = mergeMyTargets(preview(), emptyDiary(), emptyEquipment(), { importedAt: '2026-11-12T10:00:00Z' });
  assert.equal(stable.diary.entries[0].id, first.diary.entries[0].id);
});

test('unknown date requires acknowledgement and stays explicitly unknown after import', () => {
  const source = preview();
  source.sessions[0].localDate = null;
  source.requiredConfirmations = ['unknown_date:t1'];
  assert.throws(() => mergeMyTargets(source, emptyDiary(), emptyEquipment(), options), /confirmation_required:unknown_date:t1/);
  const result = mergeMyTargets(source, emptyDiary(), emptyEquipment(), { ...options, confirmedBoundaries: source.requiredConfirmations });
  assert.equal(result.diary.entries[0].startedAt, '');
  assert.equal(result.diary.entries[0].localDate, null);
  assert.equal(isDiary(result.diary), true);
});

test('sparse ends preserve source rounds and count only measured arrows', () => {
  const source = preview(), round = source.sessions[0].rounds[0];
  round.series.push(end('t1:r1:e8', [3]));
  source.sessions[0].rounds.push({ ...structuredClone(round), sourceId: 't1:r2', series: [end('t1:r2:e1', [4, 5, 6, 7])] });
  const result = mergeMyTargets(source, emptyDiary(), emptyEquipment(), options);
  const rounds = result.diary.entries[0].practice.rounds;
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds.map(round => round.series.map(series => [series.shots.length, series.plannedCount])), [[[2, 3], [1, 3]], [[4, 4]]]);
  assert.equal(result.addedShots, 7);
  assert.equal(result.skippedShots, 0);
});

test('selected sessions require only their own confirmations; explicit empty selection is a no-op', () => {
  const source = preview();
  source.sessions.push({ ...structuredClone(source.sessions[0]), sourceId: 't2' });
  source.requiredConfirmations = ['session_boundary:t1', 'session_boundary:t2'];
  assert.throws(() => mergeMyTargets(source, emptyDiary(), emptyEquipment(), { ...options, selectedSessionIds: ['t1'] }), /session_boundary:t1/);
  const result = mergeMyTargets(source, emptyDiary(), emptyEquipment(), { ...options, selectedSessionIds: ['t1'], confirmedBoundaries: ['session_boundary:t1'] });
  assert.equal(result.addedTrainings, 1);
  assert.equal(mergeMyTargets(source, emptyDiary(), emptyEquipment(), { ...options, selectedSessionIds: [] }).addedShots, 0);
  assert.throws(() => mergeMyTargets(source, emptyDiary(), emptyEquipment(), { ...options, selectedSessionIds: ['missing'] }), /unknown_selected_session/);
});

test('unknown conditions need a valid explicit override; all confirmation keys must still be acknowledged', () => {
  const source = preview();
  source.sessions[0].rounds[0].conditions = null;
  source.requiredConfirmations = ['conditions_mapping:t1:r1', 'csv_conditions_and_series_plan:t1:r1'];
  const acknowledged = { ...options, confirmedBoundaries: source.requiredConfirmations };
  assert.equal(mergeMyTargets(source, emptyDiary(), emptyEquipment(), acknowledged).skippedShots, 2);
  assert.throws(() => mergeMyTargets(source, emptyDiary(), emptyEquipment(), { ...options, conditionsOverrides: { 't1:r1': DEFAULT_CONDITIONS } }), /confirmation_required/);
  const result = mergeMyTargets(source, emptyDiary(), emptyEquipment(), { ...acknowledged, conditionsOverrides: { 't1:r1': DEFAULT_CONDITIONS } });
  assert.equal(result.addedShots, 2);
  assert.equal(result.diary.entries[0].practice.rounds[0].series[0].shots[0].point, null);
});

test('cross-file fingerprint or overlap matches need explicit allowOverlaps', () => {
  const first = mergeMyTargets(preview(), emptyDiary(), emptyEquipment(), options);
  for (const matchBy of ['fingerprint', 'overlapFingerprint'] as const) {
    const source = preview();
    source.fileHash = 'b'.repeat(64);
    const series = source.sessions[0].rounds[0].series[0];
    if (matchBy === 'fingerprint') series.overlapFingerprint = 'different-overlap';
    else series.fingerprint = 'different-scoring';
    const guarded = mergeMyTargets(source, first.diary, first.equipment, options);
    assert.equal(guarded.addedShots, 0);
    assert.equal(guarded.skippedShots, 2);
    assert.ok(guarded.warnings.some(warning => warning.code === 'possible_overlap'));
    const allowed = mergeMyTargets(source, first.diary, first.equipment, { ...options, allowOverlaps: true });
    assert.equal(allowed.addedShots, 2);
    assert.equal(allowed.diary.entries.length, 2);
  }
});

test('identical scores in different ends of the same file are preserved, duplicate source rows are not', () => {
  const source = preview(), series = source.sessions[0].rounds[0].series;
  series.push(end('t1:r1:e2', [2, 3, 3], series[0].fingerprint));
  const result = mergeMyTargets(source, emptyDiary(), emptyEquipment(), options);
  assert.equal(result.addedShots, 3);
  assert.equal(result.skippedShots, 2);
  assert.deepEqual(result.diary.entries[0].source!.sourceRecords, [1, 2, 3]);
  assert.equal(result.diary.entries[0].practice.rounds[0].series.length, 2);
});

test('blocked unsupported series are skipped and can be imported later after correcting source mapping', () => {
  const source = preview(), series = source.sessions[0].rounds[0].series;
  series.push(end('t1:r1:e2', [3]));
  source.warnings = [{ code: 'unsupported_archive_score', sourceId: series[1].sourceId, blocking: true }];
  const first = mergeMyTargets(source, emptyDiary(), emptyEquipment(), options);
  assert.equal(first.addedShots, 2);
  assert.equal(first.skippedShots, 1);
  source.warnings = [];
  const second = mergeMyTargets(source, first.diary, first.equipment, options);
  assert.equal(second.addedShots, 1);
  assert.equal(second.skippedShots, 2);
  assert.notEqual(second.diary.entries[0].id, second.diary.entries[1].id);
  assert.equal(isDiary(second.diary), true);
});

test('unsupported shots are never converted to misses and invalid coordinates do not become hit locations', () => {
  const source = preview(), shots = source.sessions[0].rounds[0].series[0].shots;
  shots[0].points = null;
  shots[0].code = null;
  shots[1].point = { x: 100, y: 100 };
  const result = mergeMyTargets(source, emptyDiary(), emptyEquipment(), options);
  assert.equal(result.addedShots, 1);
  assert.equal(result.skippedShots, 1);
  assert.equal(result.diary.entries[0].practice.rounds[0].series[0].shots[0].point, null);
  assert.deepEqual(result.diary.entries[0].source!.sourceRecords, [2]);
});

test('old entries and equipment survive; equipment IDs merge idempotently and conflict atomically', () => {
  const oldDiary: Diary = { version: 1, entries: [{ id: 'native', startedAt: importedAt, practice: appendShot(emptyPractice(), { points: 0, code: 'M', point: null }) }] };
  const oldEquipment: EquipmentLibrary = { bows: [{ id: 'old', name: 'My bow', category: 'barebow' }], arrows: [], kits: [] };
  const source = preview();
  source.equipment.bows.push({ id: 'new', name: 'Imported bow', category: null });
  const before = structuredClone({ oldDiary, oldEquipment, source });
  const result = mergeMyTargets(source, oldDiary, oldEquipment, options);
  assert.deepEqual(result.diary.entries[0], oldDiary.entries[0]);
  assert.deepEqual(result.equipment.bows, [...oldEquipment.bows, ...source.equipment.bows]);
  assert.deepEqual({ oldDiary, oldEquipment, source }, before);
  assert.equal(mergeMyTargets(source, emptyDiary(), result.equipment, options).equipment.bows.length, 2);
  source.equipment.bows.push({ id: 'old', name: 'Changed name', category: 'barebow' });
  assert.throws(() => mergeMyTargets(source, oldDiary, oldEquipment, options), /equipment_id_conflict:old/);
  assert.deepEqual(oldDiary, before.oldDiary);
  assert.deepEqual(oldEquipment, before.oldEquipment);
});

test('duplicate physical arrow numbers lose only numbering and retain their measured scores', () => {
  const source = preview(), shots = source.sessions[0].rounds[0].series[0].shots;
  for (const shot of shots) shot.physicalArrowNumber = 7;
  const result = mergeMyTargets(source, emptyDiary(), emptyEquipment(), options);
  const imported = result.diary.entries[0].practice.rounds[0].series[0].shots;
  assert.deepEqual(imported.map(shot => shot.physicalArrowNumber), [7, undefined]);
  assert.equal(isDiary(result.diary), true);
  assert.equal(result.addedShots, 2);
});

test('CSV named equipment survives explicit conditions mapping and remains idempotent across imports', async () => {
  const source = await parseMyTargets(new TextEncoder().encode([MYTARGETS_HEADERS.join(';'),
    ['Equipment CSV', '2025-01-02', '', 'Indoor', 'Named recurve', 'Named carbon', '1', '18m', 'Unmapped target', '1', '12:00', '9', '7', '', ''].join(';'),
  ].join('\r\n')));
  const original = structuredClone(source);
  const round = source.sessions[0].rounds[0];
  assert.equal(round.conditions, null);
  const mergeOptions = { ...options, confirmedBoundaries: source.requiredConfirmations, conditionsOverrides: { [round.sourceId]: DEFAULT_CONDITIONS } };
  const result = mergeMyTargets(source, emptyDiary(), emptyEquipment(), mergeOptions);
  assert.equal(result.addedShots, 1);
  assert.equal(result.equipment.bows.length, 1);
  assert.equal(result.equipment.arrows.length, 1);
  assert.equal(result.equipment.kits.length, 1);
  const series = result.diary.entries[0].practice.rounds[0].series[0];
  assert.equal(series.conditions.equipment?.id, result.equipment.kits[0].id);
  assert.equal(series.conditions.equipment?.bow.category, null);
  assert.equal(series.conditions.equipment?.arrows.diameterMm, null);
  assert.equal(series.conditions.equipment?.arrows.numberedCount, undefined);
  assert.equal(series.shots[0].physicalArrowNumber, 7);
  assert.equal(isDiary(result.diary), true);
  const repeated = mergeMyTargets(source, result.diary, result.equipment, mergeOptions);
  assert.equal(repeated.addedShots, 0);
  assert.deepEqual(repeated.equipment, result.equipment);
  assert.deepEqual(source, original);
});
