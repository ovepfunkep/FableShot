import { expect, test } from '@playwright/test';
import { emptyPractice } from '../src/practice.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { STATISTIC_SECTIONS } from '../src/statistics-visibility.ts';
import { openHistoryEntry } from './journal-navigation.ts';

test('hit distribution shows proportional sectors and a count list beside them', async ({ page }) => {
  const practice = emptyPractice();
  practice.roundRule = { unit: 'unlimited', limit: null };
  const series = practice.rounds[0].series[0];
  series.plannedCount = 40;
  series.shots = [
    ...Array.from({ length: 19 }, () => ({ code: '10', points: 10, point: null, imported: true as const })),
    { code: 'X', points: 10, point: null, imported: true },
    ...Array.from({ length: 18 }, () => ({ code: '9', points: 9, point: null, imported: true as const })),
    { code: '8', points: 8, point: null, imported: true },
    { code: 'M', points: 0, point: null },
  ];
  practice.savedAt = '2026-11-10T12:00:00Z';
  const diary = { version: 1, entries: [{ id: 'distribution', startedAt: '2026-11-10T11:00:00Z', practice }] };
  await page.addInitScript(value => localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify(value)), diary);
  await page.setViewportSize({ width: 320, height: 570 });
  await page.goto('./');
  await openHistoryEntry(page, 'distribution');

  const distribution = page.getByTestId('report-zone-distribution');
  const pie = distribution.locator('svg');
  const legend = distribution.getByRole('list', { name: 'Попадания по зонам' });
  await expect(legend.getByRole('listitem')).toHaveText(['10: 20', '9: 18', '8: 1', 'M: 1']);
  await expect(legend.getByText('10', { exact: true })).toHaveCSS('color', 'rgb(244, 206, 68)');
  await expect(legend.getByText('8', { exact: true })).toHaveCSS('color', 'rgb(228, 76, 67)');
  await expect(pie.locator('path')).toHaveCount(4);
  await expect(pie.locator('path').nth(0)).toHaveAttribute('fill', '#f4ce44');
  await expect(pie.locator('path').nth(1)).toHaveAttribute('fill', '#f4ce44');
  await expect(pie.locator('path').nth(1)).toHaveAttribute('stroke-width', '1');
  await expect(pie.locator('path').nth(0)).toHaveAttribute('d', /L 80 2 .* 80 158 Z$/);
  await expect(pie.locator('text')).toHaveText(['10', '9']);
  const chartBounds = (await pie.boundingBox())!;
  const legendBounds = (await legend.boundingBox())!;
  expect(legendBounds.x).toBeGreaterThan(chartBounds.x + chartBounds.width);
  expect(legendBounds.x + legendBounds.width).toBeLessThan(320);

  await expect(distribution).toContainText('Доля 10 50,0%');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-statistics').click();
  await page.getByLabel('Доля под диаграммой').selectOption('10+9');
  await page.reload();
  await openHistoryEntry(page, 'distribution');
  await expect(distribution).toContainText('Доля 10+9 95,0%');
});

test('dragging a report block persists its order in the report', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-statistics').click();
  await page.getByText('Порядок блоков тренировки', { exact: true }).click();
  const result = page.getByRole('button', { name: 'Перетащить: Результат', exact: true });
  const series = page.locator('[data-report-order="series"]');
  await result.scrollIntoViewIfNeeded();
  const from = (await result.boundingBox())!;
  const to = (await series.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-report-order]').nth(1)).toHaveAttribute('data-report-order', 'result');
  await page.reload();
  await page.getByTestId('home-start-training').click();
  await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await expect(page.locator('[data-report-block]').first()).toHaveAttribute('data-report-block', 'series');
  await expect(page.locator('[data-report-block]').nth(1)).toHaveAttribute('data-report-block', 'result');
});

test('whole exercise uses two rounds and display switches persist without rewriting the diary', async ({ page }) => {
  const practice = emptyPractice();
  const conditions = { ...DEFAULT_CONDITIONS, equipment: {
    id: 'kit', name: 'Комплект', bow: { name: 'Баребоу', category: 'barebow' as const },
    arrows: { name: 'Стрелы', diameterMm: null },
  } };
  practice.rounds = [0, 1].map(round => ({ id: round * 100 + 1,
    series: Array.from({ length: 10 }, (_, series) => ({ id: round * 100 + series + 2,
      conditions, plannedCount: 3,
      shots: Array.from({ length: 3 }, () => ({ code: '9', points: 9, point: { x: .15, y: 0 } })),
    })),
  }));
  practice.nextId = 200;
  practice.savedAt = '2026-11-10T12:00:00Z';
  const partial = structuredClone(practice);
  partial.rounds[1].series.pop();
  const diary = JSON.stringify({ version: 1, entries: [
    { id: 'stats', startedAt: '2026-11-10T11:00:00Z', practice },
    { id: 'partial', startedAt: '2026-11-10T10:00:00Z', practice: partial },
  ] });
  await page.addInitScript(({ diary, preferences }) => {
    if (!localStorage.getItem('app.fableshot.practice-diary.v1')) {
      localStorage.setItem('app.fableshot.practice-diary.v1', diary);
      localStorage.setItem('app.fableshot.training-preferences.v1', JSON.stringify({ version: 1, preferences }));
    }
  }, { diary, preferences: { ...DEFAULT_PREFERENCES, rankCategory: 'male' } });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('./');
  await openHistoryEntry(page, 'stats');
  await expect(page.getByTestId('exercise-rank-level')).toHaveText('МС по очкам');
  const rankTable = page.getByRole('table', { name: 'Пороги нормативов за 60 стрел' });
  await expect(rankTable.getByRole('button', { name: 'МС', exact: true }).locator('..')).toHaveAttribute('data-rank-state', 'reached');
  await expect(rankTable.getByRole('button', { name: 'МСМК', exact: true }).locator('..')).toHaveAttribute('data-rank-state', 'next');
  await expect(page.getByTestId('exercise-rank-next')).toHaveText('До МСМК · 13 очков');
  expect(await rankTable.evaluate(table => table.clientWidth <= table.parentElement!.clientWidth)).toBe(true);
  await rankTable.getByRole('button', { name: 'КМС', exact: true }).click();
  await expect(page.getByTestId('exercise-rank-next')).toHaveText('КМС · на 38 очков выше порога');
  await rankTable.getByRole('button', { name: 'КМС', exact: true }).click();
  await page.getByTestId('report-exercise-rank').screenshot({ path: '../artifacts/web-0.13.0-exercise-rank.png' });
  await page.getByTestId('exercise-rank-open').click();
  await expect(page.getByTestId('rank-details').getByRole('table')).toBeVisible();
  await expect(page.getByTestId('rank-details').locator('.rank-scale')).toHaveCount(0);
  await expect(page.getByTestId('rank-progress')).toContainText('540 очков · 60 из 60 стрел');
  await page.getByTestId('rank-open-reference').click();
  await expect(page.getByTestId('rank-reference')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await openHistoryEntry(page, 'partial');
  await expect(page.getByTestId('exercise-rank-level')).toHaveText('Темп МС');
  await expect(page.getByTestId('exercise-rank-progress')).toHaveText('57 из 60 стрел');
  await expect(page.getByTestId('exercise-rank-next')).toHaveText('МСМК · порог уже недостижим');
  await rankTable.getByRole('button', { name: 'МС', exact: true }).click();
  await expect(page.getByTestId('exercise-rank-next')).toHaveText('До МС · на оставшихся нужен средний 8,33');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-statistics').click();
  for (const section of STATISTIC_SECTIONS) for (const [key] of section.items) {
    await page.getByTestId(`statistic-${key}`).click();
  }
  await page.reload();
  await expect(page.getByTestId('home-all-time-totals')).toHaveCount(0);
  await expect(page.getByTestId('home-week')).toHaveCount(0);
  await openHistoryEntry(page, 'stats');
  for (const id of ['report-exercise-rank', 'report-round-1', 'training-mean-trend', 'report-result', 'cg3-card',
    'training-hit-map', 'report-zone-distribution']) await expect(page.getByTestId(id)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('app.fableshot.practice-diary.v1'))).toBe(diary);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-statistics').click();
  await expect(page.getByTestId('statistic-norms')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('statistics-enable-all').click();
  await page.reload();
  await openHistoryEntry(page, 'stats');
  await expect(page.getByTestId('report-exercise-rank')).toBeVisible();
  await expect(page.getByTestId('report-result-average')).toHaveText('9,0');
});

test('individual switches hide readings without preventing target input or changing CG3', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('home-start-training').click();
  for (let i = 0; i < 3; i++) await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  const total = await page.getByTestId('cg3-total').innerText();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  // Only display preferences change; the same active diary is reopened after reload.
  await page.evaluate(() => {
    const key = 'app.fableshot.training-preferences.v1';
    const current = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ version: 1, preferences: { ...current.preferences,
      hideScores: false, averageHundredths: false, animations: true, haptics: false, keepAwake: true,
      disabledStatistics: ['result', 'volume', 'grouping', 'offset', 'stability', 'norms', 'distribution'],
    } }));
  });
  await page.reload();
  await page.getByTestId('home-start-training').click();
  await expect(page.getByTestId('series-score')).toHaveCount(0);
  await expect(page.locator('.tile-average').first()).toContainText('10,0');
  await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await expect(page.getByTestId('report-result-average')).toHaveText('10,0');
  await expect(page.getByTestId('report-result-grouping')).toHaveCount(0);
  await expect(page.getByTestId('hit-map-score')).toHaveCount(0);
  await expect(page.getByTestId('hit-map-coverage')).toHaveCount(0);
  await expect(page.getByTestId('hit-map-shift')).toHaveCount(0);
  await expect(page.getByTestId('report-zone-10')).toHaveCount(0);
  await expect(page.getByTestId('report-ten-share')).toHaveText('100,0%');
  await expect(page.getByTestId('cg3-total')).toHaveText(total);
  await expect(page.getByText('Бонус за кучность', { exact: true })).toHaveCount(0);
});
