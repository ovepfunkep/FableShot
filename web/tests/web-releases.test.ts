import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WEB_RELEASE_CODE, pendingWebReleases, webReleaseHistory } from '../src/web-releases.ts';

test('a known older web version receives every skipped important milestone, newest first', () => {
  const pending = pendingWebReleases(13, 17);
  assert.deepEqual(pending.map(release => release.code), [17, 16, 15, 14]);
  assert.ok(pending.every(release => release.highlights.length > 0));
  assert.deepEqual(pendingWebReleases(15, 17).map(release => release.code), [17, 16]);
});

test('a fresh profile, unreadable preferences and an acknowledged update do not show a popup', () => {
  assert.deepEqual(pendingWebReleases(undefined, 17), []);
  assert.deepEqual(pendingWebReleases(null, 17), []);
  assert.deepEqual(pendingWebReleases(17, 17), []);
  assert.deepEqual(pendingWebReleases(17, 16), []);
});

test('release notes and manual history exclude milestones newer than the running build', () => {
  assert.deepEqual(webReleaseHistory(15).map(release => release.code), [15, 14, 13]);
  assert.deepEqual(pendingWebReleases(13, 15).map(release => release.code), [15, 14]);
  assert.ok(webReleaseHistory().every(release => release.code <= WEB_RELEASE_CODE));
});
