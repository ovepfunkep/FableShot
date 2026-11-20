import { openTraining, openHistoryEntry } from './journal-navigation.ts';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function targetBounds(page: Page) {
  const bounds = await page.getByTestId('target').boundingBox();
  if (!bounds) throw new Error('Target was not laid out');
  return bounds;
}

async function lensPixel(page: Page, x: number, y: number) {
  return page.getByTestId('lens').locator('canvas').evaluate((canvas: HTMLCanvasElement, point) => {
    const pixel = canvas.getContext('2d')!.getImageData(
      Math.round(canvas.width / 2 + point.x * canvas.width / canvas.clientWidth),
      Math.round(canvas.height / 2 + point.y * canvas.height / canvas.clientHeight), 1, 1,
    ).data;
    return Array.from(pixel.slice(0, 3));
  }, { x, y });
}

async function cancelAim(page: Page) {
  await page.getByTestId('target').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await expect(page.getByTestId('lens')).toHaveCount(0);
}

test('the shot strip stays the same height through 3, 6 and 12 slots and pages to the newest shot', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  const panel = page.getByTestId('arrow-panel');
  const strip = (await panel.boundingBox())!;
  const height = strip.height;
  expect(strip.y + height).toBeLessThanOrEqual((await targetBounds(page)).y);
  const miss = page.getByRole('button', { name: 'Отметить промах' });
  await expect(panel.locator('.arrow-page-3')).toHaveCount(1);
  for (let count = 1; count <= 13; count++) {
    await miss.click();
    if (count === 3) await expect(panel.locator('.arrow-page-3')).toHaveCount(1);
    if (count === 4) await expect(panel.locator('.arrow-page-6')).toHaveCount(1);
    if (count === 7) await expect(panel.locator('.arrow-page-12')).toHaveCount(1);
    expect((await panel.boundingBox())!.height).toBe(height);
  }
  await expect(panel.locator('.arrow-page-12')).toHaveCount(2);
  await expect(page.getByTestId('shot-13')).toBeInViewport();
  await page.getByTestId('next-end').click();
  await expect(panel.locator('.arrow-page-12')).toHaveCount(1);
  expect((await panel.boundingBox())!.height).toBe(height);
});

test('saved series opens without network under the project path', async ({ page, context }) => {
  await page.goto('./');
  await openTraining(page);
  await expect(page.getByTestId('offline-status')).toHaveText('Готово офлайн');
  const target = await targetBounds(page);
  const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const radius = Math.min(target.width, target.height) * .44;
  await page.touchscreen.tap(center.x, center.y);
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await page.touchscreen.tap(center.x + radius * .24, center.y);
  await expect(page.getByTestId('series-score')).toHaveText('18/30');
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await expect(page.getByTestId('report-round-total-1')).toHaveText('Раунд 1 · 18/30 · 6,0');

  await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('./');
  await openHistoryEntry(reopened);
  await expect(reopened.getByTestId('journal-report')).toBeVisible();
  await expect(reopened.getByTestId('report-round-total-1')).toHaveText('Раунд 1 · 18/30 · 6,0');
  await expect(reopened.getByTestId('report-round-1').getByText('M', { exact: true })).toBeVisible();
});

test('the miss ring saves direction, stays out of grouping, and can be replaced in the series editor', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  const target = await targetBounds(page);
  const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const radius = Math.min(target.width, target.height) * .44;
  await page.touchscreen.tap(center.x + radius * 1.06, center.y);
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await page.touchscreen.tap(center.x, center.y);
  await expect(page.getByTestId('series-score')).toHaveText('10/30');
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await expect(page.getByTestId('hit-map-miss')).toHaveCount(1);
  await expect(page.getByTestId('hit-map-coverage')).toContainText('2 из 3');
  await expect(page.getByTestId('report-result-grouping')).toHaveText('—');

  await page.locator('[data-testid^="report-end-"]').first().click();
  await page.getByTestId('shot-1').click();
  await page.getByTestId('target').click();
  await page.getByTestId('next-end').click();
  await expect(page.getByTestId('shot-1')).toHaveAttribute('aria-label', /10/);
  await page.getByTestId('shot-1').click();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await expect(page.getByTestId('hit-map-miss')).toHaveCount(0);
  await expect(page.getByTestId('report-round-total-1')).toContainText('20/30');
});

test('the larger lens fits a narrow screen and follows slower aim', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 570 });
  await page.goto('./');
  await openTraining(page);
  const bounds = await targetBounds(page);
  await page.mouse.click(bounds.x + 4, bounds.y + 4);
  await expect(page.getByTestId('series-score')).toHaveText('0/0');

  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const radius = Math.min(bounds.width, bounds.height) * .44;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const lens = page.getByTestId('lens');
  await expect(lens).toContainText('10');
  await expect(lens.locator('strong')).toHaveCSS('background-color', 'rgb(244, 206, 68)');
  const lensBounds = await lens.boundingBox();
  const field = (await lens.locator('canvas').boundingBox())!;
  const scoreBadge = (await lens.locator('.lens-score').boundingBox())!;
  expect(scoreBadge.width).toBeLessThan(40);
  expect(scoreBadge.x - (field.x + field.width / 2)).toBeLessThan(30);
  expect(scoreBadge.y + scoreBadge.height / 2).toBeCloseTo(field.y + field.height / 2, 0);
  expect(field.width).toBeCloseTo(302, 0);
  expect(lensBounds!.x + lensBounds!.width).toBeLessThanOrEqual(320);
  expect(lensBounds!.y + lensBounds!.height).toBeLessThanOrEqual(570);
  await page.mouse.move(x + radius * .13 / 3, y);
  await expect(lens.locator('strong')).toHaveText('10');
  await page.mouse.move(x + radius * .17 / 1.92, y);
  await expect(lens).toContainText('9');
  await expect(lens.locator('.lens-score')).toHaveCSS('background-color', 'rgb(244, 206, 68)');
  expect((await lens.boundingBox())?.width).toBe(lensBounds!.width);
  await page.mouse.up();
  await expect(lens).toHaveCount(0);
  await expect(page.getByTestId('series-score')).toHaveText('9/10');
  await page.getByRole('button', { name: 'Увеличить' }).click();
  expect(await targetBounds(page)).toEqual(bounds);
  await expect(page.getByTestId('next-end')).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
});

test('the lens keeps its scale after zooming and shows only current series hits', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  const bounds = await targetBounds(page);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.click(x - 12, y);
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await page.mouse.click(x + 12, y);
  await expect(page.getByTestId('series-score')).toHaveText('20/30');

  await page.mouse.move(x, y);
  await page.mouse.down();
  const marker = [20, 32, 13];
  const field = (await page.getByTestId('lens').locator('canvas').boundingBox())!;
  expect(field.width).toBe(352);
  expect(field.height).toBe(316);
  expect(await lensPixel(page, -30, 6)).toEqual(marker);
  expect(await lensPixel(page, 30, 6)).toEqual(marker);
  await cancelAim(page);

  await page.getByRole('button', { name: 'Увеличить' }).click();
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await expect(page.getByRole('button', { name: 'Сбросить приближение' })).toHaveText('2,3×');
  await page.mouse.move(x, y);
  await page.mouse.down();
  expect(await lensPixel(page, -30, 6)).toEqual(marker);
  expect(await lensPixel(page, 30, 6)).toEqual(marker);
  await cancelAim(page);

  await page.getByTestId('next-end').click();
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  await page.mouse.move(x, y);
  await page.mouse.down();
  expect(await lensPixel(page, -30, 6)).not.toEqual(marker);
  expect(await lensPixel(page, 30, 6)).not.toEqual(marker);
  await cancelAim(page);
});

test('the lens keeps hits on their own spot of a traffic-light target', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('home-change-conditions').click();
  await page.getByTestId('target-profile-choice').click();
  await page.getByTestId('target-profile-wa-indoor-triple-outer-v1').click();
  await page.getByTestId('start-training').click();
  const bounds = await targetBounds(page);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const radius = Math.min(bounds.width / 1.32, bounds.height / 3.8);
  const top = y - radius * 1.2;
  await page.mouse.click(x - 12, top);
  await expect(page.getByTestId('series-score')).toHaveText(/\/10$/);

  const marker = [20, 32, 13];
  await page.mouse.move(x, y);
  await page.mouse.down();
  expect(await lensPixel(page, -30, 6)).not.toEqual(marker);
  await cancelAim(page);

  await page.mouse.move(x, top);
  await page.mouse.down();
  expect(await lensPixel(page, -30, 6)).toEqual(marker);
  await cancelAim(page);
});

test('one hold reaches off-screen spots at 8× in training and in the series editor', async ({ page, context }) => {
  await page.addInitScript(() => {
    for (const scope of ['training', 'editor']) localStorage.setItem(`app.fableshot.target-zoom.${scope}.v1`, '8');
  });
  await page.goto('./');
  await page.getByTestId('home-change-conditions').click();
  await page.getByTestId('target-profile-choice').click();
  await page.getByTestId('target-profile-wa-indoor-triple-outer-v1').click();
  await page.getByTestId('start-training').click();
  const client = await context.newCDPSession(page);
  const lens = page.getByTestId('lens').locator('strong');
  const score = page.getByTestId('series-score');
  const zoom = page.getByRole('button', { name: 'Сбросить приближение' });

  async function aimAtSpot(direction: number, ringFraction: number, expected: string) {
    await expect(zoom).toHaveText('8,0×');
    const bounds = await targetBounds(page);
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const radius = Math.min(bounds.width / 1.32, bounds.height / 3.8);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await expect(lens).toHaveText('10');
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x + radius * .25 / 1.92, y: y + direction * radius * .6 / 1.92 }],
    });
    await expect(lens).toHaveText('—');
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: y + direction * radius * (1.2 + ringFraction) / 1.92 }],
    });
    await expect(lens).toHaveText(expected);
  }

  await aimAtSpot(-1, .46, '6');
  await expect(score).toHaveText('0/0');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(score).toHaveText('6/10');
  await expect(lens).toHaveCount(0);
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await page.getByTestId('hit-map-mode-points').click();
  const hit = page.getByTestId('hit-map-plot').locator(':scope > circle[fill="#111811"]');
  const topY = Number(await hit.getAttribute('cy'));

  await page.locator('[data-testid^="report-end-"]').first().click();
  await page.getByTestId('shot-1').click();
  await aimAtSpot(1, .36, '7');
  await expect(page.getByTestId('next-end')).toBeDisabled();
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('shot-1')).toHaveAttribute('aria-label', 'Стрела 1: 7');
  await page.getByTestId('next-end').click();
  await page.getByTestId('shot-1').click();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await expect(page.getByTestId('report-round-total-1')).toContainText('7/10');
  await page.getByTestId('hit-map-mode-points').click();
  await expect.poll(async () => Number(await hit.getAttribute('cy'))).toBeGreaterThan(topY);
});

test('training and series editor remember independent zoom levels across openings', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  const zoom = page.getByRole('button', { name: 'Сбросить приближение' });
  const increase = page.getByRole('button', { name: 'Увеличить' });
  await increase.click();
  await expect(zoom).toHaveText('1,5×');
  await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await expect(page.locator('.confirm-actions')).toHaveCSS('flex-direction', 'column');
  await page.getByTestId('training-confirm').click();
  const series = page.locator('[data-testid^="report-end-"]').first();
  await series.click();
  await expect(zoom).toHaveText('1,0×');
  await increase.click();
  await increase.click();
  await expect(zoom).toHaveText('2,3×');
  await page.getByRole('button', { name: 'Закрыть редактор' }).click();
  await series.click();
  await expect(zoom).toHaveText('2,3×');
  await page.getByRole('button', { name: 'Закрыть редактор' }).click();
  await page.reload();
  await openTraining(page);
  await expect(zoom).toHaveText('1,5×');
});

test('the zoom panel can be moved outside the target and remembers its position', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  const panel = page.getByRole('group', { name: 'Приближение мишени' });
  const handle = panel.getByRole('button', { name: 'Переместить панель масштаба' });
  const zoom = panel.getByRole('button', { name: 'Сбросить приближение' });
  const viewport = page.viewportSize()!;
  const start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(40, viewport.height - 36, { steps: 8 });
  await page.mouse.up();
  await expect(zoom).toHaveText('1,0×');
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  const target = await targetBounds(page);
  const moved = (await panel.boundingBox())!;
  expect(moved.y).toBeGreaterThan(target.y + target.height);
  expect(moved.x).toBeCloseTo(40 - start.width / 2, 0);

  await handle.press('ArrowRight');
  const saved = (await panel.boundingBox())!;
  expect(saved.x).toBeCloseTo(moved.x + 16, 0);
  await panel.getByRole('button', { name: 'Увеличить' }).click();
  await expect(zoom).toHaveText('1,5×');
  await panel.getByRole('button', { name: 'Уменьшить' }).click();
  await expect(zoom).toHaveText('1,0×');
  await panel.getByRole('button', { name: 'Увеличить' }).click();
  await zoom.click();
  await expect(zoom).toHaveText('1,0×');

  await page.reload();
  await openTraining(page);
  await expect(panel).toBeVisible();
  expect(await panel.boundingBox()).toEqual(saved);
  await page.setViewportSize({ width: 720, height: 390 });
  await expect(panel).toBeInViewport({ ratio: 1 });
  await page.setViewportSize(viewport);
  expect(await panel.boundingBox()).toEqual(saved);

  await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await page.locator('[data-testid^="report-end-"]').first().click();
  expect(await panel.boundingBox()).toEqual(saved);
});

test('touch can move the zoom panel at the Android layout scale and cancel another drag', async ({ page, context }) => {
  await page.goto('./');
  await page.locator('html').evaluate(root => root.style.setProperty('--app-scale', '.8'));
  await openTraining(page);
  const panel = page.getByRole('group', { name: 'Приближение мишени' });
  const handle = panel.getByRole('button', { name: 'Переместить панель масштаба' });
  const client = await context.newCDPSession(page);
  const holdHandle = async () => {
    const box = (await handle.boundingBox())!;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
  };
  await holdHandle();
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 36, y: 32 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const moved = (await handle.boundingBox())!;
  expect(moved.x + moved.width / 2).toBeCloseTo(36, 0);
  expect(moved.y + moved.height / 2).toBeCloseTo(32, 0);
  await expect(panel).toBeInViewport({ ratio: 1 });

  await holdHandle();
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 230, y: 410 }] });
  expect((await handle.boundingBox())!.y).toBeGreaterThan(moved.y + 300);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await handle.boundingBox()).toEqual(moved);
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
});

test('previous series edits are saved when selecting another shot, and deletion shrinks its maximum', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 570 });
  await page.goto('./');
  await openTraining(page);
  const target = await targetBounds(page);
  const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const radius = Math.min(target.width, target.height) * .44;
  const previous = page.getByRole('button', { name: 'Предыдущая серия', exact: true });
  const next = page.getByTestId('next-end');
  await expect(previous).toBeDisabled();
  await page.touchscreen.tap(center.x, center.y);
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await next.click();
  await expect(page.getByTestId('round-score')).toHaveText('10/20');
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  await page.getByTestId('training-series-open').click();
  await expect(page.getByTestId('training-series-result-1')).toContainText('10/20');
  await expect(page.getByTestId('training-select-series-1').locator('.report-hit')).toHaveText(['10', 'M']);
  await expect(page.getByTestId('training-select-series-2')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('stage-picker')).toBeHidden();
  await expect(previous).toBeInViewport({ ratio: 1 });
  await expect(next).toBeInViewport({ ratio: 1 });
  const back = (await previous.boundingBox())!;
  const forward = (await next.boundingBox())!;
  expect(back.y).toBeGreaterThan(target.y + target.height);
  expect(back.x + back.width).toBeLessThan(forward.x);
  expect(back.y + back.height / 2).toBeCloseTo(forward.y + forward.height / 2, 0);
  await previous.click();
  await expect(next).toHaveText('Следующая серия');
  await expect(page.getByRole('button', { name: 'Вперёд по сериям' })).toHaveCount(0);
  await next.click();
  await expect(next).toHaveText('Следующая серия');
  await previous.click();
  await page.getByTestId('shot-1').click();
  await expect(page.getByTestId('shot-1')).toHaveAttribute('aria-pressed', 'true');
  await page.touchscreen.tap(center.x + radius * .24, center.y);
  await page.getByTestId('shot-2').click();
  await expect(page.getByTestId('series-score')).toHaveText('8/20');
  await page.getByRole('button', { name: 'Удалить попадание' }).click();
  await page.getByTestId('training-confirm').click();
  await expect(page.getByTestId('series-score')).toHaveText('8/10');
  await page.reload();
  await openTraining(page);
  await expect(page.getByTestId('round-score')).toHaveText('8/10');
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  await page.getByTestId('training-series-open').click();
  await page.getByTestId('remove-series-1').click();
  await expect(page.getByRole('dialog', { name: 'Удалить серию?' })).toBeVisible();
  await page.getByTestId('confirm-remove-series').click();
  await expect(page.getByTestId('round-score')).toHaveText('0/0');
});

test('next series advances one step through earlier series and into a new round', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  const miss = page.getByRole('button', { name: 'Отметить промах' });
  const next = page.getByTestId('next-end');
  const previous = page.getByRole('button', { name: 'Предыдущая серия', exact: true });
  const series = page.getByTestId('training-series-open');
  for (let i = 1; i <= 30; i++) {
    await miss.click();
    if (i === 1 || i === 2) await next.click();
  }
  await expect(series).toContainText('Серия 3');
  await previous.click();
  await previous.click();
  await expect(series).toContainText('Серия 1');
  await expect(next).toHaveText('Следующая серия');
  await next.click();
  await expect(series).toContainText('Серия 2');
  await expect(next).toHaveText('Следующая серия');
  await next.click();
  await expect(series).toContainText('Серия 3');
  await expect(miss).toBeDisabled();
  await expect(page.getByTestId('round-score')).toHaveText('0/300');
  await expect(next).toHaveText('Следующая серия');
  await expect(next).toBeInViewport({ ratio: 1 });
  const target = await targetBounds(page);
  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
  await expect.poll(() => next.evaluate(button => button.getAnimations().length)).toBe(1);
  await expect(page.getByTestId('round-score')).toHaveText('0/300');
  await next.click();
  await expect(page.getByTestId('training-rounds-open')).toContainText('Раунд 2');
  await expect(series).toContainText('Серия 1');
  await expect(page.getByTestId('round-score')).toHaveText('0/0');
});

test('a saved pilot 0.1 series remains readable and continues as a training', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'app.fableshot.practice-pilot.v1';
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({
        shots: [{ point: { x: 0, y: 0 }, points: 10, code: '10' }], savedAt: '2026-11-11T00:00:00.000Z',
      }));
    }
  });
  await page.goto('./');
  await openHistoryEntry(page, 'pilot');
  await expect(page.getByTestId('report-round-total-1')).toHaveText('Раунд 1 · 10/10 · 10,0');
  await page.getByTestId('session-resume').click();
  await page.getByTestId('session-resume-confirm').click();
  await expect(page.getByTestId('training-series-open')).toContainText('Серия 2');
  await expect(page.getByTestId('round-score')).toHaveText('10/10');
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  const source = await page.evaluate(() => localStorage.getItem('app.fableshot.practice-pilot.v1'));
  expect(JSON.parse(source!).shots).toHaveLength(1);
});

test('manual round transition drops the empty tail and keeps the earlier results', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await page.getByTestId('next-end').click();
  await expect(page.getByTestId('training-series-open')).toContainText('Серия 2');
  await page.getByTestId('training-rounds-open').click();
  await page.getByTestId('start-new-round').click();
  await page.getByTestId('confirm-new-round').click();
  await expect(page.getByTestId('training-rounds-open')).toContainText('Раунд 2');
  await page.getByTestId('training-rounds-open').click();
  await page.getByTestId('training-select-round-1').click();
  await expect(page.getByTestId('training-series-open')).toContainText('Серия 1');
  await expect(page.getByTestId('series-score')).toHaveText('0/10');
  await page.getByTestId('next-end').click();
  await expect(page.getByTestId('training-rounds-open')).toContainText('Раунд 2');
});

test('aim reacts to the first movement without waiting for the hold timer', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await page.clock.pauseAt(new Date());
  const bounds = await targetBounds(page);
  const target = page.getByTestId('target');
  const clientX = bounds.x + bounds.width / 2;
  const clientY = bounds.y + bounds.height / 2;
  await page.mouse.move(clientX, clientY);
  await page.mouse.down();
  await page.mouse.move(clientX + 2, clientY);
  await expect(page.getByTestId('lens')).toHaveCount(1);
  await target.dispatchEvent('pointercancel', { pointerId: 1, clientX, clientY });
  await page.mouse.up();
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
});

test('the second touch drags the target until release, then single taps score again', async ({ page, context }) => {
  await page.goto('./');
  await openTraining(page);
  const bounds = await targetBounds(page);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 60, y }] });
  await expect(page.getByTestId('lens')).toHaveCount(0);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  await page.touchscreen.tap(x + 60, y);
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  await client.detach();
});

test('two fingers change zoom without flashing the lens or adding a shot', async ({ page, context }) => {
  await page.goto('./');
  await openTraining(page);
  const bounds = await targetBounds(page);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const touch = (gap: number) => [{ id: 0, x: x - gap, y }, { id: 1, x: x + gap, y }];
  const client = await context.newCDPSession(page);
  await page.evaluate(() => {
    document.body.dataset.lensShown = 'false';
    const observer = new MutationObserver(records => {
      if (records.some(record => Array.from(record.addedNodes).some(node =>
        node instanceof Element && node.matches('[data-testid="lens"]')))) {
        document.body.dataset.lensShown = 'true';
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(28) });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(55) });
  await expect(page.getByRole('button', { name: 'Сбросить приближение' })).not.toHaveText('1,0×');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('body')).toHaveAttribute('data-lens-shown', 'false');
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
});
