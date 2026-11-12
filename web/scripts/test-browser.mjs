import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const { port } = socket.address();
await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
const url = `http://127.0.0.1:${port}/FableShot/`;
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port),
  '--base', '/FableShot/', '--strictPort',
], { cwd: root, windowsHide: true, stdio: 'pipe' });
let tests;
const stop = () => { tests?.kill(); server.kill(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
server.on('error', error => console.error(error.message));
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error('Preview server stopped');
    ready = await fetch(url).then(response => response.ok, () => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready) throw new Error('Preview did not start');
  tests = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
    cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, FABLE_UI_BASE: url },
  });
  const [code] = await once(tests, 'exit');
  process.exitCode = code ?? 1;
} finally {
  stop();
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
