import { appStorage } from './app-storage.ts';
import { isDisabledStatistics } from './statistics-visibility.ts';
import type { StatisticFeature } from './statistics-visibility.ts';
import { isRankAssignments } from './assigned-ranks.ts';
import type { RankAssignment } from './assigned-ranks.ts';
import { isThemeMode, isThemeStyle } from './web-theme.ts';
import type { ThemeMode, ThemeStyle } from './web-theme.ts';

export type TrainingPreferences = {
  hideScores: boolean;
  averageHundredths: boolean;
  animations: boolean;
  haptics: boolean;
  keepAwake: boolean;
  trainingOnLockScreen?: boolean;
  rankCategory?: 'male' | 'female';
  disabledStatistics?: StatisticFeature[];
  displayName?: string;
  shootingBaseMinutes?: number;
  rankAssignments?: RankAssignment[];
  webReleaseSeen?: number;
  onboardingSeen?: boolean;
  themeStyle?: ThemeStyle;
  themeMode?: ThemeMode;
  showAchievementNotices?: boolean;
};

export const DEFAULT_PREFERENCES: TrainingPreferences = {
  hideScores: false, averageHundredths: false, animations: true, haptics: false, keepAwake: true,
};
const storageKey = 'app.fableshot.training-preferences.v1';

export function valid(value: unknown): value is TrainingPreferences {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Object.keys(DEFAULT_PREFERENCES).every(key => typeof record[key] === 'boolean') &&
    (record.rankCategory === undefined || record.rankCategory === 'male' || record.rankCategory === 'female') &&
    (record.disabledStatistics === undefined || isDisabledStatistics(record.disabledStatistics)) &&
    (record.displayName === undefined || typeof record.displayName === 'string' && record.displayName.length <= 40) &&
    (record.rankAssignments === undefined || isRankAssignments(record.rankAssignments)) &&
    (record.onboardingSeen === undefined || typeof record.onboardingSeen === 'boolean') &&
    (record.showAchievementNotices === undefined || typeof record.showAchievementNotices === 'boolean') &&
    (record.trainingOnLockScreen === undefined || typeof record.trainingOnLockScreen === 'boolean') &&
    (record.themeStyle === undefined || isThemeStyle(record.themeStyle)) &&
    (record.themeMode === undefined || isThemeMode(record.themeMode)) &&
    (record.webReleaseSeen === undefined || typeof record.webReleaseSeen === 'number' && Number.isSafeInteger(record.webReleaseSeen) && record.webReleaseSeen > 0) &&
    (record.shootingBaseMinutes === undefined || typeof record.shootingBaseMinutes === 'number' && Number.isInteger(record.shootingBaseMinutes) &&
      record.shootingBaseMinutes >= 0 && record.shootingBaseMinutes <= 59_999_999);
}

export function loadPreferences(): TrainingPreferences {
  const raw = appStorage.getItem(storageKey);
  if (raw === null) return { ...DEFAULT_PREFERENCES };
  let decoded: unknown;
  try { decoded = JSON.parse(raw); }
  catch (cause) { throw new Error('Не удалось прочитать настройки тренировки. Исходная запись сохранена.', { cause }); }
  const envelope = decoded as { version?: unknown; preferences?: unknown } | null;
  if (envelope?.version !== 1 || !valid(envelope.preferences)) throw new Error('Неверный формат настроек тренировки.');
  return { ...envelope.preferences };
}

export function savePreferences(value: TrainingPreferences): void {
  if (!valid(value)) throw new Error('Проверь настройки тренировки.');
  loadPreferences();
  appStorage.setItem(storageKey, JSON.stringify({ version: 1, preferences: value }));
}

export function formatAverage(value: number | null, hundredths: boolean): string {
  return value === null ? '—' : value.toLocaleString('ru-RU', {
    minimumFractionDigits: hundredths ? 2 : 1, maximumFractionDigits: hundredths ? 2 : 1,
  });
}
