import type { Conditions } from './conditions.ts';
import type { EquipmentLibrary, EquipmentSnapshot } from './equipment.ts';
import { acceptsDiameter, getTargetProfile } from './target.ts';
import type { Point } from './target.ts';
import { readMyTargetsDatabase } from './mytargets-sqlite.ts';
import type { MyTargetsSqlRow, MyTargetsTables } from './mytargets-sqlite.ts';
import { readMyTargetsZip } from './mytargets-zip.ts';

export type MyTargetsWarning = { code: string; sourceId: string; blocking: boolean };
export type MyTargetsShot = {
  sourceId: string; sourceRecord: number; points: number | null; code: string | null;
  point: Point | null; rawPoint: Point | null; physicalArrowNumber?: number;
};
export type MyTargetsSeries = {
  sourceId: string; sourceNumber: string; timestamp: string; shots: MyTargetsShot[];
  fingerprint: string; overlapFingerprint: string | null;
};
export type MyTargetsRawConditions = {
  round: string; distance: string; target: string; bow: string; arrows: string;
  distanceMeters: number | null; targetDiameterMm: number | null;
  sourceTargetId: number | null; sourceScoringStyle: number | null;
};
export type MyTargetsRound = {
  sourceId: string; conditions: Conditions | null; rawConditions: MyTargetsRawConditions;
  equipment?: EquipmentSnapshot | null;
  plannedArrows: number | null; series: MyTargetsSeries[];
};
export type MyTargetsSession = {
  sourceId: string; title: string; localDate: string | null; rawDate: string; standardRound: string;
  environment: string; rounds: MyTargetsRound[]; fingerprint: string;
};
export type MyTargetsPreview = {
  sourceFormat: 'csv' | 'zip'; fileHash: string; parserVersion: string; byteLength: number;
  sessions: MyTargetsSession[]; equipment: EquipmentLibrary;
  equipmentSourceRows: { kind: 'bow' | 'arrows'; sourceId: string; mappedId: string | null; values: MyTargetsSqlRow }[];
  warnings: MyTargetsWarning[]; requiredConfirmations: string[]; skippedEmptySlots: number; ignoredAttachments: number;
};
export type MyTargetsParseOptions = {
  splitBeforeRecords?: number[]; joinBeforeRecords?: number[];
  openDatabase?: (bytes: Uint8Array) => Promise<MyTargetsTables>;
  sqliteWasmUrl?: string;
};
export const MYTARGETS_HEADERS = ['Title', 'Date', 'Standard round', 'Indoor', 'Bow', 'Arrow', 'Round', 'Distance', 'Target', 'End', 'Timestamp', 'Points', 'Arrow numbers', 'x', 'y'];
const RU_HEADERS = ['Название', 'Дата', 'Стандартный раунд', 'В помещении', 'Лук', 'Стрела', 'Раунд', 'Дистанция', 'Мишень', 'Серия', 'Временная отметка', 'Очки', 'Номера стрел', 'x', 'y'];
const reject = (code: string): never => { throw new Error(code); };
const sha = async (value: string | Uint8Array): Promise<string> => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
};
const stable = (row: MyTargetsSqlRow) => JSON.stringify(Object.keys(row).sort().map(key => [key, row[key]]));
function date(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function measure(value: string, units: Record<string, number>): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*([a-z]+|")\s*$/i.exec(value);
  if (!match) return null;
  const n = Number(match[1].replace(',', '.')) * units[match[2].toLowerCase()];
  return Number.isFinite(n) && n > 0 ? n : null;
}
function diameter(value: string): number | null {
  const n = measure(/\(([^()]+)\)/.exec(value)?.[1] ?? value, { cm: 10, mm: 1 });
  return n !== null && Number.isSafeInteger(n) && n <= 10000 ? n : null;
}
function profile(target: number | null, style: number | null, mm: number | null): string | null {
  if (mm === null) return null;
  if (target === 0) {
    if ([400, 600].includes(mm) && style === 2) return 'wa-indoor-inner-v1';
    if ([400, 600].includes(mm) && (style === 0 || style === 1)) return 'wa-indoor-outer-v1';
    if ([800, 1220].includes(mm) && style === 0) return 'wa-outdoor-full-v1';
  }
  if (target === 1 && style === 0) return 'wa-outdoor-six-v1';
  if (target === 2 || (target === 5 && [400, 600].includes(mm))) {
    if (style === 2) return 'wa-indoor-five-inner-v1';
    if (style === 0 || style === 1) return 'wa-indoor-five-outer-v1';
  }
  return null;
}
function mappedConditions(raw: MyTargetsRawConditions, equipment: EquipmentSnapshot | null): Conditions | null {
  const id = profile(raw.sourceTargetId, raw.sourceScoringStyle, raw.targetDiameterMm);
  const spec = id ? getTargetProfile(id) : null;
  return id && spec && raw.distanceMeters !== null && raw.targetDiameterMm !== null && acceptsDiameter(spec, raw.targetDiameterMm)
    ? { distanceMeters: raw.distanceMeters, targetProfileId: id, targetDiameterMm: raw.targetDiameterMm, equipment } : null;
}
const rawConditions = (round: string, distance: string, target: string, bow: string, arrows: string,
  targetId: number | null, style: number | null): MyTargetsRawConditions => ({ round, distance, target, bow, arrows,
  distanceMeters: measure(distance, { m: 1, yd: .9144, ft: .3048 }), targetDiameterMm: diameter(target), sourceTargetId: targetId, sourceScoringStyle: style });
function score(code: string): { points: number | null; code: string | null } {
  code = code.trim().toUpperCase();
  if (code === 'X') return { code, points: 10 };
  if (code === 'M' || code === '0') return { code: 'M', points: 0 };
  return /^(?:[1-9]|10)$/.test(code) ? { code, points: Number(code) } : { code: null, points: null };
}
function archiveScore(target: number, style: number, ring: number) {
  // MyTargets vertical three-spot uses the same ring table as the single five-ring face.
  if (target === 5) target = 2;
  if (![0, 1, 2].includes(target) || ![0, 1, 2].includes(style)) return score('');
  if (ring === -1) return score('M');
  if (!Number.isInteger(ring) || ring < 0 || ring >= [11, 7, 6][target]) return score('');
  return score(ring === 0 ? style === 0 ? 'X' : '10' : ring === 1 ? style === 2 ? '9' : '10' : String(11 - ring));
}

/** Strict quoted semicolon CSV, including escaped quotes and embedded newlines. */
function csvRecords(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; if (row.length > 128) reject('csv_too_many_columns'); };
  const finishRow = () => { finishCell(); records.push(row); row = []; if (records.length > 200001) reject('csv_too_many_rows'); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\0') reject('csv_invalid_text');
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === '"') { if (cell || closed) reject('csv_invalid_quote'); quoted = true; }
    else if (c === ';') finishCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; finishRow(); }
    else { if (closed) reject('csv_invalid_quote'); cell += c; }
    if (cell.length > 8000) reject('csv_field_too_large');
  }
  if (quoted) reject('csv_unclosed_quote');
  if (cell || closed || row.length) finishRow();
  return records;
}
function warn(preview: MyTargetsPreview, code: string, sourceId: string, blocking = false) {
  if (preview.warnings.length > 10000) reject('too_many_import_warnings');
  if (!preview.warnings.some(w => w.code === code && w.sourceId === sourceId)) preview.warnings.push({ code, sourceId, blocking });
}
function confirmation(preview: MyTargetsPreview, code: string, sourceId: string) {
  const key = `${code}:${sourceId}`;
  if (!preview.requiredConfirmations.includes(key)) preview.requiredConfirmations.push(key);
}
async function finish(preview: MyTargetsPreview): Promise<MyTargetsPreview> {
  for (const session of preview.sessions) {
    if (!session.localDate) { warn(preview, 'unknown_date', session.sourceId); confirmation(preview, 'unknown_date', session.sourceId); }
    for (const round of session.rounds) {
      if (!round.conditions) { warn(preview, 'conditions_mapping_required', round.sourceId); confirmation(preview, 'conditions_mapping', round.sourceId); }
      for (const series of round.series) {
        series.fingerprint = await sha(JSON.stringify(series.shots.map(shot => [shot.code, shot.points, shot.rawPoint, shot.physicalArrowNumber ?? null])));
        const c = round.rawConditions;
        const time = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/.exec(series.timestamp);
        const validTime = time && Number(time[1]) < 24 && Number(time[2]) < 60 && Number(time[3] ?? 0) < 60;
        if (!validTime) warn(preview, 'unknown_end_time', series.sourceId);
        series.overlapFingerprint = validTime && c.distanceMeters !== null && c.targetDiameterMm !== null ?
          await sha(JSON.stringify(['mytargets-end-overlap-v1', session.title, session.rawDate, c.distanceMeters, c.targetDiameterMm,
            c.bow, c.arrows, `${time[1]}:${time[2]}:${time[3] ?? '00'}${time[4] ? time[4].replace(/0+$/, '') .replace(/\.$/, '') : ''}`])) : null;
      }
    }
    session.fingerprint = await sha(JSON.stringify(session.rounds.map(round => [round.rawConditions, round.series.map(end => end.fingerprint)])));
  }
  return preview;
}

/** Parse a source into reviewable facts. No writes, invented positions, UTC times, or implicit deduplication.
 * MyTargets and web both use Y-down. ZIP coordinates for reduced faces are scaled to the nominal radius. */
export async function parseMyTargets(input: Uint8Array, options: MyTargetsParseOptions = {}): Promise<MyTargetsPreview> {
  if (input.length > 25 * 1024 * 1024) reject('file_too_large');
  const bytes = Uint8Array.from(input);
  const zip = bytes[0] === 80 && bytes[1] === 75;
  const preview: MyTargetsPreview = { sourceFormat: zip ? 'zip' : 'csv', fileHash: await sha(bytes),
    parserVersion: zip ? 'mytargets-web-zip27-v2' : 'mytargets-web-csv-v2', byteLength: bytes.length,
    sessions: [], equipment: { bows: [], arrows: [], kits: [] }, equipmentSourceRows: [], warnings: [], requiredConfirmations: [], skippedEmptySlots: 0, ignoredAttachments: 0 };
  if (zip) {
    if (options.splitBeforeRecords?.length || options.joinBeforeRecords?.length) reject('archive_boundaries_are_explicit');
    const archive = readMyTargetsZip(bytes); preview.ignoredAttachments = archive.ignoredAttachments;
    const tables = await (options.openDatabase ?? (bytes => readMyTargetsDatabase(bytes, options.sqliteWasmUrl)))(archive.database);
    await parseArchive(tables, preview);
  } else {
    parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes), preview, options);
    await mapCsvEquipment(preview);
  }
  if (!preview.sessions.length) reject('no_importable_shots');
  return finish(preview);
}

/** CSV names establish named candidates only: category, shaft size and numbering stay unknown. */
async function mapCsvEquipment(preview: MyTargetsPreview): Promise<void> {
  const bows = new Map<string, string | null>(), arrows = new Map<string, string | null>();
  async function item(kind: 'bow' | 'arrows', rawName: string): Promise<string | null> {
    const name = rawName.trim();
    if (!name) return null;
    const known = kind === 'bow' ? bows : arrows;
    if (known.has(name)) return known.get(name)!;
    if (known.size >= 1000) reject('equipment_catalog_too_large');
    const sourceId = `csv:${kind}:${known.size + 1}`;
    const id = name.length <= 100 ? `myt-csv-${kind}-${(await sha(name)).slice(0, 32)}` : null;
    known.set(name, id);
    preview.equipmentSourceRows.push({ kind, sourceId, mappedId: id, values: { name: rawName } });
    if (!id) { warn(preview, 'equipment_name_mapping_required', sourceId); return null; }
    if (kind === 'bow') preview.equipment.bows.push({ id, name, category: null });
    else preview.equipment.arrows.push({ id, name, diameterMm: null });
    return id;
  }
  const kits = new Map<string, EquipmentSnapshot>();
  for (const session of preview.sessions) for (const round of session.rounds) {
    const bowId = await item('bow', round.rawConditions.bow), arrowsId = await item('arrows', round.rawConditions.arrows);
    if (!bowId && !arrowsId) continue;
    const pair = JSON.stringify([bowId, arrowsId]);
    let equipment = kits.get(pair);
    if (!equipment) {
      if (kits.size >= 1000) reject('equipment_catalog_too_large');
      const id = `myt-kit-${(await sha(pair)).slice(0, 32)}`;
      const bowName = preview.equipment.bows.find(bow => bow.id === bowId)?.name ?? '';
      const arrowName = preview.equipment.arrows.find(arrows => arrows.id === arrowsId)?.name ?? '';
      const name = [bowName, arrowName].filter(Boolean).join(' · ').slice(0, 100);
      preview.equipment.kits.push({ id, name, bowId, arrowsId });
      equipment = { id, name, bow: { name: bowName, category: null },
        arrows: { name: arrowName, diameterMm: null, ...(arrowsId ? { id: arrowsId } : {}) } };
      kits.set(pair, equipment);
    }
    round.equipment = equipment;
    if (round.conditions) round.conditions = { ...round.conditions, equipment };
  }
}

function parseCsv(text: string, preview: MyTargetsPreview, options: MyTargetsParseOptions) {
  const records = csvRecords(text), headerIndex = records.findIndex(row => row.some(value => value.trim()));
  const headers = records[headerIndex]?.map(value => value.trim());
  if (!headers) return reject('csv_empty');
  const rows = records.map((row, index) => ({ row, record: index + 1 })).slice(headerIndex + 1)
    .filter(({ row }) => row.some(value => value.trim()));
  const normalized = headers.map(value => { const i = RU_HEADERS.indexOf(value); return i < 0 ? value : MYTARGETS_HEADERS[i]; });
  if (new Set(normalized).size !== normalized.length || !MYTARGETS_HEADERS.every(header => normalized.includes(header))) reject('csv_unsupported_headers');
  const indexes = MYTARGETS_HEADERS.map(header => normalized.indexOf(header));
  if (headers.length > MYTARGETS_HEADERS.length) warn(preview, 'extra_source_columns_retained_in_source', 'csv');
  const splits = new Set(options.splitBeforeRecords ?? []), joins = new Set(options.joinBeforeRecords ?? []);
  const dataRecords = new Set(rows.map(({ record }) => record));
  for (const index of [...splits, ...joins]) if (!Number.isInteger(index) || !dataRecords.has(index) || splits.has(index) && joins.has(index)) reject('csv_invalid_grouping');
  let previous: string[] | null = null, session: MyTargetsSession | undefined, round: MyTargetsRound | undefined;
  rows.forEach(({ row, record }) => {
    if (row.length !== headers.length) reject('csv_column_count');
    const v = indexes.map(index => row[index]);
    const identityChanged = !previous || JSON.stringify(v.slice(0, 4)) !== JSON.stringify(previous.slice(0, 4));
    const sameConditions = previous && [4, 5, 7, 8].every(i => v[i] === previous![i]);
    const reset = previous && !identityChanged && sameConditions && (Number(v[6]) < Number(previous[6]) || v[6] === previous[6] && Number(v[9]) < Number(previous[9]));
    if (!session || splits.has(record) || !joins.has(record) && (identityChanged || reset)) {
      session = { sourceId: `csv:g${preview.sessions.length}`, title: v[0], rawDate: v[1], localDate: date(v[1]), standardRound: v[2], environment: v[3], rounds: [], fingerprint: '' };
      preview.sessions.push(session); round = undefined;
      if (reset) { warn(preview, 'ambiguous_session_boundary', session.sourceId); confirmation(preview, 'session_boundary', session.sourceId); }
    }
    const target = /^WA (?:Full|полный)\s*\(/i.test(v[8]) ? 0 : /^WA (?:5 Ring|5 колец)\s*\(/i.test(v[8]) ? 2 : null;
    const raw = rawConditions(v[6], v[7], v[8], v[4], v[5], target, 1);
    if (!round || JSON.stringify(round.rawConditions) !== JSON.stringify(raw)) {
      round = { sourceId: `${session.sourceId}:r${session.rounds.length}`, rawConditions: raw, conditions: mappedConditions(raw, null), plannedArrows: null, series: [] };
      session.rounds.push(round);
      confirmation(preview, 'csv_conditions_and_series_plan', round.sourceId);
      if (v[4] || v[5]) { warn(preview, 'csv_equipment_mapping_required', round.sourceId); confirmation(preview, 'equipment_mapping', round.sourceId); }
    }
    let series = round.series.at(-1);
    if (!series || series.sourceNumber !== v[9] || series.timestamp !== v[10]) {
      series = { sourceId: `${round.sourceId}:e${round.series.length}`, sourceNumber: v[9], timestamp: v[10], shots: [], fingerprint: '', overlapFingerprint: null };
      round.series.push(series);
    }
    const sourceId = `csv:record:${record}`, hit = score(v[11]);
    if (!/^[1-9]\d*$/.test(v[6]) || !/^[1-9]\d*$/.test(v[9])) warn(preview, 'invalid_round_or_end_number', series.sourceId, true);
    if (hit.points === null) warn(preview, 'unsupported_score', series.sourceId, true);
    const pair = v[13].trim() !== '' && v[14].trim() !== '' && Number.isFinite(Number(v[13])) && Number.isFinite(Number(v[14]));
    const rawPoint = pair ? { x: Number(v[13]), y: Number(v[14]) } : null;
    if (!pair && (v[13] || v[14])) warn(preview, 'invalid_coordinate_pair', sourceId);
    const point = rawPoint && (rawPoint.x !== 0 || rawPoint.y !== 0) && round.conditions ? rawPoint : null;
    if (rawPoint && !point) warn(preview, 'unverified_coordinate', sourceId);
    const arrow = /^[1-9]\d*$/.test(v[12].trim()) ? Number(v[12]) : undefined;
    if (v[12] && (!arrow || arrow > 1000)) warn(preview, 'invalid_arrow_number', sourceId);
    series.shots.push({ sourceId, sourceRecord: record, ...hit, point, rawPoint, ...(arrow && arrow <= 1000 ? { physicalArrowNumber: arrow } : {}) });
    if (series.shots.length > 12) warn(preview, 'invalid_series_size', series.sourceId, true);
    previous = v;
  });
}

const string = (row: MyTargetsSqlRow, key: string): string => row[key] == null ? '' : String(row[key]);
const integer = (row: MyTargetsSqlRow, key: string): number => {
  const value = row[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : reject('archive_invalid_facts');
};
function linked(rows: MyTargetsSqlRow[], foreignKey: string, parents: MyTargetsSqlRow[]): Map<number, MyTargetsSqlRow[]> {
  const ids = new Set(parents.map(row => integer(row, 'id'))), result = new Map<number, MyTargetsSqlRow[]>();
  const positions = new Set<string>();
  for (const row of rows) {
    const parent = integer(row, foreignKey), index = integer(row, 'index');
    if (!ids.has(parent)) reject('archive_broken_relationship');
    if (index < 0 || foreignKey === 'endId' && index > 11) reject('archive_invalid_facts');
    if (foreignKey === 'endId' && positions.has(`${parent}:${index}`)) reject('archive_invalid_facts');
    positions.add(`${parent}:${index}`);
    const list = result.get(parent) ?? []; list.push(row); result.set(parent, list);
  }
  for (const list of result.values()) list.sort((a, b) => integer(a, 'index') - integer(b, 'index') || integer(a, 'id') - integer(b, 'id'));
  return result;
}
async function parseArchive(tables: MyTargetsTables, preview: MyTargetsPreview) {
  if (tables.Bow.length > 1000 || tables.Arrow.length > 1000) reject('equipment_catalog_too_large');
  const rounds = linked(tables.Round, 'trainingId', tables.Training), ends = linked(tables.End, 'roundId', tables.Round), shots = linked(tables.Shot, 'endId', tables.End);
  const gear = new Map<string, string>();
  for (const [table, kind] of [['Bow', 'bow'], ['Arrow', 'arrows']] as const) {
    for (const row of tables[table]) {
      const sourceId = `${table.toLowerCase()}:${row.id}`, name = string(row, 'name').trim();
      const id = `myt-${kind}-${(await sha(stable(row))).slice(0, 32)}`;
      preview.equipmentSourceRows.push({ kind, sourceId, mappedId: name && name.length <= 100 ? id : null, values: row });
      if (!name || name.length > 100) { warn(preview, 'equipment_name_mapping_required', sourceId); continue; }
      gear.set(sourceId, id);
      if (kind === 'bow') {
        const category = typeof row.type === 'number' ? ['recurve', 'compound', 'longbow', 'barebow'][row.type] ?? null : null;
        preview.equipment.bows.push({ id, name, category });
        if (!category) warn(preview, 'unknown_bow_category', sourceId);
      } else {
        const mm = measure(string(row, 'diameter'), { mm: 1, cm: 10, in: 25.4, '"': 25.4 });
        const numbered = Number(row.maxArrowNumber);
        preview.equipment.arrows.push({ id, name, diameterMm: mm && mm >= 1 && mm <= 20 ? mm : null,
          ...(Number.isInteger(numbered) && numbered >= 1 && numbered <= 1000 ? { numberedCount: numbered } : {}) });
      }
    }
  }
  if (preview.equipment.bows.length > 1000 || preview.equipment.arrows.length > 1000) reject('equipment_catalog_too_large');
  let sourceRecord = 1;
  for (const training of [...tables.Training].sort((a, b) => string(a, 'date').localeCompare(string(b, 'date')) || integer(a, 'id') - integer(b, 'id'))) {
    const tId = integer(training, 'id'), sourceId = `t${tId}`;
    const indoor = integer(training, 'indoor'); if (indoor !== 0 && indoor !== 1) reject('archive_invalid_facts');
    const bowRow = tables.Bow.find(row => row.id === training.bowId), arrowRow = tables.Arrow.find(row => row.id === training.arrowId);
    for (const [key, row] of [['bowId', bowRow], ['arrowId', arrowRow]] as const)
      if (training[key] !== null && training[key] !== undefined && !row) reject('archive_broken_relationship');
    const bowId = gear.get(`bow:${training.bowId}`) ?? null, arrowsId = gear.get(`arrow:${training.arrowId}`) ?? null;
    const bow = preview.equipment.bows.find(item => item.id === bowId), arrows = preview.equipment.arrows.find(item => item.id === arrowsId);
    let equipment: EquipmentSnapshot | null = null;
    if (bow || arrows) {
      const id = `myt-kit-${(await sha(JSON.stringify([bowId, arrowsId]))).slice(0, 32)}`, name = [bow?.name, arrows?.name].filter(Boolean).join(' · ').slice(0, 100);
      if (!preview.equipment.kits.some(kit => kit.id === id)) preview.equipment.kits.push({ id, name, bowId, arrowsId });
      equipment = { id, name, bow: { name: bow?.name ?? '', category: bow?.category ?? null },
        arrows: { name: arrows?.name ?? '', diameterMm: arrows?.diameterMm ?? null, ...(arrows?.numberedCount ? { numberedCount: arrows.numberedCount, id: arrows.id } : {}) } };
    }
    const session: MyTargetsSession = { sourceId, title: string(training, 'title'), rawDate: string(training, 'date'), localDate: date(string(training, 'date')),
      standardRound: string(tables.StandardRound.find(row => row.id === training.standardRoundId) ?? {}, 'name'), environment: indoor ? 'Indoor' : 'Outdoor', rounds: [], fingerprint: '' };
    for (const r of rounds.get(tId) ?? []) {
      const rId = integer(r, 'id'), target = integer(r, 'targetId'), style = integer(r, 'targetScoringStyleIndex'), planned = integer(r, 'shotsPerEnd');
      if (planned < 1 || planned > 12) reject('archive_invalid_facts');
      const label = `${({ 0: 'WA Full', 1: 'WA 6 Ring', 2: 'WA 5 Ring', 5: 'WA Vertical 3 Spot' } as Record<number, string>)[target] ?? `MyTargets target ${target}`} (${string(r, 'targetDiameter')})`;
      const raw = rawConditions(String(integer(r, 'index') + 1), string(r, 'distance'), label, bow?.name ?? '', arrows?.name ?? '', target, style);
      const round: MyTargetsRound = { sourceId: `${sourceId}:r${rId}`, rawConditions: raw, conditions: mappedConditions(raw, equipment), plannedArrows: planned, series: [] };
      if (target === 5 && round.conditions) warn(preview, 'vertical_spot_projection', round.sourceId);
      for (const e of ends.get(rId) ?? []) {
        const eId = integer(e, 'id'), exact = integer(e, 'exact'); if (exact !== 0 && exact !== 1) reject('archive_invalid_facts');
        const series: MyTargetsSeries = { sourceId: `${round.sourceId}:e${eId}`, sourceNumber: String(integer(e, 'index') + 1), timestamp: string(e, 'saveTime'), shots: [], fingerprint: '', overlapFingerprint: null };
        for (const s of shots.get(eId) ?? []) {
          const ring = integer(s, 'scoringRing');
          if (ring < -2) reject('archive_invalid_facts');
          if (ring === -2) { preview.skippedEmptySlots++; continue; }
          sourceRecord++;
          const hit = archiveScore(target, style, ring), shotId = `${series.sourceId}:s${s.id}`;
          if (hit.points === null) warn(preview, 'unsupported_archive_score', series.sourceId, true);
          const rawPoint = typeof s.x === 'number' && typeof s.y === 'number' && Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : null;
          if (!rawPoint) return reject('archive_invalid_facts');
          // ZIP coordinates are relative to the individual face. FableShot uses the full nominal radius.
          // A five-ring spot has half that radius, including each face of the vertical three-spot.
          const scale = target === 2 || target === 5 ? .5 : target === 1 ? .6 : 1;
          const point = exact && round.conditions && !(hit.code === 'M' && rawPoint.x === 0 && rawPoint.y === 0)
            ? { x: rawPoint.x * scale, y: rawPoint.y * scale } : null;
          if (exact && !round.conditions) warn(preview, 'unverified_coordinate', shotId);
          const number = Number(s.arrowNumber), validArrow = Number.isInteger(number) && number > 0 && number <= 1000;
          if (s.arrowNumber != null && !validArrow && number !== 0) warn(preview, 'invalid_arrow_number', shotId);
          series.shots.push({ sourceId: shotId, sourceRecord, ...hit, rawPoint, point, ...(validArrow ? { physicalArrowNumber: number } : {}) });
        }
        if (series.shots.length) {
          if (series.shots.length > planned || series.shots.length > 12) warn(preview, 'invalid_archive_series', series.sourceId, true);
          const total = series.shots.reduce((sum, shot) => sum + (shot.points ?? 0), 0);
          if (series.shots.length !== integer(e, 'shotCount') || series.shots.every(shot => shot.points !== null) && total !== integer(e, 'reachedPoints')) warn(preview, 'archive_series_totals_mismatch', series.sourceId, true);
          round.series.push(series);
        }
      }
      if (round.series.length) session.rounds.push(round);
    }
    if (session.rounds.length) preview.sessions.push(session);
  }
  if (preview.equipment.kits.length > 1000) reject('equipment_catalog_too_large');
  if (preview.ignoredAttachments) warn(preview, 'attachments_retained_only_in_source', 'zip');
}

export type MyTargetsDedupe = { alreadyImported: string[]; possibleOverlaps: string[] };
/** Exact file+record keys are safe to suppress; another file's matching series only requests review. */
export function findMyTargetsDuplicates(preview: MyTargetsPreview, known: {
  sourceRecords: readonly { fileHash: string; sourceRecord: number }[];
  seriesFingerprints?: readonly string[]; overlapFingerprints?: readonly string[];
}): MyTargetsDedupe {
  const records = new Set(known.sourceRecords.filter(row => row.fileHash === preview.fileHash).map(row => row.sourceRecord));
  const fingerprints = new Set(known.seriesFingerprints), overlaps = new Set(known.overlapFingerprints);
  const alreadyImported: string[] = [], possibleOverlaps: string[] = [];
  for (const session of preview.sessions) for (const round of session.rounds) for (const series of round.series) {
    for (const shot of series.shots) if (records.has(shot.sourceRecord)) alreadyImported.push(shot.sourceId);
    if (fingerprints.has(series.fingerprint) || series.overlapFingerprint && overlaps.has(series.overlapFingerprint)) possibleOverlaps.push(series.sourceId);
  }
  return { alreadyImported, possibleOverlaps };
}
