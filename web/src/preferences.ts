import { appStorage } from './app-storage.ts';
import { isDisabledStatistics, isReportOrder } from './statistics-visibility.ts';
import type { ReportBlock, StatisticFeature } from './statistics-visibility.ts';
import { isRankAssignments } from './assigned-ranks.ts';
import type { RankAssignment } from './assigned-ranks.ts';
import { isThemeMode, isThemeStyle } from './web-theme.ts';
import type { ThemeMode, ThemeStyle } from './web-theme.ts';

export const RECENT_PRACTICE_LIMIT = { min: 5, max: 20 };
export const AIM_SPEED_SETTING = { min: 20, max: 150, default: 70 };
export const LENS_ZOOM_SETTING = { min: 150, max: 600, default: 375 };
export type ShotMotionStyle = 'cards' | 'pulse';

export type TrainingPreferences = {
  hideScores: boolean;
  averageHundredths: boolean;
  animations: boolean;
  haptics: boolean;
  keepAwake: boolean;
  trainingOnLockScreen?: boolean;
  useSystemScale?: boolean;
  realArrowDiameter?: boolean;
  aimSpeedPercent?: number;
  lensZoomPercent?: number;
  shotMotionStyle?: ShotMotionStyle;
  rankCategory?: 'male' | 'female';
  disabledStatistics?: StatisticFeature[];
  distributionShare?: '10' | '10+9';
  recentPracticeLimit?: number;
  reportOrder?: ReportBlock[];
  displayName?: string;
  shootingBaseMinutes?: number;
  rankAssignments?: RankAssignment[];
  webReleaseSeen?: number;
  onboardingSeen?: boolean;
  themeStyle?: ThemeStyle;
  themeMode?: ThemeMode;
  showAchievementNotices?: boolean;
  showAchievementsDuringInput?: boolean;
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
    (record.useSystemScale === undefined || typeof record.useSystemScale === 'boolean') &&
    (record.realArrowDiameter === undefined || typeof record.realArrowDiameter === 'boolean') &&
    (record.aimSpeedPercent === undefined || typeof record.aimSpeedPercent === 'number' && Number.isInteger(record.aimSpeedPercent) &&
      record.aimSpeedPercent >= AIM_SPEED_SETTING.min && record.aimSpeedPercent <= AIM_SPEED_SETTING.max) &&
    (record.lensZoomPercent === undefined || typeof record.lensZoomPercent === 'number' && Number.isInteger(record.lensZoomPercent) &&
      record.lensZoomPercent >= LENS_ZOOM_SETTING.min && record.lensZoomPercent <= LENS_ZOOM_SETTING.max) &&
    (record.shotMotionStyle === undefined || record.shotMotionStyle === 'cards' || record.shotMotionStyle === 'pulse') &&
    (record.disabledStatistics === undefined || isDisabledStatistics(record.disabledStatistics)) &&
    (record.distributionShare === undefined || record.distributionShare === '10' || record.distributionShare === '10+9') &&
    (record.recentPracticeLimit === undefined || typeof record.recentPracticeLimit === 'number' &&
      Number.isInteger(record.recentPracticeLimit) && record.recentPracticeLimit >= RECENT_PRACTICE_LIMIT.min &&
      record.recentPracticeLimit <= RECENT_PRACTICE_LIMIT.max) &&
    (record.reportOrder === undefined || isReportOrder(record.reportOrder)) &&
    (record.displayName === undefined || typeof record.displayName === 'string' && record.displayName.length <= 40) &&
    (record.rankAssignments === undefined || isRankAssignments(record.rankAssignments)) &&
    (record.onboardingSeen === undefined || typeof record.onboardingSeen === 'boolean') &&
    (record.showAchievementNotices === undefined || typeof record.showAchievementNotices === 'boolean') &&
    (record.showAchievementsDuringInput === undefined || typeof record.showAchievementsDuringInput === 'boolean') &&
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
