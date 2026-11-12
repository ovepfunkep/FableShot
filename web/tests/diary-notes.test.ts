import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeNoteTags, isDiaryNotes, notesInScope } from '../src/diary-notes.ts';
import { isDiary } from '../src/persistence.ts';
import type { DiaryNote } from '../src/diary-notes.ts';

const note: DiaryNote = { id: 'note-a', localDate: '2028-02-29', body: 'Записал положение плеча.', tags: ['Техника'],
  place: '', feeling: '', conditions: '', createdAtMs: 1, updatedAtMs: 2 };

test('archived standalone notes remain valid data and disappear from the active editor list', () => {
  const archived = { ...note, deletedAtMs: 3 };
  assert.equal(isDiary({ version: 1, entries: [], notes: [archived] }), true);
  assert.deepEqual(notesInScope([archived], {}), []);
  assert.deepEqual(notesInScope([{ ...archived, deletedAtMs: null }], {}), [{ ...archived, deletedAtMs: null }]);
  assert.equal(isDiary({ version: 1, entries: [], notes: [{ ...note, seriesId: 3 }] }), false);
  assert.equal(isDiaryNotes([{ ...note, deletedAtMs: -1 }]), false);
  assert.equal(isDiaryNotes([{ ...note, deletedAtMs: '2026-01-01' }]), false);
});

test('note tags keep the first spelling and enforce Android count, length and character limits', () => {
  assert.deepEqual(encodeNoteTags(' Техника ,ТЕХНИКА, ,дыхание, Дыхание'), ['Техника', 'дыхание']);
  assert.deepEqual(encodeNoteTags(' , ,'), []);
  assert.equal(encodeNoteTags(Array.from({ length: 12 }, (_, index) => `Тег ${index}`).join(',')).length, 12);
  assert.throws(() => encodeNoteTags(Array.from({ length: 13 }, (_, index) => `Тег ${index}`).join(',')), /12 тегов/);
  assert.deepEqual(encodeNoteTags('я'.repeat(30)), ['я'.repeat(30)]);
  assert.throws(() => encodeNoteTags('я'.repeat(31)));
  assert.throws(() => encodeNoteTags('тех\u0000ника'));
});

test('note validation permits details or tags alone and rejects blank or malformed records', () => {
  assert.equal(isDiaryNotes([]), true);
  assert.equal(isDiaryNotes([note]), true);
  assert.equal(isDiaryNotes([{ ...note, body: '' }]), true);
  assert.equal(isDiaryNotes([{ ...note, body: '', tags: [], feeling: 'Восстановился' }]), true);
  assert.equal(isDiaryNotes([{ ...note, body: '\n  ', tags: [], place: '\t' }]), false);
  assert.equal(isDiaryNotes([{ ...note, localDate: '2027-02-29' }]), false);
  assert.equal(isDiaryNotes([{ ...note, localDate: '2028-2-29' }]), false);
  assert.equal(isDiaryNotes([{ ...note, body: 'x'.repeat(8000), place: 'x'.repeat(120), feeling: 'x'.repeat(240), conditions: 'x'.repeat(500) }]), true);
  assert.equal(isDiaryNotes([{ ...note, body: 'x'.repeat(8001) }]), false);
  assert.equal(isDiaryNotes([{ ...note, place: 'x'.repeat(121) }]), false);
  assert.equal(isDiaryNotes([{ ...note, feeling: 'x'.repeat(241) }]), false);
  assert.equal(isDiaryNotes([{ ...note, conditions: 'x'.repeat(501) }]), false);
  assert.equal(isDiaryNotes([{ ...note, tags: ['Техника', 'техника'] }]), false);
  assert.equal(isDiaryNotes([{ ...note, tags: ['техника,стойка'] }]), false);
  assert.equal(isDiaryNotes([{ ...note, tags: [' техника'] }]), false);
  assert.equal(isDiaryNotes([{ ...note, id: 'x\u0000' }]), false);
  assert.equal(isDiaryNotes([{ ...note, updatedAtMs: Infinity }]), false);
  assert.equal(isDiaryNotes([{ ...note, seriesId: 0 }]), false);
  assert.equal(isDiaryNotes([{ ...note, conditionKey: '' }]), false);
  assert.equal(isDiaryNotes([note, { ...note, body: 'Другая заметка' }]), false);
});

test('note lists match both scope fields and sort by date then creation time without changing stored order', () => {
  const notes = [note,
    { ...note, id: 'condition', conditionKey: 'A' },
    { ...note, id: 'series', seriesId: 1 },
    { ...note, id: 'other-series', seriesId: 2 },
    { ...note, id: 'combined', seriesId: 1, conditionKey: 'A' },
    { ...note, id: 'later-created', createdAtMs: 2 },
    { ...note, id: 'later-date', localDate: '2028-03-01' },
  ];
  const storedOrder = notes.map(item => item.id);
  assert.equal(isDiaryNotes(notes), true);
  assert.deepEqual(notesInScope(notes, {}).map(item => item.id), ['later-date', 'later-created', 'note-a']);
  assert.deepEqual(notesInScope(notes, { seriesId: 1 }).map(item => item.id), ['series']);
  assert.deepEqual(notesInScope(notes, { conditionKey: 'A' }).map(item => item.id), ['condition']);
  assert.deepEqual(notesInScope(notes, { seriesId: 1, conditionKey: 'A' }).map(item => item.id), ['combined']);
  assert.deepEqual(notes.map(item => item.id), storedOrder);
});
