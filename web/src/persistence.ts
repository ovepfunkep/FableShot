import { appStorage } from './app-storage.ts';
import { isImportSource, isLocalDate } from './import-source.ts';
import { isTournamentList } from './tournaments.ts';
import type { Tournament } from './tournaments.ts';
import type { ImportSource } from './import-source.ts';
import { isTrainingTime } from './training-time.ts';
import type { TrainingTime } from './training-time.ts';
import { isDiaryNotes } from './diary-notes.ts';
import type { DiaryNote } from './diary-notes.ts';
import { isAchievementEnrollment, isAchievementLedger } from './achievement-ledger.ts';
import type { AchievementEnrollment, AchievementLedger } from './achievement-ledger.ts';
import { isPersonalRecordEvent } from './personal-record-events.ts';
import type { PersonalRecordEvent } from './personal-record-events.ts';
import type { Point, Shot } from './target.ts';
import { isInMissRing, isOnFace } from './target.ts';
import { appendShot, completePractice, emptyPractice, ROUND_LIMIT } from './practice.ts';
import { DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE, MAX_SERIES_ARROWS, isConditions, isRoundRule } from './conditions.ts';
import type { Conditions, RoundRule } from './conditions.ts';
import type { Practice, Round, Series } from './practice.ts';
import { isTechniqueSelection } from './technique.ts';
import { isTechniqueReflections } from './technique-reflection.ts';
import { validNumberedCount } from './equipment.ts';
import { isProgressBaseline, progressConditionKey } from './progress-scoring.ts';
import { acknowledgeGroupSeries, flushGroupSeries, isGroupSeriesJournal, trackGroupSeries } from './group-series.ts';
import type { GroupSeriesJournal, GroupSeriesTransport } from './group-series.ts';

const legacyPracticeKey = 'app.fableshot.practice-pilot.v1';
const previousPracticeKey = 'app.fableshot.practice-pilot.v2';
const practiceKey = 'app.fableshot.practice-pilot.v3';
export const DIARY_KEY = 'app.fableshot.practice-diary.v1';
export type DiaryEntry = { id: string; startedAt: string; createdAt?: string; practice: Practice; title?: string; localDate?: string | null;
  source?: ImportSource; deletedAt?: string | null; trainingTime?: TrainingTime; notes?: DiaryNote[];
  achievementEnrollment?: AchievementEnrollment; nativeArchiveSession?: string; personalRecords?: PersonalRecordEvent[]; paused?: boolean };
export type NativeArchiveReference = { sha256: string; bytes: number };
export const NATIVE_ARCHIVE_BYTE_LIMIT = 64 * 1024 * 1024;
export type TrainingSetup = { conditions: Conditions; rule: RoundRule; numberedArrows: boolean | null };
export type Diary = { version: 1; entries: DiaryEntry[]; achievementLedger?: AchievementLedger; nativeArchive?: NativeArchiveReference;
  notes?: DiaryNote[]; lastSetup?: TrainingSetup; tournaments?: Tournament[]; groupSeries?: GroupSeriesJournal[] };

type LegacyPractice = {
  shots: Shot[];
  savedAt: string | null;
};

export type { Practice } from './practice.ts';

function isPoint(value: unknown): value is Point {
  if (value === null || typeof value !== 'object') return false;
  const { x, y } = value as Partial<Point>;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y);
}

function isShot(value: unknown): value is Shot {
  if (value === null || typeof value !== 'object') return false;
  const { point, points, code, physicalArrowNumber, imported, sourcePoint, missPoint } = value as Partial<Shot>;
  if (imported !== undefined && imported !== true) return false;
  if (sourcePoint !== undefined && (imported !== true || !isPoint(sourcePoint))) return false;
  if (physicalArrowNumber !== undefined && !validNumberedCount(physicalArrowNumber)) return false;
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 0 || points > 10) return false;
  if (missPoint !== undefined && (points !== 0 || !isPoint(missPoint))) return false;
  if (points === 0) return point === null && code === 'M';
  return (isPoint(point) || (point === null && imported === true)) && (code === String(points) || (points === 10 && code === 'X'));
}

function isSavedAt(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function isLegacyPractice(value: unknown): value is LegacyPractice {
  if (value === null || typeof value !== 'object') return false;
  const { shots, savedAt } = value as Partial<LegacyPractice>;
  return Array.isArray(shots) && shots.length <= 3 && Array.from(shots).every(isShot) && isSavedAt(savedAt);
}

function isSeries(value: unknown, legacy = false): value is Series {
  if (value === null || typeof value !== 'object') return false;
  const { id, shots, conditions, plannedCount } = value as Partial<Series>;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
    !Array.isArray(shots) || shots.length > (legacy ? ROUND_LIMIT : MAX_SERIES_ARROWS) ||
    !Array.from(shots).every(isShot)) return false;
  if (legacy) return true;
  if (plannedCount !== undefined && (!Number.isSafeInteger(plannedCount) || plannedCount < Math.max(3, shots.length) || plannedCount > MAX_SERIES_ARROWS)) return false;
  if (!isConditions(conditions)) return false;
  const used = new Set<number>();
  const target = { profileId: conditions.targetProfileId, diameterMm: conditions.targetDiameterMm,
    shaftDiameterMm: conditions.equipment?.arrows.diameterMm ?? 6 };
  return shots.every(shot => {
    if (shot.physicalArrowNumber !== undefined) {
      if (used.has(shot.physicalArrowNumber)) return false;
      used.add(shot.physicalArrowNumber);
    }
    return (shot.point === null || isOnFace(shot.point, target)) &&
      (shot.missPoint === undefined || isInMissRing(shot.missPoint, target));
  });
}

function isRound(value: unknown, legacy = false): value is Round {
  if (value === null || typeof value !== 'object') return false;
  const { id, series } = value as Partial<Round>;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 &&
    Array.isArray(series) && series.length > 0 && Array.from(series).every(item => isSeries(item, legacy)) &&
    (!legacy || series.reduce((count, item) => count + item.shots.length, 0) <= ROUND_LIMIT);
}

function isPractice(value: unknown, legacy = false): value is Practice {
  if (value === null || typeof value !== 'object') return false;
  const { rounds, savedAt, nextId, roundRule, techniqueUses, techniqueReflections, numberedArrows, progressBaselines } = value as Partial<Practice>;
  if (numberedArrows != null && typeof numberedArrows !== 'boolean') return false;
  if (techniqueUses !== undefined && (!Array.isArray(techniqueUses) || techniqueUses.length > 10_000 ||
    !Array.from(techniqueUses).every(use => use && typeof use === 'object' && Number.isSafeInteger(use.seriesId) &&
      use.seriesId > 0 && (use.arrowsBefore === null || (Number.isSafeInteger(use.arrowsBefore) && use.arrowsBefore >= 0 && use.arrowsBefore <= MAX_SERIES_ARROWS)) &&
      isTechniqueSelection(use.selection)))) return false;
  if (techniqueReflections !== undefined && !isTechniqueReflections(techniqueReflections, techniqueUses?.length ?? 0)) return false;
  if (!Array.isArray(rounds) || !rounds.length || !Array.from(rounds).every(round => isRound(round, legacy)) ||
    !isSavedAt(savedAt) || typeof nextId !== 'number' || !Number.isSafeInteger(nextId) ||
    nextId > Number.MAX_SAFE_INTEGER - 2) return false;
  if (!legacy && (!isRoundRule(roundRule) || (roundRule.unit === 'arrows' && rounds.some(round =>
    round.series.reduce((count: number, series: Series) => count + series.shots.length, 0) > roundRule.limit!)))) return false;
  if (progressBaselines !== undefined && (!progressBaselines || typeof progressBaselines !== 'object' || Array.isArray(progressBaselines) ||
    Object.entries(progressBaselines).some(([id, baseline]) => !/^[1-9]\d*$/.test(id) || Number(id) >= nextId || !isProgressBaseline(baseline)))) return false;
  const ids = new Set<number>();
  for (const round of rounds) {
    for (const { id } of [round, ...round.series]) {
      if (ids.has(id) || id >= nextId) return false;
      ids.add(id);
    }
    for (const series of round.series) {
      if (series.progressBaselineId === undefined) continue;
      if (!Number.isSafeInteger(series.progressBaselineId) || series.progressBaselineId <= 0) return false;
      const baseline = progressBaselines?.[String(series.progressBaselineId)];
      if (!baseline || progressConditionKey(series.conditions) !== baseline.conditionKey) return false;
    }
  }
  return savedAt === null || rounds.some(round => round.series.some(series => series.shots.length > 0));
}

function decode(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new Error('Не удалось прочитать сохранённую серию. Исходная запись сохранена.', { cause });
  }
}

export function loadPractice(): Practice {
  const raw = appStorage.getItem(practiceKey);
  if (raw !== null) {
    const value = decode(raw);
    if (!isPractice(value)) throw new Error('Неверный формат сохранённой тренировки. Исходная запись сохранена.');
    return value;
  }
  const previous = appStorage.getItem(previousPracticeKey);
  if (previous !== null) {
    const value = decode(previous);
    if (!isPractice(value, true)) throw new Error('Неверный формат сохранённой тренировки. Исходная запись сохранена.');
    return {
      ...value, roundRule: { ...DEFAULT_ROUND_RULE },
      rounds: value.rounds.map(round => ({ ...round, series: round.series.map(series => ({
        ...series, conditions: structuredClone(DEFAULT_CONDITIONS),
      })) })),
    };
  }
  const legacy = appStorage.getItem(legacyPracticeKey);
  if (legacy === null) return emptyPractice();
  const value = decode(legacy);
  if (!isLegacyPractice(value)) throw new Error('Неверный формат сохранённой серии. Исходная запись сохранена.');
  const practice = value.shots.reduce(appendShot, emptyPractice());
  return value.savedAt === null ? practice : completePractice(practice, value.savedAt);
}

export function savePractice(value: Practice): void {
  if (!isPractice(value)) throw new Error('Тренировка содержит недопустимые данные.');
  // A retry must not silently overwrite an unreadable diary entry.
  loadPractice();
  appStorage.setItem(practiceKey, JSON.stringify(value));
}

export function isDiary(value: unknown): value is Diary {
  if (!value || typeof value !== 'object') return false;
  const { version, entries, achievementLedger, nativeArchive, notes, lastSetup, tournaments, groupSeries } = value as Partial<Diary>;
  if (version !== 1 || !Array.isArray(entries) || achievementLedger !== undefined && !isAchievementLedger(achievementLedger)) return false;
  if (groupSeries !== undefined && (!Array.isArray(groupSeries) || !groupSeries.every(isGroupSeriesJournal) ||
    new Set(groupSeries.map(journal => journal.trainingId ?? journal.entryId)).size !== groupSeries.length ||
    new Set(groupSeries.map(journal => journal.entryId)).size !== groupSeries.length)) return false;
  if (lastSetup !== undefined && (!lastSetup || !isConditions(lastSetup.conditions) || !isRoundRule(lastSetup.rule) ||
    (lastSetup.numberedArrows !== null && typeof lastSetup.numberedArrows !== 'boolean'))) return false;
  if (notes !== undefined && (!isDiaryNotes(notes) || notes.some(note => note.seriesId !== undefined || note.conditionKey !== undefined))) return false;
  if (nativeArchive !== undefined && (!nativeArchive || typeof nativeArchive.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(nativeArchive.sha256) || !Number.isSafeInteger(nativeArchive.bytes) ||
    nativeArchive.bytes < 1 || nativeArchive.bytes > NATIVE_ARCHIVE_BYTE_LIMIT)) return false;
  const ids = new Set<string>();
  const recordIds = new Set<string>();
  let open = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) ||
      typeof entry.startedAt !== 'string' || (!isSavedAt(entry.startedAt) && !(entry.startedAt === '' && (entry.source || entry.nativeArchiveSession) && entry.localDate === null)) || !isPractice(entry.practice) ||
      (entry.createdAt !== undefined && (typeof entry.createdAt !== 'string' || !isSavedAt(entry.createdAt))) ||
      (entry.paused !== undefined && (typeof entry.paused !== 'boolean' || entry.paused && entry.practice.savedAt !== null)) ||
      (entry.nativeArchiveSession !== undefined && (!nativeArchive || typeof entry.nativeArchiveSession !== 'string' ||
        !entry.nativeArchiveSession || entry.nativeArchiveSession.length > 128)) ||
      (entry.title !== undefined && (typeof entry.title !== 'string' || entry.title.length > 5000)) ||
      (entry.deletedAt !== undefined && (!isSavedAt(entry.deletedAt) || (entry.deletedAt !== null && entry.practice.savedAt === null && !entry.paused))) ||
      (entry.trainingTime !== undefined && !isTrainingTime(entry.trainingTime, entry.practice.savedAt === null && !entry.paused && !entry.deletedAt)) ||
      (entry.notes !== undefined && !isDiaryNotes(entry.notes)) ||
      (entry.achievementEnrollment !== undefined && (entry.source !== undefined || !isAchievementEnrollment(entry.achievementEnrollment))) ||
      (entry.localDate !== undefined && entry.localDate !== null && !isLocalDate(entry.localDate)) ||
      (entry.source !== undefined && !isImportSource(entry.source))) return false;
    if (entry.personalRecords !== undefined) {
      if (!Array.isArray(entry.personalRecords)) return false;
      for (const record of entry.personalRecords) {
        if (!isPersonalRecordEvent(record) || record.sessionId !== entry.id || recordIds.has(record.id)) return false;
        recordIds.add(record.id);
      }
    }
    ids.add(entry.id);
    if (entry.practice.savedAt === null && !entry.paused && !entry.deletedAt && ++open > 1) return false;
  }
  return tournaments === undefined || isTournamentList(tournaments, ids);
}

export function loadDiary(legacyDate = new Date().toISOString()): Diary {
  const stored = appStorage.getItem(DIARY_KEY);
  if (stored !== null) {
    const value = decode(stored);
    if (!isDiary(value)) throw new Error('Неверный формат дневника. Исходная запись сохранена.');
    return value;
  }
  if ([practiceKey, previousPracticeKey, legacyPracticeKey].every(key => appStorage.getItem(key) === null)) {
    return { version: 1, entries: [] };
  }
  const practice = loadPractice();
  return { version: 1, entries: [{ id: 'pilot', startedAt: practice.savedAt ?? legacyDate, practice }] };
}

export function saveDiary(next: Diary, previous: Diary): void {
  if (!isDiary(next)) throw new Error('Дневник содержит недопустимые данные.');
  const current = loadDiary(previous.entries.find(entry => entry.id === 'pilot')?.startedAt);
  if (JSON.stringify(current) !== JSON.stringify(previous)) throw new Error('Дневник изменён в другом окне. Открой приложение заново.');
  appStorage.setItem(DIARY_KEY, JSON.stringify(next));
}

/** Outbox changes are committed atomically with the practice edit that produced them. */
export function updateGroupSeriesInDiary(diary: Diary, entryId: string, practice: Practice): Diary {
  const journal = diary.groupSeries?.find(item => (item.trainingId ?? item.entryId) === entryId);
  if (!journal) return diary;
  const updated = trackGroupSeries(journal, practice);
  if (updated === journal) return diary;
  return { ...diary, groupSeries: diary.groupSeries!.map(item => item === journal ? updated : item) };
}

/** Use the current diary for each receipt so an edit made during upload stays queued. */
export async function sendPendingGroupSeries(entryId: string, transport: GroupSeriesTransport,
  read: () => Diary | null, write: (change: (diary: Diary) => Diary) => boolean): Promise<void> {
  const journal = read()?.groupSeries?.find(item => item.entryId === entryId);
  if (!journal) return;
  await flushGroupSeries(journal, transport, receipt => {
    const saved = write(diary => {
      const current = diary.groupSeries?.find(item => item.entryId === entryId && item.roomId === journal.roomId);
      if (!current) return diary;
      const updated = acknowledgeGroupSeries(current, receipt);
      if (updated === current) return diary;
      return { ...diary, groupSeries: diary.groupSeries!.map(item => item === current ? updated : item) };
    });
    if (!saved) throw new Error('Не удалось сохранить подтверждение комнаты.');
  });
}
