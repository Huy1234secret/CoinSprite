const BUILTIN_PAIRS = Object.freeze([
  { color: 'Red', shape: 'circle', emoji: '🔴' }, { color: 'Orange', shape: 'circle', emoji: '🟠' },
  { color: 'Yellow', shape: 'circle', emoji: '🟡' }, { color: 'Green', shape: 'circle', emoji: '🟢' },
  { color: 'Blue', shape: 'circle', emoji: '🔵' }, { color: 'Purple', shape: 'circle', emoji: '🟣' },
  { color: 'Brown', shape: 'circle', emoji: '🟤' }, { color: 'Black', shape: 'circle', emoji: '⚫' },
  { color: 'White', shape: 'circle', emoji: '⚪' },
  { color: 'Red', shape: 'square', emoji: '🟥' }, { color: 'Orange', shape: 'square', emoji: '🟧' },
  { color: 'Yellow', shape: 'square', emoji: '🟨' }, { color: 'Green', shape: 'square', emoji: '🟩' },
  { color: 'Blue', shape: 'square', emoji: '🟦' }, { color: 'Purple', shape: 'square', emoji: '🟪' },
  { color: 'Brown', shape: 'square', emoji: '🟫' }, { color: 'Black', shape: 'square', emoji: '⬛' },
  { color: 'White', shape: 'square', emoji: '⬜' },
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
  const maximum = Math.min(ordinaryMaximum, registry.length);
  const count = Math.max(Math.min(minimum, registry.length), minimum + Math.floor(rng() * Math.max(1, maximum - minimum + 1)));
  const selectedPairs = shuffle(registry.map((pair, pairIndex) => ({ ...pair, pairIndex })), rng).slice(0, count);
  const buttons = shuffle(selectedPairs.flatMap(({ emoji, pairIndex }) => [
    { pair: pairIndex, emoji },
    { pair: pairIndex, emoji },
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
