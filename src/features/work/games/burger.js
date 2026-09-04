const { BURGER_ORDER_SEEDS, BURGER_MESSAGES, FILLINGS } = require('../data/burgerOrders');

const RANGES = Object.freeze({ easy: [3, 7], normal: [8, 12], hard: [13, 17], expert: [18, 23] });
const pick = (rng, values) => values[Math.min(values.length - 1, Math.floor(rng() * values.length))];

function shuffle(values, rng) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function ingredientName(value) {
  return value === 'beef_patty' ? 'beef patty' : value;
}

function naturalList(values) {
  const names = values.map(ingredientName);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

function createBurgerGame(difficulty, rng) {
  if (typeof rng !== 'function') throw new TypeError('Burger Maker requires an injected random-number generator.');
  const [minimum, maximum] = RANGES[difficulty];
  const count = minimum + Math.floor(rng() * (maximum - minimum + 1));
  const seedIndex = Math.floor(rng() * BURGER_ORDER_SEEDS.length);
  const seed = BURGER_ORDER_SEEDS[seedIndex];
  const fillings = Array.from({ length: count }, (_, index) => seed[index % seed.length] || FILLINGS[(seedIndex + index) % FILLINGS.length]);
  const target = ['bottom_bun', ...fillings, 'top_bun'];
  const answerOrder = [...new Set(target)];
  let buttons = shuffle(answerOrder, rng);
  if (buttons.every((value, index) => value === answerOrder[index])) buttons = [...buttons.slice(1), buttons[0]];
  return {
    target,
    cursor: 0,
    buttons,
    message: `A customer says:\n> ${pick(rng, BURGER_MESSAGES).replace('{fillings}', naturalList(fillings))}`,
    difficulty: (target.length - 5) / 20,
  };
}

function applyBurgerAction(state, action) {
  if (!state.buttons.includes(action) || action !== state.target[state.cursor]) {
    return { outcome: 'failed', reason: 'The burger was stacked in the wrong order.' };
  }
  state.cursor += 1;
  return state.cursor === state.target.length ? { outcome: 'succeeded' } : { outcome: 'active' };
}

module.exports = { RANGES, applyBurgerAction, createBurgerGame, ingredientName, naturalList, shuffle };
