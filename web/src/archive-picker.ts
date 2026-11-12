import { Capacitor, registerPlugin } from '@capacitor/core';

type ArchiveRead = { cancelled: boolean; bytes?: number; dataBase64?: string };
const bridge = registerPlugin<{ pickArchive(): Promise<ArchiveRead> }>('DocumentExport');
const MAX_BYTES = 76 * 1024 * 1024;

export const usesAndroidArchivePicker = () => Capacitor.getPlatform() === 'android';

export function decodeArchiveRead(result: ArchiveRead): File | null {
  if (result.cancelled) return null;
  if (!Number.isSafeInteger(result.bytes) || result.bytes! <= 0 || result.bytes! > MAX_BYTES ||
      typeof result.dataBase64 !== 'string' || result.dataBase64.length > Math.ceil(MAX_BYTES / 3) * 4) {
    throw new Error('Не удалось прочитать содержимое выбранного архива.');
  }
  const decoded = atob(result.dataBase64);
  if (decoded.length !== result.bytes) throw new Error('Архив прочитан не полностью. Выбери файл повторно.');
  return new File([Uint8Array.from(decoded, c => c.charCodeAt(0))], 'archive.zip', { type: 'application/zip' });
}

export async function pickAndroidArchive(): Promise<File | null> {
  return decodeArchiveRead(await bridge.pickArchive());
}
