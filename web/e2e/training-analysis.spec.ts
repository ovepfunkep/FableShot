import { expect, test } from '@playwright/test';
import { openHistoryEntry, openTraining } from './journal-navigation.ts';
import { advanceSeries, appendShot, applyConditions, completePractice, emptyPractice } from '../src/practice.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';

test('switching completed trainings keeps the same statistics block in view', async ({ page }) => {
  let practice = emptyPractice();
  for (const points of [10, 9, 9]) practice = appendShot(practice, { code: String(points), points, point: null, imported: true });
  const older = completePractice(practice, '2026-11-10T10:15:00Z');
  for (let index = 0; index < 4; index++) {
    practice = advanceSeries(practice);
    for (const points of [10, 9, 9]) practice = appendShot(practice, { code: String(points), points, point: null, imported: true });
  }
  const newer = completePractice(practice, '2026-11-12T10:15:00Z');
  await page.addInitScript(entries => localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries })), [
    { id: 'older', startedAt: '2026-11-10T10:00:00Z', title: 'Предыдущий результат', practice: older },
    { id: 'newer', startedAt: '2026-11-12T10:00:00Z', title: 'Новый результат', practice: newer },
  ]);
  await page.goto('./');
  await openHistoryEntry(page, 'newer');
  const date = page.locator('header').getByTestId('report-training-start');
  await expect(date).toHaveAttribute('datetime', '2026-11-12T10:00:00.000Z');
  const norms = page.locator('[data-report-block="norms"]');
  await norms.evaluate(element => {
    const body = element.closest('.report-body')!;
    body.scrollTop += element.getBoundingClientRect().top - body.getBoundingClientRect().top;
  });
  await expect(date).toBeInViewport();
  await page.getByRole('button', { name: 'Предыдущая', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Предыдущий результат' })).toBeAttached();
  await expect(date).toHaveAttribute('datetime', '2026-11-10T10:00:00.000Z');
  await expect(date).toBeInViewport();
  await expect.poll(() => norms.evaluate(element => {
    const body = element.closest('.report-body')!;
    const top = element.getBoundingClientRect().top - body.getBoundingClientRect().top;
    const maxScroll = body.scrollHeight - body.clientHeight;
    return top >= -2 && top < body.clientHeight && (top < 24 || maxScroll - body.scrollTop <= 2);
  })).toBe(true);
  await page.getByRole('button', { name: 'Следующая', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новый результат' })).toBeAttached();
  await expect(date).toHaveAttribute('datetime', '2026-11-12T10:00:00.000Z');
});

test('the accessible pie and its selected zone survive reopening the same report', async ({ page }) => {
  let practice = emptyPractice();
  for (const points of [10, 9, 9]) practice = appendShot(practice, { code: String(points), points, point: { x: points === 10 ? 0 : .15, y: 0 } });
  practice = completePractice(practice, '2026-11-12T12:05:00Z');
  await page.addInitScript(practice => {
    if (!localStorage.getItem('app.fableshot.practice-diary.v1')) localStorage.setItem('app.fableshot.practice-diary.v1',
      JSON.stringify({ version: 1, entries: [{ id: 'pie-review', startedAt: '2026-11-12T12:00:00Z', practice }] }));
  }, practice);
  await page.goto('./');
  const open = async () => {
    await page.getByTestId('nav-history').click();
    await page.getByTestId('session-pie-review').click();
  };
  await open();
  const distribution = page.getByTestId('report-zone-distribution');
  await distribution.getByRole('button', { name: 'Круговая' }).click();
  const pie = distribution.getByTestId('shot-distribution-pie');
  const zone = pie.getByRole('button', { name: 'Оценка 9, стрел: 2' });
  await zone.focus();
  await page.keyboard.press('Enter');
  await expect(zone).toHaveAttribute('aria-pressed', 'true');
  await expect(distribution.locator('.shot-zone-keys')).toHaveCount(0);
  await page.reload();
  await open();
  await expect(zone).toHaveAttribute('aria-pressed', 'true');
});

test('traffic-light map filters individual faces and keeps map and score consistent', async ({ page }) => {
  const practice = emptyPractice();
  practice.rounds[0].series[0].conditions = { ...DEFAULT_CONDITIONS, targetProfileId: 'wa-indoor-triple-outer-v1' };
  practice.rounds[0].series[0].shots = [
    { code: '10', points: 10, point: { x: 0, y: 0 }, spot: 0 },
    { code: '9', points: 9, point: { x: .15, y: 0 }, spot: 1 },
    { code: '8', points: 8, point: { x: .25, y: 0 }, spot: 2 },
    { code: 'M', points: 0, point: null, missPoint: { x: .6, y: 0 }, spot: 2 },
  ];
  await page.addInitScript(data => localStorage.setItem('app.fableshot.practice-pilot.v3', JSON.stringify(data)), practice);
  await page.goto('./');
  await openTraining(page);
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  const map = page.getByTestId('training-hit-map');
  await expect(map.getByTestId('hit-map-hit')).toHaveCount(3);
  await map.getByTestId('hit-map-spot-0').click();
  await expect(map.getByTestId('hit-map-hit')).toHaveCount(1);
  await expect(map.getByTestId('hit-map-score')).toHaveText('10/10');
  await map.getByTestId('hit-map-spot-2').click();
  await expect(map.getByTestId('hit-map-miss')).toHaveCount(1);
  await expect(map.getByTestId('hit-map-score')).toHaveText('8/20');
  await map.getByTestId('hit-map-spot-all').click();
  await expect(map.getByTestId('hit-map-hit')).toHaveCount(3);
  const zoom = await map.getByRole('group', { name: 'Приближение мишени' }).boundingBox();
  const plot = await map.getByTestId('hit-map-plot').boundingBox();
  expect(zoom!.y).toBeGreaterThanOrEqual(plot!.y + plot!.height);
  await map.screenshot({ path: '../artifacts/ivan-hit-map-redesign.png' });
});

test('the report graphs all entered series while CG3 uses confirmed series only', async ({ page }) => {
  let practice = emptyPractice();
  for (let i = 0; i < 3; i++) practice = appendShot(practice, { code: '10', points: 10, point: { x: 0, y: 0 } });
  practice = advanceSeries(practice);
  practice = appendShot(practice, { code: 'M', points: 0, point: null });
  await page.addInitScript(data => localStorage.setItem('app.fableshot.practice-pilot.v3', JSON.stringify(data)), advanceSeries(practice));
  await page.goto('./');
  await openTraining(page);
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await expect(page.getByTestId('report-round-1').locator('.report-series-summary .report-series-cumulative')).toHaveText(['30', '30']);
  const rows = page.getByTestId('report-round-1').locator('.report-series-summary');
  for (const column of ['score', 'average', 'cumulative']) {
    const edges = await rows.locator(`.report-series-${column}`).evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().right));
    expect(edges[0]).toEqual(edges[1]);
  }
  const trend = page.getByTestId('training-mean-trend');
  await expect(trend.getByTestId('training-mean-value')).toHaveText('0,0 / 10');
  await expect(trend.getByText('Раунд 1 · серия 2', { exact: true })).toBeVisible();
  await trend.getByTestId('training-mean-chart').press('ArrowLeft');
  await expect(trend.getByTestId('training-mean-value')).toHaveText('10,0 / 10');
  await trend.getByTestId('training-mean-chart').click({ position: { x: 1, y: 70 } });
  await expect(trend.getByTestId('training-mean-value')).toHaveText('10,0 / 10');
  await trend.getByTestId('training-mean-chart').press('ArrowRight');
  await expect(trend.getByTestId('training-mean-value')).toHaveText('0,0 / 10');
  const box = (await trend.getByTestId('training-mean-chart').boundingBox())!;
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 8, box.y + box.height / 2, { steps: 4 });
  await expect(trend.getByTestId('training-mean-value')).toHaveText('10,0 / 10');
  await page.mouse.up();
  await expect(page.getByTestId('cg3-total')).toHaveText(/^105[.,]00$/);
  await expect(page.getByTestId('cg3-formula')).toBeHidden();
  await page.getByTestId('cg3-help').click();
  await page.getByTestId('cg3-explain').click();
  await expect(page.getByTestId('cg3-formula')).toBeVisible();
});

test('series averages use a compact vertical range, including identical results', async ({ page }) => {
  let practice = appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } });
  await page.addInitScript(data => {
    if (!localStorage.getItem('app.fableshot.practice-pilot.v3')) localStorage.setItem('app.fableshot.practice-pilot.v3', JSON.stringify(data));
  }, practice);
  await page.goto('./');
  await openTraining(page);
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  const trend = page.getByTestId('training-mean-trend');
  await expect(trend.locator('.training-mean-axis span').first()).toHaveText('10,0');
  await expect(trend.locator('.training-mean-axis span').last()).toHaveText('9,5');
  await trend.getByRole('button', { name: 'Показатель по сериям' }).click();
  await page.getByRole('dialog', { name: 'Показатель по сериям' }).getByRole('button', { name: 'Доля десяток' }).click();
  await expect(trend.getByTestId('training-mean-value')).toHaveText('100,0 %');
  await trend.getByRole('button', { name: 'Показатель по сериям' }).click();
  await page.getByRole('dialog', { name: 'Показатель по сериям' }).getByRole('button', { name: 'Средний балл' }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('next-end').click();
  await expect(page.getByRole('button', { name: /Серия 2 · разряд/ })).toBeVisible();
  await page.getByRole('button', { name: 'Отметить промах', exact: true }).click();
  await expect(page.getByTestId('series-score')).toHaveText('0/10');
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await expect(trend.locator('.training-mean-axis span')).toHaveText(['10,0', '5,0', '0,0']);
});

test('map and zone distribution share conditions while the map can isolate one series', async ({ page, browserName }) => {
  let practice = emptyPractice();
  for (const x of [.02, .04, .06]) practice = appendShot(practice, { code: 'X', points: 10, point: { x, y: 0 } });
  practice = advanceSeries(practice);
  practice = appendShot(practice, { code: '9', points: 9, point: { x: .16, y: 0 } });
  practice = appendShot(practice, { code: 'M', points: 0, point: null });
  practice = applyConditions(practice, { ...DEFAULT_CONDITIONS, distanceMeters: 30 });
  practice = appendShot(practice, { code: '10', points: 10, point: { x: 0, y: 0 } });

  await page.setViewportSize({ width: 360, height: 640 });
  await page.addInitScript(data => localStorage.setItem('app.fableshot.practice-pilot.v3', JSON.stringify(data)), practice);
  await page.goto('./');
  await openTraining(page);
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  const map = page.getByTestId('training-hit-map');
  await expect(map.getByTestId('hit-map-mode-points')).toHaveAttribute('aria-pressed', 'true');
  await expect(map.getByTestId('hit-map-score')).toHaveText('39/50');
  await expect(page.getByTestId('report-result-score')).toHaveText(/49\s*\/\s*60/);
  await expect(map.getByRole('list', { name: 'Попадания по зонам' })).toHaveCount(0);
  await expect(page.getByTestId('report-zone-M')).toHaveAccessibleName('Промах, стрел: 1');
  await expect(page.getByTestId('report-zone-10')).toHaveAccessibleName('Оценка 10, стрел: 3');
  await expect(page.getByTestId('report-ten-share')).toHaveText('60,0%');

  await map.getByTestId('hit-map-next').click();
  await expect(map.getByTestId('hit-map-score')).toHaveText('30/30');
  await expect(map.getByTestId('hit-map-rms')).toHaveText('3,3 мм');
  await expect(map.getByTestId('hit-map-shift')).toHaveText('8,0 мм');
  await map.getByTestId('hit-map-mode-points').click();
  await expect(map.getByTestId('hit-map-mode-points')).toHaveAttribute('aria-pressed', 'true');
  const target = map.getByTestId('hit-map-plot');
  const resetZoom = map.getByRole('button', { name: 'Сбросить приближение' });
  await expect(target).toHaveCSS('touch-action', 'pan-y');
  await map.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect(resetZoom).toHaveText('1,5×');
  await expect(target).toHaveCSS('touch-action', 'none');
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const centered = await target.getAttribute('viewBox');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 4 });
  await page.mouse.up();
  await expect(target).not.toHaveAttribute('viewBox', centered!);
  await map.getByTestId('hit-map-series').click();
  await page.getByRole('button', { name: 'Все серии', exact: true }).click();
  await expect(map.getByTestId('hit-map-score')).toHaveText('39/50');
  await expect(map.getByTestId('hit-map-mode-points')).toHaveAttribute('aria-pressed', 'true');
  await expect(resetZoom).toHaveText('1,5×');
  await resetZoom.click();
  await expect(target).toHaveAttribute('viewBox', '0 0 260 260');
  await expect(target).toHaveCSS('touch-action', 'pan-y');

  if (browserName === 'chromium') {
    await target.scrollIntoViewIfNeeded();
    const pinchBox = (await target.boundingBox())!;
    const middleX = pinchBox.x + pinchBox.width / 2, middleY = pinchBox.y + pinchBox.height / 2;
    const touchPoints = (offset: number) => [{ x: middleX - offset, y: middleY, id: 1 }, { x: middleX + offset, y: middleY, id: 2 }];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints(20) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoints(40) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect(resetZoom).toHaveText('2,0×');
  }

  await map.getByTestId('hit-map-mode-density').click();
  await expect(map.getByTestId('hit-map-mode-density')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('report-metrics-scope').click();
  await page.getByRole('dialog', { name: 'Условия расчёта' }).locator('.choice-picker-options button').nth(1).click();
  await expect(map.getByTestId('hit-map-mode-density')).toHaveAttribute('aria-pressed', 'true');
  await expect(map.getByTestId('hit-map-score')).toHaveText('10/10');
  await expect(page.getByTestId('report-result-score')).toHaveText(/49\s*\/\s*60/);
  await expect(page.getByTestId('report-result-average')).toHaveText('8,2');
  await expect(page.getByTestId('report-result-volume')).toHaveText('6');
  await expect(page.getByTestId('report-result-grouping')).toHaveCount(0);
  await expect(page.getByTestId('report-zone-M')).toHaveCount(0);
  await expect(page.getByTestId('cg3-card')).toHaveCount(0);
});
