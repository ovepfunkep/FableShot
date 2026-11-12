import { expect, test } from '@playwright/test';
import { appendShot, completePractice, emptyPractice } from '../src/practice.ts';

test('notebook creates and deletes standalone notes while preserving hidden data after reload', async ({ page }) => {
  const now = Date.parse('2026-11-11T09:00:00Z');
  const base = { localDate: '2026-11-11', tags: ['стойка'], place: '', feeling: '', conditions: '', createdAtMs: now, updatedAtMs: now };
  const practice = completePractice(appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } }), '2026-11-11T10:00:00Z');
  const diary = { version: 1, notes: [{ ...base, id: 'archived', body: 'Старая мысль', deletedAtMs: now + 1 }],
    entries: [{ id: 'source', startedAt: '2026-11-11T09:00:00Z', title: 'Урок тренера', practice,
      notes: [{ ...base, id: 'linked', body: 'Плечи спокойно' }] }] };
  await page.addInitScript(diary => {
    const key = 'app.fableshot.practice-diary.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(diary));
  }, diary);
  async function open() {
    await page.getByTestId('open-profile').click();
    await page.getByTestId('profile-notebook').click();
  }
  await page.goto('./');
  await open();
  await page.getByTestId('notebook-search').fill('#стойка');
  await expect(page.getByTestId('notebook-item')).toHaveCount(1);
  await expect(page.getByTestId('notebook-item')).toContainText('Плечи спокойно');
  await page.getByTestId('notebook-source').click();
  await expect(page.getByTestId('journal-report')).toContainText('Урок тренера');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('notebook-screen')).toBeVisible();
  await page.getByTestId('notebook-add').click();
  await page.getByTestId('note-body').fill('Выдох перед выстрелом');
  await page.getByTestId('note-tags').fill('дыхание');
  await page.getByTestId('note-save').click();
  await page.getByTestId('notebook-search').fill('выдох');
  const item = page.getByTestId('notebook-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Отдельная запись');
  await item.getByRole('button').click();
  await page.getByTestId('note-delete').click();
  await page.getByTestId('note-delete-confirm').click();
  await expect(page.getByTestId('notebook-item')).toHaveCount(0);
  await page.reload();
  await open();
  await page.getByTestId('notebook-search').fill('выдох');
  await expect(page.getByTestId('notebook-item')).toHaveCount(0);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!));
  expect(restored.entries[0].notes).toHaveLength(1);
  expect(restored.notes).toHaveLength(2);
  expect(restored.notes.find((note: { id: string }) => note.id === 'archived').deletedAtMs).toBe(now + 1);
});
