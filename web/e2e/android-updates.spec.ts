import { expect, test } from '@playwright/test';

test('Android finds an update on launch, keeps the daily limit, and opens the APK only on request', async ({ page }) => {
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
  await expect(page.getByTestId('android-update')).toContainText('Новый отчёт');
  expect(checks).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('opened-apk'))).toBeNull();
  await page.getByRole('button', { name: 'Скачать APK' }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('opened-apk'))).toBe(url);
  await page.reload();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-about').click();
  const manual = page.getByRole('button', { name: 'Проверить обновления' });
  await expect(manual).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('android-update')).not.toContainText('Новый отчёт');
  expect(checks).toBe(1);
  await manual.click();
  await expect(page.getByTestId('android-update')).toContainText('Новый отчёт');
  expect(checks).toBe(2);
});
