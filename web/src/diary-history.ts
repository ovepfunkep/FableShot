import type { Diary, DiaryEntry } from './persistence.ts';

export type HistoryFilters = { query: string; from: string; to: string; distance: string; bow: string; deleted: boolean };
export const DEFAULT_HISTORY_FILTERS: HistoryFilters = { query: '', from: '', to: '', distance: '', bow: '', deleted: false };
const localDateFormat = new Intl.DateTimeFormat('sv-SE');

export function compareDiaryDate(left: DiaryEntry, right: DiaryEntry): number {
  const time = (entry: DiaryEntry) => {
    const parsed = Date.parse(entry.startedAt);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  return time(right) - time(left) || right.id.localeCompare(left.id);
}

export function filterDiary(entries: readonly DiaryEntry[], filters: HistoryFilters): DiaryEntry[] {
  const query = filters.query.trim().toLocaleLowerCase('ru-RU');
  return entries.filter(entry => {
    if (!!entry.deletedAt !== filters.deleted) return false;
    const conditions = query || filters.distance || filters.bow
      ? entry.practice.rounds.flatMap(round => round.series.map(series => series.conditions)) : [];
    const date = entry.localDate !== undefined ? entry.localDate : Number.isFinite(Date.parse(entry.startedAt))
      ? localDateFormat.format(new Date(entry.startedAt)) : null;
    if ((filters.from && (!date || date < filters.from)) || (filters.to && (!date || date > filters.to))) return false;
    if ((filters.distance || filters.bow) && !conditions.some(item =>
      (!filters.distance || String(item.distanceMeters) === filters.distance) &&
      (!filters.bow || (item.equipment?.bow.category ?? 'unknown') === filters.bow))) return false;
    if (query && ![entry.title ?? '', date ?? '', ...conditions.flatMap(item => [item.equipment?.name ?? '', item.equipment?.bow.name ?? '', item.equipment?.arrows.name ?? '']),
      ...(entry.notes ?? []).filter(note => note.deletedAtMs == null).flatMap(note => [note.body, note.place, note.feeling, note.conditions, ...note.tags])]
      .some(text => text.toLocaleLowerCase('ru-RU').includes(query))) return false;
    return true;
  }).sort(compareDiaryDate);
}

export function setDiaryDeleted(diary: Diary, id: string, deleted: boolean, now = new Date().toISOString()): Diary {
  const entry = diary.entries.find(entry => entry.id === id);
  if (!entry) throw new Error('Тренировка не найдена.');
  if (deleted && entry.practice.savedAt === null && !entry.paused) throw new Error('Сначала заверши тренировку.');
  if (deleted && !Number.isFinite(Date.parse(now))) throw new Error('Неверная дата удаления.');
  return { ...diary, entries: diary.entries.map(entry => entry.id === id ? { ...entry, deletedAt: deleted ? now : null } : entry) };
}
