import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACHIEVEMENT_EVIDENCE_RULE_IDS, evaluateAchievementEvidence } from '../src/achievement-evidence.ts';
import { getAchievementDefinition } from '../src/achievement-catalog.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import type { Conditions } from '../src/conditions.ts';
import type { DiaryEntry } from '../src/persistence.ts';
import { freezeProgressBaseline } from '../src/progress-scoring.ts';
import type { Shot } from '../src/target.ts';
import { TARGET_PROFILES } from '../src/target.ts';

const conditions: Conditions = { ...DEFAULT_CONDITIONS, equipment: {
  id: 'kit', name: 'Комплект', bow: { name: 'Лук', category: 'recurve' }, arrows: { name: 'Стрелы', diameterMm: 6 },
} };
const at = (day: number, hour = 9) => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const repeat = (count: number, points: number) => Array.from({ length: count }, () => [points, points, points]);

function shot(points: number): Shot {
  return { points, code: points === 0 ? 'M' : String(points), point: points === 0 ? null : { x: (10.5 - points) / 10, y: 0 } };
}

function entry(id: string, rows: number[][], options: { day?: number; active?: boolean; setup?: Conditions } = {}): DiaryEntry {
  const day = options.day ?? 10;
  const series = rows.map((row, index) => ({ id: index + 2, conditions: options.setup ?? conditions, shots: row.map(shot),
    plannedCount: Math.max(3, row.length) }));
  return { id, startedAt: at(day), practice: {
    rounds: [{ id: 1, series }], nextId: series.length + 2, roundRule: { unit: 'unlimited', limit: null },
    savedAt: options.active ? null : at(day, 10),
  } };
}

const result = (entries: readonly DiaryEntry[]) => new Map(evaluateAchievementEvidence(entries).map(item => [item.id, item.progress]));

test('counts completed nonempty live sessions and rejects deleted, imported and empty sources', () => {
  const completed = entry('completed', [[0]], { setup: DEFAULT_CONDITIONS });
  const deleted = { ...entry('deleted', repeat(10, 10)), deletedAt: at(11) };
  const imported: DiaryEntry = { ...entry('imported', repeat(10, 10)), source: { kind: 'mytargets', fileHash: '0'.repeat(64),
    parserVersion: '1', sessionId: 'source', sourceRecords: [], seriesFingerprints: [], overlapFingerprints: [] } };
  const importedShot = entry('imported-shot', repeat(10, 10));
  importedShot.practice.rounds[0].series[0].shots[0].imported = true;
  const empty = entry('empty', [[]]);
  const active = entry('active', [[10]], { active: true });
  assert.deepEqual(evaluateAchievementEvidence([completed, deleted, imported, importedShot, empty, active, completed]), [
    { id: 'START01', scope: 'global', progress: 1 },
    { id: 'START05', scope: 'global', progress: 1 },
    { id: 'START09', scope: 'global', progress: 1 },
    { id: 'START10', scope: 'global', progress: 1 },
    { id: 'START06', scope: 'global', progress: 2 },
    { id: 'START07', scope: 'global', progress: 2 },
    { id: 'START08', scope: 'global', progress: 2 },
  ]);
  assert.ok(ACHIEVEMENT_EVIDENCE_RULE_IDS.every(id => getAchievementDefinition(id)));
});

test('five-session progress counts distinct nonempty completed sessions and decreases after removal', () => {
  const completed = Array.from({ length: 5 }, (_, index) => entry(`completed-${index}`, [[0]], { setup: DEFAULT_CONDITIONS }));
  const active = entry('active', [[0]], { active: true, setup: DEFAULT_CONDITIONS });
  const before = JSON.stringify(completed);
  assert.equal(result([...completed.slice(0, 4), active, completed[0]]).get('START05'), 4);
  assert.equal(result([...completed, active, completed[0]]).get('START05'), 5);
  assert.equal(result([...completed.slice(0, 4), { ...completed[4], deletedAt: at(11) }]).get('START05'), 4);
  assert.equal(JSON.stringify(completed), before);
});

test('session tiers expose exact progress at twenty and one hundred completed sessions', () => {
  for (const [id, threshold] of [['START09', 20], ['START10', 100]] as const) {
    assert.equal(getAchievementDefinition(id)?.target, threshold);
    const completed = Array.from({ length: threshold }, (_, index) => entry(`completed-${index}`, [[0]], { setup: DEFAULT_CONDITIONS }));
    const active = entry('active', [[0]], { active: true, setup: DEFAULT_CONDITIONS });
    assert.equal(result([...completed.slice(1), active, completed[1]]).get(id), threshold - 1);
    assert.equal(result([...completed, active, completed[0]]).get(id), threshold);
  }
});

test('volume tiers count misses and active partial series once and expose exact threshold progress', () => {
  for (const [id, threshold] of [['START06', 100], ['START07', 500], ['START08', 1000]] as const) {
    assert.equal(getAchievementDefinition(id)?.target, threshold);
    const training = entry(`volume-${id}`, [Array<number>(threshold - 1).fill(0)], { active: true, setup: DEFAULT_CONDITIONS });
    assert.equal(result([training, structuredClone(training)]).get(id), threshold - 1);
    training.practice.rounds[0].series[0].shots.push(shot(0));
    assert.equal(result([training, training]).get(id), threshold);
    training.practice.rounds[0].series[0].shots.pop();
    assert.equal(result([training]).get(id), threshold - 1);
    assert.equal(result([{ ...training, deletedAt: at(11) }]).has(id), false);
  }
});

test('perfect full series qualify at the supported format and a partial end breaks a streak', () => {
  const exact = entry('three', repeat(3, 10), { active: true });
  const before = JSON.stringify(exact);
  const hits = result([exact]);
  for (const id of ['START02', 'START03', 'HIT01', 'HIT06', 'GROUP08'] as const) assert.equal(hits.get(id), 1);
  assert.equal(hits.has('HIT07'), false);
  assert.equal(hits.has('SCORE01'), false);
  assert.equal(JSON.stringify(exact), before);

  const broken = entry('broken', [[10, 10, 10], [10, 10], ...repeat(2, 10)]);
  assert.equal(result([broken]).has('HIT06'), false);
  const outdoor = entry('far', repeat(3, 10), { setup: { ...conditions, distanceMeters: 20 } });
  assert.equal(result([outdoor]).has('START02'), true);
  assert.equal(result([outdoor]).has('HIT01'), false);
  assert.equal(result([entry('six', [[10, 10, 10, 10, 10, 10]])]).has('HIT02'), true);
});

test('whole-training achievements require completion, one condition, full ends and the exact thresholds', () => {
  const saved = entry('saved', [...repeat(8, 9), ...repeat(2, 8)]);
  const scored = result([saved]);
  for (const id of ['SCORE01', 'SCORE02', 'SCORE03', 'SCORE06', 'HIT09', 'STEADY04'] as const) assert.equal(scored.get(id), 1);
  assert.equal(scored.has('SCORE04'), false);
  saved.practice.rounds[0].series[0].shots[0] = shot(8);
  assert.equal(result([saved]).has('HIT09'), false);

  const mixed = entry('mixed', repeat(11, 10));
  mixed.practice.rounds[0].series[10].conditions = { ...conditions, distanceMeters: 20 };
  assert.equal(result([mixed]).has('SCORE01'), false);
  const active = entry('active', repeat(10, 10), { active: true });
  assert.equal(result([active]).has('SCORE01'), false);
  const partial = entry('partial', [[10, 10], ...repeat(10, 10)]);
  assert.equal(result([partial]).has('SCORE01'), false);
  assert.equal(result([entry('perfect', repeat(20, 10))]).has('HIT10'), true);
});

test('group windows need closed consecutive series, while the finale needs five prior full series', () => {
  const open = entry('open', repeat(5, 10), { active: true });
  assert.equal(result([open]).has('GROUP05'), false);
  open.practice.rounds[0].series.push({ id: open.practice.nextId++, conditions, shots: [] });
  assert.equal(result([open]).has('GROUP05'), true);
  const interrupted = entry('mixed', repeat(6, 10));
  interrupted.practice.rounds[0].series[2].conditions = { ...conditions, distanceMeters: 20 };
  assert.equal(result([interrupted]).has('GROUP05'), false);
  assert.equal(result([interrupted]).has('STORY01'), true);
  assert.equal(result([entry('short', repeat(5, 10))]).has('STORY01'), false);
  assert.equal(result([entry('off-center', repeat(1, 8))]).has('GROUP06'), true);
  assert.equal(result([entry('center', repeat(1, 10))]).has('GROUP06'), false);
});

test('repeated CG3 stability uses three distinct completed sessions of one condition and kit', () => {
  const first = entry('first', repeat(8, 8));
  const second = entry('second', repeat(8, 8));
  const third = entry('third', repeat(8, 8));
  const anotherKit = entry('other-kit', repeat(8, 8), { setup: { ...conditions, equipment: { ...conditions.equipment!, id: 'other' } } });
  assert.equal(result([first, second, first, anotherKit]).has('STEADY08'), false);
  assert.equal(result([first, second, third]).get('STEADY08'), 1);
});

test('rank uses the captured comparison category and a final exercise', () => {
  const saved = entry('saved', repeat(10, 10));
  const ranks = evaluateAchievementEvidence([saved], () => 'male').filter(item => item.id.startsWith('RANK'));
  assert.deepEqual(new Set(ranks.map(item => item.id)), new Set(['RANK04', 'RANK05', 'RANK06']));
  assert.ok(ranks.every(item => item.scope === 'recurve'));
  assert.ok(evaluateAchievementEvidence([saved]).every(item => !item.id.startsWith('RANK')));
  saved.practice.savedAt = null;
  assert.ok(evaluateAchievementEvidence([saved], () => 'male').every(item => !item.id.startsWith('RANK')));
});

test('PG1 uses the frozen baseline, counts the closed full prefix and keeps repeated sessions distinct', () => {
  const sources = [1, 2, 3].map(day => entry(`source-${day}`, repeat(4, 5), { day }));
  function withBaseline(id: string, rows: number[][], active = false) {
    const training = entry(id, rows, { active });
    training.practice.progressBaselines = { 2: freezeProgressBaseline(sources, id, training.startedAt, conditions, training.startedAt) };
    for (const series of training.practice.rounds[0].series) series.progressBaselineId = 2;
    return training;
  }
  const completed = withBaseline('completed', repeat(4, 6));
  const gains = result([completed]);
  assert.equal(gains.get('PROGRESS01'), 1);
  assert.equal(gains.get('PROGRESS02'), 1);
  assert.equal(gains.has('PROGRESS03'), false);
  assert.equal(gains.get('PROGRESS08'), 1);
  assert.equal(result([withBaseline('active', repeat(4, 6), true)]).has('PROGRESS01'), false);
  assert.equal(result([withBaseline('partial', [[6, 6], ...repeat(4, 6)])]).has('PROGRESS01'), false);
  const long = withBaseline('long', repeat(10, 6));
  assert.equal(result([long]).get('PROGRESS03'), 1);
  assert.equal(result([completed, long, completed, withBaseline('third', repeat(4, 6))]).get('PROGRESS08'), 3);
});

test('PG1 combines matching condition blocks only when their frozen snapshots agree', () => {
  const sources = [1, 2, 3].map(day => entry(`source-${day}`, repeat(4, 5), { day }));
  const training = entry('repeated-conditions', repeat(5, 6));
  const first = freezeProgressBaseline(sources, training.id, training.startedAt, conditions, training.startedAt);
  const other = { ...conditions, distanceMeters: 20 };
  const series = training.practice.rounds[0].series;
  series[2].conditions = other;
  for (const [index, item] of series.entries()) item.progressBaselineId = index < 2 ? 2 : index === 2 ? 4 : 5;
  training.practice.progressBaselines = {
    2: first,
    4: freezeProgressBaseline(sources, training.id, training.startedAt, other, at(10, 10)),
    5: { ...first, frozenAt: at(10, 10) },
  };
  assert.equal(result([training]).get('PROGRESS01'), 1);
  training.practice.progressBaselines[5] = freezeProgressBaseline(sources.slice(1), training.id, training.startedAt, conditions, at(10, 10));
  assert.equal(result([training]).has('PROGRESS01'), false);
});

test('gear loyalty tracks saved IDs through renames and requires a single identity throughout each completed session', () => {
  assert.equal(getAchievementDefinition('GEAR02')?.target, 10);
  assert.equal(getAchievementDefinition('GEAR06')?.target, 50);
  const completed = Array.from({ length: 50 }, (_, index) => entry(`gear-${index}`, [[0]], { setup: {
    ...conditions, equipment: { ...conditions.equipment!, name: `Комплект ${index}`,
      bow: { ...conditions.equipment!.bow, id: 'bow-one', name: `Лук ${index}` } },
  } }));
  assert.equal(result([...completed.slice(0, 9), completed[0]]).get('GEAR02'), 9);
  assert.equal(result(completed.slice(0, 10)).get('GEAR02'), 10);
  assert.equal(result(completed.slice(0, 49)).get('GEAR06'), 49);
  assert.equal(result([...completed, completed[0]]).get('GEAR06'), 50);

  const otherBow = structuredClone(completed[0]);
  otherBow.id = 'other-bow';
  otherBow.practice.rounds[0].series[0].conditions.equipment!.bow.id = 'bow-two';
  assert.equal(result([...completed.slice(0, 9), otherBow]).get('GEAR02'), 9);
  const active = { ...completed[9], practice: { ...completed[9].practice, savedAt: null } };
  assert.equal(result([...completed.slice(0, 9), active]).get('GEAR02'), 9);

  const mixed = structuredClone(completed[0]);
  const second = structuredClone(otherBow.practice.rounds[0].series[0]);
  second.id = mixed.practice.nextId++;
  mixed.practice.rounds[0].series.push(second);
  assert.equal(result([mixed]).has('GEAR02'), false);
  assert.equal(result([mixed]).get('GEAR06'), 1);
  second.conditions.equipment = null;
  assert.equal(result([mixed]).has('GEAR06'), false);
  second.shots = [];
  assert.equal(result([mixed]).get('GEAR02'), 1);
  assert.equal(result([mixed]).get('GEAR06'), 1);
});

test('a saved bow can span different kits and legacy names alone cannot establish bow identity', () => {
  const first = entry('first', [[0], [0]]);
  first.practice.rounds[0].series = first.practice.rounds[0].series.map((series, index) => ({ ...series,
    conditions: { ...series.conditions, equipment: { ...series.conditions.equipment!, id: `kit-${index}`, bowId: 'saved-bow' } },
  }));
  assert.equal(result([first]).get('GEAR02'), 1);
  assert.equal(result([first]).has('GEAR06'), false);
  assert.equal(result([entry('legacy-name', [[0]])]).has('GEAR02'), false);
});

test('distance evidence needs twelve consecutive arrows per distance in a completed session', () => {
  assert.equal(getAchievementDefinition('GEAR03')?.target, 3);
  function distances(id: string, segments: [number, number][], active = false) {
    const training = entry(id, segments.map(([, arrows]) => Array<number>(arrows).fill(0)), { active });
    training.practice.rounds[0].series = training.practice.rounds[0].series.map((series, index) => ({ ...series,
      conditions: { ...series.conditions, distanceMeters: segments[index][0] },
    }));
    return training;
  }
  const three = distances('three', [[18, 6], [18, 6], [25, 12], [30, 12]]);
  assert.equal(result([three, three]).get('GEAR03'), 3);
  assert.equal(result([distances('eleven', [[18, 11], [25, 12], [30, 12]])]).get('GEAR03'), 2);
  assert.equal(result([distances('split', [[18, 6], [25, 12], [18, 6]])]).get('GEAR03'), 1);
  assert.equal(result([distances('first', [[18, 6]]), distances('second', [[18, 6]])]).has('GEAR03'), false);
  assert.equal(result([distances('active', [[18, 12]], true)]).has('GEAR03'), false);
  assert.equal(result([three, { ...distances('deleted', [[50, 12]]), deletedAt: at(11) }]).get('GEAR03'), 3);
});

test('selectable X targets cannot meet the native eighteen-metre forty-centimetre achievement format', () => {
  const withX = TARGET_PROFILES.filter(profile => profile.zones.some(zone => zone.code === 'X'));
  assert.deepEqual(withX.map(profile => profile.id), ['wa-outdoor-full-v1', 'wa-outdoor-six-v1']);
  assert.ok(withX.every(profile => profile.diameters.length > 0 && !profile.diameters.includes(400)));
  for (const id of ['HIT03', 'HIT04', 'HIT05']) assert.ok(!ACHIEVEMENT_EVIDENCE_RULE_IDS.some(ruleId => ruleId === id));
});
