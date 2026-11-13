import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

async function filesIn(relative = '') {
  const entries = await readdir(join(dist, relative), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || /^(?:tests?|fixtures|coverage)$/i.test(entry.name)) continue;
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await filesIn(path));
    if (entry.isFile() && path !== 'sw.js' && !/(?:\.(?:spec|test)\.|\.map$)/i.test(path)) result.push(path);
  }
  return result.sort();
}

const files = await filesIn();
if (!files.includes('index.html')) throw new Error('Build the Vite app before preparing offline assets.');

const hash = createHash('sha256').update(await readFile(new URL(import.meta.url)));
for (const file of files) {
  const bytes = await readFile(join(dist, file));
  hash.update(`${file}\0${bytes.length}\0`).update(bytes);
}
const version = hash.digest('hex').slice(0, 16);
const paths = files.map(file => file.split('/').map(encodeURIComponent).join('/'));

const worker = `const scope = new URL(self.registration.scope);
const prefix = 'fableshot-practice:' + scope.href + ':';
const current = prefix + ${JSON.stringify(version)};
const shell = new URL('index.html', scope).href;
const assets = ${JSON.stringify(paths)}.map(path => new URL(path, scope).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(current).then(cache =>
    cache.addAll(assets.map(url => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // A tab can still be running the previous bundle after the worker changes.
    await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== current).slice(0, -1)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const bundleAsset = url.pathname.startsWith(new URL('assets/', scope).pathname);
  if (request.mode !== 'navigate' && !assets.includes(url.href) && !bundleAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(current);
    // These are fixed same-origin files. The module request can add Origin,
    // while the precache request does not, even though their bytes match.
    const key = request.mode === 'navigate' ? shell : url.href;
    const cached = await cache.match(key, { ignoreVary: true });
    if (cached) return cached;
    if (bundleAsset) {
      const previous = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== current).at(-1);
      if (previous) {
        const oldAsset = await (await caches.open(previous)).match(key, { ignoreVary: true });
        if (oldAsset) return oldAsset;
      }
    }
    return fetch(request);
  })());
});
`;

await writeFile(join(dist, 'sw.js'), worker);
console.log(`Offline assets: ${files.length} (${version})`);
