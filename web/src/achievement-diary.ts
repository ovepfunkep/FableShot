import { evaluateAchievementEvidence } from './achievement-evidence.ts';
import { earnAchievements } from './achievement-ledger.ts';
import { getAchievementDefinition } from './achievement-catalog.ts';
import { evaluateAchievementRecords } from './achievement-records.ts';
import { observeStageRanks, STAGE_RANK_ENROLLMENT_VERSION } from './stage-rank-achievements.ts';
import type { AchievementGrant } from './achievement-ledger.ts';
import type { Diary, DiaryEntry } from './persistence.ts';
import type { RankCategory } from './sport-ranks.ts';

export function eligibleForAchievements(diary: Diary): DiaryEntry[] {
  if (!diary.achievementLedger) return [];
  return diary.entries.filter(entry => !entry.source && !entry.deletedAt && entry.achievementEnrollment?.epoch === diary.achievementLedger?.epoch &&
    !entry.practice.rounds.some(round => round.series.some(series => series.shots.some(shot => shot.imported))));
}

export const ACHIEVEMENT_ACTION_RULE_IDS = ['APP01', 'APP04', 'APP08', 'MIND03', 'MIND04', 'MIND08'] as const;
export type AchievementActionId = typeof ACHIEVEMENT_ACTION_RULE_IDS[number];

/** Called after a successful explicit action, never while loading previously saved settings. */
export function awardServiceAction(diary: Diary, id: AchievementActionId, now: string, sessionId?: string): Diary {
  const ledger = diary.achievementLedger ?? { epoch: crypto.randomUUID(), grants: [] };
  const earned = earnAchievements(ledger, [{ id, scope: 'global', progress: 1 }], now, sessionId);
  return earned.added.length ? { ...diary, achievementLedger: earned.ledger } : diary;
}

export function awardPublication(diary: Diary, documentId: string, fingerprint: string, now: string): Diary {
  const ledger = diary.achievementLedger ?? { epoch: crypto.randomUUID(), grants: [] };
  const previous = ledger.publications ?? [];
  if (previous.some(item => item.documentId === documentId && item.fingerprint === fingerprint)) return diary;
  const publications = [...previous, { documentId, fingerprint }];
  const observed = [{ id: 'MIND03', scope: 'global', progress: 1 },
    { id: 'MIND04', scope: 'global', progress: Number(publications.filter(item => item.documentId === documentId).length >= 2) }];
  return { ...diary, achievementLedger: earnAchievements({ ...ledger, publications }, observed, now).ledger };
}

const arrowCount = (entry: DiaryEntry) => entry.practice.rounds.reduce((sum, round) => sum +
  round.series.reduce((total, series) => total + series.shots.length, 0), 0);
const lastSeriesId = (entry: DiaryEntry) => entry.practice.rounds.at(-1)?.series.at(-1)?.id;

export function awardTrainingChange(previous: Diary, proposed: Diary, id: string, category: RankCategory | null, now: string): {
  diary: Diary; added: AchievementGrant[];
} {
  const unchanged = { diary: proposed, added: [] };
  const before = previous.entries.find(entry => entry.id === id);
  const entry = proposed.entries.find(entry => entry.id === id);
  const ledger = proposed.achievementLedger;
  if (!before || !entry || !ledger || !entry.achievementEnrollment || entry.achievementEnrollment.epoch !== ledger.epoch ||
    entry.source || entry.deletedAt || before.practice.savedAt !== null) return unchanged;
  const complete = entry.practice.savedAt !== null;
  const enrollment = entry.achievementEnrollment;
  const stage = enrollment.stageRankVersion === STAGE_RANK_ENROLLMENT_VERSION && !entry.nativeArchiveSession &&
    before.practice !== entry.practice && !entry.practice.rounds.some(round => round.series.some(series => series.shots.some(shot => shot.imported)))
    ? observeStageRanks(before.practice, entry.practice, category, enrollment.stageRankCategories) : null;
  const stageEvidence = stage?.observations ?? [];
  const categories = stage?.categories;
  const updateCategories = categories !== undefined && categories !== enrollment.stageRankCategories;
  const updated = complete || updateCategories ? { ...entry, achievementEnrollment: { ...enrollment,
    ...(complete ? { rankCategory: category } : {}), ...(updateCategories ? { stageRankCategories: categories } : {}) } } : entry;
  const entries = updated === entry ? proposed.entries : proposed.entries.map(item => item.id === id ? updated : item);
  if (!complete && arrowCount(entry) <= arrowCount(before) && lastSeriesId(entry) === lastSeriesId(before)) {
    if (!stageEvidence.length && !updateCategories) return unchanged;
    const earned = earnAchievements(ledger, stageEvidence, now, id);
    return { diary: { ...proposed, achievementLedger: earned.ledger, entries }, added: earned.added };
  }
  function evidenceFor(diary: Diary, current: DiaryEntry) {
    const eligible = eligibleForAchievements(diary).map(item => item.id === id ? current : item);
    const evidence = evaluateAchievementEvidence(complete ? eligible : [current], item => item.achievementEnrollment?.rankCategory ?? null);
    // A live shot only reevaluates its own session; accumulated volume is a cheap count.
    if (!complete) {
      const total = eligible.reduce((sum, item) => sum + arrowCount(item), 0);
      for (const item of evidence) if (['START06', 'START07', 'START08'].includes(item.id)) item.progress = total;
    }
    return evidence;
  }
  const prior = new Map(evidenceFor(previous, before).map(item => [`${item.id}:${item.scope}`, item.progress]));
  const evidence = evidenceFor(proposed, updated).filter(item =>
    (prior.get(`${item.id}:${item.scope}`) ?? 0) < (getAchievementDefinition(item.id)?.target ?? Infinity));
  // New rules must not turn previously recorded results into newly earned awards.
  const records = complete ? evaluateAchievementRecords(updated, previous.entries, category) : [];
  const earned = earnAchievements(ledger, [...evidence, ...records, ...stageEvidence], now, id);
  return { diary: { ...proposed, achievementLedger: earned.ledger, entries }, added: earned.added };
}
