type CapacitorWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean } };

export async function enableOffline(signal: AbortSignal): Promise<void> {
  if (!import.meta.env.PROD || (window as CapacitorWindow).Capacitor?.isNativePlatform?.()) return;
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    throw new Error('Для подготовки офлайн-режима открой FableShot по HTTPS.');
  }

  const scope = new URL(import.meta.env.BASE_URL, document.baseURI);
  const worker = new URL('sw.js', scope);
  const serviceWorkers = navigator.serviceWorker;
  const registration = await serviceWorkers.register(worker, { scope: scope.href, updateViaCache: 'none' });
  signal.throwIfAborted();

  await new Promise<void>((resolve, reject) => {
    let candidate: ServiceWorker | null = null;
    function cleanUp() {
      serviceWorkers.removeEventListener('controllerchange', checkController);
      registration.removeEventListener('updatefound', watchInstall);
      candidate?.removeEventListener('statechange', checkInstall);
      signal.removeEventListener('abort', abort);
      window.clearTimeout(timeout);
    }

    function checkController() {
      if (serviceWorkers.controller?.scriptURL !== worker.href) return false;
      cleanUp();
      resolve();
      return true;
    }
    function fail() {
      if (checkController()) return;
      cleanUp();
      reject(new Error('Не удалось подготовить офлайн-режим. Открой приложение ещё раз с интернетом.'));
    }
    function abort() {
      cleanUp();
      reject(signal.reason);
    }
    function checkInstall() {
      if (candidate?.state === 'redundant') fail();
    }
    function watchInstall() {
      candidate?.removeEventListener('statechange', checkInstall);
      candidate = registration.installing ?? registration.waiting;
      candidate?.addEventListener('statechange', checkInstall);
      checkInstall();
    }

    // Downloading the full offline package can take longer than the startup check.
    const timeout = window.setTimeout(() => {
      if (!registration.installing && !registration.waiting) fail();
    }, 15_000);
    serviceWorkers.addEventListener('controllerchange', checkController);
    registration.addEventListener('updatefound', watchInstall);
    signal.addEventListener('abort', abort);
    if (!checkController()) watchInstall();
  });
}
