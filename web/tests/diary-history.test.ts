import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_HISTORY_FILTERS, filterDiary, setDiaryDeleted } from '../src/diary-history.ts';
import { emptyPractice } from '../src/practice.ts';

const entry = (id: string, date: string) => ({ id, startedAt: date, title: `Занятие ${id}`,
  practice: { ...emptyPractice(), savedAt: '2026-11-11T10:00:00Z' } });
test('history sorts known dates newest first, puts unknown dates last and filters search/dates/trash', () => {
  const entries = [entry('old', '2025-01-02T10:00:00Z'), entry('unknown', ''), entry('new', '2026-11-11T10:00:00Z')];
  assert.deepEqual(filterDiary(entries, DEFAULT_HISTORY_FILTERS).map(entry => entry.id), ['new', 'old', 'unknown']);
  assert.deepEqual(filterDiary(entries, { ...DEFAULT_HISTORY_FILTERS, query: 'OLD' }).map(entry => entry.id), ['old']);
  assert.deepEqual(filterDiary(entries, { ...DEFAULT_HISTORY_FILTERS, from: '2026-01-01' }).map(entry => entry.id), ['new']);
  const deleted = setDiaryDeleted({ version: 1, entries }, 'old', true);
  assert.equal(filterDiary(deleted.entries, DEFAULT_HISTORY_FILTERS).length, 2);
  assert.deepEqual(filterDiary(deleted.entries, { ...DEFAULT_HISTORY_FILTERS, deleted: true }).map(entry => entry.id), ['old']);
  assert.equal(filterDiary(setDiaryDeleted(deleted, 'old', false).entries, DEFAULT_HISTORY_FILTERS).length, 3);
  assert.equal(entries[0].practice, deleted.entries[0].practice);
  assert.equal(Object.hasOwn(entries[0], 'deletedAt'), false);
});
test('an active diary entry cannot be deleted and an unknown ID changes nothing', () => {
  const diary = { version: 1 as const, entries: [{ ...entry('active', '2026-11-11'), practice: emptyPractice() }] };
  assert.throws(() => setDiaryDeleted(diary, 'active', true), /заверши/);
  assert.throws(() => setDiaryDeleted(diary, 'missing', true), /найдена/);
  assert.equal(diary.entries[0].practice.savedAt, null);
});
