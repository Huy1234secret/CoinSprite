const fs = require('fs');
const path = require('path');
const { ROULETTE_STATES } = require('../src/features/rng-game/config/roulette');
const { canonicalBet } = require('../src/features/rng-game/services/rouletteRules');
const { RouletteTableRenderer } = require('../src/features/rng-game/services/rouletteRenderer');

const participants = ['Blue', 'Pink', 'Lime', 'Purple'].map((displayName, seat) => ({
  userId: `preview-${seat}`,
  seat,
  displayName,
  avatarUrl: '',
  accepted: true,
  ready: true,
  escrowedTotal: 100n,
  resultStake: 100n,
  resultReturn: seat === 0 ? 200n : 0n,
  resultNet: seat === 0 ? 100n : -100n,
}));

function bet(userId, type, target, index) {
  const value = canonicalBet(type, target);
  return { id: String(index + 1), userId, type: value.type, target: value.target, anchorKey: value.anchorKey, amount: 10n, state: 'OPEN', createdSequence: index + 1 };
}

function game(id, bets, options = {}) {
  return {
    id,
    guildId: 'preview',
    channelId: 'preview',
    hostUserId: participants[0].userId,
    mode: null,
    state: options.finished ? ROULETTE_STATES.FINISHED : ROULETTE_STATES.BETTING,
    winningNumber: options.finished ? options.winningNumber : null,
    winningColor: options.finished ? options.winningColor : null,
    revision: 1,
    participants,
    bets: bets.map((entry) => ({ ...entry, state: options.finished ? 'SETTLED' : entry.state })),
  };
}

function straightBets() {
  return Array.from({ length: 37 }, (_, number) => bet(participants[number % 4].userId, 'straight', String(number), number));
}

function insideBets() {
  const specs = [];
  for (let first = 1; first <= 36; first += 1) {
    if (first % 3 !== 0) specs.push(['split', `${first}-${first + 1}`]);
    if (first <= 33) specs.push(['split', `${first}-${first + 3}`]);
  }
  specs.push(['split', '0-1'], ['split', '0-2'], ['split', '0-3']);
  for (let first = 1; first <= 34; first += 3) specs.push(['street', String(first)]);
  for (let first = 1; first <= 32; first += 1) {
    if (first % 3 !== 0) specs.push(['corner', `${first},${first + 1},${first + 3},${first + 4}`]);
  }
  for (let first = 1; first <= 31; first += 3) specs.push(['six_line', String(first)]);
  specs.push(['trio_012', ''], ['trio_023', ''], ['first_four', '']);
  return specs.map(([type, target], index) => bet(participants[index % 4].userId, type, target, index));
}

function outsideBets() {
  return ['dozen_1', 'dozen_2', 'dozen_3', 'column_1', 'column_2', 'column_3', 'red', 'black', 'even', 'odd', 'low', 'high']
    .map((type, index) => bet(participants[index % 4].userId, type, '', index));
}

async function main() {
  const outputDirectory = path.resolve(process.argv[2] || path.join('work', 'roulette-previews'));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const renderer = new RouletteTableRenderer();
  const sparse = [
    bet(participants[0].userId, 'straight', '17', 0),
    bet(participants[1].userId, 'split', '20-23', 1),
    bet(participants[2].userId, 'red', '', 2),
  ];
  const stacked = participants.map((participant, index) => bet(participant.userId, 'red', '', index));
  const denseSpecs = [
    ['straight', '0'], ['straight', '17'], ['straight', '32'], ['split', '8-11'],
    ['split', '22-23'], ['street', '13'], ['corner', '19,20,22,23'], ['six_line', '25'],
    ['trio_012', ''], ['first_four', ''], ['dozen_2', ''], ['column_1', ''],
    ['red', ''], ['black', ''], ['even', ''], ['high', ''],
  ].map(([type, target], index) => bet(participants[index % 4].userId, type, target, index));
  const finished = [
    bet(participants[0].userId, 'straight', '17', 0),
    bet(participants[0].userId, 'black', '', 1),
    bet(participants[1].userId, 'red', '', 2),
    bet(participants[2].userId, 'odd', '', 3),
    bet(participants[3].userId, 'column_2', '', 4),
  ];
  const previews = [
    ['00-sparse-table.png', game('sparse-table', sparse), false],
    ['01-straight-anchors.png', game('straight-anchors', straightBets()), true],
    ['02-inside-anchors.png', game('inside-anchors', insideBets()), true],
    ['03-outside-bets.png', game('outside-bets', outsideBets()), true],
    ['04-four-user-stack.png', game('four-user-stack', stacked), false],
    ['05-dense-table.png', game('dense-table', denseSpecs), false],
    ['06-finished-result.png', game('finished-result', finished, { finished: true, winningNumber: 17, winningColor: 'black' }), false],
  ];
  for (const [filename, state, guides] of previews) {
    fs.writeFileSync(path.join(outputDirectory, filename), await renderer.render(state, { guides }));
  }
  renderer.clear();
  console.log(`Roulette previews written to ${outputDirectory}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
