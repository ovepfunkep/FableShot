import { archiveDigest, captureArchiveRecords, createWebArchive, inspectWebArchive, validateArchiveRecords, MAX_ARCHIVE_BYTES } from './web-archive.ts';
import packageInfo from '../package.json';
import { Capacitor, registerPlugin } from '@capacitor/core';

const scope = 'https://www.googleapis.com/auth/drive.appdata';
const files = 'https://www.googleapis.com/drive/v3/files';
const uploads = 'https://www.googleapis.com/upload/drive/v3/files';
const selection = 'id,size,createdTime,sha256Checksum,appProperties';
const clientId = import.meta.env.VITE_FABLESHOT_GOOGLE_CLIENT_ID?.trim();
const preferenceKey = 'app.fableshot.drive-backup.enabled';
const deviceKey = 'app.fableshot.drive-backup.device';
const connectedKey = 'app.fableshot.drive-backup.connected';
const backupWait = 60_000;
const backupInterval = 10 * 60_000;

type TokenResponse = { access_token?: string; expires_in?: number; scope?: string; error?: string };
type TokenClient = { requestAccessToken: () => void };
type IdentityServices = { accounts: { oauth2: { initTokenClient: (options: {
  client_id: string; scope: string; include_granted_scopes: boolean;
  callback: (reply: TokenResponse) => void; error_callback: () => void;
}) => TokenClient } } };
type DriveFile = { id: string; size: string; createdTime: string; sha256Checksum?: string;
  appProperties: { revision: string; device: string; trainings: string; arrows: string } };
type Connection = { token: string; expires: number };

const nativeAuthorization = registerPlugin<{ authorize(options: { interactive: boolean }): Promise<{ token?: string }> }>('DriveAuthorization');
const nativeDrive = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('DriveAuthorization');
export const driveBackupAvailable = nativeDrive || (!Capacitor.isNativePlatform() && !!clientId);
let connection: Connection | undefined;
let provider: IdentityServices | undefined;
let scriptLoad: Promise<IdentityServices> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let expiration: ReturnType<typeof setTimeout> | undefined;
let lastAttempt = 0;
let inFlight: Promise<void> | undefined;
let controller: AbortController | undefined;
let reconnecting = false;
let state = { connected: false, busy: false, last: undefined as DriveFile | undefined, message: '' };
const listeners = new Set<() => void>();
export const subscribeDriveBackup = (update: () => void) => { listeners.add(update); return () => { listeners.delete(update); }; };
export const driveBackupState = () => state;
const updateState = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const autoBackupEnabled = () => localStorage.getItem(preferenceKey) !== 'false';
export function setAutoBackup(enabled: boolean) {
  localStorage.setItem(preferenceKey, String(enabled));
  if (enabled) scheduleDriveBackup(0);
  else { clearTimeout(timer); controller?.abort(); }
  updateState({ message: '' });
}

function disconnect() {
  connection = undefined;
  clearTimeout(timer);
  clearTimeout(expiration);
  controller?.abort();
  updateState({ connected: false, last: undefined, message: '' });
}

export function loadDriveAuthorization() {
  if (nativeDrive || provider) return Promise.resolve();
  if (!driveBackupAvailable) return Promise.reject(new Error('Google Диск ещё не подключён к этой сборке.'));
  if (!scriptLoad) scriptLoad = new Promise<IdentityServices>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => {
      const google = (window as Window & { google?: IdentityServices }).google;
      if (!google?.accounts.oauth2) { script.remove(); reject(new Error('Не удалось загрузить вход Google.')); return; }
      provider = google;
      resolve(google);
    };
    script.onerror = () => { script.remove(); reject(new Error('Не удалось загрузить вход Google. Проверь сеть.')); };
    document.head.append(script);
  }).catch(error => { scriptLoad = undefined; throw error; });
  return scriptLoad.then(() => {});
}

function openConnection(token: string, lifetime: number) {
  clearTimeout(expiration);
  connection = { token, expires: Date.now() + lifetime };
  expiration = setTimeout(() => {
    disconnect();
    void resumeDriveBackup();
  }, lifetime);
  lastAttempt = 0;
  updateState({ connected: true, last: undefined, message: '' });
  scheduleDriveBackup(0);
}

export async function resumeDriveBackup() {
  if (!nativeDrive || connection || reconnecting || !autoBackupEnabled() ||
    !navigator.onLine || document.visibilityState !== 'visible' || localStorage.getItem(connectedKey) !== 'true') return;
  reconnecting = true;
  try {
    const { token } = await nativeAuthorization.authorize({ interactive: false });
    if (token && autoBackupEnabled()) openConnection(token, 50 * 60_000);
  } catch {
    // Keep the previous connection preference so a transient network error can be retried.
  } finally { reconnecting = false; }
}

/** Call from a click after preloading the Google library. Keep the short-lived token in memory. */
export async function connectDrive() {
  if (nativeDrive) {
    const { token } = await nativeAuthorization.authorize({ interactive: true });
    if (!token) throw new Error('Google не выдал доступ к папке резервных копий.');
    localStorage.setItem(connectedKey, 'true');
    openConnection(token, 50 * 60_000);
    return;
  }
  if (!provider || !clientId) return Promise.reject(new Error('Вход Google ещё загружается.'));
  return new Promise<void>((resolve, reject) => provider!.accounts.oauth2.initTokenClient({
    client_id: clientId, scope, include_granted_scopes: false,
    error_callback: () => reject(new Error('Подключение Google Диска не завершено.')),
    callback: reply => {
      if (reply.error === 'access_denied') {
        reject(new Error('Google не разрешил доступ. Если FableShot в режиме тестирования, выбери аккаунт из списка тестировщиков.'));
        return;
      }
      if (reply.error || !reply.access_token || !reply.expires_in || !reply.scope?.split(' ').includes(scope)) {
        reject(new Error('Google не выдал доступ к папке резервных копий.'));
        return;
      }
      const lifetime = Math.max(0, Number(reply.expires_in) * 1000 - 30_000);
      openConnection(reply.access_token, lifetime);
      resolve();
    },
  }).requestAccessToken());
}

async function driveRequest(session: Connection, url: URL | string, init: RequestInit = {}) {
  if (connection !== session || Date.now() >= session.expires) throw new Error('Подключи Google Диск снова.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer ' + session.token);
  const timeout = AbortSignal.timeout(init.method === 'PUT' ? 180_000 : 30_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await fetch(url, { ...init, headers, signal });
  if (response.status === 401 && connection === session) disconnect();
  if (!response.ok) throw new Error(response.status === 401 ? 'Подключи Google Диск снова.' : 'Google Диск ответил ошибкой (' + response.status + ').');
  return response;
}

async function list(session: Connection) {
  const url = new URL(files);
  url.searchParams.set('spaces', 'appDataFolder');
  url.searchParams.set('q', "trashed = false and appProperties has { key='kind' and value='fableshot-backup-v1' }");
  url.searchParams.set('orderBy', 'createdTime desc');
  url.searchParams.set('fields', 'nextPageToken,files(' + selection + ')');
  const result: DriveFile[] = [];
  const seen = new Set<string>();
  for (;;) {
    const reply = await (await driveRequest(session, url)).json() as { files: DriveFile[]; nextPageToken?: string };
    result.push(...reply.files);
    if (!reply.nextPageToken) return result;
    if (seen.has(reply.nextPageToken)) throw new Error('Не удалось дочитать список копий.');
    seen.add(reply.nextPageToken);
    url.searchParams.set('pageToken', reply.nextPageToken);
  }
}

function deviceId() {
  let id = localStorage.getItem(deviceKey);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(deviceKey, id); }
  return id;
}

async function upload(session: Connection, bytes: Uint8Array, metadata: Record<string, string>, signal: AbortSignal) {
  const url = new URL(uploads);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('fields', selection);
  const open = await driveRequest(session, url, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(bytes.length),
  }, body: JSON.stringify({ name: 'FableShot-' + new Date().toISOString() + '.zip', parents: ['appDataFolder'], appProperties: metadata }), signal });
  const location = open.headers.get('Location');
  if (!location || new URL(location).origin !== 'https://www.googleapis.com') throw new Error('Google Диск не открыл загрузку.');
  const response = await driveRequest(session, location, {
    method: 'PUT', headers: { 'Content-Type': 'application/zip', 'Content-Range': 'bytes 0-' + (bytes.length - 1) + '/' + bytes.length },
    body: new Uint8Array(bytes), signal,
  });
  const file = await response.json() as DriveFile;
  if (file.sha256Checksum !== await archiveDigest(bytes) || Number(file.size) !== bytes.length) {
    throw new Error('Google Диск не подтвердил контрольную сумму копии.');
  }
  return file;
}

export function backupToDrive(takeOver = false) {
  if (inFlight) return inFlight;
  const session = connection;
  if (!session || !navigator.onLine) return Promise.reject(new Error('Для копирования нужен доступ к Google Диску и интернет.'));
  const abort = new AbortController();
  controller = abort;
  updateState({ busy: true, message: '' });
  lastAttempt = Date.now();
  inFlight = (async () => {
    const records = captureArchiveRecords();
    const summary = validateArchiveRecords(records);
    const catalog = await list(session);
    const head = catalog[0];
    if (connection !== session) return;
    updateState({ last: head });
    if (!summary.trainings && head && Number(head.appProperties.trainings)) {
      updateState({ message: 'На Диске есть дневник. Сначала восстанови его из копии.' }); return;
    }
    const id = deviceId();
    if (head && head.appProperties.device !== id && !takeOver) {
      updateState({ message: 'Копии создаются на другом устройстве.' }); return;
    }
    const revision = await archiveDigest(new TextEncoder().encode(JSON.stringify(records)));
    if (head?.appProperties.revision === revision && head.appProperties.device === id) return;
    const bytes = await createWebArchive(records, packageInfo.version);
    abort.signal.throwIfAborted();
    if ((await list(session))[0]?.id !== head?.id) throw new Error('На Диске появилась более свежая копия. Повтори действие.');
    abort.signal.throwIfAborted();
    const copy = await upload(session, bytes, { kind: 'fableshot-backup-v1', revision, device: id,
      trainings: String(summary.trainings), arrows: String(summary.arrows) }, abort.signal);
    if (connection === session) updateState({ last: copy });
    // Only prune known versions after a newer archive has passed checksum verification.
    for (const old of catalog.slice(2)) {
      await driveRequest(session, files + '/' + encodeURIComponent(old.id), { method: 'DELETE', signal: abort.signal });
    }
  })().catch(error => {
    if (!abort.signal.aborted && connection === session) updateState({ message: error instanceof Error ? error.message : 'Не удалось создать копию.' });
  }).finally(() => {
    controller = undefined; inFlight = undefined;
    updateState({ busy: false });
  });
  return inFlight;
}

export function scheduleDriveBackup(delay = backupWait) {
  if (!connection || !autoBackupEnabled() || !navigator.onLine) return;
  clearTimeout(timer);
  timer = setTimeout(() => void backupToDrive().catch(() => {}), Math.max(delay, lastAttempt + backupInterval - Date.now()));
}

export async function driveCopies() {
  if (!connection) throw new Error('Подключи Google Диск.');
  return list(connection);
}

export async function previewDriveCopy(file: DriveFile) {
  const session = connection;
  if (!session) throw new Error('Подключи Google Диск.');
  const size = Number(file.size);
  if (!file.sha256Checksum || !Number.isSafeInteger(size) || size < 1 || size > MAX_ARCHIVE_BYTES) throw new Error('Неверный размер или контрольная сумма архива.');
  const response = await driveRequest(session, files + '/' + encodeURIComponent(file.id) + '?alt=media');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== size || await archiveDigest(bytes) !== file.sha256Checksum) throw new Error('Копия на Диске повреждена.');
  return inspectWebArchive(bytes);
}
