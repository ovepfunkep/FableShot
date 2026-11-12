import initSqlJs from 'sql.js';
export type MyTargetsSqlValue = string | number | null;
export type MyTargetsSqlRow = Record<string, MyTargetsSqlValue>;
export type MyTargetsTables = Record<string, MyTargetsSqlRow[]>;
export const MYTARGETS_COLUMNS: Record<string, readonly string[]> = {
  Training: ['id', 'title', 'date', 'standardRoundId', 'bowId', 'arrowId', 'indoor'],
  Round: ['id', 'trainingId', 'index', 'shotsPerEnd', 'distance', 'targetId', 'targetScoringStyleIndex', 'targetDiameter'],
  End: ['id', 'roundId', 'index', 'exact', 'saveTime', 'reachedPoints', 'shotCount'],
  Shot: ['id', 'endId', 'index', 'x', 'y', 'scoringRing', 'arrowNumber'],
  StandardRound: ['id', 'name'], Bow: ['id', 'name', 'type'], Arrow: ['id', 'name'],
};
const REQUIRED_FACTS: Record<string, readonly string[]> = {
  Training: ['title', 'date', 'indoor'],
  Round: ['trainingId', 'index', 'shotsPerEnd', 'distance', 'targetId', 'targetScoringStyleIndex', 'targetDiameter'],
  End: ['roundId', 'index', 'exact', 'reachedPoints', 'shotCount'],
  Shot: ['endId', 'index', 'x', 'y', 'scoringRing'],
};

/** In-memory query-only copy: no filesystem, source mutation, or application storage. */
export async function readMyTargetsDatabase(bytes: Uint8Array, wasmUrl?: string): Promise<MyTargetsTables> {
  if (bytes.length < 100 || bytes.length > 25 * 1024 * 1024 ||
    new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0') throw new Error('archive_database_corrupt');
  const url = wasmUrl ?? (typeof window === 'undefined' ? undefined :
    (await import('sql.js/dist/sql-wasm.wasm?url')).default);
  const sqlite = await initSqlJs(url ? { locateFile: () => url } : undefined);
  const db = new sqlite.Database(bytes);
  try {
    db.run('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    if (db.exec('PRAGMA user_version')[0]?.values[0]?.[0] !== 27) throw new Error('archive_schema_unsupported');
    if (db.exec('PRAGMA quick_check(1)')[0]?.values[0]?.[0] !== 'ok') throw new Error('archive_database_corrupt');
    if (db.exec('PRAGMA foreign_key_check').some(result => result.values.length)) throw new Error('archive_broken_relationship');
    const output: MyTargetsTables = {};
    for (const [table, required] of Object.entries(MYTARGETS_COLUMNS)) {
      const schema = db.exec(`SELECT type,sql FROM sqlite_master WHERE name='${table}'`);
      if (schema[0]?.values.length !== 1 || schema[0].values[0][0] !== 'table' ||
        typeof schema[0].values[0][1] !== 'string' || !/^\s*CREATE TABLE\b/i.test(schema[0].values[0][1])) throw new Error('archive_schema_unsupported');
      const columns = db.exec(`PRAGMA table_info(\`${table}\`)`)[0]?.values.map(row => row[1]);
      if (!required.every(column => columns?.includes(column))) throw new Error('archive_schema_unsupported');
      const count = db.exec(`SELECT COUNT(*) FROM \`${table}\``)[0]?.values[0][0];
      if (typeof count !== 'number' || count > 200000) throw new Error('archive_too_many_rows');
      const result = db.exec(`SELECT * FROM \`${table}\` ORDER BY id`)[0];
      const ids = new Set<number>();
      output[table] = (result?.values ?? []).map(values => {
        const row: MyTargetsSqlRow = {};
        result.columns.forEach((column, index) => {
          const value = values[index];
          if (value instanceof Uint8Array) return;
          if (typeof value === 'string' && (value.length > 8000 || value.includes('\0')) ||
            typeof value === 'number' && !Number.isFinite(value)) throw new Error('archive_invalid_facts');
          row[column] = value;
        });
        const id = row.id;
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || ids.has(id)) throw new Error('archive_invalid_facts');
        if (REQUIRED_FACTS[table]?.some(column => row[column] == null)) throw new Error('archive_invalid_facts');
        ids.add(id); return row;
      });
    }
    return output;
  } finally { db.close(); }
}
