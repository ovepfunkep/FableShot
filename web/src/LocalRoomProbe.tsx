import { useCallback, useEffect, useRef, useState } from 'react';
import qrCode from 'qrcode-generator';
import jsQR from 'jsqr';
import { checkBrowserRoom } from './browser-room-probe.ts';
import { createRoomMembership, roomBridge as probe } from './group-room-membership.ts';
import type { RoomMembership, RoomStatus } from './group-room-membership.ts';
import './local-room-probe.css';


function InviteScanner({ onScan, onError }: { onScan: (value: string) => void; onError: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    const preview = video.current!;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    async function scan() {
      try {
        if (!context) throw new Error('Canvas unavailable');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        preview.srcObject = stream;
        await preview.play();
        if (cancelled) return;
        timer = window.setInterval(() => {
          if (preview.readyState < 2 || !preview.videoWidth || !preview.videoHeight) return;
          canvas.width = 480;
          canvas.height = Math.round(canvas.width * preview.videoHeight / preview.videoWidth);
          context.drawImage(preview, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const value = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data;
          if (value?.startsWith('FS1:')) {
            window.clearInterval(timer);
            onScan(value);
          }
        }, 200);
      } catch {
        if (!cancelled) onError('Камера недоступна. Можно вставить приглашение вручную.');
      }
    }
    void scan();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [onError, onScan]);
  return <video ref={video} muted playsInline className="room-probe-camera" aria-label="Сканирование QR" />;
}

function InvitationQr({ invitation }: { invitation: string }) {
  const qr = qrCode(0, 'M');
  qr.addData(invitation);
  qr.make();
  return <img className="room-probe-qr" src={qr.createDataURL(5, 20)} alt="QR приглашения в комнату" />;
}

export default function LocalRoomProbe({ native, onTraining }: { native: boolean; onTraining?: (membership: RoomMembership) => void }) {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [address, setAddress] = useState('');
  const [room, setRoom] = useState<RoomStatus>({});
  const [invitation, setInvitation] = useState('');
  const [verified, setVerified] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(false);
  const acceptScan = useCallback((value: string) => {
    setInvitation(value);
    setMessage('');
    setScanning(false);
  }, []);
  const failScan = useCallback((value: string) => {
    setError(value);
    setScanning(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    if (native) void probe.status().then(result => { if (alive.current) setRoom(result); }, () => {
      if (alive.current) setError('Не удалось прочитать состояние комнаты.');
    });
    return () => { alive.current = false; };
  }, [native]);

  useEffect(() => {
    if (!room.invitation) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void probe.status().then(result => {
        if (!cancelled) setRoom(current => current.invitation === room.invitation ? result : current);
      }, () => {
        if (!cancelled) setError('Не удалось прочитать состояние комнаты.');
      });
    }, 1200);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [room.invitation]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    setError('');
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Не удалось выполнить проверку.'); }
    finally { if (alive.current) setBusy(false); }
  }

  return <section className="room-probe">
    {native && <div className="settings-panel room-probe-panel">
      <h2>Создать комнату</h2>
      {room.invitation ? <>
        <p>Подключите участника к той же сети Wi-Fi. Покажите QR или передайте код.</p>
        <InvitationQr invitation={room.invitation} />
        <label>Код приглашения<input readOnly value={room.invitation} onFocus={event => event.currentTarget.select()} /></label>
        <p>Успешных проверок · {room.checks ?? 0}</p>
        <p>Принято серий · {room.acceptedSeries ?? 0}</p>
        {onTraining && <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => {
          const membership = await createRoomMembership(room.invitation!);
          if (alive.current) onTraining(membership);
        })}>Начать групповую тренировку</button>}
        <button type="button" className="secondary" disabled={busy} onClick={() => void run(async () => { await probe.stop(); setRoom({}); })}>Закрыть комнату</button>
      </> : <>
        <p>Включите точку доступа в настройках телефона и вернитесь сюда.</p>
        <button type="button" className="secondary" disabled={busy} onClick={() => void run(async () => {
          const result = await probe.addresses();
          setAddresses(result.addresses);
          setAddress(result.addresses[0] ?? '');
          if (!result.addresses.length) setError('Локальный адрес не найден. Включите точку доступа и повторите.');
        })}>Найти адрес</button>
        {addresses.length > 0 && <label>Адрес телефона<select value={address} onChange={event => setAddress(event.target.value)}>
          {addresses.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>}
        <button type="button" className="primary" disabled={busy || !address} onClick={() => void run(async () => {
          const created = await probe.start({ address });
          if (alive.current) setRoom(created);
          else await probe.stop();
        })}>Создать</button>
      </>}
    </div>}
    {!room.invitation && <div className="settings-panel room-probe-panel">
      <h2>Войти в комнату</h2>
      <p>Сначала подключитесь к Wi-Fi создателя.</p>
      {!native && <p>Разрешите Chrome доступ к локальной сети, когда он попросит.</p>}
      <button type="button" className="secondary" disabled={busy} onClick={() => { setError(''); setScanning(!scanning); }}>
        {scanning ? 'Закрыть камеру' : 'Сканировать QR'}
      </button>
      {scanning && <InviteScanner onScan={acceptScan} onError={failScan} />}
      <label>Код приглашения<input autoCapitalize="none" spellCheck={false} value={invitation}
        onChange={event => { setInvitation(event.target.value); setMessage(''); }} /></label>
      <button type="button" className="primary" disabled={busy || !invitation.trim()} onClick={() => {
        setScanning(false);
        void run(async () => {
          const code = invitation.trim();
          setVerified('');
          const result = await (native ? probe.check({ invitation: code }) : checkBrowserRoom(code));
          setVerified(code);
          setMessage(`Комната ответила за ${result.milliseconds} мс.`);
        });
      }}>Проверить связь</button>
      {onTraining && verified && verified === invitation.trim() && <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => {
        const membership = await createRoomMembership(verified);
        if (alive.current) onTraining(membership);
      })}>Начать групповую тренировку</button>}
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="room-probe-error">{error}</p>}
  </section>;
}
