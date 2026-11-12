import { appStorage } from './app-storage.ts';
import { isEquipmentSnapshot } from './equipment.ts';
import type { EquipmentSnapshot } from './equipment.ts';
import { acceptsDiameter, getTargetProfile } from './target.ts';

export type Conditions = {
  distanceMeters: number;
  targetProfileId: string;
  targetDiameterMm: number;
  equipment: EquipmentSnapshot | null;
};
export type RoundRule = { unit: 'arrows' | 'series' | 'unlimited'; limit: number | null };
export type TrainingPreset = { id: string; name: string; conditions: Conditions; rule: RoundRule; numberedArrows?: boolean | null };

export const DEFAULT_CONDITIONS: Conditions = {
  distanceMeters: 18, targetProfileId: 'wa-indoor-outer-v1', targetDiameterMm: 400, equipment: null,
};
export const DEFAULT_ROUND_RULE: RoundRule = { unit: 'arrows', limit: 30 };
export const MAX_SERIES_ARROWS = 1_000_000;
const presetsKey = 'app.fableshot.training-presets.v1';

export function isConditions(value: unknown): value is Conditions {
  if (value === null || typeof value !== 'object') return false;
  const { distanceMeters, targetProfileId, targetDiameterMm, equipment } = value as Partial<Conditions>;
  const profile = typeof targetProfileId === 'string' ? getTargetProfile(targetProfileId) : undefined;
  return typeof distanceMeters === 'number' && Number.isFinite(distanceMeters) && distanceMeters > 0 &&
    typeof targetDiameterMm === 'number' && targetDiameterMm <= 10_000 && !!profile &&
    acceptsDiameter(profile, targetDiameterMm) && (equipment === null || isEquipmentSnapshot(equipment));
}

export function isRoundRule(value: unknown): value is RoundRule {
  if (value === null || typeof value !== 'object') return false;
  const { unit, limit } = value as Partial<RoundRule>;
  if (unit === 'unlimited') return limit === null;
  return (unit === 'arrows' || unit === 'series') && typeof limit === 'number' &&
    Number.isSafeInteger(limit) && limit >= 1 && limit <= (unit === 'arrows' ? MAX_SERIES_ARROWS : 200);
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= 60;
}

export function isPreset(value: unknown): value is TrainingPreset {
  if (value === null || typeof value !== 'object') return false;
  const { id, name, conditions, rule, numberedArrows } = value as Partial<TrainingPreset>;
  return typeof id === 'string' && id.length > 0 && validName(name) && isConditions(conditions) && isRoundRule(rule) &&
    (numberedArrows == null || typeof numberedArrows === 'boolean');
}

export function loadPresets(): TrainingPreset[] {
  const raw = appStorage.getItem(presetsKey);
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new Error('Не удалось прочитать избранные условия. Исходная запись сохранена.', { cause });
  }
  if (value === null || typeof value !== 'object') throw new Error('Неверный формат избранных условий.');
  const { version, presets } = value as { version?: unknown; presets?: unknown };
  if (version !== 1 || !Array.isArray(presets) || presets.length > 64 || !Array.from(presets).every(isPreset)) {
    throw new Error('Неверный формат избранных условий. Исходная запись сохранена.');
  }
  const names = new Set(presets.map(preset => preset.name.toLocaleLowerCase('ru-RU')));
  const ids = new Set(presets.map(preset => preset.id));
  if (names.size !== presets.length || ids.size !== presets.length) {
    throw new Error('Повторяющиеся избранные условия. Исходная запись сохранена.');
  }
  return presets;
}

export function savePreset(name: string, conditions: Conditions, rule: RoundRule, numberedArrows?: boolean | null): TrainingPreset[] {
  const cleanName = name.trim();
  if (!validName(cleanName)) throw new Error('Имя должно содержать от 1 до 60 символов.');
  if (!isConditions(conditions) || !isRoundRule(rule)) throw new Error('Проверь условия тренировки.');
  const previous = loadPresets();
  if (previous.some(preset => preset.name.toLocaleLowerCase('ru-RU') === cleanName.toLocaleLowerCase('ru-RU'))) {
    throw new Error('Условия с таким именем уже существуют.');
  }
  if (previous.length >= 64) throw new Error('Можно сохранить не более 64 наборов условий.');
  const preset = { id: crypto.randomUUID(), name: cleanName, conditions: structuredClone(conditions), rule: { ...rule },
    ...(numberedArrows == null ? {} : { numberedArrows }) };
  const next = [...previous, preset];
  appStorage.setItem(presetsKey, JSON.stringify({ version: 1, presets: next }));
  return next;
}

export function removePreset(id: string): TrainingPreset[] {
  const previous = loadPresets();
  const next = previous.filter(preset => preset.id !== id);
  if (next.length !== previous.length) appStorage.setItem(presetsKey, JSON.stringify({ version: 1, presets: next }));
  return next;
}
