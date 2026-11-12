import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import { calculatePersonalRecordEvents, isPersonalRecordEvent, personalSeriesRecords, personalVolumeRecord } from '../src/personal-record-events.ts';
import type { DiaryEntry } from '../src/persistence.ts';

const at = Date.parse('2026-11-11T12:00:00Z');
const kit = { id: 'kit', name: 'Комплект', bow: { name: 'Лук', category: 'recurve' }, arrows: { name: 'Стрелы', diameterMm: 6 } };

function training(id: string, ends: number[][], date = '2026-11-10'): DiaryEntry {
  return {
    id, localDate: date, startedAt: `${date}T09:00:00Z`,
    practice: { nextId: ends.length + 2, savedAt: `${date}T11:00:00Z`, roundRule: { unit: 'unlimited', limit: null },
      rounds: [{ id: 1, series: ends.map((points, index) => ({ id: index + 2,
        conditions: { ...DEFAULT_CONDITIONS, equipment: structuredClone(kit) }, plannedCount: Math.max(3, points.length),
        shots: points.map(points => ({ points, code: points ? String(points) : 'M', point: points ? { x: 0, y: 0 } : null })),
      })) }],
    },
  };
}

function calculate(candidate: DiaryEntry, history: DiaryEntry[], category: 'male' | null = null) {
  let id = 0;
  return calculatePersonalRecordEvents(candidate, history, category, at, () => `record-${++id}`);
}

test('a better full series and greater volume keep the earlier best source and freeze the comparison', () => {
  const old = training('old', [[8, 8, 8]], '2026-11-08');
  const tied = training('tied', [[8, 8, 8]], '2026-11-09');
  const current = training('new', [[9, 9, 9], [10, 10, 10], [0]], '2026-11-11');
  const events = calculate(current, [tied, old, current]);
  assert.deepEqual(events.map(({ kind, previousValue, value, previousSessionId }) => [kind, previousValue, value, previousSessionId]),
    [['series', 24, 30, 'old'], ['volume', 3, 7, 'old']]);
  assert.ok(events.every(event => isPersonalRecordEvent(event)));
  assert.equal(events[0].label.includes('18 м · 40 см · 3 в серии'), true);
  old.practice.rounds[0].series[0].shots[0].points = 1;
  assert.equal(events[0].previousValue, 24);
  assert.equal(isPersonalRecordEvent({ ...events[0], previousValue: events[0].value }), false);
  assert.equal(isPersonalRecordEvent({ ...events[0], previousSessionId: current.id }), false);
});

test('record candidates exclude unsupported origins and future, edited-late and trashed comparisons', () => {
  const old = training('old', [[8, 8, 8]]);
  const current = training('new', [[9, 9, 9]], '2026-11-11');
  const arrivedLater = { ...old, createdAt: '2026-11-12T00:00:00Z' };
  const futureDate = { ...old, localDate: '2026-11-12' };
  const active = { ...current, practice: { ...current.practice, savedAt: null } };
  const trashed = { ...old, deletedAt: current.startedAt };
  assert.deepEqual(calculate(current, [arrivedLater, futureDate, trashed]), []);
  assert.deepEqual(calculate(active, [old]), []);
  assert.deepEqual(calculate({ ...current, nativeArchiveSession: 'archive-session' }, [old]), []);
  assert.deepEqual(calculate(current, []), []);
  assert.deepEqual(calculate(current, [training('equal', [[9, 9, 9]])]), []);
  old.practice.rounds[0].series[0].shots[0].imported = true;
  assert.equal(calculate(current, [old])[0].previousSessionId, 'old');
  current.practice.rounds[0].series[0].shots[0].imported = true;
  assert.deepEqual(calculate(current, [old]), []);
});

test('series use complete planned counts and the same equipment revision, including a missing kit', () => {
  const old = training('old', [[9, 9, 9]]);
  const current = training('new', [[8, 8, 8], [10, 10]], '2026-11-11');
  old.practice.rounds[0].series[0].conditions.equipment!.revision = 2;
  const series = personalSeriesRecords([current, old]);
  assert.equal(series.length, 2);
  assert.ok(series.every(record => record.seriesNumber === 1 && record.maximum === 30));
  assert.deepEqual(calculate(current, [old]).map(record => record.kind), ['volume']);
  assert.equal(personalVolumeRecord([old, current])?.entry.id, current.id);
  current.practice.rounds[0].series[0].conditions.equipment = null;
  assert.ok(personalSeriesRecords([current]).some(record => record.equipmentTitle === 'Комплект не указан'));
});

test('supported exercises compare complete totals across series formats and choose the earliest equal baseline', () => {
  const earlier = training('earlier', Array.from({ length: 5 }, () => Array<number>(6).fill(8)), '2026-11-08');
  const later = training('later', Array.from({ length: 5 }, () => Array<number>(6).fill(8)), '2026-11-09');
  const current = training('new', Array.from({ length: 10 }, () => [9, 9, 9]), '2026-11-11');
  const records = calculate(current, [later, earlier], 'male');
  assert.deepEqual(records.map(({ kind, previousSessionId, previousValue, value, label }) => [kind, previousSessionId, previousValue, value, label]),
    [['rank', 'earlier', 240, 270, 'КЛ(М) · 18 м · 30 стрел']]);
  current.practice.rounds[0].series[0].plannedCount = 6;
  assert.deepEqual(calculate(current, [earlier], 'male'), []);
});
