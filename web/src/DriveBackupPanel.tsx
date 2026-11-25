import { useEffect, useState, useSyncExternalStore } from 'react';
import { autoBackupEnabled, backupToDrive, connectDrive, driveCopies, driveBackupState, loadDriveAuthorization, previewDriveCopy,
  setAutoBackup, subscribeDriveBackup } from './drive-backup.ts';
import type { WebArchivePreview } from './web-archive.ts';

export function DriveBackupPanel({ onPreview, disabled }: {
  onPreview: (load: () => Promise<WebArchivePreview>) => Promise<void>;
  disabled: boolean;
}) {
  const state = useSyncExternalStore(subscribeDriveBackup, driveBackupState);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState<Awaited<ReturnType<typeof driveCopies>>>();
  useEffect(() => {
    let live = true;
    void loadDriveAuthorization().then(() => { if (live) setReady(true); })
      .catch(cause => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (!state.connected) setCopies(undefined); }, [state.connected]);

  async function action(run: () => Promise<void>) {
    setBusy(true); setError('');
    try { await run(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция с Google Диском не завершилась.'); }
    finally { setBusy(false); }
  }
  return <section className="archive-panel" aria-label="Google Диск">
    <h2>Google Диск</h2>
    <button type="button" className="web-onboard-option" role="switch" aria-label="Автобэкап на Google Диск"
      aria-checked={autoBackupEnabled()} disabled={disabled}
      onClick={() => setAutoBackup(!autoBackupEnabled())}>
      <span>Автобэкап</span><span className="preference-switch" aria-hidden="true"><span /></span>
    </button>
    {state.connected ? <>
      {state.last && <p>Последняя копия · {new Date(state.last.createdTime).toLocaleString('ru-RU')}</p>}
      <div className="archive-actions">
        <button type="button" className="archive-action" disabled={disabled || busy || state.busy} onClick={() => void action(() => backupToDrive())}>Создать копию</button>
        <button type="button" className="archive-action" disabled={disabled || busy} onClick={() => {
          if (copies) setCopies(undefined);
          else void action(async () => setCopies(await driveCopies()));
        }} aria-expanded={!!copies}>Восстановить с Диска</button>
      </div>
      {state.message === 'Копии создаются на другом устройстве.' && <button type="button" className="archive-action" disabled={disabled || busy || state.busy}
        onClick={() => { if (window.confirm('Создавать новые копии с этого устройства? Проверь, что здесь актуальный дневник.')) void action(() => backupToDrive(true)); }}>Сделать это устройство источником</button>}
    </> : <button type="button" className="archive-action" disabled={disabled || !ready || busy}
      onClick={() => void action(connectDrive)}>
      {ready ? 'Подключить Google Диск' : error ? 'Вход Google недоступен' : 'Загружаем вход Google…'}
    </button>}
    {!state.connected && <p>Копии сохраняются в твоём Google-аккаунте. Подключи его, чтобы начать копирование или восстановить дневник.</p>}
    {copies?.length === 0 && <p>Копий пока нет.</p>}
    {copies?.map(file => <button key={file.id} type="button" className="archive-action" disabled={disabled || busy}
      onClick={() => void onPreview(() => previewDriveCopy(file))}>
      {new Date(file.createdTime).toLocaleString('ru-RU')} · {file.appProperties.trainings} трен.
    </button>)}
    {state.busy && <p role="status">Сохраняем копию…</p>}
    {(error || state.message) && <p role="status">{error || state.message}</p>}
  </section>;
}
