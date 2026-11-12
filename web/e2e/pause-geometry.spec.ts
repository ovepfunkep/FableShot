import { expect, test } from '@playwright/test';
import { appendShot, applyConditions, completePractice, emptyPractice } from '../src/practice.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import { openTraining } from './journal-navigation.ts';

test('paused training remains unfinished and resumes after reload without losing hits', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await page.getByTestId('session-pause').click();
  await expect(page.getByTestId('home-start-training')).toHaveText('Продолжить тренировку');
  await page.getByTestId('nav-history').click();
  const first = page.locator('[data-testid^="session-"]').first();
  await first.click();
  await expect(page.getByTestId('session-resume')).toBeVisible();
  await page.getByTestId('session-resume').click();
  await page.getByTestId('session-resume-confirm').click();
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await page.getByTestId('session-pause').click();
  await page.reload();
  await page.getByTestId('home-start-training').click();
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  expect(await page.evaluate(() => {
    const diary = JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!);
    return diary.entries.map(entry => ({ paused: entry.paused, savedAt: entry.practice.savedAt }));
  })).toEqual([{ paused: false, savedAt: null }]);
});

test('geometry trend shows exact RMS and offset values and respects its display setting', async ({ page }) => {
  const conditions = { ...DEFAULT_CONDITIONS, equipment: { id: 'kit', name: 'Kit',
    bow: { name: 'Bow', category: 'recurve' }, arrows: { name: 'Arrows', diameterMm: null } } };
  const entries = [1, 2, 3].map(index => {
    let practice = applyConditions(emptyPractice(), conditions);
    for (const x of [.01, .02, .03]) practice = appendShot(practice,
      { code: '10', points: 10, point: { x: x * index, y: 0 } });
    return { id: String(index), title: `Training ${index}`, startedAt: `2026-10-0${index}T10:00:00Z`,
      practice: completePractice(practice, `2026-10-0${index}T11:00:00Z`) };
  });
  await page.addInitScript(entries => {
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries }));
  }, entries);
  await page.goto('./');
  await page.getByTestId('nav-progress').click();
  const graph = page.getByTestId('geometry-trend');
  await expect(graph.getByTestId('geometry-trend-point')).toHaveCount(3);
  await expect(graph.getByTestId('geometry-trend-selected-value')).toHaveText('4,9 мм');
  await graph.getByTestId('geometry-trend-offset').click();
  await expect(graph.getByTestId('geometry-trend-selected-value')).toHaveText('12 мм');
  await graph.getByTestId('geometry-trend-prev').click();
  await expect(graph.getByTestId('geometry-trend-selected-value')).toHaveText('8 мм');
  await graph.screenshot({ path: '../artifacts/web-0.22.0-geometry.png' });
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-statistics').click();
  await page.getByRole('switch', { name: 'Кучность и точность по занятиям', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(graph).toHaveCount(0);
});
