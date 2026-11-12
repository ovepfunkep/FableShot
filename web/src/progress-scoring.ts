import type { Conditions } from './conditions.ts';
import { BOW_CATEGORIES } from './equipment.ts';
import type { DiaryEntry } from './persistence.ts';
import type { Practice, Series } from './practice.ts';
import { acceptsDiameter, getTargetProfile, summarize } from './target.ts';

const POLICY_VERSION = 'progress-pg1-v1';
const GEOMETRY = 'single-circle-main';
const MAX_SOURCES = 5;
const READY_SOURCES = 3;
const signedProgress = new Intl.NumberFormat('ru-RU', { signDisplay: 'exceptZero', maximumFractionDigits: 2 });

export function formatProgress(result: ProgressResult): string {
  return result.relativePercent !== null ? `${signedProgress.format(result.relativePercent)}%`
    : `${signedProgress.format(result.rawIncrease ?? 0)} балла`;
}

/** A compact card has room for one baseline. Mixed scopes are explained in the report. */
export function compactProgress(practice: Practice): string | null {
  if (practice.savedAt === null) return null;
  const series = practice.rounds.flatMap(round => round.series.filter(item => item.shots.length > 0));
  const id = series[0]?.progressBaselineId;
  if (id === undefined || series.some(item => item.progressBaselineId !== id)) return null;
  const baseline = practice.progressBaselines?.[id];
  if (baseline?.status !== 'ready') return null;
  const result = calculateProgress(baseline, series);
  if (!result || result.currentAverage === null || result.baselineAverage === null) return null;
  return `${result.fullRankAvailable ? '' : '≈ '}${formatProgress(result)}`;
}
const MIN_SCORED_ARROWS = 12;

type ProgressSourceTotals = Readonly<{
  sessionId: string;
  completedAt: string;
  scoredCount: number;
  scoreSum: number;
}>;
export type ProgressSource = ProgressSourceTotals & (
  | { startedAt: string; fingerprint: string; nativeRevision?: never }
  | { startedAt: string | null; fingerprint: string | null; nativeRevision: number }
);

export type ProgressBaseline = Readonly<{
  policyVersion: typeof POLICY_VERSION;
  frozenAt: string;
  sessionStartCutoff: string | null;
  conditionKey: string | null;
  maximumPerArrow: number | null;
  status: 'unknown_conditions' | 'building' | 'ready';
  sources: readonly ProgressSource[];
  scoredCount: number;
  scoreSum: number;
}>;

export type ProgressResult = {
  percentagePoints: number | null;
  relativePercent: number | null;
  rawIncrease: number | null;
  baselineAverage: number | null;
  currentAverage: number | null;
  scoredCount: number;
  fullRankAvailable: boolean;
};

function comparisonConditions(distance: unknown, diameter: unknown, profileId: unknown, bow: unknown) {
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0 ||
    typeof diameter !== 'number' || diameter > 10_000 || typeof profileId !== 'string' ||
    !BOW_CATEGORIES.some(category => category.value === bow)) return null;
  const profile = getTargetProfile(profileId);
  if (!profile || !acceptsDiameter(profile, diameter)) return null;
  const maximum = Math.max(...profile.zones.map(zone => zone.points));
  // Target profile IDs include the version of the scoring zones.
  return { key: JSON.stringify([distance, diameter, profileId, GEOMETRY, maximum, bow]), maximum };
}

function comparisonFor(conditions: Conditions) {
  return comparisonConditions(conditions.distanceMeters, conditions.targetDiameterMm, conditions.targetProfileId,
    conditions.equipment?.bow.category);
}

export function progressConditionKey(conditions: Conditions): string | null {
  return comparisonFor(conditions)?.key ?? null;
}

function instant(value: unknown): number | null {
  // Date-only imports and local times without a timezone cannot establish a chronological order.
  if (typeof value !== 'string' || !/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function latestFirst(a: { startedAt: string | null; sessionId: string }, b: { startedAt: string | null; sessionId: string }): number {
  return (instant(b.startedAt) ?? -Infinity) - (instant(a.startedAt) ?? -Infinity) ||
    (a.sessionId < b.sessionId ? -1 : Number(a.sessionId > b.sessionId));
}

function matchingSeries(entry: DiaryEntry, conditionKey: string): Series[] {
  return entry.practice.rounds.flatMap(round => round.series.filter(series =>
    series.shots.length > 0 && progressConditionKey(series.conditions) === conditionKey));
}

/** The fingerprint detects changed comparison evidence. The frozen totals drive the score. */
function sourceFingerprint(series: readonly Series[]): string {
  let hash = 0x811c9dc5;
  function add(value: unknown) {
    const part = JSON.stringify(value);
    for (let index = 0; index < part.length; index++) {
      hash = Math.imul(hash ^ part.charCodeAt(index), 0x01000193);
    }
  }
  for (const { id, plannedCount, shots } of series) {
    add([id, plannedCount, shots.length]);
    for (const { points, code, point } of shots) add([points, code, point?.x, point?.y]);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function sourceEvidence(entry: DiaryEntry, conditionKey: string): (ProgressSourceTotals & { startedAt: string; fingerprint: string }) | null {
  const { id: sessionId, startedAt, practice: { savedAt: completedAt } } = entry;
  if (completedAt === null || entry.deletedAt) return null;
  const series = matchingSeries(entry, conditionKey);
  const scoredCount = series.reduce((total, item) => total + item.shots.length, 0);
  if (scoredCount < MIN_SCORED_ARROWS) return null;
  const scoreSum = series.reduce((total, item) => total + summarize(item.shots).points, 0);
  return { sessionId, startedAt, completedAt, scoredCount, scoreSum, fingerprint: sourceFingerprint(series) };
}

export function freezeProgressBaseline(
  entries: readonly DiaryEntry[], activeSessionId: string, startedAt: string, conditions: Conditions, frozenAt: string,
): ProgressBaseline {
  const now = instant(frozenAt);
  if (now === null) throw new RangeError('A progress baseline requires a timestamp for the snapshot');
  const start = instant(startedAt);
  const cutoff = start !== null && start <= now ? start : null;
  const comparison = comparisonFor(conditions);
  const sources: ProgressSource[] = [];
  if (comparison && cutoff !== null) {
    const candidates = entries.filter(entry => {
      if (entry.id === activeSessionId) return false;
      const sourceStart = instant(entry.startedAt);
      const sourceEnd = instant(entry.practice.savedAt);
      return sourceStart !== null && sourceEnd !== null && sourceStart <= sourceEnd && sourceEnd < cutoff;
    }).sort((a, b) => latestFirst({ startedAt: a.startedAt, sessionId: a.id }, { startedAt: b.startedAt, sessionId: b.id }));
    const sourceIds = new Set<string>();
    for (const candidate of candidates) {
      if (sourceIds.has(candidate.id)) continue;
      const evidence = sourceEvidence(candidate, comparison.key);
      if (!evidence) continue;
      sources.push(evidence);
      sourceIds.add(candidate.id);
      if (sources.length === MAX_SOURCES) break;
    }
  }
  return {
    policyVersion: POLICY_VERSION, frozenAt, sessionStartCutoff: cutoff === null ? null : startedAt,
    conditionKey: comparison?.key ?? null, maximumPerArrow: comparison?.maximum ?? null,
    status: !comparison || cutoff === null ? 'unknown_conditions' : sources.length >= READY_SOURCES ? 'ready' : 'building',
    sources, scoredCount: sources.reduce((total, item) => total + item.scoredCount, 0),
    scoreSum: sources.reduce((total, item) => total + item.scoreSum, 0),
  };
}

function validConditionKey(key: unknown, maximum: unknown): boolean {
  if (key === null) return maximum === null;
  if (typeof key !== 'string' || key.length > 256) return false;
  try {
    const tuple: unknown = JSON.parse(key);
    if (!Array.isArray(tuple) || tuple.length !== 6) return false;
    const [distance, diameter, profileId, , , bow] = tuple;
    const comparison = comparisonConditions(distance, diameter, profileId, bow);
    return comparison !== null && comparison.key === key && comparison.maximum === maximum;
  } catch {
    return false;
  }
}

export function isProgressBaseline(value: unknown): value is ProgressBaseline {
  if (!value || typeof value !== 'object') return false;
  const { policyVersion, frozenAt, sessionStartCutoff, conditionKey, maximumPerArrow, status, sources, scoredCount, scoreSum } =
    value as Partial<ProgressBaseline>;
  const frozen = instant(frozenAt);
  const cutoff = instant(sessionStartCutoff);
  if (policyVersion !== POLICY_VERSION || frozen === null ||
    (sessionStartCutoff !== null && (cutoff === null || cutoff > frozen)) || !validConditionKey(conditionKey, maximumPerArrow) ||
    !Array.isArray(sources) || sources.length > MAX_SOURCES) return false;
  const unknown = cutoff === null || conditionKey === null;
  if (status !== (unknown ? 'unknown_conditions' : sources.length >= READY_SOURCES ? 'ready' : 'building') ||
    (unknown && sources.length > 0)) return false;

  const ids = new Set<string>();
  let count = 0;
  let sum = 0;
  let previous: ProgressSource | undefined;
  for (const source of sources) {
    if (!source || typeof source !== 'object') return false;
    const start = instant(source.startedAt);
    const end = instant(source.completedAt);
    const native = source.nativeRevision !== undefined;
    if (native && (!Number.isSafeInteger(source.nativeRevision) || source.nativeRevision! < 1)) return false;
    if (typeof source.sessionId !== 'string' || !source.sessionId || ids.has(source.sessionId) ||
      (start === null && !(native && source.startedAt === null)) || end === null || cutoff === null ||
      (start !== null && end < start) || end >= cutoff ||
      !Number.isSafeInteger(source.scoredCount) || source.scoredCount < MIN_SCORED_ARROWS ||
      !Number.isSafeInteger(source.scoreSum) || source.scoreSum < 0 || source.scoreSum > source.scoredCount * maximumPerArrow! ||
      (!(native && source.fingerprint === null) && (typeof source.fingerprint !== 'string' || !/^[0-9a-f]{8}$/.test(source.fingerprint))) ||
      (previous && latestFirst(previous, source) > 0)) return false;
    ids.add(source.sessionId);
    count += source.scoredCount;
    sum += source.scoreSum;
    previous = source;
  }
  return Number.isSafeInteger(count) && Number.isSafeInteger(sum) && scoredCount === count && scoreSum === sum;
}

export function progressSourceChanges(baseline: ProgressBaseline, entries: readonly DiaryEntry[]):
  { sessionId: string; status: 'changed' | 'deleted' | 'unavailable' }[] {
  const conditionKey = baseline.conditionKey;
  if (conditionKey === null) return [];
  const changes: { sessionId: string; status: 'changed' | 'deleted' | 'unavailable' }[] = [];
  for (const source of baseline.sources) {
    const entry = entries.find(candidate => candidate.id === source.sessionId);
    if (!entry || (source.nativeRevision !== undefined && entry.deletedAt)) {
      changes.push({ sessionId: source.sessionId, status: !entry && source.nativeRevision !== undefined ? 'unavailable' : 'deleted' });
      continue;
    }
    const current = sourceEvidence(entry, conditionKey);
    if (!current || (source.startedAt !== null && current.startedAt !== source.startedAt) || current.completedAt !== source.completedAt ||
      current.scoredCount !== source.scoredCount || current.scoreSum !== source.scoreSum || current.fingerprint !== source.fingerprint) {
      changes.push({ sessionId: source.sessionId, status: 'changed' });
    }
  }
  return changes;
}

export function calculateProgress(
  baseline: ProgressBaseline, series: readonly Series[], openSeriesId?: number,
): ProgressResult | null {
  if (baseline.status === 'unknown_conditions' || baseline.maximumPerArrow === null) return null;
  const selected = series.filter(item => progressConditionKey(item.conditions) === baseline.conditionKey);
  if (selected.at(-1)?.shots.length === 0) selected.pop();
  const scoredCount = selected.reduce((total, item) => total + item.shots.length, 0);
  const currentAverage = scoredCount > 0 ? selected.reduce((total, item) => total + summarize(item.shots).points, 0) / scoredCount : null;
  const baselineAverage = baseline.scoredCount > 0 ? baseline.scoreSum / baseline.scoredCount : null;
  const difference = currentAverage !== null && baselineAverage !== null ? currentAverage - baselineAverage : null;
  return {
    percentagePoints: difference === null ? null : 100 * difference / baseline.maximumPerArrow,
    relativePercent: difference !== null && baselineAverage !== null && baselineAverage > 0 ? 100 * difference / baselineAverage : null,
    rawIncrease: baselineAverage === 0 ? difference : null,
    baselineAverage, currentAverage, scoredCount,
    fullRankAvailable: baseline.status === 'ready' && scoredCount >= MIN_SCORED_ARROWS && selected.every(item =>
      item.id !== openSeriesId && item.shots.length === (item.plannedCount ?? Math.max(3, item.shots.length))),
  };
}
