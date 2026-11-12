import { Capacitor, registerPlugin } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';

const repository = 'ovepfunkep/FableShot';
const downloadRoot = `https://github.com/${repository}/releases/download/`;
const endpoint = `https://api.github.com/repos/${repository}/releases/latest`;
const lastCheckKey = 'app.fableshot.android-update-check.v1';
const day = 86_400_000;
const bridge = registerPlugin<{
  installedVersion(): Promise<{ production: boolean; code: number }>;
  openDownload(options: { url: string }): Promise<void>;
}>('AndroidUpdates');

type Update = { version: string; code: number; notes: string; url: string };
type Release = { tag_name?: unknown; draft?: unknown; prerelease?: unknown; body?: unknown; assets?: unknown };

export function readAndroidUpdate(value: unknown, installed: number): Update | null {
  if (!value || typeof value !== 'object') return null;
  const release = value as Release;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' ||
      !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) return null;
  let latest: Update | null = null;
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

export function useAndroidUpdates() {
  const [installed, setInstalled] = useState<number | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(0);
  const running = useRef(false);
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('AndroidUpdates')) return;
    let active = true;
    void bridge.installedVersion().then(info => { if (active && info.production) setInstalled(info.code); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const check = useCallback(async (manual: boolean) => {
    if (installed === null || running.current) return;
    if (navigator.onLine === false) {
      if (manual) setStatus('Для проверки обновлений нужен интернет.');
      return;
    }
    let stored = 0;
    try { stored = Number(localStorage.getItem(lastCheckKey)) || 0; } catch { /* Use the in-memory timestamp. */ }
    const now = Date.now(), last = Math.max(lastAttempt.current, stored);
    if (!manual && now >= last && now - last < day) return;
    running.current = true;
    lastAttempt.current = now;
    try { localStorage.setItem(lastCheckKey, String(now)); } catch { /* Storage is optional for the check. */ }
    if (manual) { setChecking(true); setStatus('Проверяю обновления…'); setDismissed(0); }
    try {
      const response = await fetch(endpoint, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok && response.status !== 404) throw new Error('GitHub недоступен');
      const next = response.status === 404 ? null : readAndroidUpdate(await response.json(), installed);
      setUpdate(next);
      if (manual) setStatus(next ? '' : 'Обновлений для Android пока нет.');
    } catch {
      if (manual) setStatus('Не удалось проверить обновления. Попробуй позже.');
    } finally {
      running.current = false;
      if (manual) setChecking(false);
    }
  }, [installed]);

  useEffect(() => {
    if (installed === null) return;
    const automatic = () => { void check(false); };
    const timer = window.setTimeout(automatic, 1200);
    const onVisible = () => { if (document.visibilityState === 'visible') automatic(); };
    window.addEventListener('online', automatic);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer); window.removeEventListener('online', automatic);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check, installed]);

  async function download() {
    if (!update) return;
    try { await bridge.openDownload({ url: update.url }); }
    catch { setStatus('Не удалось открыть загрузку APK.'); }
  }

  return { available: installed !== null, update, status, checking, check: () => void check(true), download,
    announce: !!update && update.code !== dismissed, dismiss: () => setDismissed(update?.code ?? 0) };
}
