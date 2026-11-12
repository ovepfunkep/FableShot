import { expect, test } from '@playwright/test';

test('Android rechecks when Home becomes active and opens release notes or the APK only on request', async ({ page }) => {
  const url = 'https://github.com/ovepfunkep/FableShot/releases/download/v0.27.0/FableShot-android-40.apk';
  await page.addInitScript(() => {
    Object.assign(window, {
      androidBridge: {},
      Capacitor: {
        PluginHeaders: [{ name: 'AndroidUpdates', methods: [
          { name: 'installedVersion', rtype: 'promise' }, { name: 'openDownload', rtype: 'promise' },
        ] }],
        nativePromise: async (_plugin: string, method: string, data: { url?: string }) => {
          if (method === 'installedVersion') return { production: true, code: 33 };
          sessionStorage.setItem('opened-apk', data.url ?? '');
        },
      },
    });
  });
  let checks = 0;
  await page.route('https://api.github.com/repos/ovepfunkep/FableShot/releases/latest', async route => {
    checks++;
    await route.fulfill({ json: {
      tag_name: 'v0.27.0', draft: false, prerelease: false, body: 'Новый отчёт',
      assets: [{ name: 'FableShot-android-40.apk', state: 'uploaded', browser_download_url: url }],
    } });
  });
  await page.goto('./');
  const card = page.getByTestId('android-update');
  await expect(card).toContainText('Доступно обновление!');
  await expect(page.getByText('Новый отчёт', { exact: true })).toHaveCount(0);
  expect(checks).toBe(1);
  await card.getByRole('button', { name: 'Что нового?' }).click();
  await expect(page.getByRole('dialog', { name: 'Что нового в FableShot 0.27.0' })).toContainText('Новый отчёт');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Новый отчёт', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('opened-apk'))).toBeNull();
  await page.getByRole('button', { name: 'Скачать APK' }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('opened-apk'))).toBe(url);
  await card.getByRole('button', { name: 'Позже' }).click();
  await page.getByTestId('nav-history').click();
  const activate = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await activate();
  expect(checks).toBe(1);
  await page.getByTestId('nav-home').click();
  await expect.poll(() => checks).toBe(2);
  await expect(card).toHaveCount(0);
  await activate();
  await expect.poll(() => checks).toBe(3);

  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-about').click();
  const manual = page.getByRole('button', { name: 'Проверить обновления' });
  await expect(manual).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(checks).toBe(3);
  await manual.click();
  await expect.poll(() => checks).toBe(4);
  await expect(card).toContainText('Доступно обновление!');
  await expect(page.getByText('Новый отчёт', { exact: true })).toHaveCount(0);
});
