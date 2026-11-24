import { useEffect, useState } from 'react';
import { releasePush } from './release-push.ts';
import type { ReleasePushStatus } from './release-push.ts';

export function ReleasePushSettings() {
  const [status, setStatus] = useState<ReleasePushStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => void releasePush.getStatus().then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setError('Не удалось проверить разрешение на уведомления.'); });
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; document.removeEventListener('visibilitychange', refresh); };
  }, []);

  async function toggle() {
    if (!status || (!status.available && !status.enabled) || busy) return;
    setBusy(true);
    setError('');
    try { setStatus(await releasePush.setEnabled({ enabled: !status.enabled })); }
    catch { setError('Не удалось изменить подписку. Попробуй ещё раз.'); }
    finally { setBusy(false); }
  }

  return <section className="settings-panel" aria-label="Уведомления FableShot">
    <div className="preference-row">
      <span className="preference-title">Обновления приложения</span>
      <button type="button" role="switch" aria-label="Обновления приложения" aria-checked={status?.enabled ?? false}
        className="preference-switch" disabled={busy || !(status?.available || status?.enabled)} onClick={() => void toggle()}><span /></button>
    </div>
    {status?.available && !status.allowed && <button type="button" className="text-action" onClick={() => {
      void releasePush.openSystemSettings().catch(() => setError('Не удалось открыть системные настройки.'));
    }}>Разрешение Android</button>}
    {error && <p role="status">{error}</p>}
  </section>;
}
