import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';

test('Android probe exposes a QR and supports retrying a failed invitation', async ({ page }) => {
  const invitation = 'FS1:192.168.43.1:25000:' + 'a'.repeat(32);
  await page.addInitScript(invite => {
    Object.assign(window, { androidBridge: {}, Capacitor: {
      PluginHeaders: [{ name: 'LocalRoomProbe', methods: ['addresses', 'start', 'status', 'stop', 'check']
        .map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (_plugin: string, method: string, options?: { invitation?: string }) => {
        if (method === 'addresses') return { addresses: ['192.168.43.1'] };
        if (method === 'start' || method === 'status') return { invitation: invite, checks: 1 };
        if (method === 'check') {
          if (options?.invitation !== invite) throw new Error('Нет ответа от комнаты.');
          return { milliseconds: 42 };
        }
      },
    } });
  }, invitation);
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-local-room').click();
  await page.getByRole('button', { name: 'Найти адрес' }).click();
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('img', { name: 'QR приглашения в комнату' })).toBeVisible();
  await expect(page.getByLabel('Код приглашения')).toHaveValue(invitation);
  await page.getByRole('button', { name: 'Закрыть комнату' }).click();
  await page.getByLabel('Код приглашения').fill('expired invitation');
  await page.getByRole('button', { name: 'Проверить связь' }).click();
  await expect(page.getByRole('alert')).toHaveText('Нет ответа от комнаты.');
  await page.getByLabel('Код приглашения').fill(invitation);
  await page.getByRole('button', { name: 'Проверить связь' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Комната ответила' })).toHaveText('Комната ответила за 42 мс.');
});

test('published web client authenticates the reply without sending the invite secret', async ({ page, baseURL }) => {
  const site = 'https://ovepfunkep.github.io/FableShot/';
  const secret = Buffer.alloc(24, 5);
  const invitation = `FS1:192.168.43.1:25000:${secret.toString('base64url')}`;
  await page.addInitScript(() => {
    localStorage.setItem('app.fableshot.training-preferences.v1', JSON.stringify({ version: 1, preferences: { onboardingSeen: true } }));
  });
  let attempted = false;
  await page.exposeFunction('answerProbe', (request: string) => {
    expect(request).not.toContain(secret.toString('base64url'));
    const [, nonce, requestProof] = new URL(request).pathname.slice(1).split('/');
    const sign = (step: number) => createHmac('sha256', secret).update(Buffer.from([1, step])).update(Buffer.from(nonce, 'hex')).digest('hex');
    expect(requestProof).toBe(sign(4));
    const result = attempted ? sign(5) : 'invalid';
    attempted = true;
    return result;
  });
  await page.route(`${site}**`, async route => {
    const localUrl = new URL(route.request().url().slice(site.length), baseURL);
    await route.fulfill({ response: await route.fetch({ url: localUrl.href }) });
  });
  await page.goto(site);
  await page.evaluate(() => {
    const fetchNormally = window.fetch;
    window.fetch = async (input, options) => {
      if (typeof input !== 'string' || !input.startsWith('http://192.168.43.1:25000/')) return fetchNormally(input, options);
      return new Response(await (window as unknown as { answerProbe(value: string): Promise<string> }).answerProbe(input));
    };
  });
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-local-room').click();
  await expect(page.getByRole('heading', { name: 'Создать комнату' })).toHaveCount(0);
  await page.getByLabel('Код приглашения').fill(invitation);
  await page.getByRole('button', { name: 'Проверить связь' }).click();
  await expect(page.getByRole('alert')).toContainText('Нет ответа от комнаты');
  await page.getByRole('button', { name: 'Проверить связь' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Комната ответила' })).toBeVisible();
});
