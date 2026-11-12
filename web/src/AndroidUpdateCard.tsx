import { useState } from 'react';
import type { useAndroidUpdates } from './android-updates.ts';
import { BottomSheet } from './ConditionsScreen.tsx';
import './about-screen.css';

export function AndroidUpdateCard({ updates, manual = false }: { updates: ReturnType<typeof useAndroidUpdates>; manual?: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  if (!updates.available || (!manual && !updates.announce)) return null;
  return <section className="android-update" aria-label="Обновления Android" data-testid="android-update">
    {updates.update && <>
      <strong>Доступно обновление!</strong>
      <div className="android-update-actions">
        <button type="button" onClick={() => setDetailsOpen(true)}>Что нового?</button>
        <button type="button" onClick={async () => setDownloadError(!await updates.download())}>Скачать APK</button>
        {!manual && <button type="button" className="android-update-dismiss" onClick={updates.dismiss}>Позже</button>}
      </div>
      {detailsOpen && <BottomSheet title={`Что нового в FableShot ${updates.update.version}`} onClose={() => setDetailsOpen(false)}>
        <p className="android-update-notes">{updates.update.notes || 'Для этой версии список изменений пока недоступен.'}</p>
      </BottomSheet>}
    </>}
    {manual && <button type="button" className="technique-condition-link" disabled={updates.checking} onClick={updates.check}>Проверить обновления</button>}
    {manual && updates.status && <small role="status">{updates.status}</small>}
    {downloadError && <small role="status">Не удалось открыть загрузку APK.</small>}
  </section>;
}
