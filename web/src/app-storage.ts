/** One atomic record after restoration; untouched legacy keys remain a recovery source. */
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

export const appStorage = createAppStorage(() => localStorage);
