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
  ROULETTE_RESULT_IMAGE_DIRECTORY,
  ROULETTE_SPIN_DURATION_MS,
  ROULETTE_STATES,
  ROULETTE_TABLE_ASSET,
  anchorFor,
  numberCoordinates,
} = require('../src/features/rng-game/config/roulette');
const { initialRoulettePayload } = require('../src/features/rng-game/components/rouletteBuilders');
const { canonicalBet, rouletteColor, totalReturn } = require('../src/features/rng-game/services/rouletteRules');
const { CLUSTER_OFFSETS, CHIP_RADIUS, RouletteTableRenderer, clusteredBets } = require('../src/features/rng-game/services/rouletteRenderer');
const { rouletteResultAssetPath, rouletteSpinAssetPath } = require('../src/features/rng-game/services/rouletteMedia');
const { RouletteRevealScheduler } = require('../src/features/rng-game/services/rouletteService');
const { SQLITE_INTEGER_MAX } = require('../src/features/rng-game/repositories/gameRepository');
const { openDatabase } = require('../src/features/rng-game/repositories/database');

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

test('roulette expiry and reveal schedulers follow feature start and stop lifecycle', () => {
  const calls = [];
  const expiry = { start: () => calls.push('expiry-start'), stop: () => calls.push('expiry-stop') };
  const reveal = { schedule: () => {}, start: () => calls.push('reveal-start'), stop: () => calls.push('reveal-stop') };
  const game = feature({ rouletteExpiryScheduler: expiry, rouletteRevealScheduler: reveal });
  game.startScheduler(null);
  game.close();
  assert.deepEqual(calls, ['expiry-start', 'reveal-start', 'expiry-stop', 'reveal-stop']);
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
  assert.equal(totalReturn({ type: 'split', target: '17-20', amount: 10n }, 17), 180n);
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
  const game = feature({ clock: () => 1_000, rouletteRandomInt: () => 36 });
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
  const spun = game.rouletteService.beginSpin(id, 'a');
  assert.equal(spun.status, 'ok');
  assert.equal(spun.game.state, ROULETTE_STATES.SPINNING);
  assert.equal(spun.game.spinStartedAt, 1_000);
  assert.equal(spun.game.revealAt, 1_000 + ROULETTE_SPIN_DURATION_MS);
  game.close();
});

test('BETTING stays manual and only the host can select an outcome', () => {
  let now = 1_000;
  let rngCalls = 0;
  const game = feature({ clock: () => now, rouletteRandomInt: () => { rngCalls += 1; return 17; } });
  fund(game, 'host', 100n);
  const id = botTable(game);
  place(game, id, 'host', 'straight', '17', 10, 'manual-bet');
  game.rouletteService.setReady(id, 'host', true);
  now += 5_000;
  assert.equal(game.rouletteService.game(id).state, ROULETTE_STATES.BETTING);
  assert.equal(game.rouletteService.spinningGames().length, 0);
  assert.equal(rngCalls, 0);
  assert.equal(game.rouletteService.beginSpin(id, 'intruder').status, 'unauthorized');
  assert.equal(game.rouletteService.game(id).state, ROULETTE_STATES.BETTING);
  assert.equal(rngCalls, 0);
  game.close();
});

test('multiplayer settlement is independent, sums multiple wins, and duplicate spin never repays', () => {
  let now = 1_000;
  let rngCalls = 0;
  const game = feature({ clock: () => now, rouletteRandomInt: () => { rngCalls += 1; return 1; } });
  ['a', 'b'].forEach((user) => fund(game, user, 1_000n));
  const id = humanLobby(game, ['a', 'b']);
  game.rouletteService.accept(id, 'b');
  game.rouletteService.start(id, 'a');
  place(game, id, 'a', 'straight', '1', 10, 'a-straight');
  place(game, id, 'a', 'red', '', 20, 'a-red');
  place(game, id, 'b', 'black', '', 30, 'b-black');
  game.rouletteService.setReady(id, 'a', true);
  game.rouletteService.setReady(id, 'b', true);
  const result = game.rouletteService.beginSpin(id, 'a');
  assert.equal(result.game.winningNumber, 1);
  assert.equal(result.game.state, ROULETTE_STATES.SPINNING);
  assert.equal(rngCalls, 1);
  assert.equal(game.repository.getPlayer('a').tokenBalance, 970n);
  assert.equal(game.repository.getPlayer('b').tokenBalance, 970n);
  assert.equal(game.rouletteRepository.activeGameForUser('a').state, ROULETTE_STATES.SPINNING);
  assert.equal(game.rouletteService.finishSpin(id).status, 'not-due');
  assert.equal(game.rouletteService.beginSpin(id, 'a').duplicate, true);
  assert.equal(rngCalls, 1);
  assert.equal(game.rouletteService.undo(id, 'a', 'spin-undo').status, 'stale');
  assert.equal(game.rouletteService.clear(id, 'a', 'spin-clear').status, 'stale');
  assert.equal(game.rouletteService.setReady(id, 'a', false, 'spin-unready').status, 'stale');
  assert.equal(game.rouletteService.leave(id, 'b', 'spin-leave').status, 'stale');
  assert.equal(game.rouletteService.cancel(id).status, 'stale');
  assert.equal(game.repository.getPlayer('a').tokenBalance, 970n);
  now += ROULETTE_SPIN_DURATION_MS;
  assert.equal(game.rouletteService.expireDue().length, 0);
  assert.equal(game.rouletteService.finishSpin(id).status, 'ok');
  assert.equal(game.repository.getPlayer('a').tokenBalance, 1_370n);
  assert.equal(game.repository.getPlayer('b').tokenBalance, 970n);
  const paid = game.repository.getPlayer('a').tokenBalance;
  assert.equal(game.rouletteService.finishSpin(id).duplicate, true);
  assert.equal(game.repository.getPlayer('a').tokenBalance, paid);
  assert.equal(rngCalls, 1);
  assert.equal(game.rouletteRepository.activeGameForUser('a'), null);
  now += 60_000;
  assert.equal(game.rouletteService.expireDue().length, 0);
  assert.equal(game.rouletteService.game(id).state, ROULETTE_STATES.FINISHED);
  assert.equal(game.rouletteService.replay(id, 'b').status, 'stale');
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

test('manual Spin shows the matching neutral GIF, then the stored result PNG and host controls', async () => {
  let now = 1_000;
  let rngCalls = 0;
  let scheduled;
  const revealScheduler = {
    schedule: (game) => { scheduled = game; },
    start() {},
    stop() {},
  };
  const game = feature({
    clock: () => now,
    rouletteRandomInt: () => { rngCalls += 1; return 17; },
    rouletteRevealScheduler: revealScheduler,
  });
  fund(game, 'host', 100n);
  const id = botTable(game);
  place(game, id, 'host', 'straight', '17', 10, 'media-bet');
  game.rouletteService.setReady(id, 'host', true);

  let denied;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `rng:roulette:spin:${id}`,
    user: { id: 'intruder' },
    reply: async (payload) => { denied = payload; },
  });
  assert.match(denied.components[0].components[0].content, /Only the command invoker/);
  assert.equal(rngCalls, 0);

  let spinningPayload;
  await game.handleInteraction({
    id: 'host-spin',
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `rng:roulette:spin:${id}`,
    user: { id: 'host' },
    deferUpdate: async () => {},
    editReply: async (payload) => { spinningPayload = payload; },
  });
  const spinning = game.rouletteService.game(id);
  assert.equal(spinning.state, ROULETTE_STATES.SPINNING);
  assert.equal(spinning.winningNumber, 17);
  assert.equal(spinning.revealAt - spinning.spinStartedAt, ROULETTE_SPIN_DURATION_MS);
  assert.equal(scheduled.id, id);
  assert.equal(rngCalls, 1);
  assert.equal(game.repository.getPlayer('host').tokenBalance, 90n);
  assert.equal(spinningPayload.files[0].name, `roulette-spin-${id}-v${spinning.revision}.gif`);
  assert.deepEqual(spinningPayload.files[0].attachment.subarray(0, 3), Buffer.from('GIF'));
  const spinComponents = spinningPayload.components[0].components;
  assert.equal(spinComponents.find((entry) => entry.type === 12).items.length, 1);
  assert.deepEqual(spinComponents.flatMap((entry) => entry.components || []).map((entry) => entry.label), ['Rules']);
  assert.equal(path.basename(rouletteSpinAssetPath(spinning)), '17.gif');

  let blocked;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `rng:roulette:cancel:${id}`,
    user: { id: 'host' },
    reply: async (payload) => { blocked = payload; },
  });
  assert.match(blocked.components[0].components[0].content, /No controls can change/);
  assert.equal(game.repository.getPlayer('host').tokenBalance, 90n);

  now += ROULETTE_SPIN_DURATION_MS;
  assert.equal(game.rouletteService.finishSpin(id).status, 'ok');
  game.rouletteService.randomInt = () => { throw new Error('finishSpin must not call RNG'); };
  assert.equal(game.rouletteService.finishSpin(id).duplicate, true);
  let resultPayload;
  await game.handleInteraction({
    id: 'result-retry',
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `rng:roulette:retry:${id}`,
    user: { id: 'host' },
    deferUpdate: async () => {},
    editReply: async (payload) => { resultPayload = payload; },
  });
  const finished = game.rouletteService.game(id);
  assert.equal(finished.state, ROULETTE_STATES.FINISHED);
  assert.equal(resultPayload.files[0].name, `roulette-result-17-${id}-v${finished.revision}.png`);
  assert.deepEqual([...resultPayload.files[0].attachment.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(path.basename(rouletteResultAssetPath(finished)), '17.png');
  assert.match(resultPayload.components[0].components[0].content, /Roulette Result: 17 black/);
  assert.deepEqual(resultPayload.components[0].components.flatMap((entry) => entry.components || []).map((entry) => entry.label), ['Play Again', 'New Bets', 'Rules']);
  assert.equal(rngCalls, 1);
  now += 60_000;
  assert.equal(game.rouletteService.game(id).state, ROULETTE_STATES.FINISHED);
  let replayDenied;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `rng:roulette:new-bets:${id}`,
    user: { id: 'intruder' },
    reply: async (payload) => { replayDenied = payload; },
  });
  assert.match(replayDenied.components[0].components[0].content, /Only the command invoker/);
  assert.equal(game.rouletteService.game(id).state, ROULETTE_STATES.FINISHED);
  await game.handleInteraction({
    id: 'host-replay',
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `rng:roulette:replay:${id}`,
    user: { id: 'host' },
    deferUpdate: async () => {},
    editReply: async () => {},
  });
  const replayed = game.rouletteService.game(id);
  assert.equal(replayed.state, ROULETTE_STATES.BETTING);
  assert.equal(replayed.winningNumber, null);
  assert.equal(replayed.spinStartedAt, null);
  assert.equal(replayed.revealAt, null);
  game.close();
});

test('a slow GIF message edit cannot overwrite the final PNG', async () => {
  let now = 1_000;
  let releaseGif;
  const edits = [];
  const message = {
    edit: async (payload) => { edits.push(payload.files[0].name); },
  };
  const client = {
    channels: { fetch: async () => ({ messages: { fetch: async () => message } }) },
  };
  const game = feature({ client, clock: () => now, rouletteRandomInt: () => 5 });
  fund(game, 'host', 100n);
  const id = botTable(game);
  game.rouletteRepository.setMessage(id, 'discord-message', now);
  place(game, id, 'host', 'straight', '5', 1, 'slow-gif-bet');
  game.rouletteService.setReady(id, 'host', true);
  const spin = game.handleInteraction({
    id: 'slow-spin',
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `rng:roulette:spin:${id}`,
    user: { id: 'host' },
    deferUpdate: async () => {},
    editReply: async (payload) => {
      edits.push(payload.files[0].name);
      await new Promise((resolve) => { releaseGif = resolve; });
    },
  });
  while (!releaseGif) await new Promise((resolve) => setImmediate(resolve));
  now += ROULETTE_SPIN_DURATION_MS;
  const finish = game.rouletteRevealScheduler.finish(id);
  while (game.rouletteService.game(id).state !== ROULETTE_STATES.FINISHED) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(edits.length, 1);
  releaseGif();
  await spin;
  await finish;
  assert.match(edits[0], /roulette-spin/);
  assert.match(edits[1], /roulette-result-5/);
  game.close();
});

test('reveal recovery preserves the original deadline before restart and settles overdue spins after restart', async () => {
  let now = 1_000;
  const db = openDatabase({ databasePath: ':memory:' });
  const idleScheduler = { schedule() {}, start() {}, stop() {} };
  const original = feature({ db, clock: () => now, rouletteRandomInt: () => 8, rouletteRevealScheduler: idleScheduler });
  fund(original, 'restart-host', 100n);
  const id = botTable(original, 'restart-host');
  place(original, id, 'restart-host', 'straight', '8', 1, 'restart-bet');
  original.rouletteService.setReady(id, 'restart-host', true);
  const started = original.rouletteService.beginSpin(id, 'restart-host').game;
  assert.equal(started.revealAt, 9_000);
  original.close();

  now = 5_000;
  const recovered = feature({
    db,
    clock: () => now,
    rouletteRandomInt: () => { throw new Error('recovery must not reroll'); },
    rouletteRevealScheduler: idleScheduler,
  });
  const timerCalls = [];
  const restored = [];
  const revealed = [];
  const scheduler = new RouletteRevealScheduler({
    service: recovered.rouletteService,
    notifySpinning: async (game) => restored.push([game.id, game.winningNumber, game.revealAt]),
    notifyFinished: async (game) => revealed.push([game.id, game.winningNumber]),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timerCalls.push(timer);
      return timer;
    },
    clearTimer: () => {},
  });
  await scheduler.recover();
  assert.deepEqual(restored, [[id, 8, 9_000]]);
  assert.equal(timerCalls.at(-1).delay, 4_000);
  assert.equal(recovered.rouletteService.game(id).state, ROULETTE_STATES.SPINNING);
  now = 8_999;
  assert.equal((await scheduler.finish(id)).status, 'not-due');
  assert.equal(timerCalls.at(-1).delay, 1);
  now = 9_000;
  assert.equal((await scheduler.finish(id)).status, 'ok');
  const paid = recovered.repository.getPlayer('restart-host').tokenBalance;
  assert.equal((await scheduler.finish(id)).duplicate, true);
  assert.equal(recovered.repository.getPlayer('restart-host').tokenBalance, paid);
  assert.deepEqual(revealed.map((entry) => entry[1]), [8, 8]);

  now = 10_000;
  recovered.rouletteService.randomInt = () => 22;
  const overdueId = botTable(recovered, 'restart-host');
  place(recovered, overdueId, 'restart-host', 'straight', '22', 1, 'overdue-bet');
  recovered.rouletteService.setReady(overdueId, 'restart-host', true);
  assert.equal(recovered.rouletteService.beginSpin(overdueId, 'restart-host').game.revealAt, 18_000);
  recovered.close();

  now = 18_001;
  const afterRestart = feature({
    db,
    clock: () => now,
    rouletteRandomInt: () => { throw new Error('overdue recovery must not reroll'); },
    rouletteRevealScheduler: idleScheduler,
  });
  const overdueReveals = [];
  const overdueScheduler = new RouletteRevealScheduler({
    service: afterRestart.rouletteService,
    notifyFinished: async (game) => overdueReveals.push(game.winningNumber),
  });
  await overdueScheduler.recover();
  assert.equal(afterRestart.rouletteService.game(overdueId).state, ROULETTE_STATES.FINISHED);
  assert.deepEqual(overdueReveals, [22]);
  assert.equal(afterRestart.rouletteService.expireDue().length, 0);
  scheduler.stop();
  overdueScheduler.stop();
  afterRestart.close();
  db.close();
});

test('overflow during settlement rolls the whole transaction back', () => {
  let now = 1_000;
  const game = feature({ clock: () => now, rouletteRandomInt: () => 1 });
  fund(game, 'host', SQLITE_INTEGER_MAX);
  const id = botTable(game);
  place(game, id, 'host', 'straight', '1', 1, 'overflow-bet');
  game.rouletteService.setReady(id, 'host', true);
  assert.equal(game.rouletteService.beginSpin(id, 'host').game.state, ROULETTE_STATES.SPINNING);
  now += ROULETTE_SPIN_DURATION_MS;
  assert.throws(() => game.rouletteService.finishSpin(id), /signed 64-bit/);
  assert.equal(game.rouletteService.game(id).state, ROULETTE_STATES.SPINNING);
  assert.equal(game.rouletteService.game(id).bets[0].state, 'OPEN');
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
  for (let number = 0; number <= 36; number += 1) {
    const spinPath = path.join(ROULETTE_IMAGE_DIRECTORY, `${number}.gif`);
    const resultPath = path.join(ROULETTE_RESULT_IMAGE_DIRECTORY, `${number}.png`);
    const readHeader = (filePath, length) => {
      const descriptor = fs.openSync(filePath, 'r');
      try {
        const header = Buffer.alloc(length);
        assert.equal(fs.readSync(descriptor, header, 0, length, 0), length);
        return header;
      } finally {
        fs.closeSync(descriptor);
      }
    };
    assert.ok(fs.statSync(spinPath).size > 0);
    assert.ok(fs.statSync(resultPath).size > 0);
    assert.match(readHeader(spinPath, 6).toString('ascii'), /^GIF8[79]a$/);
    assert.deepEqual([...readHeader(resultPath, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(path.basename(spinPath, '.gif'), path.basename(resultPath, '.png'));
    assert.equal(rouletteSpinAssetPath({ winningNumber: number }), spinPath);
    assert.equal(rouletteResultAssetPath({ winningNumber: number }), resultPath);
  }
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
