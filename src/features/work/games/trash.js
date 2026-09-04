const { TRASH_ITEMS } = require('../data/trashItems');

// Item counts exclude the category buttons and rise steadily with difficulty.
const REQUIRED = Object.freeze({ easy: [2, 3], normal: [4, 5], hard: [6, 8], expert: [9, 10] });

function shuffle(values, rng) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [output[index], output[other]] = [output[other], output[index]];
  }
  return output;
}

function createTrashGame(difficulty, rng) {
  if (typeof rng !== 'function') throw new TypeError('Trash Sorter requires an injected random-number generator.');
  const all = Object.entries(TRASH_ITEMS).flatMap(([category, items]) => items.map((item) => ({ item, category })));
  const [minimum, maximum] = REQUIRED[difficulty];
  const required = minimum + Math.floor(rng() * (maximum - minimum + 1));
  return { required, sorted: 0, items: shuffle(all, rng).slice(0, required), difficulty: (required - 2) / 8 };
}

function applyTrashAction(state, action) {
  const current = state.items[state.sorted];
  if (!current || current.category !== action) return { outcome: 'failed', reason: 'That item went into the wrong bin.' };
  state.sorted += 1;
  return state.sorted === state.required ? { outcome: 'succeeded' } : { outcome: 'active' };
}

module.exports = { REQUIRED, applyTrashAction, createTrashGame, shuffle };
