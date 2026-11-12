import type { TrainingPreferences } from './preferences.ts';

const sections = [
  { title: 'Основные показатели', items: [
    ['result', 'Классические очки'], ['average', 'Средний балл'], ['volume', 'Стрелы и тренировки'], ['training_time', 'Время тренировки'],
    ['series', 'Результаты раундов и серий'],
  ] },
  { title: 'Оценка и прогресс', items: [
    ['general_score', 'Общие очки'], ['stability', 'Стабильность'],
    ['progress_score', 'Прогрессивные очки'], ['norms', 'Нормативы и разряд'], ['records', 'Личные рекорды'],
  ] },
  { title: 'Попадания', items: [
    ['grouping', 'Кучность'], ['offset', 'Смещение от центра'], ['hit_map', 'Карта попаданий'], ['numbered_arrows', 'По номерам стрел'],
  ] },
  { title: 'Графики', items: [
    ['mean_trend', 'Средний балл по сериям'], ['distribution', 'Распределение попаданий'],
    ['zone_trend', 'Доля десяток'], ['progress_trend', 'Динамика прогресса'], ['geometry_trend', 'Кучность и точность по занятиям'],
  ] },
] as const;

export const STATISTIC_SECTIONS = sections;
type AvailableStatistic = typeof sections[number]['items'][number][0];
const future = [] as const;
export type StatisticFeature = AvailableStatistic | typeof future[number];

const keys = new Set<string>([...sections.flatMap(section => section.items.map(([key]) => key)), ...future]);

export function isDisabledStatistics(value: unknown): value is StatisticFeature[] {
  return Array.isArray(value) && value.length <= keys.size && new Set(value).size === value.length &&
    Array.from(value).every(key => typeof key === 'string' && keys.has(key));
}

export function statisticVisible(preferences: TrainingPreferences, feature: StatisticFeature): boolean {
  return !preferences.disabledStatistics?.includes(feature);
}
