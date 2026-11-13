export type RoomSeries = {
  entryId: string;
  ordinal: number;
  result: { points: number; arrows: number; bowCategory: string | null } | null;
};

export function readRoomSeries(snapshot: unknown): RoomSeries[] {
  if (!snapshot || typeof snapshot !== 'object' || !('series' in snapshot) || !Array.isArray(snapshot.series)) {
    throw new Error('Не удалось прочитать результаты комнаты.');
  }
  const keys = new Set<string>();
  return snapshot.series.map((value: RoomSeries) => {
    const result = value?.result;
    if (!value || !/^[a-f0-9]{64}$/.test(value.entryId) || !Number.isSafeInteger(value.ordinal) || value.ordinal < 1 ||
      (result !== null && (!result || !Number.isSafeInteger(result.arrows) || result.arrows < 1 ||
        !Number.isSafeInteger(result.points) || result.points < 0 || result.points > result.arrows * 10 ||
        (result.bowCategory !== null && typeof result.bowCategory !== 'string')))) {
      throw new Error('В комнате получена некорректная серия.');
    }
    const key = `${value.entryId}:${value.ordinal}`;
    if (keys.has(key)) throw new Error('В комнате получена повторная серия.');
    keys.add(key);
    return value;
  });
}

export function groupStandings(series: readonly RoomSeries[], ordinal: number, category?: string | null) {
  const grouped = new Map<string, RoomSeries[]>();
  for (const end of series) {
    const entry = grouped.get(end.entryId);
    if (entry) entry.push(end);
    else grouped.set(end.entryId, [end]);
  }
  const rows = Array.from(grouped, ([id, ends]) => {
    const through = ends.filter(end => end.ordinal <= ordinal);
    const live = through.filter(end => end.result).sort((a, b) => a.ordinal - b.ordinal);
    const last = live.at(-1);
    const bow = (last ?? ends.find(end => end.result))?.result?.bowCategory ?? null;
    const comparable = category === undefined ? live : live.filter(end => end.result?.bowCategory === category);
    const current = comparable.find(end => end.ordinal === ordinal)?.result ?? null;
    const points = comparable.reduce((sum, end) => sum + end.result!.points, 0);
    const arrows = comparable.reduce((sum, end) => sum + end.result!.arrows, 0);
    return { id, bow, current, points, arrows, complete: !!current && live.length === ordinal && comparable.length === ordinal,
      place: null as number | null };
  }).filter(row => category === undefined || row.bow === category);
  rows.sort((a, b) => Number(b.complete) - Number(a.complete) || b.points - a.points || a.id.localeCompare(b.id));
  let previousPoints: number | undefined;
  let place = 0;
  return rows.map((row, index) => {
    if (!row.complete) return row;
    if (row.points !== previousPoints) place = index + 1;
    previousPoints = row.points;
    return { ...row, place };
  });
}
