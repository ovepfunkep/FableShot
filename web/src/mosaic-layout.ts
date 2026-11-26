type Cell = { column: number; row: number };
type Group = { score: number; tiles: number };

export function packMosaicGroups(groups: readonly Group[]) {
  const ordered = groups.filter(group => group.tiles > 0).sort((a, b) => b.score - a.score);
  const total = ordered.reduce((sum, group) => sum + group.tiles, 0);
  const cellsByScore = new Map<number, Cell[]>();
  if (!total) return { columns: 0, rows: 0, cellsByScore };

  const rows = Math.min(total, Math.max(1, Math.round(Math.sqrt(total * 6 / 10))));
  const columns = Math.ceil(total / rows);
  let index = 0;
  for (const group of ordered) {
    const cells: Cell[] = [];
    for (let tile = 0; tile < group.tiles; tile++, index++) {
      const column = Math.floor(index / rows);
      const offset = index % rows;
      // Fill the rightmost column from the top. Adjacent columns meet at
      // the same edge, so a score crossing that boundary stays connected.
      const row = (columns - column) % 2 === 1 ? offset : rows - 1 - offset;
      cells.push({ column, row });
    }
    cellsByScore.set(group.score, cells.sort((a, b) => a.row - b.row || a.column - b.column));
  }
  return { columns, rows, cellsByScore };
}
