const { BURGER_ORDER_SEEDS, BURGER_MESSAGES, FILLINGS } = require('../data/burgerOrders');

const RANGES = Object.freeze({ easy: [3, 5], normal: [6, 9], hard: [10, 15], expert: [16, 23] });
const pick = (rng, values) => values[Math.min(values.length - 1, Math.floor(rng() * values.length))];

function createBurgerGame(difficulty, rng = Math.random) {
  const [minimum, maximum] = RANGES[difficulty];
  const count = minimum + Math.floor(rng() * (maximum - minimum + 1));
  const seedIndex = Math.floor(rng() * BURGER_ORDER_SEEDS.length);
  const seed = BURGER_ORDER_SEEDS[seedIndex];
  const fillings = Array.from({ length: count }, (_, index) => seed[index % seed.length] || FILLINGS[(seedIndex + index) % FILLINGS.length]);
  const names = fillings.map((name) => name[0].toUpperCase() + name.slice(1));
  return {
    target: ['bottom_bun', ...fillings, 'top_bun'],
    cursor: 0,
    buttons: [...new Set(['bottom_bun', ...fillings, 'top_bun'])],
    message: pick(rng, BURGER_MESSAGES).replace('{fillings}', names.join(' → ')),
  };
}

function applyBurgerAction(state, action) {
  if (!state.buttons.includes(action) || action !== state.target[state.cursor]) {
    return { outcome: 'failed', reason: 'The burger was stacked in the wrong order.' };
  }
  state.cursor += 1;
  return state.cursor === state.target.length ? { outcome: 'succeeded' } : { outcome: 'active' };
}

module.exports = { RANGES, applyBurgerAction, createBurgerGame };
