import { Capacitor, registerPlugin } from '@capacitor/core';

export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
export type DocumentMimeType = 'application/pdf' | 'application/json' | 'text/plain' | 'text/csv' | 'image/png' | 'application/zip';
export interface DocumentExport {
  name: string;
  mimeType: DocumentMimeType;
  bytes: Uint8Array;
  share?: boolean;
}
export interface DocumentExportResult { saved: boolean; opened: boolean }

interface NativeDocumentExport {
  exportDocument(options: { name: string; mimeType: DocumentMimeType; dataBase64: string; share?: boolean }): Promise<DocumentExportResult>;
}
const nativeDocumentExport = registerPlugin<NativeDocumentExport>('DocumentExport');
const extensions: Record<DocumentMimeType, string> = {
  'application/pdf': '.pdf', 'application/json': '.json', 'text/plain': '.txt', 'text/csv': '.csv', 'image/png': '.png', 'application/zip': '.zip',
};

function validateDocument(document: DocumentExport): void {
  const extension = Object.hasOwn(extensions, document.mimeType) ? extensions[document.mimeType] : undefined;
  if (!extension || typeof document.name !== 'string' || !document.name.trim() ||
      document.name.length > 160 || document.name !== document.name.trim() ||
      /[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/.test(document.name) ||
      !document.name.toLowerCase().endsWith(extension) || document.name.length <= extension.length) {
    throw new Error('Проверь имя и формат файла перед сохранением.');
  }
  if (!(document.bytes instanceof Uint8Array) || document.bytes.byteLength === 0 ||
      document.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error('Файл должен содержать от 1 байта до 12 МБ.');
  }
}

/** The bridge must transfer the view's bytes, never the unused part of its backing buffer. */
export function documentExportPayload(document: DocumentExport): {
  name: string; mimeType: DocumentMimeType; dataBase64: string;
} {
  validateDocument(document);
  const chunks: string[] = [];
  for (let offset = 0; offset < document.bytes.byteLength; offset += 0x8000) {
    chunks.push(String.fromCharCode(...document.bytes.subarray(offset, offset + 0x8000)));
  }
  return { name: document.name, mimeType: document.mimeType, dataBase64: btoa(chunks.join('')) };
}

/** Native saved=true follows a completed write. In a browser it means a download was dispatched. */
export async function exportDocument(document: DocumentExport): Promise<DocumentExportResult> {
  validateDocument(document);
  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable('DocumentExport')) {
      throw new Error('Сохранение файлов недоступно. Обнови тестовое приложение.');
    }
    return nativeDocumentExport.exportDocument({ ...documentExportPayload(document), share: document.share });
  }

  const anchor = window.document.createElement('a');
  const url = URL.createObjectURL(new Blob([new Uint8Array(document.bytes)], { type: document.mimeType }));
  try {
    anchor.href = url;
    anchor.download = document.name;
    window.document.body.append(anchor);
    anchor.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    anchor.remove();
  }
  // Give Safari time to consume the Blob after the synthetic download click.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { saved: true, opened: false };
}
