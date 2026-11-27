import { eligibleForAchievements } from './achievement-diary.ts';
import { evaluateAchievementEvidence, evaluateClosedSeriesSwings } from './achievement-evidence.ts';
import { evaluateAchievementRecords } from './achievement-records.ts';
import { achievementValidity, removeAchievementEvidence } from './achievement-validity.ts';
import { getAchievementDefinition } from './achievement-catalog.ts';
import { earnAchievements } from './achievement-ledger.ts';
import type { AchievementGrant, AchievementObservation } from './achievement-ledger.ts';
import { closedStageRankObservations } from './stage-rank-achievements.ts';
import { calculatePersonalRecordEvents } from './personal-record-events.ts';
import type { PersonalRecordEvent } from './personal-record-events.ts';
import { freezeProgressBaseline, progressConditionKey } from './progress-scoring.ts';
import type { Diary, DiaryEntry } from './persistence.ts';
import type { Practice } from './practice.ts';
import type { RankCategory } from './sport-ranks.ts';

const endTime = (entry: DiaryEntry) => Date.parse(entry.practice.savedAt ?? entry.startedAt);
const categoryFor = (entry: DiaryEntry) => entry.achievementEnrollment?.rankCategory ?? null;
const key = (item: { id: string; scope: string }) => `${item.id}:${item.scope}`;
const recordDetails = (record: PersonalRecordEvent) =>
  JSON.stringify([record.kind, record.label, record.value, record.previousValue, record.previousSessionId]);

export function refreshCorrectedProgress(before: Practice, practice: Practice, history: readonly DiaryEntry[], entry: DiaryEntry): Practice {
  const prior = new Map(before.rounds.flatMap(round => round.series.map(end => [end.id, end] as const)));
  const baselines = { ...practice.progressBaselines };
  let nextId = practice.nextId;
  const allocated = new Map<string, number>();
  const rounds = practice.rounds.map(round => ({
    ...round, series: round.series.map(end => {
      const old = prior.get(end.id);
      if (!old || end.progressBaselineId !== undefined || progressConditionKey(old.conditions) === progressConditionKey(end.conditions)) return end;
      const original = old.progressBaselineId === undefined ? undefined : before.progressBaselines?.[old.progressBaselineId];
      const frozenAt = original?.frozenAt ?? entry.startedAt;
      const cutoff = original?.sessionStartCutoff ?? entry.startedAt;
      if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(frozenAt) || !Number.isFinite(Date.parse(frozenAt))) return end;
      const id = JSON.stringify([progressConditionKey(end.conditions), cutoff, frozenAt]);
      let baselineId = allocated.get(id);
      if (baselineId === undefined) {
        baselineId = baselines[end.id] ? nextId++ : end.id;
        baselines[baselineId] = freezeProgressBaseline(history, entry.id, cutoff, end.conditions, frozenAt);
        allocated.set(id, baselineId);
      }
      return { ...end, progressBaselineId: baselineId };
    }),
  }));
  // Discard only unreferenced copies because the edited series may share its previous baseline.
  const used = new Set(rounds.flatMap(round => round.series.map(end => String(end.progressBaselineId))));
  return { ...practice, rounds, nextId, progressBaselines: Object.fromEntries(Object.entries(baselines).filter(([id]) => used.has(id))) };
}

function refreshRecords(previous: Diary, next: Diary, changed: DiaryEntry, category: RankCategory | null, now: string): Diary {
  if (changed.practice.savedAt === null) return next;
  const from = endTime(changed);
  const oldById = new Map(previous.entries.map(entry => [entry.id, entry]));
  const entries = next.entries.map(entry => {
    const at = endTime(entry);
    if (!entry.personalRecords || !entry.practice.savedAt || entry.deletedAt || !Number.isFinite(at) || at < from) return entry;
    const old = oldById.get(entry.id);
    if (!old) return entry;
    const rankCategory = entry.achievementEnrollment ? categoryFor(entry) : category;
    const before = calculatePersonalRecordEvents(old, previous.entries, rankCategory, at, () => '').filter(record => record.kind !== 'volume');
    const after = calculatePersonalRecordEvents(entry, next.entries, rankCategory, at, () => '').filter(record => record.kind !== 'volume');
    const beforeKeys = new Set(before.map(recordDetails));
    const afterKeys = new Set(after.map(recordDetails));
    const retained = entry.personalRecords.filter(record => !beforeKeys.has(recordDetails(record)) || afterKeys.has(recordDetails(record)));
    // Older stored records can differ from a freshly evaluated result. If their evidence
    // involves the corrected session, keep them only if the result still supports them.
    const valid = retained.filter(record => record.kind === 'volume' || record.sessionId !== changed.id && record.previousSessionId !== changed.id || afterKeys.has(recordDetails(record)));
    const known = new Set(valid.map(recordDetails));
    const added = after.filter(record => !known.has(recordDetails(record)) && !beforeKeys.has(recordDetails(record)))
      .map(record => ({ ...record, id: crypto.randomUUID(), notifiedAtMs: Date.parse(now) }));
    return valid.length === entry.personalRecords.length && !added.length ? entry : { ...entry, personalRecords: [...valid, ...added] };
  });
  return { ...next, entries };
}

const qualifies = (item: AchievementObservation) => item.progress >= (getAchievementDefinition(item.id)?.target ?? Infinity);
const order = (a: DiaryEntry, b: DiaryEntry) => endTime(a) - endTime(b) || a.id.localeCompare(b.id);
const generalEvidence = (entries: readonly DiaryEntry[]) => evaluateAchievementEvidence(entries, categoryFor).filter(qualifies);

function stageEvidence(entry: DiaryEntry, history: readonly DiaryEntry[]): AchievementObservation[] {
  const { practice, achievementEnrollment } = entry;
  const stage = achievementEnrollment?.stageRankVersion === 1
    ? closedStageRankObservations(practice, achievementEnrollment.stageRankCategories) : [];
  const ends = practice.rounds.flatMap(round => round.series);
  const closedEnds = practice.savedAt === null ? ends.slice(0, -1) : ends;
  return [
    ...stage,
    ...closedEnds.flatMap(end => evaluateClosedSeriesSwings(entry, end.id)),
    ...evaluateAchievementRecords(entry, history),
    ...(practice.savedAt !== null && ends.some(end => end.shots.length && end.conditions.equipment?.createdInFableShot)
      ? [{ id: 'APP13', scope: 'global', progress: 1 }] : []),
  ];
}

export function reconcileConditionsCorrection(previous: Diary, proposed: Diary, id: string, category: RankCategory | null, now: string): Diary {
  const oldEntry = previous.entries.find(item => item.id === id);
  const entry = proposed.entries.find(item => item.id === id);
  if (!entry || !oldEntry || entry.practice === oldEntry.practice) return proposed;
  let next = refreshRecords(previous, proposed, entry, category, now);
  const oldLedger = previous.achievementLedger;
  if (!oldLedger || !next.achievementLedger) return next;
  const before = eligibleForAchievements(previous).sort(order);
  const after = eligibleForAchievements(next).sort(order);
  const oldGeneral = new Set(generalEvidence(before).map(key));
  const correctedGeneral = new Set(generalEvidence(after.filter(item => item.id === id)).map(key));
  const originalGeneral = new Set(generalEvidence(before.filter(item => item.id === id)).map(key));
  const corrections = new Map<string, { entry: DiaryEntry; observation: AchievementObservation }>();
  const store = (item: DiaryEntry, observation: AchievementObservation) => {
    const name = key(observation);
    const earlier = corrections.get(name);
    if (!earlier || order(item, earlier.entry) < 0) corrections.set(name, { entry: item, observation });
  };
  const grantByKey = new Map(oldLedger.grants.map(grant => [key(grant), grant]));
  for (const evidence of generalEvidence(after)) {
    const name = key(evidence);
    const prior = grantByKey.get(name);
    if (prior?.nativeSnapshot || oldGeneral.has(name) && prior?.sessionId !== id &&
      !(correctedGeneral.has(name) && !originalGeneral.has(name))) continue;
    let start = 0;
    let end = after.length - 1;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (generalEvidence(after.slice(0, middle + 1)).some(item => key(item) === name)) end = middle;
      else start = middle + 1;
    }
    store(after[start], evidence);
  }
  const priorValidity = achievementValidity(previous);
  const validity = achievementValidity(next);
  const special = new Set<string>();
  for (const grant of oldLedger.grants) {
    const name = key(grant);
    if (/^PROGRESS(04|06|10)$/.test(grant.id) && priorValidity.get(name) === true && validity.get(name) === false) special.add(name);
  }
  const beforeById = new Map(before.map(item => [item.id, item]));
  for (const later of after) {
    if (endTime(later) < endTime(entry)) continue;
    const old = beforeById.get(later.id);
    const prior = new Set((old ? stageEvidence(old, previous.entries) : []).map(item => JSON.stringify(item)));
    for (const observation of stageEvidence(later, next.entries)) {
      const name = key(observation);
      const existing = grantByKey.get(name);
      if (existing?.nativeSnapshot || prior.has(JSON.stringify(observation)) && validity.get(name) !== false) continue;
      special.add(name);
      store(later, observation);
    }
  }
  if (special.size) for (const candidate of after) {
    for (const observation of stageEvidence(candidate, next.entries)) {
      if (special.has(key(observation))) store(candidate, observation);
    }
  }
  next = removeAchievementEvidence(previous, next, id, now);
  let ledger = next.achievementLedger!;
  const retained = new Map(ledger.grants.filter(grant => !special.has(key(grant)) || validity.get(key(grant)) !== false)
    .map(grant => [key(grant), grant]));
  for (const [name, { entry: source, observation }] of corrections) {
    const prior = retained.get(name);
    const original = grantByKey.get(name);
    if (prior && prior.sessionId === source.id && validity.get(name) !== false && !special.has(name)) continue;
    if (prior?.nativeSnapshot) continue;
    const earnedAt = original?.sessionId === source.id ? original.earnedAt : source.practice.savedAt ?? source.startedAt;
    const result = earnAchievements({ ...ledger, grants: [] }, [observation], earnedAt, source.id);
    const found: AchievementGrant | undefined = result.added[0];
    if (found) retained.set(name, { ...found, notifiedAt: original?.notifiedAt ?? now,
      ...(original?.sessionId === source.id && original.noticeMoment ? { noticeMoment: original.noticeMoment } : {}) });
  }
  ledger = { ...ledger, grants: [...retained.values()] };
  return { ...next, achievementLedger: ledger };
}
