const path = require('path');

const ROULETTE_CANVAS_WIDTH = 1_568;
const ROULETTE_CANVAS_HEIGHT = 700;
const ROULETTE_IMAGE_DIRECTORY = path.join(__dirname, '..', '..', '..', '..', 'images', 'roulette');
const ROULETTE_RESULT_IMAGE_DIRECTORY = path.join(__dirname, '..', '..', '..', '..');
const ROULETTE_TABLE_ASSET = 'roulette table.png';
const ROULETTE_SPIN_DURATION_MS = 10_000;
const ROULETTE_MAX_PLAYERS = 4;

const ROULETTE_STATES = Object.freeze({
  CHOOSING_MODE: 'CHOOSING_MODE',
  CHOOSING_OPPONENTS: 'CHOOSING_OPPONENTS',
  LOBBY: 'LOBBY',
  BETTING: 'BETTING',
  SPINNING: 'SPINNING',
  FINISHED: 'FINISHED',
  CANCELED: 'CANCELED',
  EXPIRED: 'EXPIRED',
});

const ROULETTE_TIMEOUTS = Object.freeze({
  choosing: 15 * 60 * 1_000,
  lobby: 5 * 60 * 1_000,
  betting: 10 * 60 * 1_000,
});

const ROULETTE_LIMITS = Object.freeze({
  minimumBet: 1n,
  maximumBet: 1_000n,
  maximumTotal: 1_000n,
  maximumPositions: 12,
});

const RED_NUMBERS = Object.freeze([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RED_NUMBER_SET = new Set(RED_NUMBERS);

// Measured from the supplied 1568x700 source asset. The number grid uses twelve
// equal streets horizontally and three displayed rows vertically.
const ROULETTE_GEOMETRY = Object.freeze({
  numberGrid: Object.freeze({ left: 199, right: 1_388, top: 29, bottom: 412 }),
  streetWidth: 99,
  numberRowHeight: 127.5,
  zero: Object.freeze({ x: 131, y: 250, bounds: Object.freeze({ left: 68, right: 195, top: 43, bottom: 410 }) }),
  dozens: Object.freeze([
    Object.freeze({ left: 200, right: 595, top: 414, bottom: 518 }),
    Object.freeze({ left: 597, right: 990, top: 414, bottom: 518 }),
    Object.freeze({ left: 993, right: 1_386, top: 414, bottom: 518 }),
  ]),
  columns: Object.freeze([
    Object.freeze({ left: 1_391, right: 1_486, top: 287, bottom: 409 }),
    Object.freeze({ left: 1_391, right: 1_486, top: 160, bottom: 281 }),
    Object.freeze({ left: 1_391, right: 1_486, top: 33, bottom: 154 }),
  ]),
  outside: Object.freeze({
    low: Object.freeze({ left: 202, right: 394, top: 525, bottom: 635 }),
    even: Object.freeze({ left: 401, right: 591, top: 525, bottom: 635 }),
    red: Object.freeze({ left: 599, right: 789, top: 525, bottom: 635 }),
    black: Object.freeze({ left: 797, right: 987, top: 525, bottom: 635 }),
    odd: Object.freeze({ left: 995, right: 1_185, top: 525, bottom: 635 }),
    high: Object.freeze({ left: 1_193, right: 1_384, top: 525, bottom: 635 }),
  }),
});

function center(bounds) {
  return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2, bounds };
}

function numberCoordinates(number) {
  if (number === 0) return { ...ROULETTE_GEOMETRY.zero };
  if (!Number.isInteger(number) || number < 1 || number > 36) throw new RangeError('Roulette number must be from 0 to 36.');
  const street = Math.floor((number - 1) / 3);
  const displayedRow = 3 - (((number - 1) % 3) + 1);
  const left = ROULETTE_GEOMETRY.numberGrid.left + (street * ROULETTE_GEOMETRY.streetWidth);
  const right = street === 11 ? ROULETTE_GEOMETRY.numberGrid.right : left + ROULETTE_GEOMETRY.streetWidth;
  const top = ROULETTE_GEOMETRY.numberGrid.top + (displayedRow * ROULETTE_GEOMETRY.numberRowHeight);
  const bottom = displayedRow === 2 ? ROULETTE_GEOMETRY.numberGrid.bottom : top + ROULETTE_GEOMETRY.numberRowHeight;
  return center({ left, right, top, bottom });
}

function anchorFor(type, target) {
  if (type === 'straight') return numberCoordinates(Number(target));
  if (type === 'split') {
    const [leftNumber, rightNumber] = String(target).split('-').map(Number);
    const first = numberCoordinates(leftNumber);
    const second = numberCoordinates(rightNumber);
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  }
  if (type === 'street') {
    const first = Number(target);
    return { x: numberCoordinates(first + 1).x, y: ROULETTE_GEOMETRY.numberGrid.bottom };
  }
  if (type === 'corner') {
    const numbers = String(target).split('-').map(Number);
    const points = numbers.map(numberCoordinates);
    return { x: points.reduce((sum, point) => sum + point.x, 0) / 4, y: points.reduce((sum, point) => sum + point.y, 0) / 4 };
  }
  if (type === 'six_line') {
    const first = Number(target);
    return { x: (numberCoordinates(first + 1).x + numberCoordinates(first + 4).x) / 2, y: ROULETTE_GEOMETRY.numberGrid.bottom };
  }
  if (type === 'trio_012') return { x: ROULETTE_GEOMETRY.numberGrid.left, y: 284 };
  if (type === 'trio_023') return { x: ROULETTE_GEOMETRY.numberGrid.left, y: 156.5 };
  if (type === 'first_four') return { x: ROULETTE_GEOMETRY.numberGrid.left, y: ROULETTE_GEOMETRY.numberGrid.bottom };
  if (type.startsWith('dozen_')) return center(ROULETTE_GEOMETRY.dozens[Number(type.at(-1)) - 1]);
  if (type.startsWith('column_')) return center(ROULETTE_GEOMETRY.columns[Number(type.at(-1)) - 1]);
  if (ROULETTE_GEOMETRY.outside[type]) return center(ROULETTE_GEOMETRY.outside[type]);
  throw new Error(`Unknown roulette anchor: ${type}:${target}`);
}

const ROULETTE_ACTION_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Place Bet', value: 'place-bet', emoji: '<:PlaceBet:1538455949931450472>', description: 'Choose a roulette position and wager tokens.' }),
  Object.freeze({ label: 'Clear Bets', value: 'clear-bets', emoji: '<:ClearBet:1538455945598738482>', description: 'Refund and remove all of your bets before the spin.' }),
  Object.freeze({ label: 'Spin [Host only]', value: 'spin', emoji: '<:SpinRoulette:1538455952657748018>', description: 'Start the 10-second spin when all bettors are ready.' }),
  Object.freeze({ label: 'Cancel Table [Host only]', value: 'cancel', emoji: '<:CancelTable:1538455943304454205>', description: 'Close the table and refund all unresolved bets.' }),
]);

const ROULETTE_BET_OPTIONS = Object.freeze([
  ['Straight Up', 'straight', '<:StraightUp:1538461704017543168>', 'One exact number • pays 35:1 profit.'],
  ['Split', 'split', '<:Split:1538461701949624400>', 'Two adjacent numbers • pays 17:1 profit.'],
  ['Street', 'street', '<:Street:1538461705686753370>', 'One row of three numbers • pays 11:1.'],
  ['Corner', 'corner', '<:Corner:1538461685201772605>', 'Four touching numbers • pays 8:1.'],
  ['Six Line', 'six_line', '<:SixLine:1538461700162850877>', 'Two adjacent streets • pays 5:1.'],
  ['Trio 0-1-2', 'trio_012', '<:Trio:1538461709990109214>', 'Covers 0, 1 and 2 • pays 11:1.'],
  ['Trio 0-2-3', 'trio_023', '<:Trio:1538461709990109214>', 'Covers 0, 2 and 3 • pays 11:1.'],
  ['Basket 0-1-2-3', 'first_four', '<:Basket:1538461679237730394>', 'European first four • pays 8:1.'],
  ['1st Dozen', 'dozen_1', '<:Dozen:1538461687877861537>', 'Covers 1 through 12 • pays 2:1.'],
  ['2nd Dozen', 'dozen_2', '<:Dozen:1538461687877861537>', 'Covers 13 through 24 • pays 2:1.'],
  ['3rd Dozen', 'dozen_3', '<:Dozen:1538461687877861537>', 'Covers 25 through 36 • pays 2:1.'],
  ['Column 1', 'column_1', '<:Column:1538461683234644071>', 'Covers 1, 4, 7 … 34 • pays 2:1.'],
  ['Column 2', 'column_2', '<:Column:1538461683234644071>', 'Covers 2, 5, 8 … 35 • pays 2:1.'],
  ['Column 3', 'column_3', '<:Column:1538461683234644071>', 'Covers 3, 6, 9 … 36 • pays 2:1.'],
  ['Red', 'red', '<:Red:1538461698434924574>', 'Covers every red number • pays 1:1.'],
  ['Black', 'black', '<:Black:1538461681276157983>', 'Covers every black number • pays 1:1.'],
  ['Even', 'even', '<:Even:1538461690436259870>', 'Covers even numbers 2–36 • pays 1:1.'],
  ['Odd', 'odd', '<:Odd:1538461696711073822>', 'Covers odd numbers 1–35 • pays 1:1.'],
  ['Low', 'low', '<:Low:1538461694437892126>', 'Covers numbers 1–18 • pays 1:1.'],
  ['High', 'high', '<:High:1538461692416229437>', 'Covers numbers 19–36 • pays 1:1.'],
].map(([label, value, emoji, description]) => Object.freeze({ label, value, emoji, description })));

module.exports = {
  RED_NUMBERS,
  RED_NUMBER_SET,
  ROULETTE_ACTION_OPTIONS,
  ROULETTE_BET_OPTIONS,
  ROULETTE_CANVAS_HEIGHT,
  ROULETTE_CANVAS_WIDTH,
  ROULETTE_GEOMETRY,
  ROULETTE_IMAGE_DIRECTORY,
  ROULETTE_LIMITS,
  ROULETTE_MAX_PLAYERS,
  ROULETTE_RESULT_IMAGE_DIRECTORY,
  ROULETTE_SPIN_DURATION_MS,
  ROULETTE_STATES,
  ROULETTE_TABLE_ASSET,
  ROULETTE_TIMEOUTS,
  anchorFor,
  numberCoordinates,
};
