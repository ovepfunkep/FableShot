import { openTraining, openHistoryEntry } from './journal-navigation.ts';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function targetBounds(page: Page) {
  const bounds = await page.getByTestId('target').boundingBox();
  if (!bounds) throw new Error('Target was not laid out');
  return bounds;
}

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

test('lens follows aim and the target stays inside the screen layout', async ({ page }) => {
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
  expect(lensBounds!.y + lensBounds!.height).toBeLessThan(y);
  await page.mouse.move(x + radius * .17, y);
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

test('previous series edits are saved when selecting another shot, and deletion shrinks its maximum', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  const target = await targetBounds(page);
  const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const radius = Math.min(target.width, target.height) * .44;
  await page.touchscreen.tap(center.x, center.y);
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await page.getByTestId('next-end').click();
  await expect(page.getByTestId('round-score')).toHaveText('10/20');
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  await page.getByTestId('training-series-open').click();
  await expect(page.getByTestId('training-series-result-1')).toContainText('10/20');
  await page.getByTestId('training-select-series-1').click();
  await expect(page.getByTestId('next-end')).toHaveText('К текущей серии');
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
});

test('a full 30-arrow round keeps the next action pinned and requires an explicit transition', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  const miss = page.getByRole('button', { name: 'Отметить промах' });
  for (let i = 0; i < 30; i++) await miss.click();
  await expect(miss).toBeDisabled();
  await expect(page.getByTestId('round-score')).toHaveText('0/300');
  const next = page.getByTestId('next-end');
  await expect(next).toHaveText('Следующий раунд');
  await expect(next).toBeInViewport({ ratio: 1 });
  const target = await targetBounds(page);
  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
  await expect.poll(() => next.evaluate(button => button.getAnimations().length)).toBe(1);
  await expect(page.getByTestId('round-score')).toHaveText('0/300');
  await next.click();
  await expect(page.getByTestId('training-rounds-open')).toContainText('Раунд 2');
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
