import { isConditions } from './conditions.ts';
import type { Conditions } from './conditions.ts';
import { isLibrary, validNumberedCount } from './equipment.ts';
import type { EquipmentLibrary } from './equipment.ts';
import { isLocalDate } from './import-source.ts';
import type { MyTargetsPreview, MyTargetsWarning } from './mytargets-import.ts';
import { isDiary } from './persistence.ts';
import type { Diary, DiaryEntry } from './persistence.ts';
import type { Round, Series } from './practice.ts';
import { getTargetProfile, isInMissRing, isOnFace } from './target.ts';
import type { Shot } from './target.ts';

export type MyTargetsMergeOptions = {
  selectedSessionIds?: readonly string[];
  /** Exact keys from preview.requiredConfirmations, including mapping/date acknowledgements. */
  confirmedBoundaries?: readonly string[];
  allowOverlaps?: boolean;
  conditionsOverrides?: Readonly<Record<string, Conditions>>;
  importedAt?: string;
};
export type MyTargetsMergeResult = {
  diary: Diary; equipment: EquipmentLibrary;
  addedTrainings: number; addedShots: number; skippedShots: number; warnings: MyTargetsWarning[];
};

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

// IDs include the full file/session identity. A digest distinguishes partial imports;
// an occupied ID is rejected below rather than overwriting an unrelated entry.
function recordsDigest(records: number[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const char of records.join(',')) hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

function mergeEquipment(existing: EquipmentLibrary, incoming: EquipmentLibrary): EquipmentLibrary {
  const ids = new Map([...existing.bows, ...existing.arrows, ...existing.kits].map(item => [item.id, item]));
  const result = structuredClone(existing);
  for (const kind of ['bows', 'arrows', 'kits'] as const) {
    for (const item of incoming[kind]) {
      const previous = ids.get(item.id);
      if (previous) {
        if (!existing[kind].some(candidate => candidate.id === item.id) || canonical(previous) !== canonical(item)) {
          throw new Error(`equipment_id_conflict:${item.id}`);
        }
      } else {
        // The kind-specific arrays have already passed isLibrary.
        (result[kind] as { id: string }[]).push(structuredClone(item));
        ids.set(item.id, item);
      }
    }
  }
  if (!isLibrary(result)) throw new Error('invalid_merged_equipment');
  return result;
}

/** Build a complete proposed merge. No storage, input mutations, or achievement evidence. */
export function mergeMyTargets(preview: MyTargetsPreview, existingDiary: Diary, existingEquipment: EquipmentLibrary,
  options: MyTargetsMergeOptions = {}): MyTargetsMergeResult {
  if (!isDiary(existingDiary)) throw new Error('invalid_existing_diary');
  if (!isLibrary(existingEquipment) || !isLibrary(preview.equipment)) throw new Error('invalid_import_equipment');
  const selected = new Set(options.selectedSessionIds ?? preview.sessions.map(session => session.sourceId));
  if ([...selected].some(id => !preview.sessions.some(session => session.sourceId === id))) throw new Error('unknown_selected_session');
  const sessions = preview.sessions.filter(session => selected.has(session.sourceId));
  const selectedSources = new Set(sessions.flatMap(session => [session.sourceId,
    ...session.rounds.flatMap(round => [round.sourceId, ...round.series.flatMap(series => [series.sourceId, ...series.shots.map(shot => shot.sourceId)])])]));
  const confirmed = new Set(options.confirmedBoundaries);
  for (const key of preview.requiredConfirmations) {
    if (selectedSources.has(key.slice(key.indexOf(':') + 1)) && !confirmed.has(key)) throw new Error(`confirmation_required:${key}`);
  }
  const importedAt = options.importedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(importedAt))) throw new Error('invalid_import_timestamp');
  const warnings = structuredClone(preview.warnings);
  const warn = (code: string, sourceId: string, blocking = false) => {
    if (!warnings.some(warning => warning.code === code && warning.sourceId === sourceId)) warnings.push({ code, sourceId, blocking });
  };
  const blocked = new Set(preview.warnings.filter(warning => warning.blocking).map(warning => warning.sourceId));
  const knownRecords = new Set<number>();
  const otherFingerprints = new Set<string>(), otherOverlaps = new Set<string>();
  for (const entry of existingDiary.entries) {
    if (!entry.source) continue;
    if (entry.source.fileHash === preview.fileHash) for (const record of entry.source.sourceRecords) knownRecords.add(record);
    else {
      for (const fingerprint of entry.source.seriesFingerprints) otherFingerprints.add(fingerprint);
      for (const fingerprint of entry.source.overlapFingerprints) otherOverlaps.add(fingerprint);
    }
  }
  const additions: DiaryEntry[] = [];
  let addedShots = 0, skippedShots = 0;
  for (const session of sessions) {
    const rounds: Round[] = [], sourceRecords: number[] = [], seriesFingerprints = new Set<string>(), overlapFingerprints = new Set<string>();
    let nextId = 1;
    for (const round of session.rounds) {
      const mapped = round.conditions ?? options.conditionsOverrides?.[round.sourceId];
      const conditions = mapped && round.equipment ? { ...mapped, equipment: round.equipment } : mapped;
      const targetRound: Round = { id: nextId++, series: [] };
      for (const series of round.series) {
        if ([preview.sourceFormat, preview.fileHash, session.sourceId, round.sourceId, series.sourceId].some(id => blocked.has(id)) || !isConditions(conditions)) {
          skippedShots += series.shots.length;
          if (!isConditions(conditions)) warn('conditions_mapping_required', round.sourceId, true);
          continue;
        }
        const overlap = otherFingerprints.has(series.fingerprint) || !!series.overlapFingerprint && otherOverlaps.has(series.overlapFingerprint);
        if (overlap && options.allowOverlaps !== true) {
          skippedShots += series.shots.length;
          warn('possible_overlap', series.sourceId);
          continue;
        }
        if (overlap) warn('overlap_explicitly_allowed', series.sourceId);
        const shots: Shot[] = [], arrowNumbers = new Set<number>();
        for (const shot of series.shots) {
          if (blocked.has(shot.sourceId) || shot.points === null || !Number.isInteger(shot.points) || shot.points < 0 || shot.points > 10 ||
            !(shot.code === (shot.points === 0 ? 'M' : String(shot.points)) || shot.points === 10 && shot.code === 'X') ||
            !Number.isSafeInteger(shot.sourceRecord) || shot.sourceRecord < 0) {
            skippedShots++;
            warn('unsupported_shot', shot.sourceId, true);
            continue;
          }
          if (knownRecords.has(shot.sourceRecord)) {
            skippedShots++;
            warn('already_imported', shot.sourceId);
            continue;
          }
          const target = { profileId: conditions.targetProfileId, diameterMm: conditions.targetDiameterMm,
            shaftDiameterMm: conditions.equipment?.arrows.diameterMm ?? 6 };
          const point = shot.points > 0 && shot.point && Number.isFinite(shot.point.x) && Number.isFinite(shot.point.y) && isOnFace(shot.point, target)
            ? { ...shot.point } : null;
          const triple = getTargetProfile(target.profileId)?.vertical;
          const missPoint = triple && shot.points === 0 && shot.point && isInMissRing(shot.point, target) ? { ...shot.point } : undefined;
          if (shot.points > 0 && shot.point && !point) warn('coordinate_not_preserved', shot.sourceId);
          const number = shot.physicalArrowNumber;
          const validNumber = number !== undefined && validNumberedCount(number) && !arrowNumbers.has(number);
          if (number !== undefined && !validNumber) warn('invalid_arrow_number', shot.sourceId);
          if (validNumber) arrowNumbers.add(number);
          shots.push({ points: shot.points, code: shot.code!, point, imported: true,
            ...(missPoint ? { missPoint } : {}),
            ...((point || missPoint) && shot.spot !== undefined && triple ? { spot: shot.spot } : {}),
            ...(shot.rawPoint ? { sourcePoint: { ...shot.rawPoint } } : {}), ...(validNumber ? { physicalArrowNumber: number } : {}) });
          sourceRecords.push(shot.sourceRecord);
          knownRecords.add(shot.sourceRecord);
        }
        if (!shots.length) continue;
        const targetSeries: Series = { id: nextId++, shots, conditions: structuredClone(conditions), plannedCount: Math.max(3, shots.length) };
        targetRound.series.push(targetSeries);
        seriesFingerprints.add(series.fingerprint);
        if (series.overlapFingerprint) overlapFingerprints.add(series.overlapFingerprint);
      }
      if (targetRound.series.length) rounds.push(targetRound);
    }
    if (!sourceRecords.length) continue;
    sourceRecords.sort((a, b) => a - b);
    const id = `mytargets:${preview.fileHash}:${encodeURIComponent(session.sourceId)}:${recordsDigest(sourceRecords)}`;
    if (existingDiary.entries.some(entry => entry.id === id) || additions.some(entry => entry.id === id)) throw new Error('import_id_conflict');
    if (session.localDate !== null && !isLocalDate(session.localDate)) throw new Error('invalid_import_date');
    // The date-only source has no known time. Noon is a display placeholder in the
    // user's local timezone; savedAt records this import, never the historical date.
    const startedAt = session.localDate === null ? '' : new Date(`${session.localDate}T12:00:00`).toISOString();
    additions.push({ id, title: session.title, startedAt, createdAt: importedAt, localDate: session.localDate,
      source: { kind: 'mytargets', fileHash: preview.fileHash, parserVersion: preview.parserVersion, sessionId: session.sourceId,
        sourceRecords, seriesFingerprints: [...seriesFingerprints], overlapFingerprints: [...overlapFingerprints] },
      practice: { rounds, nextId, savedAt: importedAt, roundRule: { unit: 'unlimited', limit: null } } });
    addedShots += sourceRecords.length;
  }
  const diary: Diary = { ...existingDiary, entries: [...existingDiary.entries, ...additions] };
  if (!isDiary(diary)) throw new Error('invalid_converted_diary');
  const equipment = additions.length ? mergeEquipment(existingEquipment, preview.equipment) : structuredClone(existingEquipment);
  return { diary, equipment, addedTrainings: additions.length, addedShots, skippedShots, warnings };
}
