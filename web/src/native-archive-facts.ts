import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { Gunzip } from 'fflate';
import { BOW_CATEGORIES } from './equipment.ts';
import { getTargetProfile, scorePoint } from './target.ts';
import { nativeTargetIsMapped } from './native-conversion.ts';
import type { NativeArchiveRow, NativeJson } from './native-archive.ts';

const bad = (reason: string): never => { throw new Error(reason); };
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;

// CREATE TABLE and unique indexes from checked-in Room journal schema 16 and equipment schema 1.
const schema = [
  "CREATE TABLE IF NOT EXISTS `sessions` (`id` TEXT NOT NULL, `title` TEXT NOT NULL, `createdAtMs` INTEGER NOT NULL, `startedAtMs` INTEGER, `completedAtMs` INTEGER, `localDate` TEXT, `timeZoneId` TEXT, `timeSource` TEXT NOT NULL, `state` TEXT NOT NULL, `kind` TEXT NOT NULL, `sourceKind` TEXT NOT NULL, `revision` INTEGER NOT NULL, `deletedAtMs` INTEGER, `numberedArrows` INTEGER, PRIMARY KEY(`id`))",
  "CREATE TABLE IF NOT EXISTS `blocks` (`id` TEXT NOT NULL, `sessionId` TEXT NOT NULL, `ordinal` INTEGER NOT NULL, `mode` TEXT NOT NULL, `distanceMeters` REAL, `targetProfileId` TEXT, `targetProfileVersion` INTEGER, `targetDiameterMm` INTEGER, `targetSnapshotJson` TEXT, `equipmentSnapshotJson` TEXT, `defaultArrowsPerEnd` INTEGER NOT NULL, `revision` INTEGER NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE UNIQUE INDEX IF NOT EXISTS `index_blocks_sessionId_ordinal` ON `blocks` (`sessionId`, `ordinal`)",
  "CREATE TABLE IF NOT EXISTS `ends` (`id` TEXT NOT NULL, `blockId` TEXT NOT NULL, `ordinal` INTEGER NOT NULL, `plannedCount` INTEGER NOT NULL, `role` TEXT NOT NULL, `state` TEXT NOT NULL, `createdAtMs` INTEGER, `closedAtMs` INTEGER, `revision` INTEGER NOT NULL, `startsRound` INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(`id`), FOREIGN KEY(`blockId`) REFERENCES `blocks`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE UNIQUE INDEX IF NOT EXISTS `index_ends_blockId_ordinal` ON `ends` (`blockId`, `ordinal`)",
  "CREATE TABLE IF NOT EXISTS `shots` (`id` TEXT NOT NULL, `endId` TEXT NOT NULL, `inputIndex` INTEGER NOT NULL, `points` INTEGER NOT NULL, `zoneCode` TEXT, `automaticPoints` INTEGER, `automaticRuleVersion` TEXT, `x` REAL, `y` REAL, `faceId` TEXT, `scoreSource` TEXT NOT NULL, `positionSource` TEXT NOT NULL, `positionStatus` TEXT NOT NULL, `physicalArrowNumber` INTEGER, `createdAtMs` INTEGER NOT NULL, `updatedAtMs` INTEGER, `revision` INTEGER NOT NULL, `shaftDiameterMm` REAL DEFAULT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`endId`) REFERENCES `ends`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE UNIQUE INDEX IF NOT EXISTS `index_shots_endId_inputIndex` ON `shots` (`endId`, `inputIndex`)",
  "CREATE TABLE IF NOT EXISTS `unscored_counts` (`endId` TEXT NOT NULL, `count` INTEGER NOT NULL, `createdAtMs` INTEGER NOT NULL, `updatedAtMs` INTEGER NOT NULL, `revision` INTEGER NOT NULL, PRIMARY KEY(`endId`), FOREIGN KEY(`endId`) REFERENCES `ends`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE TABLE IF NOT EXISTS `mutation_receipts` (`operationId` TEXT NOT NULL, `sessionId` TEXT NOT NULL, `kind` TEXT NOT NULL, `payloadHash` TEXT NOT NULL, `resultId` TEXT NOT NULL, `resultRevision` INTEGER NOT NULL, `appliedAtMs` INTEGER NOT NULL, PRIMARY KEY(`operationId`))",
  "CREATE TABLE IF NOT EXISTS `import_batches` (`id` TEXT NOT NULL, `source` TEXT NOT NULL, `fileHash` TEXT NOT NULL, `parserVersion` TEXT NOT NULL, `importedAtMs` INTEGER NOT NULL, `sourceName` TEXT, `rawSourcePath` TEXT NOT NULL, `status` TEXT NOT NULL, PRIMARY KEY(`id`))",
  "CREATE UNIQUE INDEX IF NOT EXISTS `index_import_batches_fileHash` ON `import_batches` (`fileHash`)",
  "CREATE TABLE IF NOT EXISTS `imported_groups` (`id` TEXT NOT NULL, `batchId` TEXT NOT NULL, `sourceGroupKey` TEXT NOT NULL, `rawFingerprint` TEXT NOT NULL, `sessionId` TEXT NOT NULL, `mappingVersion` TEXT NOT NULL, `mappingJson` TEXT NOT NULL, `importOperationId` TEXT NOT NULL, `firstRecord` INTEGER NOT NULL, `lastRecord` INTEGER NOT NULL, `endFingerprintsJson` TEXT NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`batchId`) REFERENCES `import_batches`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE UNIQUE INDEX IF NOT EXISTS `index_imported_groups_sessionId` ON `imported_groups` (`sessionId`)",
  "CREATE TABLE IF NOT EXISTS `imported_rows` (`batchId` TEXT NOT NULL, `sourceRecord` INTEGER NOT NULL, `shotId` TEXT NOT NULL, `groupId` TEXT NOT NULL, PRIMARY KEY(`batchId`, `sourceRecord`), FOREIGN KEY(`batchId`) REFERENCES `import_batches`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`groupId`) REFERENCES `imported_groups`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE TABLE IF NOT EXISTS `imported_end_sources` (`endId` TEXT NOT NULL, `batchId` TEXT NOT NULL, `sourceKey` TEXT NOT NULL, `rawNumber` TEXT NOT NULL, `rawTimestamp` TEXT NOT NULL, `localTime` TEXT, PRIMARY KEY(`endId`), FOREIGN KEY(`endId`) REFERENCES `ends`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`batchId`) REFERENCES `import_batches`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE TABLE IF NOT EXISTS `progress_baselines` (`blockId` TEXT NOT NULL, `baselineId` TEXT NOT NULL, `policyVersion` TEXT NOT NULL, `frozenAtMs` INTEGER NOT NULL, `sessionStartCutoffMs` INTEGER, `conditionsJson` TEXT, `maximumPerArrow` INTEGER, `status` TEXT NOT NULL, `sourceSessionsJson` TEXT NOT NULL, `scoredCount` INTEGER NOT NULL, `scoreSum` INTEGER NOT NULL, PRIMARY KEY(`blockId`), FOREIGN KEY(`blockId`) REFERENCES `blocks`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE UNIQUE INDEX IF NOT EXISTS `index_progress_baselines_baselineId` ON `progress_baselines` (`baselineId`)",
  "CREATE TABLE IF NOT EXISTS `session_plans` (`sessionId` TEXT NOT NULL, `plannedEnds` INTEGER NOT NULL, `roundCount` INTEGER NOT NULL DEFAULT 1, `rolling` INTEGER NOT NULL DEFAULT 0, `roundArrowLimit` INTEGER DEFAULT NULL, PRIMARY KEY(`sessionId`), FOREIGN KEY(`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE TABLE IF NOT EXISTS `technique_documents` (`id` TEXT NOT NULL, `draftJson` TEXT NOT NULL, `updatedAtMs` INTEGER NOT NULL, `archived` INTEGER NOT NULL, `isPrimary` INTEGER NOT NULL, PRIMARY KEY(`id`))",
  "CREATE TABLE IF NOT EXISTS `technique_versions` (`id` TEXT NOT NULL, `documentId` TEXT NOT NULL, `number` INTEGER NOT NULL, `createdAtMs` INTEGER NOT NULL, `payloadJson` TEXT NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`documentId`) REFERENCES `technique_documents`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE UNIQUE INDEX IF NOT EXISTS `index_technique_versions_documentId_number` ON `technique_versions` (`documentId`, `number`)",
  "CREATE TABLE IF NOT EXISTS `technique_uses` (`id` TEXT NOT NULL, `sessionId` TEXT NOT NULL, `versionId` TEXT, `sequence` INTEGER NOT NULL, `blockOrdinal` INTEGER NOT NULL, `endOrdinal` INTEGER NOT NULL, `focus1` TEXT NOT NULL, `focus2` TEXT NOT NULL, `createdAtMs` INTEGER NOT NULL, `worked` TEXT NOT NULL, `question` TEXT NOT NULL, `rating` TEXT, `revision` INTEGER NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`versionId`) REFERENCES `technique_versions`(`id`) ON UPDATE NO ACTION ON DELETE NO ACTION )",
  "CREATE UNIQUE INDEX IF NOT EXISTS `index_technique_uses_sessionId_sequence` ON `technique_uses` (`sessionId`, `sequence`)",
  "CREATE TABLE IF NOT EXISTS `rank_assignments` (`id` TEXT NOT NULL, `discipline` TEXT NOT NULL, `category` TEXT NOT NULL, `level` TEXT NOT NULL, `assignedOn` TEXT, `issuedBy` TEXT NOT NULL, `reference` TEXT NOT NULL, `current` INTEGER NOT NULL, `createdAtMs` INTEGER NOT NULL, `updatedAtMs` INTEGER NOT NULL, `revision` INTEGER NOT NULL, `deletedAtMs` INTEGER, PRIMARY KEY(`id`))",
  "CREATE TABLE IF NOT EXISTS `diary_notes` (`id` TEXT NOT NULL, `sessionId` TEXT, `blockId` TEXT, `endId` TEXT, `localDate` TEXT NOT NULL, `body` TEXT NOT NULL, `tagsJson` TEXT NOT NULL, `place` TEXT NOT NULL, `feeling` TEXT NOT NULL, `conditions` TEXT NOT NULL, `createdAtMs` INTEGER NOT NULL, `updatedAtMs` INTEGER NOT NULL, `revision` INTEGER NOT NULL, `deletedAtMs` INTEGER, PRIMARY KEY(`id`), FOREIGN KEY(`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL , FOREIGN KEY(`blockId`) REFERENCES `blocks`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL , FOREIGN KEY(`endId`) REFERENCES `ends`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL )",
  "CREATE TABLE IF NOT EXISTS `achievement_enrollments` (`sessionId` TEXT NOT NULL, `enrolledAtMs` INTEGER NOT NULL, `localDate` TEXT NOT NULL, `ruleIdsJson` TEXT NOT NULL, `rankCategory` TEXT, PRIMARY KEY(`sessionId`), FOREIGN KEY(`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE TABLE IF NOT EXISTS `achievement_grants` (`key` TEXT NOT NULL, `ruleId` TEXT NOT NULL, `scope` TEXT NOT NULL, `ruleVersion` INTEGER NOT NULL, `title` TEXT NOT NULL, `flavor` TEXT NOT NULL, `description` TEXT NOT NULL, `family` TEXT NOT NULL, `rarity` INTEGER NOT NULL, `priority` INTEGER NOT NULL, `sessionId` TEXT, `endId` TEXT, `sourceDate` TEXT, `earnedAtMs` INTEGER NOT NULL, `batchId` TEXT NOT NULL, `notifiedAtMs` INTEGER, `valid` INTEGER NOT NULL, PRIMARY KEY(`key`))",
  "CREATE TABLE IF NOT EXISTS `personal_record_events` (`id` TEXT NOT NULL, `sessionId` TEXT NOT NULL, `kind` TEXT NOT NULL, `ruleVersion` INTEGER NOT NULL, `label` TEXT NOT NULL, `previousValue` INTEGER NOT NULL, `value` INTEGER NOT NULL, `previousSessionId` TEXT NOT NULL, `sessionRevision` INTEGER NOT NULL, `recordedAtMs` INTEGER NOT NULL, `notifiedAtMs` INTEGER, PRIMARY KEY(`id`), FOREIGN KEY(`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
  "CREATE TABLE IF NOT EXISTS `equipment_items` (`id` TEXT NOT NULL, `kind` TEXT NOT NULL, `name` TEXT NOT NULL, `category` TEXT, `model` TEXT, `notes` TEXT, `drawWeightLb` REAL, `drawLengthIn` REAL, `spine` INTEGER, `lengthMm` REAL, `massGrain` REAL, `diameterMm` REAL, `numberedCount` INTEGER, `bowId` TEXT, `arrowsId` TEXT, `favorite` INTEGER NOT NULL, `archived` INTEGER NOT NULL, `revision` INTEGER NOT NULL, `createdAtMs` INTEGER NOT NULL, `updatedAtMs` INTEGER NOT NULL, PRIMARY KEY(`id`))",
  "CREATE TABLE IF NOT EXISTS `equipment_revisions` (`itemId` TEXT NOT NULL, `revision` INTEGER NOT NULL, `snapshotJson` TEXT NOT NULL, `changedAtMs` INTEGER NOT NULL, PRIMARY KEY(`itemId`, `revision`))",
];

// SQL predicates from Android ArchiveFacts.validate(). SQLite preserves its nullable predicate semantics.
const sqlChecks: [string, string][] = [
  ["SELECT 1 FROM achievement_enrollments WHERE enrolledAtMs<0 OR (rankCategory IS NOT NULL AND rankCategory NOT IN ('male','female')) LIMIT 1", "invalid_achievement_enrollment"],
  ["SELECT 1 FROM achievement_enrollments a JOIN sessions s ON s.id=a.sessionId WHERE s.sourceKind<>'native' OR s.timeSource<>'app_clock' OR a.enrolledAtMs<>s.createdAtMs LIMIT 1", "invalid_achievement_enrollment"],
  ["SELECT 1 FROM achievement_grants WHERE ruleVersion<1 OR rarity NOT BETWEEN 0 AND 5 OR priority<0 OR earnedAtMs<0 OR notifiedAtMs<0 OR valid NOT IN (0,1) OR trim(title)='' OR trim(family)='' OR trim(scope)='' OR trim(batchId)='' OR length(batchId)>128 OR `key`<>ruleId||':'||scope LIMIT 1", "invalid_achievement_grant"],
  ["SELECT 1 FROM personal_record_events r JOIN sessions s ON s.id=r.sessionId\n            WHERE r.kind NOT IN ('series','volume','rank') OR r.ruleVersion<>1 OR trim(r.label)=''\n            OR r.previousValue<0 OR r.value<=r.previousValue OR r.value>2147483647\n            OR length(trim(r.previousSessionId))=0 OR length(r.previousSessionId)>128 OR r.previousSessionId=r.sessionId\n            OR s.sourceKind<>'native' OR r.sessionRevision<1 OR r.sessionRevision>s.revision\n            OR r.recordedAtMs<0 OR r.notifiedAtMs<0 LIMIT 1", "invalid_personal_record_event"],
  ["SELECT 1 FROM sessions WHERE revision<1 OR trim(title)='' OR state NOT IN ('active','paused','completed') OR kind<>'training' OR sourceKind NOT IN ('native','mytargets') OR timeSource NOT IN ('app_clock','legacy_app_clock','source_date_only','import_unknown') OR (deletedAtMs IS NOT NULL AND state='active') LIMIT 1", "invalid_session"],
  ["SELECT 1 FROM sessions WHERE numberedArrows NOT IN (0,1) LIMIT 1", "invalid_numbered_arrows"],
  ["SELECT 1 FROM ends WHERE startsRound NOT IN (0,1) LIMIT 1", "invalid_round_boundary"],
  ["SELECT 1 FROM sessions WHERE state='active' AND deletedAtMs IS NULL LIMIT 1 OFFSET 1", "multiple_active_sessions"],
  ["SELECT 1 FROM blocks WHERE revision<1 OR ordinal<0 OR mode NOT IN ('scored','count_only') OR defaultArrowsPerEnd NOT BETWEEN 1 AND 12 OR distanceMeters<=0 OR targetDiameterMm<=0 OR targetProfileVersion<1 OR (mode='scored' AND (targetSnapshotJson IS NULL OR targetProfileId IS NULL OR targetProfileVersion IS NULL)) LIMIT 1", "invalid_block"],
  ["SELECT 1 FROM sessions s LEFT JOIN blocks b ON b.sessionId=s.id WHERE b.id IS NULL LIMIT 1", "session_without_block"],
  ["SELECT 1 FROM ends e JOIN blocks b ON b.id=e.blockId LEFT JOIN session_plans p ON p.sessionId=b.sessionId WHERE e.revision<1 OR e.ordinal<0 OR e.plannedCount NOT BETWEEN 1 AND CASE WHEN p.rolling=1 THEN 1000000 ELSE 12 END OR role NOT IN ('scored','warmup') OR state NOT IN ('open','closed') LIMIT 1", "invalid_end"],
  ["SELECT 1 FROM blocks b JOIN sessions s ON s.id=b.sessionId LEFT JOIN ends e ON e.blockId=b.id WHERE e.id IS NULL AND s.state<>'completed' AND b.ordinal=(SELECT MAX(latest.ordinal) FROM blocks latest WHERE latest.sessionId=s.id) LIMIT 1", "block_without_end"],
  ["SELECT 1 FROM shots WHERE revision<1 OR inputIndex<0 OR points NOT BETWEEN 0 AND 10 OR automaticPoints NOT BETWEEN 0 AND 10 OR (x IS NULL)!=(y IS NULL) OR physicalArrowNumber<=0 OR scoreSource NOT IN ('target_computed','numeric_entry','manual_edit','imported') OR positionSource NOT IN ('manual_target','manual_photo','imported','none') OR positionStatus NOT IN ('known','unknown','unverified') OR (positionStatus='unknown' AND x IS NOT NULL) OR (positionStatus IN ('known','unverified') AND (x IS NULL OR positionSource='none')) OR (zoneCode IS NOT NULL AND zoneCode<>CASE WHEN points=0 THEN 'M' ELSE CAST(points AS TEXT) END AND NOT(zoneCode='X' AND points=10)) LIMIT 1", "invalid_shot"],
  ["SELECT 1 FROM shots s JOIN ends e ON e.id=s.endId JOIN blocks b ON b.id=e.blockId WHERE b.mode<>'scored' LIMIT 1", "shot_in_count_mode"],
  ["SELECT 1 FROM shots WHERE shaftDiameterMm NOT BETWEEN 1 AND 20 OR (shaftDiameterMm IS NOT NULL AND (positionStatus<>'known' OR x IS NULL)) LIMIT 1", "invalid_shaft_diameter"],
  ["SELECT 1 FROM shots GROUP BY endId HAVING MIN(inputIndex)<>0 OR MAX(inputIndex)<>COUNT(*)-1 LIMIT 1", "invalid_shot_order"],
  ["SELECT 1 FROM unscored_counts c JOIN ends e ON e.id=c.endId JOIN blocks b ON b.id=e.blockId WHERE c.revision<1 OR c.count<0 OR c.count>e.plannedCount OR b.mode<>'count_only' LIMIT 1", "invalid_count"],
  ["SELECT 1 FROM ends e JOIN shots s ON s.endId=e.id GROUP BY e.id HAVING COUNT(*)>e.plannedCount LIMIT 1", "overfilled_end"],
  ["SELECT 1 FROM mutation_receipts WHERE resultRevision<1 OR length(payloadHash)<>64 OR length(kind)=0 LIMIT 1", "invalid_receipt"],
  ["SELECT 1 FROM diary_notes WHERE revision<1 OR length(body)>8000 OR length(place)>120 OR length(feeling)>240 OR length(conditions)>500 OR (blockId IS NOT NULL AND sessionId IS NULL) OR (endId IS NOT NULL AND blockId IS NULL) LIMIT 1", "invalid_diary_note"],
  ["SELECT 1 FROM diary_notes n JOIN blocks b ON b.id=n.blockId WHERE n.sessionId<>b.sessionId LIMIT 1", "invalid_note_block_link"],
  ["SELECT 1 FROM diary_notes n JOIN ends e ON e.id=n.endId WHERE n.blockId<>e.blockId LIMIT 1", "invalid_note_end_link"],
  ["SELECT 1 FROM rank_assignments WHERE revision<1 OR discipline NOT IN ('recurve','barebow','compound','3d-recurve','3d-compound','3d-traditional','3d-longbow') OR category NOT IN ('male','female') OR level NOT IN ('III юн.','II юн.','I юн.','III','II','I','КМС','МС','МСМК') OR current NOT IN (0,1) OR length(issuedBy)>120 OR length(reference)>500 OR (deletedAtMs IS NOT NULL AND current<>0) LIMIT 1", "invalid_rank_assignment"],
  ["SELECT 1 FROM rank_assignments WHERE current=1 AND deletedAtMs IS NULL GROUP BY discipline,category HAVING COUNT(*)>1", "multiple_current_rank_assignments"],
  ["SELECT 1 FROM import_batches WHERE source<>'mytargets' OR status<>'committed' OR length(fileHash)<>64 LIMIT 1", "invalid_import_batch"],
  ["SELECT 1 FROM imported_groups WHERE firstRecord<1 OR lastRecord<firstRecord OR length(rawFingerprint)<>64 LIMIT 1", "invalid_import_group"],
  ["SELECT 1 FROM imported_rows r JOIN imported_groups g ON g.id=r.groupId WHERE r.batchId<>g.batchId OR r.sourceRecord<g.firstRecord OR r.sourceRecord>g.lastRecord LIMIT 1", "invalid_import_row_relationship"],
  ["SELECT 1 FROM equipment_items WHERE revision<1 OR length(id)=0 OR trim(name)='' OR kind NOT IN ('bow','arrows','setup') OR favorite NOT IN (0,1) OR archived NOT IN (0,1) OR (favorite=1 AND archived=1) OR drawWeightLb<=0 OR drawLengthIn<=0 OR spine<=0 OR lengthMm<=0 OR massGrain<=0 OR diameterMm<=0 OR numberedCount NOT BETWEEN 1 AND 1000 OR (kind<>'setup' AND (bowId IS NOT NULL OR arrowsId IS NOT NULL)) OR (category IS NOT NULL AND (kind<>'bow' OR category NOT IN ('barebow','recurve','compound','traditional','longbow','other'))) LIMIT 1", "invalid_equipment"],
  ["SELECT 1 FROM equipment_items s LEFT JOIN equipment_items b ON b.id=s.bowId LEFT JOIN equipment_items a ON a.id=s.arrowsId WHERE (s.bowId IS NOT NULL AND (b.id IS NULL OR b.kind<>'bow')) OR (s.arrowsId IS NOT NULL AND (a.id IS NULL OR a.kind<>'arrows')) LIMIT 1", "broken_equipment_relationship"],
  ["SELECT 1 FROM equipment_items i LEFT JOIN equipment_revisions r ON r.itemId=i.id AND r.revision=i.revision WHERE r.itemId IS NULL LIMIT 1", "missing_equipment_revision"],
  ["SELECT 1 FROM equipment_revisions r LEFT JOIN equipment_items i ON i.id=r.itemId WHERE i.id IS NULL OR r.revision<1 OR r.revision>i.revision LIMIT 1", "invalid_equipment_revision"],
  ["SELECT 1 FROM session_plans WHERE rolling NOT IN (0,1) OR plannedEnds NOT BETWEEN CASE WHEN rolling=1 THEN 0 ELSE 1 END AND 200 OR roundCount NOT BETWEEN 1 AND 20 OR plannedEnds % roundCount <> 0 OR (roundArrowLimit IS NOT NULL AND (rolling<>1 OR plannedEnds<>0 OR roundCount<>1 OR roundArrowLimit NOT BETWEEN 1 AND 1000000)) LIMIT 1", "invalid_session_plan"],
  ["SELECT 1 FROM technique_documents WHERE archived NOT IN (0,1) OR isPrimary NOT IN (0,1) OR (archived=1 AND isPrimary=1) LIMIT 1", "invalid_technique_document"],
  ["SELECT 1 FROM technique_documents WHERE isPrimary=1 LIMIT 1 OFFSET 1", "multiple_primary_techniques"],
  ["SELECT 1 FROM technique_documents d WHERE isPrimary=1 AND NOT EXISTS(SELECT 1 FROM technique_versions v WHERE v.documentId=d.id) LIMIT 1", "unpublished_primary_technique"],
  ["SELECT 1 FROM technique_versions WHERE number<1 LIMIT 1", "invalid_technique_version"],
  ["SELECT 1 FROM technique_versions GROUP BY documentId HAVING MIN(number)<>1 OR MAX(number)<>COUNT(*) LIMIT 1", "invalid_technique_version_order"],
  ["SELECT 1 FROM technique_uses WHERE sequence<1 OR blockOrdinal<0 OR endOrdinal<0 OR length(focus1)>200 OR length(focus2)>200 OR length(worked)>4000 OR length(question)>4000 OR revision<1 OR rating NOT IN ('yes','unstable','untracked') LIMIT 1", "invalid_technique_use"],
];

export type NativeFactsContext = {
  parseJson(text: string): NativeJson;
  integerToken(row: object, column: string): boolean;
};

function object(value: NativeJson): NativeArchiveRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('expected_object');
  return value;
}
function exact(row: NativeArchiveRow, names: string[]) {
  if (Object.keys(row).length !== names.length || names.some(name => !Object.hasOwn(row, name))) bad('unexpected_json_fields');
}
function json(row: NativeArchiveRow, key: string, context: NativeFactsContext): NativeJson {
  const text = row[key];
  if (typeof text !== 'string') return bad('invalid_text_column');
  return context.parseJson(text);
}
function long(row: NativeArchiveRow, key: string, context: NativeFactsContext): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || !context.integerToken(row, key)) return bad(`invalid_integer_${key}`);
  return value;
}
function string(row: NativeArchiveRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') return bad(`invalid_string_${key}`);
  return value;
}
function nativeDate(value: unknown, canonical = false): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}|[+-]\d{4,10})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || match[0] !== value) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (Math.abs(year) > 999999999 || match[1][0] === '+' && match[1].length < 6 || match[1][0] === '-' && year === 0) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  const expected = year < 0 ? `-${Math.abs(year).toString().padStart(4, '0')}` : year > 9999 ? `+${year}` : year.toString().padStart(4, '0');
  return !canonical || match[1] === expected;
}
function checkZone(value: string, unverified: Set<string>) {
  if (['Z', 'UTC', 'GMT', 'UT'].includes(value)) return;
  const offset = /^(?:UTC|GMT|UT)?([+-])(\d{1,2})(?::?(\d{2}))?(?::?(\d{2}))?$/.exec(value);
  if (offset) {
    const hour = Number(offset[2]), minute = Number(offset[3] ?? 0), second = Number(offset[4] ?? 0);
    if (hour > 18 || minute > 59 || second > 59 || hour === 18 && (minute || second)) bad('invalid_session_date');
    return;
  }
  if (!/^[A-Za-z][A-Za-z0-9~/._+\-]+$/.test(value)) bad('invalid_session_date');
  // Java/Android and the browser ship different IANA registries; syntax alone cannot prove membership.
  unverified.add('java-zone-id-registry');
}
function defaultsFor(name: string, version: number): Record<string, number | null> {
  if (name === 'session_plans') return {
    ...(version < 7 ? { roundCount: 1 } : {}), ...(version < 11 ? { rolling: 0 } : {}), ...(version < 16 ? { roundArrowLimit: null } : {}),
  };
  if (name === 'sessions' && version < 13) return { numberedArrows: null };
  if (name === 'ends' && version < 14) return { startsRound: 0 };
  if (name === 'shots' && version < 15) return { shaftDiameterMm: null };
  return {};
}

function restore(db: Database, tables: Record<string, NativeArchiveRow[]>, version: number, context: NativeFactsContext) {
  const restored: Record<string, NativeArchiveRow[]> = Object.create(null);
  db.run('BEGIN');
  for (const [path, rows] of Object.entries(tables)) {
    restored[path] = [];
    const name = path.slice(path.lastIndexOf('/') + 1, -6);
    const columns = db.exec(`PRAGMA table_info(\`${name}\`)`)[0]?.values;
    if (!columns) bad('unsupported_table');
    const defaults = defaultsFor(name, version);
    const names = columns.map(column => String(column[1]));
    const sourceNames = names.filter(column => !Object.hasOwn(defaults, column));
    const statement = db.prepare(`INSERT INTO \`${name}\` (${names.map(column => `\`${column}\``).join(',')}) VALUES (${names.map(() => '?').join(',')})`);
    try {
      for (const row of rows) {
        exact(row, sourceNames);
        const values = columns.map(column => {
          const key = String(column[1]), type = column[2], value = Object.hasOwn(defaults, key) ? defaults[key] : row[key];
          if (value === null) {
            if (column[3] || column[5]) bad('missing_required_column');
            return null;
          }
          if (type === 'TEXT' && typeof value === 'string') return value;
          if (type === 'REAL' && typeof value === 'number' && Number.isFinite(value)) return value;
          if (type === 'INTEGER' && typeof value === 'number' && Number.isSafeInteger(value) &&
            (Object.hasOwn(defaults, key) || context.integerToken(row, key))) return value;
          return bad(type === 'TEXT' ? 'invalid_text_column' : type === 'INTEGER' ? 'invalid_integer_column' : 'invalid_real_column');
        });
        try { statement.run(values); } catch { bad('archive_fact_constraint'); }
        restored[path].push(Object.fromEntries(names.map((name, index) => [name, values[index]])));
      }
    } finally { statement.free(); }
  }
  db.run('COMMIT; PRAGMA query_only=ON;');
  if (db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') bad('database_integrity');
  if (db.exec('PRAGMA foreign_key_check').some(result => result.values.length)) bad('broken_relationship');
  return restored;
}

function validateTechnique(text: string, draft: boolean, context: NativeFactsContext) {
  const row = object(context.parseJson(text));
  if (row.schema !== 1 || typeof row.title !== 'string' || row.title.length > 100 || !draft && !row.title.trim() ||
    typeof row.context !== 'string' || row.context.length > 200 || typeof row.description !== 'string' || row.description.length > 4000 ||
    typeof row.change !== 'string' || row.change.length > 1000 || !Array.isArray(row.phases) || row.phases.length > 30 ||
    row.discussed !== null && !nativeDate(row.discussed)) bad('invalid_technique_payload');
  const phases = row.phases as NativeJson[], phaseIds = new Set<string>();
  for (const raw of phases) {
    const phase = object(raw), id = string(phase, 'id');
    if (!id.trim() || phaseIds.has(id) || typeof phase.title !== 'string' || phase.title.length > 100 ||
      !Array.isArray(phase.steps) || phase.steps.length > 50) bad('invalid_technique_payload');
    phaseIds.add(id);
    const stepIds = new Set<string>();
    for (const rawStep of phase.steps as NativeJson[]) {
      const step = object(rawStep), stepId = string(step, 'id');
      if (!stepId.trim() || stepIds.has(stepId) || typeof step.visible !== 'boolean') bad('invalid_technique_payload');
      stepIds.add(stepId);
      for (const [key, max] of [['short', 200], ['detail', 4000], ['children', 4000], ['question', 1000]] as const) {
        if (typeof step[key] !== 'string' || (step[key] as string).length > max) bad('invalid_technique_payload');
      }
    }
  }
}

function validateBaselines(rows: NativeArchiveRow[], byBlock: Map<NativeJson, NativeArchiveRow>, context: NativeFactsContext) {
  for (const row of rows) {
    if (row.policyVersion !== 'progress-pg1-v1' || !['ready', 'building', 'unknown_conditions'].includes(String(row.status))) bad('invalid_progress_policy');
    const sources = json(row, 'sourceSessionsJson', context);
    if (!Array.isArray(sources) || sources.length > 5) bad('invalid_progress_sources');
    const ids = new Set<string>();
    let count = 0, sum = 0;
    for (const raw of sources as NativeJson[]) {
      const source = object(raw);
      exact(source, ['sessionId', 'revision', 'title', 'count', 'sum', 'startedAtMs', 'completedAtMs', 'sourceKind']);
      const id = string(source, 'sessionId'), sourceCount = long(source, 'count', context), sourceSum = long(source, 'sum', context);
      if (!id.trim() || ids.has(id) || long(source, 'revision', context) < 1 || sourceCount < 12 || sourceCount > 2147483647 ||
        sourceSum < 0 || sourceSum > sourceCount * 10 || long(source, 'completedAtMs', context) >= Number(row.sessionStartCutoffMs ?? 0)) bad('invalid_progress_source');
      ids.add(id); count += sourceCount; sum += sourceSum;
    }
    if (count !== row.scoredCount || sum !== row.scoreSum || count > 2147483647 ||
      row.sessionStartCutoffMs !== null && Number(row.frozenAtMs) < Number(row.sessionStartCutoffMs)) bad('invalid_progress_aggregate');
    if (row.status === 'unknown_conditions') {
      if ((sources as NativeJson[]).length || row.conditionsJson !== null || row.maximumPerArrow !== null) bad('invalid_progress_unknown');
      continue;
    }
    if (row.conditionsJson === null || row.sessionStartCutoffMs === null || row.maximumPerArrow !== 10 ||
      (row.status === 'ready') !== ((sources as NativeJson[]).length >= 3)) bad('invalid_progress_state');
    if (ids.has(String(byBlock.get(row.blockId)?.sessionId))) bad('progress_includes_current_session');
    const conditions = object(json(row, 'conditionsJson', context));
    exact(conditions, ['distanceMeters', 'diameterMm', 'profileId', 'profileVersion', 'geometry', 'rule', 'maximumPerArrow', 'bowCategory']);
    const profile = typeof conditions.profileId === 'string' ? getTargetProfile(conditions.profileId) : undefined;
    const rules = new Map<string, string>([
      ['practice-full-10-v1', 'practice-point-10-v1'], ['wa-outdoor-full-v1', 'wa-outdoor-point-v1'],
      ['wa-indoor-outer-v1', 'wa-indoor-outer-point-v1'], ['wa-indoor-inner-v1', 'wa-indoor-inner-point-v1'],
      ['wa-outdoor-six-v1', 'wa-outdoor-six-point-v1'], ['wa-indoor-five-outer-v1', 'wa-indoor-five-outer-point-v1'],
      ['wa-indoor-five-inner-v1', 'wa-indoor-five-inner-point-v1'],
    ]);
    if (!profile || long(conditions, 'maximumPerArrow', context) !== 10 || long(conditions, 'profileVersion', context) !== 1 ||
      conditions.geometry !== 'single-circle-main' || conditions.rule !== rules.get(profile.id) ||
      !BOW_CATEGORIES.some(category => category.value === conditions.bowCategory)) bad('invalid_progress_conditions');
  }
}

function validateJsonFacts(tables: Record<string, NativeArchiveRow[]>, context: NativeFactsContext, unverified: Set<string>) {
  const table = (name: string) => tables[`data/journal/${name}.jsonl`] ?? [];
  const byBlock = new Map(table('blocks').map(row => [row.id, row]));
  const byEnd = new Map(table('ends').map(row => [row.id, row]));
  const bySession = new Map(table('sessions').map(row => [row.id, row]));
  const importedShots = new Set(table('imported_rows').map(row => row.shotId));
  for (const row of table('sessions')) {
    if (row.localDate !== null && !nativeDate(row.localDate)) bad('invalid_session_date');
    if (typeof row.timeZoneId === 'string') checkZone(row.timeZoneId, unverified);
  }
  const targets = new Map<NativeJson, NativeArchiveRow>();
  for (const row of table('blocks')) {
    if (row.targetSnapshotJson !== null) targets.set(row.id, object(json(row, 'targetSnapshotJson', context)));
    if (row.equipmentSnapshotJson !== null) object(json(row, 'equipmentSnapshotJson', context));
    if (row.mode === 'scored') {
      const known = typeof row.targetProfileId === 'string' && getTargetProfile(row.targetProfileId);
      if (known && !nativeTargetIsMapped(row)) bad('invalid_target_geometry');
      if (!known) unverified.add('unknown-target-geometry');
    }
  }
  for (const row of table('shots')) {
    const block = byBlock.get(byEnd.get(row.endId)!.blockId)!;
    const profile = typeof block.targetProfileId === 'string' ? getTargetProfile(block.targetProfileId) : undefined;
    if (profile && row.points !== 0 && !profile.zones.some(zone => zone.points === row.points)) bad('unsupported_target_score');
    if (row.zoneCode === 'X') {
      const target = targets.get(block.id)!;
      const source = target.sourceTargetSnapshot;
      const retained = row.scoreSource === 'imported' && bySession.get(block.sessionId)!.sourceKind === 'mytargets' &&
        importedShots.has(row.id) && source && typeof source === 'object' && !Array.isArray(source) &&
        source.supportsX === true && source.scoringRuleVersion === 'mytargets-source-scores-v1';
      if (target.supportsX !== true && !retained) bad('unsupported_x_zone');
    }
    if (row.shaftDiameterMm !== null) {
      if (!nativeTargetIsMapped(block) || typeof row.shaftDiameterMm !== 'number' || row.shaftDiameterMm < 1 || row.shaftDiameterMm > 20 ||
        typeof row.x !== 'number' || typeof row.y !== 'number') bad('invalid_shaft_geometry');
      const zone = scorePoint({ x: Number(row.x), y: Number(row.y) }, { profileId: String(block.targetProfileId),
        diameterMm: Number(block.targetDiameterMm), shaftDiameterMm: Number(row.shaftDiameterMm) });
      const rule = targets.get(block.id)!.scoringRuleVersion;
      if (row.automaticPoints !== zone.points || row.automaticRuleVersion !== `${rule}:shaft-v1` ||
        row.scoreSource === 'target_computed' && (row.points !== zone.points || row.zoneCode !== zone.code)) bad('invalid_shaft_score');
    }
  }
  for (const row of table('diary_notes')) {
    const tags = json(row, 'tagsJson', context);
    if (String(row.tagsJson).length > 4096 || !Array.isArray(tags) || tags.length > 12 || tags.some(tag =>
      typeof tag !== 'string' || !tag.length || tag.length > 30 || tag !== tag.trim() || /[,\x00-\x1f]/.test(tag)) ||
      new Set((tags as string[]).map(tag => tag.toLowerCase())).size !== (tags as NativeJson[]).length) bad('invalid_note_tags');
    if (!nativeDate(row.localDate, true)) bad('invalid_note_date');
    if (!(tags as NativeJson[]).length && ['body', 'place', 'feeling', 'conditions'].every(key => !String(row[key]).trim())) bad('empty_diary_note');
  }
  for (const row of table('rank_assignments')) if (row.assignedOn !== null && !nativeDate(row.assignedOn, true)) bad('invalid_rank_assignment_date');
  for (const row of table('imported_groups')) {
    object(json(row, 'mappingJson', context));
    const fingerprints = json(row, 'endFingerprintsJson', context);
    if (!Array.isArray(fingerprints) || fingerprints.some(value => typeof value !== 'string' || !HASH.test(value))) bad('invalid_source_fingerprints');
  }
  for (const row of tables['data/equipment/equipment_revisions.jsonl'] ?? []) {
    const snapshot = object(json(row, 'snapshotJson', context));
    if (snapshot.id !== row.itemId || snapshot.revision !== row.revision || !context.integerToken(snapshot, 'revision')) bad('equipment_snapshot_mismatch');
  }
  for (const row of table('achievement_enrollments')) {
    if (!nativeDate(row.localDate)) bad('invalid_achievement_date');
    const ids = json(row, 'ruleIdsJson', context);
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length ||
      ids.some(value => typeof value !== 'string' || !/^[A-Z]+[0-9]{2}$/.test(value))) bad('invalid_achievement_rules');
  }
  for (const row of table('achievement_grants')) {
    if (typeof row.ruleId !== 'string' || !/^[A-Z]+[0-9]{2}$/.test(row.ruleId)) bad('invalid_achievement_grant');
    if (row.sourceDate !== null && !nativeDate(row.sourceDate)) bad('invalid_achievement_date');
  }
  for (const [name, column] of [['technique_documents', 'draftJson'], ['technique_versions', 'payloadJson']]) {
    for (const row of table(name)) {
      const text = string(row, column);
      if (text.length > 262144) bad('invalid_technique_payload');
      validateTechnique(text, name === 'technique_documents', context);
    }
  }
  validateBaselines(table('progress_baselines'), byBlock, context);
}

function validatePresets(text: string, context: NativeFactsContext) {
  if (new TextEncoder().encode(text).length > 512 * 1024) bad('invalid_training_presets');
  const root = object(context.parseJson(text)); exact(root, ['version', 'presets']);
  if (root.version !== 1 || !context.integerToken(root, 'version') || !Array.isArray(root.presets) || root.presets.length > 64) bad('invalid_training_presets');
  const ids = new Set<string>(), names = new Set<string>();
  for (const raw of root.presets as NativeJson[]) {
    const row = object(raw); exact(row, ['id', 'name', 'plan', 'revision']);
    const id = string(row, 'id'), name = string(row, 'name');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || ids.has(id) ||
      !name.length || name.length > 60 || name !== name.trim() || /[\x00-\x1f]/.test(name) || names.has(name.toLowerCase()) ||
      long(row, 'revision', context) < 1) bad('invalid_training_presets');
    ids.add(id); names.add(name.toLowerCase());
    const plan = object(json(row, 'plan', context));
    const arrows = long(plan, 'arrows', context), rounds = long(plan, 'rounds', context);
    if (plan.version !== 1 || !context.integerToken(plan, 'version') || arrows < 1 || arrows > 12 || rounds < 1 || rounds > 20 || typeof plan.target !== 'string') bad('invalid_training_presets');
    const nullableLong = (key: string) => plan[key] == null ? null : long(plan, key, context);
    const ends = nullableLong('ends'), series = nullableLong('seriesPerRound'), limit = nullableLong('roundArrowLimit'), diameter = nullableLong('diameter');
    if (plan.flexibleSeries !== undefined && typeof plan.flexibleSeries !== 'boolean' ||
      plan.numberedArrows != null && typeof plan.numberedArrows !== 'boolean' ||
      ends !== null && (ends < 1 || ends > 200 || ends % rounds !== 0) || ends === null && rounds !== 1 ||
      diameter !== null && (diameter < 1 || diameter > 2147483647) ||
      plan.distance != null && (typeof plan.distance !== 'number' || !Number.isFinite(plan.distance) || plan.distance <= 0) ||
      !['scored', 'count_only'].includes(String(plan.mode))) bad('invalid_training_presets');
    const flexible = plan.flexibleSeries === true;
    if (flexible ? ends !== null || rounds !== 1 || series !== null && (series < 1 || series > 200) : series !== null) bad('invalid_training_presets');
    if (limit !== null && (!flexible || series !== null || limit < 1 || limit > 1000000)) bad('invalid_training_presets');
    if (plan.mode === 'scored') {
      const profile = getTargetProfile(String(plan.target));
      if (!profile || plan.distance == null || diameter === null ||
        profile.diameters.length && !profile.diameters.includes(diameter)) bad('invalid_training_presets');
    }
    if (plan.equipment != null) {
      const snapshot = object(json(plan, 'equipment', context));
      if (!snapshot.selection || typeof snapshot.selection !== 'object' || Array.isArray(snapshot.selection) || snapshot.selection.kind !== 'setup') bad('invalid_training_presets');
    }
  }
}

function validatePreferences(preferences: NativeArchiveRow, context: NativeFactsContext) {
  if (long(preferences, 'format', context) !== 1) bad('unsupported_preferences_version');
  const values = object(preferences.values);
  for (const raw of Object.values(values)) {
    const row = object(raw);
    if (row.type === 'long' || row.type === 'int') {
      const value = long(row, 'value', context);
      if (row.type === 'int' && (value < -2147483648 || value > 2147483647)) bad('invalid_preference_value');
    }
  }
  const requiredTypes: Record<string, string> = {
    technique_home: 'boolean', technique_focus: 'boolean', technique_reflection: 'boolean', designStyle: 'string', appearanceMode: 'string',
    animationsEnabled: 'boolean', hapticsEnabled: 'boolean', soundEnabled: 'boolean', keepScreenAwake: 'boolean', displayName: 'string',
    onboardingCompletedVersion: 'int', onboardingDisposition: 'string', targetTutorialVersion: 'int',
  };
  for (const [key, raw] of Object.entries(values)) {
    const row = object(raw);
    if (requiredTypes[key] && row.type !== requiredTypes[key]) bad('invalid_known_preference_type');
    const allowed: Record<string, readonly string[]> = { designStyle: ['sport', 'pop', 'minimal'], appearanceMode: ['system', 'light', 'dark'],
      onboardingDisposition: ['completed', 'skipped', 'existing_user'], rank_category_v1: ['male', 'female'] };
    if (allowed[key] && (row.type !== 'string' || !allowed[key].includes(String(row.value)))) bad(key === 'rank_category_v1' ? 'invalid_rank_category' : 'invalid_known_preference_value');
    if (['onboardingCompletedVersion', 'targetTutorialVersion'].includes(key) && Number(row.value) < 0) bad('invalid_known_preference_value');
    if (['series_timer_seconds_v1', 'rest_timer_seconds_v1'].includes(key) && (row.type !== 'int' || Number(row.value) < 1 || Number(row.value) > 3600)) bad('invalid_timer_duration');
    if (key === 'hide_current_scores_v1' && row.type !== 'boolean') bad('invalid_score_visibility');
    if (key === 'show_achievements_v1' && row.type !== 'boolean') bad('invalid_achievements_visibility');
    if (key === 'shooting_base_minutes_v1' && (row.type !== 'long' || Number(row.value) < 0 || Number(row.value) > 59999999)) bad('invalid_shooting_base_minutes');
    if (key === 'training_presets_v1') {
      if (row.type !== 'string' || typeof row.value !== 'string') bad('invalid_training_presets');
      validatePresets(String(row.value), context);
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const updateCrc = (crc: number, bytes: Uint8Array) => {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
};

function gzipHeader(bytes: Uint8Array, start: number, end: number) {
  if (start + 18 > end || bytes[start] !== 31 || bytes[start + 1] !== 139 || bytes[start + 2] !== 8 || bytes[start + 3] & 0xe0) bad('invalid_import_source_gzip');
  const flags = bytes[start + 3], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = start + 10;
  if (flags & 4) {
    if (at + 2 > end - 8) bad('invalid_import_source_gzip');
    const length = view.getUint16(at, true); at += 2 + length;
  }
  for (const flag of [8, 16]) if (flags & flag) {
    while (at < end - 8 && bytes[at]) at++;
    if (at >= end - 8) bad('invalid_import_source_gzip');
    at++;
  }
  if (flags & 2) {
    if (at + 2 > end - 8 || ((updateCrc(0xffffffff, bytes.subarray(start, at)) ^ 0xffffffff) & 0xffff) !== view.getUint16(at, true)) bad('invalid_import_source_gzip');
    at += 2;
  }
  if (at >= end - 8) bad('invalid_import_source_gzip');
}

async function verifySources(tables: Record<string, NativeArchiveRow[]>, sources: Record<string, Uint8Array>) {
  for (const row of tables['data/journal/import_batches.jsonl'] ?? []) {
    const path = String(row.rawSourcePath).replace(/^imports\//, 'sources/'), compressed = sources[path];
    if (!compressed) bad('missing_import_source');
    let total = 0, memberSize = 0, memberStart = 0, crc = 0xffffffff;
    const members: { start: number; end: number; size: number; crc: number }[] = [], chunks: Uint8Array[] = [];
    const inflater = new Gunzip(chunk => {
      if (chunk.length > MAX_SOURCE_BYTES - total) bad('import_source_too_large');
      total += chunk.length; memberSize += chunk.length; crc = updateCrc(crc, chunk); chunks.push(chunk);
    });
    inflater.onmember = offset => {
      members.push({ start: memberStart, end: offset, size: memberSize, crc: (crc ^ 0xffffffff) >>> 0 });
      memberStart = offset; memberSize = 0; crc = 0xffffffff;
    };
    try {
      // Bound expansion per push as well as total size; no allocation trusts the gzip ISIZE field.
      for (let at = 0; at < compressed.length; at += 1024) inflater.push(compressed.subarray(at, at + 1024), at + 1024 >= compressed.length);
    } catch (error) {
      if (error instanceof Error && error.message === 'import_source_too_large') throw error;
      bad('invalid_import_source_gzip');
    }
    members.push({ start: memberStart, end: compressed.length, size: memberSize, crc: (crc ^ 0xffffffff) >>> 0 });
    const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    for (const member of members) {
      gzipHeader(compressed, member.start, member.end);
      if (view.getUint32(member.end - 8, true) !== member.crc || view.getUint32(member.end - 4, true) !== member.size) bad('invalid_import_source_gzip');
    }
    const output = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', output)), value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== row.fileHash) bad('import_source_checksum_mismatch');
  }
}

/** Restore into an isolated SQLite database, then apply Android ArchiveFacts and nested-source checks. */
export async function validateNativeBusinessFacts(tables: Record<string, NativeArchiveRow[]>, preferences: NativeArchiveRow,
  sources: Record<string, Uint8Array>, version: number, context: NativeFactsContext): Promise<{ unverified: string[] }> {
  const url = typeof window === 'undefined' ? undefined : (await import('sql.js/dist/sql-wasm.wasm?url')).default;
  const sqlite = await initSqlJs(url ? { locateFile: () => url } : undefined);
  const db = new sqlite.Database();
  const unverified = new Set<string>();
  try {
    db.run('PRAGMA foreign_keys=OFF; PRAGMA trusted_schema=OFF;');
    for (const sql of schema) db.run(sql);
    const restored = restore(db, tables, version, context);
    for (const [sql, reason] of sqlChecks) if (db.exec(sql).some(result => result.values.length)) bad(reason);
    const keys: Record<string, string> = { session_plans: 'sessionId', achievement_enrollments: 'sessionId', achievement_grants: 'key',
      progress_baselines: 'baselineId', mutation_receipts: 'operationId', unscored_counts: 'endId', imported_end_sources: 'endId', imported_rows: 'shotId' };
    for (const path of Object.keys(tables).filter(path => path.startsWith('data/journal/'))) {
      const table = path.slice(path.lastIndexOf('/') + 1, -6), key = keys[table] ?? 'id';
      if (db.exec(`SELECT 1 FROM \`${table}\` WHERE length(\`${key}\`)=0 OR length(\`${key}\`)>128 LIMIT 1`).length) bad('invalid_identifier');
    }
    validateJsonFacts(restored, context, unverified);
    validatePreferences(preferences, context);
    await verifySources(restored, sources);
    return { unverified: [...unverified].sort() };
  } finally { db.close(); }
}
