const BUILTIN_PAIRS = Object.freeze([
  { color: 'Red', circle: '🔴', square: '🟥' }, { color: 'Orange', circle: '🟠', square: '🟧' },
  { color: 'Yellow', circle: '🟡', square: '🟨' }, { color: 'Green', circle: '🟢', square: '🟩' },
  { color: 'Blue', circle: '🔵', square: '🟦' }, { color: 'Purple', circle: '🟣', square: '🟪' },
  { color: 'Brown', circle: '🟤', square: '🟫' }, { color: 'Black', circle: '⚫', square: '⬛' },
  { color: 'White', circle: '⚪', square: '⬜' },
  { color: 'Cyan', circle: '●', square: '■' }, { color: 'Pink', circle: '●', square: '■' },
  { color: 'Lime', circle: '●', square: '■' },
]);
const PAIR_RANGES = Object.freeze({ easy: [3, 5], normal: [5, 7], hard: [7, 9], expert: [9, 12] });

function normalizeCustomPairs() { return []; }

function shuffle(values, rng) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function createElectricianGame(difficulty, rng, customPairs = []) {
  if (typeof rng !== 'function') throw new TypeError('Electrician requires an injected random-number generator.');
  void customPairs;
  const registry = BUILTIN_PAIRS;
  const [minimum, ordinaryMaximum] = PAIR_RANGES[difficulty];
  const maximum = difficulty === 'expert' ? registry.length : Math.min(ordinaryMaximum, registry.length);
  const count = Math.max(Math.min(minimum, registry.length), minimum + Math.floor(rng() * Math.max(1, maximum - minimum + 1)));
  const selectedPairs = shuffle(registry.map((pair, pairIndex) => ({ ...pair, pairIndex })), rng).slice(0, count);
  const buttons = shuffle(selectedPairs.flatMap(({ color, circle, square, pairIndex }) => [
    { pair: pairIndex, emoji: circle, label: `${circle} ${color} circle` },
    { pair: pairIndex, emoji: square, label: `${square} ${color} square` },
  ]), rng).map((button, index) => ({ ...button, id: index }));
  return { buttons, selected: null, matched: [], difficulty: (buttons.length - 6) / 18 };
}

function applyElectricianAction(state, action) {
  const index = Number(String(action).replace(/^wire-/, ''));
  const button = state.buttons[index];
  if (!button || state.matched.includes(button.pair)) return { outcome: 'active' };
  if (state.selected === index) { state.selected = null; return { outcome: 'active' }; }
  if (state.selected === null) { state.selected = index; return { outcome: 'active' }; }
  const selected = state.buttons[state.selected];
  if (selected.pair !== button.pair) return { outcome: 'failed', reason: 'Those wire colors do not match.' };
  state.matched.push(button.pair);
  state.selected = null;
  const pairs = new Set(state.buttons.map((entry) => entry.pair));
  return state.matched.length === pairs.size ? { outcome: 'succeeded' } : { outcome: 'active' };
}

function electricianTimerSeconds(state) {
  return Math.max(45, Math.min(100, 25 + 3 * state.buttons.length));
}

module.exports = { BUILTIN_PAIRS, PAIR_RANGES, applyElectricianAction, createElectricianGame, electricianTimerSeconds, normalizeCustomPairs };
