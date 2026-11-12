import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableTimelineMetrics, buildProgressTimeline, DEFAULT_PROGRESS_FILTERS, filterProgressEntries, progressPeriodRange, timelineCeiling, timelineConditionKey, timelineDate, timelineViewport } from '../src/progress-timeline.ts';
import type { DiaryEntry } from '../src/persistence.ts';
import type { Conditions } from '../src/conditions.ts';
import type { Series } from '../src/practice.ts';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { emptyPractice } from '../src/practice.ts';

const conditions: Conditions = { distanceMeters: 18, targetDiameterMm: 400, targetProfileId: 'wa-indoor-outer-v1',
  equipment: { id: 'kit-1', name: 'Kit', bow: { name: 'Bow', category: 'recurve' }, arrows: { id: 'arrows-1', name: 'Arrows', diameterMm: 6 } } };
function series(id = 2, change: Partial<Series> = {}): Series {
  return { id, conditions: structuredClone(conditions), plannedCount: 3,
    shots: [
      { points: 10, code: 'X', point: { x: -.1, y: 0 } },
      { points: 10, code: '10', point: { x: 0, y: 0 } },
      { points: 9, code: '9', point: { x: .1, y: 0 } },
    ], ...change };
}
function entry(id = 'session', date = '2026-11-11', seriesRows = [series()]): DiaryEntry {
  return { id, title: `Training ${id}`, startedAt: `${date}T12:00:00Z`, localDate: date,
    practice: { ...emptyPractice(), rounds: [{ id: 1, series: seriesRows }], savedAt: `${date}T13:00:00Z`, nextId: 100 } };
}
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('timeline calculates scored average, ten share including X, and physical RMS per saved training', () => {
  const [group] = buildProgressTimeline([entry()]), [point] = group.points;
  close(point.values.average, 29 / 3); close(point.values.tenShare, 200 / 3);
  close(point.values.rms, Math.sqrt(.02 / 3) * 200);
  assert.equal(point.arrows, 3); assert.equal(point.sessionId, 'session');
  assert.ok(group.label.includes('18 м')); assert.ok(group.label.includes('40 см')); assert.ok(group.label.includes('Классический'));
});

test('condition comparison ignores kit IDs, equipment names and arrow UUIDs', () => {
  const changed = structuredClone(conditions);
  changed.equipment!.id = 'new-kit'; changed.equipment!.name = 'New name'; changed.equipment!.arrows.id = 'different-arrows';
  changed.equipment!.bow.name = 'Different bow name';
  const groups = buildProgressTimeline([entry('first', '2026-10-01'), entry('second', '2026-11-01', [series(2, { conditions: changed })])]);
  assert.equal(groups.length, 1); assert.equal(groups[0].points.length, 2); assert.equal(groups[0].comparable, true);
});

test('distance, target profile, diameter and bow category each produce separate comparable groups', () => {
  const different = [
    { ...conditions, distanceMeters: 25 }, { ...conditions, targetDiameterMm: 600 },
    { ...conditions, targetProfileId: 'wa-indoor-inner-v1' },
    { ...conditions, equipment: { ...conditions.equipment!, bow: { name: 'Compound', category: 'compound' } } },
  ];
  const groups = buildProgressTimeline([entry(), ...different.map((value, index) => entry(`other-${index}`, '2026-11-10', [series(2, { conditions: value })]))]);
  assert.equal(groups.length, 5); assert.ok(groups.every(group => group.points.length === 1));
});

test('mixed conditions within one training become independent points and do not contaminate metrics', () => {
  const other = series(3, { conditions: { ...conditions, distanceMeters: 30 }, shots: [{ points: 0, code: 'M', point: null }] });
  const groups = buildProgressTimeline([entry('mixed', '2026-11-11', [series(), other])]);
  assert.equal(groups.length, 2);
  close(groups.find(group => group.label.startsWith('18 '))!.points[0].values.average, 29 / 3);
  assert.equal(groups.find(group => group.label.startsWith('30 '))!.points[0].values.average, 0);
});

test('unknown bow classes remain visible as isolated training groups without cross-training comparisons', () => {
  const unknown = { ...conditions, equipment: null };
  const groups = buildProgressTimeline([entry('a', '2026-11-01', [series(2, { conditions: unknown }), series(3, { conditions: unknown })]),
    entry('b', '2026-11-02', [series(2, { conditions: unknown })])]);
  assert.equal(groups.length, 2); assert.ok(groups.every(group => !group.comparable && group.points.length === 1));
  assert.ok(groups.every(group => group.label.includes('Класс лука неизвестен')));
  assert.equal(groups.find(group => group.points[0].sessionId === 'a')!.points[0].arrows, 6);
});

test('CG3 uses the existing score calculation and refuses partial or coordinate-free scoring groups', () => {
  const perfect = series(2, { shots: Array.from({ length: 3 }, () => ({ points: 10, code: '10', point: { x: 0, y: 0 } })) });
  close(buildProgressTimeline([entry('perfect', '2026-11-11', [perfect])])[0].points[0].values.cg3, 105);
  const partial = { ...perfect, plannedCount: 6 };
  assert.equal(buildProgressTimeline([entry('partial', '2026-11-11', [partial])])[0].points[0].values.cg3, null);
  const imported = { ...perfect, shots: perfect.shots.map(shot => ({ ...shot, imported: true as const, point: null })) };
  const values = buildProgressTimeline([entry('numeric', '2026-11-11', [imported])])[0].points[0].values;
  assert.equal(values.cg3, null); assert.equal(values.rms, null); assert.equal(values.average, 10); assert.equal(values.tenShare, 100);
});

test('RMS requires three known coordinates and never turns unavailable geometry into zero', () => {
  const fewer = series(2, { shots: series().shots.slice(0, 2) });
  assert.equal(buildProgressTimeline([entry('two', '2026-11-11', [fewer])])[0].points[0].values.rms, null);
  const none = series(2, { shots: [{ points: 0, code: 'M', point: null }] });
  assert.equal(buildProgressTimeline([entry('miss', '2026-11-11', [none])])[0].points[0].values.rms, null);
});

test('unknown, invalid and unsaved dates are excluded; valid imported day is not inferred from placeholder time', () => {
  const unknown = { ...entry(), localDate: null };
  const blank = { ...entry(), localDate: undefined, startedAt: '' };
  const invalid = { ...entry(), localDate: '2026-02-30' };
  const unsaved = entry(); unsaved.practice.savedAt = null;
  assert.equal(buildProgressTimeline([unknown, blank, invalid, unsaved]).length, 0);
  const imported = { ...entry(), startedAt: '1970-01-01T12:00:00Z', localDate: '2024-08-17' };
  assert.equal(timelineDate(imported), '2024-08-17');
  assert.equal(buildProgressTimeline([imported])[0].points[0].date, '2024-08-17');
});

test('entire saved history is retained and the default viewport includes the latest data month', () => {
  const entries = Array.from({ length: 24 }, (_, index) => entry(`s-${index}`, `${2024 + Math.floor(index / 12)}-${(index % 12 + 1).toString().padStart(2, '0')}-15`));
  const [group] = buildProgressTimeline(entries.reverse()); assert.equal(group.points.length, 24);
  const latest = group.points.at(-1)!, first = group.points[0], bounds = timelineViewport(group.points);
  assert.equal(bounds.end - bounds.start, 30); assert.ok(latest.x > bounds.start && latest.x < bounds.end);
  const earlier = timelineViewport(group.points, -Infinity);
  assert.ok(first.x > earlier.start && first.x < earlier.end); assert.ok(earlier.end < bounds.end);
  assert.equal(timelineViewport(group.points, Infinity).end, bounds.end);
});

test('same-day training points have distinct positions and deterministic history order', () => {
  const [group] = buildProgressTimeline([entry('b'), entry('a')]);
  assert.deepEqual(group.points.map(point => point.sessionId), ['a', 'b']);
  assert.ok(group.points[0].x < group.points[1].x);
  assert.ok(group.points.every(point => point.x > point.day && point.x < point.day + 1));
});

test('statistics switches remove their own metrics and the progress switch hides every series', () => {
  const [group] = buildProgressTimeline([entry()]);
  assert.deepEqual(availableTimelineMetrics(group, DEFAULT_PREFERENCES), ['average', 'rms', 'tenShare', 'cg3']);
  assert.deepEqual(availableTimelineMetrics(group, { ...DEFAULT_PREFERENCES, disabledStatistics: ['average', 'grouping', 'general_score'] }), ['tenShare']);
  assert.deepEqual(availableTimelineMetrics(group, { ...DEFAULT_PREFERENCES, disabledStatistics: ['zone_trend'] }), ['average', 'rms', 'cg3']);
  assert.deepEqual(availableTimelineMetrics(group, { ...DEFAULT_PREFERENCES, disabledStatistics: ['progress_trend'] }), []);
  assert.deepEqual(availableTimelineMetrics(group, { ...DEFAULT_PREFERENCES, disabledStatistics: ['average', 'grouping', 'zone_trend', 'general_score'] }), []);
});

test('each metric keeps one scale across panning; score and percentage domains stay explicit', () => {
  const points = buildProgressTimeline([entry()])[0].points;
  assert.equal(timelineCeiling(points, 'average'), 10); assert.equal(timelineCeiling(points, 'tenShare'), 100);
  assert.equal(timelineCeiling(points, 'cg3'), 105); assert.equal(timelineCeiling(points, 'rms'), 20);
  assert.equal(timelineCeiling([], 'rms'), 10);
});

test('period filters include both local dates, exclude unknown dates from a bounded range and preserve the full default history', () => {
  const entries = [entry('before', '2026-11-03'), entry('start', '2026-11-04'), entry('finish', '2026-11-10'),
    entry('after', '2026-11-11'), { ...entry('unknown'), localDate: null },
    { ...entry('imported-day'), localDate: '2026-11-05', startedAt: '1970-01-01T12:00:00Z' }];
  const range = { ...DEFAULT_PROGRESS_FILTERS, period: -1 as const, from: '2026-11-04', to: '2026-11-10' };
  assert.deepEqual(filterProgressEntries(entries, range).map(item => item.id), ['start', 'finish', 'imported-day']);
  assert.deepEqual(filterProgressEntries(entries, { ...DEFAULT_PROGRESS_FILTERS, period: 7 }, '2026-11-10').map(item => item.id), ['start', 'finish', 'imported-day']);
  assert.deepEqual(filterProgressEntries(entries, DEFAULT_PROGRESS_FILTERS), entries);
  assert.deepEqual(progressPeriodRange({ ...DEFAULT_PROGRESS_FILTERS, period: 7 }, '2028-03-01'),
    { valid: true, from: '2028-02-24', to: '2028-03-01' });
  assert.deepEqual(filterProgressEntries(entries, { ...range, from: '2026-02-30' }), []);
  assert.deepEqual(filterProgressEntries(entries, { ...range, from: '2026-11-11' }), []);
  assert.deepEqual(filterProgressEntries(entries, { ...range, to: '' }), []);
});

test('manual training IDs intersect each period and remain reusable when the period changes', () => {
  const entries = [entry('older', '2026-10-01'), entry('recent', '2026-11-10'), entry('other', '2026-11-10')];
  const selected = { ...DEFAULT_PROGRESS_FILTERS, sessionIds: ['older', 'recent'] };
  assert.deepEqual(filterProgressEntries(entries, selected).map(item => item.id), ['older', 'recent']);
  assert.deepEqual(filterProgressEntries(entries, { ...selected, period: 7 }, '2026-11-11').map(item => item.id), ['recent']);
  assert.deepEqual(filterProgressEntries(entries, selected).map(item => item.id), ['older', 'recent']);
  assert.deepEqual(filterProgressEntries(entries, { ...selected, sessionIds: [] }), []);
  assert.deepEqual(selected.sessionIds, ['older', 'recent']);
  const deleted = { ...entries[0], deletedAt: '2026-11-11T12:00:00Z' };
  const active = entry('active'); active.practice.savedAt = null;
  assert.deepEqual(filterProgressEntries([deleted, active], DEFAULT_PROGRESS_FILTERS), []);
  assert.deepEqual(buildProgressTimeline([deleted, active]), []);
});

test('conditions selection projects only comparable series into totals and the chart without changing the diary', () => {
  const farther = series(3, { conditions: { ...conditions, distanceMeters: 30 }, shots: [{ points: 0, code: 'M', point: null }] });
  const first = entry('mixed', '2026-11-10', [series(), farther]);
  const alias = structuredClone(conditions); alias.equipment!.id = 'other-kit'; alias.equipment!.bow.name = 'Renamed';
  const second = entry('alias', '2026-11-11', [series(2, { conditions: alias })]);
  const entries = [first, second];
  const before = structuredClone(entries);
  const filtered = filterProgressEntries(entries, { ...DEFAULT_PROGRESS_FILTERS, conditionKey: timelineConditionKey(first, first.practice.rounds[0].series[0]) });
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].practice.rounds[0].series.length, 1);
  assert.equal(filtered[0].practice.rounds[0].series[0].conditions.distanceMeters, 18);
  assert.equal(buildProgressTimeline(filtered).length, 1);
  assert.deepEqual(entries, before);
  assert.equal(filterProgressEntries(entries, { ...DEFAULT_PROGRESS_FILTERS, conditionKey: timelineConditionKey(first, farther) }).length, 1);
  const unknown = entry('unknown', '2026-11-10', [series(2, { conditions: { ...conditions, equipment: null } })]);
  const another = { ...unknown, id: 'another-unknown' };
  assert.deepEqual(filterProgressEntries([unknown, another], { ...DEFAULT_PROGRESS_FILTERS,
    conditionKey: timelineConditionKey(unknown, unknown.practice.rounds[0].series[0]) }).map(item => item.id), ['unknown']);
});
