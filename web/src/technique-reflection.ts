import type { Practice } from './practice.ts';

export type TechniqueReflectionEntry = {
  worked: string;
  question: string;
  rating: 'yes' | 'unstable' | 'untracked' | null;
};
export type TechniqueReflections = Record<string, TechniqueReflectionEntry>;
export const MAX_REFLECTION_TEXT = 4000;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_REFLECTION_TEXT;

export function isTechniqueReflectionEntry(value: unknown): value is TechniqueReflectionEntry {
  return record(value) && Object.keys(value).length === 3 && text(value.worked) && text(value.question) &&
    (value.rating === null || value.rating === 'yes' || value.rating === 'unstable' || value.rating === 'untracked');
}

/** Keys are append-only technique-use positions, independent of edits/deletions of series. */
export function isTechniqueReflections(value: unknown, useCount: number): value is TechniqueReflections {
  return record(value) && Number.isSafeInteger(useCount) && useCount >= 0 &&
    Object.entries(value).every(([key, entry]) => /^(0|[1-9]\d*)$/.test(key) &&
      Number.isSafeInteger(Number(key)) && Number(key) < useCount && isTechniqueReflectionEntry(entry));
}

export function emptyTechniqueReflection(): TechniqueReflectionEntry {
  return { worked: '', question: '', rating: null };
}

export function hasTechniqueReflection(entry: TechniqueReflectionEntry | undefined): boolean {
  return !!entry && (!!entry.worked.trim() || !!entry.question.trim() || entry.rating !== null);
}

export function relevantTechniqueUseIndexes(practice: Practice): number[] {
  return (practice.techniqueUses ?? []).flatMap((use, index) => use.selection.versionId !== null ||
    use.selection.focus1.trim() || use.selection.focus2.trim() || hasTechniqueReflection(practice.techniqueReflections?.[String(index)])
    ? [index] : []);
}

export function techniqueUsePlace(practice: Practice, useIndex: number): string {
  const use = practice.techniqueUses?.[useIndex];
  for (let round = 0; round < practice.rounds.length; round++) {
    const series = practice.rounds[round].series.findIndex(item => item.id === use?.seriesId);
    if (series >= 0) return `Раунд ${round + 1} · серия ${series + 1}`;
  }
  return 'Серия удалена';
}

export function updateTechniqueReflection(practice: Practice, useIndex: number, entry: TechniqueReflectionEntry): Practice {
  if (practice.savedAt === null) throw new Error('Рефлексия доступна после завершения тренировки.');
  if (!Number.isSafeInteger(useIndex) || useIndex < 0 || !practice.techniqueUses?.[useIndex]) throw new Error('Привязка техники не найдена.');
  if (!isTechniqueReflectionEntry(entry)) throw new Error('Проверь рефлексию: не больше 4000 знаков в каждом поле.');
  if (practice.techniqueReflections !== undefined && !isTechniqueReflections(practice.techniqueReflections, practice.techniqueUses.length)) {
    throw new Error('Неверный формат сохранённой рефлексии. Исходные данные сохранены.');
  }
  return { ...practice, techniqueReflections: { ...practice.techniqueReflections, [String(useIndex)]: { ...entry } } };
}
