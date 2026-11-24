import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releasePushMessage, sendReleasePush } from '../scripts/send-release-push.mjs';

const expected = { tag: 'v0.30.30', code: '74', commit: 'a'.repeat(40), releaseId: '77' };
const published = { id: 77, tag_name: expected.tag, target_commitish: expected.commit, draft: false, prerelease: false,
  assets: [{ name: 'FableShot-android-74.apk', state: 'uploaded', size: 100,
    browser_download_url: 'https://github.com/ovepfunkep/FableShot/releases/download/v0.30.30/FableShot-android-74.apk' }],
};
const env = { FCM_PROJECT_ID: 'fableshot-test', FCM_ACCESS_TOKEN: 'fixture-access', GH_TOKEN: 'fixture-github',
  RELEASE_ID: expected.releaseId, RELEASE_TAG: expected.tag, RELEASE_CODE: expected.code, GITHUB_SHA: expected.commit };

test('only the matching stable release can produce an Android update notification', () => {
  const { message } = releasePushMessage(published, expected);
  assert.equal(message.topic, 'fableshot_stable_updates');
  assert.deepEqual(message.data, { type: 'release', version: '0.30.30', versionCode: '74' });
  for (const change of [{ draft: true }, { prerelease: true }, { id: 78 }, { tag_name: 'v0.30.31' }, { assets: [] },
    { target_commitish: 'b'.repeat(40) }, { assets: [{ ...published.assets[0], browser_download_url: 'https://example.com/app.apk' }] }]) {
    assert.throws(() => releasePushMessage({ ...published, ...change }, expected), /does not match/);
  }
});

test('release notification sends exactly once after verification and reports refusals', async () => {
  const calls: string[] = [];
  const request = async (url: string, options: RequestInit) => {
    calls.push(url);
    if (calls.length === 1) return Response.json(published);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(String(options.body)), releasePushMessage(published, expected));
    return Response.json({ name: 'projects/fableshot-test/messages/1' });
  };
  assert.equal(await sendReleasePush(env, request), expected.tag);
  assert.equal(calls.length, 2);
  assert.equal(calls.at(-1), 'https://fcm.googleapis.com/v1/projects/fableshot-test/messages:send');
  await assert.rejects(sendReleasePush(env, async url => url.includes('api.github.com')
    ? Response.json(published) : new Response(null, { status: 403 })), /HTTP 403/);
  await assert.rejects(sendReleasePush(env, async url => {
    assert.ok(url.includes('api.github.com'));
    return Response.json({ ...published, draft: true });
  }), /does not match/);
});
