const { BURGER_ORDER_SEEDS, BURGER_MESSAGES, FILLINGS } = require('../data/burgerOrders');

// Ranges count fillings only. The bottom and top buns are added separately.
const RANGES = Object.freeze({ easy: [2, 3], normal: [2, 5], hard: [2, 7], expert: [2, 10] });
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
  const buttons = shuffle(target.map((ingredient, id) => ({ id, ingredient, completed: false })), rng);
  return {
    target,
    cursor: 0,
    buttons,
    message: `A customer says:\n> ${pick(rng, BURGER_MESSAGES).replace('{fillings}', naturalList(fillings))}`,
    difficulty: (fillings.length - 2) / 8,
  };
}

function applyBurgerAction(state, action) {
  const match = /^burger-(\d{1,2})$/.exec(String(action));
  const button = match ? state.buttons.find((entry) => entry.id === Number(match[1])) : null;
  if (!button || button.completed) return { outcome: 'active' };
  if (button.ingredient !== state.target[state.cursor]) {
    return { outcome: 'failed', reason: 'The burger was stacked in the wrong order.' };
  }
  button.completed = true;
  state.cursor += 1;
  return state.cursor === state.target.length ? { outcome: 'succeeded' } : { outcome: 'active' };
}

module.exports = { RANGES, applyBurgerAction, createBurgerGame, ingredientName, naturalList, shuffle };
