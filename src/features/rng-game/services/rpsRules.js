const MOVES = Object.freeze(['rock', 'paper', 'scissors']);
const MOVE_SET = new Set(MOVES);
const BEATS = Object.freeze({ rock: 'scissors', scissors: 'paper', paper: 'rock' });
const MIN_BET = 1n;
const MAX_BET = 1_000n;

function validMove(move) {
  return MOVE_SET.has(String(move));
}

function parseBet(value) {
  const input = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(input)) {
    throw new RangeError('Enter a whole number from 1 through 1000.');
  }
  const bet = BigInt(input);
  if (bet < MIN_BET || bet > MAX_BET) {
    throw new RangeError('Bet must be from 1 through 1000 tokens.');
  }
  return bet;
}

function payoutFor(bet, participantCount) {
  const stake = parseBet(bet);
  const count = BigInt(participantCount);
  if (count < 2n || count > 4n) throw new RangeError('RPS tables require two to four participants.');
  return stake * count;
}

function resolveRps(choices) {
  if (!Array.isArray(choices) || choices.length < 2 || choices.length > 4 || choices.some((choice) => !validMove(choice))) {
    throw new RangeError('RPS results require two to four valid choices.');
  }
  const gestures = [...new Set(choices)];
  if (gestures.length !== 2) return { type: 'draw', winnerIndex: null, winningMove: null };
  const [first, second] = gestures;
  const winningMove = BEATS[first] === second ? first : second;
  const winnerIndexes = choices
    .map((choice, index) => (choice === winningMove ? index : -1))
    .filter((index) => index >= 0);
  if (winnerIndexes.length !== 1) return { type: 'draw', winnerIndex: null, winningMove };
  return { type: 'winner', winnerIndex: winnerIndexes[0], winningMove };
}

module.exports = {
  BEATS,
  MAX_BET,
  MIN_BET,
  MOVES,
  parseBet,
  payoutFor,
  resolveRps,
  validMove,
};
