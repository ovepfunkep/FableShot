import { conditionsKey, practiceCompositeGroups, calculateCompositeScore, displayCompositeScore } from './composite-scoring.ts';
import { exerciseRank } from './exercise-rank.ts';
import { hitGeometry } from './hit-map.ts';
import type { DiaryEntry } from './persistence.ts';
import { formatAverage } from './preferences.ts';
import type { RankCategory } from './sport-ranks.ts';
import { getTargetProfile, summarize } from './target.ts';
import { currentSeries } from './practice.ts';
import { calculateProgress } from './progress-scoring.ts';

export const REPORT_CSV_COLUMNS = ['format', 'record_type', 'session_id', 'session_revision', 'title', 'local_date',
  'time_zone', 'time_source', 'source', 'block_id', 'block_number', 'mode', 'distance_m', 'target_profile',
  'target_version', 'target_diameter_mm', 'target_snapshot', 'equipment_snapshot', 'end_id', 'end_number',
  'end_role', 'end_state', 'planned_arrows', 'shot_id', 'input_order', 'points', 'zone', 'automatic_points',
  'automatic_rule', 'x', 'y', 'face_id', 'score_source', 'position_source', 'position_status',
  'physical_arrow_number', 'shot_created_ms', 'shot_updated_ms', 'shot_revision', 'count', 'round_number', 'series_number',
  'source_x', 'source_y', 'source_coordinate_system'] as const;

/** Same safe quoting as AnalyticsCsv.kt. Numeric cells must not become escaped strings. */
export function reportCsvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && (/^[\t\r\n]/.test(text) || /^[=+\-@]/.test(text.trimStart()))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportCsv(entry: DiaryEntry): Uint8Array {
  const rows = [REPORT_CSV_COLUMNS.map(reportCsvCell).join(';')];
  const date = new Date(entry.startedAt);
  const knownDate = Number.isFinite(date.getTime());
  const localDate = knownDate ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') : null;
  const base = { format: 'fableshot-shots-v1', session_id: entry.id, title: 'Тренировка',
    local_date: entry.localDate !== undefined ? entry.localDate : localDate,
    time_zone: knownDate && !entry.source ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
    source: entry.source?.kind ?? 'native_web', time_source: entry.source ? entry.localDate ? 'source_date_only' : 'import_unknown' : knownDate ? 'recorded' : 'unknown' };
  function emit(row: Record<string, unknown>) {
    rows.push(REPORT_CSV_COLUMNS.map(key => reportCsvCell(row[key])).join(';'));
  }
  let blockNumber = 0;
  entry.practice.rounds.forEach((round, r) => {
    let lastConditions: string | null = null;
    let blockId = '';
    let endNumber = 0;
    round.series.forEach((series, s) => {
    const conditions = series.conditions;
    const key = conditionsKey(conditions);
    if (key !== lastConditions) {
      blockNumber++; blockId = `${round.id}:${series.id}`; endNumber = 0; lastConditions = key;
    }
    endNumber++;
    const fields = { ...base, block_id: blockId, block_number: blockNumber,
      mode: 'scored', distance_m: conditions.distanceMeters, target_profile: conditions.targetProfileId,
      target_version: 1, target_diameter_mm: conditions.targetDiameterMm,
      target_snapshot: JSON.stringify(getTargetProfile(conditions.targetProfileId)),
      equipment_snapshot: conditions.equipment ? JSON.stringify(conditions.equipment) : null,
      end_id: series.id, end_number: endNumber, end_role: 'scored', round_number: r + 1, series_number: s + 1,
      end_state: entry.practice.savedAt === null && round === entry.practice.rounds.at(-1) && series === round.series.at(-1) ? 'open' : 'closed',
      planned_arrows: series.plannedCount ?? Math.max(3, series.shots.length) };
    if (!series.shots.length) emit({ ...fields, record_type: 'empty_end' });
    series.shots.forEach((shot, index) => emit({ ...fields, record_type: 'shot', shot_id: `${series.id}:${index + 1}`,
      input_order: index + 1, points: shot.points, zone: shot.code,
      // External FableShot coordinates are Y-up; React stores screen coordinates Y-down.
      x: shot.point?.x, y: shot.point ? -shot.point.y : null, score_source: shot.imported ? 'imported' : 'manual',
      position_source: shot.point ? shot.imported ? 'imported' : 'target' : null, position_status: shot.point ? 'confirmed' : 'missing',
      physical_arrow_number: shot.physicalArrowNumber, source_x: shot.sourcePoint?.x, source_y: shot.sourcePoint?.y,
      source_coordinate_system: shot.sourcePoint ? 'mytargets-raw-y-down' : null }));
    });
  });
  return new TextEncoder().encode(`\uFEFF${rows.join('\r\n')}\r\n`);
}

export function reportSnapshot(entry: DiaryEntry, category: RankCategory | null, hundredths: boolean) {
  const practice = entry.practice;
  const rounds = practice.rounds.flatMap((round, r) => {
    const series = round.series.flatMap((series, s) => series.shots.length ? [{ ...series, number: s + 1 }] : []);
    return series.length ? [{ number: r + 1, series, result: summarize(series.flatMap(series => series.shots)) }] : [];
  });
  const shots = rounds.flatMap(round => round.series.flatMap(series => series.shots));
  if (!shots.length) throw new Error('Сначала отметь хотя бы одну стрелу.');
  const conditions = [...new Map(rounds.flatMap(round => round.series).map(series => [conditionsKey(series.conditions), series.conditions])).values()];
  const rank = exerciseRank(practice, category);
  const groups = practiceCompositeGroups(practice);
  const analysis = conditions.map(condition => {
    const key = conditionsKey(condition);
    const series = rounds.flatMap(round => round.series).filter(series => conditionsKey(series.conditions) === key);
    const shots = series.flatMap(series => series.shots);
    const group = groups.find(group => group.key === key);
    const baselineIds = new Set(series.flatMap(series => series.progressBaselineId === undefined ? [] : [series.progressBaselineId]));
    const progress = [...baselineIds].flatMap(id => {
      const baseline = practice.progressBaselines?.[id];
      if (!baseline || baseline.status !== 'ready') return [];
      const result = calculateProgress(baseline, series.filter(series => series.progressBaselineId === id),
        practice.savedAt === null ? currentSeries(practice)?.series.id : undefined);
      return result ? [result] : [];
    });
    return { conditions: condition, result: summarize(shots), geometry: hitGeometry(shots, condition.targetDiameterMm),
      composite: group ? calculateCompositeScore(group.ends, group.ends.length, group.maximumPerArrow, group.geometryVerified) : null,
      progress, shots, series: series.map(series => summarize(series.shots)),
      distribution: Array.from({ length: 11 }, (_, zone) => shots.filter(shot => shot.points === zone).length) };
  });
  const composite = conditions.length === 1 && groups.length === 1
    ? calculateCompositeScore(groups[0].ends, groups[0].ends.length, groups[0].maximumPerArrow, groups[0].geometryVerified) : null;
  const result = summarize(shots);
  const geometry = conditions.length === 1 ? hitGeometry(shots, conditions[0].targetDiameterMm) : null;
  const final = rank.finalResult ? rank.evaluation : null;
  const lower = final?.result;
  const upper = final?.next;
  return { entryId: entry.id, startedAt: entry.startedAt, completed: practice.savedAt !== null, rounds, result, analysis,
    average: formatAverage(result.average, hundredths),
    conditions: conditions.map(condition => [`${condition.distanceMeters} м`, `${condition.targetDiameterMm / 10} см`,
      getTargetProfile(condition.targetProfileId)?.title, condition.equipment?.name].filter(Boolean).join(' · ')),
    rank: rank.finalResult ? rank.label : null, rankClass: rank.classLabel,
    interval: final && final.average !== null ? {
      lower: lower?.label ?? 'Начало', upper: upper?.label ?? 'Максимум',
      lowerScore: lower?.score ?? 0, upperScore: upper?.score ?? final.exercise.arrows * 10, points: final.points,
    } : null,
    composite: composite?.total === undefined ? null : displayCompositeScore(composite.total),
    grouping: geometry?.rmsMm == null ? null : `${formatAverage(geometry.rmsMm, hundredths)} мм`,
  };
}

export type ReportSnapshot = ReturnType<typeof reportSnapshot>;
