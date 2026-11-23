/** A single writable app per origin makes synchronous localStorage commands safe across tabs. */
export function withStorageOwner(start: () => void | Promise<void>, unavailable: (message: string) => void): void {
  if (!navigator.locks) {
    unavailable('Для безопасного хранения нужен современный браузер с Web Locks. Обнови браузер.');
    return;
  }
  void navigator.locks.request('fableshot-diary-owner-v1', { ifAvailable: true }, async lock => {
    if (!lock) { unavailable('FableShot уже открыт в другом окне. Закрой его и повтори.'); return; }
    await new Promise<void>((release, reject) => {
      window.addEventListener('pagehide', () => release(), { once: true });
      window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
      Promise.resolve().then(start).catch(reject);
    });
  }).catch(error => unavailable(error instanceof Error && error.message ? error.message
    : 'Не удалось получить безопасный доступ к дневнику. Перезапусти приложение.'));
}
