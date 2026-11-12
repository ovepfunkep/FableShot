import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNativeConversion, nativeTargetIsMapped } from '../src/native-conversion.ts';
import { buildNativeRecords } from '../src/native-activation.ts';
import { recentAchievementNotices } from '../src/achievement-ledger.ts';
import { achievementValidity } from '../src/achievement-validity.ts';
import { nativeArchiveTablePaths } from '../src/native-archive.ts';
import type { NativeArchiveInspection, NativeArchiveRow } from '../src/native-archive.ts';
import { conditionsKey } from '../src/composite-scoring.ts';
import { getTargetProfile } from '../src/target.ts';
import { DIARY_KEY, isDiary } from '../src/persistence.ts';
import type { Diary } from '../src/persistence.ts';
import { isPreset } from '../src/conditions.ts';
import { DEFAULT_PREFERENCES, valid as validPreferences } from '../src/preferences.ts';
import { isTechniqueLibrary } from '../src/technique.ts';
import { calculateProgress, progressSourceChanges } from '../src/progress-scoring.ts';

const path = (name: string) => `data/journal/${name}.jsonl`;
function snapshot() {
  return JSON.stringify({ snapshotVersion: 1, profileId: 'wa-indoor-outer-v1', profileVersion: 1, geometryType: 'circle',
    scoringRuleVersion: 'wa-indoor-outer-point-v1', boundaryRule: 'greater-score', boundaryEpsilon: 1e-9,
    diameterMm: 400, supportsX: false, faces: [{ faceId: 'main', zones: getTargetProfile('wa-indoor-outer-v1')!.zones.map(zone => ({ ...zone, isX: zone.code === 'X' })) }] });
}
function fixture(endCount = 4, schema = 16): NativeArchiveInspection {
  const tables = Object.fromEntries(nativeArchiveTablePaths(schema).map(name => [name, []])) as Record<string, NativeArchiveRow[]>;
  const at = Date.parse('2026-11-11T12:00:00Z');
  tables[path('sessions')] = [{ id: 'native-session', title: 'Native', localDate: '2026-11-11', createdAtMs: at,
    completedAtMs: at + 3600_000, startedAtMs: at, timeSource: 'app_clock', state: 'completed', sourceKind: 'native',
    deletedAtMs: null, numberedArrows: 1, revision: 1, kind: 'training' }];
  tables[path('blocks')] = [{ id: 'native-block', sessionId: 'native-session', ordinal: 0, mode: 'scored', distanceMeters: 18,
    targetProfileId: 'wa-indoor-outer-v1', targetProfileVersion: 1, targetDiameterMm: 400, targetSnapshotJson: snapshot(), equipmentSnapshotJson: null,
    defaultArrowsPerEnd: 3, revision: 1 }];
  tables[path('ends')] = Array.from({ length: endCount }, (_, index) => ({ id: `end-${index}`, blockId: 'native-block', ordinal: index,
    plannedCount: 3, role: 'scored', state: 'closed', startsRound: 0, revision: 1 }));
  tables[path('shots')] = tables[path('ends')].flatMap((end, endIndex) => Array.from({ length: 3 }, (_, index) => ({ id: `shot-${endIndex}-${index}`,
    endId: end.id, inputIndex: index, points: 9, zoneCode: '9', x: index / 10, y: .25, faceId: 'main', positionStatus: 'known',
    positionSource: 'manual_target', physicalArrowNumber: index + 1, scoreSource: 'manual_edit', createdAtMs: at, shaftDiameterMm: 5.5, revision: 1 })));
  if (schema >= 5) tables[path('session_plans')] = [{ sessionId: 'native-session', plannedEnds: endCount, roundCount: 2, rolling: 0, roundArrowLimit: null }];
  if (schema >= 9) tables[path('diary_notes')] = [note('note', { body: 'Do not lose notes', tagsJson: '["form"]', futureField: 'retained' })];
  return { manifest: { formatVersion: schema - 2, journalSchema: schema, equipmentSchema: 1, preferencesFormat: 1,
    createdAtMs: at, appVersion: '0.15.0', rowCounts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])), payloads: [] },
    tables, preferences: { format: 1, values: {} }, sources: {}, summary: { sessions: 1, blocks: 1, ends: endCount, shots: endCount * 3,
      unscoredArrows: 0, equipmentItems: 0, sourceFiles: 0, totalRows: 0, verifiedBytes: 0, validation: 'envelope-and-core-relations', unverified: ['android-domain-facts'] } };
}
const first = (inspection: NativeArchiveInspection) => buildNativeConversion(inspection).candidates[0];

const archive = { sha256: 'a'.repeat(64), bytes: 1024 };

test('Android PG1 keeps frozen scores and distinguishes changed and unavailable sources', () => {
  const inspection = fixture();
  const session = inspection.tables[path('sessions')][0];
  const block = inspection.tables[path('blocks')][0];
  const start = Number(session.startedAtMs);
  const bow = { id: 'bow', name: 'Bow', category: 'recurve' };
  const arrows = { id: 'arrows', name: 'Carbon', diameterMm: 5.5, numberedCount: 12 };
  const selection = { id: 'kit', name: 'Kit', bowId: 'bow', arrowsId: 'arrows' };
  block.equipmentSnapshotJson = JSON.stringify({ schema: 1, selection, bow, arrows });
  const sources = ['same', 'revised', 'unavailable'].map((id, index) => {
    const startedAtMs = start - (index + 1) * 86_400_000;
    const completedAtMs = startedAtMs + 3600_000;
    if (id !== 'unavailable') {
      const blockId = `block-${id}`;
      inspection.tables[path('sessions')].push({ ...session, id, startedAtMs, completedAtMs, revision: id === 'same' ? 1 : 2 });
      inspection.tables[path('blocks')].push({ ...block, id: blockId, sessionId: id });
      for (const end of inspection.tables[path('ends')].filter(end => end.blockId === block.id)) {
        const endId = `${id}-${end.id}`;
        inspection.tables[path('ends')].push({ ...end, id: endId, blockId });
        const shots = inspection.tables[path('shots')].filter(shot => shot.endId === end.id);
        inspection.tables[path('shots')].push(...shots.map(shot => ({ ...shot, id: `${id}-${shot.id}`, endId })));
      }
    }
    return { sessionId: id, startedAtMs, completedAtMs, revision: 1, count: 12, sum: 108 };
  });
  inspection.tables[path('progress_baselines')] = [{
    blockId: block.id, baselineId: 'pg1', policyVersion: 'progress-pg1-v1', frozenAtMs: start, sessionStartCutoffMs: start,
    conditionsJson: JSON.stringify({ distanceMeters: 18, diameterMm: 400, profileId: 'wa-indoor-outer-v1',
      geometry: 'single-circle-main', maximumPerArrow: 10, bowCategory: 'recurve' }),
    maximumPerArrow: 10, status: 'ready', sourceSessionsJson: JSON.stringify(sources), scoredCount: 36, scoreSum: 324,
  }];
  const result = buildNativeRecords(buildNativeConversion(inspection), archive);
  const diary: Diary = JSON.parse(result.records[DIARY_KEY]!);
  assert.equal(result.retained.progressBaselines, 0);
  const practice = diary.entries.find(entry => entry.id === session.id)!.practice;
  const series = practice.rounds.flatMap(round => round.series);
  const baseline = practice.progressBaselines![series[0].progressBaselineId!];
  assert.equal(calculateProgress(baseline, series)?.baselineAverage, 9);
  assert.deepEqual(progressSourceChanges(baseline, diary.entries), [
    { sessionId: 'revised', status: 'changed' }, { sessionId: 'unavailable', status: 'unavailable' },
  ]);
  diary.entries.find(entry => entry.id === 'same')!.practice.rounds[0].series[0].shots[0].point!.x += .01;
  assert.equal(progressSourceChanges(baseline, diary.entries)[0].sessionId, 'same');
  assert.equal(baseline.scoreSum, 324);
});

test('activation projection retains precise dates, note scope, technique, and achievement receipt without awarding from history', () => {
  const inspection = fixture();
  const source = inspection.tables[path('sessions')][0];
  source.deletedAtMs = Number(source.completedAtMs) + 1;
  inspection.tables[path('technique_uses')] = [{ id: 'use', sessionId: source.id, sequence: 1, blockOrdinal: 0, endOrdinal: 0,
    versionId: null, focus1: 'Выдох', focus2: '', worked: 'Спокойно', question: '', rating: 'yes' }];
  inspection.tables[path('achievement_grants')] = [{ key: 'START01:global', ruleId: 'START01', scope: 'global', ruleVersion: 1,
    sessionId: source.id, earnedAtMs: source.completedAtMs, notifiedAtMs: null, valid: 1 }];
  inspection.tables[path('progress_baselines')] = [{ baselineId: 'frozen-android' }];
  inspection.tables[path('personal_record_events')] = [{ id: 'native-record', sessionId: source.id,
    kind: 'volume', ruleVersion: 1, label: 'Стрел за тренировку', previousValue: 9, value: 12,
    previousSessionId: 'earlier', sessionRevision: 1, recordedAtMs: source.completedAtMs, notifiedAtMs: null }];
  const conversion = buildNativeConversion(inspection);
  const result = buildNativeRecords(conversion, archive);
  const diary: Diary = JSON.parse(result.records[DIARY_KEY]!);
  assert.deepEqual(diary.nativeArchive, archive);
  assert.ok(isDiary(diary));
  assert.equal(diary.entries[0].nativeArchiveSession, source.id);
  assert.equal(diary.entries[0].deletedAt, new Date(Number(source.deletedAtMs)).toISOString());
  assert.equal(diary.entries[0].notes?.[0].body, 'Do not lose notes');
  assert.equal(diary.entries[0].practice.techniqueUses?.[0].arrowsBefore, null);
  assert.equal(diary.entries[0].practice.techniqueReflections?.['0'].worked, 'Спокойно');
  assert.equal(diary.entries[0].achievementEnrollment, undefined);
  assert.deepEqual(diary.entries[0].personalRecords, inspection.tables[path('personal_record_events')]);
  assert.equal(result.retained.recordReceipts, 0);
  assert.equal(achievementValidity(diary).get('START01:global'), true);
  assert.deepEqual(recentAchievementNotices(diary.achievementLedger, Number(source.completedAtMs)), []);
  assert.equal(result.retained.notes, 0);
  assert.equal(result.retained.techniqueUses, 0);
  assert.equal(result.retained.progressBaselines, 1);
});

test('activation projection does not present a paused Android session as an active web session', () => {
  const inspection = fixture();
  inspection.tables[path('sessions')][0].state = 'paused';
  inspection.tables[path('sessions')][0].completedAtMs = null;
  const conversion = buildNativeConversion(inspection);
  assert.ok(conversion.candidates[0].practice);
  const result = buildNativeRecords(conversion, archive);
  assert.equal(result.summary.trainings, 1);
  assert.equal(result.retained.sessions, 0);
  const diary: Diary = JSON.parse(result.records[DIARY_KEY]!);
  assert.equal(diary.entries[0].paused, true);
  assert.equal(diary.entries[0].practice.savedAt, null);
  assert.ok(isDiary(diary));
});

test('native saved plan reconstructs rounds and keeps stable native locations with a valid web practice', () => {
  const inspection = fixture(), candidate = first(inspection);
  assert.deepEqual(candidate.blockers, []); assert.ok(candidate.practice);
  assert.deepEqual(candidate.practice.rounds.map(round => round.series.length), [2, 2]);
  assert.deepEqual(candidate.practice.roundRule, { unit: 'series', limit: 2 });
  assert.equal(candidate.roundLocations['end-2'].round, 2); assert.equal(candidate.roundLocations['end-3'].series, 2);
  assert.equal(candidate.sourceId, 'native-session'); assert.equal(candidate.timeSource, 'app_clock');
  assert.equal(isDiary({ version: 1, entries: [{ id: 'projection', startedAt: '2026-11-11T12:00:00Z', practice: candidate.practice }] }), true);
});

test('native Y-up positions are reversed exactly once; scores are retained and raw source facts stay unchanged', () => {
  const inspection = fixture(), before = JSON.stringify(inspection), result = buildNativeConversion(inspection), candidate = result.candidates[0];
  const shot = candidate.practice!.rounds[0].series[0].shots[0];
  assert.deepEqual(shot.point, { x: 0, y: -.25 }); assert.equal(shot.points, 9); assert.equal(shot.imported, true);
  assert.equal(shot.physicalArrowNumber, 1); assert.equal('sourcePoint' in shot, false);
  assert.equal(result.inspection, inspection); assert.equal(candidate.retainedFacts.shots[0], inspection.tables[path('shots')][0]);
  assert.equal(candidate.retainedFacts.shots[0].y, .25); assert.equal(candidate.retainedFacts.shots[0].shaftDiameterMm, 5.5);
  assert.equal(JSON.stringify(inspection), before);
});

test('notes and other unmodeled facts remain referenced in the original inspection', () => {
  const inspection = fixture(); inspection.tables[path('rank_assignments')] = [{ id: 'rank', reference: 'Original rank fact' }];
  const result = buildNativeConversion(inspection);
  assert.equal(result.candidates[0].retainedFacts.notes[0], inspection.tables[path('diary_notes')][0]);
  assert.equal(result.candidates[0].retainedFacts.notes[0].futureField, 'retained');
  assert.equal(result.inspection.tables[path('rank_assignments')][0].reference, 'Original rank fact');
});

test('explicit round boundaries override the planned series limit and rolling arrow plans stay intact', () => {
  const inspection = fixture();
  inspection.tables[path('session_plans')][0] = { sessionId: 'native-session', plannedEnds: 0, roundCount: 1, rolling: 1, roundArrowLimit: 9 };
  inspection.tables[path('ends')][2].startsRound = 1;
  const candidate = first(inspection); assert.deepEqual(candidate.blockers, []);
  assert.deepEqual(candidate.practice!.rounds.map(round => round.series.length), [2, 2]);
  assert.deepEqual(candidate.practice!.roundRule, { unit: 'arrows', limit: 9 });
});

test('condition changes keep native ordering across blocks and do not create invented round boundaries', () => {
  const inspection = fixture(), blocks = inspection.tables[path('blocks')];
  blocks.push({ ...blocks[0], id: 'second-block', ordinal: 1, distanceMeters: 25 });
  inspection.tables[path('ends')][2].blockId = 'second-block'; inspection.tables[path('ends')][2].ordinal = 0;
  inspection.tables[path('ends')][3].blockId = 'second-block'; inspection.tables[path('ends')][3].ordinal = 1;
  const candidate = first(inspection); assert.deepEqual(candidate.blockers, []);
  assert.deepEqual(candidate.practice!.rounds.map(round => round.series.map(series => series.conditions.distanceMeters)), [[18, 18], [25, 25]]);
});

test('native MyTargets source round keys supersede plan chunks just as roundLocations does', () => {
  const inspection = fixture(); inspection.tables[path('sessions')][0].sourceKind = 'mytargets';
  inspection.tables[path('session_plans')][0].roundCount = 4;
  const blocks = inspection.tables[path('blocks')];
  const a = { ...JSON.parse(snapshot()), sourceFormat: 'mytargets-zip-v27', sourceRoundKey: 'round-a' };
  blocks[0].targetSnapshotJson = JSON.stringify(a);
  blocks.push({ ...blocks[0], id: 'second-block', ordinal: 1, targetSnapshotJson: JSON.stringify({ ...a, sourceRoundKey: 'round-b' }) });
  inspection.tables[path('ends')].slice(2).forEach((end, index) => { end.blockId = 'second-block'; end.ordinal = index; });
  const candidate = first(inspection); assert.deepEqual(candidate.blockers, []);
  assert.deepEqual(candidate.practice!.rounds.map(round => round.series.length), [2, 2]);
  assert.deepEqual(candidate.practice!.roundRule, { unit: 'unlimited', limit: null });
});

test('historical schema defaults come from native migrations without inventing a current rolling plan', () => {
  const inspection = fixture(4, 5);
  inspection.tables[path('session_plans')][0] = { sessionId: 'native-session', plannedEnds: 4 };
  inspection.tables[path('ends')].forEach(end => { delete end.startsRound; });
  delete inspection.tables[path('sessions')][0].numberedArrows;
  const candidate = first(inspection); assert.deepEqual(candidate.blockers, []);
  assert.equal(candidate.practice!.rounds.length, 1); assert.equal(candidate.practice!.numberedArrows, null);
  assert.deepEqual(candidate.practice!.roundRule, { unit: 'series', limit: 4 });
});

test('unknown positions remain null; unverified positions and miss coordinates block projection rather than losing coordinates', () => {
  const inspection = fixture(), shot = inspection.tables[path('shots')][0];
  shot.x = null; shot.y = null; shot.positionStatus = 'unknown'; shot.positionSource = 'none';
  const mapped = first(inspection); assert.deepEqual(mapped.blockers, []); assert.equal(mapped.practice!.rounds[0].series[0].shots[0].point, null);
  shot.x = .1; shot.y = .2; shot.positionStatus = 'unverified';
  assert.equal(first(inspection).practice, null); assert.ok(first(inspection).blockers.includes('unverified_position'));
  shot.positionStatus = 'known'; shot.points = 0; shot.zoneCode = 'M';
  assert.ok(first(inspection).blockers.includes('miss_coordinates_not_representable'));
});

test('unsupported count-only, warmup, short plans and mismatched target geometry become explicit blockers', () => {
  const count = fixture(); count.tables[path('blocks')][0].mode = 'count_only';
  assert.equal(first(count).practice, null); assert.ok(first(count).blockers.includes('unsupported_count_only'));
  const warmup = fixture(); warmup.tables[path('ends')][0].role = 'warmup';
  assert.ok(first(warmup).blockers.includes('warmup_not_representable'));
  const small = fixture(); small.tables[path('ends')][0].plannedCount = 2;
  assert.ok(first(small).blockers.includes('unsupported_planned_count'));
  const geometry = fixture(), block = geometry.tables[path('blocks')][0], source = JSON.parse(String(block.targetSnapshotJson));
  assert.equal(nativeTargetIsMapped(block), true); source.faces[0].zones[0].outerRadius = .99; block.targetSnapshotJson = JSON.stringify(source);
  assert.equal(nativeTargetIsMapped(block), false); assert.ok(first(geometry).blockers.includes('unmapped_target_geometry'));
});

test('missing completion time, deleted state and unknown dates are never repaired with the current time', () => {
  const inspection = fixture(), session = inspection.tables[path('sessions')][0];
  session.localDate = null; session.timeSource = 'import_unknown'; session.deletedAtMs = session.completedAtMs;
  const candidate = first(inspection); assert.equal(candidate.localDate, null); assert.equal(candidate.deleted, true);
  assert.equal(candidate.timeSource, 'import_unknown'); assert.equal(candidate.state, 'completed');
  session.completedAtMs = null;
  assert.equal(first(inspection).practice, null); assert.ok(first(inspection).blockers.includes('unknown_completion_timestamp'));
});

test('known equipment snapshots map class and shaft data while catalog source fields remain retained', () => {
  const inspection = fixture(), bow = { id: 'bow', kind: 'bow', name: 'Bow', category: 'recurve', revision: 1, notes: 'Native catalog note' },
    arrows = { id: 'arrows', kind: 'arrows', name: 'Carbon', diameterMm: 5.5, numberedCount: 12, revision: 1 },
    setup = { id: 'setup', kind: 'setup', name: 'Kit', bowId: 'bow', arrowsId: 'arrows', revision: 1 };
  inspection.tables['data/equipment/equipment_items.jsonl'] = [bow, arrows, setup];
  inspection.tables[path('blocks')][0].equipmentSnapshotJson = JSON.stringify({ schema: 1, selection: setup, bow, arrows });
  const result = buildNativeConversion(inspection), conditions = result.candidates[0].practice!.rounds[0].series[0].conditions;
  assert.equal(conditions.equipment!.id, 'setup'); assert.equal(conditions.equipment!.bow.category, 'recurve');
  assert.equal(conditions.equipment!.arrows.diameterMm, 5.5); assert.equal(conditions.equipment!.arrows.numberedCount, 12);
  assert.equal(result.equipmentCandidates.length, 3); assert.ok(result.equipmentCandidates.every(candidate => candidate.item && !candidate.blockers.length));
  assert.equal(result.equipmentCandidates[0].retainedFacts, bow); assert.equal(result.equipmentCandidates[0].retainedFacts.notes, 'Native catalog note');
});

test('unnumbered Android arrows use SQL null in catalogs and equipment snapshots', () => {
  const inspection = fixture();
  const bow = { id: 'bow', kind: 'bow', name: 'Bow', category: 'barebow', revision: 1 };
  const arrows = { id: 'arrows', kind: 'arrows', name: 'Carbon', diameterMm: null, numberedCount: null as number | null, revision: 1 };
  const setup = { id: 'setup', kind: 'setup', name: 'Kit', bowId: 'bow', arrowsId: 'arrows', revision: 1 };
  inspection.tables['data/equipment/equipment_items.jsonl'] = [bow, arrows, setup];
  inspection.tables[path('blocks')][0].equipmentSnapshotJson = JSON.stringify({ schema: 1, selection: setup, bow, arrows });
  const result = buildNativeConversion(inspection);
  assert.deepEqual(result.candidates[0].blockers, []);
  const snapshot = result.candidates[0].practice!.rounds[0].series[0].conditions.equipment!;
  assert.equal(snapshot.arrows.numberedCount, undefined);
  assert.equal(snapshot.arrows.diameterMm, null);
  assert.equal(snapshot.bow.category, 'barebow');
  assert.equal(result.catalogs.equipment!.arrows[0].numberedCount, undefined);
  assert.equal(result.candidates[0].retainedFacts.blocks[0].equipmentSnapshotJson, inspection.tables[path('blocks')][0].equipmentSnapshotJson);
  const records = buildNativeRecords(result, archive);
  const restored: Diary = JSON.parse(records.records[DIARY_KEY]!);
  assert.equal(restored.entries.length, 1);
  assert.equal(restored.entries[0].practice.rounds.flatMap(round => round.series).reduce((n, series) => n + series.shots.length, 0), 12);
  arrows.numberedCount = 0;
  inspection.tables[path('blocks')][0].equipmentSnapshotJson = JSON.stringify({ schema: 1, selection: setup, bow, arrows });
  assert.ok(first(inspection).blockers.includes('unmapped_equipment_snapshot'));
});

test('compatible technique documents and versions map without replacing their source identities or payloads', () => {
  const inspection = fixture(), text = { schema: 1, title: 'Technique', context: '', description: 'Native text', phases: [], discussed: null, change: '' };
  inspection.tables[path('technique_documents')] = [{ id: 'technique', draftJson: JSON.stringify(text), updatedAtMs: 1234, archived: 0, isPrimary: 1 }];
  inspection.tables[path('technique_versions')] = [{ id: 'version', documentId: 'technique', number: 1, createdAtMs: 1234, payloadJson: JSON.stringify(text) }];
  const [candidate] = buildNativeConversion(inspection).techniqueCandidates;
  assert.deepEqual(candidate.blockers, []); assert.equal(candidate.document!.id, 'technique');
  assert.equal(candidate.document!.versions[0].id, 'version'); assert.equal(candidate.document!.versions[0].payload.description, 'Native text');
  assert.equal(candidate.retainedFacts.document, inspection.tables[path('technique_documents')][0]);
  inspection.tables[path('technique_documents')][0].draftJson = '{}';
  assert.equal(buildNativeConversion(inspection).techniqueCandidates[0].document, null);
});

function note(id: string, scope: Partial<NativeArchiveRow> = {}): NativeArchiveRow {
  return { id, sessionId: 'native-session', blockId: null, endId: null, localDate: '2026-11-11', body: '  Сохранить текст.\n',
    tagsJson: '["Форма","пауза"]', place: 'Зал', feeling: 'Ровно', conditions: '18 м', createdAtMs: 120,
    updatedAtMs: 150, revision: 3, deletedAtMs: null, ...scope };
}

test('native notes preserve text, dates and tags with session, exact condition and series links', () => {
  const inspection = fixture();
  inspection.tables[path('diary_notes')] = [note('session'), note('block', { blockId: 'native-block' }),
    note('series', { blockId: 'native-block', endId: 'end-2' })];
  const result = buildNativeConversion(inspection), [candidate] = result.candidates;
  assert.deepEqual(result.issues, []);
  assert.equal(candidate.notes.length, 3);
  const [session, block, series] = candidate.notes;
  assert.equal(session.seriesId, undefined); assert.equal(session.conditionKey, undefined);
  assert.equal(block.conditionKey, conditionsKey(candidate.practice!.rounds[0].series[0].conditions));
  assert.equal(series.seriesId, candidate.roundLocations['end-2'].webSeriesId); assert.equal(series.conditionKey, undefined);
  assert.deepEqual(session.tags, ['Форма', 'пауза']); assert.equal(session.body, '  Сохранить текст.\n');
  assert.deepEqual([session.localDate, session.place, session.feeling, session.conditions, session.createdAtMs, session.updatedAtMs],
    ['2026-11-11', 'Зал', 'Ровно', '18 м', 120, 150]);
  assert.equal(candidate.retainedFacts.notes[2], inspection.tables[path('diary_notes')][2]);
});

test('standalone and archived notes project while invalid and ambiguous links remain in the original', () => {
  const inspection = fixture(), [block] = inspection.tables[path('blocks')];
  inspection.tables[path('blocks')].push({ ...block, id: 'second', ordinal: 1 });
  inspection.tables[path('ends')][3].blockId = 'second';
  inspection.tables[path('ends')][3].ordinal = 0;
  inspection.tables[path('diary_notes')] = [note('archived', { deletedAtMs: 500 }), note('standalone', { sessionId: null }),
    note('standalone-archived', { sessionId: null, deletedAtMs: 501 }),
    note('wrong-end', { blockId: 'native-block', endId: 'end-3' }), note('ambiguous', { blockId: 'second' }),
    note('bad-tags', { tagsJson: '["form","FORM"]' }), note('broken-standalone-scope', { sessionId: null, blockId: 'second' }),
    note('missing-session', { sessionId: 'missing' })];
  const result = buildNativeConversion(inspection);
  assert.deepEqual(result.candidates[0].blockers, []);
  assert.deepEqual(result.candidates[0].notes.map(note => [note.id, note.deletedAtMs]), [['archived', 500]]);
  assert.deepEqual(result.notebookNotes.map(note => [note.id, note.deletedAtMs]), [['standalone', null], ['standalone-archived', 501]]);
  assert.deepEqual(Object.fromEntries(result.issues.map(issue => [issue.sourceId, issue.code])), {
    'wrong-end': 'unmapped_note_series', ambiguous: 'ambiguous_note_conditions', 'bad-tags': 'unmapped_note',
    'broken-standalone-scope': 'unmapped_note_session', 'missing-session': 'unmapped_note_session',
  });
  assert.equal(result.inspection.tables[path('diary_notes')].length, 8);
  const activated = buildNativeRecords(result, archive);
  const diary: Diary = JSON.parse(activated.records[DIARY_KEY]!);
  assert.ok(isDiary(diary));
  assert.deepEqual(diary.notes, result.notebookNotes);
  assert.deepEqual(diary.entries[0].notes, result.candidates[0].notes);
  assert.equal(activated.retained.notes, 5);
  assert.equal(result.inspection.tables[path('diary_notes')][0].deletedAtMs, 500);
});

function receipt(revision: number, kind: string, appliedAtMs: number, resultId = 'native-session'): NativeArchiveRow {
  return { operationId: `event-${revision}-${kind}`, sessionId: 'native-session', resultId, resultRevision: revision, kind, appliedAtMs };
}

test('native lifecycle time uses measured receipt intervals, ordered by revision, without counting pauses or shot edits', () => {
  const inspection = fixture();
  const events = [receipt(8, 'complete', 600), receipt(1, 'start', 100), receipt(3, 'pause', 200),
    receipt(6, 'resume', 500), receipt(7, 'next', 550, 'end-2'), receipt(5, 'revise', 400)];
  inspection.tables[path('mutation_receipts')] = events;
  const result = buildNativeConversion(inspection), [candidate] = result.candidates;
  assert.deepEqual(candidate.trainingTime, { closedMs: 200, activeSinceMs: null, partial: false });
  assert.deepEqual(candidate.retainedFacts.lifecycleReceipts, [events[0], events[1], events[2], events[3]]);
  assert.equal(result.inspection.tables[path('mutation_receipts')], events);
  assert.deepEqual(result.issues, []);
});

test('native time preserves partial and ongoing evidence and reports ambiguous or overflowing intervals', () => {
  const inspection = fixture(), session = inspection.tables[path('sessions')][0];
  session.state = 'active';
  inspection.tables[path('mutation_receipts')] = [receipt(3, 'resume', 300), receipt(5, 'pause', 400), receipt(8, 'resume', 500)];
  assert.deepEqual(first(inspection).trainingTime, { closedMs: 100, activeSinceMs: 500, partial: true });
  session.state = 'completed';
  assert.deepEqual(first(inspection).trainingTime, { closedMs: 100, activeSinceMs: null, partial: true });
  inspection.tables[path('mutation_receipts')].push(receipt(8, 'pause', 600));
  let result = buildNativeConversion(inspection);
  assert.equal(result.candidates[0].trainingTime, null);
  assert.ok(result.issues.some(issue => issue.code === 'ambiguous_training_time_receipts'));
  inspection.tables[path('mutation_receipts')] = [receipt(1, 'start', 0), receipt(2, 'pause', Number.MAX_SAFE_INTEGER),
    receipt(3, 'resume', 0), receipt(4, 'complete', 2)];
  result = buildNativeConversion(inspection);
  assert.equal(result.candidates[0].trainingTime, null);
  assert.ok(result.issues.some(issue => issue.code === 'training_time_out_of_range'));
});

test('equipment projections carry supported catalog and captured snapshot metadata', () => {
  const inspection = fixture();
  const bow = { id: 'bow', kind: 'bow', name: 'Bow', category: 'recurve', model: 'Model', notes: 'Bow notes',
    revision: 2, createdAtMs: 101, updatedAtMs: 102, favorite: 1, archived: 0, drawWeightLb: 40, drawLengthIn: 29 };
  const arrows = { id: 'arrows', kind: 'arrows', name: 'Arrows', spine: 550, lengthMm: 730, massGrain: 380,
    diameterMm: 5.5, numberedCount: 12, revision: 3, createdAtMs: 103, updatedAtMs: 104, favorite: 0, archived: 1 };
  const setup = { id: 'setup', kind: 'setup', name: 'Kit', bowId: 'bow', arrowsId: 'arrows', model: null, notes: 'Kit notes', revision: 1 };
  inspection.tables['data/equipment/equipment_items.jsonl'] = [bow, arrows, setup];
  inspection.tables[path('blocks')][0].equipmentSnapshotJson = JSON.stringify({ schema: 1, selection: setup, bow, arrows });
  const result = buildNativeConversion(inspection);
  const snap = result.candidates[0].practice!.rounds[0].series[0].conditions.equipment!;
  assert.deepEqual([snap.bow.id, snap.arrows.id, snap.bowId, snap.arrowsId, snap.notes], ['bow', 'arrows', 'bow', 'arrows', 'Kit notes']);
  assert.deepEqual([snap.bow.drawWeightLb, snap.bow.drawLengthIn, snap.bow.favorite, snap.bow.updatedAtMs], [40, 29, true, 102]);
  assert.deepEqual([snap.arrows.spine, snap.arrows.lengthMm, snap.arrows.massGrain, snap.arrows.archived], [550, 730, 380, true]);
  assert.deepEqual(result.equipmentCandidates.map(candidate => candidate.item?.revision), [2, 3, 1]);
  assert.equal(result.equipmentCandidates[0].item?.model, 'Model');
  assert.equal(result.equipmentCandidates[1].item?.archived, true);
  assert.equal(result.equipmentCandidates[1].retainedFacts, arrows);
});

test('rank candidates preserve manual and archived facts without choosing between conflicting current ranks', () => {
  const inspection = fixture();
  const rank = { id: 'rank', discipline: 'recurve', category: 'female', level: 'КМС', assignedOn: '2024-02-29',
    issuedBy: 'Организация', reference: 'Приказ №1', current: 1, createdAtMs: 10, updatedAtMs: 12, revision: 2, deletedAtMs: null };
  inspection.tables[path('rank_assignments')] = [rank, { ...rank, id: 'archive', current: 0, deletedAtMs: 21 }, { ...rank, id: 'other', category: 'male' }];
  let result = buildNativeConversion(inspection);
  assert.deepEqual(result.rankCandidates.map(candidate => candidate.assignment?.current), [true, false, true]);
  assert.equal(result.rankCandidates[0].assignment?.reference, 'Приказ №1');
  assert.equal(result.rankCandidates[1].assignment?.deletedAtMs, 21);
  inspection.tables[path('rank_assignments')].push({ ...rank, id: 'conflict' }, { ...rank, id: 'bad', discipline: 'unknown' });
  result = buildNativeConversion(inspection);
  assert.deepEqual(result.rankCandidates[0].blockers, ['conflicting_current_rank']);
  assert.equal(result.rankCandidates[3].assignment, null);
  assert.deepEqual(result.rankCandidates[4].blockers, ['unmapped_rank_assignment']);
  assert.equal(result.rankCandidates[0].retainedFacts, rank);
});

test('theme projection accepts only native theme values with the correct preference type', () => {
  const inspection = fixture();
  inspection.preferences.values = { designStyle: { type: 'string', value: 'minimal' }, appearanceMode: { type: 'string', value: 'dark' } };
  assert.deepEqual(buildNativeConversion(inspection).themePreferences, { themeStyle: 'minimal', themeMode: 'dark' });
  inspection.preferences.values.appearanceMode = { type: 'boolean', value: true };
  const result = buildNativeConversion(inspection);
  assert.deepEqual(result.themePreferences, { themeStyle: 'minimal' });
  assert.deepEqual(result.issues.filter(issue => issue.code === 'unmapped_theme_preference'), [{ sourceId: 'appearanceMode', code: 'unmapped_theme_preference' }]);
});

test('supported Android settings become typed patches without filling absent values', () => {
  const inspection = fixture();
  inspection.preferences.values = {
    animationsEnabled: { type: 'boolean', value: false }, hapticsEnabled: { type: 'boolean', value: true },
    keepScreenAwake: { type: 'boolean', value: false }, hide_current_scores_v1: { type: 'boolean', value: true },
    average_hundredths_v1: { type: 'boolean', value: true }, displayName: { type: 'string', value: 'Лучник' },
    rank_category_v1: { type: 'string', value: 'female' }, shooting_base_minutes_v1: { type: 'long', value: 930 },
    disabled_statistics_v1: { type: 'stringSet', value: ['average', 'geometry_trend'] },
    technique_focus: { type: 'boolean', value: false }, technique_reflection: { type: 'boolean', value: true },
    series_timer_seconds_v1: { type: 'int', value: 90 }, rest_timer_seconds_v1: { type: 'int', value: 30 },
    training_on_lock_screen_v1: { type: 'boolean', value: false },
    use_system_scale_v1: { type: 'boolean', value: true },
    onboardingCompletedVersion: { type: 'int', value: 1 },
  };
  const before = JSON.stringify(inspection), result = buildNativeConversion(inspection);
  assert.deepEqual(result.settings.training, { animations: false, haptics: true, keepAwake: false, hideScores: true,
    averageHundredths: true, displayName: 'Лучник', rankCategory: 'female', shootingBaseMinutes: 930,
    disabledStatistics: ['average', 'geometry_trend'], trainingOnLockScreen: false, useSystemScale: true, onboardingSeen: true });
  assert.deepEqual(result.settings.technique, { techniqueFocus: false, techniqueReflection: true });
  assert.deepEqual(result.settings.timer, { seriesSeconds: 90, restSeconds: 30 });
  assert.equal(validPreferences({ ...DEFAULT_PREFERENCES, ...result.settings.training }), true);
  assert.deepEqual(result.settings.retainedKeys, []); assert.deepEqual(result.issues, []);
  assert.equal(JSON.stringify(inspection), before);
  assert.deepEqual(buildNativeConversion(fixture()).settings, { training: {}, technique: {}, timer: {}, mappedKeys: [], retainedKeys: [] });
});

test('unrepresentable settings retain their original values and identify the missing web contract', () => {
  const inspection = fixture();
  inspection.preferences.values = { displayName: { type: 'string', value: 'а'.repeat(41) },
    soundEnabled: { type: 'boolean', value: true }, technique_home: { type: 'boolean', value: false },
    future: { type: 'bytes', value: 'AQID' }, rest_timer_seconds_v1: { type: 'int', value: 3601 },
    disabled_statistics_v1: { type: 'stringSet', value: ['average', 'future-statistic'] } };
  const result = buildNativeConversion(inspection);
  assert.deepEqual(result.settings.training, {}); assert.deepEqual(result.settings.timer, {});
  assert.deepEqual(result.settings.retainedKeys, Object.keys(inspection.preferences.values).sort());
  assert.equal(result.inspection.preferences.values.future.value, 'AQID');
  assert.ok(result.issues.some(issue => issue.sourceId === 'displayName' && issue.code === 'unmapped_preference_value'));
  assert.ok(result.issues.some(issue => issue.sourceId === 'soundEnabled' && issue.code === 'native_preference_retained'));
});

function presetRow(index = 1, changes: Record<string, unknown> = {}) {
  return { id: `12345678-1234-1234-1234-${index.toString().padStart(12, '0')}`, name: `Preset ${index}`, revision: 3,
    plan: JSON.stringify({ version: 1, distance: 18, diameter: 400, arrows: 3, mode: 'scored', equipment: null,
      ends: null, rounds: 1, target: 'wa-indoor-outer-v1', flexibleSeries: true, seriesPerRound: 10, numberedArrows: true,
      roundArrowLimit: null, ...changes }) };
}
function setPresets(inspection: NativeArchiveInspection, rows: ReturnType<typeof presetRow>[]) {
  inspection.preferences.values = { training_presets_v1: { type: 'string', value: JSON.stringify({ version: 1, presets: rows }) } };
}

test('portable native presets preserve identity, conditions, round rule and captured native revision', () => {
  const inspection = fixture(), row = presetRow(); setPresets(inspection, [row]);
  const result = buildNativeConversion(inspection), [candidate] = result.presetCandidates;
  assert.deepEqual(candidate.blockers, []); assert.equal(isPreset(candidate.preset), true);
  assert.equal(candidate.preset!.id, row.id); assert.equal(candidate.preset!.numberedArrows, true);
  assert.deepEqual(candidate.preset!.rule, { unit: 'series', limit: 10 });
  assert.equal(candidate.retainedFacts.revision, 3); assert.equal(candidate.retainedFacts.plan, row.plan);
  assert.equal(result.catalogs.presets?.length, 1);
  assert.ok(result.settings.retainedKeys.includes('training_presets_v1'));
});

test('preset fields without web equivalents and duplicate catalogs block full preset projection', () => {
  const inspection = fixture();
  setPresets(inspection, [presetRow(1, { arrows: 6 }), presetRow(2, { flexibleSeries: false, ends: 20, rounds: 2, seriesPerRound: null }),
    presetRow(3, { mode: 'count_only' })]);
  let result = buildNativeConversion(inspection);
  assert.equal(result.catalogs.presets, null);
  assert.ok(result.presetCandidates[0].blockers.includes('preset_series_size_not_representable'));
  assert.ok(result.presetCandidates[1].blockers.includes('preset_fixed_plan_not_representable'));
  assert.ok(result.presetCandidates[2].blockers.includes('unsupported_preset_count_only'));
  const one = presetRow(); setPresets(inspection, [one, { ...presetRow(2), name: one.name.toUpperCase() }]);
  result = buildNativeConversion(inspection);
  assert.ok(result.presetCandidates.every(candidate => candidate.preset)); assert.equal(result.catalogs.presets, null);
  assert.ok(result.issues.some(issue => issue.code === 'preset_catalog_conflict'));
});

function techniqueRows(inspection: NativeArchiveInspection) {
  const text = { schema: 1, title: 'Native memo', context: '', description: '', phases: [], discussed: null, change: '', preservedExtension: 'keep' };
  inspection.tables[path('technique_documents')] = [{ id: 'memo', draftJson: JSON.stringify(text), updatedAtMs: 200, archived: 0, isPrimary: 1 }];
  inspection.tables[path('technique_versions')] = [{ id: 'memo-v1', documentId: 'memo', number: 1, createdAtMs: 100, payloadJson: JSON.stringify(text) }];
}

test('technique use candidates preserve version, focus, reflection and series links with the unavailable arrow boundary explicit', () => {
  const inspection = fixture(); techniqueRows(inspection);
  const use = { id: 'use', sessionId: 'native-session', sequence: 1, versionId: 'memo-v1', blockOrdinal: 0, endOrdinal: 2,
    focus1: 'Плечи', focus2: 'Выпуск', worked: 'Ровный выпуск', question: 'Спросить тренера', rating: 'yes', createdAtMs: 500, revision: 2 };
  inspection.tables[path('technique_uses')] = [use];
  const result = buildNativeConversion(inspection), [candidate] = result.candidates, [mapped] = candidate.techniqueUseCandidates;
  assert.equal(mapped.seriesId, candidate.roundLocations['end-2'].webSeriesId);
  assert.equal(mapped.selection!.versionId, 'memo-v1'); assert.equal(mapped.selection!.title, 'Native memo');
  assert.equal(mapped.selection!.focus1, 'Плечи'); assert.equal(mapped.reflection!.worked, 'Ровный выпуск');
  assert.deepEqual(mapped.blockers, ['technique_use_arrow_boundary_unavailable']); assert.equal(mapped.arrowsBefore, null);
  assert.equal(mapped.retainedFacts, use); assert.equal(candidate.practice!.techniqueUses, undefined);
  assert.equal(isTechniqueLibrary(result.catalogs.techniques), true);
  assert.equal(JSON.parse(JSON.stringify(result.catalogs.techniques!.documents[0].draft)).preservedExtension, 'keep');
});

test('broken technique relationships and conflicts remain explicit instead of choosing a memo or inventing a series', () => {
  const inspection = fixture(); techniqueRows(inspection);
  inspection.tables[path('technique_versions')].push({ id: 'orphan', documentId: 'missing', number: 1, createdAtMs: 100, payloadJson: '{}' });
  inspection.tables[path('technique_uses')] = [{ id: 'use', sessionId: 'native-session', sequence: 1, versionId: 'missing',
    blockOrdinal: 5, endOrdinal: 9, focus1: '', focus2: '', worked: '', question: '', rating: null }];
  let result = buildNativeConversion(inspection);
  assert.equal(result.catalogs.techniques, null); assert.ok(result.issues.some(issue => issue.code === 'orphan_technique_version'));
  const [use] = result.candidates[0].techniqueUseCandidates;
  assert.equal(use.seriesId, null); assert.equal(use.selection, null);
  assert.ok(use.blockers.includes('unmapped_technique_use_series')); assert.ok(use.blockers.includes('unmapped_technique_use_selection'));
  inspection.tables[path('technique_versions')] = [{ ...inspection.tables[path('technique_versions')][0], number: 2 }];
  result = buildNativeConversion(inspection);
  assert.ok(result.techniqueCandidates[0].blockers.includes('noncontiguous_technique_versions'));
});

test('whole equipment catalogs reject multiple favorites while historical revisions remain referenced', () => {
  const inspection = fixture(), bow = { id: 'bow1', kind: 'bow', name: 'One', category: 'recurve', favorite: 1, archived: 0,
    nativeExtension: 'Retain this field' };
  inspection.tables['data/equipment/equipment_items.jsonl'] = [bow, { ...bow, id: 'bow2', name: 'Two' }];
  const revision = { itemId: 'bow1', revision: 1, changedAtMs: 100, snapshotJson: '{"id":"bow1","revision":1}' };
  inspection.tables['data/equipment/equipment_revisions.jsonl'] = [revision];
  const result = buildNativeConversion(inspection);
  assert.ok(result.equipmentCandidates.every(candidate => candidate.item)); assert.equal(result.catalogs.equipment, null);
  assert.equal(JSON.parse(JSON.stringify(result.equipmentCandidates[0].item)).nativeExtension, 'Retain this field');
  assert.equal(result.equipmentCandidates[0].retainedRevisions[0], revision);
  assert.ok(result.issues.some(issue => issue.code === 'equipment_catalog_conflict'));
  inspection.tables['data/equipment/equipment_items.jsonl'] = [];
  assert.ok(buildNativeConversion(inspection).issues.some(issue => issue.code === 'orphan_equipment_revision'));
});
