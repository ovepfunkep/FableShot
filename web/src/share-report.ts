import { Capacitor, registerPlugin } from '@capacitor/core';
import { documentExportPayload, exportDocument } from './document-export.ts';

const bridge = registerPlugin<{
  shareDocuments(options: { files: { name: string; mimeType: string; dataBase64: string }[] }): Promise<{ opened: boolean }>;
}>('DocumentExport');

/** Called only from the user's Share gesture, after every file has been prepared. */
export async function shareReport(files: readonly File[]): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (!files.length) throw new Error('Отчёт ещё не готов.');
  try {
    if (!Capacitor.isNativePlatform() && navigator.canShare?.({ files: [...files] })) {
      await navigator.share({ files: [...files], title: 'FableShot — тренировка' });
      return 'shared';
    }
    if (Capacitor.isNativePlatform()) {
      const payload = await Promise.all(files.map(async file => documentExportPayload({
        name: file.name, mimeType: file.type as 'application/pdf' | 'image/png', bytes: new Uint8Array(await file.arrayBuffer()),
      })));
      const result = await bridge.shareDocuments({ files: payload });
      if (!result.opened) throw new Error('Не удалось открыть меню отправки.');
      return 'shared';
    }
    if (files.length === 1) {
      await exportDocument({ name: files[0].name, mimeType: files[0].type as 'application/pdf' | 'image/png', bytes: new Uint8Array(await files[0].arrayBuffer()) });
    } else {
      // One explicit download avoids browser blocking the remaining PNG pages.
      const { zipSync } = await import('fflate');
      const entries = await Promise.all(files.map(async file => [file.name, new Uint8Array(await file.arrayBuffer())] as const));
      await exportDocument({ name: `${files[0].name.replace(/-1\.png$/, '')}-PNG.zip`, mimeType: 'application/zip', bytes: zipSync(Object.fromEntries(entries), { level: 0 }) });
    }
    return 'downloaded';
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled';
    throw cause;
  }
}
