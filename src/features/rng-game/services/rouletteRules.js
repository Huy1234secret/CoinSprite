const { RED_NUMBER_SET, ROULETTE_LIMITS } = require('../config/roulette');

const FIXED_BETS = Object.freeze({
  trio_012: { target: '0-1-2', covered: [0, 1, 2], multiplier: 12n },
  trio_023: { target: '0-2-3', covered: [0, 2, 3], multiplier: 12n },
  first_four: { target: '0-1-2-3', covered: [0, 1, 2, 3], multiplier: 9n },
  dozen_1: { target: '1', covered: range(1, 12), multiplier: 3n },
  dozen_2: { target: '2', covered: range(13, 24), multiplier: 3n },
  dozen_3: { target: '3', covered: range(25, 36), multiplier: 3n },
  column_1: { target: '1', covered: range(1, 34, 3), multiplier: 3n },
  column_2: { target: '2', covered: range(2, 35, 3), multiplier: 3n },
  column_3: { target: '3', covered: range(3, 36, 3), multiplier: 3n },
  red: { target: 'red', covered: [...RED_NUMBER_SET], multiplier: 2n },
  black: { target: 'black', covered: range(1, 36).filter((number) => !RED_NUMBER_SET.has(number)), multiplier: 2n },
  even: { target: 'even', covered: range(1, 36).filter((number) => number % 2 === 0), multiplier: 2n },
  odd: { target: 'odd', covered: range(1, 36).filter((number) => number % 2 === 1), multiplier: 2n },
  low: { target: 'low', covered: range(1, 18), multiplier: 2n },
  high: { target: 'high', covered: range(19, 36), multiplier: 2n },
});

function range(start, end, step = 1) {
  const result = [];
  for (let value = start; value <= end; value += step) result.push(value);
  return result;
}

function parseNumbers(value) {
  const matches = String(value ?? '').match(/\d+/g) || [];
  return matches.map(Number);
}

function exactSet(actual, expected) {
  const normalized = [...new Set(actual)].sort((a, b) => a - b);
  return normalized.length === expected.length && normalized.every((number, index) => number === expected[index]);
}

function validTableNumber(number, allowZero = false) {
  return Number.isInteger(number) && number >= (allowZero ? 0 : 1) && number <= 36;
}

function canonicalBet(typeValue, targetValue = '') {
  const type = String(typeValue || '');
  if (FIXED_BETS[type]) return { type, ...FIXED_BETS[type], anchorKey: `${type}:${FIXED_BETS[type].target}` };
  const numbers = parseNumbers(targetValue);
  let target;
  let covered;
  let multiplier;
  if (type === 'straight') {
    if (numbers.length !== 1 || !validTableNumber(numbers[0], true)) throw new RangeError('Straight requires exactly one number from 0 to 36.');
    [target] = numbers;
    covered = [target];
    multiplier = 36n;
  } else if (type === 'split') {
    if (numbers.length !== 2 || !numbers.every((number) => validTableNumber(number, true))) throw new RangeError('Split requires exactly two legal adjacent numbers.');
    covered = [...numbers].sort((a, b) => a - b);
    const [first, second] = covered;
    const zeroEdge = first === 0 && [1, 2, 3].includes(second);
    const sameStreet = first > 0 && Math.floor((first - 1) / 3) === Math.floor((second - 1) / 3) && second - first === 1;
    const adjacentStreetSameRow = first > 0 && second - first === 3;
    if (!zeroEdge && !sameStreet && !adjacentStreetSameRow) throw new RangeError('Those numbers do not share a legal split edge.');
    target = covered.join('-');
    multiplier = 18n;
  } else if (type === 'street') {
    const first = numbers.length === 1 ? numbers[0] : Math.min(...numbers);
    if (![1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34].includes(first)
      || (numbers.length !== 1 && !exactSet(numbers, [first, first + 1, first + 2]))) {
      throw new RangeError('Street requires its first number or a standard three-number street.');
    }
    target = first;
    covered = [first, first + 1, first + 2];
    multiplier = 12n;
  } else if (type === 'corner') {
    if (numbers.length !== 4 || !numbers.every((number) => validTableNumber(number))) throw new RangeError('Corner requires exactly four table numbers.');
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
    const first = sorted[0];
    const expected = [first, first + 1, first + 3, first + 4];
    if (sorted.length !== 4 || ![1, 2].includes(((first - 1) % 3) + 1) || first > 32 || !exactSet(sorted, expected)) {
      throw new RangeError('Those numbers do not form a legal corner.');
    }
    target = sorted.join('-');
    covered = sorted;
    multiplier = 9n;
  } else if (type === 'six_line') {
    const first = numbers.length === 1 ? numbers[0] : Math.min(...numbers);
    const expected = range(first, first + 5);
    const compactRange = numbers.length === 2 && numbers[0] === first && numbers[1] === first + 5;
    if (![1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31].includes(first)
      || (numbers.length !== 1 && !compactRange && !exactSet(numbers, expected))) {
      throw new RangeError('Six Line requires the first number or two adjacent streets.');
    }
    target = first;
    covered = expected;
    multiplier = 6n;
  } else {
    throw new RangeError('Unsupported roulette bet type.');
  }
  return { type, target: String(target), covered, multiplier, anchorKey: `${type}:${target}` };
}

function parseBetAmount(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) throw new RangeError('Bet amount must be a whole token value from 1 to 1000.');
  const amount = BigInt(text);
  if (amount < ROULETTE_LIMITS.minimumBet || amount > ROULETTE_LIMITS.maximumBet) {
    throw new RangeError('Bet amount must be from 1 to 1000 token value.');
  }
  return amount;
}

function rouletteColor(number) {
  if (number === 0) return 'green';
  return RED_NUMBER_SET.has(number) ? 'red' : 'black';
}

function totalReturn(bet, result) {
  const canonical = canonicalBet(bet.type, bet.target);
  return betCoversResult(canonical, result) ? BigInt(bet.amount) * canonical.multiplier : 0n;
}

function freezeBet(bet) {
  return Object.freeze({ ...bet, covered: Object.freeze([...bet.covered]) });
}

function legalBetRegions() {
  const regions = [];
  for (let number = 0; number <= 36; number += 1) regions.push(canonicalBet('straight', number));

  // The supplied European table exposes the regular 1-36 split grid. Zero-side
  // bets are represented by the two trios and the basket shown on the asset.
  for (let first = 1; first <= 36; first += 1) {
    if (first % 3 !== 0) regions.push(canonicalBet('split', `${first}-${first + 1}`));
    if (first <= 33) regions.push(canonicalBet('split', `${first}-${first + 3}`));
  }
  for (let first = 1; first <= 34; first += 3) regions.push(canonicalBet('street', first));
  for (let first = 1; first <= 32; first += 1) {
    if (first % 3 !== 0) regions.push(canonicalBet('corner', `${first}-${first + 1}-${first + 3}-${first + 4}`));
  }
  for (let first = 1; first <= 31; first += 3) regions.push(canonicalBet('six_line', first));

  for (const type of Object.keys(FIXED_BETS)) regions.push(canonicalBet(type));
  return Object.freeze(regions.map(freezeBet));
}

const LEGAL_BET_REGIONS = legalBetRegions();

function betCoversResult(bet, result) {
  const number = Number(result);
  if (!Number.isInteger(number) || number < 0 || number > 36) return false;
  const canonical = Array.isArray(bet?.covered) ? bet : canonicalBet(bet?.type, bet?.target);
  return canonical.covered.includes(number);
}

function winningBetRegions(resultNumber) {
  const number = Number(resultNumber);
  if (!Number.isInteger(number) || number < 0 || number > 36) {
    throw new RangeError('Roulette result must be a whole number from 0 to 36.');
  }
  return LEGAL_BET_REGIONS.filter((bet) => betCoversResult(bet, number));
}

module.exports = {
  FIXED_BETS,
  LEGAL_BET_REGIONS,
  betCoversResult,
  canonicalBet,
  parseBetAmount,
  parseNumbers,
  range,
  rouletteColor,
  totalReturn,
  winningBetRegions,
};
