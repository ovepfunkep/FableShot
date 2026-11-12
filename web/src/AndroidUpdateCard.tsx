import type { useAndroidUpdates } from './android-updates.ts';
import './about-screen.css';

export function AndroidUpdateCard({ updates, manual = false }: { updates: ReturnType<typeof useAndroidUpdates>; manual?: boolean }) {
  if (!updates.available || (!manual && !updates.announce)) return null;
  return <section className="android-update" aria-label="Обновления Android" data-testid="android-update">
    {updates.update && <>
      <strong>Доступен FableShot {updates.update.version}</strong>
      {updates.update.notes && <p className="android-update-notes">{updates.update.notes}</p>}
      <button type="button" className="primary" onClick={() => void updates.download()}>Скачать APK</button>
      {!manual && <button type="button" className="technique-condition-link" onClick={updates.dismiss}>Позже</button>}
    </>}
    {manual && <button type="button" className="technique-condition-link" disabled={updates.checking} onClick={updates.check}>Проверить обновления</button>}
    {updates.status && <small role="status">{updates.status}</small>}
  </section>;
}
