import { isLocalDate } from './import-source.ts';
import { getTargetProfile } from './target.ts';

export type DiaryNoteScope = { seriesId?: number; conditionKey?: string };
export type DiaryNote = DiaryNoteScope & {
  id: string;
  localDate: string;
  body: string;
  tags: string[];
  place: string;
  feeling: string;
  conditions: string;
  createdAtMs: number;
  updatedAtMs: number;
  deletedAtMs?: number | null;
};

export const NOTE_FIELD_LIMITS = { body: 8000, place: 120, feeling: 240, conditions: 500 } as const;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 30;
const controlCharacter = /[\u0000-\u001f]/;

function validTags(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_TAGS) return false;
  const names = new Set<string>();
  for (const tag of value) {
    if (typeof tag !== 'string' || !tag.length || tag.length > MAX_TAG_LENGTH || tag !== tag.trim() ||
      tag.includes(',') || controlCharacter.test(tag)) return false;
    const name = tag.toLowerCase();
    if (names.has(name)) return false;
    names.add(name);
  }
  return true;
}

export function encodeNoteTags(text: string): string[] {
  const tags = new Map<string, string>();
  for (const part of text.split(',')) {
    const tag = part.trim();
    const name = tag.toLowerCase();
    if (tag && !tags.has(name)) tags.set(name, tag);
  }
  const values = [...tags.values()];
  if (!validTags(values)) throw new Error(`До ${MAX_TAGS} тегов по ${MAX_TAG_LENGTH} символов каждый. Используй запятую для разделения тегов.`);
  return values;
}

const boundedText = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit;
const validTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function isDiaryNote(value: unknown): value is DiaryNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { id, localDate, body, tags, place, feeling, conditions, createdAtMs, updatedAtMs, seriesId, conditionKey, deletedAtMs } = value as Partial<DiaryNote>;
  return boundedText(id, 128) && !!id.length && !controlCharacter.test(id) && isLocalDate(localDate) &&
    boundedText(body, NOTE_FIELD_LIMITS.body) && boundedText(place, NOTE_FIELD_LIMITS.place) &&
    boundedText(feeling, NOTE_FIELD_LIMITS.feeling) && boundedText(conditions, NOTE_FIELD_LIMITS.conditions) &&
    validTags(tags) && (tags.length > 0 || [body, place, feeling, conditions].some(text => text.trim().length > 0)) &&
    validTimestamp(createdAtMs) && validTimestamp(updatedAtMs) &&
    (deletedAtMs === undefined || deletedAtMs === null || validTimestamp(deletedAtMs)) &&
    (seriesId === undefined || typeof seriesId === 'number' && Number.isSafeInteger(seriesId) && seriesId > 0) &&
    (conditionKey === undefined || typeof conditionKey === 'string' && !!conditionKey.trim() && !controlCharacter.test(conditionKey));
}

export function isDiaryNotes(value: unknown): value is DiaryNote[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const note of value) {
    if (!isDiaryNote(note) || ids.has(note.id)) return false;
    ids.add(note.id);
  }
  return true;
}

export function notesInScope(notes: readonly DiaryNote[], scope: DiaryNoteScope, includeConditionNotes = false): DiaryNote[] {
  return notes.filter(note => note.deletedAtMs == null &&
    ((note.seriesId === scope.seriesId && note.conditionKey === scope.conditionKey) ||
      (includeConditionNotes && scope.seriesId === undefined && scope.conditionKey === undefined && note.conditionKey !== undefined)))
    .sort((a, b) => b.localDate.localeCompare(a.localDate) || b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id));
}

export function legacyNoteConditions(key: string): string {
  try {
    const value: unknown = JSON.parse(key);
    if (Array.isArray(value)) {
      const [distance, profile, diameter, kit] = value;
      const target = typeof profile === 'string' ? getTargetProfile(profile)?.title : undefined;
      const details = [
        typeof distance === 'number' && Number.isFinite(distance) && `${distance} м`,
        typeof diameter === 'number' && Number.isFinite(diameter) && `${diameter / 10} см`,
        target,
        Array.isArray(kit) && typeof kit[1] === 'string' && kit[1],
      ].filter(Boolean).join(' · ');
      if (details) return `Условия: ${details}`;
    }
  } catch { /* Older imported keys may not identify a recognizable snapshot. */ }
  return 'Условия прежней тренировки';
}
