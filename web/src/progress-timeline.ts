import type { Conditions } from './conditions.ts';
import { calculateCompositeScore } from './composite-scoring.ts';
import { BOW_CATEGORIES } from './equipment.ts';
import { hitGeometry } from './hit-map.ts';
import { isLocalDate } from './import-source.ts';
import type { DiaryEntry } from './persistence.ts';
import type { TrainingPreferences } from './preferences.ts';
import type { Series } from './practice.ts';
import { progressConditionKey } from './progress-scoring.ts';
import { statisticVisible } from './statistics-visibility.ts';
import { acceptsDiameter, getTargetProfile } from './target.ts';

export const TIMELINE_VISIBLE_DAYS = 30;
const DAY = 86_400_000;
export const TIMELINE_METRICS = [
  { key: 'average', feature: 'average', label: 'Средний балл', unit: '/ 10' },
  { key: 'rms', feature: 'grouping', label: 'Кучность RMS', unit: 'мм' },
  { key: 'tenShare', feature: 'zone_trend', label: 'Доля десяток', unit: '%' },
  { key: 'xShare', feature: 'zone_trend', label: 'Доля X', unit: '%' },
  { key: 'missShare', feature: 'zone_trend', label: 'Доля промахов', unit: '%' },
  { key: 'cg3', feature: 'general_score', label: 'Общие очки CG3', unit: '%' },
] as const;
export type TimelineMetric = typeof TIMELINE_METRICS[number]['key'];
export type TimelinePoint = {
  id: string; sessionId: string; title: string; date: string; day: number; x: number;
  values: Record<TimelineMetric, number | null>; arrows: number;
  geometry: { rmsMm: number; shiftMm: number; known: number } | null;
};
export type TimelineGroup = { key: string; label: string; comparable: boolean; points: TimelinePoint[] };
export type ProgressPeriod = 0 | 7 | 30 | 90 | -1;
export type ProgressFilters = { period: ProgressPeriod; from: string; to: string; sessionIds: readonly string[] | null; conditionKey: string | null };
export const DEFAULT_PROGRESS_FILTERS: ProgressFilters = { period: 0, from: '', to: '', sessionIds: null, conditionKey: null };

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

export function progressPeriodRange(filters: ProgressFilters, today = localToday()): { valid: boolean; from: string | null; to: string | null } {
  if (filters.period === 0) return { valid: true, from: null, to: null };
  if (filters.period === -1) return { valid: isLocalDate(filters.from) && isLocalDate(filters.to) && filters.from <= filters.to,
    from: filters.from, to: filters.to };
  if (!isLocalDate(today)) return { valid: false, from: null, to: null };
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - filters.period + 1);
  return { valid: true, from: end.toISOString().slice(0, 10), to: today };
}

export function timelineConditionKey(entry: Pick<DiaryEntry, 'id'>, series: Series): string {
  return progressConditionKey(series.conditions) ?? JSON.stringify(['uncompared', entry.id, series.conditions.distanceMeters,
    series.conditions.targetDiameterMm, series.conditions.targetProfileId, series.conditions.equipment?.bow.category ?? null]);
}

/** View projection only. Manual IDs are retained by the caller when the period changes. */
export function filterProgressEntries(entries: readonly DiaryEntry[], filters: ProgressFilters, today = localToday()): DiaryEntry[] {
  const range = progressPeriodRange(filters, today);
  if (!range.valid) return [];
  const selected = filters.sessionIds === null ? null : new Set(filters.sessionIds);
  return entries.flatMap(entry => {
    if (entry.deletedAt || entry.practice.savedAt === null || selected && !selected.has(entry.id)) return [];
    const date = timelineDate(entry);
    if (range.from !== null && (!date || date < range.from || date > range.to!)) return [];
    if (filters.conditionKey === null) return [entry];
    const rounds = entry.practice.rounds.flatMap(round => {
      const series = round.series.filter(item => item.shots.length && timelineConditionKey(entry, item) === filters.conditionKey);
      return series.length ? [{ ...round, series }] : [];
    });
    return rounds.length ? [{ ...entry, practice: { ...entry.practice, rounds } }] : [];
  });
}

/** Unknown import dates remain unknown; imported local dates take precedence over noon placeholders. */
export function timelineDate(entry: DiaryEntry): string | null {
  if (entry.localDate === null) return null;
  if (entry.localDate !== undefined) return isLocalDate(entry.localDate) ? entry.localDate : null;
  if (!entry.startedAt || !Number.isFinite(Date.parse(entry.startedAt))) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(entry.startedAt)) return isLocalDate(entry.startedAt) ? entry.startedAt : null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(entry.startedAt) || !isLocalDate(entry.startedAt.slice(0, 10))) return null;
  const date = new Date(entry.startedAt);
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}
function conditionLabel(conditions: Conditions): string {
  const bow = BOW_CATEGORIES.find(item => item.value === conditions.equipment?.bow.category)?.label ?? 'Класс лука неизвестен';
  return `${conditions.distanceMeters.toLocaleString('ru-RU')} м · Ø ${(conditions.targetDiameterMm / 10).toLocaleString('ru-RU')} см · ${getTargetProfile(conditions.targetProfileId)?.title ?? 'Мишень неизвестна'} · ${bow}`;
}
function measurements(series: readonly Series[]): Pick<TimelinePoint, 'values' | 'arrows' | 'geometry'> {
  const shots = series.flatMap(item => item.shots), conditions = series[0].conditions;
  const profile = getTargetProfile(conditions.targetProfileId);
  const verifiedTarget = !!profile && acceptsDiameter(profile, conditions.targetDiameterMm);
  const measured = verifiedTarget ? hitGeometry(shots, conditions.targetDiameterMm) : null;
  const geometry = measured && measured.rmsMm !== null ? { rmsMm: measured.rmsMm, shiftMm: measured.shiftMm, known: measured.known } : null;
  const ends = series.map((item, index) => ({ id: item.id, number: index + 1, plannedCount: item.plannedCount ?? Math.max(3, item.shots.length), closed: true, shots: item.shots }));
  const composite = calculateCompositeScore(ends, ends.length, profile ? Math.max(...profile.zones.map(zone => zone.points)) : null, verifiedTarget);
  const share = (matches: (shot: Series['shots'][number]) => boolean) =>
    shots.length ? 100 * shots.filter(matches).length / shots.length : null;
  const xKnown = shots.some(shot => shot.code === 'X') || (verifiedTarget && profile.zones.some(zone => zone.code === 'X'));
  return { arrows: shots.length, geometry, values: {
    average: shots.length ? shots.reduce((sum, shot) => sum + shot.points, 0) / shots.length : null,
    rms: geometry?.rmsMm ?? null, tenShare: share(shot => shot.points === 10),
    xShare: xKnown ? share(shot => shot.code === 'X') : null, missShare: share(shot => shot.points === 0),
    cg3: composite.availability === 'available' ? composite.total ?? null : null,
  } };
}

/** One point per saved training and condition group. Equipment identities never define comparison. */
export function buildProgressTimeline(entries: readonly DiaryEntry[]): TimelineGroup[] {
  const groups = new Map<string, TimelineGroup>();
  for (const entry of entries) {
    if (entry.practice.savedAt === null || entry.deletedAt) continue;
    const date = timelineDate(entry); if (!date) continue;
    const slices = new Map<string, Series[]>();
    for (const series of entry.practice.rounds.flatMap(round => round.series)) {
      if (!series.shots.length) continue;
      // An unknown bow class cannot establish comparability between two trainings.
      const key = timelineConditionKey(entry, series);
      const selected = slices.get(key) ?? []; selected.push(series); slices.set(key, selected);
    }
    for (const [key, series] of slices) {
      let group = groups.get(key);
      if (!group) {
        const comparable = progressConditionKey(series[0].conditions) !== null;
        group = { key, label: conditionLabel(series[0].conditions) + (comparable ? '' : ` · ${date} · ${entry.title ?? entry.id}`), comparable, points: [] };
        groups.set(key, group);
      }
      const day = Date.parse(`${date}T00:00:00Z`) / DAY;
      group.points.push({ id: `${entry.id}:${key}`, sessionId: entry.id, title: entry.title ?? 'Тренировка', date, day, x: day,
        ...measurements(series) });
    }
  }
  for (const group of groups.values()) {
    group.points.sort((a, b) => a.day - b.day || a.sessionId.localeCompare(b.sessionId));
    let start = 0;
    while (start < group.points.length) {
      let end = start + 1;
      while (end < group.points.length && group.points[end].day === group.points[start].day) end++;
      for (let index = start; index < end; index++) group.points[index].x += (index - start + 1) / (end - start + 1);
      start = end;
    }
  }
  return [...groups.values()].sort((a, b) => b.points.at(-1)!.x - a.points.at(-1)!.x || a.label.localeCompare(b.label));
}
export function availableTimelineMetrics(group: TimelineGroup, preferences: TrainingPreferences): TimelineMetric[] {
  if (!statisticVisible(preferences, 'progress_trend')) return [];
  return TIMELINE_METRICS.filter(metric => statisticVisible(preferences, metric.feature) &&
    group.points.some(point => point.values[metric.key] !== null)).map(metric => metric.key);
}
export function timelineViewport(points: readonly TimelinePoint[], requestedEnd?: number | null) {
  let first = Infinity, latest = -Infinity;
  for (const point of points) { first = Math.min(first, point.day); latest = Math.max(latest, point.day); }
  const latestEnd = points.length ? latest + 1 : 0;
  const firstDay = points.length ? Math.min(first, latestEnd - TIMELINE_VISIBLE_DAYS) : -TIMELINE_VISIBLE_DAYS;
  const earliestEnd = firstDay + TIMELINE_VISIBLE_DAYS;
  const end = Math.min(latestEnd, Math.max(earliestEnd, requestedEnd ?? latestEnd));
  return { firstDay, latestEnd, earliestEnd, start: end - TIMELINE_VISIBLE_DAYS, end };
}
export function timelineCeiling(points: readonly TimelinePoint[], metric: TimelineMetric): number {
  if (metric === 'average') return 10;
  if (metric === 'tenShare' || metric === 'xShare' || metric === 'missShare') return 100;
  if (metric === 'cg3') return 105;
  return Math.max(10, Math.ceil(points.reduce((maximum, point) => Math.max(maximum, point.values.rms ?? 0), 0) / 10) * 10);
}
