import { achievementScopesFor, getAchievementDefinition, isStageRankRule } from './achievement-catalog.ts';
import { evaluateAchievementEvidence, evaluateClosedSeriesSwings } from './achievement-evidence.ts';
import { evaluateAchievementRecords } from './achievement-records.ts';
import { confirmsStageRank } from './stage-rank-achievements.ts';
import { roomAchievementObservations } from './room-achievements.ts';
import type { Diary } from './persistence.ts';

const serviceRules = new Set(['APP01', 'APP04', 'APP08', 'APP11', 'APP12', 'APP14', 'MIND03', 'MIND04', 'MIND08']);
const recordRules = new Set(['PROGRESS04', 'PROGRESS06', 'PROGRESS10']);
const roomRules = new Set(['ROOM01', 'ROOM02', 'ROOM03']);

export const dependsOnTraining = (id: string) => !serviceRules.has(id);

export function removeAchievementEvidence(previous: Diary, next: Diary, entryId: string, now: string): Diary {
  const ledger = next.achievementLedger;
  if (!ledger) return next;
  const entry = next.entries.find(item => item.id === entryId);
  if (entry?.deletedAt) return { ...next, achievementLedger: { ...ledger, grants: ledger.grants.map(grant =>
    grant.sessionId === entryId && dependsOnTraining(grant.id) && !grant.notifiedAt ? { ...grant, notifiedAt: now } : grant) } };
  const rounds = new Set(entry?.practice.rounds.map(round => round.id));
  const series = new Set(entry?.practice.rounds.flatMap(round => round.series.filter(end => end.shots.length).map(end => end.id)));
  const before = achievementValidity(previous);
  const after = achievementValidity(next);
  return { ...next, achievementLedger: { ...ledger, grants: ledger.grants.filter(grant => {
    if (!dependsOnTraining(grant.id)) return true;
    const key = `${grant.id}:${grant.scope}`;
    if (/^(START0[5-9]|START10|PROGRESS08|GEAR0[26]|STEADY08|ROOM02)$/.test(grant.id)) {
      return before.get(key) !== true || after.get(key) !== false;
    }
    if (grant.sessionId !== entryId) return true;
    if (!entry) return false;
    if (grant.stageRank && (!rounds.has(grant.stageRank.roundId) || grant.stageRank.seriesIds.some(id => !series.has(id)))) return false;
    if (grant.seriesSwing?.seriesIds.some(id => !series.has(id))) return false;
    return before.get(key) !== true || after.get(key) !== false;
  }) } };
}

/** Rechecks existing receipts without issuing awards or changing their original date. */
export function achievementValidity(diary: Diary): Map<string, boolean> {
  const validity = new Map<string, boolean>();
  const ledger = diary.achievementLedger;
  if (!ledger) return validity;
  const eligible = diary.entries.filter(entry => !entry.source && !entry.deletedAt &&
    entry.achievementEnrollment?.epoch === ledger.epoch &&
    !entry.practice.rounds.some(round => round.series.some(series => series.shots.some(shot => shot.imported))));
  const recordSources = new Set(ledger.grants.filter(grant => !grant.nativeSnapshot && recordRules.has(grant.id))
    .map(grant => grant.sessionId));
  const recordEvidence = new Map(eligible.filter(entry => recordSources.has(entry.id)).map(entry =>
    [entry.id, new Set(evaluateAchievementRecords(entry, diary.entries).map(item => `${item.id}:${item.scope}`))]));
  const evidence = new Map(evaluateAchievementEvidence(eligible, entry => entry.achievementEnrollment?.rankCategory ?? null)
    .map(item => [`${item.id}:${item.scope}`, item.progress]));
  const eligibleById = new Map(eligible.map(entry => [entry.id, entry]));
  const versionedRankSources = new Set(diary.entries.filter(entry => entry.achievementEnrollment?.exerciseRankVersion).map(entry => entry.id));
  const hasLegacyExerciseRule = (grant: (typeof ledger.grants)[number]) =>
    /^RANK0[4-9]$/.test(grant.id) && !versionedRankSources.has(grant.sessionId ?? '');
  const legacyRankEvidence = ledger.grants.some(hasLegacyExerciseRule)
    ? new Map(evaluateAchievementEvidence(eligible, entry => entry.achievementEnrollment?.rankCategory ?? null, true)
      .map(item => [`${item.id}:${item.scope}`, item.progress])) : null;

  for (const grant of ledger.grants) {
    const key = `${grant.id}:${grant.scope}`;
    const storedValid = !('valid' in grant && grant.valid === false);
    const definition = getAchievementDefinition(grant.id);
    if (grant.nativeSnapshot || serviceRules.has(grant.id) || !definition) {
      validity.set(key, storedValid);
    } else if (roomRules.has(grant.id)) {
      const sources = grant.id === 'ROOM02' ? eligible.filter(entry => entry.achievementEnrollment?.roomAwards).map(entry => entry.id)
        : grant.sessionId ? [grant.sessionId] : [];
      validity.set(key, sources.some(id => roomAchievementObservations(diary, id).some(item =>
        item.id === grant.id && item.scope === grant.scope && item.progress >= definition.target)));
    } else if (grant.id === 'APP13') {
      const entry = grant.sessionId ? eligibleById.get(grant.sessionId) : undefined;
      validity.set(key, !!entry?.practice.savedAt && entry.practice.rounds.some(round => round.series.some(end =>
        end.shots.length > 0 && end.conditions.equipment?.createdInFableShot)));
    } else if (!achievementScopesFor(definition).some(scope => scope === grant.scope)) {
      validity.set(key, false);
    } else if (isStageRankRule(grant.id)) {
      const entry = grant.sessionId ? eligibleById.get(grant.sessionId) : undefined;
      validity.set(key, !!entry && !!grant.stageRank &&
        confirmsStageRank(entry.practice, grant.id.startsWith('SNR') ? 'series' : 'round', grant.stageRank));
    } else if (recordRules.has(grant.id)) {
      validity.set(key, grant.sessionId !== undefined && recordEvidence.get(grant.sessionId)?.has(key) === true);
    } else if (grant.seriesSwing) {
      const entry = grant.sessionId ? eligibleById.get(grant.sessionId) : undefined;
      const { seriesIds, arrows } = grant.seriesSwing;
      const closingSeriesId = seriesIds.at(-1);
      validity.set(key, !!entry && closingSeriesId !== undefined && evaluateClosedSeriesSwings(entry, closingSeriesId).some(item =>
        item.id === grant.id && item.scope === grant.scope && item.seriesSwing?.arrows === arrows &&
        item.seriesSwing.seriesIds.every((seriesId, index) => seriesId === seriesIds[index])));
    } else if (hasLegacyExerciseRule(grant)) {
      validity.set(key, (legacyRankEvidence?.get(key) ?? 0) >= definition.target);
    } else {
      validity.set(key, (evidence.get(key) ?? 0) >= definition.target);
    }
  }
  return validity;
}
