const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export async function checkBrowserRoom(invitation: string): Promise<{ milliseconds: number }> {
  const parsed = /^FS1:((?:\d{1,3}\.){3}\d{1,3}):([1-9]\d{0,4}):([A-Za-z0-9_-]{32})$/.exec(invitation);
  if (!parsed) throw new Error('Нужен код приглашения из комнаты FableShot.');
  const [, host, port, secret] = parsed;
  const octets = host.split('.').map(Number);
  const [a, b] = octets;
  const privateIp = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (!privateIp || octets.some(value => value > 255) || Number(port) > 65535) {
    throw new Error('В приглашении указан неверный адрес комнаты.');
  }

  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const proof = async (step: number) => hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, Uint8Array.of(1, step, ...nonce))));
  const request = await proof(4);
  const expected = await proof(5);
  const started = performance.now();
  try {
    const options: RequestInit & { targetAddressSpace: 'local' } = {
      targetAddressSpace: 'local', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000),
    };
    const response = await fetch(`http://${octets.join('.')}:${port}/probe/${hex(nonce)}/${request}`, options);
    if (!response.ok || await response.text() !== expected) throw new Error('Invalid probe reply');
    return { milliseconds: Math.round(performance.now() - started) };
  } catch {
    throw new Error('Нет ответа от комнаты. Проверьте Wi-Fi и разрешите сайту доступ к локальной сети в Chrome.');
  }
}
