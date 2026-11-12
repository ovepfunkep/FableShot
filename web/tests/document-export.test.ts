import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Capacitor } from '@capacitor/core';
import { documentExportPayload, exportDocument, MAX_DOCUMENT_BYTES } from '../src/document-export.ts';
import type { DocumentExport, DocumentMimeType } from '../src/document-export.ts';

const document = (change: Partial<DocumentExport> = {}): DocumentExport => ({
  name: 'Моя памятка 1.2.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([0, 1, 127, 128, 255]), ...change,
});

test('native transfer preserves binary bytes and a Uint8Array subview exactly', () => {
  const backing = new Uint8Array([44, 0, 255, 128, 31]);
  const payload = documentExportPayload(document({ bytes: backing.subarray(1, 4) }));
  assert.equal(payload.name, 'Моя памятка 1.2.pdf');
  assert.equal(payload.mimeType, 'application/pdf');
  assert.deepEqual([...Buffer.from(payload.dataBase64, 'base64')], [0, 255, 128]);
  const chunked = Uint8Array.from({ length: 70_001 }, (_, index) => index % 256);
  assert.deepEqual(Buffer.from(documentExportPayload(document({ bytes: chunked })).dataBase64, 'base64'), Buffer.from(chunked));
});

test('document metadata accepts supported formats and rejects unsafe or misleading names', () => {
  for (const [name, mimeType] of [
    ['Памятка.PDF', 'application/pdf'], ['Памятка.json', 'application/json'], ['Техника — заметки (2).txt', 'text/plain'],
    ['Тренировка.csv', 'text/csv'], ['Карточка.png', 'image/png'],
  ] as const) assert.equal(documentExportPayload(document({ name, mimeType })).name, name);
  for (const name of ['../memo.pdf', '..\\memo.pdf', ' memo.pdf', 'memo.pdf ', 'memo\n.pdf',
    'memo\u0085.pdf', 'memo?.pdf', 'memo:1.pdf', '.pdf', 'memo.txt', `${'a'.repeat(157)}.pdf`]) {
    assert.throws(() => documentExportPayload(document({ name })), /имя и формат/);
  }
  for (const mimeType of ['text/html', '__proto__', 'toString']) {
    assert.throws(() => documentExportPayload(document({ mimeType: mimeType as DocumentMimeType })), /имя и формат/);
  }
});

test('empty, nonbinary and oversized exports fail before crossing the bridge', () => {
  assert.throws(() => documentExportPayload(document({ bytes: new Uint8Array() })), /12 МБ/);
  assert.throws(() => documentExportPayload(document({ bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1) })), /12 МБ/);
  assert.throws(() => documentExportPayload(document({ bytes: [] as unknown as Uint8Array })), /12 МБ/);
});

test('browser dispatches a named Blob download, preserves bytes and releases its URL', async t => {
  let blob: Blob | undefined;
  let revoke: (() => void) | undefined;
  let clicked = false;
  let removed = false;
  const anchor = { href: '', download: '', click() { clicked = true; }, remove() { removed = true; } };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    document: {
      createElement: (tag: string) => { assert.equal(tag, 'a'); return anchor; },
      body: { append: (element: unknown) => assert.equal(element, anchor) },
    },
    setTimeout(callback: () => void) { revoke = callback; return 1; },
  } });
  t.after(() => previousWindow ? Object.defineProperty(globalThis, 'window', previousWindow) : Reflect.deleteProperty(globalThis, 'window'));
  t.mock.method(Capacitor, 'isNativePlatform', () => false);
  t.mock.method(URL, 'createObjectURL', (value: Blob) => { blob = value; return 'blob:test-document'; });
  const revokeUrl = t.mock.method(URL, 'revokeObjectURL');
  assert.deepEqual(await exportDocument(document()), { saved: true, opened: false });
  assert.equal(anchor.href, 'blob:test-document');
  assert.equal(anchor.download, 'Моя памятка 1.2.pdf');
  assert.ok(clicked && removed);
  assert.equal(blob?.type, 'application/pdf');
  assert.deepEqual([...new Uint8Array(await blob!.arrayBuffer())], [0, 1, 127, 128, 255]);
  assert.equal(revokeUrl.mock.callCount(), 0);
  revoke!();
  assert.deepEqual(revokeUrl.mock.calls[0].arguments, ['blob:test-document']);
});

test('native APK without the bridge reports an error instead of a Blob download', async t => {
  t.mock.method(Capacitor, 'isNativePlatform', () => true);
  t.mock.method(Capacitor, 'isPluginAvailable', () => false);
  await assert.rejects(exportDocument(document()), /Обнови тестовое приложение/);
});
