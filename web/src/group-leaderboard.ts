import { acceptsDiameter, getTargetProfile } from './target.ts';
import { calculateCompositeFacts, displayCompositeScore } from './composite-scoring.ts';
import type { CompositeScore } from './composite-scoring.ts';
import { isRoomSpread, isRoomProgressBase, validRoomShotPositions } from './group-series.ts';
import type { RoomProgressBase, RoomShotPosition, RoomSpread } from './group-series.ts';
import { calculateProgressTotals, MIN_SCORED_ARROWS } from './progress-scoring.ts';
import type { ProgressResult } from './progress-scoring.ts';

type RoomConditions = { distanceMeters: number; targetProfileId: string; targetDiameterMm: number };

export type RoomSeries = {
  entryId: string;
  ordinal: number;
  revision?: number;
  displayName?: string;
  result: { points: number; arrows: number; bowCategory: string | null; conditions?: RoomConditions; hits?: number; spread?: RoomSpread;
    progressBase?: RoomProgressBase; scores?: string; shotPositions?: RoomShotPosition[] } | null;
};
export type RoomParticipant = { entryId: string; displayName?: string; bowCategory: string | null };
export type RoomHistory = { receivedAt: number; series: RoomSeries[]; participants: RoomParticipant[]; finalizedAt?: number };
export const roomShotPoints = (code: string) => code === 'T' || code === 'X' ? 10 : Number(code);
export const roomShotLabel = (code: string) => code === 'T' ? '10' : code === '0' ? 'M' : code;

function validRoomDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15;
}

export function readRoomHistory(snapshot: unknown): RoomHistory {
  const finalizedAt = snapshot && typeof snapshot === 'object' && 'finalizedAt' in snapshot ? snapshot.finalizedAt : undefined;
  if (finalizedAt !== undefined && !validRoomDate(finalizedAt)) throw new Error('Некорректная дата итогов комнаты.');
  return { receivedAt: Date.now(), series: readRoomSeries(snapshot), participants: readRoomParticipants(snapshot),
    ...(finalizedAt === undefined ? {} : { finalizedAt }) };
}

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

export const roomConditionsKey = (value: RoomConditions) => JSON.stringify([value.distanceMeters, value.targetProfileId, value.targetDiameterMm]);

export function roomConditionChoices(series: readonly RoomSeries[]) {
  const choices = new Map<string, string>();
  for (const end of series) {
    const value = end.result?.conditions;
    if (value) choices.set(roomConditionsKey(value),
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
    (value.receivedAt !== 0 && !validRoomDate(value.receivedAt)) ||
    ('finalizedAt' in value && value.finalizedAt !== undefined && !validRoomDate(value.finalizedAt))) return false;
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
    if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 1)) throw new Error('Некорректная редакция серии.');
    if (result?.spread !== undefined && (typeof result.hits !== 'number' || !Number.isSafeInteger(result.hits) ||
      result.hits < 0 || result.hits > result.arrows || !isRoomSpread(result.spread, result.hits))) {
      throw new Error('Некорректные данные кучности.');
    }
    const base = result?.progressBase;
    if (base !== undefined && !isRoomProgressBase(base)) throw new Error('Некорректная база прогресса.');
    const scores = result?.scores;
    if (result && scores !== undefined && (typeof scores !== 'string' || scores.length !== result.arrows || !/^[0-9TX]+$/.test(scores) ||
      [...scores].reduce((sum, code) => sum + roomShotPoints(code), 0) !== result.points)) throw new Error('Некорректные оценки стрел.');
    const conditions = result?.conditions === undefined ? undefined : readConditions(result.conditions);
    const profile = conditions && getTargetProfile(conditions.targetProfileId);
    const shotPositions = result?.shotPositions;
    if (result && shotPositions !== undefined && (!profile || !scores || !validRoomShotPositions(shotPositions, result.arrows, profile))) {
      throw new Error('Некорректные позиции стрел.');
    }
    return { entryId: value.entryId, ordinal: value.ordinal, revision: value.revision, displayName: value.displayName, result: result && {
      points: result.points, arrows: result.arrows, bowCategory: result.bowCategory,
      ...(scores === undefined ? {} : { scores }),
      ...(conditions === undefined ? {} : { conditions }),
      ...(shotPositions === undefined ? {} : { shotPositions: shotPositions.map(point => point && [...point] as RoomShotPosition) }),
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

function roomSeriesFact(end: RoomSeries) {
  const result = end.result!;
  return { number: end.ordinal, arrows: result.arrows, points: result.points, closed: true,
    complete: result.spread?.complete ?? true, positions: result.spread?.positions ?? 0,
    missingPositions: !result.spread || result.spread.positions !== result.hits,
    squaredDistance: result.spread?.squaredDistance ?? 0,
    pointCount: (result.spread?.positions ?? 0) >= 2 ? result.spread!.positions : 0 };
}

export type RoomScope = 'through' | 'single';
type Metric = { value: number | null; hint?: string; preliminary?: boolean; place: number | null };
const metric = (value: number | null | undefined, hint?: string, preliminary = false): Metric =>
  ({ value: value ?? null, hint, preliminary, place: null });

const compositeReason: Record<CompositeScore['availability'], string> = {
  'no-data': 'Нет закрытых серий', 'incomplete-slice': 'Не хватает серий', 'incomplete-end': 'Неполная серия',
  'insufficient-end-shots': 'Нужно от 3 стрел в серии', 'insufficient-ends': 'Недостаточно серий',
  'missing-coordinates': 'Нет данных о кучности', 'unverified-geometry': 'Разные или неизвестные условия',
  'unknown-maximum': 'Неизвестен максимум', 'invalid-data': 'Некорректные данные', available: 'Недоступно',
};

function scoreRoomSelection(ends: readonly RoomSeries[], ordinal: number, scope: RoomScope) {
  const first = ends[0]?.result;
  const facts = ends.map(roomSeriesFact);
  const arrows = facts.reduce((sum, end) => sum + end.arrows, 0);
  const points = facts.reduce((sum, end) => sum + end.points, 0);
  const full = ends.length === (scope === 'single' ? 1 : ordinal);
  const compatible = !!first?.conditions && ends.every(({ result }) => result?.conditions &&
    roomConditionsKey(result.conditions) === roomConditionsKey(first.conditions!) && result.bowCategory === first.bowCategory);
  const base = first?.progressBase;
  const oneBase = !!base && compatible && ends.every(({ result }) => result?.progressBase?.sessions === base.sessions &&
    result.progressBase.arrows === base.arrows && result.progressBase.points === base.points);
  let composite = calculateCompositeFacts(facts, ordinal, 10, compatible, undefined, scope === 'single');
  if (!full && scope === 'through' && facts.length && compatible) {
    composite = calculateCompositeFacts(facts.map((fact, index) => ({ ...fact, number: index + 1 })), facts.length, 10, true);
  }
  const progress = oneBase ? roomProgress(base, arrows, points, full && ends.every(end => end.result?.spread?.complete === true)) : undefined;
  const status = scope === 'single' ? 'Серия не получена' : 'Нет серий в срезе';
  const metrics: Record<GroupScoring, Metric> = {
    classic: metric(arrows ? points : null, arrows ? undefined : status),
    cg3: metric(composite.total, !arrows ? status : composite.total === undefined ? compositeReason[composite.availability]
      : !full ? 'Не все серии получены' : composite.phase === 'early' ? 'Стабильность с третьей серии' : undefined,
      composite.total !== undefined && (!full || composite.phase === 'early')),
    pg1: metric(progress?.percentagePoints, !arrows ? status : !base ? 'Нет базы сравнения' : !oneBase ? 'Разная база или условия'
      : base.sessions < 3 ? 'Набираем базу' : arrows < MIN_SCORED_ARROWS ? `Нужно от ${MIN_SCORED_ARROWS} стрел`
      : !progress?.fullRankAvailable ? 'Нужны полные серии' : undefined, !!progress && !progress.fullRankAvailable),
  };
  // Comparable totals use the same conditions and the same number of arrows at each series position.
  const comparisonKey = full && ends.length && ends.every(({ result }) => result?.conditions && result.bowCategory)
    ? JSON.stringify(ends.map(({ result }) => [roomConditionsKey(result!.conditions!), result!.bowCategory, result!.arrows])) : null;
  return { arrows, points, full, composite, progress, metrics, comparisonKey };
}

export function roomComparison(series: readonly RoomSeries[], participants: readonly RoomParticipant[], options: {
  ordinal: number; scope: RoomScope; sort: GroupScoring; sameConditions: boolean; ownId?: string;
  bow?: string | null; conditions?: string;
}) {
  const { ordinal, scope, sort, sameConditions, ownId } = options;
  const grouped = new Map(participants.map(person => [person.entryId, { person, ends: [] as RoomSeries[] }]));
  for (const end of series) {
    if (!grouped.has(end.entryId)) grouped.set(end.entryId, { person: { entryId: end.entryId, bowCategory: null }, ends: [] });
    grouped.get(end.entryId)!.ends.push(end);
  }
  const rows = [...grouped].flatMap(([id, { person, ends }]) => {
    const visible = ends.filter(end => end.result && end.ordinal <= ordinal && (scope === 'through' || end.ordinal === ordinal))
      .sort((a, b) => a.ordinal - b.ordinal);
    const selected = visible.filter(({ result }) => (options.bow === undefined || result!.bowCategory === options.bow) &&
      (options.conditions === undefined || !!result!.conditions && roomConditionsKey(result!.conditions) === options.conditions));
    const last = selected.at(-1)?.result;
    const bow = last?.bowCategory ?? person.bowCategory ?? ends.find(end => end.result)?.result?.bowCategory ?? null;
    if (!selected.length && (options.conditions !== undefined || options.bow !== undefined && options.bow !== bow)) return [];
    return [{ id, bow, name: person.displayName || ends.find(end => end.displayName)?.displayName,
      seriesCount: selected.length, current: selected.find(end => end.ordinal === ordinal)?.result ?? null,
      ...scoreRoomSelection(selected, ordinal, scope) }];
  });
  const cohorts = new Map<string, number>();
  for (const row of rows) if (row.comparisonKey) cohorts.set(row.comparisonKey, (cohorts.get(row.comparisonKey) ?? 0) + 1);
  const ownRow = rows.find(row => row.id === ownId);
  const cohort = ownRow ? ownRow.comparisonKey : [...cohorts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const compare = (id: GroupScoring) => (a: typeof rows[number], b: typeof rows[number]) =>
    (b.metrics[id].value ?? -Infinity) - (a.metrics[id].value ?? -Infinity) || a.id.localeCompare(b.id);
  for (const id of ['classic', 'cg3', 'pg1'] as const) {
    const ranked = rows.filter(row => row.metrics[id].value !== null && !row.metrics[id].preliminary &&
      (id === 'pg1' || sameConditions && !!cohort && row.comparisonKey === cohort)).sort(compare(id));
    let lastValue: string | undefined;
    let place = 0;
    ranked.forEach((row, index) => {
      const value = displayCompositeScore(row.metrics[id].value!);
      if (value !== lastValue) place = index + 1;
      row.metrics[id].place = place;
      lastValue = value;
    });
  }
  return rows.sort((a, b) => (a.metrics[sort].place ?? Infinity) - (b.metrics[sort].place ?? Infinity) || compare(sort)(a, b));
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
        (conditions === undefined || !!result.conditions && roomConditionsKey(result.conditions) === conditions);
    });
    const current = comparable.find(end => end.ordinal === ordinal)?.result ?? null;
    const points = comparable.reduce((sum, end) => sum + end.result!.points, 0);
    const arrows = comparable.reduce((sum, end) => sum + end.result!.arrows, 0);
    const displayName = people.get(id)?.displayName ?? ends.filter(end => end.displayName).at(-1)?.displayName;
    const comparableConditions = new Set(comparable.map(end => end.result!.conditions && roomConditionsKey(end.result!.conditions)));
    const compatible = comparableConditions.size === 1 && !comparableConditions.has(undefined) &&
      new Set(comparable.map(end => end.result!.bowCategory)).size === 1;
    const facts = comparable.map(roomSeriesFact);
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
