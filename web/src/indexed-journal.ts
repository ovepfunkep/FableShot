import type { DataRecords } from './app-storage.ts';
import type { Diary, DiaryEntry } from './persistence.ts';

const databaseName = 'fableshot-journal-v1';
const snapshots = 'snapshots';
const entries = 'entries';
const currentKey = 'active';
const recoveryKey = 'recovery';

type Manifest = {
  revision: string;
  records: DataRecords;
  journal: { ids: string[]; metadata: Omit<Diary, 'entries'> } | null;
};
export type JournalSnapshot = { revision: string; records: DataRecords; diary: Diary | null; recovery: string | null };

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Хранилище дневника занято. Закрой другие окна FableShot и повтори.'));
    };
    request.onupgradeneeded = () => {
      request.result.createObjectStore(snapshots);
      request.result.createObjectStore(entries, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

export async function openIndexedJournal() {
  const database = await openDatabase();

  async function read(): Promise<JournalSnapshot | null> {
    const transaction = database.transaction([snapshots, entries], 'readonly');
    const data = transaction.objectStore(snapshots);
    const [manifest, rows, recovery] = await Promise.all([
      requestResult(data.get(currentKey)) as Promise<Manifest | undefined>,
      requestResult(transaction.objectStore(entries).getAll()) as Promise<DiaryEntry[]>,
      requestResult(data.get(recoveryKey)) as Promise<string | undefined>,
    ]);
    if (!manifest) return null;
    let diary: Diary | null = null;
    if (manifest.journal) {
      const byId = new Map(rows.map(row => [row.id, row]));
      const loaded = manifest.journal.ids.map(id => byId.get(id));
      if (loaded.some(row => !row) || loaded.length !== rows.length) {
        throw new Error('Записи дневника не совпадают с оглавлением. Открой архив для восстановления.');
      }
      diary = { ...manifest.journal.metadata, entries: loaded as DiaryEntry[] };
    }
    return { revision: manifest.revision, records: manifest.records, diary, recovery: recovery ?? null };
  }

  function write(next: JournalSnapshot, previous: JournalSnapshot | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([snapshots, entries], 'readwrite', { durability: 'strict' });
      const data = transaction.objectStore(snapshots);
      const training = transaction.objectStore(entries);
      let failure: unknown;
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Запись дневника прервана.'));
      transaction.onerror = event => { failure ??= (event.target as IDBRequest).error ?? transaction.error; };
      const head = data.get(currentKey);
      head.onsuccess = () => {
        const revision = (head.result as Manifest | undefined)?.revision;
        if (revision !== previous?.revision) {
          failure = new Error('Дневник изменён в другом окне. Обнови приложение.');
          transaction.abort();
          return;
        }
        try {
          const manifest: Manifest = { revision: next.revision, records: next.records, journal: null };
          if (next.diary) {
            const { entries: rows, ...metadata } = next.diary;
            manifest.journal = { ids: rows.map(row => row.id), metadata };
            if (next.diary !== previous?.diary) {
              const old = new Map(previous?.diary?.entries.map(row => [row.id, row]));
              for (const row of rows) {
                if (old.get(row.id) !== row) training.put(row);
                old.delete(row.id);
              }
              for (const id of old.keys()) training.delete(id);
            }
          } else if (previous?.diary) training.clear();
          data.put(manifest, currentKey);
          if (next.recovery !== previous?.recovery && next.recovery !== null) data.put(next.recovery, recoveryKey);
        } catch (cause) {
          failure = cause;
          transaction.abort();
        }
      };
    });
  }

  return { read, write, close: () => database.close() };
}
