import { appStorage } from './app-storage.ts';
export type TechniqueDisplaySettings = {
  techniqueFocus: boolean;
  techniqueReflection: boolean;
};

export const DEFAULT_TECHNIQUE_SETTINGS: TechniqueDisplaySettings = {
  techniqueFocus: true,
  techniqueReflection: true,
};
export const TECHNIQUE_SETTINGS_STORAGE_KEY = 'app.fableshot.technique-settings.v1';

export function isTechniqueDisplaySettings(value: unknown): value is TechniqueDisplaySettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return Object.keys(settings).length === 2 && typeof settings.techniqueFocus === 'boolean' &&
    typeof settings.techniqueReflection === 'boolean';
}

export function loadTechniqueSettings(): TechniqueDisplaySettings {
  let raw: string | null;
  try { raw = appStorage.getItem(TECHNIQUE_SETTINGS_STORAGE_KEY); }
  catch (cause) { throw new Error('Не удалось открыть настройки показа техники. Повтори чтение.', { cause }); }
  if (raw === null) return { ...DEFAULT_TECHNIQUE_SETTINGS };
  let decoded: unknown;
  try { decoded = JSON.parse(raw); }
  catch (cause) { throw new Error('Не удалось прочитать настройки показа техники. Исходная запись сохранена.', { cause }); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('Неверный формат настроек показа техники. Исходная запись сохранена.');
  }
  const envelope = decoded as Record<string, unknown>;
  if (envelope.version !== 1 || Object.keys(envelope).length !== 2 || !isTechniqueDisplaySettings(envelope.settings)) {
    throw new Error('Неверный формат настроек показа техники. Исходная запись сохранена.');
  }
  return { ...envelope.settings };
}

/** Never replace an unreadable or concurrently changed settings record. */
export function saveTechniqueSettings(value: TechniqueDisplaySettings, expected: TechniqueDisplaySettings): void {
  if (!isTechniqueDisplaySettings(value) || !isTechniqueDisplaySettings(expected)) throw new Error('Проверь настройки показа техники.');
  const current = loadTechniqueSettings();
  if (current.techniqueFocus !== expected.techniqueFocus || current.techniqueReflection !== expected.techniqueReflection) {
    throw new Error('Настройки показа техники изменены в другом окне. Повтори чтение.');
  }
  try { appStorage.setItem(TECHNIQUE_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, settings: value })); }
  catch (cause) { throw new Error('Не удалось сохранить настройки показа техники. Возможно, хранилище заполнено. Повтори действие.', { cause }); }
}
