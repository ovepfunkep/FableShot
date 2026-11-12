type CapacitorWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean } };

export async function enableOffline(): Promise<void> {
  if (!import.meta.env.PROD || (window as CapacitorWindow).Capacitor?.isNativePlatform?.()) return;
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    throw new Error('Для подготовки офлайн-режима открой FableShot по HTTPS.');
  }

  const scope = new URL(import.meta.env.BASE_URL, document.baseURI);
  const worker = new URL('sw.js', scope);
  const serviceWorkers = navigator.serviceWorker;
  await serviceWorkers.register(worker, { scope: scope.href, updateViaCache: 'none' });

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      serviceWorkers.removeEventListener('controllerchange', checkController);
      reject(new Error('Подготовка офлайн-режима не завершилась. Открой приложение ещё раз с интернетом.'));
    }, 15_000);

    function checkController() {
      if (serviceWorkers.controller?.scriptURL !== worker.href) return;
      window.clearTimeout(timeout);
      serviceWorkers.removeEventListener('controllerchange', checkController);
      resolve();
    }

    serviceWorkers.addEventListener('controllerchange', checkController);
    checkController();
  });
}
