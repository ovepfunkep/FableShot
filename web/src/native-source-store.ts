const databaseName = 'fableshot-native-sources-v1';
const storeName = 'archives';
const maxBytes = 64 * 1024 * 1024;
const validHash = /^[a-f0-9]{64}$/;

type NativeSource = { sha256: string; bytes: number };

function storageError(cause: unknown) {
  const quota = cause instanceof DOMException && cause.name === 'QuotaExceededError';
  return new Error(quota ? 'Недостаточно места для оригинала Android-архива.' : 'Хранилище оригиналов Android-архивов недоступно.', { cause });
}

async function digest(bytes: ArrayBuffer) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verify(bytes: unknown, sha256: string): Promise<ArrayBuffer> {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0 || bytes.byteLength > maxBytes ||
    await digest(bytes) !== sha256) {
    throw new Error('Оригинал Android-архива повреждён: контрольная сумма или размер не совпадают.');
  }
  return bytes;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(storageError(new Error('IndexedDB unavailable')));
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Хранилище архивов занято. Закрой другие окна FableShot и повтори.'));
    };
    request.onerror = () => reject(storageError(request.error));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (blocked) database.close();
      else resolve(database);
    };
  });
}

/** Read and optionally add bytes under the same lock. Resolve only when IndexedDB commits. */
async function readOrAdd(sha256: string, bytes?: ArrayBuffer): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = bytes
        ? database.transaction(storeName, 'readwrite', { durability: 'strict' })
        : database.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      let stored: unknown;
      let failure: unknown;
      transaction.oncomplete = () => resolve(stored);
      transaction.onabort = () => reject(storageError(failure ?? transaction.error));
      transaction.onerror = event => {
        const request = event.target as IDBRequest | null;
        failure = request?.error ?? transaction.error;
      };
      const request = store.get(sha256);
      request.onsuccess = () => {
        stored = request.result;
        if (stored !== undefined || !bytes) return;
        try {
          store.add(bytes, sha256);
          stored = bytes;
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
    });
  } finally {
    database.close();
  }
}

export async function putNativeSource(bytes: Uint8Array): Promise<NativeSource> {
  if (bytes.byteLength === 0) throw new Error('Оригинал Android-архива пуст.');
  if (bytes.byteLength > maxBytes) throw new Error('Оригинал Android-архива превышает 64 МБ.');
  // Copy the exact view so caller-side mutations cannot change bytes after hashing.
  const snapshot = new Uint8Array(bytes).buffer;
  const sha256 = await digest(snapshot);
  const stored = await readOrAdd(sha256, snapshot);
  if (stored !== snapshot) await verify(stored, sha256);
  return { sha256, bytes: snapshot.byteLength };
}

export async function getNativeSource(sha256: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!validHash.test(sha256)) throw new Error('Некорректная контрольная сумма Android-архива.');
  const stored = await readOrAdd(sha256);
  if (stored === undefined) throw new Error('Оригинал Android-архива отсутствует в хранилище.');
  return new Uint8Array(await verify(stored, sha256));
}
