import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendShot, bindTechnique, completePractice, emptyPractice, removeShot } from '../src/practice.ts';
import { isTechniqueSelection, newTechniqueText } from '../src/technique.ts';
import type { TechniqueSelection } from '../src/technique.ts';

test('attaching technique snapshots never starts a series or rewrites shots', () => {
  const text = newTechniqueText();
  text.title = 'Моя техника';
  const selection: TechniqueSelection = { versionId: 'version-1', versionNumber: 1, title: text.title, payload: text, focus1: 'Плечи', focus2: '' };
  assert.equal(isTechniqueSelection(selection), true);
  const practice = appendShot(emptyPractice(), { point: { x: 0, y: 0 }, points: 10, code: '10' });
  const attached = bindTechnique(practice, selection);
  assert.equal(attached.rounds, practice.rounds);
  assert.equal(attached.nextId, practice.nextId);
  assert.equal(attached.techniqueUses?.[0].arrowsBefore, 1);
  assert.equal(bindTechnique(attached, selection), attached);
  text.title = 'Новая редакция';
  assert.equal(attached.techniqueUses?.[0].selection.payload?.title, 'Моя техника');
  const removed = removeShot(attached, 2, 0);
  assert.equal(removed.techniqueUses, attached.techniqueUses);
  const completed = completePractice(attached, '2026-11-11T10:00:00Z');
  assert.equal(bindTechnique(completed, { ...selection, focus1: 'Другой фокус' }), completed);
});
