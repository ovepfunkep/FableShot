import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { DATA_KEYS } from './app-storage.ts';
import type { DataRecords } from './app-storage.ts';
import { exportDocument } from './document-export.ts';
import { DIARY_KEY, loadDiary } from './persistence.ts';
import { Icon } from './TrainingChrome.tsx';
import { SettingsAction } from './SettingsScreen.tsx';
import { archiveDigest, captureArchiveState, createWebArchive, inspectWebArchive, lastRecovery, MAX_ARCHIVE_BYTES, preserveArchiveSource, projectArchivePreview, projectArchiveRecords, replaceArchiveRecords, saveArchiveRecovery } from './web-archive.ts';
import type { ArchiveSummary, WebArchivePreview } from './web-archive.ts';
import type { NativeConversion } from './native-conversion.ts';
import type { buildNativeRecords } from './native-activation.ts';
import packageInfo from '../package.json';
import { pickAndroidArchive, usesAndroidArchivePicker } from './archive-picker.ts';
import { DriveBackupPanel } from './DriveBackupPanel.tsx';
import { backupIncludesArchived, driveBackupAvailable, setBackupIncludesArchived } from './drive-backup.ts';
import './archive-screen.css';

function Summary({ summary }: { summary: ArchiveSummary }) {
  return <dl className="archive-counts">
    <div><dt>Тренировки</dt><dd>{summary.trainings}</dd></div><div><dt>Стрелы</dt><dd>{summary.arrows}</dd></div>
    <div><dt>Луки / наборы стрел</dt><dd>{summary.bows} / {summary.arrowSets}</dd></div>
    <div><dt>Комплекты / памятки</dt><dd>{summary.kits} / {summary.techniques}</dd></div>
    {summary.notes > 0 && <><div><dt>Заметки</dt><dd>{summary.notes}</dd></div>
      <div><dt>Заметки в архиве</dt><dd>{summary.archivedNotes}</dd></div></>}
  </dl>;
}

export function ArchiveScreen({ onBack, onAchievement, restoreFirst = false }: { onBack: () => void; restoreFirst?: boolean; onAchievement?: (id: 'MIND08') => void }) {
  const [preview, setPreview] = useState<WebArchivePreview | null>(null);
  const [includeArchived, setIncludeArchived] = useState(backupIncludesArchived);
  const [restoreArchived, setRestoreArchived] = useState(false);
  const [confirmedPreview, setConfirmedPreview] = useState<WebArchivePreview | null>(null);
  const [hasAndroidSource, setHasAndroidSource] = useState(false);
  const [nativePreview, setNativePreview] = useState<{ conversion: NativeConversion; bytes: Uint8Array; projection: ReturnType<typeof buildNativeRecords> } | null>(null);
  const [expected, setExpected] = useState<ReturnType<typeof captureArchiveState> | null>(null);
  const [confirm, setConfirm] = useState<'restore' | 'reset' | 'recovery' | 'native' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [resetComplete, setResetComplete] = useState(false);
  const [recovery, setRecovery] = useState<ReturnType<typeof lastRecovery>>(null);
  const alive = useRef(false);
  const running = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    try { setRecovery(lastRecovery()); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось прочитать резервную копию.'); }
    try { setHasAndroidSource(!!loadDiary().nativeArchive); } catch { /* A damaged diary can still be restored. */ }
    return () => { alive.current = false; };
  }, []);
  const fullPreview = useMemo(() => preview && projectArchivePreview(preview, true), [preview]);
  const activePreview = useMemo(() => preview && projectArchivePreview(preview, false), [preview]);
  const shownPreview = restoreArchived ? fullPreview : activePreview;
  const canRestoreArchived = fullPreview && activePreview &&
    DATA_KEYS.some(key => fullPreview.records[key] !== activePreview.records[key]);

  async function action(run: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setStatus('');
    try { await run(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Операция не завершена. Исходный дневник сохранён.'); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    await action(() => checkFile(file));
  }
  async function chooseArchive() {
    if (!usesAndroidArchivePicker()) { picker.current?.click(); return; }
    await action(async () => {
      const file = await pickAndroidArchive();
      if (file) await checkFile(file);
    });
  }
  async function checkFile(file: File) {
    setPreview(null); setConfirmedPreview(null); setNativePreview(null); setExpected(null); setRestoreArchived(false);
    if (!file.size) throw new Error('Выбранный файл пуст. Сохрани копию на телефон и выбери её повторно.');
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Размер резервной копии должен быть не больше 76 МБ.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const original = captureArchiveState(true);
    {
      try {
        const candidate = await inspectWebArchive(bytes);
        if (alive.current) { setPreview(candidate); setExpected(original); }
        return;
      } catch {
        // The shared picker accepts both formats. Each verifier still performs
        // its complete validation before any preview or replacement is allowed.
      }
    }
    {
      const { inspectNativeArchive, MAX_NATIVE_ARCHIVE_BYTES } = await import('./native-archive.ts');
      if (file.size > MAX_NATIVE_ARCHIVE_BYTES) throw new Error('Архив Android должен быть не больше 64 МБ.');
      const { buildNativeConversion } = await import('./native-conversion.ts');
      let conversion: NativeConversion;
      try {
        conversion = buildNativeConversion(await inspectNativeArchive(bytes));
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        throw new Error(code === 'unsupported_archive_version' ? 'Версия архива Android пока не поддерживается.'
          : 'Не удалось проверить содержимое архива Android. Проверь, что это полный архив FableShot.', { cause });
      }
      const { buildNativeRecords } = await import('./native-activation.ts');
      const projection = buildNativeRecords(conversion, { sha256: await archiveDigest(bytes), bytes: bytes.length });
      if (alive.current) { setNativePreview({ conversion, bytes, projection }); setExpected(original); }
      return;
    }
  }
  async function download(records: DataRecords) {
    const bytes = await createWebArchive(records, packageInfo.version);
    if (!alive.current) return false;
    return (await exportDocument({ bytes, mimeType: 'application/zip', name: backupFilename(), saveOnly: true })).saved;
  }
  async function saveBackup() {
    await action(async () => {
      const current = captureArchiveState();
      const bytes = await createWebArchive(projectArchiveRecords(current.records, includeArchived), packageInfo.version);
      if (!alive.current) return;
      // Keep a verified local copy even if the system download is later cancelled.
      await saveArchiveRecovery(current);
      setRecovery(lastRecovery());
      const result = await exportDocument({ bytes, mimeType: 'application/zip', name: backupFilename(), saveOnly: true });
      if (alive.current) setStatus(result.saved ? 'Резервная копия сохранена в файл.' : 'Файл не сохранён. Копия на этом устройстве готова.');
      if (result.saved) {
        try { onAchievement?.('MIND08'); }
        catch (cause) { if (alive.current) setError(`Копия сохранена. ${cause instanceof Error ? cause.message : 'Не удалось сохранить достижение.'}`); }
      }
    });
  }
  async function apply() {
    const operation = confirm;
    await action(async () => {
      const current = operation === 'restore' || operation === 'native' ? expected : captureArchiveState(operation === 'recovery');
      if (!current) throw new Error('Сначала выбери резервную копию.');
      let records: DataRecords;
      let source: Uint8Array | undefined;
      if (operation === 'restore' && confirmedPreview) { records = confirmedPreview.records; source = confirmedPreview.nativeSource; }
      else if (operation === 'native' && nativePreview) { records = nativePreview.projection.records; source = nativePreview.bytes; }
      else if (operation === 'recovery' && recovery) records = recovery.records;
      else if (operation === 'reset') {
        if (!await download(projectArchiveRecords(current.records, true))) { setStatus('Сброс отменён.'); setConfirm(null); return; }
        records = Object.fromEntries(DATA_KEYS.map(key => [key, null]));
        records[DIARY_KEY] = JSON.stringify({ version: 1, entries: [] });
      } else throw new Error('Выбери действие заново.');
      await preserveArchiveSource(records, source);
      if (!alive.current) return;
      await replaceArchiveRecords(records, current);
      if (operation === 'reset') {
        // Keep this document alive while the browser consumes the backup Blob.
        setResetComplete(true);
        return;
      }
      window.location.reload();
    });
  }
  if (resetComplete) return <main className="conditions-page" data-testid="account-reset-complete">
    <div className="conditions-content archive-content"><h1>Профиль обнулён</h1>
      <p>Резервная копия сохранена. Дневник можно восстановить в настройках.</p>
      <button type="button" className="archive-action" data-testid="account-reset-finish" onClick={() => window.location.reload()}>На главную</button>
    </div>
  </main>;
  return <main className="conditions-page settings-page" data-testid="archive-screen">
    <header className="topbar"><button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button><h1>Резервная копия</h1></header>
    <div className="conditions-content archive-content">
      {restoreFirst && <p className="archive-caption">Перед восстановлением можно сверить тренировки и стрелы.</p>}
      {(!restoreFirst || driveBackupAvailable) && <section className="archive-panel" aria-label="Состав резервной копии">
        <div className="preference-row">
          <span className="preference-title">Сохранить архивированные данные?</span>
          <button type="button" className="preference-switch" role="switch" aria-label="Сохранить архивированные данные?"
            disabled={busy} aria-checked={includeArchived} onClick={() => {
              setError('');
              try { setBackupIncludesArchived(!includeArchived); setIncludeArchived(!includeArchived); }
              catch { setError('Не удалось сохранить настройку резервной копии.'); }
            }}><span /></button>
        </div>
        <p>Тумблер добавляет в файл и копии на Диске корзину, архивные памятки и снаряжение.</p>
        {hasAndroidSource && !includeArchived &&
          <p>Исходный ZIP Android останется на этом устройстве. Старые версии FableShot, которым требуется этот ZIP для чтения перенесённых тренировок, не откроют новую копию.</p>}
      </section>}
      {driveBackupAvailable && <DriveBackupPanel disabled={busy} onPreview={load => action(async () => {
        setPreview(null);
        setConfirmedPreview(null);
        setNativePreview(null);
        setExpected(null);
        setRestoreArchived(false);
        const original = captureArchiveState(true);
        const candidate = await load();
        if (alive.current) { setExpected(original); setPreview(candidate); }
      })} />}
      <section className="archive-panel" aria-label="Файл резервной копии">
        <h2>Файл ZIP</h2>
        <input ref={picker} type="file" hidden accept=".fableshot,.zip,application/zip,application/octet-stream" data-testid="archive-file" onChange={event => void select(event)} />
        <div className="archive-actions">
          {!restoreFirst && <button type="button" className="archive-action" disabled={busy} data-testid="archive-save" onClick={() => void saveBackup()}>Сохранить в файл</button>}
          <button type="button" className="archive-action" disabled={busy} onClick={() => void chooseArchive()}>Восстановить из файла</button>
        </div>
      </section>
      {busy && <p role="status" className="motion-status" data-busy="true">Проверяю и подготавливаю данные…</p>}
      {error && <p role="alert">{error}</p>}{status && <p key={status} role="status" className="motion-status" data-busy="false">{status}</p>}
      {shownPreview && <section className="archive-panel" data-testid="archive-preview">
        <h2>Содержимое копии</h2><p>{new Date(shownPreview.manifest.createdAt).toLocaleString('ru-RU')} · {shownPreview.manifest.appVersion}</p>
        {canRestoreArchived && <div className="preference-row">
          <span className="preference-title">Восстановить архивированные данные?</span>
          <button type="button" className="preference-switch" role="switch" aria-label="Восстановить архивированные данные?"
            disabled={busy || !!confirm} aria-checked={restoreArchived} onClick={() => setRestoreArchived(value => !value)}><span /></button>
        </div>}
        {shownPreview.nativeSource && <p>Исходный ZIP Android входит в копию.</p>}
        <Summary summary={shownPreview.summary} />
        <button type="button" className="archive-action" disabled={busy} data-testid="archive-restore" onClick={() => {
          setConfirmedPreview(shownPreview); setConfirm('restore');
        }}>Заменить дневник</button>
      </section>}
      {nativePreview && <section className="archive-panel" data-testid="native-archive-preview">
        <h2>Резервная копия Android</h2>
        <p>FableShot {nativePreview.conversion.inspection.manifest.appVersion} · формат {nativePreview.conversion.inspection.manifest.formatVersion}</p>
        <dl className="archive-counts">
          <div><dt>Тренировки</dt><dd>{nativePreview.conversion.inspection.summary.sessions}</dd></div>
          <div><dt>Стрелы с очками</dt><dd>{nativePreview.conversion.inspection.summary.shots}</dd></div>
          <div><dt>Совместимые тренировки</dt><dd>{nativePreview.conversion.inspection.summary.sessions - nativePreview.projection.retained.sessions}</dd></div>
          <div><dt>Тренировки только в оригинале</dt><dd>{nativePreview.projection.retained.sessions}</dd></div>
        </dl>
        {(nativePreview.projection.retained.notes > 0 || nativePreview.projection.retained.progressBaselines > 0 ||
          nativePreview.projection.retained.recordReceipts > 0 || nativePreview.projection.omissions.length > 0) &&
          <p>Часть заметок, истории расчётов или других данных может быть доступна только в исходном ZIP.</p>}
        <p>Совместимые данные появятся в дневнике. Исходный ZIP сохранится на этом устройстве. Чтобы включать его в резервные копии, включи сохранение архивированных данных.</p>
        <button type="button" className="archive-action" data-testid="native-archive-activate" disabled={busy} onClick={() => setConfirm('native')}>Перенести дневник</button>
      </section>}
      {recovery && <section className="archive-panel" data-testid="archive-last-backup">
        <h2>Копия на этом устройстве</h2>
        <p>{new Date(recovery.savedAt).toLocaleString('ru-RU')} · {recovery.summary.trainings} трен. · {recovery.summary.arrows} стрел</p>
        <button type="button" className="archive-action" disabled={busy} data-testid="archive-recover" onClick={() => setConfirm('recovery')}>Восстановить копию</button>
      </section>}
      <SettingsAction icon="delete" tone="danger" aria-haspopup="dialog" disabled={busy} data-testid="account-reset" onClick={() => setConfirm('reset')}>Обнулить профиль</SettingsAction>
    </div>
    {confirm && <BottomSheet title={confirm === 'reset' ? 'Обнулить профиль?' : 'Заменить текущий дневник?'}
      onClose={() => { setConfirm(null); setConfirmedPreview(null); }} onDismissRequest={() => !running.current} tag="archive-confirm">
      <p>{confirm === 'reset' ? 'Тренировки, снаряжение, памятки и настройки будут сброшены. Перед сбросом сохранится полный страховочный ZIP с корзиной, архивами и исходным вложением Android при его наличии.'
        : 'Текущие данные заменятся выбранной копией. Перед заменой сохранится локальная резервная копия текущего дневника.'}</p>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status" className="motion-status" data-busy="true">{confirm === 'reset' ? 'Сохраняю копию и обнуляю профиль…' : 'Восстанавливаю дневник…'}</p>}
      <button type="button" className="archive-action" disabled={busy} data-testid="archive-confirm-apply" onClick={() => void apply()}>{confirm === 'reset' ? 'Сохранить копию и обнулить' : 'Заменить дневник'}</button>
    </BottomSheet>}
  </main>;
}

function backupFilename() {
  return `FableShot-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
}
