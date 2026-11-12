export const RANK_DISCIPLINES = {
  recurve: 'КЛ', barebow: 'КЛб', compound: 'БЛ',
  '3d-recurve': '3Д · КЛ', '3d-compound': '3Д · БЛ',
  '3d-traditional': '3Д · составной лук', '3d-longbow': '3Д · длинный лук',
} as const;
export const RANK_LEVELS = ['III юн.', 'II юн.', 'I юн.', 'III', 'II', 'I', 'КМС', 'МС', 'МСМК'] as const;
export type RankDiscipline = keyof typeof RANK_DISCIPLINES;
export type RankLevel = typeof RANK_LEVELS[number];
export type RankCategory = 'male' | 'female';

export type RankAssignment = {
  id: string;
  discipline: RankDiscipline;
  category: RankCategory;
  level: RankLevel;
  assignedOn: string | null;
  issuedBy: string;
  reference: string;
  current: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  revision: number;
  deletedAtMs: number | null;
};

/** Canonical Gregorian dates, matching Android's LocalDate.toString(). */
export function isRankAssignmentDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}|\+[1-9]\d{4,8}|-\d{4}|-[1-9]\d{4,8})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || match[0] !== value || match[1] === '-0000') return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1];
}

export function isRankAssignment(value: unknown): value is RankAssignment {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<RankAssignment>;
  return typeof row.id === 'string' && row.id.length >= 1 && row.id.length <= 128 && !/[\x00-\x1f]/.test(row.id) &&
    typeof row.discipline === 'string' && Object.hasOwn(RANK_DISCIPLINES, row.discipline) &&
    (row.category === 'male' || row.category === 'female') && RANK_LEVELS.some(level => level === row.level) &&
    (row.assignedOn === null || isRankAssignmentDate(row.assignedOn)) &&
    typeof row.issuedBy === 'string' && row.issuedBy.length <= 120 && typeof row.reference === 'string' && row.reference.length <= 500 &&
    typeof row.current === 'boolean' && Number.isSafeInteger(row.createdAtMs) && Number.isSafeInteger(row.updatedAtMs) &&
    typeof row.revision === 'number' && Number.isSafeInteger(row.revision) && row.revision >= 0 &&
    (row.deletedAtMs === null || (!row.current && Number.isSafeInteger(row.deletedAtMs)));
}

const scopeKey = (row: RankAssignment) => `${row.discipline}:${row.category}`;

export function isRankAssignments(value: unknown): value is RankAssignment[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  const current = new Set<string>();
  for (const row of value) {
    if (!isRankAssignment(row) || ids.has(row.id)) return false;
    ids.add(row.id);
    if (row.current) {
      const key = scopeKey(row);
      if (current.has(key)) return false;
      current.add(key);
    }
  }
  return true;
}

export function visibleRankAssignments(rows: readonly RankAssignment[]): RankAssignment[] {
  return rows.filter(row => row.deletedAtMs === null).sort((a, b) =>
    Number(b.current) - Number(a.current) || (b.assignedOn ?? '').localeCompare(a.assignedOn ?? '') ||
    b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id));
}

export function saveRankAssignment(rows: readonly RankAssignment[], draft: RankAssignment, now: number): RankAssignment[] {
  if (!isRankAssignments(rows) || !isRankAssignment(draft) || draft.deletedAtMs !== null || !Number.isSafeInteger(now)) {
    throw new Error('invalid_rank_assignment');
  }
  const old = rows.find(row => row.id === draft.id);
  if (old?.deletedAtMs != null || draft.revision !== (old?.revision ?? 0)) throw new Error('rank_assignment_conflict');
  const next = { ...draft, createdAtMs: old?.createdAtMs ?? draft.createdAtMs, updatedAtMs: now, revision: draft.revision + 1 };
  const result = rows.map(row => {
    if (row.id === next.id) return next;
    if (next.current && row.current && scopeKey(row) === scopeKey(next)) {
      return { ...row, current: false, updatedAtMs: now, revision: row.revision + 1 };
    }
    return row;
  });
  if (!old) result.push(next);
  if (!isRankAssignments(result)) throw new Error('invalid_rank_assignment');
  return result;
}

export function archiveRankAssignment(rows: readonly RankAssignment[], id: string, revision: number, now: number): RankAssignment[] {
  if (!isRankAssignments(rows) || !Number.isSafeInteger(now)) throw new Error('invalid_rank_assignment');
  const old = rows.find(row => row.id === id);
  if (!old) throw new Error('rank_assignment_conflict');
  if (old.deletedAtMs !== null) return [...rows];
  if (old.revision !== revision) throw new Error('rank_assignment_conflict');
  const result = rows.map(row => row.id === id ? { ...row, current: false, deletedAtMs: now, updatedAtMs: now, revision: row.revision + 1 } : row);
  if (!isRankAssignments(result)) throw new Error('invalid_rank_assignment');
  return result;
}
