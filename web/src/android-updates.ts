import { Capacitor, registerPlugin } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pendingWebReleases } from './web-releases.ts';

const repository = 'ovepfunkep/FableShot';
const downloadRoot = `https://github.com/${repository}/releases/download/`;
const endpoint = `https://api.github.com/repos/${repository}/releases/latest`;
const bridge = registerPlugin<{
  installedVersion(): Promise<{ production: boolean; code: number }>;
  openDownload(options: { url: string }): Promise<void>;
}>('AndroidUpdates');

export type AndroidUpdate = { version: string; code: number; notes: string; url: string };
type Release = { tag_name?: unknown; draft?: unknown; prerelease?: unknown; body?: unknown; assets?: unknown };

export function readAndroidUpdate(value: unknown, installed: number): AndroidUpdate | null {
  if (!value || typeof value !== 'object') return null;
  const release = value as Release;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' ||
      !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) return null;
  let latest: AndroidUpdate | null = null;
  for (const asset of release.assets) {
    if (!asset || typeof asset.name !== 'string' || asset.state !== 'uploaded') continue;
    const match = /^FableShot-android-([1-9]\d*)\.apk$/.exec(asset.name);
    if (!match) continue;
    const code = Number(match[1]);
    const url = `${downloadRoot}${release.tag_name}/${asset.name}`;
    if (!Number.isSafeInteger(code) || code > 2_100_000_000 || code <= (latest?.code ?? installed) || asset.browser_download_url !== url) continue;
    latest = { code, url, version: release.tag_name.slice(1), notes: typeof release.body === 'string' ? release.body.trim().slice(0, 2500) : '' };
  }
  return latest;
}

export async function fetchAndroidUpdateHistory(version: string, signal: AbortSignal): Promise<unknown> {
  const url = `https://api.github.com/repos/${repository}/contents/web/src/web-release-history.json?ref=v${version}`;
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github.raw+json' }, signal });
  if (!response.ok) throw new Error('История обновлений недоступна.');
  return response.json();
}

export function androidUpdateNotes(installed: number, update: AndroidUpdate, history?: unknown) {
  const changes = new Map(pendingWebReleases(installed, update.code).map(release => [release.code, release.highlights]));
  if (Array.isArray(history)) {
    for (const entry of history) {
      if (!entry || !Number.isSafeInteger(entry.code) || entry.code <= installed || entry.code > update.code ||
        !Array.isArray(entry.highlights) || !entry.highlights.length ||
        !entry.highlights.every((text: unknown) => typeof text === 'string' && text.trim().length > 0)) continue;
      changes.set(entry.code, entry.highlights);
    }
  }
  const highlights = [...new Set([...changes].sort(([left], [right]) => right - left).flatMap(([, items]) => items))];
  return { highlights, fallback: !changes.has(update.code) && !Array.isArray(history) ? update.notes : '' };
}

export function useAndroidUpdates(homeActive: boolean) {
  const [installed, setInstalled] = useState<number | null>(null);
  const [update, setUpdate] = useState<AndroidUpdate | null>(null);
  const [status, setStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(0);
  const pending = useRef<Promise<AndroidUpdate | null> | null>(null);

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('AndroidUpdates')) return;
    let active = true;
    void bridge.installedVersion().then(info => { if (active && info.production) setInstalled(info.code); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const check = useCallback(async (manual: boolean) => {
    if (installed === null) return;
    if (navigator.onLine === false) {
      if (manual) setStatus('Для проверки обновлений нужен интернет.');
      return;
    }
    if (manual) { setChecking(true); setStatus('Проверяю обновления…'); setDismissed(0); }
    const request = pending.current ??= (async () => {
      const response = await fetch(endpoint, { cache: 'no-cache', headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000) });
      if (!response.ok && response.status !== 404) throw new Error('GitHub недоступен');
      const next = response.status === 404 ? null : readAndroidUpdate(await response.json(), installed);
      setUpdate(next);
      return next;
    })().finally(() => { pending.current = null; });
    try {
      const next = await request;
      if (manual) setStatus(next ? '' : 'Обновлений для Android пока нет.');
    } catch {
      if (manual) setStatus('Не удалось проверить обновления. Попробуй позже.');
    } finally {
      if (manual) setChecking(false);
    }
  }, [installed]);

  useEffect(() => {
    if (installed === null || !homeActive) return;
    const automatic = () => { if (document.visibilityState === 'visible') void check(false); };
    automatic();
    window.addEventListener('online', automatic);
    document.addEventListener('visibilitychange', automatic);
    return () => {
      window.removeEventListener('online', automatic);
      document.removeEventListener('visibilitychange', automatic);
    };
  }, [check, homeActive, installed]);

  async function download() {
    if (!update) return false;
    try { await bridge.openDownload({ url: update.url }); return true; }
    catch { return false; }
  }

  return { available: installed !== null, installed, update, status, checking, check: () => void check(true), download,
    announce: !!update && update.code !== dismissed, dismiss: () => setDismissed(update?.code ?? 0) };
}
