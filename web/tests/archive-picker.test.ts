import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeArchiveRead } from '../src/archive-picker.ts';

test('Android archive reader uses actual stream bytes and preserves binary ZIP data', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 128, 255]);
  const file = decodeArchiveRead({ cancelled: false, bytes: bytes.length, dataBase64: Buffer.from(bytes).toString('base64') });
  assert.equal(file?.size, bytes.length);
  assert.deepEqual(new Uint8Array(await file!.arrayBuffer()), bytes);
  assert.equal(decodeArchiveRead({ cancelled: true }), null);
});

test('Android archive reader rejects empty, truncated and oversized bridge results', () => {
  assert.throws(() => decodeArchiveRead({ cancelled: false, bytes: 0, dataBase64: '' }), /содержимое/);
  assert.throws(() => decodeArchiveRead({ cancelled: false, bytes: 3, dataBase64: 'UEs=' }), /не полностью/);
  assert.throws(() => decodeArchiveRead({ cancelled: false, bytes: 77 * 1024 * 1024, dataBase64: '' }), /содержимое/);
});
