import { expect, test } from '@playwright/test';
import { openHistoryEntry, openTraining } from './journal-navigation.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import { appendShot, applyConditions, completePractice, emptyPractice } from '../src/practice.ts';
import { conditionsKey } from '../src/composite-scoring.ts';

test('Home uses recorded dates and asks for a kit when the habitual kit is archived', async ({ page }) => {
  const kit = { id: 'kit', name: 'Старый комплект', bowId: 'bow', arrowsId: null };
  const bow = { id: 'bow', name: 'Лук', category: 'recurve' };
  const conditions = { ...DEFAULT_CONDITIONS, equipment: { ...kit, bow, arrows: { name: '', diameterMm: null } } };
  const practice = completePractice(appendShot(applyConditions(emptyPractice(), conditions),
    { code: '10', points: 10, point: { x: 0, y: 0 } }), '2026-01-06T00:15:00.000Z');
  await page.addInitScript(({ kit, bow, practice }) => {
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries: [
      { id: 'known', startedAt: '2026-01-06T00:00:00.000Z', localDate: '2026-01-05', practice },
      { id: 'unknown', startedAt: '2026-01-06T00:01:00.000Z', localDate: null, practice },
    ] }));
    localStorage.setItem('app.fableshot.equipment.v1', JSON.stringify({ bows: [bow], arrows: [], kits: [{ ...kit, archived: true }] }));
  }, { kit, bow, practice });
  await page.goto('./');
  await expect(page.getByTestId('home-practice-session')).toHaveCount(1);
  await expect(page.getByTestId('home-practice-horizontal').locator('time')).toHaveAttribute('datetime', '2026-01-05');
  await expect(page.getByTestId('home-all-time-totals')).toContainText('2Тренировок');
  await expect(page.getByTestId('home-conditions-grid')).not.toContainText('3 в серии');
  await expect(page.getByTestId('home-start-training')).toHaveText('Выбрать снаряжение');
  await page.getByTestId('home-start-training').click();
  await expect(page.getByTestId('conditions-equipment')).toContainText('Без комплекта');
});

test('home starts new sessions, keeps earlier results and connects all four tabs', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByTestId('nav-home')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('home-change-conditions').click();
  await page.getByTestId('distance-30').click();
  await page.getByTestId('start-training').click();
  for (let index = 0; index < 2; index++) {
    const score = index === 0 ? 10 : 0;
    if (score) await page.getByTestId('target').click();
    else await page.getByRole('button', { name: 'Отметить промах' }).click();
    await expect(page.getByTestId('series-score')).toHaveText(`${score}/10`);
    await page.getByRole('button', { name: 'Завершить тренировку' }).click();
    await page.getByTestId('training-confirm').click();
    await expect(page.getByTestId('report-round-total-1')).toContainText(`${score}/10`);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    if (index === 0) await openTraining(page);
  }
  await expect(page.getByTestId('home-practice-session')).toHaveCount(2);
  await page.reload();
  await page.getByTestId('nav-progress').click();
  await expect(page.getByTestId('progress-screen')).toBeVisible();
  await page.getByTestId('nav-equipment').click();
  await page.getByTestId('equipment-catalog-tab-kits').click();
  await page.getByTestId('equipment-catalog-add').click();
  await expect(page.getByTestId('equipment-catalog-name')).toBeVisible();
  await page.getByTestId('equipment-catalog-name').fill('Клубный комплект');
  await page.getByTestId('equipment-catalog-save').click();
  const kit = page.locator('[data-testid^="equipment-catalog-card-"]').filter({ has: page.getByRole('heading', { name: 'Клубный комплект' }) });
  await expect(kit).toBeVisible();
  await kit.locator('[data-testid^="equipment-catalog-favorite-"]').click();
  await expect(kit.locator('[data-testid^="equipment-catalog-favorite-"]')).toHaveAttribute('aria-pressed', 'true');
  await kit.locator('[data-testid^="equipment-catalog-archive-"]').click();
  await expect(kit).toHaveCount(0);
  await page.getByTestId('equipment-catalog-show-archive').click();
  await expect(kit).toBeVisible();
  await expect(kit.locator('[data-testid^="equipment-catalog-favorite-"]')).toHaveCount(0);
  await openHistoryEntry(page);
  await expect(page.getByTestId('report-round-total-1')).toContainText('0/10');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  const entries = page.getByTestId('history-screen').locator('[data-testid^="session-"]');
  await expect(entries).toHaveCount(2);
  await entries.last().click();
  await expect(page.getByTestId('report-round-total-1')).toContainText('10/10');
  await expect(page.getByTestId('report-conditions')).toHaveCount(0);
  await page.getByTestId('report-conditions-open').click();
  await expect(page.getByTestId('report-conditions').getByLabel('Дистанция: 30 м')).toBeVisible();
});

test('history trash preserves the report and restores the same training', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await page.getByRole('button', { name: 'Удалить тренировку', exact: true }).click();
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await page.getByTestId('nav-history').click();
  const cards = page.getByTestId('history-screen').locator('[data-testid^="session-"]');
  await expect(cards).toHaveCount(0);
  await page.getByTestId('history-filters').click();
  await page.getByRole('checkbox', { name: 'Корзина' }).check();
  await page.keyboard.press('Escape');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveClass(/is-deleted/);
  await cards.first().click();
  await expect(page.getByTestId('report-round-total-1')).toContainText('10/10');
  await expect(page.getByTestId('session-resume')).toHaveCount(0);
  await page.getByRole('button', { name: 'Восстановить тренировку' }).click();
  await expect(cards).toHaveCount(0);
  await page.getByTestId('history-filters').click();
  await page.getByRole('checkbox', { name: 'Корзина' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(cards).toHaveCount(1);
});

test('training notes retain historical condition labels and new notes use training scope', async ({ page }) => {
  const practice = completePractice(appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } }),
    '2026-11-11T10:00:00Z');
  const conditionKey = conditionsKey({ ...DEFAULT_CONDITIONS, distanceMeters: 30 });
  const notes = [{ id: 'old-condition', localDate: '2026-11-11', body: 'Стрельба в дождь', tags: [], place: '', feeling: '',
    conditions: '', createdAtMs: 1, updatedAtMs: 1, conditionKey }];
  await page.addInitScript(({ practice, notes }) => {
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries: [
      { id: 'legacy-note', startedAt: '2026-11-11T09:00:00Z', practice, notes },
    ] }));
  }, { practice, notes });
  await page.goto('./');
  await openHistoryEntry(page, 'legacy-note');
  await page.getByRole('button', { name: 'Заметки тренировки' }).click();
  const historical = page.getByTestId('note-item').filter({ hasText: 'Стрельба в дождь' });
  await expect(historical).toContainText('Условия: 30 м');
  await page.getByTestId('note-add').click();
  await page.getByTestId('note-body').fill('Болит голова');
  await page.getByTestId('note-save').click();
  await expect(historical).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!).entries[0].notes);
  expect(saved[0].conditionKey).toBe(conditionKey);
  expect(saved[1]).not.toHaveProperty('conditionKey');
});

test('training duration survives reload and continuation excludes the time after completion', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-11T10:00:00Z'));
  await page.goto('./');
  await openTraining(page);
  await page.getByTestId('target').click();
  await page.clock.setFixedTime(new Date('2026-11-11T10:01:00Z'));
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await expect(page.getByTestId('report-training-time')).toHaveText('1 мин');
  await page.reload();
  await openHistoryEntry(page);
  await expect(page.getByTestId('report-training-time')).toHaveText('1 мин');
  await page.clock.setFixedTime(new Date('2026-11-11T11:00:00Z'));
  await page.getByTestId('session-resume').click();
  await expect(page.getByRole('dialog', { name: 'Продолжить тренировку?' })).toBeVisible();
  await page.getByTestId('session-resume-confirm').click();
  await page.getByTestId('target').click();
  await page.clock.setFixedTime(new Date('2026-11-11T11:02:00Z'));
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await expect(page.getByTestId('report-training-time')).toHaveText('3 мин');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('open-profile').click();
  await expect(page.getByTestId('shooting-hours-total')).toHaveText('3 мин');
  await page.getByRole('button', { name: 'Изменить базу часов стрельбы' }).click();
  await page.getByLabel('Часы', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByTestId('shooting-hours-total')).toHaveText('2 ч 3 мин');
  await page.reload();
  await page.getByTestId('open-profile').click();
  await expect(page.getByTestId('shooting-hours-total')).toHaveText('2 ч 3 мин');
  await page.getByTestId('assigned-open').click();
  await page.getByTestId('assigned-add').click();
  await page.getByTestId('assigned-discipline').selectOption('barebow');
  await page.getByTestId('assigned-category').selectOption('male');
  await page.getByTestId('assigned-level').selectOption('III');
  await page.getByTestId('assigned-current').check();
  await page.getByTestId('assigned-save').click();
  await expect(page.getByTestId('assigned-list-sheet')).toContainText('КЛб (М) · III');
  await page.reload();
  await page.getByTestId('open-profile').click();
  await expect(page.getByTestId('assigned-summary')).toContainText('III');
});

test('series notes survive reload and are searchable in history', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await page.locator('[data-testid^="report-end-"]').first().click();
  await page.getByRole('button', { name: 'Заметки серии' }).click();
  await page.getByTestId('note-add').click();
  await page.getByTestId('note-body').fill('Плечо расслаблено');
  await page.getByTestId('note-tags').fill('Техника, Стойка');
  await page.getByTestId('note-save').click();
  await expect(page.getByTestId('note-item')).toContainText('Плечо расслаблено');
  await page.reload();
  await page.getByTestId('nav-history').click();
  await page.getByRole('searchbox', { name: 'Найти тренировку' }).fill('стойка');
  await expect(page.locator('[data-testid^="session-"]')).toHaveCount(1);
  await page.locator('[data-testid^="session-"]').first().click();
  await page.locator('[data-testid^="report-end-"]').first().click();
  await page.getByRole('button', { name: 'Заметки серии' }).click();
  await expect(page.getByTestId('note-item')).toContainText('Плечо расслаблено');
});
