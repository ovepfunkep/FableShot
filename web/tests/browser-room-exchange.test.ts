import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { exchangeBrowserRoom } from '../src/browser-room-probe.ts';

test('Chrome sends encrypted room requests and rejects a modified receipt', async t => {
  const secret = randomBytes(24);
  const invite = `FS1:192.168.43.1:25000:${secret.toString('base64url')}`;
  const operation = { payload: '{"revision":2}', publicKey: 'public', signature: 'signature' };
  let corrupt = false;
  t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit & { targetAddressSpace: string }) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.targetAddressSpace, 'local');
    assert.equal(options.credentials, 'omit');
    assert.match(input, /^http:\/\/192\.168\.43\.1:25000\/room\/[0-9a-f]{32}$/);
    const nonce = Buffer.from(input.split('/').at(-1)!, 'hex');
    const key = (step: number) => createHmac('sha256', secret).update(Buffer.from([1, step])).update(nonce).digest();
    const body = options.body as Blob;
    assert.equal(body.type, 'text/plain');
    const bytes = Buffer.from(await body.arrayBuffer());
    const decoder = createDecipheriv('aes-256-gcm', key(8), nonce.subarray(0, 12));
    decoder.setAuthTag(bytes.subarray(-16));
    assert.deepEqual(JSON.parse(Buffer.concat([decoder.update(bytes.subarray(0, -16)), decoder.final()]).toString()), operation);
    const iv = randomBytes(12);
    const encoder = createCipheriv('aes-256-gcm', key(9), iv);
    const response = Buffer.concat([iv, encoder.update('{"endId":2,"revision":2}'), encoder.final(), encoder.getAuthTag()]);
    if (corrupt) response[response.length - 1] ^= 1;
    return new Response(response);
  });
  assert.deepEqual(await exchangeBrowserRoom(invite, operation), { endId: 2, revision: 2 });
  corrupt = true;
  await assert.rejects(exchangeBrowserRoom(invite, operation));
});
