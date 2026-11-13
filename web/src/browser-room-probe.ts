const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

function parseInvitation(invitation: string) {
  const parsed = /^FS1:((?:\d{1,3}\.){3}\d{1,3}):([1-9]\d{0,4}):([A-Za-z0-9_-]{32})$/.exec(invitation);
  if (!parsed) throw new Error('Нужен код приглашения из комнаты FableShot.');
  const [, host, port, secret] = parsed;
  const octets = host.split('.').map(Number);
  const [a, b] = octets;
  const privateIp = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (!privateIp || octets.some(value => value > 255) || Number(port) > 65535) {
    throw new Error('В приглашении указан неверный адрес комнаты.');
  }

  return { endpoint: `http://${octets.join('.')}:${port}`, secret: Uint8Array.from(atob(secret.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)) };
}

const requestOptions = { targetAddressSpace: 'local', credentials: 'omit', redirect: 'error' } as const;

export async function checkBrowserRoom(invitation: string): Promise<{ milliseconds: number }> {
  const { endpoint, secret } = parseInvitation(invitation);
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', secret,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const proof = async (step: number) => hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, Uint8Array.of(1, step, ...nonce))));
  const request = await proof(4);
  const expected = await proof(5);
  const started = performance.now();
  try {
    const options = { ...requestOptions, signal: AbortSignal.timeout(10_000) };
    const response = await fetch(`${endpoint}/probe/${hex(nonce)}/${request}`, options);
    if (!response.ok || await response.text() !== expected) throw new Error('Invalid probe reply');
    return { milliseconds: Math.round(performance.now() - started) };
  } catch {
    throw new Error('Нет ответа от комнаты. Проверьте Wi-Fi и разрешите сайту доступ к локальной сети в Chrome.');
  }
}

export async function exchangeBrowserRoom(invitation: string, request: object): Promise<unknown> {
  const { endpoint, secret } = parseInvitation(invitation);
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const hmac = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  async function derive(step: number) {
    const bytes = await crypto.subtle.sign('HMAC', hmac, Uint8Array.of(1, step, ...nonce));
    return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  const iv = nonce.slice(0, 12);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derive(8),
    new TextEncoder().encode(JSON.stringify(request)));
  // text/plain keeps this a simple CORS request. Only ciphertext leaves the browser.
  const options = { ...requestOptions, method: 'POST', body: new Blob([encrypted], { type: 'text/plain' }), signal: AbortSignal.timeout(10_000) };
  const response = await fetch(`${endpoint}/room/${hex(nonce)}`, options);
  if (!response.ok) throw new Error('Комната не подтвердила обмен. Проверьте Wi-Fi.');
  const reply = new Uint8Array(await response.arrayBuffer());
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: reply.slice(0, 12) }, await derive(9), reply.slice(12));
  return JSON.parse(new TextDecoder().decode(clear));
}
