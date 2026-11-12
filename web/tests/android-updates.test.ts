import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAndroidUpdate } from '../src/android-updates.ts';

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
