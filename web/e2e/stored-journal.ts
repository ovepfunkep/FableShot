import type { Page } from '@playwright/test';
import type { Diary, DiaryEntry } from '../src/persistence.ts';

export function readStoredJournal(page: Page) {
  return page.evaluate(async () => {
    function read<T>(request: IDBRequest<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    const database = await read(indexedDB.open('fableshot-journal-v1'));
    try {
      const transaction = database.transaction(['snapshots', 'entries']);
      const snapshots = transaction.objectStore('snapshots');
      const [manifest, rows, recovery] = await Promise.all([
        read(snapshots.get('active')) as Promise<{ revision: string; records: Record<string, string | null>;
          journal: { ids: string[]; metadata: Omit<Diary, 'entries'> } | null }>,
        read(transaction.objectStore('entries').getAll()) as Promise<DiaryEntry[]>,
        read(snapshots.get('recovery')) as Promise<string | undefined>,
      ]);
      const byId = new Map(rows.map(row => [row.id, row]));
      const diary = manifest.journal ? { ...manifest.journal.metadata, entries: manifest.journal.ids.map(id => byId.get(id)!) } : null;
      return { diary, records: manifest.records, recovery, revision: manifest.revision };
    } finally { database.close(); }
  });
}

export async function readDiary(page: Page): Promise<Diary> {
  const { diary } = await readStoredJournal(page);
  if (!diary) throw new Error('No saved diary');
  return diary;
}

export async function writeStoredSetting(page: Page, key: string, value: string) {
  await page.evaluate(async ({ key, value }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('fableshot-journal-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('snapshots', 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        const store = transaction.objectStore('snapshots');
        const request = store.get('active');
        request.onsuccess = () => {
          const state = request.result;
          state.records[key] = value;
          state.revision = crypto.randomUUID();
          store.put(state, 'active');
        };
      });
    } finally { database.close(); }
  }, { key, value });
}
