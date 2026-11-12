import { achievementScopesFor, getAchievementDefinition } from './achievement-catalog.ts';
import type { AchievementGrant } from './achievement-ledger.ts';
import { DATA_KEYS } from './app-storage.ts';
import type { DataRecords } from './app-storage.ts';
import type { NativeConversion, NativeConversionIssue, NativeTrainingCandidate } from './native-conversion.ts';
import type { NativeArchiveRow } from './native-archive.ts';
import { DIARY_KEY, isDiary } from './persistence.ts';
import type { Diary, DiaryEntry } from './persistence.ts';
import { DEFAULT_PREFERENCES } from './preferences.ts';
import { isPersonalRecordEvent } from './personal-record-events.ts';
import type { Practice, TechniqueUse } from './practice.ts';
import { isProgressBaseline, progressConditionKey, sourceEvidence } from './progress-scoring.ts';
import type { ProgressBaseline, ProgressSource } from './progress-scoring.ts';
import type { TechniqueReflections } from './technique-reflection.ts';
import { DEFAULT_TECHNIQUE_SETTINGS } from './technique-settings.ts';
import { DEFAULT_TIMER_SETTINGS } from './timer.ts';
import { validateArchiveRecords } from './web-archive.ts';

function instant(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function projectSession(candidate: NativeTrainingCandidate, practice: Practice, omit: (sourceId: string, code: string) => void): DiaryEntry | null {
  const techniqueUses: TechniqueUse[] = [];
  const techniqueReflections: TechniqueReflections = {};
  for (const use of candidate.techniqueUseCandidates) {
    const blockers = use.blockers.filter(code => code !== 'technique_use_arrow_boundary_unavailable' &&
      code !== 'unmapped_technique_use_reflection');
    if (use.seriesId === null || !use.selection || blockers.length) {
      omit(use.sourceId, 'technique_use_preserved_in_original');
      continue;
    }
    if (use.reflection) techniqueReflections[String(techniqueUses.length)] = use.reflection;
    else omit(use.sourceId, 'technique_reflection_preserved_in_original');
    techniqueUses.push({ seriesId: use.seriesId, arrowsBefore: null, selection: use.selection });
  }
  const source = candidate.retainedFacts.session;
  const deletedAt = instant(source.deletedAtMs);
  const createdAt = instant(source.createdAtMs);
  if (candidate.deleted && !deletedAt) return null;
  return {
    id: candidate.sourceId,
    nativeArchiveSession: candidate.sourceId,
    ...(candidate.state === 'paused' && { paused: true }),
    title: candidate.title,
    startedAt: instant(source.startedAtMs) ?? candidate.localDate ?? '',
    ...(createdAt && { createdAt }),
    localDate: candidate.localDate,
    ...(deletedAt && { deletedAt }),
    ...(candidate.trainingTime && { trainingTime: candidate.trainingTime }),
    notes: candidate.notes,
    practice: { ...practice, ...(techniqueUses.length && { techniqueUses, techniqueReflections }) },
  };
}

function projectBaseline(row: NativeArchiveRow, conditionKey: string | null, sourceEntries: Map<string, DiaryEntry>,
  revisions: Map<string, unknown>): ProgressBaseline | null {
  const condition = typeof row.conditionsJson === 'string' ? JSON.parse(row.conditionsJson) : null;
  if (condition) {
    const expectedKey = JSON.stringify([condition.distanceMeters, condition.diameterMm, condition.profileId,
      condition.geometry, condition.maximumPerArrow, condition.bowCategory]);
    if (conditionKey !== expectedKey) return null;
  } else if (conditionKey !== null) return null;
  const sources: ProgressSource[] = [];
  for (const source of JSON.parse(String(row.sourceSessionsJson))) {
    const completedAt = instant(source.completedAtMs);
    if (!completedAt || (source.startedAtMs !== null && !instant(source.startedAtMs))) return null;
    const startedAt = instant(source.startedAtMs) ?? null;
    const entry = sourceEntries.get(source.sessionId);
    const current = entry && conditionKey !== null && revisions.get(source.sessionId) === source.revision
      ? sourceEvidence(entry, conditionKey) : null;
    // A fingerprint is useful only when the imported revision matches the frozen source.
    const fingerprint = current && (startedAt === null || current.startedAt === startedAt) &&
      current.completedAt === completedAt && current.scoredCount === source.count && current.scoreSum === source.sum
      ? current.fingerprint : null;
    sources.push({ sessionId: source.sessionId, startedAt, completedAt, nativeRevision: source.revision,
      scoredCount: source.count, scoreSum: source.sum, fingerprint });
  }
  const baseline = { policyVersion: row.policyVersion, frozenAt: instant(row.frozenAtMs),
    sessionStartCutoff: instant(row.sessionStartCutoffMs) ?? null, conditionKey, maximumPerArrow: row.maximumPerArrow,
    status: row.status, sources, scoredCount: row.scoredCount, scoreSum: row.scoreSum };
  return isProgressBaseline(baseline) ? baseline : null;
}

/** Build a replacement diary. The original ZIP is the authoritative copy of native-only fields. */
export function buildNativeRecords(conversion: NativeConversion, archive: { sha256: string; bytes: number }) {
  const omissions: NativeConversionIssue[] = [...conversion.issues];
  const omit = (sourceId: string, code: string) => omissions.push({ sourceId, code });
  const table = (name: string) => conversion.inspection.tables[`data/journal/${name}.jsonl`] ?? [];
  const openCount = conversion.candidates.filter(item => item.state === 'active' && !item.deleted && item.practice).length;
  const entries: DiaryEntry[] = [];
  for (const candidate of conversion.candidates) {
    if (!candidate.practice) {
      for (const blocker of candidate.blockers) omit(candidate.sourceId, blocker);
      continue;
    }
    if (candidate.state === 'active' && (candidate.deleted || openCount > 1)) {
      omit(candidate.sourceId, 'active_session_conflict');
      continue;
    }
    const entry = projectSession(candidate, candidate.practice, omit);
    if (!entry || !isDiary({ version: 1, nativeArchive: archive, entries: [entry] })) {
      omit(candidate.sourceId, 'session_not_supported_by_web_diary');
      continue;
    }
    entries.push(entry);
  }
  const sessionIds = new Set(entries.map(entry => entry.id));
  const grants: AchievementGrant[] = [];
  for (const row of table('achievement_grants')) {
    const earnedAt = instant(row.earnedAtMs);
    const rule = typeof row.ruleId === 'string' ? getAchievementDefinition(row.ruleId) : undefined;
    if (!rule || !earnedAt || row.ruleVersion !== 1 || typeof row.scope !== 'string' ||
      !achievementScopesFor(rule).some(scope => scope === row.scope) || grants.length >= 10_000) {
      omit(String(row.key), 'achievement_preserved_in_original');
      continue;
    }
    const notifiedAt = instant(row.notifiedAtMs);
    grants.push({ id: rule.id, scope: row.scope, earnedAt, valid: row.valid === 1, nativeSnapshot: true,
      ...(notifiedAt && { notifiedAt }),
      ...(typeof row.sessionId === 'string' && sessionIds.has(row.sessionId) && { sessionId: row.sessionId }) });
  }
  const entriesById = new Map(entries.map(entry => [entry.id, entry]));
  let retainedRecordReceipts = 0;
  for (const row of table('personal_record_events')) {
    const entry = typeof row.sessionId === 'string' ? entriesById.get(row.sessionId) : undefined;
    if (!entry || !isPersonalRecordEvent(row)) {
      retainedRecordReceipts++;
      omit(String(row.id), 'personal_record_preserved_in_original');
      continue;
    }
    (entry.personalRecords ??= []).push(row);
  }
  const candidatesById = new Map(conversion.candidates.map(candidate => [candidate.sourceId, candidate]));
  const revisions = new Map(table('sessions').map(row => [String(row.id), row.revision]));
  const blocksById = new Map(table('blocks').map(row => [row.id, row]));
  let retainedBaselines = 0;
  for (const row of table('progress_baselines')) {
    const sessionId = String(blocksById.get(row.blockId)?.sessionId);
    const candidate = candidatesById.get(sessionId);
    const entry = entriesById.get(sessionId);
    const seriesIds = new Set(candidate?.retainedFacts.ends.filter(end => end.blockId === row.blockId)
      .map(end => candidate.roundLocations[String(end.id)]?.webSeriesId));
    const series = entry?.practice.rounds.flatMap(round => round.series.filter(end => seriesIds.has(end.id))) ?? [];
    const key = series.length ? progressConditionKey(series[0].conditions) : null;
    const baseline = series.length && series.every(end => progressConditionKey(end.conditions) === key)
      ? projectBaseline(row, key, entriesById, revisions) : null;
    if (!entry || !baseline) {
      retainedBaselines++;
      omit(String(row.baselineId), 'progress_baseline_preserved_in_original');
      continue;
    }
    const baselineId = series[0].id;
    entry.practice = { ...entry.practice, progressBaselines: { ...entry.practice.progressBaselines, [baselineId]: baseline },
      rounds: entry.practice.rounds.map(round => ({ ...round, series: round.series.map(end =>
        seriesIds.has(end.id) ? { ...end, progressBaselineId: baselineId } : end) })) };
  }
  const { catalogs, settings } = conversion;
  for (const [key, catalog] of Object.entries(catalogs)) {
    if (catalog === null) omit(key, 'catalog_preserved_in_original');
  }
  for (const key of settings.retainedKeys) omit(key, 'setting_preserved_in_original');
  const diary: Diary = { version: 1, entries, nativeArchive: archive,
    ...(conversion.notebookNotes.length && { notes: conversion.notebookNotes }),
    ...(grants.length && { achievementLedger: { epoch: archive.sha256, grants } }) };
  const records: DataRecords = {
    [DIARY_KEY]: JSON.stringify(diary),
    [DATA_KEYS[1]]: catalogs.equipment ? JSON.stringify(catalogs.equipment) : null,
    [DATA_KEYS[2]]: catalogs.presets ? JSON.stringify({ version: 1, presets: catalogs.presets }) : null,
    [DATA_KEYS[3]]: catalogs.techniques ? JSON.stringify(catalogs.techniques) : null,
    [DATA_KEYS[4]]: JSON.stringify({ version: 1, preferences: { ...DEFAULT_PREFERENCES, ...settings.training,
      ...(catalogs.rankAssignments && { rankAssignments: catalogs.rankAssignments }) } }),
    [DATA_KEYS[5]]: JSON.stringify({ version: 1, settings: { ...DEFAULT_TECHNIQUE_SETTINGS, ...settings.technique } }),
    [DATA_KEYS[6]]: JSON.stringify({ version: 1, settings: { ...DEFAULT_TIMER_SETTINGS, ...settings.timer } }),
  };
  const summary = validateArchiveRecords(records);
  return {
    records, summary, omissions,
    retained: {
      sessions: conversion.candidates.length - entries.length,
      notes: table('diary_notes').length - conversion.notebookNotes.length - entries.reduce((count, entry) => count + (entry.notes?.length ?? 0), 0),
      techniqueUses: table('technique_uses').length - entries.reduce((count, entry) => count + (entry.practice.techniqueUses?.length ?? 0), 0),
      equipment: catalogs.equipment ? 0 : conversion.equipmentCandidates.length,
      techniques: catalogs.techniques ? 0 : conversion.techniqueCandidates.length,
      ranks: catalogs.rankAssignments ? 0 : conversion.rankCandidates.length,
      presets: catalogs.presets ? 0 : conversion.presetCandidates.length,
      settings: settings.retainedKeys.length,
      achievementReceipts: table('achievement_grants').length - grants.length,
      progressBaselines: retainedBaselines,
      recordReceipts: retainedRecordReceipts,
    },
  };
}
