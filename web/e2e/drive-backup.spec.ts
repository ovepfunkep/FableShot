import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { appendShot, emptyPractice } from '../src/practice.ts';
import { openSettingsCategory } from './journal-navigation.ts';

test.skip(!process.env.VITE_FABLESHOT_GOOGLE_CLIENT_ID, 'Requires a build with an OAuth client ID.');

async function openArchive(page: Page) {
  await page.goto('./');
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
  let uploaded: Buffer | null = null;
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
      const metadata = () => ({
        id: 'copy-1', createdTime: '2026-11-11T11:00:00Z', size: String(uploaded!.length),
        sha256Checksum: createHash('sha256').update(uploaded!).digest('hex'), appProperties,
      });
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        expect(body.parents).toEqual(['appDataFolder']);
        appProperties = body.appProperties;
        await route.fulfill({ headers: { ...headers, Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=copy-1' } });
      } else if (request.method() === 'PUT') {
        expect(uploaded).toBeNull();
        uploaded = request.postDataBuffer();
        await route.fulfill({ headers, json: metadata() });
      } else if (url.searchParams.get('alt') === 'media') {
        await route.fulfill({ headers, body: uploaded! });
      } else {
        expect(url.searchParams.get('spaces')).toBe('appDataFolder');
        await route.fulfill({ headers, json: { files: uploaded ? [metadata()] : [] } });
      }
    });
  }

  await mockDrive(context);
  await openArchive(page);
  await expect(page.getByRole('switch', { name: 'Автобэкап на Google Диск' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Подключить Google Диск' }).click();
  await expect(page.getByText('Последняя копия ·')).toBeVisible();

  const fresh = await browser.newContext({ baseURL: page.url() });
  try {
    await mockDrive(fresh);
    const device = await fresh.newPage();
    await device.addInitScript(() => localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries: [] })));
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
  } finally {
    await fresh.close();
  }
});
