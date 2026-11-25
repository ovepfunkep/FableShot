import type { Conditions } from './conditions.ts';
import { BOW_CATEGORIES } from './equipment.ts';
import { exerciseRank } from './exercise-rank.ts';
import type { DiaryEntry } from './persistence.ts';
import { timelineDate } from './progress-timeline.ts';
import type { RankCategory } from './sport-ranks.ts';
import { acceptsDiameter, getTargetProfile, summarize } from './target.ts';

export type PersonalRecordEvent = {
  id: string;
  sessionId: string;
  kind: 'series' | 'round' | 'volume' | 'rank';
  ruleVersion: 1;
  label: string;
  previousValue: number;
  value: number;
  previousSessionId: string;
  recordedAtMs: number;
  notifiedAtMs: number | null;
  sessionRevision?: number;
};

export function personalRecordTitle(kind: PersonalRecordEvent['kind']) {
  return { series: 'Рекорд серии', round: 'Рекорд раунда', volume: 'Рекорд по числу стрел', rank: 'Рекорд упражнения' }[kind];
}

export function personalRecordValue(kind: PersonalRecordEvent['kind'], value: number) {
  return `${value} ${kind === 'volume' ? 'стр.' : 'очк.'}`;
}

export type PersonalSeriesRecord = {
  sessionId: string;
  seriesId: number;
  roundNumber: number;
  seriesNumber: number;
  date: string | null;
  points: number;
  maximum: number;
  conditions: Conditions;
  arrows: number;
  targetTitle: string;
  equipmentTitle: string;
};

type SeriesCandidate = PersonalSeriesRecord & { key: string; sourceOrder: number };
export type PersonalRoundRecord = Omit<PersonalSeriesRecord, 'seriesId' | 'seriesNumber'> & { roundId: number; key: string; format: string };
type VolumeRecord = { entry: DiaryEntry; count: number };
const compareText = (a: string, b: string) => a < b ? -1 : Number(a > b);
const compareDates = (a: string | null, b: string | null) =>
  a === null ? Number(b !== null) : b === null ? -1 : compareText(a, b);
const score = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256;

export function isPersonalRecordEvent(value: unknown): value is PersonalRecordEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<PersonalRecordEvent>;
  return identifier(event.id) && identifier(event.sessionId) && identifier(event.previousSessionId) &&
    event.sessionId !== event.previousSessionId && event.ruleVersion === 1 &&
    (event.kind === 'series' || event.kind === 'round' || event.kind === 'volume' || event.kind === 'rank') &&
    typeof event.label === 'string' && event.label.trim().length > 0 && event.label.length <= 5000 &&
    score(event.previousValue) && score(event.value) && event.value > event.previousValue &&
    timestamp(event.recordedAtMs) && (event.notifiedAtMs === null || timestamp(event.notifiedAtMs)) &&
    (event.sessionRevision === undefined || Number.isSafeInteger(event.sessionRevision) && event.sessionRevision > 0);
}

/** Snapshot equality includes revisions and equipment details, independent of JSON property order. */
function snapshotKey(conditions: Conditions, arrows: number): string {
  return JSON.stringify([conditions.distanceMeters, conditions.targetDiameterMm, conditions.targetProfileId,
    conditions.equipment, arrows], (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareText(a, b)));
  });
}

function fullSeries(entry: DiaryEntry): SeriesCandidate[] {
  if (entry.deletedAt || entry.practice.savedAt === null) return [];
  const date = timelineDate(entry);
  let sourceOrder = 0;
  return entry.practice.rounds.flatMap((round, roundIndex) => round.series.flatMap((series, seriesIndex) => {
    const order = sourceOrder++;
    const { conditions, shots } = series;
    const arrows = series.plannedCount ?? Math.max(3, shots.length);
    if (!shots.length || shots.length !== arrows) return [];
    const profile = getTargetProfile(conditions.targetProfileId);
    if (!profile || !acceptsDiameter(profile, conditions.targetDiameterMm)) return [];
    return [{ key: snapshotKey(conditions, arrows), sourceOrder: order, date, conditions, arrows,
      sessionId: entry.id, seriesId: series.id, roundNumber: roundIndex + 1, seriesNumber: seriesIndex + 1,
      points: summarize(shots).points, maximum: arrows * Math.max(...profile.zones.map(zone => zone.points)),
      targetTitle: profile.title, equipmentTitle: conditions.equipment?.name || 'Комплект не указан' }];
  }));
}

function bestSeries(records: readonly SeriesCandidate[]): SeriesCandidate[] {
  const winners = new Map<string, SeriesCandidate>();
  for (const record of records) {
    const best = winners.get(record.key);
    if (!best || (best.points - record.points || compareDates(record.date, best.date) ||
      compareText(record.sessionId, best.sessionId) || record.sourceOrder - best.sourceOrder ||
      record.seriesId - best.seriesId) < 0) winners.set(record.key, record);
  }
  return [...winners.values()].sort((a, b) => a.conditions.distanceMeters - b.conditions.distanceMeters ||
    a.arrows - b.arrows || a.conditions.targetDiameterMm - b.conditions.targetDiameterMm ||
    compareText(a.targetTitle, b.targetTitle) || compareText(a.equipmentTitle, b.equipmentTitle) ||
    a.seriesId - b.seriesId);
}

export function personalSeriesRecords(entries: readonly DiaryEntry[]): PersonalSeriesRecord[] {
  return bestSeries(entries.flatMap(fullSeries)).map(({ key: _key, sourceOrder: _order, ...record }) => record);
}

export function fullRoundRecords(entry: DiaryEntry, allowUnknownBow = false): PersonalRoundRecord[] {
  if (entry.deletedAt || entry.practice.savedAt === null) return [];
  const { unit, limit } = entry.practice.roundRule;
  if (unit === 'unlimited' || !limit) return [];
  return entry.practice.rounds.flatMap((round, index) => {
    const series = round.series.filter(item => item.shots.length);
    const conditions = series[0]?.conditions;
    const profile = conditions && getTargetProfile(conditions.targetProfileId);
    if (!conditions || !profile || !acceptsDiameter(profile, conditions.targetDiameterMm) ||
      (!allowUnknownBow && !conditions.equipment?.bow.category)) return [];
    const shots = series.flatMap(item => item.shots);
    if ((unit === 'arrows' ? shots.length : series.length) !== limit) return [];
    const key = snapshotKey(conditions, shots.length);
    if (series.some(item => snapshotKey(item.conditions, shots.length) !== key ||
      unit === 'series' && item.shots.length !== (item.plannedCount ?? Math.max(3, item.shots.length)))) return [];
    return [{ sessionId: entry.id, roundId: round.id, roundNumber: index + 1, date: timelineDate(entry),
      points: summarize(shots).points, maximum: shots.length * Math.max(...profile.zones.map(zone => zone.points)),
      conditions, arrows: shots.length, targetTitle: profile.title, equipmentTitle: conditions.equipment?.name || 'Комплект не указан',
      key: JSON.stringify([key, unit, limit]), format: unit === 'series' ? `${limit} сер. · ${shots.length} стрел` : `${limit} стрел` }];
  });
}

export function personalRoundRecords(entries: readonly DiaryEntry[]): PersonalRoundRecord[] {
  const winners = new Map<string, PersonalRoundRecord>();
  for (const record of entries.flatMap(entry => fullRoundRecords(entry))) {
    const best = winners.get(record.key);
    if (!best || (best.points - record.points || compareDates(record.date, best.date) ||
      compareText(record.sessionId, best.sessionId) || record.roundNumber - best.roundNumber) < 0) winners.set(record.key, record);
  }
  return [...winners.values()].sort((a, b) => a.conditions.distanceMeters - b.conditions.distanceMeters ||
    a.arrows - b.arrows || compareText(a.equipmentTitle, b.equipmentTitle));
}

function volume(entry: DiaryEntry): number {
  return entry.practice.rounds.reduce((total, round) =>
    total + round.series.reduce((count, series) => count + series.shots.length, 0), 0);
}

export function personalVolumeRecord(entries: readonly DiaryEntry[]): VolumeRecord | null {
  let best: VolumeRecord | null = null;
  for (const entry of entries) {
    if (entry.deletedAt || entry.practice.savedAt === null) continue;
    const count = volume(entry);
    if (count > 0 && (!best || (best.count - count || compareDates(timelineDate(entry), timelineDate(best.entry)) ||
      compareText(entry.id, best.entry.id)) < 0)) best = { entry, count };
  }
  return best;
}

export type PersonalRecordScope = 'all' | 'bow' | 'kit';
type RecordStage = 'series' | 'round' | 'volume';
type PersonalRecordSource = {
  sessionId: string; stageId: number; date: string | null; value: number;
  display?: PersonalSeriesRecord | PersonalRoundRecord;
};
export type PersonalRecordGroup = {
  key: string; scopeKey: string; scopeLabel: string; leader: PersonalRecordSource; history: PersonalRecordSource[];
};

function recordScope(conditions: Conditions, scope: PersonalRecordScope) {
  const equipment = conditions.equipment;
  if (scope === 'all') return { key: 'all', label: 'Общий' };
  if (scope === 'kit' && equipment?.id) return {
    key: JSON.stringify([equipment.id, equipment.bowId ?? null, equipment.arrowsId ?? equipment.arrows.id ?? null]), label: equipment.name,
  };
  if (scope === 'bow' && equipment?.bow.category) return { key: equipment.bow.category,
    label: BOW_CATEGORIES.find(item => item.value === equipment.bow.category)?.label ?? equipment.bow.category };
  return null;
}

export function personalRecordGroups(entries: readonly DiaryEntry[], stage: RecordStage, scope: PersonalRecordScope): PersonalRecordGroup[] {
  const groups = new Map<string, { scopeKey: string; scopeLabel: string; records: PersonalRecordSource[] }>();
  function collect(scopeInfo: NonNullable<ReturnType<typeof recordScope>>, format: unknown, record: PersonalRecordSource) {
    const key = JSON.stringify([scopeInfo.key, format]);
    const group = groups.get(key);
    if (group) group.records.push(record);
    else groups.set(key, { scopeKey: scopeInfo.key, scopeLabel: scopeInfo.label, records: [record] });
  }
  for (const entry of entries) {
    if (entry.deletedAt || entry.practice.savedAt === null) continue;
    if (stage === 'volume') {
      const counts = new Map<string, { scopeInfo: NonNullable<ReturnType<typeof recordScope>>; shots: number }>();
      for (const round of entry.practice.rounds) for (const series of round.series) {
        const scopeInfo = recordScope(series.conditions, scope);
        if (!scopeInfo || !series.shots.length) continue;
        const previous = counts.get(scopeInfo.key);
        if (previous) previous.shots += series.shots.length;
        else counts.set(scopeInfo.key, { scopeInfo, shots: series.shots.length });
      }
      for (const { scopeInfo, shots } of counts.values()) collect(scopeInfo, null, {
        sessionId: entry.id, stageId: 0, date: timelineDate(entry), value: shots,
      });
    } else {
      const candidates = stage === 'series' ? fullSeries(entry) : fullRoundRecords(entry, true);
      for (const display of candidates) {
        const scopeInfo = recordScope(display.conditions, scope);
        if (!scopeInfo) continue;
        const { distanceMeters, targetDiameterMm, targetProfileId } = display.conditions;
        collect(scopeInfo, [distanceMeters, targetDiameterMm, targetProfileId, display.arrows, 'format' in display ? display.format : null], {
          sessionId: entry.id, stageId: 'roundId' in display ? display.roundId : display.seriesId,
          date: display.date, value: display.points, display,
        });
      }
    }
  }
  return [...groups].map(([key, { scopeLabel, scopeKey, records }]) => {
    records.sort((left, right) => compareDates(left.date, right.date) || compareText(left.sessionId, right.sessionId) || left.stageId - right.stageId);
    const history: PersonalRecordSource[] = [];
    let leader = records[0];
    for (const record of records) {
      if (record.value > leader.value) leader = record;
      if (record.date !== null && (!history.length || history.at(-1)!.value < record.value)) history.push(record);
    }
    return { key, scopeLabel, scopeKey, leader, history };
  }).sort((left, right) => (left.leader.display?.conditions.distanceMeters ?? 0) - (right.leader.display?.conditions.distanceMeters ?? 0)
    || (left.leader.display?.arrows ?? 0) - (right.leader.display?.arrows ?? 0) || compareText(left.scopeLabel, right.scopeLabel));
}

const localDate = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' });
const measure = (value: number) => String(value).replace('.', ',');
function rankOrder(entry: DiaryEntry): number {
  const start = Date.parse(entry.startedAt);
  if (Number.isFinite(start)) return start;
  const creation = Date.parse(entry.createdAt ?? '');
  return Number.isFinite(creation) ? creation : Infinity;
}

/** Call when a native web training is completed. History is the state before that mutation. */
export function calculatePersonalRecordEvents(candidate: DiaryEntry, history: readonly DiaryEntry[], category: RankCategory | null,
  atMs: number, newId: () => string = () => crypto.randomUUID()): PersonalRecordEvent[] {
  const completed = Date.parse(candidate.practice.savedAt ?? '');
  if (!timestamp(atMs) || !Number.isFinite(completed) || completed > atMs ||
    candidate.deletedAt || candidate.source || candidate.nativeArchiveSession || candidate.practice.rounds.some(round =>
      round.series.some(series => series.shots.some(shot => shot.imported)))) return [];
  const count = volume(candidate);
  if (!count) return [];
  const today = localDate.format(new Date(atMs));
  const previous = history.filter(entry => {
    if (entry.id === candidate.id || entry.deletedAt || entry.practice.savedAt === null) return false;
    const date = timelineDate(entry);
    const arrival = Date.parse(entry.createdAt ?? entry.startedAt);
    return (!Number.isFinite(arrival) || arrival <= atMs) && Date.parse(entry.practice.savedAt) <= atMs &&
      (date === null || date <= today);
  });
  if (!previous.length) return [];
  const events: PersonalRecordEvent[] = [];
  function improve(kind: PersonalRecordEvent['kind'], label: string, value: number, previousValue: number, previousSessionId: string) {
    if (value <= previousValue) return;
    events.push({ id: newId(), kind, label, ruleVersion: 1, value, previousValue, previousSessionId,
      sessionId: candidate.id, recordedAtMs: atMs, notifiedAtMs: null });
  }
  const candidateSeries = bestSeries(fullSeries(candidate));
  if (candidateSeries.length) {
    const keys = new Set(candidateSeries.map(record => record.key));
    const oldSeries = new Map(bestSeries(previous.flatMap(fullSeries).filter(record => keys.has(record.key)))
      .map(record => [record.key, record]));
    for (const record of candidateSeries) {
      const best = oldSeries.get(record.key);
      if (!best) continue;
      const { conditions, arrows, targetTitle, equipmentTitle } = record;
      const label = `${measure(conditions.distanceMeters)} м · ${measure(conditions.targetDiameterMm / 10)} см · ` +
        `${arrows} в серии · ${targetTitle} · ${equipmentTitle.slice(0, 200)}`;
      improve('series', label, record.points, best.points, best.sessionId);
    }
  }
  const previousVolume = personalVolumeRecord(previous);
  if (previousVolume) improve('volume', 'Стрел за тренировку', count, previousVolume.count, previousVolume.entry.id);

  const rounds = personalRoundRecords([candidate]);
  if (rounds.length) {
    const previousRounds = new Map(personalRoundRecords(previous).map(record => [record.key, record]));
    for (const record of rounds) {
      const best = previousRounds.get(record.key);
      if (!best) continue;
      improve('round', `Раунд · ${record.format} · ${measure(record.conditions.distanceMeters)} м · ${record.targetTitle} · ${record.equipmentTitle}`,
        record.points, best.points, best.sessionId);
    }
  }

  const rank = exerciseRank(candidate.practice, category);
  if (!rank.finalResult || !rank.evaluation) return events;
  const exercise = rank.evaluation.exercise;
  let bestRank: { entry: DiaryEntry; points: number } | null = null;
  for (const entry of previous) {
    const old = exerciseRank(entry.practice, category);
    if (!old.finalResult || old.evaluation?.exercise.id !== exercise.id) continue;
    const points = old.evaluation.points;
    if (!bestRank || (bestRank.points - points || rankOrder(entry) - rankOrder(bestRank.entry) ||
      compareText(entry.id, bestRank.entry.id)) < 0) bestRank = { entry, points };
  }
  if (bestRank) improve('rank', `${rank.classLabel} · ${exercise.distance} м · ${exercise.arrows} стрел`,
    rank.evaluation.points, bestRank.points, bestRank.entry.id);
  return events;
}
