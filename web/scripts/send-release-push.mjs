import { pathToFileURL } from 'node:url';

const releaseTitleByCode = new Map([
  ['76', 'Не GTA 6, но тоже неплохо'],
  ['77', 'Как летающая тесла, только круче'],
  ['78', 'Папа, я в шторке!'],
]);
const releaseBody = 'Доступно обновление!';

export function releasePushMessage(release, { tag, code, commit, releaseId }) {
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag) ||
      typeof code !== 'string' || !/^[1-9]\d{0,9}$/.test(code) || Number(code) > 2_100_000_000 ||
      typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit) ||
      typeof releaseId !== 'string' || !/^[1-9]\d*$/.test(releaseId)) {
    throw new Error('Invalid expected release');
  }
  const apk = `FableShot-android-${code}.apk`;
  if (String(release?.id) !== releaseId || release.tag_name !== tag || release.target_commitish !== commit ||
      release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets) ||
      !release.assets.some(asset => asset?.name === apk && asset.state === 'uploaded' && asset.size > 0 &&
        asset.browser_download_url === `https://github.com/ovepfunkep/FableShot/releases/download/${tag}/${apk}`)) {
    throw new Error('Latest public release does not match the verified Android and Pages build');
  }
  const title = releaseTitleByCode.get(code) ?? 'В этот раз без креатива';
  // Version 75 can display a custom title through Android's background notification only.
  const showOnPreviousClient = code === '76';
  return {
    message: {
      topic: 'fableshot_stable_updates',
      data: { type: 'release', version: tag.slice(1), versionCode: code, title, body: releaseBody },
      ...(showOnPreviousClient && { notification: { title, body: releaseBody } }),
      android: {
        priority: 'normal', ttl: '259200s', collapse_key: 'fableshot_stable_updates',
        restricted_package_name: 'app.fableshot.android.react',
        ...(showOnPreviousClient && { notification: {
          channel_id: 'fableshot_updates', icon: 'fableshot_update_notification', tag: 'fableshot_stable_updates',
        } }),
      },
    },
  };
}

export async function sendReleasePush(env, request = fetch) {
  const { FCM_PROJECT_ID: project, FCM_ACCESS_TOKEN: access, GH_TOKEN: github,
    RELEASE_TAG: tag, RELEASE_CODE: code, GITHUB_SHA: commit, RELEASE_ID: releaseId } = env;
  if (typeof project !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) || !access || !github) {
    throw new Error('Release push credentials are unavailable');
  }
  const latest = await request('https://api.github.com/repos/ovepfunkep/FableShot/releases/latest', {
    headers: { authorization: `Bearer ${github}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000),
  });
  if (!latest.ok) throw new Error(`Could not verify GitHub release (HTTP ${latest.status})`);
  const message = releasePushMessage(await latest.json(), { tag, code, commit, releaseId });
  const sent = await request(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify(message), signal: AbortSignal.timeout(20_000),
  });
  if (!sent.ok) throw new Error(`FCM did not accept the message (HTTP ${sent.status})`);
  if (typeof (await sent.json()).name !== 'string') throw new Error('FCM response is missing the message ID');
  return tag;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const tag = await sendReleasePush(process.env);
    console.log(`FCM accepted the Android notification for ${tag}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
