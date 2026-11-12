import { achievementScopesFor, getAchievementDefinition } from './achievement-catalog.ts';
import { evaluateAchievementEvidence } from './achievement-evidence.ts';
import { evaluateAchievementRecords } from './achievement-records.ts';
import type { Diary } from './persistence.ts';

const serviceRules = new Set(['APP01', 'APP04', 'APP08', 'MIND03', 'MIND04', 'MIND08']);
const recordRules = new Set(['PROGRESS04', 'PROGRESS06', 'PROGRESS10']);

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

  for (const grant of ledger.grants) {
    const key = `${grant.id}:${grant.scope}`;
    const storedValid = !('valid' in grant && grant.valid === false);
    const definition = getAchievementDefinition(grant.id);
    if (grant.nativeSnapshot || serviceRules.has(grant.id) || !definition) {
      validity.set(key, storedValid);
    } else if (!achievementScopesFor(definition).some(scope => scope === grant.scope)) {
      validity.set(key, false);
    } else if (recordRules.has(grant.id)) {
      validity.set(key, grant.sessionId !== undefined && recordEvidence.get(grant.sessionId)?.has(key) === true);
    } else {
      validity.set(key, (evidence.get(key) ?? 0) >= definition.target);
    }
  }
  return validity;
}
