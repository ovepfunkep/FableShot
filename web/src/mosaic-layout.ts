type Cell = { column: number; row: number };
type Group = { score: number; tiles: number };
type Placement = { cells: Cell[]; cost: number; shapeCost: number };

const preferredAspect = 10 / 6;

function packAtWidth(groups: readonly Group[], columns: number, total: number) {
  const targetRows = Math.ceil(total / columns);
  const occupied: boolean[][] = [];
  const cellsByScore = new Map<number, Cell[]>();
  const filled = (column: number, row: number) => occupied[row]?.[column] === true;
  let usedColumns = 0;
  let shapeCostTotal = 0;

  for (const group of groups) {
    let best: Placement | undefined;
    for (let width = 1; width <= Math.min(columns, group.tiles); width++) {
      const height = Math.ceil(group.tiles / width);
      const spare = width * height - group.tiles;
      const shapeCost = spare * .35 + Math.abs(Math.log(width / height)) * Math.sqrt(group.tiles) * 1.25;
      // Mirror an incomplete rectangle so the next score can occupy its open corner.
      const reflections = spare ? [false, true] : [false];
      for (const flipColumns of reflections) for (const flipRows of reflections) {
        const shape = Array.from({ length: group.tiles }, (_, index) => {
          const column = index % width;
          const row = Math.floor(index / width);
          return { column: flipColumns ? width - column - 1 : column, row: flipRows ? height - row - 1 : row };
        });
        for (let top = 0; top <= occupied.length; top++) {
          const overflow = Math.max(0, top + height - targetRows, occupied.length - targetRows);
          for (let left = 0; left <= columns - width; left++) {
            if (shape.some(cell => filled(left + cell.column, top + cell.row))) continue;
            const contacts = shape.reduce((sum, cell) => {
              const x = left + cell.column, y = top + cell.row;
              return sum + Number(filled(x - 1, y)) + Number(filled(x + 1, y)) + Number(filled(x, y - 1)) + Number(filled(x, y + 1));
            }, 0);
            const fullSpan = height === targetRows || width === columns ? .5 : 0;
            const cost = overflow * columns + shapeCost - contacts * .5 + top * .1 + left * .03 - fullSpan;
            if (!best || cost < best.cost) best = { cost, shapeCost,
              cells: shape.map(cell => ({ column: left + cell.column, row: top + cell.row })) };
          }
        }
      }
    }
    if (!best) throw new Error('Не удалось расположить оценки в мозаике.');
    for (const { column, row } of best.cells) {
      (occupied[row] ??= [])[column] = true;
      usedColumns = Math.max(usedColumns, column + 1);
    }
    cellsByScore.set(group.score, best.cells.sort((a, b) => a.row - b.row || a.column - b.column));
    shapeCostTotal += best.shapeCost;
  }

  const rows = occupied.length;
  const cost = rows * usedColumns - total + Math.abs(usedColumns / rows - preferredAspect) * 2 + shapeCostTotal * .5;
  return { columns: usedColumns, rows, cellsByScore, cost };
}

/** Place the largest groups first, keeping each score in one connected rectangle with a possible incomplete edge. */
export function packMosaicGroups(groups: readonly Group[]) {
  const ordered = groups.filter(group => group.tiles > 0).sort((a, b) => b.tiles - a.tiles || b.score - a.score);
  const total = ordered.reduce((sum, group) => sum + group.tiles, 0);
  if (!total) return { columns: 0, rows: 0, cellsByScore: new Map<number, Cell[]>() };
  const preferred = Math.min(total, Math.round(Math.sqrt(total * preferredAspect)));
  let best = packAtWidth(ordered, preferred, total);
  for (const width of [preferred - 1, preferred + 1]) {
    if (width < 1 || width > total) continue;
    const alternative = packAtWidth(ordered, width, total);
    if (alternative.cost < best.cost) best = alternative;
  }
  return best;
}
