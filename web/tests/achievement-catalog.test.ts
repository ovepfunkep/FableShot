import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACHIEVEMENT_BOW_LABELS, ACHIEVEMENT_CATALOG, ACHIEVEMENT_RARITY_ORDER, achievementRarityFor,
  achievementScopesFor, achievementTierOrder, getAchievementDefinition,
} from '../src/achievement-catalog.ts';

function rule(id: string) {
  const definition = getAchievementDefinition(id);
  assert.ok(definition, `Missing achievement ${id}`);
  return definition;
}

test('catalog preserves active runtime IDs, ordering, count targets and the source rule text', () => {
  assert.equal(ACHIEVEMENT_CATALOG.length, 74);
  assert.equal(new Set(ACHIEVEMENT_CATALOG.map(item => item.id)).size, ACHIEVEMENT_CATALOG.length);
  assert.deepEqual(ACHIEVEMENT_CATALOG.slice(0, 9).map(item => item.id),
    ['START01', 'START05', 'START06', 'START07', 'START08', 'START09', 'START10', 'START02', 'START03']);
  assert.deepEqual(Object.fromEntries(ACHIEVEMENT_CATALOG.filter(item => item.target > 1).map(item => [item.id, item.target])), {
    START05: 5, START06: 100, START07: 500, START08: 1000, START09: 20, START10: 100,
    PROGRESS08: 3, GEAR02: 10, GEAR03: 3, GEAR06: 50,
  });
  assert.equal(rule('HIT01').title, 'Тройной эспрессо');
  assert.match(rule('HIT01').description, /из 3 стрел.*\n18 м · мишень 40 см\./);
  assert.match(rule('GROUP05').description, /0,50 в каждой серии и средний балл окна от 7/);
  assert.match(rule('GEAR03').description, /12 зачётных стрел подряд на каждой из трёх дистанций/);
  assert.equal(rule('MIND08').family, 'archive');
  for (const id of ['MIND05', 'MIND06', 'MIND07', 'first-practice', 'XP']) {
    assert.equal(getAchievementDefinition(id), undefined);
  }
});

test('only supported bow categories are in scope and rank-format rules use three of them', () => {
  assert.deepEqual(achievementScopesFor(rule('APP01')), ['global']);
  assert.deepEqual(achievementScopesFor(rule('START01')), ['global']);
  assert.deepEqual(achievementScopesFor(rule('HIT01')), ['recurve', 'compound', 'barebow', 'traditional', 'longbow']);
  assert.deepEqual(Object.keys(ACHIEVEMENT_BOW_LABELS), achievementScopesFor(rule('START02')));
  assert.deepEqual(achievementScopesFor(rule('RANK04')), ['recurve', 'compound', 'barebow']);
  assert.deepEqual(achievementScopesFor(rule('PROGRESS06')), ['recurve', 'compound', 'barebow']);
  assert.deepEqual(achievementScopesFor(rule('PROGRESS04')), achievementScopesFor(rule('HIT01')));
});

test('rarity follows the native format matrix and the first ten is the starter tier', () => {
  const formatRule = rule('HIT01');
  const levels = (scope: string) => ACHIEVEMENT_RARITY_ORDER.map(rarity => achievementRarityFor({ ...formatRule, rarity }, scope));
  assert.deepEqual(levels('compound'), ['Common', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']);
  assert.deepEqual(levels('recurve'), ACHIEVEMENT_RARITY_ORDER);
  for (const scope of ['barebow', 'traditional', 'longbow']) {
    assert.deepEqual(levels(scope), ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Mythic']);
  }
  assert.equal(achievementRarityFor(rule('RANK04'), 'compound'), 'Rare');
  assert.equal(achievementRarityFor(formatRule, 'other'), formatRule.rarity);
  const starter = rule('START02');
  assert.equal(starter.priority, 2);
  assert.equal(starter.family, formatRule.family);
  assert.ok(achievementTierOrder(starter) < achievementTierOrder(formatRule));
});
