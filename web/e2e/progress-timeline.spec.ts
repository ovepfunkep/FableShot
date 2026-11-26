import { readDiary } from './stored-journal.ts';
import { expect, test } from '@playwright/test';
import { appendShot, applyConditions, emptyPractice } from '../src/practice.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';

test('progress scrolls across the full history and compares equipment aliases within the same bow class', async ({ page }) => {
  const entries = ['2026-01-05', '2026-06-12', '2026-10-25', '2026-11-01'].map((date, i) => {
    let practice = applyConditions(emptyPractice(), { ...DEFAULT_CONDITIONS, equipment: {
      id: `kit-${i}`, name: `Комплект ${i}`, bow: { name: 'Баребоу', category: 'barebow' }, arrows: { name: 'Стрелы', diameterMm: null },
    } });
    const points = 7 + i;
    for (let shot = 0; shot < 3; shot++) practice = appendShot(practice, { code: String(points), points, point: { x: (10 - points) / 10 + .02, y: 0 } });
    return { id: `timeline-${i}`, startedAt: `${date}T12:00:00Z`, practice: { ...practice, savedAt: `${date}T13:00:00Z` } };
  });
  await page.addInitScript(entries => localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries })), entries);
  await page.goto('./');
  await page.getByTestId('nav-progress').click();
  const timeline = page.getByTestId('progress-trend');
  await expect(timeline).toBeVisible();
  await page.getByTestId('progress-view-compare').click();
  const average = page.getByTestId('progress-insight-average');
  await expect(average).toContainText('+2,0 балла');
  await average.getByText('База · 3 трен.').click();
  await expect(average.getByText('05.01.2026 · 7,0')).toBeVisible();
  await expect(page.getByTestId('progress-insight-rms')).toContainText('Без изменений');
  await page.getByTestId('analytics-filters').click();
  await page.getByTestId('analytics-conditions').click();
  const conditionOptions = page.getByRole('dialog', { name: 'Сопоставимые условия' });
  await expect(conditionOptions.locator('.choice-picker-options button')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(conditionOptions).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('progress-filter-sheet')).toHaveCount(0);
  const chart = page.getByTestId('progress-trend-chart');
  await expect.poll(() => chart.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByTestId('progress-trend-value')).toContainText('10,0');
  await page.getByRole('button', { name: 'Показатель графика' }).click();
  await page.getByRole('button', { name: 'Доля десяток', exact: true }).click();
  await expect(page.getByTestId('progress-trend-value')).toContainText('100');
  await chart.evaluate(node => { node.scrollLeft = 0; });
  await expect(page.getByTestId('progress-trend-range')).toContainText('05.01.2026');
  await page.getByRole('button', { name: 'Показатель графика' }).click();
  await page.getByRole('button', { name: 'Средний балл', exact: true }).click();
  await chart.evaluate(node => { node.scrollLeft = 0; });
  await expect(page.getByTestId('progress-trend-value')).toContainText('7,0');
  await timeline.screenshot({ path: '../artifacts/web-0.15.0-progress.png' });
  await page.getByTestId('analytics-filters').click();
  await page.getByTestId('analytics-period--1').click();
  await page.getByTestId('analytics-from').fill('2026-10-25');
  await page.getByTestId('analytics-to').fill('2026-11-01');
  await expect(page.getByTestId('analytics-count')).toHaveText('Завершённых занятий 2');
  await page.getByTestId('analytics-apply').click();
  await expect(page.locator('.journal-tab-metrics')).toContainText('9,5');
  await page.getByTestId('analytics-filters').click();
  await page.getByTestId('analytics-choose').click();
  await page.getByTestId('analytics-session-timeline-3').uncheck();
  await expect(page.getByTestId('analytics-count')).toHaveText('Завершённых занятий 1');
  await page.getByTestId('analytics-apply').click();
  await expect(page.locator('.journal-tab-metrics')).toContainText('9,0');
  await expect(page.getByTestId('progress-insights')).toHaveCount(0);
  await page.getByTestId('analytics-filters').click();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await page.getByRole('button', { name: 'Комплект', exact: true }).click();
  await page.getByRole('button', { name: 'Комплект 3', exact: true }).click();
  await page.getByTestId('analytics-apply').click();
  await expect(page.locator('.journal-tab-metrics')).toContainText('10,0');
  await expect(page.getByTestId('progress-insights')).toHaveCount(0);
  expect((await readDiary(page)).entries).toEqual(entries);
});

test('the default graph shows every dated workout with an unspecified bow class', async ({ page }) => {
  const entries = ['2026-11-07', '2026-11-08', '2026-11-09'].map((date, index) => {
    const points = 8 + index;
    const practice = appendShot(emptyPractice(), { code: String(points), points, point: null, imported: true });
    return { id: 'private-import-id-' + index, localDate: date, startedAt: date + 'T12:00:00Z',
      practice: { ...practice, savedAt: date + 'T13:00:00Z' } };
  });
  await page.addInitScript(entries => localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries })), entries);
  await page.goto('./');
  await page.getByTestId('nav-progress').click();
  const graph = page.getByTestId('progress-trend');
  await expect(graph.getByTestId('progress-view-history')).toHaveAttribute('aria-pressed', 'true');
  await expect(graph.getByTestId('progress-trend-chart').getByRole('button')).toHaveCount(3);
  await expect(graph).not.toContainText('private-import-id');
  await graph.getByTestId('progress-view-compare').click();
  await expect(graph).toContainText('Для сравнения нужны тренировки с указанным классом лука');
  await expect(graph.getByTestId('progress-insights')).toHaveCount(0);
});
