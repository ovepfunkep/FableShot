import { expect, test } from '@playwright/test';

test('Android rechecks when Home becomes active and opens release notes or the APK only on request', async ({ page }) => {
  const url = 'https://github.com/ovepfunkep/FableShot/releases/download/v0.30.0/FableShot-android-45.apk';
  await page.addInitScript(() => {
    Object.assign(window, {
      androidBridge: {},
      Capacitor: {
        PluginHeaders: [{ name: 'AndroidUpdates', methods: [
          { name: 'installedVersion', rtype: 'promise' }, { name: 'openDownload', rtype: 'promise' },
        ] }],
        nativePromise: async (_plugin: string, method: string, data: { url?: string }) => {
          if (method === 'installedVersion') return { production: true, code: 35 };
          sessionStorage.setItem('opened-apk', data.url ?? '');
        },
      },
    });
  });
  let checks = 0;
  let historyRequests = 0;
  await page.route('https://api.github.com/repos/ovepfunkep/FableShot/releases/latest', async route => {
    checks++;
    await route.fulfill({ json: {
      tag_name: 'v0.30.0', draft: false, prerelease: false, body: 'Текст одного релиза',
      assets: [{ name: 'FableShot-android-45.apk', state: 'uploaded', browser_download_url: url }],
    } });
  });
  await page.route('https://api.github.com/repos/ovepfunkep/FableShot/contents/web/src/web-release-history.json?ref=v0.30.0', async route => {
    historyRequests++;
    await route.fulfill({ json: [
      { code: 45, highlights: ['Новый отчёт'] },
      { code: 44, highlights: ['Возможность из пропущенного выпуска'] },
      { code: 35, highlights: ['Изменение уже установленной версии'] },
    ] });
  });
  await page.goto('./');
  const card = page.getByTestId('android-update');
  await expect(card).toContainText('Доступно обновление');
  await expect(card).toContainText('0.30.0');
  const banner = (await card.boundingBox())!;
  const hero = (await page.getByTestId('home-hero').boundingBox())!;
  expect(banner.x).toBeCloseTo(hero.x);
  expect(banner.width).toBeCloseTo(hero.width);
  await expect(page.getByText('Новый отчёт', { exact: true })).toHaveCount(0);
  expect(checks).toBe(1);
  expect(historyRequests).toBe(0);
  await card.getByRole('button', { name: 'Что нового?' }).click();
  const details = page.getByRole('dialog', { name: 'Что нового в FableShot 0.30.0' });
  await expect(details).toContainText('Новый отчёт');
  await expect(details).toContainText('Возможность из пропущенного выпуска');
  await expect(details).toContainText('Таймер различает серию и отдых');
  await expect(details).not.toContainText('Изменение уже установленной версии');
  await expect(details).not.toContainText('Текст одного релиза');
  expect(historyRequests).toBe(1);
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
  await expect(card).toContainText('Доступно обновление');
  await expect(page.getByText('Новый отчёт', { exact: true })).toHaveCount(0);
});

test('release notifications are optional and open verified notes after returning to Home', async ({ page }) => {
  await page.addInitScript(() => {
    const storage = sessionStorage;
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    Object.assign(window, { androidBridge: {}, Capacitor: {
      PluginHeaders: [
        { name: 'AndroidUpdates', methods: methods(['installedVersion', 'openDownload']) },
        { name: 'ReleasePush', methods: methods(['getStatus', 'setEnabled', 'pendingRelease', 'acknowledge']) },
      ],
      nativePromise: async (_plugin: string, method: string, data: { enabled?: boolean; code?: number }) => {
        if (method === 'installedVersion') return { production: true, code: 74 };
        if (method === 'pendingRelease') return { code: Number(storage.getItem('pending-release') ?? 0) };
        if (method === 'acknowledge' && String(data.code) === storage.getItem('pending-release')) storage.removeItem('pending-release');
        if (method === 'setEnabled' && storage.getItem('allow-push') === 'yes') storage.setItem('push-enabled', String(data.enabled));
        return { available: true, enabled: storage.getItem('push-enabled') === 'true', allowed: storage.getItem('allow-push') === 'yes' };
      },
    } });
  });
  let published = false;
  await page.route('https://api.github.com/repos/ovepfunkep/FableShot/releases/latest', route => published
    ? route.fulfill({ json: { tag_name: 'v0.31.0', draft: false, prerelease: false,
      assets: [{ name: 'FableShot-android-75.apk', state: 'uploaded', browser_download_url: 'https://github.com/ovepfunkep/FableShot/releases/download/v0.31.0/FableShot-android-75.apk' }] } })
    : route.fulfill({ status: 404 }));
  await page.route('https://api.github.com/repos/ovepfunkep/FableShot/contents/web/src/web-release-history.json?ref=v0.31.0', route =>
    route.fulfill({ json: [{ code: 75, highlights: ['Новый выпуск'] }] }));
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-notifications').click();
  const toggle = page.getByRole('switch', { name: 'Обновления приложения' });
  await expect(page.getByRole('region', { name: 'Уведомления FableShot' })).not.toContainText('Сообщать о выходе новой версии');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(() => sessionStorage.setItem('allow-push', 'yes'));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => {
    sessionStorage.setItem('pending-release', '75');
    window.dispatchEvent(new Event('fableshot-release-push'));
  });
  const notes = page.getByRole('dialog', { name: 'Что нового в FableShot 0.31.0' });
  await expect(notes).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(notes).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('pending-release'))).toBe('75');
  published = true;
  await page.evaluate(() => window.dispatchEvent(new Event('fableshot-release-push')));
  await expect(notes).toContainText('Новый выпуск');
  await page.keyboard.press('Escape');
  await expect(notes).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('pending-release'))).toBeNull();
});
