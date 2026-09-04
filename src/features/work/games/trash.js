const { TRASH_ITEMS } = require('../data/trashItems');

const REQUIRED = Object.freeze({ easy: 4, normal: 6, hard: 8, expert: 10 });

function shuffle(values, rng) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [output[index], output[other]] = [output[other], output[index]];
  }
  return output;
}

function createTrashGame(difficulty, rng = Math.random) {
  const all = Object.entries(TRASH_ITEMS).flatMap(([category, items]) => items.map((item) => ({ item, category })));
  return { required: REQUIRED[difficulty], sorted: 0, items: shuffle(all, rng).slice(0, REQUIRED[difficulty]) };
}

function applyTrashAction(state, action) {
  const current = state.items[state.sorted];
  if (!current || current.category !== action) return { outcome: 'failed', reason: 'That item went into the wrong bin.' };
  state.sorted += 1;
  return state.sorted === state.required ? { outcome: 'succeeded' } : { outcome: 'active' };
}

module.exports = { REQUIRED, applyTrashAction, createTrashGame, shuffle };
