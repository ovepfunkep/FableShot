import { useEffect, useState } from 'react';
import { androidUpdateNotes, fetchAndroidUpdateHistory } from './android-updates.ts';
import type { AndroidUpdate, useAndroidUpdates } from './android-updates.ts';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import './about-screen.css';

function AndroidUpdateDetails({ installed, update, onClose }: { installed: number; update: AndroidUpdate; onClose: () => void }) {
  const [history, setHistory] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const request = new AbortController();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
    void fetchAndroidUpdateHistory(update.version, signal)
      .then(value => { if (!request.signal.aborted) setHistory(value); })
      .catch(() => { /* The built-in history and release summary are still available. */ })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [update.version]);
  const { highlights, fallback } = androidUpdateNotes(installed, update, history);
  return <BottomSheet title={`Что нового в FableShot ${update.version}`} onClose={onClose}>
    {highlights.length > 0 && <ul className="web-release-highlights">{highlights.map(text => <li key={text}>{text}</li>)}</ul>}
    {loading && <p role="status" className="android-update-notes">Загружаю список изменений…</p>}
    {!loading && fallback && <p className="android-update-notes">{fallback}</p>}
    {!loading && !highlights.length && !fallback && <p className="android-update-notes">
      {Array.isArray(history) ? 'За этот период нет крупных изменений.' : 'Список изменений пока недоступен.'}
    </p>}
  </BottomSheet>;
}

export function AndroidUpdateCard({ updates, manual = false }: { updates: ReturnType<typeof useAndroidUpdates>; manual?: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  if (!updates.available || (!manual && !updates.announce)) return null;
  return <section className="android-update" aria-label="Обновления Android" data-testid="android-update">
    {updates.update && <>
      <div className="android-update-banner">
        <button type="button" className="android-update-download" aria-label="Скачать APK" title="Скачать APK"
          onClick={async () => setDownloadError(!await updates.download())}><Icon name="download" /></button>
        <div className="android-update-copy">
          <strong>Доступно обновление</strong>
          <div className="android-update-meta">
            <span>{updates.update.version}</span>
            <button type="button" aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>Что нового?</button>
          </div>
        </div>
        {!manual && <button type="button" className="android-update-dismiss" aria-label="Позже" title="Позже"
          onClick={updates.dismiss}><Icon name="close" /></button>}
      </div>
      {downloadError && <small role="status">Не удалось открыть загрузку APK.</small>}
      {detailsOpen && updates.installed !== null && <AndroidUpdateDetails key={updates.update.code}
        installed={updates.installed} update={updates.update} onClose={() => setDetailsOpen(false)} />}
    </>}
    {manual && <button type="button" className="technique-condition-link" disabled={updates.checking} onClick={updates.check}>Проверить обновления</button>}
    {manual && updates.status && <small role="status">{updates.status}</small>}
  </section>;
}
