import { useEffect, useState, useSyncExternalStore } from 'react';
import { backupToDrive, driveCopies, driveBackupState, previewDriveCopy,
  setAutoBackup, subscribeDriveBackup } from './drive-backup.ts';
import { GoogleAccountButton } from './GoogleAccountButton.tsx';
import type { WebArchivePreview } from './web-archive.ts';

export function DriveBackupPanel({ onPreview, disabled }: {
  onPreview: (load: () => Promise<WebArchivePreview>) => Promise<void>;
  disabled: boolean;
}) {
  const state = useSyncExternalStore(subscribeDriveBackup, driveBackupState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState<Awaited<ReturnType<typeof driveCopies>>>();
  useEffect(() => { setCopies(undefined); }, [state.connected, state.account?.id]);

  async function action(run: () => Promise<void>) {
    setBusy(true); setError('');
    try { await run(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция с Google Диском не завершилась.'); }
    finally { setBusy(false); }
  }
  return <section className="archive-panel" aria-label="Google Диск">
    <h2>Google Диск</h2>
    <div className="preference-row">
      <span className="preference-title">Автобэкап</span>
      <button type="button" className="preference-switch" role="switch" aria-label="Автобэкап на Google Диск"
        aria-checked={state.autoBackup} onClick={() => {
          setError('');
          try { setAutoBackup(!state.autoBackup); }
          catch { setError('Не удалось сохранить настройку автобэкапа.'); }
        }}><span /></button>
    </div>
    {state.account?.name && <p>{state.account.name}</p>}
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
    </> : <GoogleAccountButton className="archive-action" label={state.account ? 'Подключить Google снова' : 'Подключить Google Диск'}
      disabled={disabled || busy} />}
    {!state.connected && <p>Для сохранения и восстановления копий подключи Google.</p>}
    {copies?.length === 0 && <p>Копий пока нет.</p>}
    {copies?.map(file => <button key={file.id} type="button" className="archive-action" disabled={disabled || busy}
      onClick={() => void onPreview(() => previewDriveCopy(file))}>
      {new Date(file.createdTime).toLocaleString('ru-RU')} · {file.appProperties.trainings} трен.
      {file.appProperties.archives !== 'excluded' && ' (в исходной копии)'}
    </button>)}
    {state.busy && <p role="status">Сохраняем копию…</p>}
    {(error || state.message) && <p role="status">{error || state.message}</p>}
  </section>;
}
