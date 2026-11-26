import { confirmedExerciseRanks, exerciseRank } from './exercise-rank.ts';
import { calculateProgress } from './progress-scoring.ts';
import { RANK_LABELS } from './sport-ranks.ts';
import { evaluateAchievementEvidence } from './achievement-evidence.ts';
import type { AchievementGrant } from './achievement-ledger.ts';
import type { RankCategory, RankThreshold } from './sport-ranks.ts';
import type { DiaryEntry } from './persistence.ts';
import type { Series } from './practice.ts';
import type { PersonalRecordEvent } from './personal-record-events.ts';

const cleanSeriesAwards = [{ id: 'HIT02', arrows: 6 }, { id: 'HIT01', arrows: 3 }] as const;
type CleanSeriesAwardId = typeof cleanSeriesAwards[number]['id'];

export type TrainingMoment =
  | { kind: 'rank'; level: RankThreshold['label'] }
  | { kind: 'record'; recordKind: PersonalRecordEvent['kind']; label: string; previous: number; value: number }
  | { kind: 'progress'; previous: number; value: number; distance: number }
  | { kind: 'series'; arrows: number; achievementId?: CleanSeriesAwardId };

function seriesIn(entry: DiaryEntry): Series[] {
  return entry.practice.rounds.flatMap(round => round.series);
}

function bowOf(series: Series) {
  return series.conditions.equipment?.bow.category ?? null;
}

export function hasFinishedCleanSeries(history: readonly DiaryEntry[], bow: ReturnType<typeof bowOf>, sessionId: string) {
  return history.some(entry => entry.id !== sessionId && !entry.deletedAt && entry.practice.savedAt
    && seriesIn(entry).some(series => bowOf(series) === bow && isCleanSeries(series)));
}

function isCleanSeries(series: Series) {
  const volume = series.shots.length;
  return volume >= 3 && (series.plannedCount === undefined || volume === series.plannedCount)
    && series.shots.every(shot => shot.points === 10);
}

export function trainingMoment(entry: DiaryEntry, history: readonly DiaryEntry[], category: RankCategory | null,
  records: readonly PersonalRecordEvent[], grants: readonly AchievementGrant[] = []): TrainingMoment | undefined {
  const series = seriesIn(entry);
  if (!entry.practice.savedAt || entry.deletedAt || entry.source || entry.nativeArchiveSession
    || series.some(end => end.shots.some(shot => shot.imported))) return;
  const previous = history.filter(item => item.id !== entry.id && !item.deletedAt && item.practice.savedAt
    && Date.parse(item.practice.savedAt) < Date.parse(entry.practice.savedAt!));
  const rank = exerciseRank(entry.practice, category);
  const evaluation = rank.finalResult ? rank.evaluation : null;
  if (evaluation?.result) {
    const level = evaluation.result.label;
    const previouslyReached = previous.some(item => confirmedExerciseRanks(item.practice, category).some(past =>
      past.evaluation.exercise.id === evaluation.exercise.id && past.evaluation.result &&
      RANK_LABELS.indexOf(past.evaluation.result.label) <= RANK_LABELS.indexOf(level)));
    if (!previouslyReached) return { kind: 'rank', level };
  }
  const seriesGrants = grants.filter(grant => grant.sessionId === entry.id && grant.valid !== false
    && cleanSeriesAwards.some(award => grant.id === award.id));
  if (seriesGrants.length) {
    // A series may have been edited since its grant. Check this training's final result.
    const evidence = evaluateAchievementEvidence([entry]);
    const award = cleanSeriesAwards.find(({ id }) => seriesGrants.some(grant => grant.id === id
      && evidence.some(item => item.id === id && item.scope === grant.scope && item.progress >= 1)));
    if (award) return { kind: 'series', arrows: award.arrows, achievementId: award.id };
  }
  const clean = series.find(end => isCleanSeries(end) && !hasFinishedCleanSeries(previous, bowOf(end), entry.id));
  if (clean) return { kind: 'series', arrows: clean.shots.length };
  const record = records.find(item => item.kind !== 'volume');
  if (record) return { kind: 'record', recordKind: record.kind, label: record.label, previous: record.previousValue, value: record.value };

  const groups = new Map<number, Series[]>();
  for (const end of series) {
    if (end.progressBaselineId === undefined || !end.shots.length) continue;
    const group = groups.get(end.progressBaselineId);
    if (group) group.push(end);
    else groups.set(end.progressBaselineId, [end]);
  }
  let best: Extract<TrainingMoment, { kind: 'progress' }> | undefined;
  for (const [id, ends] of groups) {
    const baseline = entry.practice.progressBaselines?.[String(id)];
    if (!baseline || baseline.status !== 'ready' || baseline.sources.length < 3) continue;
    const result = calculateProgress(baseline, ends);
    if (!result?.fullRankAvailable || result.scoredCount < 30 || result.currentAverage === null || result.baselineAverage === null) continue;
    const improvement = result.currentAverage - result.baselineAverage;
    if (improvement + 1e-10 >= .5 && (!best || improvement > best.value - best.previous)) {
      best = { kind: 'progress', previous: result.baselineAverage, value: result.currentAverage, distance: ends[0].conditions.distanceMeters };
    }
  }
  if (best) return best;
  if (records[0]) return { kind: 'record', recordKind: records[0].kind, label: records[0].label, previous: records[0].previousValue, value: records[0].value };
}
