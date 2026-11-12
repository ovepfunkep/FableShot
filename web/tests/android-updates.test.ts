import assert from 'node:assert/strict';
import { test } from 'node:test';
import { androidUpdateNotes, readAndroidUpdate } from '../src/android-updates.ts';

const apk = (code: number) => ({
  name: `FableShot-android-${code}.apk`,
  state: 'uploaded',
  browser_download_url: `https://github.com/ovepfunkep/FableShot/releases/download/v0.26.1/FableShot-android-${code}.apk`,
});
const release = { tag_name: 'v0.26.1', draft: false, prerelease: false, body: 'Подробный PDF', assets: [apk(32), apk(33)] };

test('Android updates compare version codes and pick the highest production APK', () => {
  assert.deepEqual(readAndroidUpdate(release, 32), {
    version: '0.26.1', code: 33, notes: 'Подробный PDF', url: apk(33).browser_download_url,
  });
  assert.equal(readAndroidUpdate(release, 33), null);
});

test('Android updates ignore prereleases, draft releases and mismatched APK URLs', () => {
  for (const candidate of [
    { ...release, prerelease: true },
    { ...release, draft: true },
    { ...release, tag_name: 'v0.26.1-rc1' },
    { ...release, assets: [{ ...apk(33), browser_download_url: 'https://example.com/FableShot-android-33.apk' }] },
    { ...release, assets: [{ ...apk(33), name: 'FableShot-Web-pilot.apk' }] },
  ]) assert.equal(readAndroidUpdate(candidate, 32), null);
});

test('Android update notes cover only important releases after the installed code and through the target code', () => {
  const update = { code: 45, version: '0.30.0', notes: 'Только текст последнего релиза', url: '' };
  const history = [
    { code: 46, highlights: ['Будущая версия'] },
    { code: 45, highlights: ['Новый экран', 'Повтор'] },
    { code: 44, highlights: ['Повтор', 'Пропущенное обновление'] },
    { code: 43, highlights: ['Уже установлено'] },
    { code: 44.5, highlights: ['Неверный номер'] },
    { code: 44, highlights: [null] },
  ];
  assert.deepEqual(androidUpdateNotes(43, update, history), {
    highlights: ['Новый экран', 'Повтор', 'Пропущенное обновление'], fallback: '',
  });
  assert.deepEqual(androidUpdateNotes(44, update, []), { highlights: [], fallback: '' });
});

test('older releases still use known intermediate milestones when the tagged history is unavailable', () => {
  const legacy = { code: 42, version: '0.29.0', notes: 'Последний релиз', url: '' };
  const notes = androidUpdateNotes(35, legacy);
  assert.ok(notes.highlights.some(text => text.includes('Таймер')));
  assert.ok(notes.highlights.some(text => text.includes('разрядном уровне')));
  assert.ok(notes.highlights.every(text => !text.includes('Подробный отчёт A4')));
  assert.equal(notes.fallback, '');
  assert.equal(androidUpdateNotes(43, { ...legacy, code: 45 }).fallback, legacy.notes);
});
