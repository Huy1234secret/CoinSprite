const DIRECTIONS = Object.freeze({ N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] });
const OPPOSITE = Object.freeze({ N: 'S', E: 'W', S: 'N', W: 'E' });
const ROTATE = Object.freeze({ N: 'E', E: 'S', S: 'W', W: 'N' });
const PIECES = Object.freeze({
  EW: { sides: ['E', 'W'], emoji: 'ew', next: 'NS' }, NS: { sides: ['N', 'S'], emoji: 'ns', next: 'EW' },
  NE: { sides: ['N', 'E'], emoji: 'ne', next: 'ES' }, ES: { sides: ['E', 'S'], emoji: 'es', next: 'SW' },
  SW: { sides: ['S', 'W'], emoji: 'sw', next: 'WN' }, WN: { sides: ['W', 'N'], emoji: 'wn', next: 'NE' },
  NES: { sides: ['N', 'E', 'S'], emoji: 'nes', next: 'ESW' }, ESW: { sides: ['E', 'S', 'W'], emoji: 'esw', next: 'SWN' },
  SWN: { sides: ['S', 'W', 'N'], emoji: 'swn', next: 'WNE' }, WNE: { sides: ['W', 'N', 'E'], emoji: 'wne', next: 'NES' },
  NESW: { sides: ['N', 'E', 'S', 'W'], emoji: 'nesw', next: 'NESW' },
});
const LAYOUTS = Object.freeze({
  easy: { rows: [0, 1], columns: [1, 2, 3], valves: [[0, 0, 'W', 'E'], [1, 4, 'E', 'W']] },
  normal: { rows: [1, 2, 3], columns: [0, 1, 2, 3], valves: [[0, 1, 'N', 'S'], [4, 2, 'S', 'N']] },
  hard: { rows: [0, 1, 2, 3], columns: [0, 1, 2, 3], valves: [[0, 4, 'E', 'W'], [1, 4, 'E', 'W'], [2, 4, 'E', 'W'], [3, 4, 'E', 'W']] },
  expert: { rows: [0, 1, 2, 3], columns: [0, 1, 2, 3, 4], valves: [[4, 0, 'S', 'N'], [4, 1, 'S', 'N'], [4, 2, 'S', 'N'], [4, 3, 'S', 'N'], [4, 4, 'S', 'N']] },
});

const key = (row, column) => `${row},${column}`;
const pieceFor = (sides) => Object.keys(PIECES).find((name) => PIECES[name].sides.length === sides.length && PIECES[name].sides.every((side) => sides.includes(side)));

function createPlumberGame(difficulty, rng = Math.random) {
  const layout = LAYOUTS[difficulty];
  const core = new Set(layout.rows.flatMap((row) => layout.columns.map((column) => key(row, column))));
  const cells = Array(25).fill(null).map((_, index) => ({ row: Math.floor(index / 5), column: index % 5, type: 'empty' }));
  for (const cell of cells) {
    const position = key(cell.row, cell.column);
    if (!core.has(position)) continue;
    const sides = Object.entries(DIRECTIONS).filter(([, [dr, dc]]) => core.has(key(cell.row + dr, cell.column + dc))).map(([side]) => side);
    for (const [vr, vc, , inward] of layout.valves) {
      const [dr, dc] = DIRECTIONS[inward];
      if (cell.row === vr + dr && cell.column === vc + dc) sides.push(OPPOSITE[inward]);
    }
    cell.type = 'pipe';
    cell.solution = pieceFor([...new Set(sides)]);
    cell.piece = cell.solution;
  }
  for (const [row, column, outward, inward] of layout.valves) {
    cells[row * 5 + column] = { row, column, type: 'valve', sides: [outward, inward], piece: ['N', 'S'].includes(outward) ? 'valve_ns' : 'valve_ew' };
  }
  let changed = false;
  for (const cell of cells.filter((entry) => entry.type === 'pipe')) {
    const rotations = Math.floor(rng() * 4);
    for (let count = 0; count < rotations; count += 1) cell.piece = PIECES[cell.piece].next;
    if (cell.piece !== cell.solution) changed = true;
  }
  if (!changed) {
    const first = cells.find((cell) => cell.type === 'pipe' && PIECES[cell.piece].next !== cell.piece);
    first.piece = PIECES[first.piece].next;
  }
  return { cells };
}

function openSides(cell) {
  if (cell.type === 'valve') return cell.sides;
  return cell.type === 'pipe' ? PIECES[cell.piece].sides : [];
}

function validatePlumber(state) {
  const occupied = state.cells.filter((cell) => cell.type !== 'empty');
  const byPosition = new Map(occupied.map((cell) => [key(cell.row, cell.column), cell]));
  for (const cell of occupied) for (const side of openSides(cell)) {
    const [dr, dc] = DIRECTIONS[side];
    const neighbor = byPosition.get(key(cell.row + dr, cell.column + dc));
    if (!neighbor) {
      if (cell.type === 'valve' && cell.sides[0] === side) continue;
      return false;
    }
    if (!openSides(neighbor).includes(OPPOSITE[side])) return false;
  }
  const seen = new Set();
  const queue = [occupied.find((cell) => cell.type === 'valve')];
  while (queue.length) {
    const cell = queue.shift(); const position = key(cell.row, cell.column);
    if (seen.has(position)) continue;
    seen.add(position);
    for (const side of openSides(cell)) {
      const [dr, dc] = DIRECTIONS[side]; const neighbor = byPosition.get(key(cell.row + dr, cell.column + dc));
      if (neighbor && openSides(neighbor).includes(OPPOSITE[side])) queue.push(neighbor);
    }
  }
  return seen.size === occupied.length;
}

function applyPlumberAction(state, action) {
  const index = Number(String(action).replace(/^pipe-/, ''));
  const cell = state.cells[index];
  if (!cell || cell.type !== 'pipe') return { outcome: 'active' };
  cell.piece = PIECES[cell.piece].next;
  return validatePlumber(state) ? { outcome: 'succeeded' } : { outcome: 'active' };
}

module.exports = { DIRECTIONS, LAYOUTS, OPPOSITE, PIECES, ROTATE, applyPlumberAction, createPlumberGame, openSides, validatePlumber };
