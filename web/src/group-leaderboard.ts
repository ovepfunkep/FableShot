import { acceptsDiameter, getTargetProfile } from './target.ts';
import { calculateCompositeFacts, displayCompositeScore } from './composite-scoring.ts';
import { isRoomSpread, isRoomProgressBase } from './group-series.ts';
import type { RoomProgressBase, RoomSpread } from './group-series.ts';
import { calculateProgressTotals } from './progress-scoring.ts';

type RoomConditions = { distanceMeters: number; targetProfileId: string; targetDiameterMm: number };

export type RoomSeries = {
  entryId: string;
  ordinal: number;
  displayName?: string;
  result: { points: number; arrows: number; bowCategory: string | null; conditions?: RoomConditions; hits?: number; spread?: RoomSpread; progressBase?: RoomProgressBase } | null;
};
export type RoomParticipant = { entryId: string; displayName?: string; bowCategory: string | null };
export type RoomHistory = { receivedAt: number; series: RoomSeries[]; participants: RoomParticipant[] };

function readConditions(value: unknown): RoomConditions {
  if (!value || typeof value !== 'object') throw new Error('Некорректные условия серии.');
  const { distanceMeters, targetProfileId, targetDiameterMm } = value as Partial<RoomConditions>;
  const profile = typeof targetProfileId === 'string' ? getTargetProfile(targetProfileId) : undefined;
  if (!profile || typeof targetProfileId !== 'string' || typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters) ||
    distanceMeters <= 0 || typeof targetDiameterMm !== 'number' || targetDiameterMm > 10_000 || !acceptsDiameter(profile, targetDiameterMm)) {
    throw new Error('Некорректные условия серии.');
  }
  return { distanceMeters, targetProfileId, targetDiameterMm };
}

const conditionsKey = (value: RoomConditions) => JSON.stringify([value.distanceMeters, value.targetProfileId, value.targetDiameterMm]);

export function roomConditionChoices(series: readonly RoomSeries[]) {
  const choices = new Map<string, string>();
  for (const end of series) {
    const value = end.result?.conditions;
    if (value) choices.set(conditionsKey(value),
      `${value.distanceMeters.toLocaleString('ru-RU')} м · ${value.targetDiameterMm / 10} см · ${getTargetProfile(value.targetProfileId)?.title}`);
  }
  return choices;
}

export function readRoomParticipants(snapshot: unknown): RoomParticipant[] {
  if (!snapshot || typeof snapshot !== 'object' || !('participants' in snapshot)) return [];
  if (!Array.isArray(snapshot.participants)) throw new Error('Не удалось прочитать участников.');
  const ids = new Set<string>();
  return snapshot.participants.map((item: RoomParticipant) => {
    if (!item || typeof item.entryId !== 'string' || !/^[a-f0-9]{64}$/.test(item.entryId) || ids.has(item.entryId) ||
      (item.displayName !== undefined && (typeof item.displayName !== 'string' || item.displayName.length > 60)) ||
      (item.bowCategory !== null && typeof item.bowCategory !== 'string')) throw new Error('Некорректный участник комнаты.');
    ids.add(item.entryId);
    return { entryId: item.entryId, displayName: item.displayName, bowCategory: item.bowCategory };
  });
}

export function isRoomHistory(value: unknown): value is RoomHistory {
  if (!value || typeof value !== 'object' || !('receivedAt' in value) || !('participants' in value) ||
    typeof value.receivedAt !== 'number' || !Number.isSafeInteger(value.receivedAt) || value.receivedAt < 0 || value.receivedAt > 8.64e15) return false;
  try { readRoomSeries(value); readRoomParticipants(value); return true; }
  catch { return false; }
}

export function readRoomSeries(snapshot: unknown): RoomSeries[] {
  if (!snapshot || typeof snapshot !== 'object' || !('series' in snapshot) || !Array.isArray(snapshot.series)) {
    throw new Error('Не удалось прочитать результаты комнаты.');
  }
  const keys = new Set<string>();
  return snapshot.series.map((value: RoomSeries) => {
    const result = value?.result;
    if (!value || !/^[a-f0-9]{64}$/.test(value.entryId) || !Number.isSafeInteger(value.ordinal) || value.ordinal < 1 ||
      (value.displayName !== undefined && (typeof value.displayName !== 'string' || value.displayName.length > 60)) ||
      (result !== null && (!result || !Number.isSafeInteger(result.arrows) || result.arrows < 1 ||
        !Number.isSafeInteger(result.points) || result.points < 0 || result.points > result.arrows * 10 ||
        (result.bowCategory !== null && typeof result.bowCategory !== 'string')))) {
      throw new Error('В комнате получена некорректная серия.');
    }
    const key = `${value.entryId}:${value.ordinal}`;
    if (keys.has(key)) throw new Error('В комнате получена повторная серия.');
    keys.add(key);
    if (result?.spread !== undefined && (typeof result.hits !== 'number' || !Number.isSafeInteger(result.hits) ||
      result.hits < 0 || result.hits > result.arrows || !isRoomSpread(result.spread, result.hits))) {
      throw new Error('Некорректные данные кучности.');
    }
    const base = result?.progressBase;
    if (base !== undefined && !isRoomProgressBase(base)) throw new Error('Некорректная база прогресса.');
    return { entryId: value.entryId, ordinal: value.ordinal, displayName: value.displayName, result: result && {
      points: result.points, arrows: result.arrows, bowCategory: result.bowCategory,
      ...(result.conditions === undefined ? {} : { conditions: readConditions(result.conditions) }),
      ...(base && { progressBase: { sessions: base.sessions, arrows: base.arrows, points: base.points } }),
      ...(result.spread && { hits: result.hits, spread: {
        positions: result.spread.positions, squaredDistance: result.spread.squaredDistance, complete: result.spread.complete,
      } }),
    } };
  });
}

export type GroupScoring = 'classic' | 'cg3' | 'pg1';

function roomProgress(base: RoomProgressBase, arrows: number, points: number, complete: boolean) {
  return calculateProgressTotals({ status: base.sessions >= 3 ? 'ready' : 'building', maximumPerArrow: 10,
    scoredCount: base.arrows, scoreSum: base.points }, arrows, points, complete);
}

export function groupStandings(series: readonly RoomSeries[], ordinal: number, category?: string | null, participants: readonly RoomParticipant[] = [],
  conditions?: string, mode: GroupScoring = 'classic') {
  const grouped = new Map<string, RoomSeries[]>();
  const people = new Map(participants.map(person => [person.entryId, person]));
  for (const person of participants) grouped.set(person.entryId, []);
  for (const end of series) {
    const entry = grouped.get(end.entryId);
    if (entry) entry.push(end);
    else grouped.set(end.entryId, [end]);
  }
  const rows = Array.from(grouped, ([id, ends]) => {
    const through = ends.filter(end => end.ordinal <= ordinal);
    const live = through.filter(end => end.result).sort((a, b) => a.ordinal - b.ordinal);
    const last = live.at(-1);
    const bow = last?.result ? last.result.bowCategory : people.get(id)?.bowCategory ?? ends.find(end => end.result)?.result?.bowCategory ?? null;
    const comparable = live.filter(end => {
      const result = end.result!;
      return (category === undefined || result.bowCategory === category) &&
        (conditions === undefined || !!result.conditions && conditionsKey(result.conditions) === conditions);
    });
    const current = comparable.find(end => end.ordinal === ordinal)?.result ?? null;
    const points = comparable.reduce((sum, end) => sum + end.result!.points, 0);
    const arrows = comparable.reduce((sum, end) => sum + end.result!.arrows, 0);
    const displayName = people.get(id)?.displayName ?? ends.filter(end => end.displayName).at(-1)?.displayName;
    const comparableConditions = new Set(comparable.map(end => end.result!.conditions && conditionsKey(end.result!.conditions)));
    const compatible = comparableConditions.size === 1 && !comparableConditions.has(undefined) &&
      new Set(comparable.map(end => end.result!.bowCategory)).size === 1;
    const facts = comparable.map(end => {
      const result = end.result!;
      return { number: end.ordinal, arrows: result.arrows, points: result.points, closed: true,
        complete: result.spread?.complete ?? true, positions: result.spread?.positions ?? 0,
        missingPositions: !result.spread || result.spread.positions !== result.hits,
        squaredDistance: result.spread?.squaredDistance ?? 0,
        pointCount: (result.spread?.positions ?? 0) >= 2 ? result.spread!.positions : 0 };
    });
    const composite = mode === 'cg3' ? calculateCompositeFacts(facts, ordinal, 10, compatible) : undefined;
    const compositeSeries = mode === 'cg3' ? calculateCompositeFacts(facts.filter(end => end.number === ordinal), ordinal, 10,
      !!current?.conditions, undefined, true) : undefined;
    const base = current?.progressBase;
    const oneBase = !!base && compatible && comparable.every(({ result }) => result?.progressBase?.sessions === base.sessions &&
      result.progressBase.arrows === base.arrows && result.progressBase.points === base.points);
    const progress = mode === 'pg1' && oneBase ? roomProgress(base, arrows, points,
      comparable.length === ordinal && comparable.every(end => end.result?.spread?.complete === true)) : undefined;
    const progressSeries = mode === 'pg1' && current && base ? roomProgress(base, current.arrows, current.points, false) : undefined;
    const rankScore = mode === 'classic' ? points : mode === 'cg3' ? composite?.total : progress?.fullRankAvailable ? progress.percentagePoints : null;
    const roundedRank = rankScore == null ? null : Number(displayCompositeScore(rankScore));
    return { id, bow: comparable.at(-1)?.result?.bowCategory ?? bow, displayName, current, points, arrows, composite, compositeSeries,
      progress, progressSeries, base, rankScore: roundedRank,
      visible: conditions === undefined ? category === undefined || comparable.length > 0 || bow === category : comparable.length > 0,
      complete: !!current && live.length === ordinal && comparable.length === ordinal && roundedRank !== null,
      place: null as number | null };
  }).filter(row => row.visible);
  rows.sort((a, b) => Number(b.complete) - Number(a.complete) || (b.rankScore ?? -1) - (a.rankScore ?? -1) || a.id.localeCompare(b.id));
  let previousPoints: number | undefined;
  let place = 0;
  return rows.map((row, index) => {
    if (!row.complete) return row;
    if (row.rankScore !== previousPoints) place = index + 1;
    previousPoints = row.rankScore!;
    return { ...row, place };
  });
}
