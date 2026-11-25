import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packMosaicGroups } from '../src/mosaic-layout.ts';

test('60 equal scores fill a 10 by 6 rectangle', () => {
  const layout = packMosaicGroups([{ score: 10, tiles: 60 }]);
  assert.equal(layout.columns, 10);
  assert.equal(layout.rows, 6);
  assert.equal(layout.cellsByScore.get(10)?.length, 60);
});

test('groups keep consecutive tiles in each row and share the grid without overlap', () => {
  const groups = [{ score: 10, tiles: 14 }, { score: 6, tiles: 5 }, { score: 4, tiles: 11 }, { score: 8, tiles: 6 }];
  const layout = packMosaicGroups(groups);
  const occupied = new Set<string>();
  assert.ok(layout.columns * layout.rows <= 42);
  for (const { score, tiles } of groups) {
    const cells = layout.cellsByScore.get(score)!;
    assert.equal(cells.length, tiles);
    const rows = new Map<number, number[]>();
    for (const { column, row } of cells) {
      const key = `${column}:${row}`;
      assert.ok(!occupied.has(key));
      assert.ok(column >= 0 && column < layout.columns && row >= 0 && row < layout.rows);
      occupied.add(key);
      rows.set(row, [...rows.get(row) ?? [], column]);
    }
    let previousRow: number[] | undefined;
    let lastRow = Math.min(...rows.keys()) - 1;
    for (const [row, columns] of rows) {
      assert.equal(row, lastRow + 1);
      assert.ok(columns.every((column, index) => column === columns[0] + index));
      if (previousRow) assert.ok(columns.some(column => previousRow!.includes(column)));
      previousRow = columns;
      lastRow = row;
    }
  }
  assert.equal(occupied.size, 36);
});
