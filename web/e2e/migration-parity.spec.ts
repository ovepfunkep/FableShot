import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import { emptyPractice } from '../src/practice.ts';
import type { DiaryEntry } from '../src/persistence.ts';
import type { Shot } from '../src/target.ts';
import { openHistoryEntry, openTraining } from './journal-navigation.ts';

const equipment = { id: 'kit', name: 'Тестовый комплект', bow: { id: 'bow', name: 'Лук', category: 'recurve' },
  arrows: { id: 'arrows', name: 'Номерной набор', diameterMm: 6, numberedCount: 3 } };
const hit = (code: string, points: number, x: number, number?: number): Shot =>
  ({ code, points, point: points ? { x, y: 0 } : null, physicalArrowNumber: number });
const conditions = { ...DEFAULT_CONDITIONS, distanceMeters: 25, equipment };
const makeEntry = (id: string, day: string, twoRounds = false): DiaryEntry => ({
  id, title: `Тренировка ${id}`, startedAt: `${day}T10:00:00Z`, localDate: day,
  practice: {
    ...emptyPractice(), roundRule: { unit: 'series', limit: 10 }, nextId: 9, savedAt: `${day}T11:00:00Z`,
    rounds: [
      { id: 1, series: [{ id: 2, conditions, shots: [hit('X', 10, .02, 1), hit('M', 0, 0, 2)] },
        ...(twoRounds ? [{ id: 3, conditions, shots: [hit('9', 9, .15, 1)] }] : [])] },
      ...(twoRounds ? [{ id: 4, series: [{ id: 5, conditions, shots: [hit('10', 10, .05, 1)] }] }] : []),
    ],
  },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ entries, equipment }) => {
    if (localStorage.getItem('app.fableshot.practice-diary.v1')) return;
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries }));
    localStorage.setItem('app.fableshot.equipment.v1', JSON.stringify({
      bows: [equipment.bow], arrows: [equipment.arrows], kits: [{ id: equipment.id, name: equipment.name, bowId: 'bow', arrowsId: 'arrows' }],
    }));
  }, { entries: [makeEntry('first', '2026-11-01', true), makeEntry('second', '2026-11-03')], equipment });
});

test('a completed report manages rounds and series and repeats the selected conditions in a new entry', async ({ page }) => {
  await page.goto('./');
  await openHistoryEntry(page, 'first');
  const openStructure = async () => {
    await page.getByTestId('report-menu-open').click();
    await page.getByTestId('session-rounds').click();
  };
  await openStructure();
  await page.getByTestId('training-select-round-1').click();
  await page.getByTestId('remove-series-2').click();
  await page.getByTestId('confirm-remove-series').click();
  await page.getByTestId('remove-round-2').click();
  await page.getByTestId('confirm-remove-round').click();
  await expect(page.getByTestId('report-end-3')).toHaveCount(0);
  await expect(page.getByTestId('report-round-2')).toHaveCount(0);
  await expect(page.getByTestId('report-round-total-1')).toContainText('10/20');
  await openStructure();
  await expect(page.getByTestId('remove-round-1')).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.getByTestId('report-menu-open').click();
  await page.getByTestId('session-repeat').click();
  await expect(page.getByTestId('distance-field')).toHaveValue('25');
  await expect(page.getByTestId('conditions-equipment')).toContainText('Тестовый комплект');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('journal-report')).toBeVisible();
  await page.getByTestId('report-menu-open').click();
  await page.getByTestId('session-repeat').click();
  await page.getByTestId('start-training').click();
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  const diary = await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!));
  expect(diary.entries).toHaveLength(3);
  expect(diary.entries[0].practice.rounds[0].series[0].shots).toHaveLength(2);
  expect(diary.entries[2].practice.roundRule).toEqual({ unit: 'series', limit: 10 });
});

test('arrow history aggregates saved sessions and progress exports the selected sessions', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('nav-equipment').click();
  await page.getByTestId('equipment-catalog-tab-arrows').click();
  await page.getByRole('button', { name: 'Статистика стрел · Номерной набор' }).click();
  const history = page.getByTestId('equipment-arrow-history');
  await history.getByRole('button', { name: 'Стрела №1', exact: true }).click();
  await expect(history.getByTestId('numbered-arrow-point')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-progress').click();
  await page.getByTestId('progress-trend-xShare').click();
  await expect(page.getByTestId('progress-trend-value')).toContainText('50');
  await page.getByTestId('progress-trend-missShare').click();
  await expect(page.getByTestId('progress-trend-value')).toContainText('50');
  const openExport = async () => {
    await page.getByRole('button', { name: 'Экспорт отчёта по выборке' }).click();
    return page.getByTestId('progress-export');
  };
  for (const [label, extension] of [['Попадания (CSV)', 'csv'], ['Отчёт (PDF)', 'pdf'], ['Страницы (PNG)', 'png']] as const) {
    const sheet = await openExport();
    await expect(sheet).toContainText('Выбрано тренировок: 2');
    await sheet.getByRole('button', { name: label, exact: true }).click();
    const pending = page.waitForEvent('download');
    await sheet.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    const bytes = await readFile(await download.path());
    if (extension === 'csv') {
      expect(bytes.toString()).toContain('"first"');
      expect(bytes.toString()).toContain('"second"');
      expect(bytes.toString().match(/"record_type"/g)).toHaveLength(1);
    } else if (extension === 'pdf') expect(bytes.toString('ascii', 0, 4)).toBe('%PDF');
    else expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    await expect(sheet).toHaveCount(0);
  }
});

test('the ten streak feedback runs on new shots and never replays on reopening a series', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  for (let index = 1; index <= 3; index++) {
    await page.getByTestId('target').click();
    await page.getByRole('button', { name: `Стрела №${index}`, exact: true }).click();
  }
  const scores = page.getByTestId('arrow-panel').locator('.arrow-score');
  await expect.poll(() => scores.evaluateAll(nodes => nodes.filter(node => node.getAnimations().length).length)).toBe(3);
  await page.getByTestId('next-end').click();
  await page.getByRole('button', { name: 'Предыдущая серия' }).click();
  expect(await scores.evaluateAll(nodes => nodes.filter(node => node.getAnimations().length).length)).toBe(0);
});
