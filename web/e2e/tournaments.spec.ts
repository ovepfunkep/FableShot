import { readDiary } from './stored-journal.ts';
import { expect, test } from '@playwright/test';
import { appendShot, completePractice, emptyPractice } from '../src/practice.ts';

test('a future tournament on Home opens only its passport and Back returns to Home', async ({ page }) => {
  await page.addInitScript(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const format = new Intl.DateTimeFormat('sv-SE');
    const from = format.format(date);
    date.setDate(date.getDate() + 1);
    const start = { id: 'first', category: 'Квалификация', bow: null, status: 'planned', result: '', place: null, participants: null, sessionIds: [] };
    const tournament = { id: 'next', title: 'Ближайший кубок', from, to: null, venue: 'Клуб', protocol: '', note: 'Сбор в 10:00', starts: [start] };
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries: [], tournaments: [
      tournament, { ...tournament, id: 'later', title: 'Поздний кубок', from: format.format(date) },
    ] }));
  });
  await page.goto('./');
  await page.getByRole('button', { name: /Ближайший кубок/ }).click();
  const passport = page.getByTestId('tournaments-screen');
  await expect(passport.getByRole('heading', { name: 'Паспорт турнира' })).toBeVisible();
  await expect(passport.getByTestId('tournament-card')).toHaveCount(1);
  await expect(passport.getByText('Сбор в 10:00')).toBeVisible();
  await expect(passport.getByRole('button', { name: 'Добавить турнир' })).toHaveCount(0);
  await passport.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
});

test('a running tournament on Home can start a new linked practice without losing the active one', async ({ page }) => {
  const active = appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } });
  await page.addInitScript(practice => {
    const key = 'app.fableshot.practice-diary.v1';
    if (localStorage.getItem(key)) return;
    const today = new Intl.DateTimeFormat('sv-SE').format(new Date());
    localStorage.setItem(key, JSON.stringify({ version: 1,
      entries: [{ id: 'practice', startedAt: new Date().toISOString(), practice }],
      tournaments: [{ id: 'cup', title: 'Открытый кубок', from: today, to: null, venue: 'Клуб', protocol: '', note: '',
        starts: [{ id: 'first', category: 'Квалификация', bow: null, status: 'planned', result: '', place: null, participants: null, sessionIds: [] }] }],
    }));
  }, active);
  await page.goto('./');
  await page.getByRole('button', { name: /Ближайший турнир.*Открытый кубок.*Начать/ }).click();
  await page.getByRole('button', { name: 'Перейти к условиям' }).click();
  await expect(page.getByRole('button', { name: 'Турнирный старт' })).toContainText('Квалификация');
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
  await expect(page.getByTestId('target')).toBeVisible();
  const diary = await readDiary(page);
  const previous = diary.entries.find(entry => entry.id === 'practice');
  expect(previous?.paused).toBe(true);
  expect(previous?.practice.rounds[0].series[0].shots).toEqual(active.rounds[0].series[0].shots);
  const linked = diary.tournaments?.[0].starts[0].sessionIds;
  expect(linked).toEqual([diary.entries.find(entry => entry.id !== 'practice')?.id]);
});

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
  const filters = page.getByTestId('history-filter-sheet');
  await history.getByTestId('history-filters').click();
  await filters.getByRole('button', { name: 'Турниры', exact: true }).click();
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
  await expect(training.getByLabel('Турнир · Кубок клуба · 2 место')).toBeVisible();
  await history.getByTestId('history-filters').click();
  await filters.getByRole('button', { name: 'Тип записи' }).click();
  await page.getByRole('button', { name: 'Только тренировки', exact: true }).click();
  await expect(training).toHaveCount(0);
  await filters.getByRole('button', { name: 'Тип записи' }).click();
  await page.getByRole('button', { name: 'Только турниры', exact: true }).click();
  await expect(training).toHaveCount(1);
  await filters.getByRole('button', { name: 'Тип записи' }).click();
  await page.getByRole('button', { name: 'Все записи', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('open-profile').click();
  const profileTournaments = page.getByRole('button', { name: '1 Турниры' });
  await profileTournaments.click();
  await expect(card).toHaveCount(1);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('profile-screen')).toBeVisible();

  await page.reload();
  await page.getByTestId('nav-history').click();
  await expect(training).toHaveClass(/is-tournament/);
  await history.getByTestId('history-filters').click();
  await filters.getByRole('button', { name: 'Турниры', exact: true }).click();
  await card.getByRole('button', { name: 'Редактировать Кубок клуба' }).click();
  await page.getByTestId('tournament-editor').getByRole('button', { name: 'Удалить турнир', exact: true }).click();
  await page.getByRole('dialog', { name: 'Удалить турнир?' }).getByRole('button', { name: 'Удалить турнир' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(training).toBeVisible();
  await expect(training).not.toHaveClass(/is-tournament/);
  const saved = await readDiary(page);
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
  await page.getByRole('button', { name: 'Турнирный старт' }).click();
  await page.getByRole('button', { name: 'Зимний кубок · Баребоу', exact: true }).click();
  await page.getByTestId('start-training').click();
  await page.getByTestId('target').click();
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByTestId('training-confirm').click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('nav-history').click();
  const history = page.getByTestId('history-screen');
  await expect(history.getByLabel('Турнир · Зимний кубок · 3 место')).toBeVisible();
  await history.getByTestId('history-filters').click();
  await page.getByTestId('history-filter-sheet').getByRole('button', { name: 'Турниры', exact: true }).click();
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
  await history.getByTestId('history-filters').click();
  await page.getByTestId('history-filter-sheet').getByRole('button', { name: 'Турниры', exact: true }).click();
  await expect(card).toContainText('Завершён');
  await card.getByText('Вложения · 2', { exact: true }).click();
  await expect(card.getByRole('img', { name: 'protocol.png' })).toBeVisible();
});
