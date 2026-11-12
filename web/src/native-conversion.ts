import { isRankAssignment, isRankAssignments } from './assigned-ranks.ts';
import type { RankAssignment } from './assigned-ranks.ts';
import { conditionsKey } from './composite-scoring.ts';
import { isConditions, isPreset } from './conditions.ts';
import type { Conditions, RoundRule, TrainingPreset } from './conditions.ts';
import { isDiaryNote } from './diary-notes.ts';
import type { DiaryNote, DiaryNoteScope } from './diary-notes.ts';
import { isEquipmentSnapshot, isLibrary, validNumberedCount } from './equipment.ts';
import type { EquipmentArrows, EquipmentBow, EquipmentKit, EquipmentLibrary, EquipmentSnapshot } from './equipment.ts';
import { isLocalDate } from './import-source.ts';
import type { NativeArchiveInspection, NativeArchiveRow } from './native-archive.ts';
import type { Practice, Round, Series } from './practice.ts';
import type { TrainingPreferences } from './preferences.ts';
import { isDisabledStatistics } from './statistics-visibility.ts';
import { getTargetProfile, acceptsDiameter, isOnFace } from './target.ts';
import type { Shot } from './target.ts';
import { isTechniqueLibrary, isTechniqueSelection, parseTechniqueText } from './technique.ts';
import type { TechniqueDocument, TechniqueLibrary, TechniqueSelection, TechniqueVersion } from './technique.ts';
import { isTechniqueReflectionEntry } from './technique-reflection.ts';
import type { TechniqueReflectionEntry } from './technique-reflection.ts';
import type { TechniqueDisplaySettings } from './technique-settings.ts';
import type { TimerSettings } from './timer.ts';
import type { TrainingTime } from './training-time.ts';
import { isThemeMode, isThemeStyle } from './web-theme.ts';
import type { ThemePreferences } from './web-theme.ts';

export type NativeTrainingCandidate = {
  sourceId: string; title: string; localDate: string | null; timeSource: string; state: string; deleted: boolean;
  practice: Practice | null; blockers: string[];
  notes: DiaryNote[]; trainingTime: TrainingTime | null;
  techniqueUseCandidates: NativeTechniqueUseCandidate[];
  roundLocations: Record<string, { round: number; series: number; webSeriesId: number }>;
  retainedFacts: { session: NativeArchiveRow; blocks: NativeArchiveRow[]; ends: NativeArchiveRow[]; shots: NativeArchiveRow[];
    plans: NativeArchiveRow[]; notes: NativeArchiveRow[]; techniqueUses: NativeArchiveRow[]; lifecycleReceipts: NativeArchiveRow[] };
};
export type NativeEquipmentCandidate = { sourceId: string; kind: string;
  item: EquipmentBow | EquipmentArrows | EquipmentKit | null; blockers: string[]; retainedFacts: NativeArchiveRow;
  retainedRevisions: NativeArchiveRow[] };
export type NativeTechniqueCandidate = { sourceId: string; document: TechniqueDocument | null; blockers: string[];
  retainedFacts: { document: NativeArchiveRow; versions: NativeArchiveRow[] } };
export type NativeRankCandidate = { sourceId: string; assignment: RankAssignment | null; blockers: string[]; retainedFacts: NativeArchiveRow };
export type NativeTechniqueUseCandidate = { sourceId: string; seriesId: number | null; arrowsBefore: null;
  selection: TechniqueSelection | null; reflection: TechniqueReflectionEntry | null; blockers: string[]; retainedFacts: NativeArchiveRow };
export type NativePresetCandidate = { sourceId: string; preset: TrainingPreset | null; blockers: string[]; retainedFacts: NativeArchiveRow };
export type NativeSettingsProjection = { training: Partial<TrainingPreferences>; technique: Partial<TechniqueDisplaySettings>;
  timer: Partial<TimerSettings>; mappedKeys: string[]; retainedKeys: string[] };
export type NativeConversionIssue = { sourceId: string; code: string };
export type NativeConversion = { inspection: NativeArchiveInspection; candidates: NativeTrainingCandidate[];
  notebookNotes: DiaryNote[];
  equipmentCandidates: NativeEquipmentCandidate[]; techniqueCandidates: NativeTechniqueCandidate[];
  rankCandidates: NativeRankCandidate[]; presetCandidates: NativePresetCandidate[];
  catalogs: { equipment: EquipmentLibrary | null; techniques: TechniqueLibrary | null; rankAssignments: RankAssignment[] | null;
    presets: TrainingPreset[] | null };
  settings: NativeSettingsProjection; themePreferences: ThemePreferences; issues: NativeConversionIssue[] };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const sqliteBoolean = (value: unknown) => value === 0 ? false : value === 1 ? true : value;
function equipmentMetadata(source: Record<string, unknown>) {
  return { model: source.model, notes: source.notes, revision: source.revision, createdAtMs: source.createdAtMs,
    updatedAtMs: source.updatedAtMs, favorite: sqliteBoolean(source.favorite), archived: sqliteBoolean(source.archived) };
}
const bowDetails = (source: Record<string, unknown>) => ({ category: source.category ?? null,
  drawWeightLb: source.drawWeightLb, drawLengthIn: source.drawLengthIn });
const arrowsDetails = (source: Record<string, unknown>) => ({ diameterMm: source.diameterMm ?? null,
  spine: source.spine, lengthMm: source.lengthMm, massGrain: source.massGrain,
  numberedCount: source.numberedCount ?? undefined });
function json(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try { const parsed: unknown = JSON.parse(value); return record(parsed) ? parsed : null; } catch { return null; }
}
function timestamp(value: unknown): string | null {
  if (!integer(value)) return null;
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
const rules: Record<string, string> = {
  'practice-full-10-v1': 'practice-point-10-v1', 'wa-outdoor-full-v1': 'wa-outdoor-point-v1',
  'wa-indoor-outer-v1': 'wa-indoor-outer-point-v1', 'wa-indoor-inner-v1': 'wa-indoor-inner-point-v1',
  'wa-outdoor-six-v1': 'wa-outdoor-six-point-v1', 'wa-indoor-five-outer-v1': 'wa-indoor-five-outer-point-v1',
  'wa-indoor-five-inner-v1': 'wa-indoor-five-inner-point-v1',
};

/** Port of JournalTargets.verifiedTarget: a familiar profile ID alone is insufficient. */
export function nativeTargetIsMapped(block: NativeArchiveRow): boolean {
  const profile = typeof block.targetProfileId === 'string' ? getTargetProfile(block.targetProfileId) : undefined;
  if (!profile || block.targetProfileVersion !== 1 || !integer(block.targetDiameterMm) || !acceptsDiameter(profile, block.targetDiameterMm)) return false;
  const snapshot = json(block.targetSnapshotJson);
  if (!snapshot || snapshot.profileId !== profile.id || snapshot.profileVersion !== 1 || snapshot.geometryType !== 'circle' ||
    snapshot.scoringRuleVersion !== rules[profile.id] || snapshot.diameterMm !== block.targetDiameterMm || snapshot.boundaryRule !== 'greater-score' ||
    snapshot.boundaryEpsilon !== 1e-9 || (snapshot.supportsX ?? false) !== profile.zones.some(zone => zone.code === 'X') ||
    !Array.isArray(snapshot.faces) || snapshot.faces.length !== 1) return false;
  const face = snapshot.faces[0];
  if (!record(face) || face.faceId !== 'main' || !Array.isArray(face.zones) || face.zones.length !== profile.zones.length) return false;
  return profile.zones.every((expected, index) => {
    const zone = (face.zones as unknown[])[index];
    return record(zone) && zone.code === expected.code && zone.points === expected.points && zone.outerRadius === expected.outerRadius && zone.isX === (expected.code === 'X');
  });
}
function equipmentSnapshot(raw: unknown): EquipmentSnapshot | null {
  if (raw === null) return null;
  const source = json(raw);
  if (!source || source.schema !== 1 || !record(source.selection)) throw new Error('unmapped_equipment_snapshot');
  if (source.bow !== null && !record(source.bow) || source.arrows !== null && !record(source.arrows)) throw new Error('unmapped_equipment_snapshot');
  const bow = record(source.bow) ? source.bow : null, arrows = record(source.arrows) ? source.arrows : null;
  const result = { ...source.selection, ...equipmentMetadata(source.selection), id: source.selection.id, name: source.selection.name,
    bowId: source.selection.bowId, arrowsId: source.selection.arrowsId,
    bow: bow ? { ...bow, ...equipmentMetadata(bow), ...bowDetails(bow), name: bow.name ?? '', id: bow.id ?? undefined } : { name: '', category: null },
    arrows: arrows ? { ...arrows, ...equipmentMetadata(arrows), ...arrowsDetails(arrows), name: arrows.name ?? '', id: arrows.id ?? undefined } : { name: '', diameterMm: null } };
  if (!isEquipmentSnapshot(result)) throw new Error('unmapped_equipment_snapshot');
  return result;
}
function mappedConditions(block: NativeArchiveRow): Conditions {
  if (block.mode !== 'scored') throw new Error('unsupported_count_only');
  if (!nativeTargetIsMapped(block)) throw new Error('unmapped_target_geometry');
  const result = { distanceMeters: block.distanceMeters, targetProfileId: block.targetProfileId,
    targetDiameterMm: block.targetDiameterMm, equipment: equipmentSnapshot(block.equipmentSnapshotJson) };
  if (!isConditions(result)) throw new Error('unmapped_conditions');
  return result;
}
/** The source inspection keeps original Y-up coordinates. Only the web projection reverses Y. */
function mappedShot(row: NativeArchiveRow, conditions: Conditions): Shot {
  if (!integer(row.points) || row.points < 0 || row.points > 10) throw new Error('unsupported_shot_score');
  const code = row.zoneCode ?? (row.points === 0 ? 'M' : String(row.points));
  if (code !== (row.points === 0 ? 'M' : String(row.points)) && !(row.points === 10 && code === 'X')) throw new Error('unsupported_shot_zone');
  if (code === 'X' && !getTargetProfile(conditions.targetProfileId)!.zones.some(zone => zone.code === 'X')) throw new Error('unmapped_source_x_zone');
  if (!['known', 'unknown'].includes(String(row.positionStatus))) throw new Error('unverified_position');
  const hasPoint = row.x !== null || row.y !== null;
  if (hasPoint && (!finite(row.x) || !finite(row.y) || row.positionStatus !== 'known')) throw new Error('unsupported_shot_position');
  if (!hasPoint && row.positionStatus !== 'unknown') throw new Error('unsupported_shot_position');
  if (hasPoint && row.points === 0) throw new Error('miss_coordinates_not_representable');
  if (row.faceId != null && row.faceId !== 'main') throw new Error('unmapped_target_face');
  const point = hasPoint ? { x: row.x as number, y: -(row.y as number) } : null;
  const target = { profileId: conditions.targetProfileId, diameterMm: conditions.targetDiameterMm, shaftDiameterMm: conditions.equipment?.arrows.diameterMm ?? 6 };
  if (point && !isOnFace(point, target)) throw new Error('coordinate_outside_web_target');
  if (row.physicalArrowNumber != null && !validNumberedCount(row.physicalArrowNumber)) throw new Error('unsupported_arrow_number');
  return { points: row.points, code: code as string, point, imported: true,
    ...(row.physicalArrowNumber != null ? { physicalArrowNumber: row.physicalArrowNumber as number } : {}) };
}
type EndEvidence = { end: NativeArchiveRow; block: NativeArchiveRow; shots: NativeArchiveRow[]; volume: number };
function groupedRounds(entries: EndEvidence[], blocks: NativeArchiveRow[], session: NativeArchiveRow,
  seriesLimit: number | null, rolling: boolean, roundCount: number): { groups: EndEvidence[][]; imported: boolean } {
  const current = entries.filter(item => item.block === blocks.at(-1)).at(-1)?.end.id;
  const split = (sequence: EndEvidence[], limit: number | null) => {
    const groups: EndEvidence[][] = [];
    for (const item of sequence) {
      if (!groups.length || item.end.startsRound === 1 || limit !== null && groups.at(-1)!.length >= limit) groups.push([]);
      groups.at(-1)!.push(item);
    }
    return groups;
  };
  // Match importedRoundGroups(): original MyTargets round IDs supersede native plan splits.
  if (session.sourceKind === 'mytargets' && blocks.length) {
    const imported = new Map<string, EndEvidence[]>();
    let supported = true;
    for (const block of blocks) {
      const snapshot = json(block.targetSnapshotJson);
      const source = snapshot?.sourceFormat === 'mytargets-zip-v27' && typeof snapshot.sourceRoundKey === 'string' && snapshot.sourceRoundKey.trim()
        ? snapshot.sourceRoundKey : imported.size ? String(block.id) : null;
      if (source === null) { supported = false; break; }
      const chosen = entries.filter(item => item.block === block && item.end.role === 'scored' && (item.volume > 0 || item.end.state === 'open'));
      if (chosen.length) imported.set(source, [...(imported.get(source) ?? []), ...chosen]);
    }
    if (supported && imported.size) return { groups: [...imported.values()].flatMap(group => split(group, null)), imported: true };
  }
  const chosen = entries.filter(item => item.end.role === 'scored' && (item.volume > 0 ||
    (rolling || roundCount > 1) && item.end.state === 'closed' || item.end.id === current));
  return { groups: split(chosen, seriesLimit), imported: false };
}

const lifecycleKinds = new Set(['start', 'resume', 'pause', 'complete', 'next', 'trash']);

/** Reconstruct measured intervals from the same lifecycle receipt subset as Android. */
function nativeTrainingTime(session: NativeArchiveRow, receipts: NativeArchiveRow[], report: (code: string) => void): TrainingTime | null {
  if (!receipts.length) return null;
  if (receipts.some(row => !integer(row.resultRevision) || row.resultRevision < 1 || !integer(row.appliedAtMs))) {
    report('invalid_training_time_receipt');
    return null;
  }
  if (new Set(receipts.map(row => row.resultRevision)).size !== receipts.length) {
    report('ambiguous_training_time_receipts');
    return null;
  }
  const ordered = [...receipts].sort((a, b) => Number(a.resultRevision) - Number(b.resultRevision));
  let partial = ordered[0].kind !== 'start';
  let activeSinceMs: number | null = null;
  let closedMs: number | null = null;
  for (const event of ordered) {
    const instant = Number(event.appliedAtMs);
    if (event.kind === 'start' || event.kind === 'resume') {
      if (activeSinceMs !== null || instant < 0) partial = true;
      activeSinceMs = instant >= 0 ? instant : null;
      continue;
    }
    if (activeSinceMs !== null) {
      if (instant < activeSinceMs) partial = true;
      else {
        closedMs = (closedMs ?? 0) + (instant - activeSinceMs);
        if (!Number.isSafeInteger(closedMs)) {
          report('training_time_out_of_range');
          return null;
        }
      }
    }
    activeSinceMs = null;
  }
  if (session.state !== 'active' || session.deletedAtMs != null) {
    if (activeSinceMs !== null) partial = true;
    activeSinceMs = null;
  }
  if (closedMs === null && activeSinceMs === null) {
    report('training_time_missing_intervals');
    return null;
  }
  return { closedMs, activeSinceMs, partial };
}

function mappedNote(row: NativeArchiveRow, scope: DiaryNoteScope): DiaryNote | null {
  let tags: unknown;
  if (typeof row.tagsJson === 'string' && row.tagsJson.length <= 4096) {
    try { tags = JSON.parse(row.tagsJson); } catch { tags = undefined; }
  }
  const note = { ...scope, id: row.id, localDate: row.localDate, body: row.body, tags, place: row.place, feeling: row.feeling,
    conditions: row.conditions, createdAtMs: row.createdAtMs, updatedAtMs: row.updatedAtMs,
    ...(row.deletedAtMs !== undefined ? { deletedAtMs: row.deletedAtMs } : {}) };
  return isDiaryNote(note) ? note : null;
}

function mappedNotes(candidate: NativeTrainingCandidate, blockKeys: ReadonlyMap<unknown, string>, report: (row: NativeArchiveRow, code: string) => void): DiaryNote[] {
  const endsById = new Map(candidate.retainedFacts.ends.map(row => [row.id, row]));
  const counts = new Map<string, number>();
  for (const key of blockKeys.values()) counts.set(key, (counts.get(key) ?? 0) + 1);
  const notes: DiaryNote[] = [];
  for (const row of candidate.retainedFacts.notes) {
    let scope: DiaryNoteScope = {};
    if (row.endId != null) {
      const end = endsById.get(row.endId);
      const mappedEnd = candidate.roundLocations[String(row.endId)];
      if (!candidate.practice || !end || !mappedEnd || row.blockId == null || end.blockId !== row.blockId) {
        report(row, 'unmapped_note_series');
        continue;
      }
      scope = { seriesId: mappedEnd.webSeriesId };
    } else if (row.blockId != null) {
      const key = blockKeys.get(row.blockId);
      if (!candidate.practice || key === undefined) {
        report(row, 'unmapped_note_conditions');
        continue;
      }
      if ((counts.get(key) ?? 0) > 1) {
        report(row, 'ambiguous_note_conditions');
        continue;
      }
      scope = { conditionKey: key };
    }
    const note = mappedNote(row, scope);
    if (note) notes.push(note);
    else report(row, 'unmapped_note');
  }
  return notes;
}

function mappedEquipmentCandidates(rows: NativeArchiveRow[], revisions: NativeArchiveRow[]): NativeEquipmentCandidate[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const bowItem = (row: NativeArchiveRow) => ({ ...row, ...equipmentMetadata(row), ...bowDetails(row), id: row.id, name: row.name });
  const arrowsItem = (row: NativeArchiveRow) => ({ ...row, ...equipmentMetadata(row), ...arrowsDetails(row), id: row.id, name: row.name });
  return rows.map(row => {
    const candidate: NativeEquipmentCandidate = { sourceId: String(row.id), kind: String(row.kind), item: null, blockers: [], retainedFacts: row,
      retainedRevisions: revisions.filter(revision => revision.itemId === row.id) };
    if (row.kind === 'bow') {
      const library = { bows: [bowItem(row)], arrows: [], kits: [] };
      if (isLibrary(library)) candidate.item = library.bows[0];
    } else if (row.kind === 'arrows') {
      const library = { bows: [], arrows: [arrowsItem(row)], kits: [] };
      if (isLibrary(library)) candidate.item = library.arrows[0];
    } else if (row.kind === 'setup') {
      const bow = byId.get(row.bowId);
      const arrows = byId.get(row.arrowsId);
      const library = {
        bows: bow?.kind === 'bow' ? [bowItem(bow)] : [],
        arrows: arrows?.kind === 'arrows' ? [arrowsItem(arrows)] : [],
        kits: [{ ...row, ...equipmentMetadata(row), id: row.id, name: row.name, bowId: row.bowId ?? null, arrowsId: row.arrowsId ?? null }],
      };
      if (isLibrary(library)) candidate.item = library.kits[0];
    }
    if (candidate.item === null) candidate.blockers.push('unmapped_equipment');
    return candidate;
  });
}

function mappedRanks(rows: NativeArchiveRow[]): NativeRankCandidate[] {
  const currentByScope = new Map<string, NativeRankCandidate[]>();
  const candidates = rows.map(row => {
    const value = { id: row.id, discipline: row.discipline, category: row.category, level: row.level, assignedOn: row.assignedOn,
      issuedBy: row.issuedBy, reference: row.reference, current: sqliteBoolean(row.current), createdAtMs: row.createdAtMs,
      updatedAtMs: row.updatedAtMs, revision: row.revision, deletedAtMs: row.deletedAtMs };
    const assignment = isRankAssignment(value) ? value : null;
    const candidate: NativeRankCandidate = { sourceId: String(row.id), retainedFacts: row, assignment,
      blockers: assignment ? [] : ['unmapped_rank_assignment'] };
    if (assignment?.current) {
      const key = `${assignment.discipline}:${assignment.category}`;
      const group = currentByScope.get(key) ?? [];
      group.push(candidate);
      currentByScope.set(key, group);
    }
    return candidate;
  });
  for (const group of currentByScope.values()) if (group.length > 1) {
    for (const candidate of group) {
      candidate.assignment = null;
      candidate.blockers.push('conflicting_current_rank');
    }
  }
  return candidates;
}

function mappedThemePreferences(preferences: NativeArchiveRow, report: (sourceId: string, code: string) => void): ThemePreferences {
  const values = preferences.values;
  if (!record(values)) return {};
  const result: ThemePreferences = {};
  if (Object.hasOwn(values, 'designStyle')) {
    const style = values.designStyle;
    if (record(style) && style.type === 'string' && isThemeStyle(style.value)) result.themeStyle = style.value;
    else report('designStyle', 'unmapped_theme_preference');
  }
  if (Object.hasOwn(values, 'appearanceMode')) {
    const mode = values.appearanceMode;
    if (record(mode) && mode.type === 'string' && isThemeMode(mode.value)) result.themeMode = mode.value;
    else report('appearanceMode', 'unmapped_theme_preference');
  }
  return result;
}

function mappedSettings(preferences: NativeArchiveRow, theme: ThemePreferences, report: (sourceId: string, code: string) => void): NativeSettingsProjection {
  const values = record(preferences.values) ? preferences.values : {};
  const mapped = new Set<string>();
  const result: NativeSettingsProjection = { training: { ...theme }, technique: {}, timer: {}, mappedKeys: [], retainedKeys: [] };
  function read(key: string, type: string, apply: (value: unknown) => boolean) {
    if (!Object.hasOwn(values, key)) return;
    const entry = values[key];
    if (record(entry) && entry.type === type && apply(entry.value)) mapped.add(key);
    else report(key, 'unmapped_preference_value');
  }
  for (const [source, target] of [
    ['hide_current_scores_v1', 'hideScores'], ['average_hundredths_v1', 'averageHundredths'],
    ['animationsEnabled', 'animations'], ['hapticsEnabled', 'haptics'], ['keepScreenAwake', 'keepAwake'],
    ['training_on_lock_screen_v1', 'trainingOnLockScreen'], ['show_achievements_v1', 'showAchievementNotices'],
  ] as const) read(source, 'boolean', value => {
    if (typeof value !== 'boolean') return false;
    result.training[target] = value;
    return true;
  });
  read('onboardingCompletedVersion', 'int', value => {
    if (!integer(value) || value < 0) return false;
    result.training.onboardingSeen = value > 0;
    return true;
  });
  read('displayName', 'string', value => {
    if (typeof value !== 'string' || value.length > 40) return false;
    result.training.displayName = value;
    return true;
  });
  read('rank_category_v1', 'string', value => {
    if (value !== 'male' && value !== 'female') return false;
    result.training.rankCategory = value;
    return true;
  });
  read('shooting_base_minutes_v1', 'long', value => {
    if (!integer(value) || value < 0 || value > 59_999_999) return false;
    result.training.shootingBaseMinutes = value;
    return true;
  });
  read('disabled_statistics_v1', 'stringSet', value => {
    if (!isDisabledStatistics(value)) return false;
    result.training.disabledStatistics = [...value];
    return true;
  });
  for (const [source, target] of [['technique_focus', 'techniqueFocus'], ['technique_reflection', 'techniqueReflection']] as const) {
    read(source, 'boolean', value => {
      if (typeof value !== 'boolean') return false;
      result.technique[target] = value;
      return true;
    });
  }
  for (const [source, target] of [['series_timer_seconds_v1', 'seriesSeconds'], ['rest_timer_seconds_v1', 'restSeconds']] as const) {
    read(source, 'int', value => {
      if (!integer(value) || value < 1 || value > 3600) return false;
      result.timer[target] = value;
      return true;
    });
  }
  if (theme.themeStyle !== undefined) mapped.add('designStyle');
  if (theme.themeMode !== undefined) mapped.add('appearanceMode');
  result.mappedKeys = [...mapped].sort();
  result.retainedKeys = Object.keys(values).filter(key => !mapped.has(key)).sort();
  for (const key of result.retainedKeys) {
    if (!['training_presets_v1', 'designStyle', 'appearanceMode'].includes(key)) report(key, 'native_preference_retained');
  }
  return result;
}

function mappedPresets(preferences: NativeArchiveRow, report: (sourceId: string, code: string) => void): NativePresetCandidate[] {
  const values = record(preferences.values) ? preferences.values : {};
  if (!Object.hasOwn(values, 'training_presets_v1')) return [];
  const entry = values.training_presets_v1;
  const root = record(entry) && entry.type === 'string' && typeof entry.value === 'string' &&
    new TextEncoder().encode(entry.value).length <= 512 * 1024 ? json(entry.value) : null;
  if (!root || root.version !== 1 || Object.keys(root).length !== 2 || !Array.isArray(root.presets) || root.presets.length > 64) {
    report('training_presets_v1', 'unmapped_training_presets');
    return [];
  }
  return root.presets.map((raw, index): NativePresetCandidate => {
    const row = record(raw) ? raw : {};
    const candidate: NativePresetCandidate = { sourceId: typeof row.id === 'string' ? row.id : `training_presets_v1:${index}`,
      preset: null, blockers: [], retainedFacts: row as NativeArchiveRow };
    const fail = (code: string) => { if (!candidate.blockers.includes(code)) candidate.blockers.push(code); };
    const plan = json(row.plan);
    if (Object.keys(row).length !== 4 || typeof row.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id) ||
      typeof row.name !== 'string' || /[\x00-\x1f]/.test(row.name) ||
      !integer(row.revision) || row.revision < 1 || !plan || plan.version !== 1) fail('invalid_native_preset');
    if (plan) {
      if (plan.mode !== 'scored') fail('unsupported_preset_count_only');
      if (plan.arrows !== 3) fail('preset_series_size_not_representable');
      if (plan.flexibleSeries !== true || plan.ends != null || plan.rounds !== 1) fail('preset_fixed_plan_not_representable');
      const arrowLimit = plan.roundArrowLimit ?? null, seriesLimit = plan.seriesPerRound ?? null;
      if (arrowLimit !== null && (seriesLimit !== null || !integer(arrowLimit) || arrowLimit < 1 || arrowLimit > 1_000_000) ||
        seriesLimit !== null && (!integer(seriesLimit) || seriesLimit < 1 || seriesLimit > 200)) fail('invalid_native_preset_rule');
      if (plan.numberedArrows != null && typeof plan.numberedArrows !== 'boolean') fail('invalid_native_preset_numbering');
      try {
        const profile = typeof plan.target === 'string' ? getTargetProfile(plan.target) : undefined;
        const conditions = { distanceMeters: plan.distance, targetDiameterMm: plan.diameter, targetProfileId: plan.target,
          equipment: equipmentSnapshot(plan.equipment) };
        if (!profile || !isConditions(conditions)) fail('unmapped_preset_conditions');
        const rule = arrowLimit !== null ? { unit: 'arrows', limit: arrowLimit } :
          seriesLimit !== null ? { unit: 'series', limit: seriesLimit } : { unit: 'unlimited', limit: null };
        const mapped = { id: row.id, name: row.name, conditions, rule, numberedArrows: plan.numberedArrows ?? null };
        if (!isPreset(mapped)) fail('invalid_web_preset');
        if (!candidate.blockers.length && isPreset(mapped)) candidate.preset = mapped;
      } catch { fail('unmapped_preset_equipment'); }
    }
    return candidate;
  });
}

function mappedTechniqueUses(candidate: NativeTrainingCandidate, versions: ReadonlyMap<string, TechniqueVersion>): NativeTechniqueUseCandidate[] {
  const seen = new Set<unknown>();
  return [...candidate.retainedFacts.techniqueUses].sort((a, b) => Number(a.sequence) - Number(b.sequence)).map(row => {
    const result: NativeTechniqueUseCandidate = { sourceId: String(row.id), seriesId: null, arrowsBefore: null,
      selection: null, reflection: null, blockers: [], retainedFacts: row };
    if (!integer(row.sequence) || row.sequence < 1 || seen.has(row.sequence)) result.blockers.push('invalid_technique_use_sequence');
    seen.add(row.sequence);
    const block = candidate.retainedFacts.blocks.find(value => value.ordinal === row.blockOrdinal);
    const end = block && candidate.retainedFacts.ends.find(value => value.blockId === block.id && value.ordinal === row.endOrdinal);
    const location = end && candidate.roundLocations[String(end.id)];
    if (location && candidate.practice) result.seriesId = location.webSeriesId;
    else result.blockers.push('unmapped_technique_use_series');
    const version = typeof row.versionId === 'string' ? versions.get(row.versionId) : null;
    const selection = row.versionId === null ? { versionId: null, versionNumber: null, payload: null, title: 'Мой фокус', focus1: row.focus1, focus2: row.focus2 } :
      version ? { versionId: version.id, versionNumber: version.number, payload: structuredClone(version.payload), title: version.payload.title,
        focus1: row.focus1, focus2: row.focus2 } : null;
    if (isTechniqueSelection(selection)) result.selection = selection;
    else result.blockers.push('unmapped_technique_use_selection');
    const reflection = { worked: row.worked, question: row.question, rating: row.rating };
    if (isTechniqueReflectionEntry(reflection)) result.reflection = reflection;
    else result.blockers.push('unmapped_technique_use_reflection');
    // Android records a series ordinal but does not record the web model's exact arrow boundary.
    result.blockers.push('technique_use_arrow_boundary_unavailable');
    return result;
  });
}

/** Pure candidate projection; retained inspection remains authoritative for all unmodeled native facts. */
export function buildNativeConversion(inspection: NativeArchiveInspection): NativeConversion {
  const issues: NativeConversionIssue[] = [];
  const report = (sourceId: unknown, code: string) => issues.push({ sourceId: String(sourceId), code });
  const table = (name: string) => inspection.tables[`data/journal/${name}.jsonl`] ?? [];
  const index = (name: string, key: string) => {
    const result = new Map<unknown, NativeArchiveRow[]>();
    for (const row of table(name)) { const rows = result.get(row[key]) ?? []; rows.push(row); result.set(row[key], rows); }
    return result;
  };
  const blocksBySession = index('blocks', 'sessionId'), endsByBlock = index('ends', 'blockId'), shotsByEnd = index('shots', 'endId');
  const plansBySession = index('session_plans', 'sessionId'), notesBySession = index('diary_notes', 'sessionId'), usesBySession = index('technique_uses', 'sessionId');
  const countsByEnd = index('unscored_counts', 'endId');
  const receiptsBySession = index('mutation_receipts', 'sessionId');
  const sessionIds = new Set(table('sessions').map(row => row.id));
  const notebookNotes: DiaryNote[] = [];
  for (const note of table('diary_notes')) if (!sessionIds.has(note.sessionId)) {
    if (note.sessionId == null && note.blockId == null && note.endId == null) {
      const mapped = mappedNote(note, {});
      if (mapped) notebookNotes.push(mapped);
      else report(note.id, 'unmapped_note');
    } else report(note.id, 'unmapped_note_session');
  }
  const equipmentRows = inspection.tables['data/equipment/equipment_items.jsonl'] ?? [];
  const candidates = table('sessions').map((session): NativeTrainingCandidate => {
    const sourceId = String(session.id), blocks = [...(blocksBySession.get(sourceId) ?? [])].sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
    const ends = blocks.flatMap(row => endsByBlock.get(row.id) ?? []);
    const shots = ends.flatMap(row => shotsByEnd.get(row.id) ?? []), plans = plansBySession.get(sourceId) ?? [];
    const lifecycleReceipts = (receiptsBySession.get(sourceId) ?? []).filter(row =>
      row.resultId === sourceId && typeof row.kind === 'string' && lifecycleKinds.has(row.kind));
    const retainedFacts = { session, blocks, ends, shots, plans, lifecycleReceipts,
      notes: notesBySession.get(sourceId) ?? [], techniqueUses: usesBySession.get(sourceId) ?? [] };
    const candidate: NativeTrainingCandidate = { sourceId, title: typeof session.title === 'string' ? session.title : '',
      localDate: typeof session.localDate === 'string' && isLocalDate(session.localDate) ? session.localDate : null,
      timeSource: typeof session.timeSource === 'string' ? session.timeSource : '', state: typeof session.state === 'string' ? session.state : '',
      deleted: session.deletedAtMs != null, practice: null, blockers: [], roundLocations: Object.create(null), retainedFacts,
      notes: [], trainingTime: nativeTrainingTime(session, lifecycleReceipts, code => report(sourceId, code)), techniqueUseCandidates: [] };
    const block = (reason: string) => { if (!candidate.blockers.includes(reason)) candidate.blockers.push(reason); };
    if (!candidate.title.trim() || candidate.title.length > 5000) block('unsupported_session_title');
    if (!['active', 'paused', 'completed'].includes(candidate.state)) block('unsupported_session_state');
    if (session.localDate != null && !isLocalDate(session.localDate)) block('invalid_local_date');
    if (plans.length > 1) block('multiple_session_plans');
    const plan = plans[0], schema = inspection.manifest.journalSchema;
    const roundCount = plan ? schema < 7 ? 1 : plan.roundCount : 1;
    const rolling = !!plan && schema >= 11 && plan.rolling === 1;
    const arrowLimit = plan && schema >= 16 ? plan.roundArrowLimit ?? null : null;
    const plannedEnds = plan?.plannedEnds;
    if (plan && (!integer(roundCount) || roundCount < 1 || roundCount > 20 || !integer(plannedEnds) || plannedEnds < (rolling ? 0 : 1) || plannedEnds > 200 || plannedEnds % Number(roundCount) !== 0 ||
      schema >= 11 && plan.rolling !== 0 && plan.rolling !== 1 || arrowLimit !== null && (!rolling || plannedEnds !== 0 || roundCount !== 1 || !integer(arrowLimit) || arrowLimit < 1 || arrowLimit > 1_000_000))) block('unsupported_session_plan');
    const seriesLimit = plan && arrowLimit === null && integer(plannedEnds) && integer(roundCount) && plannedEnds / roundCount > 0 ? plannedEnds / roundCount : null;
    let rule: RoundRule = integer(arrowLimit) ? { unit: 'arrows', limit: arrowLimit } : seriesLimit !== null ? { unit: 'series', limit: seriesLimit } : { unit: 'unlimited', limit: null };
    const mappedBlocks = new Map<NativeArchiveRow, Conditions>();
    for (const source of blocks) {
      try { mappedBlocks.set(source, mappedConditions(source)); } catch (error) { block(error instanceof Error ? error.message : 'unmapped_conditions'); }
    }
    if (ends.some(end => end.role !== 'scored')) block('warmup_not_representable');
    if (ends.some(end => end.startsRound != null && end.startsRound !== 0 && end.startsRound !== 1)) block('unsupported_round_boundary');
    if (ends.some(row => countsByEnd.has(row.id))) block('count_only_not_representable');
    const entries: EndEvidence[] = blocks.flatMap(source => [...(endsByBlock.get(source.id) ?? [])].sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
      .map(end => ({ end, block: source, shots: [...(shotsByEnd.get(end.id) ?? [])].sort((a, b) => Number(a.inputIndex) - Number(b.inputIndex)),
        volume: (shotsByEnd.get(end.id) ?? []).length })));
    const { groups, imported } = groupedRounds(entries, blocks, session, seriesLimit, rolling, Number(roundCount));
    if (imported) rule = { unit: 'unlimited', limit: null };
    const rounds: Round[] = [];
    const blockKeys = new Map<unknown, string>();
    let nextId = 1;
    for (const [roundIndex, sourceEnds] of groups.entries()) {
      const round: Round = { id: nextId++, series: [] };
      for (const [seriesIndex, evidence] of sourceEnds.entries()) {
        const conditions = mappedBlocks.get(evidence.block); if (!conditions) continue;
        const plannedCount = evidence.end.plannedCount;
        if (!integer(plannedCount) || plannedCount < 3 || plannedCount > 1_000_000 || evidence.shots.length > plannedCount) { block('unsupported_planned_count'); continue; }
        const target: Series = { id: nextId++, conditions, plannedCount, shots: [] };
        const numbers = new Set<number>();
        for (const shot of evidence.shots) try {
          const mapped = mappedShot(shot, conditions);
          if (mapped.physicalArrowNumber !== undefined) {
            if (numbers.has(mapped.physicalArrowNumber)) throw new Error('duplicate_arrow_number');
            numbers.add(mapped.physicalArrowNumber);
          }
          target.shots.push(mapped);
        } catch (error) { block(error instanceof Error ? error.message : 'unsupported_shot'); }
        if (target.shots.length && !blockKeys.has(evidence.block.id)) blockKeys.set(evidence.block.id, conditionsKey(conditions));
        candidate.roundLocations[String(evidence.end.id)] = { round: roundIndex + 1, series: seriesIndex + 1, webSeriesId: target.id };
        round.series.push(target);
      }
      if (round.series.length) rounds.push(round);
    }
    if (!rounds.length) block('no_representable_series');
    if (rule.unit === 'arrows' && rounds.some(round => round.series.reduce((count, series) => count + series.shots.length, 0) > rule.limit!)) block('round_exceeds_web_arrow_limit');
    const savedAt = candidate.state === 'completed' ? timestamp(session.completedAtMs) : null;
    if (candidate.state === 'completed' && savedAt === null) block('unknown_completion_timestamp');
    if (savedAt !== null && !rounds.some(round => round.series.some(series => series.shots.length))) block('empty_completed_training');
    if (session.numberedArrows != null && session.numberedArrows !== 0 && session.numberedArrows !== 1) block('unsupported_numbered_arrows');
    if (!candidate.blockers.length) candidate.practice = { rounds, nextId, savedAt, roundRule: rule,
      numberedArrows: session.numberedArrows == null ? null : session.numberedArrows === 1 };
    candidate.notes = mappedNotes(candidate, blockKeys, (row, code) => report(row.id, code));
    return candidate;
  });

  const equipmentCandidates = mappedEquipmentCandidates(equipmentRows, inspection.tables['data/equipment/equipment_revisions.jsonl'] ?? []);
  const equipmentIds = new Set(equipmentRows.map(row => row.id));
  for (const revision of inspection.tables['data/equipment/equipment_revisions.jsonl'] ?? []) {
    if (!equipmentIds.has(revision.itemId)) report(revision.itemId, 'orphan_equipment_revision');
  }
  const techniqueCandidates: NativeTechniqueCandidate[] = table('technique_documents').map(document => {
    const versions = table('technique_versions').filter(row => row.documentId === document.id), result: NativeTechniqueCandidate = {
      sourceId: String(document.id), document: null, blockers: [], retainedFacts: { document, versions } };
    try {
      if (document.archived !== 0 && document.archived !== 1 || document.isPrimary !== 0 && document.isPrimary !== 1) throw new Error('unmapped_technique');
      const mapped = { id: document.id, draft: parseTechniqueText(String(document.draftJson), true), updatedAtMs: document.updatedAtMs,
        archived: document.archived === 1, isPrimary: document.isPrimary === 1,
        versions: versions.map(version => ({ id: version.id, number: version.number, createdAtMs: version.createdAtMs,
          payload: parseTechniqueText(String(version.payloadJson)) })).sort((a, b) => Number(a.number) - Number(b.number)) };
      if (mapped.versions.some((version, index) => version.number !== index + 1)) throw new Error('noncontiguous_technique_versions');
      if (!isTechniqueLibrary({ version: 1, documents: [mapped] })) throw new Error('unmapped_technique');
      result.document = mapped as TechniqueDocument;
    } catch (error) { result.blockers.push(error instanceof Error && error.message === 'noncontiguous_technique_versions' ? error.message : 'unmapped_technique'); }
    return result;
  });
  const mappedVersions = new Map<string, TechniqueVersion>();
  for (const candidate of techniqueCandidates) for (const version of candidate.document?.versions ?? []) mappedVersions.set(version.id, version);
  for (const candidate of candidates) candidate.techniqueUseCandidates = mappedTechniqueUses(candidate, mappedVersions);
  const documents = new Set(table('technique_documents').map(row => row.id));
  for (const version of table('technique_versions')) if (!documents.has(version.documentId)) report(version.id, 'orphan_technique_version');
  const sessions = new Set(candidates.map(candidate => candidate.sourceId));
  for (const use of table('technique_uses')) if (!sessions.has(String(use.sessionId))) report(use.id, 'orphan_technique_use');
  const rankCandidates = mappedRanks(table('rank_assignments'));
  const themePreferences = mappedThemePreferences(inspection.preferences, report);
  const settings = mappedSettings(inspection.preferences, themePreferences, report);
  const presetCandidates = mappedPresets(inspection.preferences, report);
  const equipment = { bows: equipmentCandidates.filter(candidate => candidate.kind === 'bow').map(candidate => candidate.item),
    arrows: equipmentCandidates.filter(candidate => candidate.kind === 'arrows').map(candidate => candidate.item),
    kits: equipmentCandidates.filter(candidate => candidate.kind === 'setup').map(candidate => candidate.item) };
  const techniques = { version: 1, documents: techniqueCandidates.map(candidate => candidate.document) };
  const rankAssignments = rankCandidates.map(candidate => candidate.assignment);
  const presets = presetCandidates.map(candidate => candidate.preset);
  const catalogs: NativeConversion['catalogs'] = {
    equipment: equipmentCandidates.every(candidate => candidate.item !== null) && isLibrary(equipment) &&
      !issues.some(issue => issue.code === 'orphan_equipment_revision') ? equipment : null,
    techniques: techniqueCandidates.every(candidate => candidate.document !== null) && isTechniqueLibrary(techniques) &&
      !issues.some(issue => issue.code === 'orphan_technique_version') ? techniques : null,
    rankAssignments: isRankAssignments(rankAssignments) ? rankAssignments : null,
    presets: presets.every((preset): preset is TrainingPreset => preset !== null) &&
      new Set(presets.map(preset => preset.id)).size === presets.length &&
      new Set(presets.map(preset => preset.name.toLowerCase())).size === presets.length &&
      !issues.some(issue => issue.code === 'unmapped_training_presets') ? presets : null,
  };
  if (catalogs.equipment === null) report('equipment_items', 'equipment_catalog_conflict');
  if (catalogs.techniques === null) report('technique_documents', 'technique_catalog_conflict');
  if (catalogs.rankAssignments === null) report('rank_assignments', 'rank_catalog_conflict');
  if (catalogs.presets === null) report('training_presets_v1', 'preset_catalog_conflict');
  return { inspection, candidates, notebookNotes, equipmentCandidates, techniqueCandidates, rankCandidates,
    presetCandidates, catalogs, settings, themePreferences, issues };
}
