import { expect, test } from '@playwright/test';
import { createHash, createHmac, createPublicKey, verify } from 'node:crypto';
import { appendShot, emptyPractice } from '../src/practice.ts';

test('the host can restore a saved room on the current hotspot address', async ({ page }) => {
  const invitation = 'FS1:192.168.44.1:25000:' + 'a'.repeat(32);
  await page.addInitScript(invite => {
    Object.assign(window, { androidBridge: {}, Capacitor: {
      PluginHeaders: [{ name: 'LocalRoomProbe', methods: ['status', 'addresses', 'start'].map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (_plugin: string, method: string) => {
        if (method === 'addresses') return { addresses: ['192.168.44.1'] };
        if (method === 'start') return { roomName: 'Клуб', invitation: invite, acceptedSeries: 7 };
        return { roomName: 'Клуб', restorable: true };
      },
    } });
  }, invitation);
  await page.goto('./');
  await page.getByTestId('home-group-room').click();
  await expect(page.getByText(/Комната сохранена/)).toBeVisible();
  await page.getByRole('button', { name: 'Найти адрес' }).click();
  await page.getByRole('button', { name: 'Восстановить комнату' }).click();
  await expect(page.getByLabel('Код приглашения')).toHaveValue(invitation);
  await expect(page.getByText('Принято серий · 7')).toBeVisible();
});

test('Android group training keeps its series queued during an outage and sends it after reconnecting', async ({ page }) => {
  const invitation = 'FS1:192.168.43.1:25000:' + 'a'.repeat(32);
  const uploads: { endId: number; revision: number; result: { scores: string } }[] = [];
  await page.exposeFunction('acceptGroupSeries', ({ payload, publicKey, signature }: { payload: string; publicKey: string; signature: string }) => {
    const operation = JSON.parse(payload);
    const key = Buffer.from(publicKey, 'base64');
    expect(operation.entryId).toBe(createHash('sha256').update(key).digest('hex'));
    expect(verify('sha256', Buffer.from(payload), createPublicKey({ key, format: 'der', type: 'spki' }), Buffer.from(signature, 'base64'))).toBe(true);
    if (operation.action === 'join') return { joined: operation.entryId };
    uploads.push(operation);
    if (uploads.length === 1) return null;
    return { endId: operation.endId, revision: operation.revision };
  });
  await page.addInitScript(({ invite, practice }) => {
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries: [
      { id: 'personal', startedAt: '2026-11-13T00:00:00Z', practice },
    ] }));
    Object.assign(window, { androidBridge: {}, Capacitor: {
      PluginHeaders: [{ name: 'LocalRoomProbe', methods: ['status', 'publish', 'snapshot'].map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (_plugin: string, method: string, options?: { payload: string; publicKey: string; signature: string }) => {
        if (method === 'status') return { invitation: invite, checks: 1, roomName: 'Вольные стрелки' };
        if (method === 'snapshot') {
          if (!navigator.onLine) throw new Error('Нет связи');
          return { participants: [
          { entryId: 'b'.repeat(64), displayName: 'Новичок', bowCategory: 'recurve' },
        ], series: [
          { entryId: 'a'.repeat(64), displayName: 'Алексей', ordinal: 1, result: { points: 22, arrows: 3, bowCategory: 'barebow', hits: 3,
            spread: { positions: 3, squaredDistance: 0, complete: true },
            conditions: { distanceMeters: 18, targetProfileId: 'wa-indoor-outer-v1', targetDiameterMm: 400 } } },
          { entryId: 'a'.repeat(64), ordinal: 2, result: { points: 25, arrows: 3, bowCategory: 'barebow',
            conditions: { distanceMeters: 18, targetProfileId: 'wa-indoor-outer-v1', targetDiameterMm: 400 } } },
        ] };
        }
        const result = await (window as unknown as { acceptGroupSeries(operation: typeof options): Promise<unknown> }).acceptGroupSeries(options);
        if (!result) throw new Error('Нет связи');
        return result;
      },
    } });
  }, { invite: invitation, practice: appendShot(emptyPractice(), { point: null, code: 'M', points: 0 }) });
  await page.goto('./');
  await page.getByTestId('home-group-room').click();
  await page.getByLabel('Имя для комнаты').fill('Иван');
  await page.getByRole('button', { name: 'Начать групповую тренировку' }).click();
  await page.getByRole('button', { name: 'Выбрать условия' }).click();
  await page.getByTestId('start-training').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!).entries[0])).toMatchObject({
    id: 'personal', paused: true, practice: { rounds: [{ series: [{ shots: [{ code: 'M' }] }] }] },
  });
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await page.getByTestId('next-end').click();
  const status = page.getByTestId('room-sync-status');
  await expect(status).toHaveText('В очереди · 1');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => uploads.length).toBe(1);
  await expect(status).toHaveText('В очереди · 1');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(status).toHaveText('Групповая');
  expect(uploads).toHaveLength(2);
  expect(uploads[0]).toEqual(uploads[1]);
  expect(uploads[0].result.scores).toBe('0');
  expect(uploads[0]).toMatchObject({ displayName: 'Иван' });
  await page.getByRole('button', { name: 'Таблица комнаты' }).click();
  await expect(page.getByText('1. Алексей')).toBeVisible();
  await expect(page.getByText('Новичок')).toBeVisible();
  await page.getByLabel('Зачёт', { exact: true }).selectOption('cg3');
  await page.getByText('Разбор очков', { exact: true }).click();
  await expect(page.getByText('Попадания +73.33 · кучность +5.00')).toBeVisible();
  await page.getByLabel('Зачёт', { exact: true }).selectOption('classic');
  await page.getByRole('combobox', { name: /Вид/ }).selectOption('rows');
  await expect(page.getByRole('cell', { name: '22/30', exact: true })).toHaveCount(2);
  await page.getByLabel('Серия', { exact: true }).selectOption('2');
  await expect(page.getByRole('cell', { name: '47/60' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Таблица комнаты' }).click();
  await expect(page.getByText(/Получено /)).toBeVisible();
  await expect(page.getByText('Новичок')).toBeVisible();
  await page.getByRole('button', { name: 'Обновить таблицу' }).click();
  await expect(page.getByText(/Не удалось обновить таблицу/)).toBeVisible();
  await expect(page.getByText('Новичок')).toBeVisible();
  await page.getByLabel('Условия', { exact: true }).selectOption({ index: 1 });
  await expect(page.getByText('Новичок')).toHaveCount(0);
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Обновить таблицу' }).click();
  await expect(page.getByText(/Не удалось обновить таблицу/)).toHaveCount(0);
});

test('Android probe exposes a QR and supports retrying a failed invitation', async ({ page }) => {
  const invitation = 'FS1:192.168.43.1:25000:' + 'a'.repeat(32);
  await page.addInitScript(invite => {
    let created = false;
    Object.assign(window, { androidBridge: {}, Capacitor: {
      PluginHeaders: [{ name: 'LocalRoomProbe', methods: ['addresses', 'start', 'status', 'stop', 'check']
        .map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (_plugin: string, method: string, options?: { invitation?: string }) => {
        if (method === 'addresses') return { addresses: ['192.168.43.1'] };
        if (method === 'start') created = true;
        if (method === 'stop') created = false;
        if (method === 'start' || method === 'status') return created ? { invitation: invite, checks: 1 } : {};
        if (method === 'check') {
          if (options?.invitation !== invite) throw new Error('Нет ответа от комнаты.');
          return { milliseconds: 42 };
        }
      },
    } });
  }, invitation);
  await page.goto('./');
  await page.getByTestId('home-group-room').click();
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
  await page.getByTestId('home-group-room').click();
  await expect(page.getByRole('heading', { name: 'Создать комнату' })).toHaveCount(0);
  await page.getByLabel('Код приглашения').fill(invitation);
  await page.getByRole('button', { name: 'Проверить связь' }).click();
  await expect(page.getByRole('alert')).toContainText('Нет ответа от комнаты');
  await page.getByRole('button', { name: 'Проверить связь' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Комната ответила' })).toBeVisible();
  await page.getByRole('button', { name: 'Начать групповую тренировку' }).click();
  await page.getByTestId('start-training').click();
  await expect(page.getByTestId('room-sync-status')).toHaveText('Групповая');
});
