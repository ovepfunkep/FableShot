import { expect, test } from '@playwright/test';
import { appendShot, completePractice, emptyPractice } from '../src/practice.ts';

const protocolPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=', 'base64');

test('one tournament holds several starts, links history, and can be removed without deleting training', async ({ page }) => {
  const practice = completePractice(appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } }), '2026-11-10T12:00:00Z');
  await page.addInitScript(value => {
    const key = 'app.fableshot.practice-diary.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, entries: [
      { id: 'qualification', title: 'Квалификация', startedAt: '2026-11-10T11:00:00Z', practice: value },
    ] }));
  }, practice);
  await page.goto('./');
  await page.getByTestId('nav-history').click();
  const history = page.getByTestId('history-screen');
  await history.getByRole('button', { name: 'Турниры', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить турнир' }).click();
  const editor = page.getByTestId('tournament-editor');
  await editor.getByLabel('Название', { exact: true }).fill('Кубок клуба');
  const first = editor.getByRole('group', { name: 'Старт 1' });
  await first.getByLabel('Категория', { exact: true }).fill('Баребоу 18 м');
  await first.getByLabel('Итог по протоколу').fill('480 очков');
  await first.getByLabel('Место', { exact: true }).fill('4');
  await first.getByLabel('Участников в категории').fill('3');
  await editor.getByRole('button', { name: 'Сохранить турнир' }).click();
  await expect(editor.getByRole('alert')).toContainText('Место не может');
  await first.getByLabel('Место', { exact: true }).fill('2');
  await first.getByText('Связанные тренировки', { exact: true }).click();
  await first.getByRole('checkbox', { name: /Квалификация/ }).check();
  await editor.getByRole('button', { name: 'Добавить старт' }).click();
  const second = editor.getByRole('group', { name: 'Старт 2' });
  await second.getByLabel('Категория', { exact: true }).fill('Классика');
  await second.getByLabel('Итог по протоколу').fill('DNF');
  await editor.getByRole('button', { name: 'Сохранить турнир' }).click();
  const card = page.getByTestId('tournament-card');
  await expect(card).toContainText('480 очков');
  await expect(card).toContainText('2 из 3');
  await expect(card).toContainText('10/10');
  await expect(card).toContainText('DNF');
  await card.screenshot({ path: '../artifacts/web-0.28.0-tournament-card.png' });
  await card.getByText('Тренировки · 1', { exact: true }).click();
  await card.getByRole('button', { name: /Квалификация/ }).click();
  await expect(page.getByTestId('report-round-total-1')).toContainText('10/10');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(card).toHaveCount(1);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  const training = page.getByTestId('session-qualification');
  await expect(training).toHaveClass(/is-tournament/);
  await expect(training).toContainText('Кубок клуба · 2 место');
  await history.getByLabel('Тип записи').selectOption('ordinary');
  await expect(training).toHaveCount(0);
  await history.getByLabel('Тип записи').selectOption('linked');
  await expect(training).toBeVisible();
  await history.getByLabel('Тип записи').selectOption('');
  await page.getByTestId('open-profile').click();
  const profileTournaments = page.getByRole('button', { name: '1 Турниры' });
  await profileTournaments.click();
  await expect(card).toHaveCount(1);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('profile-screen')).toBeVisible();

  await page.reload();
  await page.getByTestId('nav-history').click();
  await expect(training).toHaveClass(/is-tournament/);
  await history.getByRole('button', { name: 'Турниры', exact: true }).click();
  await card.getByRole('button', { name: 'Удалить Кубок клуба' }).click();
  await page.getByRole('dialog', { name: 'Удалить турнир?' }).getByRole('button', { name: 'Удалить турнир' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(training).toBeVisible();
  await expect(training).not.toHaveClass(/is-tournament/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!));
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0].practice).toEqual(practice);
});

test('training setup links a start and a completed tournament keeps its protocol and prize effect', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'app.fableshot.practice-diary.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, entries: [], tournaments: [
      { id: 'cup', title: 'Зимний кубок', from: '2026-11-11', to: null, venue: '', protocol: '', note: '', starts: [
        { id: 'start', category: 'Баребоу', bow: 'barebow', status: 'participated', result: '200', place: 3, participants: 8, sessionIds: [] },
      ] },
      { id: 'club', title: 'Клубный старт', from: '2026-11-10', to: null, venue: '', protocol: '', note: '', starts: [
        { id: 'start', category: '', bow: null, status: 'participated', result: '', place: null, participants: null, sessionIds: [] },
      ] },
    ] }));
  });
  await page.goto('./');
  await page.getByTestId('home-change-conditions').click();
  await expect(page.getByLabel('Турнирный старт')).toBeHidden();
  await page.getByTestId('conditions-advanced').click();
  await page.getByLabel('Турнирный старт').selectOption({ label: 'Зимний кубок · Баребоу' });
  await page.getByTestId('start-training').click();
  await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('nav-history').click();
  const history = page.getByTestId('history-screen');
  await expect(history.locator('.history-tournament-badge')).toContainText('Зимний кубок · 3 место');
  await history.getByRole('button', { name: 'Турниры', exact: true }).click();
  const card = page.getByTestId('tournament-card').filter({ hasText: 'Зимний кубок' });
  await card.getByRole('button', { name: 'Редактировать Зимний кубок' }).click();
  const editor = page.getByTestId('tournament-editor');
  await editor.getByText('Протокол и заметка', { exact: true }).click();
  const file = editor.getByLabel('Прикрепить протокол');
  await file.setInputFiles({ name: 'protocol.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await expect(editor.getByRole('alert')).toContainText('не соответствует');
  await file.setInputFiles({ name: 'protocol.png', mimeType: 'image/png', buffer: protocolPng });
  await expect(editor.getByText('protocol.png', { exact: true })).toBeVisible();
  const largePng = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 123456;
    for (let index = 0; index < pixels.data.length; index++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels.data[index] = index % 4 === 3 ? 255 : seed & 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await file.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(largePng, 'base64') });
  await expect(editor.getByText('large.jpg', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Сохранить турнир' }).click();
  await card.getByRole('button', { name: 'Завершить турнир' }).click();
  await page.getByRole('dialog', { name: 'Завершить турнир?' }).getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(card).toHaveAttribute('data-finish-effect', 'prize');
  await expect(card).toContainText('Завершён');
  await card.getByText('Вложения · 2', { exact: true }).click();
  await expect(card.getByRole('img', { name: 'protocol.png' })).toBeVisible();
  await expect(card.getByRole('img', { name: 'large.jpg' })).toHaveJSProperty('naturalWidth', 512);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const club = page.getByTestId('tournament-card').filter({ hasText: 'Клубный старт' });
  await club.getByRole('button', { name: 'Завершить турнир' }).click();
  await page.getByRole('dialog', { name: 'Завершить турнир?' }).getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(club).toContainText('Завершён');
  await expect(club).not.toHaveAttribute('data-finish-effect', /./);
  await page.reload();
  await page.getByTestId('nav-history').click();
  await history.getByRole('button', { name: 'Турниры', exact: true }).click();
  await expect(card).toContainText('Завершён');
  await card.getByText('Вложения · 2', { exact: true }).click();
  await expect(card.getByRole('img', { name: 'protocol.png' })).toBeVisible();
});
