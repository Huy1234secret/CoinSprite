const DIRECTIONS = Object.freeze({ N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] });
const DIRECTION_BITS = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });
const OPPOSITE = Object.freeze({ N: 'S', E: 'W', S: 'N', W: 'E' });
const ROTATE = Object.freeze({ N: 'E', E: 'S', S: 'W', W: 'N' });

function maskFor(sides) { return sides.reduce((mask, side) => mask | DIRECTION_BITS[side], 0); }

// Pipe topology is represented by connector masks. Emoji keys are rendering-only.
const PIECES = Object.freeze({
  EW: { mask: maskFor(['E', 'W']), sides: ['E', 'W'], emoji: 'ew', next: 'NS' },
  NS: { mask: maskFor(['N', 'S']), sides: ['N', 'S'], emoji: 'ns', next: 'EW' },
  NE: { mask: maskFor(['N', 'E']), sides: ['N', 'E'], emoji: 'ne', next: 'ES' },
  ES: { mask: maskFor(['E', 'S']), sides: ['E', 'S'], emoji: 'es', next: 'SW' },
  SW: { mask: maskFor(['S', 'W']), sides: ['S', 'W'], emoji: 'sw', next: 'WN' },
  WN: { mask: maskFor(['W', 'N']), sides: ['W', 'N'], emoji: 'wn', next: 'NE' },
  NES: { mask: maskFor(['N', 'E', 'S']), sides: ['N', 'E', 'S'], emoji: 'nes', next: 'ESW' },
  ESW: { mask: maskFor(['E', 'S', 'W']), sides: ['E', 'S', 'W'], emoji: 'esw', next: 'SWN' },
  SWN: { mask: maskFor(['S', 'W', 'N']), sides: ['S', 'W', 'N'], emoji: 'swn', next: 'WNE' },
  WNE: { mask: maskFor(['W', 'N', 'E']), sides: ['W', 'N', 'E'], emoji: 'wne', next: 'NES' },
  NESW: { mask: 15, sides: ['N', 'E', 'S', 'W'], emoji: 'nesw', next: 'NESW' },
});

const LAYOUTS = Object.freeze({
  easy: Object.freeze([
    { name: 'staircase', shape: ['.##..', '..#..', '..##.', '...##', '.....'], valves: [[0, 0, 'E'], [4, 4, 'N']] },
    { name: 'reverse-staircase', shape: ['...#.', '.###.', '.#...', '##...', '.....'], valves: [[0, 4, 'W'], [4, 0, 'N']] },
  ]),
  normal: Object.freeze([
    { name: 'clipped-left', shape: ['.##..', '####.', '####.', '.##..', '.....'], valves: [[0, 0, 'E'], [4, 2, 'N']] },
    { name: 'clipped-right', shape: ['..##.', '.####', '.####', '..##.', '.....'], valves: [[0, 4, 'S'], [4, 2, 'N']] },
  ]),
  hard: Object.freeze([
    { name: 'center-notch', shape: ['.###.', '#####', '##.##', '.###.', '.....'], valves: [[0, 0, 'E'], [0, 4, 'W'], [4, 1, 'N'], [4, 3, 'N']] },
    { name: 'side-notch', shape: ['.##..', '####.', '#.##.', '####.', '.##..'], valves: [[0, 0, 'E'], [0, 3, 'S'], [4, 0, 'N'], [4, 3, 'N']] },
  ]),
  expert: Object.freeze([
    { name: 'hollow-center', shape: ['.###.', '#####', '##.##', '#####', '.###.'], valves: [[0, 0, 'S'], [0, 4, 'S'], [4, 0, 'N'], [4, 4, 'N']] },
    { name: 'twin-cutout', shape: ['.###.', '#####', '#.#.#', '#####', '.###.'], valves: [[0, 0, 'S'], [0, 4, 'S'], [4, 0, 'N'], [4, 4, 'N']] },
  ]),
});

const key = (row, column) => `${row},${column}`;
const pieceFor = (sides) => Object.keys(PIECES).find((name) => PIECES[name].mask === maskFor(sides));

function rotationsUntil(piece, solution) {
  let current = piece;
  for (let count = 0; count < 4; count += 1) {
    if (current === solution) return count;
    current = PIECES[current].next;
  }
  return 0;
}

function plumberDifficulty(rotatablePipes, valveCount, minimumSolutionRotations) {
  const rotationRatio = rotatablePipes ? minimumSolutionRotations / (rotatablePipes * 3) : 0;
  return Math.max(0, Math.min(1,
    ((rotatablePipes - 6) / 5) * 0.55 + ((valveCount - 2) / 3) * 0.20 + rotationRatio * 0.25,
  ));
}

function createPlumberGame(difficulty, rng) {
  if (typeof rng !== 'function') throw new TypeError('Plumber requires an injected random-number generator.');
  const layouts = LAYOUTS[difficulty];
  const layout = layouts[Math.min(layouts.length - 1, Math.floor(rng() * layouts.length))];
  const core = new Set(layout.shape.flatMap((line, row) => [...line]
    .map((marker, column) => marker === '#' ? key(row, column) : null)
    .filter(Boolean)));
  const cells = Array.from({ length: 25 }, (_, index) => ({ row: Math.floor(index / 5), column: index % 5, type: 'empty' }));
  for (const cell of cells) {
    if (!core.has(key(cell.row, cell.column))) continue;
    const sides = Object.entries(DIRECTIONS)
      .filter(([, [dr, dc]]) => core.has(key(cell.row + dr, cell.column + dc)))
      .map(([side]) => side);
    for (const [valveRow, valveColumn, inward] of layout.valves) {
      const [dr, dc] = DIRECTIONS[inward];
      if (cell.row === valveRow + dr && cell.column === valveColumn + dc) sides.push(OPPOSITE[inward]);
    }
    cell.type = 'pipe';
    cell.solution = pieceFor([...new Set(sides)]);
    if (!cell.solution) throw new Error(`Invalid Plumber layout ${layout.name} at ${key(cell.row, cell.column)}.`);
    cell.piece = cell.solution;
  }
  for (const [row, column, inward] of layout.valves) {
    cells[row * 5 + column] = {
      row, column, type: 'valve', sides: [inward], mask: DIRECTION_BITS[inward],
      piece: ['N', 'S'].includes(inward) ? 'valve_ns' : 'valve_ew',
    };
  }
  let changed = false;
  for (const cell of cells.filter((entry) => entry.type === 'pipe')) {
    const rotations = Math.floor(rng() * 4);
    for (let count = 0; count < rotations; count += 1) cell.piece = PIECES[cell.piece].next;
    if (cell.piece !== cell.solution) changed = true;
  }
  if (!changed) {
    const first = cells.find((cell) => cell.type === 'pipe' && PIECES[cell.piece].next !== cell.piece);
    if (first) first.piece = PIECES[first.piece].next;
  }
  const rotatablePipes = cells.filter((cell) => cell.type === 'pipe' && PIECES[cell.piece].next !== cell.piece).length;
  const minimumSolutionRotations = cells.filter((cell) => cell.type === 'pipe')
    .reduce((sum, cell) => sum + rotationsUntil(cell.piece, cell.solution), 0);
  return {
    cells,
    layout: layout.name,
    rotatablePipes,
    valveCount: layout.valves.length,
    minimumSolutionRotations,
    difficulty: plumberDifficulty(rotatablePipes, layout.valves.length, minimumSolutionRotations),
  };
}

function openMask(cell) {
  if (cell.type === 'valve') return cell.mask ?? maskFor(cell.sides);
  return cell.type === 'pipe' ? PIECES[cell.piece].mask : 0;
}

function openSides(cell) {
  return Object.keys(DIRECTION_BITS).filter((side) => openMask(cell) & DIRECTION_BITS[side]);
}

function validatePlumber(state) {
  const occupied = state.cells.filter((cell) => cell.type !== 'empty');
  if (!occupied.length) return false;
  const byPosition = new Map(occupied.map((cell) => [key(cell.row, cell.column), cell]));
  for (const cell of occupied) {
    for (const side of openSides(cell)) {
      const [dr, dc] = DIRECTIONS[side];
      const neighbor = byPosition.get(key(cell.row + dr, cell.column + dc));
      if (!neighbor || !(openMask(neighbor) & DIRECTION_BITS[OPPOSITE[side]])) return false;
    }
  }
  const seen = new Set();
  const queue = [occupied[0]];
  while (queue.length) {
    const cell = queue.shift();
    const position = key(cell.row, cell.column);
    if (seen.has(position)) continue;
    seen.add(position);
    for (const side of openSides(cell)) {
      const [dr, dc] = DIRECTIONS[side];
      const neighbor = byPosition.get(key(cell.row + dr, cell.column + dc));
      if (neighbor && (openMask(neighbor) & DIRECTION_BITS[OPPOSITE[side]])) queue.push(neighbor);
    }
  }
  return seen.size === occupied.length;
}

function applyPlumberAction(state, action) {
  const match = /^pipe-(\d{1,2})$/.exec(String(action));
  const cell = match ? state.cells[Number(match[1])] : null;
  if (!cell || cell.type !== 'pipe') return { outcome: 'active' };
  cell.piece = PIECES[cell.piece].next;
  return validatePlumber(state) ? { outcome: 'succeeded' } : { outcome: 'active' };
}

module.exports = {
  DIRECTIONS, DIRECTION_BITS, LAYOUTS, OPPOSITE, PIECES, ROTATE,
  applyPlumberAction, createPlumberGame, maskFor, openMask, openSides,
  plumberDifficulty, rotationsUntil, validatePlumber,
};
