import { earnAchievements } from './achievement-ledger.ts';
import { ACHIEVEMENT_BOW_LABELS } from './achievement-catalog.ts';
import { groupStandings, roomConditionsKey } from './group-leaderboard.ts';
import type { Diary, DiaryEntry } from './persistence.ts';

export const ROOM_ACHIEVEMENT_IDS = ['ROOM01', 'ROOM02', 'ROOM03'] as const;

function evidence(diary: Diary, entry: DiaryEntry) {
  if (!entry.practice.savedAt || entry.source || entry.nativeArchiveSession || entry.deletedAt ||
    !entry.achievementEnrollment?.roomAwards || entry.achievementEnrollment.epoch !== diary.achievementLedger?.epoch ||
    entry.practice.rounds.some(round => round.series.some(end => end.shots.some(shot => shot.imported)))) return;
  const journal = diary.groupSeries?.find(item => item.trainingId === entry.id);
  const snapshot = entry.groupRoomHistory;
  if (!journal || !snapshot) return;
  const own = new Map(journal.ends.map(end => [end.ordinal, end]));
  const confirmed = snapshot.series.filter(end => {
    if (end.entryId !== journal.entryId) return true;
    const local = own.get(end.ordinal);
    return !!local && local.revision === end.revision && local.result !== null;
  });
  if (!confirmed.some(end => end.entryId === journal.entryId && end.result?.spread?.complete) ||
    !confirmed.some(end => end.entryId !== journal.entryId && end.result?.spread?.complete)) return;
  return { journal, confirmed };
}

export function awardRoomAchievements(diary: Diary, entryId: string, now: string): Diary {
  const ledger = diary.achievementLedger;
  const entry = diary.entries.find(item => item.id === entryId);
  if (!ledger || !entry) return diary;
  const current = evidence(diary, entry);
  if (!current) return diary;
  const day = (item: DiaryEntry) => item.localDate || new Date(item.startedAt).toLocaleDateString('sv-SE');
  const days = new Set(diary.entries.filter(item => evidence(diary, item)).map(day));
  const observations = [{ id: 'ROOM01', scope: 'global', progress: 1 }, { id: 'ROOM02', scope: 'global', progress: days.size }];
  const last = current.confirmed.filter(end => end.entryId === current.journal.entryId && end.result).sort((a, b) => a.ordinal - b.ordinal).at(-1);
  if (last?.result?.conditions && last.result.bowCategory && Object.hasOwn(ACHIEVEMENT_BOW_LABELS, last.result.bowCategory)) {
    const category = last.result.bowCategory;
    const rows = groupStandings(current.confirmed, last.ordinal, category, [], roomConditionsKey(last.result.conditions), 'pg1');
    const own = rows.find(row => row.id === current.journal.entryId);
    if (own?.place && rows.some(row => row.id !== own.id && row.place !== null)) {
      observations.push({ id: 'ROOM03', scope: category, progress: own.rankScore ?? 0 });
    }
  }
  const earned = earnAchievements(ledger, observations, now, entry.id);
  return earned.added.length ? { ...diary, achievementLedger: earned.ledger } : diary;
}
