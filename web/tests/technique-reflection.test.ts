import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendShot, bindTechnique, completePractice, deleteSeries, emptyPractice, resumePractice } from '../src/practice.ts';
import type { Practice } from '../src/practice.ts';
import type { TechniqueSelection } from '../src/technique.ts';
import {
  emptyTechniqueReflection, hasTechniqueReflection, isTechniqueReflectionEntry, isTechniqueReflections, MAX_REFLECTION_TEXT,
  relevantTechniqueUseIndexes, techniqueUsePlace, updateTechniqueReflection,
} from '../src/technique-reflection.ts';

function practice(): Practice {
  const selection: TechniqueSelection = { versionId: null, versionNumber: null, title: 'Мой фокус', payload: null, focus1: 'Плечи', focus2: '' };
  const active = bindTechnique(appendShot(emptyPractice(), { point: { x: 0, y: 0 }, points: 10, code: '10' }), selection);
  return completePractice(active, '2026-11-11T10:00:00Z');
}

test('reflection validates native text boundaries and each nullable rating', () => {
  const entry = emptyTechniqueReflection();
  assert.equal(isTechniqueReflectionEntry(entry), true);
  for (const rating of [null, 'yes', 'unstable', 'untracked']) {
    assert.equal(isTechniqueReflectionEntry({ ...entry, worked: 'я'.repeat(MAX_REFLECTION_TEXT), rating }), true);
  }
  for (const invalid of [null, [], {}, { ...entry, rating: 'no' }, { ...entry, worked: 3 },
    { ...entry, worked: 'я'.repeat(MAX_REFLECTION_TEXT + 1) }, { ...entry, question: 'a'.repeat(MAX_REFLECTION_TEXT + 1) }]) {
    assert.equal(isTechniqueReflectionEntry(invalid), false);
  }
  assert.equal(hasTechniqueReflection(entry), false);
  assert.equal(hasTechniqueReflection({ ...entry, worked: '   ' }), false);
  assert.equal(hasTechniqueReflection({ ...entry, rating: 'untracked' }), true);
});

test('reflection map accepts only canonical existing use indices', () => {
  const entry = emptyTechniqueReflection();
  assert.equal(isTechniqueReflections({}, 0), true);
  assert.equal(isTechniqueReflections({ 0: entry, 1: entry }, 2), true);
  for (const invalid of [null, [], { '-1': entry }, { '01': entry }, { '1.0': entry }, { 1: entry }, { '9007199254740992': entry }, { 0: {} }]) {
    assert.equal(isTechniqueReflections(invalid, 1), false);
  }
  assert.equal(isTechniqueReflections(JSON.parse('{"__proto__":{"worked":"","question":"","rating":null}}'), 1), false);
});

test('saving reflection preserves scores, immutable technique snapshots and previous reflection entries', () => {
  const initial = practice();
  const entry = { worked: '  Ровный выпуск\nбез рывка  ', question: 'Положение локтя', rating: 'unstable' as const };
  const next = updateTechniqueReflection(initial, 0, entry);
  assert.deepEqual(next.techniqueReflections?.['0'], entry);
  assert.equal(next.rounds, initial.rounds);
  assert.equal(next.techniqueUses, initial.techniqueUses);
  assert.equal(initial.techniqueReflections, undefined);
  entry.worked = 'changed after saving';
  assert.equal(next.techniqueReflections?.['0'].worked, '  Ровный выпуск\nбез рывка  ');
  const active = bindTechnique(resumePractice(next), { ...next.techniqueUses![0].selection, focus1: 'Спина' });
  const completed = completePractice(active, '2026-11-11T11:00:00Z');
  const second = updateTechniqueReflection(completed, 1, { worked: 'Получилось', question: '', rating: 'yes' });
  assert.deepEqual(second.techniqueReflections?.['0'], next.techniqueReflections?.['0']);
  assert.equal(second.techniqueReflections?.['1'].rating, 'yes');
});

test('saving rejects active training, nonexistent uses, and malformed stored reflections', () => {
  const initial = practice();
  const entry = emptyTechniqueReflection();
  assert.throws(() => updateTechniqueReflection(resumePractice(initial), 0, entry), /после завершения/);
  for (const index of [-1, 1, 0.5, Number.NaN]) {
    assert.throws(() => updateTechniqueReflection(initial, index, entry), /не найдена/);
  }
  const invalid = { ...initial, techniqueReflections: { 0: { ...entry, rating: 'bad' } } } as never;
  assert.throws(() => updateTechniqueReflection(invalid, 0, entry), /Исходные данные сохранены/);
  assert.throws(() => updateTechniqueReflection(initial, 0, { ...entry, worked: 'x'.repeat(MAX_REFLECTION_TEXT + 1) }), /4000/);
});

test('reflection stays bound to a use after a series is deleted, and empty focus stays absent', () => {
  const initial = updateTechniqueReflection(practice(), 0, { worked: 'Стабильная стойка', question: '', rating: null });
  assert.equal(techniqueUsePlace(initial, 0), 'Раунд 1 · серия 1');
  const deleted = deleteSeries(initial, initial.techniqueUses![0].seriesId);
  assert.deepEqual(deleted.techniqueReflections, initial.techniqueReflections);
  assert.equal(techniqueUsePlace(deleted, 0), 'Серия удалена');
  const noFocus: Practice = { ...initial, techniqueUses: [{ ...initial.techniqueUses![0], selection: {
    ...initial.techniqueUses![0].selection, focus1: '', focus2: '  ',
  } }], techniqueReflections: {} };
  assert.deepEqual(relevantTechniqueUseIndexes(noFocus), []);
  assert.deepEqual(relevantTechniqueUseIndexes({ ...noFocus, techniqueReflections: initial.techniqueReflections }), [0]);
  assert.deepEqual(relevantTechniqueUseIndexes({ ...noFocus, techniqueUses: undefined }), []);
});
