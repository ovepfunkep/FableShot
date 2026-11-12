import { ACHIEVEMENT_BOW_LABELS } from './achievement-catalog.ts';
import type { AchievementBowScope, AchievementScope } from './achievement-catalog.ts';
import { calculateCompositeScore, conditionsKey, displayCompositeScore, SCORE_ONLY_PROFILE, STANDARD_PROFILE } from './composite-scoring.ts';
import { exerciseRank } from './exercise-rank.ts';
import { hitGeometry } from './hit-map.ts';
import type { DiaryEntry } from './persistence.ts';
import type { Series } from './practice.ts';
import { calculateProgress, progressConditionKey } from './progress-scoring.ts';
import type { ProgressBaseline } from './progress-scoring.ts';
import type { RankCategory, RankThreshold } from './sport-ranks.ts';
import { acceptsDiameter, getTargetProfile, summarize } from './target.ts';

export const ACHIEVEMENT_EVIDENCE_RULE_IDS = [
  'START01', 'START02', 'START03', 'START05', 'START06', 'START07', 'START08', 'START09', 'START10',
  'HIT01', 'HIT02', 'HIT06', 'HIT07', 'HIT08', 'HIT09', 'HIT10',
  'SCORE01', 'SCORE02', 'SCORE03', 'SCORE04', 'SCORE05', 'SCORE06',
  'GROUP01', 'GROUP02', 'GROUP03', 'GROUP04', 'GROUP05', 'GROUP06', 'GROUP08',
  'STEADY01', 'STEADY02', 'STEADY03', 'STEADY04', 'STEADY05', 'STEADY06', 'STEADY08',
  'RANK04', 'RANK05', 'RANK06', 'RANK07', 'RANK08', 'RANK09', 'PROGRESS01', 'PROGRESS02', 'PROGRESS03', 'PROGRESS08', 'STORY01',
  'GEAR02', 'GEAR03', 'GEAR06',
] as const;

type EvidenceRuleId = typeof ACHIEVEMENT_EVIDENCE_RULE_IDS[number];
export type AchievementEvidence = { id: EvidenceRuleId; scope: AchievementScope; progress: number };
type RecordEvidence = (id: EvidenceRuleId, scope: AchievementScope, progress?: number) => void;
type EvidenceEnd = { series: Series; key: string; plannedCount: number; closed: boolean; full: boolean; points: number; perfect: boolean };
type RepeatedEvidence = { scope: AchievementBowScope; sessions: Set<string> };

const scoreThresholds = [
  ['SCORE01', 30, 5], ['SCORE02', 30, 7], ['SCORE03', 30, 8], ['SCORE04', 60, 9], ['SCORE05', 60, 9.5],
] as const;
const progressThresholds = [['PROGRESS01', 12, 1], ['PROGRESS02', 12, 5], ['PROGRESS03', 30, 10]] as const;
const rankIds: Partial<Record<RankThreshold['label'], EvidenceRuleId>> = {
  III: 'RANK04', II: 'RANK05', I: 'RANK06', КМС: 'RANK07', МС: 'RANK08', МСМК: 'RANK09',
};

function bowScope(series: Series): AchievementBowScope | undefined {
  const category = series.conditions.equipment?.bow.category;
  return category && Object.hasOwn(ACHIEVEMENT_BOW_LABELS, category) ? category as AchievementBowScope : undefined;
}

function verifiedTarget(series: Series) {
  const profile = getTargetProfile(series.conditions.targetProfileId);
  return profile && acceptsDiameter(profile, series.conditions.targetDiameterMm) ? profile : undefined;
}

function tally(ends: readonly EvidenceEnd[]) {
  return ends.reduce(({ arrows, points }, end) => ({ arrows: arrows + end.series.shots.length, points: points + end.points }),
    { arrows: 0, points: 0 });
}

function scoringEnd(end: EvidenceEnd, number: number) {
  return { id: end.series.id, number, plannedCount: end.plannedCount, shots: end.series.shots, closed: end.full };
}

function stability(ends: readonly EvidenceEnd[]): number | undefined {
  return calculateCompositeScore(ends.map((end, index) => scoringEnd(end, index + 1)), ends.length, 10, false, SCORE_ONLY_PROFILE).stability;
}

function evaluateSeriesStories(ends: readonly EvidenceEnd[], completed: boolean, record: RecordEvidence) {
  let previousKey: string | undefined;
  let priorFull = 0;
  const tight: EvidenceEnd[] = [];
  for (const end of ends) {
    if (end.key !== previousKey) tight.length = 0;
    previousKey = end.key;
    const target = verifiedTarget(end.series);
    if (!target || !end.full || !end.closed) {
      tight.length = 0;
      continue;
    }
    const scope = bowScope(end.series);
    const maximum = Math.max(...target.zones.map(zone => zone.points));
    if (scope && completed && end === ends.at(-1) && priorFull >= 5 && end.points === maximum * end.series.shots.length) {
      record('STORY01', scope);
    }
    priorFull++;
    const { shots } = end.series;
    if (!scope || shots.length < 3 || shots.some(shot => !shot.point)) {
      tight.length = 0;
      continue;
    }
    const { q } = calculateCompositeScore([scoringEnd(end, 1)], 1, maximum, true, STANDARD_PROFILE, true);
    if (q === undefined || q < .5) {
      tight.length = 0;
      continue;
    }
    tight.push(end);
    if (tight.length > 5) tight.shift();
    if (tight.length === 5) {
      const { arrows, points } = tally(tight);
      if (points >= 7 * arrows) record('GROUP05', scope);
    }
  }
}

function evaluateFormatSeries(end: EvidenceEnd, qualify: (id: EvidenceRuleId, condition: boolean) => void) {
  const { shots } = end.series;
  const count = shots.length;
  qualify('HIT01', count === 3 && end.perfect);
  qualify('HIT02', count === 6 && end.perfect);

  if (count < 3) return;
  const geometry = hitGeometry(shots, end.series.conditions.targetDiameterMm);
  if (!geometry || geometry.known !== count || geometry.rmsMm === null) return;
  const { rmsMm, shiftMm } = geometry;
  const mean = end.points / count;
  qualify('GROUP01', rmsMm <= 30 && mean >= 5);
  qualify('GROUP02', rmsMm <= 15 && mean >= 7);
  qualify('GROUP03', rmsMm <= 8 && mean >= 8);
  qualify('GROUP04', count >= 6 && rmsMm <= 12 && mean >= 8);
  qualify('GROUP06', rmsMm <= 6 && shiftMm > 30 && shots.every(shot => shot.points > 0));
  qualify('GROUP08', count === 3 && rmsMm <= 6 && mean >= 9);
}

function evaluateFormat(ends: readonly EvidenceEnd[], wholeTraining: boolean, qualify: (id: EvidenceRuleId, condition: boolean) => void): boolean {
  let run = 0;
  let runArrows = 0;
  for (const [index, end] of ends.entries()) {
    if (end.full) evaluateFormatSeries(end, qualify);
    if (end.full && end.perfect) {
      run++;
      runArrows += end.series.shots.length;
      qualify('HIT06', run >= 3 && runArrows >= 9);
      qualify('HIT07', run >= 5 && runArrows >= 15);
      qualify('HIT08', run >= 10 && runArrows >= 30);
    } else { run = 0; runArrows = 0; }

    if (index < 4 || !end.full) continue;
    const window = ends.slice(index - 4, index + 1);
    const count = end.series.shots.length;
    qualify('STEADY02', count * 5 >= 15 && end.points >= count * 6 &&
      window.every(item => item.full && item.series.shots.length === count && item.points === end.points));
  }

  if (ends.length >= 8) {
    const first = ends.slice(0, 3);
    const last = ends.slice(-5);
    if (first.every(end => end.full) && last.every(end => end.full) && (stability(last) ?? -1) >= .9) {
      const before = tally(first);
      const after = tally(last);
      qualify('STEADY05', after.points >= 7 * after.arrows);
      qualify('STEADY06', after.points / after.arrows - before.points / before.arrows >= 1);
    }
  }

  if (!wholeTraining || ends.some(end => !end.full)) return false;
  const { arrows, points } = tally(ends);
  for (const [id, minimumArrows, minimumMean] of scoreThresholds) {
    qualify(id, arrows >= minimumArrows && points >= minimumMean * arrows);
  }
  if (arrows >= 30) {
    qualify('SCORE06', ends.every(end => end.series.shots.every(shot => shot.points > 0)));
    if (ends[0].series.conditions.targetProfileId.startsWith('wa-')) {
      const yellow = ends.reduce((count, end) => count + end.series.shots.filter(shot => shot.points >= 9).length, 0);
      qualify('HIT09', yellow * 5 >= arrows * 4);
    }
  }
  qualify('HIT10', arrows === 60 && ends.every(end => end.perfect));
  if (ends.length < 8) return false;
  const consistent = stability(ends) ?? -1;
  qualify('STEADY01', ends.length >= 10 && arrows >= 30 && consistent >= .85 && points >= 6 * arrows);
  qualify('STEADY03', ends.length >= 15 && consistent >= .95 && points >= 8 * arrows);
  if (ends.length >= 10 && points >= 7 * arrows) {
    let lowest = Infinity;
    let highest = -Infinity;
    for (const end of ends) {
      const mean = end.points / end.series.shots.length;
      lowest = Math.min(lowest, mean);
      highest = Math.max(highest, mean);
    }
    qualify('STEADY04', highest - lowest <= 1);
  }
  return consistent >= .9;
}

function addRepeated(groups: Map<string, RepeatedEvidence>, key: string, scope: AchievementBowScope, entryId: string) {
  const group = groups.get(key);
  if (group) group.sessions.add(entryId);
  else groups.set(key, { scope, sessions: new Set([entryId]) });
}

function baselineComparison({ frozenAt: _frozenAt, ...snapshot }: ProgressBaseline): string {
  return JSON.stringify(snapshot);
}

function evaluateProgress(entry: DiaryEntry, ends: readonly EvidenceEnd[], scope: AchievementBowScope,
  record: RecordEvidence, repeated: Map<string, RepeatedEvidence>) {
  const blocks = new Map<number, EvidenceEnd[]>();
  for (const end of ends) {
    const id = end.series.progressBaselineId;
    if (id === undefined) continue;
    const block = blocks.get(id);
    if (block) block.push(end);
    else blocks.set(id, [end]);
  }
  const samples = [...blocks].flatMap(([id, block]) => {
    const baseline = entry.practice.progressBaselines?.[id];
    return baseline ? [{ baseline, block }] : [];
  });
  const first = samples[0];
  const sharedSnapshot = samples.length > 1 && samples.reduce((count, sample) => count + sample.block.length, 0) === ends.length &&
    samples.every(sample => baselineComparison(sample.baseline) === baselineComparison(first.baseline));
  const compared = sharedSnapshot ? [{ baseline: first.baseline, block: ends }] : samples;
  for (const { baseline, block } of compared) {
    const key = progressConditionKey(block[0].series.conditions);
    if (baseline.status !== 'ready' || baseline.scoreSum <= 0 || baseline.maximumPerArrow !== 10 ||
      key === null || baseline.conditionKey !== key || baseline.sessionStartCutoff === null ||
      Date.parse(baseline.sessionStartCutoff) !== Date.parse(entry.startedAt) ||
      !(Date.parse(baseline.frozenAt) >= Date.parse(entry.startedAt))) continue;

    // Android counts the closed, full prefix of a comparison block.
    const incomplete = block.findIndex(end => !end.closed || !end.full);
    const prefix = incomplete < 0 ? block : block.slice(0, incomplete);
    const result = calculateProgress(baseline, prefix.map(end => end.series));
    if (!result?.fullRankAvailable || result.percentagePoints === null) continue;
    const gain = Number(displayCompositeScore(result.percentagePoints));
    for (const [ruleId, minimumArrows, minimumGain] of progressThresholds) {
      if (result.scoredCount >= minimumArrows && gain >= minimumGain) record(ruleId, scope);
    }
    if (entry.practice.savedAt !== null && incomplete < 0 && gain > 0) addRepeated(repeated, key, scope, entry.id);
  }
}

function savedIdentity(value: string | null | undefined): string | null {
  return value?.trim() ? value : null;
}

function gearTraining(series: readonly Series[]) {
  const bows = new Set<string | null>();
  const kits = new Set<string | null>();
  const distances = new Set<number>();
  let segmentDistance: number | null = null;
  let segmentArrows = 0;
  for (const item of series) {
    const equipment = item.conditions.equipment;
    if (item.shots.length) {
      bows.add(savedIdentity(equipment?.bow.id ?? equipment?.bowId));
      kits.add(savedIdentity(equipment?.id));
    }
    const recordedDistance = item.conditions.distanceMeters;
    const distance = Number.isFinite(recordedDistance) && recordedDistance > 0 ? recordedDistance : null;
    if (distance !== segmentDistance) {
      segmentDistance = distance;
      segmentArrows = 0;
    }
    if (distance !== null) {
      segmentArrows += item.shots.length;
      if (segmentArrows >= 12) distances.add(distance);
    }
  }
  return { bowId: bows.size === 1 ? bows.values().next().value : null,
    kitId: kits.size === 1 ? kits.values().next().value : null, distances };
}

/** The caller supplies sessions enrolled in achievements. Imported and trashed evidence is excluded here as well. */
export function evaluateAchievementEvidence(entries: readonly DiaryEntry[],
  rankCategoryFor?: (entry: DiaryEntry) => RankCategory | null): AchievementEvidence[] {
  const evidence = new Map<string, AchievementEvidence>();
  const repeatedStability = new Map<string, RepeatedEvidence>();
  const repeatedProgress = new Map<string, RepeatedEvidence>();
  const completedTrainings = new Set<string>();
  const evaluatedEntries = new Set<string>();
  const bowSessions = new Map<string, number>();
  const kitSessions = new Map<string, number>();
  const distances = new Set<number>();
  let liveArrows = 0;
  function record(id: EvidenceRuleId, scope: AchievementScope, progress = 1) {
    const key = `${id}:${scope}`;
    if (progress > (evidence.get(key)?.progress ?? 0)) evidence.set(key, { id, scope, progress });
  }

  for (const entry of entries) {
    if (entry.deletedAt || entry.source) continue;
    const { practice } = entry;
    const series = practice.rounds.flatMap(round => round.series);
    if (series.some(item => item.shots.some(shot => shot.imported))) continue;
    if (evaluatedEntries.has(entry.id)) continue;
    evaluatedEntries.add(entry.id);
    const complete = practice.savedAt !== null;
    const ends = series.map((item, index): EvidenceEnd => {
      const plannedCount = item.plannedCount ?? Math.max(3, item.shots.length);
      const points = summarize(item.shots).points;
      return { series: item, key: conditionsKey(item.conditions), plannedCount, closed: complete || index < series.length - 1,
        full: item.shots.length === plannedCount, points, perfect: points === 10 * item.shots.length };
    });
    const populated = ends.filter(end => end.series.shots.length > 0);
    if (!populated.length) continue;
    liveArrows += populated.reduce((count, end) => count + end.series.shots.length, 0);
    if (complete) {
      completedTrainings.add(entry.id);
      const gear = gearTraining(series);
      if (gear.bowId) bowSessions.set(gear.bowId, (bowSessions.get(gear.bowId) ?? 0) + 1);
      if (gear.kitId) kitSessions.set(gear.kitId, (kitSessions.get(gear.kitId) ?? 0) + 1);
      for (const distance of gear.distances) distances.add(distance);
    }
    const groups = new Map<string, EvidenceEnd[]>();
    for (const end of populated) {
      const group = groups.get(end.key);
      if (group) group.push(end);
      else groups.set(end.key, [end]);
    }

    for (const [key, group] of groups) {
      const first = group[0].series;
      const scope = bowScope(first);
      if (!scope || !verifiedTarget(first)) continue;
      const qualify = (id: EvidenceRuleId, condition: boolean) => { if (condition) record(id, scope); };
      qualify('START02', group.some(end => end.full && end.series.shots.some(shot => shot.points === 10)));
      qualify('START03', group.some(end => end.full && end.series.shots.length >= 3 && end.series.shots.every(shot => shot.points > 0)));
      if (first.conditions.distanceMeters === 18 && first.conditions.targetDiameterMm === 400 &&
        evaluateFormat(group, complete && groups.size === 1, qualify)) addRepeated(repeatedStability, key, scope, entry.id);
      evaluateProgress(entry, group, scope, record, repeatedProgress);
    }

    evaluateSeriesStories(ends, complete, record);
    const category = complete ? rankCategoryFor?.(entry) : null;
    if (category) {
      const rank = exerciseRank(practice, category);
      if (rank.finalResult && rank.evaluation && rank.bow) {
        for (const threshold of rank.evaluation.exercise.thresholds) {
          const id = rankIds[threshold.label];
          if (id && rank.evaluation.points >= threshold.score) record(id, rank.bow);
        }
      }
    }
  }

  record('START01', 'global', completedTrainings.size);
  record('START05', 'global', completedTrainings.size);
  record('START09', 'global', completedTrainings.size);
  record('START10', 'global', completedTrainings.size);
  for (const id of ['START06', 'START07', 'START08'] as const) record(id, 'global', liveArrows);
  for (const { scope, sessions } of repeatedStability.values()) {
    if (sessions.size >= 3) record('STEADY08', scope);
  }
  for (const { scope, sessions } of repeatedProgress.values()) record('PROGRESS08', scope, sessions.size);
  for (const count of bowSessions.values()) record('GEAR02', 'global', count);
  record('GEAR03', 'global', distances.size);
  for (const count of kitSessions.values()) record('GEAR06', 'global', count);
  return [...evidence.values()];
}
