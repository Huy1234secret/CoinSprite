const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { loadImage } = require('@napi-rs/canvas');
const { RNG_GAME_COMMANDS, createRngGameFeature } = require('../src/features/rng-game');
const {
  RED_NUMBERS,
  ROULETTE_BET_OPTIONS,
  ROULETTE_CANVAS_HEIGHT,
  ROULETTE_CANVAS_WIDTH,
  ROULETTE_GEOMETRY,
  ROULETTE_IMAGE_DIRECTORY,
  ROULETTE_STATES,
  ROULETTE_TABLE_ASSET,
  anchorFor,
  numberCoordinates,
} = require('../src/features/rng-game/config/roulette');
const { initialRoulettePayload } = require('../src/features/rng-game/components/rouletteBuilders');
const { canonicalBet, rouletteColor, totalReturn } = require('../src/features/rng-game/services/rouletteRules');
const { CLUSTER_OFFSETS, CHIP_RADIUS, RouletteTableRenderer, clusteredBets } = require('../src/features/rng-game/services/rouletteRenderer');
const { SQLITE_INTEGER_MAX } = require('../src/features/rng-game/repositories/gameRepository');

let ids = 0;
function profile(userId) { return { userId, displayName: userId.toUpperCase(), avatarUrl: '' }; }
function feature(options = {}) {
  return createRngGameFeature({
    databasePath: ':memory:',
    rouletteCreateId: () => `roulette-${++ids}`,
    rouletteRenderer: options.rouletteRenderer,
    ...options,
  });
}
function fund(game, userId, amount = 2_000n) {
  game.repository.getPlayer(userId);
  game.db.prepare('UPDATE rng_players SET token_balance = ? WHERE user_id = ?').run(amount, userId);
}
function botTable(game, userId = 'host') {
  const created = game.rouletteService.createGame('guild', 'channel', profile(userId));
  assert.equal(created.status, 'ok');
  assert.equal(game.rouletteService.chooseMode(created.game.id, userId, 'bot').status, 'ok');
  return created.game.id;
}
function humanLobby(game, users) {
  const created = game.rouletteService.createGame('guild', 'channel', profile(users[0]));
  game.rouletteService.chooseMode(created.game.id, users[0], 'human');
  const invited = game.rouletteService.invite(created.game.id, users[0], users.slice(1).map(profile));
  assert.equal(invited.status, 'ok');
  return created.game.id;
}
function place(game, gameId, userId, type, target, amount, key) {
  return game.rouletteService.place(gameId, userId, type, target, String(amount), key || `${gameId}:${userId}:${type}:${target}:${Math.random()}`);
}

test('/g-roulette is registered with the exact description and initial Bot/Player experience', () => {
  const command = RNG_GAME_COMMANDS.find(({ data }) => data.name === 'g-roulette')?.data.toJSON();
  assert.equal(command.description, 'Play European Roulette with tokens.');
  const payload = initialRoulettePayload({ id: 'game', hostUserId: 'host' });
  const controls = payload.components[0].components;
  assert.equal(controls[0].content, '### Hey <@host>, Player or Bot?');
  const menu = controls.find((entry) => entry.type === 1).components[0];
  assert.equal(menu.custom_id, 'rng:roulette:mode:game');
  assert.equal(menu.placeholder, 'Select here');
  assert.deepEqual(menu.options.map(({ label, value }) => ({ label, value })), [{ label: 'Bot', value: 'bot' }, { label: 'Player', value: 'human' }]);
  assert.equal(ROULETTE_BET_OPTIONS.length, 20);
});

test('/g-roulette persists choosing mode and the Discord message id', async () => {
  const game = feature();
  let payload;
  assert.equal(await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'g-roulette',
    guildId: 'guild',
    channelId: 'channel',
    member: { displayName: 'Host' },
    user: { id: 'host', username: 'Host', displayAvatarURL: () => '' },
    reply: async (value) => { payload = value; },
    fetchReply: async () => ({ id: 'discord-message' }),
  }), true);
  const menu = payload.components[0].components.find((entry) => entry.type === 1).components[0];
  const created = game.rouletteService.game(menu.custom_id.split(':').at(-1));
  assert.equal(created.state, ROULETTE_STATES.CHOOSING_MODE);
  assert.equal(created.messageId, 'discord-message');
  game.close();
});

test('only the command invoker may choose Roulette mode', async () => {
  const game = feature();
  const created = game.rouletteService.createGame('guild', 'channel', profile('owner')).game;
  let reply;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    customId: `rng:roulette:mode:${created.id}`,
    values: ['bot'],
    user: { id: 'intruder' },
    reply: async (value) => { reply = value; },
  });
  assert.match(reply.components[0].components[0].content, /Only the command invoker/);
  assert.equal(game.rouletteService.game(created.id).mode, null);
  game.close();
});

test('roulette scheduler follows feature start and stop lifecycle', () => {
  const calls = [];
  const scheduler = { start: () => calls.push('start'), stop: () => calls.push('stop') };
  const game = feature({ rouletteExpiryScheduler: scheduler });
  game.startScheduler(null);
  game.close();
  assert.deepEqual(calls, ['start', 'stop']);
});

test('human lobby validates busy players, joins, removes waiters, and starts with two', () => {
  const game = feature();
  ['a', 'b', 'c', 'busy'].forEach((user) => fund(game, user));
  const busyGame = botTable(game, 'busy');
  const created = game.rouletteService.createGame('guild', 'channel', profile('a')).game;
  game.rouletteService.chooseMode(created.id, 'a', 'human');
  assert.equal(game.rouletteService.invite(created.id, 'a', [profile('a')]).status, 'invalid-participants');
  assert.equal(game.rouletteService.invite(created.id, 'a', [profile('b'), profile('b')]).status, 'invalid-participants');
  assert.equal(game.rouletteService.invite(created.id, 'a', [{ ...profile('b'), bot: true }]).status, 'invalid-participants');
  assert.equal(game.rouletteService.invite(created.id, 'a', [profile('busy')]).status, 'participant-busy');
  assert.equal(game.rouletteService.invite(created.id, 'a', [profile('b'), profile('c')]).status, 'ok');
  assert.equal(game.rouletteService.accept(created.id, 'b').status, 'ok');
  const started = game.rouletteService.start(created.id, 'a');
  assert.equal(started.status, 'started');
  assert.deepEqual(started.game.participants.map((entry) => entry.userId), ['a', 'b']);
  assert.equal(game.rouletteRepository.activeGameForUser('c'), null);
  game.rouletteService.cancel(busyGame);
  game.close();
});

test('decline and host cancellation release shared locks safely', () => {
  const game = feature();
  const id = humanLobby(game, ['a', 'b', 'c']);
  assert.equal(game.rouletteService.decline(id, 'c').status, 'declined');
  assert.equal(game.rouletteRepository.activeGameForUser('c'), null);
  const canceled = game.rouletteService.cancel(id);
  assert.equal(canceled.game.state, ROULETTE_STATES.CANCELED);
  assert.equal(game.rouletteRepository.activeGameForUser('a'), null);
  assert.equal(game.rouletteRepository.activeGameForUser('b'), null);
  game.close();
});

test('red, black, color, column orientation, coverage, and multipliers are canonical', () => {
  assert.deepEqual(RED_NUMBERS, [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  assert.equal(rouletteColor(0), 'green');
  assert.equal(rouletteColor(1), 'red');
  assert.equal(rouletteColor(2), 'black');
  assert.deepEqual(canonicalBet('column_1').covered, [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
  assert.deepEqual(canonicalBet('column_3').covered, [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]);
  const cases = [
    ['straight', '7', [7], 36n], ['split', '1,4', [1, 4], 18n], ['street', '1,2,3', [1, 2, 3], 12n],
    ['corner', '1,2,4,5', [1, 2, 4, 5], 9n], ['six_line', '1-6', [1, 2, 3, 4, 5, 6], 6n],
    ['trio_012', '', [0, 1, 2], 12n], ['trio_023', '', [0, 2, 3], 12n], ['first_four', '', [0, 1, 2, 3], 9n],
    ['dozen_2', '', Array.from({ length: 12 }, (_, i) => i + 13), 3n], ['red', '', RED_NUMBERS, 2n],
  ];
  for (const [type, target, covered, multiplier] of cases) {
    const result = canonicalBet(type, target);
    assert.deepEqual(result.covered, covered);
    assert.equal(result.multiplier, multiplier);
  }
});

test('every legal split, street, corner, and six line is accepted and illegal geometry rejected', () => {
  const splits = [['0', '1'], ['0', '2'], ['0', '3']];
  for (let first = 1; first <= 36; first += 1) {
    if (first % 3 !== 0) splits.push([String(first), String(first + 1)]);
    if (first <= 33) splits.push([String(first), String(first + 3)]);
  }
  assert.equal(splits.length, 60);
  splits.forEach(([a, b]) => assert.deepEqual(canonicalBet('split', `${a}-${b}`).covered, [Number(a), Number(b)]));
  for (let first = 1; first <= 34; first += 3) assert.equal(canonicalBet('street', String(first)).target, String(first));
  let corners = 0;
  for (let first = 1; first <= 32; first += 1) {
    if (first % 3 === 0) continue;
    assert.equal(canonicalBet('corner', `${first},${first + 1},${first + 3},${first + 4}`).covered.length, 4);
    corners += 1;
  }
  assert.equal(corners, 22);
  for (let first = 1; first <= 31; first += 3) assert.equal(canonicalBet('six_line', `${first}-${first + 5}`).target, String(first));
  ['1-5', '1-3', '0-4', '3-4'].forEach((target) => assert.throws(() => canonicalBet('split', target), RangeError));
  assert.throws(() => canonicalBet('corner', '1,2,5,6'), RangeError);
  assert.throws(() => canonicalBet('street', '2,3,4'), RangeError);
  assert.throws(() => canonicalBet('six_line', '4-12'), RangeError);
});

test('zero loses every outside bet and wins only canonical zero-area coverage', () => {
  for (const type of ['dozen_1', 'dozen_2', 'dozen_3', 'column_1', 'column_2', 'column_3', 'red', 'black', 'even', 'odd', 'low', 'high']) {
    assert.equal(totalReturn({ type, target: '', amount: 10n }, 0), 0n);
  }
  assert.equal(totalReturn({ type: 'straight', target: '0', amount: 10n }, 0), 360n);
  assert.equal(totalReturn({ type: 'trio_012', target: '', amount: 10n }, 0), 120n);
});

test('bet placement debits atomically, aggregates a position, and is idempotent', () => {
  const game = feature();
  fund(game, 'host', 100n);
  const id = botTable(game);
  const first = place(game, id, 'host', 'straight', '7', 10, 'place-1');
  assert.equal(first.status, 'ok');
  assert.equal(game.repository.getPlayer('host').tokenBalance, 90n);
  assert.equal(place(game, id, 'host', 'straight', '7', 10, 'place-1').duplicate, true);
  assert.equal(game.repository.getPlayer('host').tokenBalance, 90n);
  place(game, id, 'host', 'straight', '7', 20, 'place-2');
  const current = game.rouletteService.game(id);
  assert.equal(current.bets.length, 1);
  assert.equal(current.bets[0].amount, 30n);
  assert.equal(current.participants[0].escrowedTotal, 30n);
  assert.equal(game.repository.getPlayer('host').tokenBalance, 70n);
  game.close();
});

test('insufficient, individual, total, and distinct-position limits change nothing', () => {
  const game = feature();
  fund(game, 'host', 2_000n);
  const id = botTable(game);
  assert.throws(() => place(game, id, 'host', 'straight', '1', 1001, 'too-large'), RangeError);
  for (let number = 1; number <= 12; number += 1) assert.equal(place(game, id, 'host', 'straight', String(number), 1, `position-${number}`).status, 'ok');
  assert.equal(place(game, id, 'host', 'straight', '13', 1, 'position-13').status, 'position-limit');
  assert.equal(place(game, id, 'host', 'straight', '12', 988, 'cap-total').status, 'ok');
  assert.equal(place(game, id, 'host', 'straight', '12', 1, 'over-total').status, 'total-limit');
  assert.equal(game.rouletteService.game(id).participants[0].escrowedTotal, 1_000n);
  game.rouletteService.clear(id, 'host', 'clear-cap');
  game.db.prepare('UPDATE rng_players SET token_balance = 0 WHERE user_id = ?').run('host');
  assert.equal(place(game, id, 'host', 'straight', '1', 1, 'insufficient').status, 'insufficient');
  assert.equal(game.rouletteService.game(id).bets.filter((entry) => entry.state === 'OPEN').length, 0);
  game.close();
});

test('undo refunds exactly the last delta and clear refunds once while allowing a fresh same-position bet', () => {
  const game = feature();
  fund(game, 'host', 100n);
  const id = botTable(game);
  place(game, id, 'host', 'red', '', 10, 'red-1');
  place(game, id, 'host', 'red', '', 20, 'red-2');
  assert.equal(game.rouletteService.undo(id, 'host', 'undo-1').amount, 20n);
  assert.equal(game.rouletteService.game(id).bets[0].amount, 10n);
  assert.equal(game.rouletteService.undo(id, 'host', 'undo-1').duplicate, true);
  assert.equal(game.rouletteService.clear(id, 'host', 'clear-1').amount, 10n);
  assert.equal(game.rouletteService.clear(id, 'host', 'clear-1').duplicate, true);
  assert.equal(game.repository.getPlayer('host').tokenBalance, 100n);
  assert.equal(place(game, id, 'host', 'red', '', 5, 'red-fresh').status, 'ok');
  assert.equal(game.rouletteService.game(id).bets.find((entry) => entry.state === 'OPEN').amount, 5n);
  game.close();
});

test('changing bets clears readiness and all participants must bet and ready before spin', () => {
  const game = feature({ rouletteRandomInt: () => 36 });
  ['a', 'b'].forEach((user) => fund(game, user, 100n));
  const id = humanLobby(game, ['a', 'b']);
  game.rouletteService.accept(id, 'b');
  game.rouletteService.start(id, 'a');
  place(game, id, 'a', 'red', '', 10, 'a-red');
  place(game, id, 'b', 'black', '', 10, 'b-black');
  game.rouletteService.setReady(id, 'a', true);
  assert.equal(game.rouletteService.spin(id, 'a').status, 'not-ready');
  game.rouletteService.setReady(id, 'b', true);
  place(game, id, 'a', 'even', '', 1, 'a-even');
  assert.equal(game.rouletteService.game(id).participants.find((entry) => entry.userId === 'a').ready, false);
  game.rouletteService.setReady(id, 'a', true);
  assert.equal(game.rouletteService.spin(id, 'a').status, 'ok');
  game.close();
});

test('multiplayer settlement is independent, sums multiple wins, and duplicate spin never repays', () => {
  const game = feature({ rouletteRandomInt: () => 1 });
  ['a', 'b'].forEach((user) => fund(game, user, 1_000n));
  const id = humanLobby(game, ['a', 'b']);
  game.rouletteService.accept(id, 'b');
  game.rouletteService.start(id, 'a');
  place(game, id, 'a', 'straight', '1', 10, 'a-straight');
  place(game, id, 'a', 'red', '', 20, 'a-red');
  place(game, id, 'b', 'black', '', 30, 'b-black');
  game.rouletteService.setReady(id, 'a', true);
  game.rouletteService.setReady(id, 'b', true);
  const result = game.rouletteService.spin(id, 'a');
  assert.equal(result.game.winningNumber, 1);
  assert.equal(game.repository.getPlayer('a').tokenBalance, 1_370n);
  assert.equal(game.repository.getPlayer('b').tokenBalance, 970n);
  const paid = game.repository.getPlayer('a').tokenBalance;
  assert.equal(game.rouletteService.spin(id, 'a').duplicate, true);
  assert.equal(game.repository.getPlayer('a').tokenBalance, paid);
  assert.equal(game.rouletteRepository.activeGameForUser('a'), null);
  game.close();
});

test('RNG boundaries 0 and 36 persist with correct colors', () => {
  for (const result of [0, 36]) {
    const game = feature({ rouletteRandomInt: (maximum) => { assert.equal(maximum, 37); return result; } });
    const user = `boundary-${result}`;
    fund(game, user, 100n);
    const id = botTable(game, user);
    place(game, id, user, 'straight', String(result), 1, `boundary-bet-${result}`);
    game.rouletteService.setReady(id, user, true);
    const spun = game.rouletteService.spin(id, user).game;
    assert.equal(spun.winningNumber, result);
    assert.equal(spun.winningColor, result === 0 ? 'green' : 'red');
    game.close();
  }
});

test('cancel, expiry, and guest leave refund unresolved escrow exactly once', () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  ['a', 'b', 'c', 'solo'].forEach((user) => fund(game, user, 100n));
  const id = humanLobby(game, ['a', 'b', 'c']);
  game.rouletteService.accept(id, 'b'); game.rouletteService.accept(id, 'c'); game.rouletteService.start(id, 'a');
  place(game, id, 'a', 'red', '', 10, 'leave-a');
  place(game, id, 'b', 'black', '', 20, 'leave-b');
  place(game, id, 'c', 'odd', '', 30, 'leave-c');
  assert.equal(game.rouletteService.leave(id, 'c', 'leave-op').status, 'ok');
  assert.equal(game.repository.getPlayer('c').tokenBalance, 100n);
  assert.equal(game.repository.getPlayer('a').tokenBalance, 90n);
  assert.equal(game.rouletteService.cancel(id).duplicate, false);
  assert.equal(game.rouletteService.cancel(id).duplicate, true);
  assert.equal(game.repository.getPlayer('a').tokenBalance, 100n);
  assert.equal(game.repository.getPlayer('b').tokenBalance, 100n);
  const solo = botTable(game, 'solo');
  place(game, solo, 'solo', 'red', '', 10, 'expire-bet');
  now += 11 * 60 * 1_000;
  assert.equal(game.rouletteService.expireDue().length, 1);
  assert.equal(game.rouletteService.expireDue().length, 0);
  assert.equal(game.repository.getPlayer('solo').tokenBalance, 100n);
  game.close();
});

test('spin acknowledgement failure leaves result, escrow, and balance unchanged', async () => {
  const game = feature({ rouletteRandomInt: () => 7, rouletteRenderer: { render: async () => Buffer.from('png'), clear() {} } });
  fund(game, 'host', 100n);
  const id = botTable(game);
  place(game, id, 'host', 'straight', '7', 10, 'ack-bet');
  game.rouletteService.setReady(id, 'host', true);
  const interaction = {
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `rng:roulette:spin:${id}`,
    user: { id: 'host' },
    deferUpdate: async () => { const error = new Error('Unknown interaction'); error.code = 10062; throw error; },
  };
  assert.equal(await game.handleInteraction(interaction), true);
  assert.equal(game.rouletteService.game(id).state, ROULETTE_STATES.BETTING);
  assert.equal(game.repository.getPlayer('host').tokenBalance, 90n);
  game.close();
});

test('overflow during settlement rolls the whole transaction back', () => {
  const game = feature({ rouletteRandomInt: () => 1 });
  fund(game, 'host', SQLITE_INTEGER_MAX);
  const id = botTable(game);
  place(game, id, 'host', 'straight', '1', 1, 'overflow-bet');
  game.rouletteService.setReady(id, 'host', true);
  assert.throws(() => game.rouletteService.spin(id, 'host'), /signed 64-bit/);
  assert.equal(game.rouletteService.game(id).state, ROULETTE_STATES.BETTING);
  assert.equal(game.repository.getPlayer('host').tokenBalance, SQLITE_INTEGER_MAX - 1n);
  game.close();
});

test('RPS and Roulette share one authoritative active-player lock', () => {
  const game = feature();
  fund(game, 'roulette'); fund(game, 'rps');
  const roulette = botTable(game, 'roulette');
  assert.equal(game.rpsService.createGame('guild', 'channel', profile('roulette')).status, 'already-active');
  const rps = game.rpsService.createGame('guild', 'channel', profile('rps'));
  assert.equal(rps.status, 'ok');
  assert.equal(game.rouletteService.createGame('guild', 'channel', profile('rps')).status, 'already-active');
  game.rouletteService.cancel(roulette);
  assert.equal(game.rpsService.createGame('guild', 'channel', profile('roulette')).status, 'ok');
  game.rpsService.cancel(rps.game.id);
  game.close();
});

test('asset, output, anchors, clusters, and deterministic rendering match the 1568x700 table', async () => {
  const sourcePath = path.join(ROULETTE_IMAGE_DIRECTORY, ROULETTE_TABLE_ASSET);
  assert.equal(fs.existsSync(sourcePath), true);
  const source = await loadImage(sourcePath);
  assert.deepEqual([source.width, source.height], [ROULETTE_CANVAS_WIDTH, ROULETTE_CANVAS_HEIGHT]);
  for (let number = 1; number <= 36; number += 1) {
    const point = numberCoordinates(number);
    assert.ok(point.x > point.bounds.left && point.x < point.bounds.right);
    assert.ok(point.y > point.bounds.top && point.y < point.bounds.bottom);
  }
  const split = anchorFor('split', '1-4');
  assert.ok(Math.abs(split.x - numberCoordinates(1).bounds.right) < 1);
  const corner = anchorFor('corner', '1-2-4-5');
  assert.ok(Math.abs(corner.x - numberCoordinates(1).bounds.right) < 1);
  assert.ok(Math.abs(corner.y - numberCoordinates(1).bounds.top) < 1);
  for (const type of ['dozen_1', 'dozen_2', 'dozen_3', 'column_1', 'column_2', 'column_3', 'low', 'even', 'red', 'black', 'odd', 'high']) {
    const point = anchorFor(type, type);
    assert.ok(point.x >= 0 && point.x < ROULETTE_CANVAS_WIDTH && point.y >= 0 && point.y < ROULETTE_CANVAS_HEIGHT);
  }
  for (const offsets of Object.values(CLUSTER_OFFSETS)) for (const [x, y] of offsets) assert.ok(Math.hypot(x, y) >= (offsets.length === 1 ? 0 : CHIP_RADIUS));
  const state = {
    id: 'render', state: ROULETTE_STATES.BETTING, winningNumber: null,
    participants: Array.from({ length: 4 }, (_, seat) => ({ ...profile(`p${seat}`), seat })),
    bets: Array.from({ length: 4 }, (_, seat) => ({ ...canonicalBet('red'), id: String(seat), userId: `p${seat}`, amount: 10n, state: 'OPEN', createdSequence: seat + 1 })),
  };
  const positions = clusteredBets(state);
  assert.equal(new Set(positions.map(({ x, y }) => `${x}:${y}`)).size, 4);
  const renderer = new RouletteTableRenderer();
  const first = await renderer.render(state);
  const second = await renderer.render(state);
  assert.deepEqual(first, second);
  assert.deepEqual([...first.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const decoded = await loadImage(first);
  assert.deepEqual([decoded.width, decoded.height], [ROULETTE_CANVAS_WIDTH, ROULETTE_CANVAS_HEIGHT]);
  renderer.clear();
});

test('finished render includes zero treatment and retry rendering never mutates finance', async () => {
  const renderer = new RouletteTableRenderer();
  const state = {
    id: 'zero', state: ROULETTE_STATES.FINISHED, winningNumber: 0, winningColor: 'green',
    participants: [{ ...profile('p0'), seat: 0 }],
    bets: [
      { ...canonicalBet('straight', '0'), id: '1', userId: 'p0', amount: 10n, state: 'SETTLED', createdSequence: 1 },
      { ...canonicalBet('red'), id: '2', userId: 'p0', amount: 10n, state: 'SETTLED', createdSequence: 2 },
    ],
  };
  const base = await loadImage(await renderer.render({ ...state, state: ROULETTE_STATES.BETTING, winningNumber: null }));
  const finished = await loadImage(await renderer.render(state));
  const canvas = require('@napi-rs/canvas').createCanvas(ROULETTE_CANVAS_WIDTH, ROULETTE_CANVAS_HEIGHT);
  const context = canvas.getContext('2d');
  context.drawImage(base, 0, 0); const before = context.getImageData(90, 170, 90, 150).data;
  context.clearRect(0, 0, ROULETTE_CANVAS_WIDTH, ROULETTE_CANVAS_HEIGHT);
  context.drawImage(finished, 0, 0); const after = context.getImageData(90, 170, 90, 150).data;
  assert.notDeepEqual([...after], [...before]);
  renderer.clear();

  const game = feature({ rouletteRenderer: { render: async () => { throw new Error('render failed'); }, clear() {} } });
  fund(game, 'host', 100n);
  const id = botTable(game);
  place(game, id, 'host', 'red', '', 10, 'retry-bet');
  const beforeBalance = game.repository.getPlayer('host').tokenBalance;
  const beforeRevision = game.rouletteService.game(id).revision;
  let edited;
  await game.handleInteraction({
    id: 'retry-interaction', isChatInputCommand: () => false, isButton: () => true,
    customId: `rng:roulette:retry:${id}`, user: { id: 'host' }, deferUpdate: async () => {},
    editReply: async (payload) => { edited = payload; },
  });
  assert.match(edited.components[0].components[0].content, /image unavailable/);
  assert.equal(game.repository.getPlayer('host').tokenBalance, beforeBalance);
  assert.equal(game.rouletteService.game(id).revision, beforeRevision);
  game.close();
});

test('serialized renders suppress an older revision edit', async () => {
  let release;
  let calls = 0;
  const renderer = {
    async render() {
      calls += 1;
      if (calls === 1) await new Promise((resolve) => { release = resolve; });
      return Buffer.from('png');
    },
    clear() {},
  };
  const game = feature({ rouletteRenderer: renderer });
  fund(game, 'host', 100n);
  const id = botTable(game);
  place(game, id, 'host', 'red', '', 10, 'serial-bet');
  const edits = [];
  const interaction = (interactionId, action) => ({
    id: interactionId, isChatInputCommand: () => false, isButton: () => true,
    customId: `rng:roulette:${action}:${id}`, user: { id: 'host' }, deferUpdate: async () => {},
    editReply: async (payload) => edits.push(payload.files?.[0]?.name || 'failure'),
  });
  const first = game.handleInteraction(interaction('ready-one', 'ready'));
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const second = game.handleInteraction(interaction('ready-two', 'unready'));
  while (game.rouletteService.game(id).revision < 4) await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  const revision = game.rouletteService.game(id).revision;
  assert.deepEqual(edits, [`roulette-${id}-${revision}.png`]);
  game.close();
});
