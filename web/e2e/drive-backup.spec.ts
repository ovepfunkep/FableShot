import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { appendShot, emptyPractice } from '../src/practice.ts';
import { openSettingsCategory } from './journal-navigation.ts';
import { inspectWebArchive } from '../src/web-archive.ts';
import { DATA_KEYS } from '../src/app-storage.ts';

test.skip(!process.env.VITE_FABLESHOT_GOOGLE_CLIENT_ID, 'Requires a build with an OAuth client ID.');

async function openArchive(page: Page) {
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
}

test('backs up a diary and previews it on a fresh device without replacing the cloud copy', async ({ page, context, browser }) => {
  const entries = [{ id: 'drive-source', startedAt: '2026-11-11T10:00:00Z',
    practice: { ...appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } }), savedAt: '2026-11-11T11:00:00Z' } }];
  await page.addInitScript(entries => {
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries }));
  }, entries);
  const uploaded: { bytes: Buffer; metadata: { id: string; createdTime: string; size: string; sha256Checksum: string;
    appProperties: Record<string, string> } }[] = [];
  let appProperties: Record<string, string>;
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Expose-Headers': 'Location' };

  async function mockDrive(client: BrowserContext) {
    await client.route('https://accounts.google.com/gsi/client', route => route.fulfill({
      contentType: 'application/javascript',
      body: "window.google = { accounts: { oauth2: { initTokenClient: options => ({ requestAccessToken() { options.callback({ access_token: 'test-token', expires_in: 3600, scope: options.scope }); } }) } } };",
    }));
    await client.route('https://www.googleapis.com/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      expect(request.headers().authorization).toBe('Bearer test-token');
      if (url.pathname === '/oauth2/v3/userinfo') {
        await route.fulfill({ headers, json: { sub: 'test-account', name: 'Имя Google', picture: 'https://lh3.googleusercontent.com/test-avatar' } });
        return;
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        expect(body.parents).toEqual(['appDataFolder']);
        appProperties = body.appProperties;
        await route.fulfill({ headers: { ...headers, Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=copy-1' } });
      } else if (request.method() === 'PUT') {
        const bytes = request.postDataBuffer()!;
        const metadata = { id: 'copy-' + (uploaded.length + 1), createdTime: new Date().toISOString(), size: String(bytes.length),
          sha256Checksum: createHash('sha256').update(bytes).digest('hex'), appProperties };
        uploaded.unshift({ bytes, metadata });
        await route.fulfill({ headers, json: metadata });
      } else if (url.searchParams.get('alt') === 'media') {
        await route.fulfill({ headers, body: uploaded.find(copy => url.pathname.endsWith('/' + copy.metadata.id))!.bytes });
      } else {
        expect(url.searchParams.get('spaces')).toBe('appDataFolder');
        await route.fulfill({ headers, json: { files: uploaded.map(copy => copy.metadata) } });
      }
    });
    await client.route('https://lh3.googleusercontent.com/test-avatar', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="green"/></svg>',
    }));
  }

  await mockDrive(context);
  await page.goto('./');
  await page.getByTestId('open-profile').click();
  await page.getByRole('button', { name: 'Войти через Google' }).click();
  const profile = page.getByTestId('profile-screen');
  await expect(profile.getByRole('heading', { name: 'Имя Google' })).toBeVisible();
  await expect(profile.locator('.profile-avatar img')).toBeVisible();
  await profile.getByRole('button', { name: 'Изменить имя' }).click();
  await page.getByRole('textbox', { name: 'Имя' }).fill('Моё имя');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(profile.getByRole('heading', { name: 'Моё имя' })).toBeVisible();
  await profile.getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByTestId('open-profile').locator('img')).toBeVisible();
  await openArchive(page);
  await expect(page.getByText('Последняя копия ·')).toBeVisible();
  expect(uploaded[0].metadata.appProperties).toMatchObject({ archives: 'excluded', trainings: '1', arrows: '1' });
  const autoBackup = page.getByRole('switch', { name: 'Автобэкап на Google Диск' });
  await expect(autoBackup).toHaveAttribute('aria-checked', 'true');
  await autoBackup.click();
  await expect(autoBackup).toHaveAttribute('aria-checked', 'false');
  await autoBackup.click();
  await expect(autoBackup).toHaveAttribute('aria-checked', 'true');

  const fresh = await browser.newContext({ baseURL: page.url() });
  try {
    await mockDrive(fresh);
    const device = await fresh.newPage();
    await device.addInitScript(() => localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries: [] })));
    await device.goto('./');
    await openArchive(device);
    await device.getByRole('button', { name: 'Подключить Google Диск' }).click();
    await expect(device.getByText('На Диске есть дневник. Сначала восстанови его из копии.')).toBeVisible();
    await device.getByRole('button', { name: 'Восстановить с Диска' }).click();
    await device.getByRole('button', { name: /1 трен\./ }).click();
    await expect(device.getByTestId('archive-preview').getByText('Тренировки')).toBeVisible();
    await device.getByTestId('archive-restore').click();
    await device.getByTestId('archive-confirm-apply').click();
    await expect(device.getByTestId('home-screen')).toBeVisible();
    await device.getByTestId('nav-history').click();
    await expect(device.getByTestId('session-drive-source')).toBeVisible();
    await device.getByTestId('open-profile').click();
    await expect(device.getByTestId('profile-screen').locator('.profile-avatar img')).toBeVisible();
    await device.getByRole('button', { name: 'Выйти из Google' }).click();
    await expect(device.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
    await expect(device.getByRole('button', { name: 'Выйти из Google' })).toHaveCount(0);
    await expect(device.getByTestId('profile-screen').locator('.profile-avatar img')).toHaveCount(0);
    await device.getByRole('button', { name: 'Назад', exact: true }).click();
    await openArchive(device);
    await expect(device.getByRole('button', { name: 'Подключить Google Диск' })).toBeVisible();
  } finally {
    await fresh.close();
  }

  const sourceId = uploaded[0].metadata.appProperties.device;
  const newest = await browser.newContext({ baseURL: page.url() });
  try {
    await mockDrive(newest);
    const device = await newest.newPage();
    await device.addInitScript(({ sourceId, entries }) => {
      localStorage.setItem('app.fableshot.drive-backup.device', sourceId);
      localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1,
        entries: entries.map(entry => ({ ...entry, deletedAt: '2026-11-11T12:00:00Z' })) }));
    }, { sourceId, entries });
    await device.goto('./');
    await openArchive(device);
    await device.getByRole('button', { name: 'Подключить Google Диск' }).click();
    await expect.poll(() => uploaded.length).toBe(2);
    expect(uploaded.map(copy => copy.metadata.appProperties.trainings)).toEqual(['0', '1']);
    expect(uploaded[0].metadata.appProperties).toMatchObject({ archives: 'excluded', arrows: '0', device: sourceId });
    const active = await inspectWebArchive(uploaded[0].bytes);
    expect(active.summary.trainings).toBe(0);
    expect(uploaded[0].metadata.appProperties.revision).toBe(createHash('sha256').update(JSON.stringify(active.records)).digest('hex'));

    await device.getByRole('switch', { name: 'Сохранить архивированные данные?' }).click();
    await device.getByRole('button', { name: 'Создать копию' }).click();
    await expect.poll(() => uploaded.length).toBe(3);
    expect(uploaded.map(copy => copy.metadata.appProperties.trainings)).toEqual(['1', '0', '1']);
    const full = await inspectWebArchive(uploaded[0].bytes);
    expect(full.summary.trainings).toBe(1);
    expect(JSON.parse(full.records[DATA_KEYS[0]]!).entries[0].deletedAt).toBe('2026-11-11T12:00:00Z');
  } finally {
    await newest.close();
  }
});
