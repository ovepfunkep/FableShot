import history from './web-release-history.json' with { type: 'json' };
import packageInfo from '../package.json' with { type: 'json' };

export const WEB_RELEASE_CODE = packageInfo.config.androidVersionCode;
export const WEB_RELEASE_VERSION = packageInfo.version;

type WebRelease = Readonly<{ code: number; version: string; title: string; highlights: readonly string[] }>;

const releases: readonly WebRelease[] = history;

export function webReleaseHistory(currentCode = WEB_RELEASE_CODE): WebRelease[] {
  return releases.filter(release => release.code <= currentCode);
}

export function pendingWebReleases(seen: number | null | undefined, currentCode = WEB_RELEASE_CODE): WebRelease[] {
  if (seen == null) return [];
  return webReleaseHistory(currentCode).filter(release => release.code > seen);
}
