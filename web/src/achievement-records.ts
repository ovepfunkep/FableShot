import { ACHIEVEMENT_BOW_LABELS } from './achievement-catalog.ts';
import type { AchievementBowScope } from './achievement-catalog.ts';
import { conditionsKey } from './composite-scoring.ts';
import { exerciseRank } from './exercise-rank.ts';
import { isLocalDate } from './import-source.ts';
import type { DiaryEntry } from './persistence.ts';
import type { Series } from './practice.ts';
import type { RankCategory } from './sport-ranks.ts';
import { acceptsDiameter, getTargetProfile, summarize } from './target.ts';

export type AchievementRecordEvidence = {
  id: 'PROGRESS04' | 'PROGRESS06' | 'PROGRESS10';
  scope: AchievementBowScope;
  progress: 1;
};
type SeriesFact = { key: string; arrows: number; points: number };
type PreviousRecords = { entry: DiaryEntry; series: SeriesFact[]; arrows: number };
type DatedScore = { points: number; date: string | null };

function scopeFor(series: Series): AchievementBowScope | undefined {
  const category = series.conditions.equipment?.bow.category;
  return category && Object.hasOwn(ACHIEVEMENT_BOW_LABELS, category) ? category as AchievementBowScope : undefined;
}

function fullSeriesFacts(entry: DiaryEntry): SeriesFact[] {
  return entry.practice.rounds.flatMap(round => round.series).flatMap(series => {
    const { conditions, shots } = series;
    const profile = getTargetProfile(conditions.targetProfileId);
    const planned = series.plannedCount ?? Math.max(3, shots.length);
    if (!shots.length || shots.length !== planned || !conditions.equipment || !profile ||
      !acceptsDiameter(profile, conditions.targetDiameterMm)) return [];
    return [{ key: conditionsKey(conditions), arrows: shots.length, points: summarize(shots).points }];
  });
}

function localDate(entry: DiaryEntry): string | null {
  if (entry.localDate !== undefined) return isLocalDate(entry.localDate) ? entry.localDate : null;
  if (isLocalDate(entry.startedAt)) return entry.startedAt;
  const date = new Date(entry.startedAt);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('sv-SE').format(date) : null;
}

function plusCalendarMonth(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = new Date(0);
  end.setUTCFullYear(nextYear, nextMonth, 0);
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, end.getUTCDate())).padStart(2, '0')}`;
}

function improved(points: number, previous: readonly DatedScore[]): { better: boolean; oldestBestDate: string | null } {
  let best = -Infinity;
  let oldestBestDate: string | null = null;
  for (const fact of previous) {
    if (fact.points > best) {
      best = fact.points;
      oldestBestDate = fact.date;
    } else if (fact.points === best && fact.date && (!oldestBestDate || fact.date < oldestBestDate)) oldestBestDate = fact.date;
  }
  return { better: previous.length > 0 && points > best, oldestBestDate };
}

/** History must contain only data present before this candidate's completion, including imported and legacy records. */
export function evaluateAchievementRecords(candidate: DiaryEntry, previousHistory: readonly DiaryEntry[],
  rankCategory: RankCategory | null = candidate.achievementEnrollment?.rankCategory ?? null): AchievementRecordEvidence[] {
  const { practice } = candidate;
  if (!candidate.achievementEnrollment || candidate.source || candidate.deletedAt || practice.savedAt === null) return [];
  const cutoff = Date.parse(practice.savedAt);
  const candidateSeries = practice.rounds.flatMap(round => round.series);
  if (!Number.isFinite(cutoff) || candidateSeries.some(series => series.shots.some(shot => shot.imported))) return [];
  const facts = fullSeriesFacts(candidate);
  if (!facts.length) return [];
  const previous: PreviousRecords[] = [];
  const ids = new Set<string>([candidate.id]);
  for (const entry of previousHistory) {
    if (ids.has(entry.id) || entry.deletedAt || entry.practice.savedAt === null) continue;
    const completed = Date.parse(entry.practice.savedAt);
    const arrived = Date.parse(entry.createdAt ?? entry.startedAt);
    if (!Number.isFinite(completed) || completed > cutoff || !Number.isFinite(arrived) || arrived > cutoff) continue;
    ids.add(entry.id);
    previous.push({ entry, series: fullSeriesFacts(entry), arrows: entry.practice.rounds.reduce((total, round) =>
      total + round.series.reduce((sum, series) => sum + series.shots.length, 0), 0) });
  }
  const output = new Map<string, AchievementRecordEvidence>();
  const date = localDate(candidate);
  function record(id: AchievementRecordEvidence['id'], scope: AchievementBowScope, points: number, scores: readonly DatedScore[]) {
    const { better, oldestBestDate } = improved(points, scores);
    if (!better) return;
    output.set(`${id}:${scope}`, { id, scope, progress: 1 });
    if (date && oldestBestDate && date >= plusCalendarMonth(oldestBestDate)) {
      output.set(`PROGRESS10:${scope}`, { id: 'PROGRESS10', scope, progress: 1 });
    }
  }

  const scopes = new Map<string, AchievementBowScope>();
  for (const series of candidateSeries) {
    const scope = scopeFor(series);
    if (scope && series.shots.length) scopes.set(conditionsKey(series.conditions), scope);
  }
  for (const fact of facts) {
    const scope = scopes.get(fact.key);
    if (!scope) continue;
    const scores = previous.flatMap(history => history.series.filter(item => item.key === fact.key && item.arrows === fact.arrows)
      .map(item => ({ points: item.points, date: localDate(history.entry) })));
    record('PROGRESS04', scope, fact.points, scores);
  }

  const rank = exerciseRank(practice, rankCategory ?? 'male');
  const key = scopes.size === 1 ? scopes.keys().next().value : undefined;
  if (rank.finalResult && rank.evaluation && rank.bow && key !== undefined) {
    const volume = rank.evaluation.exercise.arrows;
    const scores = previous.flatMap(history => {
      const matched = history.series.filter(item => item.key === key);
      const arrows = matched.reduce((sum, item) => sum + item.arrows, 0);
      if (arrows !== volume || history.arrows !== volume) return [];
      return [{ points: matched.reduce((sum, item) => sum + item.points, 0), date: localDate(history.entry) }];
    });
    record('PROGRESS06', rank.bow, rank.evaluation.points, scores);
  }
  return [...output.values()];
}
