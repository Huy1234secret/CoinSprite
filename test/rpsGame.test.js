const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { RNG_GAME_COMMANDS, createRngGameFeature } = require('../src/features/rng-game');
const {
  RPS_CANVAS_HEIGHT,
  RPS_CANVAS_WIDTH,
  RPS_IMAGE_DIRECTORY,
  RPS_LAYOUTS,
  RPS_STATES,
} = require('../src/features/rng-game/config/rps');
const { balancePayload } = require('../src/features/rng-game/components/builders');
const { roundPayload } = require('../src/features/rng-game/components/rpsBuilders');
const { RpsTableRenderer } = require('../src/features/rng-game/services/rpsRenderer');
const { MAX_BET, parseBet, payoutFor, resolveRps } = require('../src/features/rng-game/services/rpsRules');
const {
  EXCHANGE_SHECKLES_PER_TOKEN,
  EXCHANGE_WINDOW_LIMIT,
  EXCHANGE_WINDOW_MS,
} = require('../src/features/rng-game/repositories/tokenRepository');
const {
  TOKEN_DENOMINATIONS,
  decomposeTokens,
  formatTokenLines,
  formatTokenList,
} = require('../src/features/rng-game/utils/tokens');

function fakeIndexRenderer() {
  return { render: async () => Buffer.from('index'), invalidate() {}, clear() {} };
}

function fakeRpsRenderer() {
  return { render: async () => Buffer.from('rps'), clear() {} };
}

function feature(options = {}) {
  let nextId = 0;
  return createRngGameFeature({
    databasePath: ':memory:',
    indexRenderer: fakeIndexRenderer(),
    rpsRenderer: fakeRpsRenderer(),
    rpsCreateId: () => `game-${++nextId}`,
    rpsRandomInt: () => 0,
    ...options,
  });
}

function fund(game, userId, options = {}) {
  game.repository.ensurePlayer(userId, options.now || 1);
  game.db.prepare(`UPDATE rng_players SET sheckle_balance = ?, token_balance = ? WHERE user_id = ?`)
    .run(BigInt(options.sheckles || 0), BigInt(options.tokens || 0), String(userId));
}

function profile(userId) {
  return { userId, displayName: `Player ${userId}`, avatarUrl: '' };
}

function createBotGame(game, userId = 'host', bet = 100n) {
  const created = game.rpsService.createGame('guild', 'channel', profile(userId));
  assert.equal(created.status, 'ok');
  assert.equal(game.rpsService.chooseMode(created.game.id, userId, 'bot').status, 'ok');
  const started = game.rpsService.startBotRound(created.game.id, userId, bet);
  assert.equal(started.status, 'ok');
  return created.game.id;
}

function createHumanLobby(game, userIds, bet = 100n) {
  const [host, ...opponents] = userIds;
  const created = game.rpsService.createGame('guild', 'channel', profile(host));
  assert.equal(created.status, 'ok');
  assert.equal(game.rpsService.chooseMode(created.game.id, host, 'human').status, 'ok');
  assert.equal(game.rpsService.chooseOpponents(created.game.id, host, opponents.map(profile)).status, 'ok');
  const lobby = game.rpsService.startHumanLobby(created.game.id, host, bet);
  assert.equal(lobby.status, 'ok');
  return created.game.id;
}

function acceptAll(game, gameId, userIds) {
  let result;
  for (const userId of userIds) result = game.rpsService.accept(gameId, userId);
  return result;
}

function pixel(image, x, y) {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return [...context.getImageData(x, y, 1, 1).data];
}

test('token decomposition is greedy, highest-first, and omits zero denominations', () => {
  assert.deepEqual(decomposeTokens(0n), []);
  assert.deepEqual(decomposeTokens(1n).map(({ value, quantity }) => [value, quantity]), [[1n, 1n]]);
  assert.deepEqual(decomposeTokens(8n).map(({ value, quantity }) => [value, quantity]), [[5n, 1n], [1n, 3n]]);
  assert.deepEqual(decomposeTokens(235n).map(({ value, quantity }) => [value, quantity]), [[100n, 2n], [10n, 3n], [5n, 1n]]);
  for (const denomination of TOKEN_DENOMINATIONS) {
    assert.deepEqual(decomposeTokens(denomination.value).map(({ value, quantity }) => [value, quantity]), [[denomination.value, 1n]]);
  }
  const large = decomposeTokens(9_223_372_036_854_775_807n);
  assert.equal(large.reduce((sum, entry) => sum + (entry.value * entry.quantity), 0n), 9_223_372_036_854_775_807n);
  assert.ok(large.every((entry) => entry.quantity > 0n));
});

test('token line formatting uses only owned denominations in descending order', () => {
  const lines = formatTokenLines(16_556n).split('\n');
  assert.equal(lines.length, 7);
  assert.match(lines[0], /Token10K/);
  assert.match(lines.at(-1), /Token1/);
  assert.doesNotMatch(formatTokenLines(235n), /Token50|Token1:/);
});

test('token list formatting is comma-separated with backticked quantities', () => {
  assert.equal(
    formatTokenList(235n),
    '<:Token100:1536768536289091614> `×2`, <:Token10:1536768531314774146> `×3`, <:Token5:1536768528424894514> `×1`',
  );
});

test('exchange costs 1,000 Sheckles per token and enforces 100 tokens per rolling four hours atomically', () => {
  const game = feature();
  fund(game, 'exchange', { sheckles: 200_000n });
  assert.equal(EXCHANGE_SHECKLES_PER_TOKEN, 1_000n);
  assert.equal(EXCHANGE_WINDOW_LIMIT, 100n);
  const first = game.tokenRepository.exchange('exchange', 60n, 'exchange:first', 10_000);
  assert.equal(first.status, 'ok');
  assert.equal(first.sheckleCost, 60_000n);
  assert.equal(game.repository.getPlayer('exchange').balance, 140_000n);
  assert.equal(game.repository.getPlayer('exchange').tokenBalance, 60n);
  assert.equal(game.tokenRepository.exchange('exchange', 41n, 'exchange:over', 10_001).status, 'rate-limited');
  assert.equal(game.tokenRepository.exchange('exchange', 40n, 'exchange:last', 10_002).status, 'ok');
  assert.equal(game.repository.getPlayer('exchange').tokenBalance, 100n);
  assert.equal(game.tokenRepository.exchange('exchange', 1n, 'exchange:blocked', 10_003).status, 'rate-limited');
  assert.equal(game.tokenRepository.exchange('exchange', 100n, 'exchange:new-window', 10_002 + EXCHANGE_WINDOW_MS).status, 'ok');
  game.close();
});

test('exchange rejects insufficient funds without changing either balance and is idempotent', () => {
  const game = feature();
  fund(game, 'poor', { sheckles: 999n });
  const failed = game.tokenRepository.exchange('poor', 1n, 'poor:first', 1_000);
  assert.equal(failed.status, 'insufficient');
  assert.deepEqual([game.repository.getPlayer('poor').balance, game.repository.getPlayer('poor').tokenBalance], [999n, 0n]);
  fund(game, 'replay', { sheckles: 10_000n });
  const first = game.tokenRepository.exchange('replay', 10n, 'same-operation', 1_000);
  const replay = game.tokenRepository.exchange('replay', 10n, 'same-operation', 2_000);
  assert.equal(first.status, 'ok');
  assert.equal(replay.duplicate, true);
  assert.deepEqual([game.repository.getPlayer('replay').balance, game.repository.getPlayer('replay').tokenBalance], [0n, 10n]);
  game.close();
});

test('balance payload preserves Sheckles and lists only nonzero token denominations with a total', () => {
  const payload = balancePayload({ id: 'wallet' }, { balance: 12_345n, tokenBalance: 235n });
  const components = payload.components[0].components;
  assert.match(components[0].content, /Sheckles: 12,345/);
  assert.equal(components[1].type, 14);
  assert.match(components[2].content, /Token100/);
  assert.match(components[2].content, /Token10/);
  assert.match(components[2].content, /Token5/);
  assert.doesNotMatch(components[2].content, /Token50|Token1:/);
  assert.equal(components[2].content.split('\n')[0], formatTokenList(235n));
  assert.match(components[2].content, /Total token value: 235/);
});

test('RPS bet text uses normal-size text without the subtext prefix', () => {
  const game = {
    id: 'bet-format',
    mode: 'bot',
    state: RPS_STATES.IN_PROGRESS,
    hostUserId: 'host',
    bet: 10n,
    currentTurn: 0,
    participants: [{ userId: 'host', choice: null, resultStatus: null }],
  };
  const payload = roundPayload(game, Buffer.from('png'));
  const content = payload.components[0].components[0].content;
  assert.match(content, /\nBet:/);
  assert.doesNotMatch(content, /-# Bet:/);
});

test('RPS resolves every standard two-player outcome and draw', () => {
  const winningPairs = [
    ['rock', 'scissors'],
    ['scissors', 'paper'],
    ['paper', 'rock'],
  ];
  for (const [winner, loser] of winningPairs) {
    assert.equal(resolveRps([winner, loser]).winnerIndex, 0);
    assert.equal(resolveRps([loser, winner]).winnerIndex, 1);
  }
  for (const move of ['rock', 'paper', 'scissors']) assert.equal(resolveRps([move, move]).type, 'draw');
});

test('multiplayer RPS only pays a sole winning-gesture participant', () => {
  assert.deepEqual(resolveRps(['rock', 'scissors', 'scissors']), { type: 'winner', winnerIndex: 0, winningMove: 'rock' });
  assert.equal(resolveRps(['rock', 'paper', 'scissors']).type, 'draw');
  assert.equal(resolveRps(['rock', 'rock', 'scissors']).type, 'draw');
  assert.deepEqual(resolveRps(['paper', 'rock', 'rock', 'rock']), { type: 'winner', winnerIndex: 0, winningMove: 'paper' });
  assert.equal(resolveRps(['paper', 'paper', 'rock', 'rock']).type, 'draw');
  assert.equal(resolveRps(['scissors', 'scissors', 'scissors', 'scissors']).type, 'draw');
});

test('bet validation and advertised payouts are exact', () => {
  assert.equal(parseBet('1'), 1n);
  assert.equal(parseBet('1000'), MAX_BET);
  for (const invalid of ['0', '-1', '1.5', '1e2', '1001', '', ' 2.0 ']) assert.throws(() => parseBet(invalid), RangeError);
  assert.equal(payoutFor(100n, 2), 200n);
  assert.equal(payoutFor(100n, 3), 300n);
  assert.equal(payoutFor(100n, 4), 400n);
});

test('Bot games debit once, pay human wins, retain Bot wins, and refund draws', () => {
  const cases = [
    { random: 2, human: 'rock', expected: 1_100n, winner: 'human' },
    { random: 1, human: 'rock', expected: 900n, winner: 'bot' },
    { random: 0, human: 'rock', expected: 1_000n, winner: 'draw' },
  ];
  for (const scenario of cases) {
    const game = feature({ rpsRandomInt: () => scenario.random });
    fund(game, 'host', { tokens: 1_000n });
    const gameId = createBotGame(game);
    assert.equal(game.repository.getPlayer('host').tokenBalance, 900n);
    assert.equal(game.rpsService.commit(gameId, 'host', scenario.human).status, 'ready');
    const result = game.rpsService.reveal(gameId, 'host');
    assert.equal(result.status, 'ok');
    assert.equal(game.repository.getPlayer('host').tokenBalance, scenario.expected);
    if (scenario.winner === 'draw') assert.equal(result.game.resultType, 'draw');
    else assert.equal(result.game.winnerUserId, scenario.winner === 'bot' ? 'bot' : 'host');
    game.close();
  }
});

test('three- and four-player games escrow equal stakes and pay the complete pot to one winner', () => {
  for (const users of [['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
    const game = feature();
    users.forEach((userId) => fund(game, userId, { tokens: 1_000n }));
    const gameId = createHumanLobby(game, users);
    const started = acceptAll(game, gameId, users);
    assert.equal(started.status, 'started');
    users.forEach((userId) => assert.equal(game.repository.getPlayer(userId).tokenBalance, 900n));
    const choices = ['paper', ...users.slice(1).map(() => 'rock')];
    users.forEach((userId, index) => game.rpsService.commit(gameId, userId, choices[index]));
    const revealed = game.rpsService.reveal(gameId, users.at(-1));
    assert.equal(revealed.game.winnerUserId, 'a');
    assert.equal(game.repository.getPlayer('a').tokenBalance, 900n + (100n * BigInt(users.length)));
    users.slice(1).forEach((userId) => assert.equal(game.repository.getPlayer(userId).tokenBalance, 900n));
    game.close();
  }
});

test('multiplayer debit failure is atomic and a multiplayer draw refunds every stake', () => {
  const game = feature();
  fund(game, 'a', { tokens: 100n });
  fund(game, 'b', { tokens: 99n });
  fund(game, 'c', { tokens: 100n });
  const gameId = createHumanLobby(game, ['a', 'b', 'c']);
  const failed = acceptAll(game, gameId, ['a', 'b', 'c']);
  assert.equal(failed.status, 'insufficient');
  assert.deepEqual(['a', 'b', 'c'].map((id) => game.repository.getPlayer(id).tokenBalance), [100n, 99n, 100n]);
  game.db.prepare('UPDATE rng_players SET token_balance = 100 WHERE user_id = ?').run('b');
  assert.equal(game.rpsService.accept(gameId, 'a').status, 'started');
  ['a', 'b', 'c'].forEach((id, index) => game.rpsService.commit(gameId, id, ['rock', 'paper', 'scissors'][index]));
  assert.equal(game.rpsService.reveal(gameId, 'b').game.resultType, 'draw');
  assert.deepEqual(['a', 'b', 'c'].map((id) => game.repository.getPlayer(id).tokenBalance), [100n, 100n, 100n]);
  game.close();
});

test('duplicate reveal, cancellation, and expiry never pay or refund twice', () => {
  let now = 1_000;
  const game = feature({ clock: () => now, rpsRandomInt: () => 2 });
  fund(game, 'winner', { tokens: 1_000n });
  const winnerGame = createBotGame(game, 'winner');
  game.rpsService.commit(winnerGame, 'winner', 'rock');
  assert.equal(game.rpsService.reveal(winnerGame, 'winner').duplicate, false);
  const paid = game.repository.getPlayer('winner').tokenBalance;
  assert.equal(game.rpsService.reveal(winnerGame, 'winner').duplicate, true);
  assert.equal(game.repository.getPlayer('winner').tokenBalance, paid);

  fund(game, 'canceled', { tokens: 500n });
  const canceledGame = createBotGame(game, 'canceled');
  assert.equal(game.repository.getPlayer('canceled').tokenBalance, 400n);
  assert.equal(game.rpsService.cancel(canceledGame).duplicate, false);
  assert.equal(game.rpsService.cancel(canceledGame).duplicate, true);
  assert.equal(game.repository.getPlayer('canceled').tokenBalance, 500n);

  fund(game, 'expired', { tokens: 500n });
  const expiredGame = createBotGame(game, 'expired');
  now += 6 * 60 * 1_000;
  assert.equal(game.rpsService.expireDue().length, 1);
  assert.equal(game.rpsService.expireDue().length, 0);
  assert.equal(game.rpsService.game(expiredGame).state, RPS_STATES.EXPIRED);
  assert.equal(game.repository.getPlayer('expired').tokenBalance, 500n);
  game.close();
});

test('Bot replay rejects bets above 1000, preserves the menu state, and chooses a fresh Bot card', () => {
  const draws = [0, 2];
  const game = feature({ rpsRandomInt: () => draws.shift() });
  fund(game, 'replay-host', { tokens: 2_000n });
  const gameId = createBotGame(game, 'replay-host', 600n);
  game.rpsService.commit(gameId, 'replay-host', 'rock');
  game.rpsService.reveal(gameId, 'replay-host');
  assert.equal(game.rpsService.game(gameId).botChoice, 'rock');
  assert.throws(() => game.rpsService.replay(gameId, 'replay-host', 2), RangeError);
  assert.equal(game.rpsService.game(gameId).state, RPS_STATES.FINISHED);
  assert.equal(game.rpsService.repository.activeGameForUser('replay-host'), null);
  const replay = game.rpsService.replay(gameId, 'replay-host', 1);
  assert.equal(replay.status, 'ok');
  assert.equal(replay.game.botChoice, 'scissors');
  assert.equal(replay.game.state, RPS_STATES.IN_PROGRESS);
  game.close();
});

test('lobby authorization, turn authorization, higher bets, and terminal-state guards are authoritative', () => {
  const game = feature();
  ['a', 'b', 'c', 'intruder'].forEach((id) => fund(game, id, { tokens: 1_000n }));
  const gameId = createHumanLobby(game, ['a', 'b', 'c']);
  assert.equal(game.rpsService.accept(gameId, 'intruder').status, 'unauthorized');
  game.rpsService.accept(gameId, 'a');
  game.rpsService.accept(gameId, 'b');
  const higher = game.rpsService.proposeHigherBet(gameId, 'c', '150');
  assert.equal(higher.status, 'ok');
  assert.ok(higher.game.participants.every((participant) => participant.accepted === false));
  assert.equal(game.rpsService.proposeHigherBet(gameId, 'b', '150').status, 'not-higher');
  assert.equal(acceptAll(game, gameId, ['a', 'b', 'c']).status, 'started');
  assert.deepEqual(game.rpsService.commit(gameId, 'b', 'rock'), { status: 'not-turn', currentUserId: 'a' });
  assert.equal(game.rpsService.commit(gameId, 'a', 'paper').status, 'ok');
  assert.equal(game.rpsService.commit(gameId, 'a', 'rock').status, 'not-turn');
  game.rpsService.commit(gameId, 'b', 'rock');
  game.rpsService.commit(gameId, 'c', 'rock');
  game.rpsService.reveal(gameId, 'a');
  assert.equal(game.rpsService.commit(gameId, 'a', 'rock').status, 'stale');
  assert.equal(game.rpsService.proposeHigherBet(gameId, 'a', '200').status, 'stale');
  game.close();
});

test('only the /g-rps invoker may choose the initial mode', async () => {
  const game = feature();
  fund(game, 'owner', { tokens: 100n });
  const created = game.rpsService.createGame('guild', 'channel', profile('owner'));
  let reply;
  const handled = await game.handleInteraction({
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    customId: `rng:rps:mode:${created.game.id}`,
    values: ['bot'],
    user: { id: 'intruder' },
    reply: async (payload) => { reply = payload; },
  });
  assert.equal(handled, true);
  assert.match(reply.components[0].components[0].content, /Only the command invoker/);
  assert.equal(game.rpsService.game(created.game.id).mode, null);
  game.close();
});

test('/exchange-token confirmation rechecks and atomically updates the existing wallet', async () => {
  const game = feature();
  fund(game, 'slash-user', { sheckles: 10_000n });
  let preview;
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'exchange-token',
    guildId: 'guild',
    channelId: 'channel',
    member: null,
    user: { id: 'slash-user' },
    options: { getInteger: () => 10 },
    reply: async (payload) => { preview = payload; },
  });
  const button = preview.components[0].components.find((component) => component.type === 1).components[0];
  assert.equal(button.disabled, false);
  let success;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: button.custom_id,
    user: { id: 'slash-user' },
    update: async (payload) => { success = payload; },
  });
  assert.match(success.components[0].components[0].content, /Exchange complete/);
  assert.deepEqual(
    [game.repository.getPlayer('slash-user').balance, game.repository.getPlayer('slash-user').tokenBalance],
    [0n, 10n],
  );
  game.close();
});

test('/g-rps creates a persistent choosing-mode game and stores its Discord message ID', async () => {
  const game = feature();
  let payload;
  const handled = await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'g-rps',
    guildId: 'guild',
    channelId: 'channel',
    member: { displayName: 'Host' },
    user: { id: 'slash-host', username: 'Host', displayAvatarURL: () => '' },
    reply: async (value) => { payload = value; },
    fetchReply: async () => ({ id: 'discord-message' }),
  });
  assert.equal(handled, true);
  const select = payload.components[0].components.find((component) => component.type === 1).components[0];
  assert.match(select.custom_id, /^rng:rps:mode:game-/);
  const created = game.rpsService.game(select.custom_id.split(':').at(-1));
  assert.equal(created.state, RPS_STATES.CHOOSING_MODE);
  assert.equal(created.messageId, 'discord-message');
  assert.equal(created.hostUserId, 'slash-host');
  game.close();
});

test('RPS slash commands and exchange limits are registered with safe server-side bounds', () => {
  const commands = new Map(RNG_GAME_COMMANDS.map(({ data }) => [data.name, data.toJSON()]));
  assert.ok(commands.has('g-rps'));
  const exchange = commands.get('exchange-token');
  assert.equal(exchange.options[0].name, 'amount-token');
  assert.equal(exchange.options[0].required, true);
  assert.equal(exchange.options[0].min_value, 1);
  assert.equal(exchange.options[0].max_value, 100);
});

test('all RPS assets have authoritative dimensions and every table renders an original-size PNG', async () => {
  const renderer = new RpsTableRenderer();
  const assets = await renderer.assets();
  for (const layout of Object.values(RPS_LAYOUTS)) {
    const table = assets[layout.table];
    assert.equal(table.width, RPS_CANVAS_WIDTH);
    assert.equal(table.height, RPS_CANVAS_HEIGHT);
    assert.equal(fs.existsSync(path.join(RPS_IMAGE_DIRECTORY, layout.table)), true);
  }
  for (const participantCount of [2, 3, 4]) {
    const game = {
      id: `render-${participantCount}`,
      mode: 'human',
      state: RPS_STATES.READY_TO_REVEAL,
      bet: 10n,
      currentTurn: participantCount,
      participants: Array.from({ length: participantCount }, (_, index) => ({
        ...profile(`p${index}`),
        seat: index,
        choice: ['rock', 'paper', 'scissors'][index % 3],
        resultStatus: null,
      })),
    };
    const png = await renderer.render(game, { guides: true, hideAllHands: true });
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const decoded = await loadImage(png);
    assert.equal(decoded.width, RPS_CANVAS_WIDTH);
    assert.equal(decoded.height, RPS_CANVAS_HEIGHT);
  }
  renderer.clear();
});

test('hand cleanup preserves profile rings, cards fit anchors, and result treatment renders', async () => {
  const renderer = new RpsTableRenderer();
  const baseGame = {
    id: 'image-state',
    mode: 'human',
    state: RPS_STATES.LOBBY,
    bet: 10n,
    currentTurn: 0,
    participants: [
      { ...profile('one'), seat: 0, accepted: false, choice: null, resultStatus: null },
      { ...profile('two'), seat: 1, accepted: false, choice: null, resultStatus: null },
    ],
  };
  const visible = await loadImage(await renderer.render(baseGame));
  const hiddenGame = {
    ...baseGame,
    state: RPS_STATES.READY_TO_REVEAL,
    currentTurn: 2,
    participants: baseGame.participants.map((participant, index) => ({
      ...participant,
      choice: index === 0 ? 'rock' : 'scissors',
    })),
  };
  const hidden = await loadImage(await renderer.render(hiddenGame));
  const firstSeat = RPS_LAYOUTS[2].seats[0];
  const ringPixel = {
    x: firstSeat.profile.x,
    y: firstSeat.profile.y + firstSeat.profile.outerRadius - 2,
  };
  assert.deepEqual(pixel(hidden, ringPixel.x, ringPixel.y), pixel(visible, ringPixel.x, ringPixel.y));
  for (const layout of Object.values(RPS_LAYOUTS)) {
    for (const seat of layout.seats) {
      assert.ok(seat.card.x - (seat.card.maxWidth / 2) >= 0);
      assert.ok(seat.card.x + (seat.card.maxWidth / 2) <= RPS_CANVAS_WIDTH);
      assert.ok(seat.card.y - (seat.card.maxHeight / 2) >= 0);
      assert.ok(seat.card.y + (seat.card.maxHeight / 2) <= RPS_CANVAS_HEIGHT);
    }
  }
  const result = {
    ...hiddenGame,
    state: RPS_STATES.FINISHED,
    resultType: 'winner',
    winnerUserId: 'one',
    participants: hiddenGame.participants.map((participant, index) => ({
      ...participant,
      resultStatus: index === 0 ? 'WIN' : 'LOSE',
    })),
  };
  const revealed = await loadImage(await renderer.render(result));
  const winnerCenter = pixel(revealed, RPS_LAYOUTS[2].seats[0].profile.x, RPS_LAYOUTS[2].seats[0].profile.y);
  const loserCenter = pixel(revealed, RPS_LAYOUTS[2].seats[1].profile.x, RPS_LAYOUTS[2].seats[1].profile.y);
  assert.ok(loserCenter[0] + loserCenter[1] + loserCenter[2] < winnerCenter[0] + winnerCenter[1] + winnerCenter[2]);
  renderer.clear();
});
