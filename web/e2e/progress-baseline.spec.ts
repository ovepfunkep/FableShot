import { expect, test } from '@playwright/test';
import { openHistoryEntry, openTraining } from './journal-navigation.ts';
import { appendShot, applyConditions, completePractice, emptyPractice } from '../src/practice.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import type { Diary } from '../src/persistence.ts';

test('a new practice keeps its comparison numbers after editing a source and reopening', async ({ page }) => {
  const conditions = { ...DEFAULT_CONDITIONS, equipment: {
    id: 'club', name: 'Клубный', bow: { name: 'Баребоу', category: 'barebow' },
    arrows: { name: 'Стрелы', diameterMm: null },
  } };
  const diary: Diary = { version: 1, entries: [1, 2, 3].map(n => {
    let practice = applyConditions(emptyPractice(), conditions);
    for (let i = 0; i < 12; i++) practice = appendShot(practice, { code: '5', points: 5, point: { x: .55, y: 0 } });
    return { id: `source-${n}`, startedAt: `2026-10-0${n}T10:00:00.000Z`,
      practice: completePractice(practice, `2026-10-0${n}T11:00:00.000Z`) };
  }) };
  await page.addInitScript(data => {
    const key = 'app.fableshot.practice-diary.v1';
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(data));
    const gearKey = 'app.fableshot.equipment.v1';
    if (localStorage.getItem(gearKey) === null) localStorage.setItem(gearKey, JSON.stringify({
      bows: [{ id: 'bow', name: 'Баребоу', category: 'barebow' }],
      arrows: [{ id: 'arrows', name: 'Стрелы', diameterMm: null }],
      kits: [{ id: 'club', name: 'Клубный', bowId: 'bow', arrowsId: 'arrows' }],
    }));
  }, diary);
  await page.goto('./');
  await openTraining(page);
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 3; i++) await page.getByTestId('target').click();
    if (s < 3) await page.getByTestId('next-end').click();
  }
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await expect(page.getByTestId('progress-score-value')).toHaveText('+100%');
  await expect(page.getByTestId('progress-score-average')).toHaveText('5,0 → 10,0');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('home-practice-horizontal')).toContainText('+100%');
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId('history-screen').getByLabel('Прогресс относительно похожих тренировок +100%')).toBeVisible();

  await openHistoryEntry(page, 'source-3');
  await expect(page.getByTestId('progress-score-card')).toHaveCount(0);
  await page.locator('[data-testid^="report-end-"]').first().click();
  await page.getByTestId('shot-1').click();
  await page.getByRole('button', { name: 'Отметить промах', exact: true }).click();
  await page.getByTestId('next-end').click();
  await page.reload();
  await openHistoryEntry(page);
  await expect(page.getByTestId('progress-score-value')).toHaveText('+100%');
  await expect(page.getByTestId('progress-source-changed')).toBeVisible();
  await page.getByTestId('progress-score-value').click();
  await expect(page.getByTestId('progress-score-help')).toContainText('изменена');
});
