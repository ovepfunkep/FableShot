/** One atomic record after restoration; untouched legacy keys remain a recovery source. */
import { openIndexedJournal } from './indexed-journal.ts';
import type { JournalSnapshot } from './indexed-journal.ts';
import type { Diary } from './persistence.ts';

export const ACTIVE_DATA_KEY = 'app.fableshot.active-data.v1';
export const RECOVERY_DATA_KEY = 'app.fableshot.recovery-data.v1';
export const DATA_KEYS = [
  'app.fableshot.practice-diary.v1', 'app.fableshot.equipment.v1', 'app.fableshot.training-presets.v1',
  'app.fableshot.techniques.v1', 'app.fableshot.training-preferences.v1',
  'app.fableshot.technique-settings.v1', 'app.fableshot.timer-settings.v1',
] as const;
export const LEGACY_DATA_KEYS = ['app.fableshot.practice-pilot.v1', 'app.fableshot.practice-pilot.v2', 'app.fableshot.practice-pilot.v3'] as const;
export type DataRecords = Record<string, string | null>;
export type StoredData = { version: 1; epoch: string; records: DataRecords };
const allowed = new Set<string>([...DATA_KEYS, ...LEGACY_DATA_KEYS]);

export function decodeStoredData(raw: string): StoredData {
  const value = JSON.parse(raw) as Partial<StoredData> | null;
  if (!value || value.version !== 1 || typeof value.epoch !== 'string' || !value.epoch || !value.records ||
    typeof value.records !== 'object' || Array.isArray(value.records) ||
    Object.entries(value.records).some(([key, value]) => !allowed.has(key) || (value !== null && typeof value !== 'string')) ||
    !DATA_KEYS.every(key => Object.hasOwn(value.records!, key))) throw new Error('Не удалось прочитать выбранный дневник. Исходные данные сохранены.');
  return value as StoredData;
}

/** A stale tab must reload, rather than write its old form into a newly restored diary. */
export function createAppStorage(source: () => Pick<Storage, 'getItem' | 'setItem'>) {
  let openedEpoch: string | undefined;
  function current() {
    const raw = source().getItem(ACTIVE_DATA_KEY);
    const state = raw === null ? null : decodeStoredData(raw);
    const epoch = state?.epoch ?? 'legacy';
    if (openedEpoch !== undefined && openedEpoch !== epoch) throw new Error('Дневник заменён в другом окне. Обнови приложение.');
    openedEpoch = epoch;
    return state;
  }
  function checkKey(key: string) { if (!allowed.has(key)) throw new Error('Этот раздел не зарегистрирован в хранилище.'); }
  return {
    getItem(key: string): string | null {
      checkKey(key);
      const state = current();
      return state ? state.records[key] ?? null : source().getItem(key);
    },
    setItem(key: string, value: string): void {
      checkKey(key);
      const state = current();
      if (state) source().setItem(ACTIVE_DATA_KEY, JSON.stringify({ ...state, records: { ...state.records, [key]: value } }));
      else source().setItem(key, value);
    },
  };
}

const legacyStorage = createAppStorage(() => localStorage);
let indexed: Awaited<ReturnType<typeof openIndexedJournal>> | null = null;
let active: JournalSnapshot | null = null;
let pending: Promise<unknown> = Promise.resolve();
let replaced = false;
const newRevision = () => crypto.randomUUID();
const journalChanges = new EventTarget();

export function onJournalCommit(listener: () => void) {
  journalChanges.addEventListener('commit', listener);
  return () => journalChanges.removeEventListener('commit', listener);
}

export async function initializeAppStorage(isDiary: (value: unknown) => value is Diary): Promise<void> {
  const storage = await openIndexedJournal();
  try {
    let loaded = await storage.read();
    if (!loaded) {
      const records = Object.fromEntries([...DATA_KEYS, ...LEGACY_DATA_KEYS].map(key => [key, legacyStorage.getItem(key)]));
      const raw = records[DATA_KEYS[0]];
      let diary: Diary | null = null;
      if (raw !== null) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (isDiary(parsed)) diary = parsed;
        } catch { /* Keep the original unreadable record available for recovery. */ }
      }
      if (diary) records[DATA_KEYS[0]] = null;
      loaded = { revision: newRevision(), records, diary, recovery: localStorage.getItem(RECOVERY_DATA_KEY) };
      await storage.write(loaded, null);
    }
    if (loaded.diary && !isDiary(loaded.diary)) {
      throw new Error('Хранилище содержит неверный дневник. Исходные данные сохранены.');
    }
    indexed = storage;
    active = loaded;
  } catch (cause) {
    storage.close();
    throw cause;
  }
}

function commit(change: (previous: JournalSnapshot) => JournalSnapshot): Promise<void> {
  const operation = pending.then(async () => {
    if (replaced) throw new Error('Дневник заменён. Открой приложение заново.');
    const previous = active!;
    const next = change(previous);
    await indexed!.write(next, previous);
    active = next;
    journalChanges.dispatchEvent(new Event('commit'));
  });
  pending = operation.catch(() => {});
  return operation;
}

export const appStorage = {
  getItem(key: string): string | null {
    if (!active) return legacyStorage.getItem(key);
    if (key === DATA_KEYS[0] && active.diary) return JSON.stringify(active.diary);
    return active.records[key] ?? null;
  },
  setItem(key: string, value: string): Promise<void> | void {
    if (!active) return legacyStorage.setItem(key, value);
    if (!allowed.has(key) || key === DATA_KEYS[0]) throw new Error('Этот раздел записывается отдельно.');
    const expected = active.records[key];
    return commit(previous => {
      if (key !== DATA_KEYS[4] && previous.records[key] !== expected) throw new Error('Данные изменились. Повтори действие.');
      return { ...previous, revision: newRevision(), records: { ...previous.records, [key]: value } };
    });
  },
  readDiary(): Diary | null { return active?.diary ?? null; },
  writeDiary(diary: Diary, expected: Diary): Promise<void> | void {
    if (!active) return legacyStorage.setItem(DATA_KEYS[0], JSON.stringify(diary));
    return commit(previous => {
      if (previous.diary && previous.diary !== expected) throw new Error('Дневник изменился. Повтори действие.');
      return { ...previous, revision: newRevision(), diary, records: { ...previous.records, [DATA_KEYS[0]]: null } };
    });
  },
  revision(): string | null { return active?.revision ?? null; },
  recovery(): string | null { return active ? active.recovery : localStorage.getItem(RECOVERY_DATA_KEY); },
  saveRecovery(recovery: string, revision: string): Promise<void> {
    return commit(previous => {
      if (previous.revision !== revision) throw new Error('Дневник изменился во время подготовки. Повтори действие.');
      return { ...previous, revision: newRevision(), recovery };
    });
  },
  replace(records: DataRecords, recovery: string, revision: string): Promise<void> {
    const diary: Diary = JSON.parse(records[DATA_KEYS[0]]!);
    return commit(previous => {
      if (previous.revision !== revision) throw new Error('Данные изменились после предпросмотра. Открой архив заново.');
      return { revision: newRevision(), records: { ...records, [DATA_KEYS[0]]: null }, diary, recovery };
    }).then(() => { replaced = true; });
  },
};
