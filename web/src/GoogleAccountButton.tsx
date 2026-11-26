import { useEffect, useState } from 'react';
import { connectDrive, loadDriveAuthorization } from './drive-backup.ts';

export function GoogleAccountButton({ className, label, disabled }: {
  className: string; label: string; disabled?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    void loadDriveAuthorization().then(() => { if (mounted) setReady(true); })
      .catch(cause => { if (mounted) setError(cause.message); });
    return () => { mounted = false; };
  }, []);
  return <>
    <button type="button" className={`${className} google-account-icon`} aria-label={label} title={label} aria-busy={busy || !ready && !error}
      disabled={disabled || !ready || busy} onClick={() => {
      setBusy(true);
      setError('');
      void connectDrive().catch(cause => setError(cause instanceof Error ? cause.message : 'Не удалось войти через Google.'))
        .finally(() => setBusy(false));
    }}><img src={`${import.meta.env.BASE_URL}icons/google-sign-in.svg`} alt="" width="40" height="40" /></button>
    {error && <p role="alert">{error}</p>}
  </>;
}
