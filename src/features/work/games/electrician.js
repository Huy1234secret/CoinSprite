const BUILTIN_PAIRS = Object.freeze([
  ['🔴', '🟥'], ['🟠', '🟧'], ['🟡', '🟨'], ['🟢', '🟩'], ['🔵', '🟦'],
  ['🟣', '🟪'], ['🟤', '🟫'], ['⚫', '⬛'], ['⚪', '⬜'],
]);
const PAIR_RANGES = Object.freeze({ easy: [3, 3], normal: [4, 5], hard: [6, 7], expert: [8, 9] });

function normalizeCustomPairs(pairs = []) {
  return pairs.slice(0, 3).filter((pair) => pair?.circle?.name && pair.circle?.id && pair?.square?.name && pair.square?.id)
    .map((pair) => [pair.circle, pair.square]);
}

function shuffle(values, rng) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function createElectricianGame(difficulty, rng = Math.random, customPairs = []) {
  const registry = [...BUILTIN_PAIRS, ...normalizeCustomPairs(customPairs)].slice(0, 12);
  const [minimum, ordinaryMaximum] = PAIR_RANGES[difficulty];
  const maximum = difficulty === 'expert' ? registry.length : Math.min(ordinaryMaximum, registry.length);
  const count = Math.max(Math.min(minimum, registry.length), minimum + Math.floor(rng() * Math.max(1, maximum - minimum + 1)));
  const selectedPairs = shuffle(registry.map((pair, pairIndex) => ({ pair, pairIndex })), rng).slice(0, count);
  const buttons = shuffle(selectedPairs.flatMap(({ pair, pairIndex }) => [
    { pair: pairIndex, emoji: pair[0] }, { pair: pairIndex, emoji: pair[1] },
  ]), rng).map((button, index) => ({ ...button, id: index }));
  return { buttons, selected: null, matched: [] };
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
  const pairs = state.buttons.length / 2;
  const defaults = { 3: 45, 4: 60, 5: 60, 6: 80, 7: 80, 8: 105, 9: 105 };
  return pairs > 9 ? Math.min(135, 15 + 10 * pairs) : defaults[pairs];
}

module.exports = { BUILTIN_PAIRS, PAIR_RANGES, applyElectricianAction, createElectricianGame, electricianTimerSeconds, normalizeCustomPairs };
