import { currentSeries } from './practice.ts';
import type { Practice, Series } from './practice.ts';
import { BOW_CATEGORIES } from './equipment.ts';
import { MAX_SERIES_ARROWS } from './conditions.ts';
import { acceptsDiameter, getTargetProfile } from './target.ts';
import { groupSpread } from './composite-scoring.ts';
import { MIN_SCORED_ARROWS, progressConditionKey } from './progress-scoring.ts';

export type RoomSpread = { positions: number; squaredDistance: number; complete: boolean };
export type RoomProgressBase = { sessions: number; arrows: number; points: number };

export function isRoomProgressBase(value: unknown): value is RoomProgressBase {
  if (!value || typeof value !== 'object') return false;
  const { sessions, arrows, points } = value as RoomProgressBase;
  return Number.isInteger(sessions) && sessions >= 0 && sessions <= 5 &&
    Number.isSafeInteger(arrows) && arrows >= sessions * MIN_SCORED_ARROWS && arrows <= Math.floor(Number.MAX_SAFE_INTEGER / 10) &&
    Number.isSafeInteger(points) && points >= 0 && points <= arrows * 10 && (sessions !== 0 || arrows === 0);
}

export function isRoomSpread(value: unknown, hits: number): value is RoomSpread {
  if (!value || typeof value !== 'object') return false;
  const { positions, squaredDistance, complete } = value as Partial<RoomSpread>;
  return typeof positions === 'number' && Number.isSafeInteger(positions) && positions >= 0 && positions <= hits &&
    typeof squaredDistance === 'number' && Number.isFinite(squaredDistance) && squaredDistance >= 0 &&
    squaredDistance <= positions * 2 && (positions >= 2 || squaredDistance === 0) && typeof complete === 'boolean';
}

export type GroupSeriesResult = {
  scores: string;
  bowCategory: string | null;
  distanceMeters: number;
  targetProfileId: string;
  targetDiameterMm: number;
  spread?: RoomSpread;
  progressBase?: RoomProgressBase;
};

export type GroupSeriesRevision = {
  endId: number;
  ordinal: number;
  revision: number;
  result: GroupSeriesResult | null;
};

export type GroupSeriesJournal = {
  roomId: string;
  entryId: string;
  trainingId?: string;
  ends: (GroupSeriesRevision & { acknowledged: number })[];
};

export type GroupSeriesTransport = {
  publish(roomId: string, entryId: string, operation: GroupSeriesRevision): Promise<unknown>;
};

const positiveInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export function isGroupSeriesRevision(value: unknown): value is GroupSeriesRevision {
  if (!value || typeof value !== 'object') return false;
  const { endId, ordinal, revision, result } = value as Partial<GroupSeriesRevision>;
  if (!positiveInt(endId) || !positiveInt(ordinal) || !positiveInt(revision)) return false;
  if (result === null) return true;
  if (!result || typeof result !== 'object') return false;
  const profile = typeof result.targetProfileId === 'string' ? getTargetProfile(result.targetProfileId) : undefined;
  return typeof result.scores === 'string' && result.scores.length > 0 && result.scores.length <= MAX_SERIES_ARROWS &&
    /^[0-9TX]+$/.test(result.scores) && !!profile &&
    [...new Set(result.scores)].every(code => code === '0' || profile.zones.some(zone => zone.code === (code === 'T' ? '10' : code))) &&
    (result.bowCategory === null || BOW_CATEGORIES.some(category => category.value === result.bowCategory)) &&
    typeof result.distanceMeters === 'number' && Number.isFinite(result.distanceMeters) && result.distanceMeters > 0 &&
    typeof result.targetDiameterMm === 'number' && result.targetDiameterMm <= 10_000 && acceptsDiameter(profile, result.targetDiameterMm) &&
    (result.spread === undefined || isRoomSpread(result.spread, result.scores.replace(/0/g, '').length)) &&
    (result.progressBase === undefined || isRoomProgressBase(result.progressBase));
}

export function isGroupSeriesJournal(value: unknown): value is GroupSeriesJournal {
  if (!value || typeof value !== 'object') return false;
  const { roomId, entryId, trainingId, ends } = value as Partial<GroupSeriesJournal>;
  if (!identifier(roomId) || !identifier(entryId) || (trainingId !== undefined && !identifier(trainingId)) || !Array.isArray(ends)) return false;
  const ids = new Set<number>();
  return ends.every((end, index) => {
    if (!isGroupSeriesRevision(end) || end.ordinal !== index + 1 || ids.has(end.endId) ||
      !Number.isSafeInteger(end.acknowledged) || end.acknowledged < 0 || end.acknowledged > end.revision) return false;
    ids.add(end.endId);
    return true;
  });
}

function projectSeries(series: Series, practice: Practice): GroupSeriesResult {
  const { distanceMeters, targetProfileId, targetDiameterMm, equipment } = series.conditions;
  const baseline = series.progressBaselineId === undefined ? undefined : practice.progressBaselines?.[series.progressBaselineId];
  const progressBase = baseline && baseline.status !== 'unknown_conditions' && baseline.maximumPerArrow === 10 &&
    baseline.conditionKey === progressConditionKey(series.conditions)
    ? { sessions: baseline.sources.length, arrows: baseline.scoredCount, points: baseline.scoreSum } : undefined;
  return { scores: series.shots.map(shot => shot.code === 'X' ? 'X' : shot.points === 10 ? 'T' : String(shot.points)).join(''),
    bowCategory: equipment?.bow.category ?? null, distanceMeters, targetProfileId, targetDiameterMm,
    ...(progressBase && { progressBase }),
    spread: {
      positions: series.shots.filter(shot => shot.points > 0 && shot.point !== null).length,
      squaredDistance: groupSpread(series.shots).squaredDistance,
      complete: series.shots.length === (series.plannedCount ?? Math.max(3, series.shots.length)),
    } };
}

function sameResult(first: GroupSeriesResult | null, second: GroupSeriesResult | null) {
  return first === second || first !== null && second !== null && first.scores === second.scores &&
    first.bowCategory === second.bowCategory && first.distanceMeters === second.distanceMeters &&
    first.targetProfileId === second.targetProfileId && first.targetDiameterMm === second.targetDiameterMm &&
    first.spread?.positions === second.spread?.positions && first.spread?.squaredDistance === second.spread?.squaredDistance &&
    first.spread?.complete === second.spread?.complete &&
    first.progressBase?.sessions === second.progressBase?.sessions && first.progressBase?.arrows === second.progressBase?.arrows &&
    first.progressBase?.points === second.progressBase?.points;
}

/** Attach only when starting a new training explicitly inside a joined room. */
export function newGroupSeriesJournal(roomId: string, entryId: string, practice: Practice): GroupSeriesJournal {
  if (!identifier(roomId) || !identifier(entryId) || practice.savedAt !== null ||
    practice.rounds.some(round => round.series.some(series => series.shots.length))) {
    throw new Error('Для комнаты нужна новая тренировка.');
  }
  return { roomId, entryId, ends: [] };
}

/** Keep publication and local edits in the same storage transaction. */
export function trackGroupSeries(journal: GroupSeriesJournal, practice: Practice): GroupSeriesJournal {
  const openId = practice.savedAt === null ? currentSeries(practice)?.series.id : undefined;
  const closed = new Map<number, GroupSeriesResult>();
  for (const round of practice.rounds) {
    for (const series of round.series) {
      if (series.id !== openId && series.shots.length) closed.set(series.id, projectSeries(series, practice));
    }
  }
  let changed = false;
  const ends = journal.ends.map(end => {
    const result = closed.get(end.endId) ?? null;
    closed.delete(end.endId);
    if (sameResult(result, end.result)) return end;
    changed = true;
    return { ...end, revision: end.revision + 1, result };
  });
  for (const [endId, result] of closed) {
    ends.push({ endId, ordinal: ends.length + 1, revision: 1, acknowledged: 0, result });
    changed = true;
  }
  return changed ? { ...journal, ends } : journal;
}

export function pendingGroupSeries(journal: GroupSeriesJournal): GroupSeriesRevision[] {
  return journal.ends.flatMap(({ acknowledged, ...end }) => end.revision > acknowledged ? [end] : []);
}

export function acknowledgeGroupSeries(journal: GroupSeriesJournal, receipt: Pick<GroupSeriesRevision, 'endId' | 'revision'>): GroupSeriesJournal {
  const current = journal.ends.find(end => end.endId === receipt.endId);
  if (!current || !positiveInt(receipt.revision) || receipt.revision > current.revision || receipt.revision <= current.acknowledged) return journal;
  return { ...journal, ends: journal.ends.map(end => end === current ? { ...end, acknowledged: receipt.revision } : end) };
}

/** Apply within an already authenticated participant's entry. Persist before returning the receipt. */
export function receiveGroupSeries(accepted: readonly GroupSeriesRevision[], operation: unknown) {
  if (!isGroupSeriesRevision(operation)) throw new Error('Недопустимый результат серии.');
  const existing = accepted.find(end => end.endId === operation.endId);
  if ((existing && existing.ordinal !== operation.ordinal) || accepted.some(end => end.ordinal === operation.ordinal && end.endId !== operation.endId)) {
    throw new Error('Номер опубликованной серии уже занят.');
  }
  if (existing?.revision === operation.revision && !sameResult(existing.result, operation.result)) {
    throw new Error('Эта редакция уже принята с другим результатом.');
  }
  if (existing && existing.revision >= operation.revision) {
    return { accepted, receipt: { endId: existing.endId, revision: existing.revision } };
  }
  const { endId, ordinal, revision, result } = operation;
  const replacement = { endId, ordinal, revision, result: result && {
    scores: result.scores, bowCategory: result.bowCategory, distanceMeters: result.distanceMeters,
    targetProfileId: result.targetProfileId, targetDiameterMm: result.targetDiameterMm,
    ...(result.spread && { spread: { ...result.spread } }),
    ...(result.progressBase && { progressBase: { ...result.progressBase } }),
  } };
  return { accepted: [...accepted.filter(end => end.endId !== endId), replacement], receipt: { endId, revision } };
}

/** One pass over the pending revisions. Read the latest diary again when committing each receipt. */
export async function flushGroupSeries(journal: GroupSeriesJournal, transport: GroupSeriesTransport,
  recordReceipt: (receipt: Pick<GroupSeriesRevision, 'endId' | 'revision'>) => void) {
  for (const end of pendingGroupSeries(journal)) {
    const response = await transport.publish(journal.roomId, journal.entryId, end);
    if (!response || typeof response !== 'object' || !('endId' in response) || response.endId !== end.endId ||
      !('revision' in response) || !positiveInt(response.revision) || response.revision < end.revision) {
      throw new Error('Комната не подтвердила сохранение серии.');
    }
    recordReceipt({ endId: end.endId, revision: end.revision });
  }
}
