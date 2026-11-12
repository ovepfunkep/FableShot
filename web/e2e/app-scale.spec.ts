import { expect, test } from '@playwright/test';
import { openTraining } from './journal-navigation.ts';

test('Android restores the app scale switch and keeps the target and viewport usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => {
    Object.assign(window, {
      androidBridge: {},
      Capacitor: {
        PluginHeaders: [{ name: 'AppScale', methods: [
          { name: 'apply', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' },
        ] }],
        nativePromise: async (_plugin: string, method: string, options: { followSystem?: boolean }) =>
          method === 'apply' ? { layoutZoom: options.followSystem ? 1 : .8 } : undefined,
        nativeCallback: () => 'scale-listener',
      },
    });
  });
  await page.goto('./');
  const scale = () => page.locator('html').evaluate(root => getComputedStyle(root).zoom);
  await expect.poll(scale).toBe('0.8');
  const home = page.getByTestId('nav-home');
  expect((await home.boundingBox())!.y + (await home.boundingBox())!.height).toBeGreaterThan(650);

  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-appearance').click();
  const option = page.getByTestId('setting-system-scale');
  await expect(option).toHaveAttribute('aria-checked', 'false');
  await option.click();
  await expect.poll(scale).toBe('1');
  await page.reload();
  await expect.poll(scale).toBe('1');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-appearance').click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await option.click();
  await expect.poll(scale).toBe('0.8');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();

  await openTraining(page);
  const target = (await page.getByTestId('target').boundingBox())!;
  const x = target.x + target.width / 2;
  await page.mouse.move(x, target.y + target.height / 2);
  await page.mouse.down();
  const lens = page.getByTestId('lens');
  await expect(lens).toBeVisible();
  const bounds = (await lens.boundingBox())!;
  expect(Math.abs(bounds.x + bounds.width / 2 - x)).toBeLessThan(4);
  await page.mouse.up();
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  await expect(page.getByRole('button', { name: 'Следующая серия', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
  await expect(page.getByTestId('training-confirm')).toBeInViewport();
});

test('PWA keeps the browser scale and omits the Android-only switch', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-appearance').click();
  await expect(page.getByTestId('setting-system-scale')).toHaveCount(0);
  expect(await page.locator('html').evaluate(root => getComputedStyle(root).zoom)).toBe('1');
});
