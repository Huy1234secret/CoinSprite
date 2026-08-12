const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { featureCommandsForConfig } = require('../src/applicationCommands');
const { createRngGameFeature } = require('../src/features/rng-game');
const { migrate, openDatabase } = require('../src/features/rng-game/repositories/database');
const { SQLITE_INTEGER_MAX } = require('../src/features/rng-game/repositories/gameRepository');
const { BURGER_CUSTOMERS, WORK_GAMES, WORK_INGREDIENTS } = require('../src/features/work/data');
const {
  completePayload,
  gamePayload,
  homePayload,
  ingredientRows,
  statPayload,
} = require('../src/features/work/components/builders');
const {
  WORK_RANKS,
  boostedReward,
  progressBar,
  unlockedDifficulties,
  workProgress,
  workRank,
} = require('../src/features/work/ranks');
const { shuffleIngredients } = require('../src/features/work/services/workService');
const { COMPONENTS_V2_FLAG } = require('../src/features/shared/components');

function feature(options = {}) {
  let id = 0;
  return createRngGameFeature({
    databasePath: ':memory:',
    workRandom: () => 0,
    workCreateId: () => `work-session-${++id}`,
    workCooldownMs: 60_000,
    ...options,
  });
}

function start(game, userId = 'worker', context = {}) {
  return game.workService.start(userId, {
    guildId: 'guild', channelId: 'channel', messageId: 'message', ...context,
  });
}

function slotFor(session, ingredient, excluded = new Set()) {
  return session.buttonSlots.find((slot) => slot.ingredient === ingredient && !excluded.has(slot.index));
}

function finishRecipe(game, session, userId = session.userId) {
  let current = session;
  let result;
  for (const ingredient of current.expectedRecipe) {
    const slot = slotFor(current, ingredient, new Set(current.consumedSlots));
    result = game.workService.press(current.id, userId, slot.index);
    current = result.session;
  }
  return result;
}

function content(payload) {
  return payload.components[0].components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');
}

function interaction(overrides = {}) {
  const calls = { replies: [], updates: [], edits: [], followUps: [] };
  const value = {
    customId: '',
    commandName: '',
    user: { id: 'worker' },
    guildId: 'guild',
    channelId: 'channel',
    message: {
      id: 'message',
      edit: async (payload) => { calls.edits.push(payload); },
    },
    isChatInputCommand: () => false,
    isStringSelectMenu: () => false,
    isButton: () => false,
    reply: async (payload) => { calls.replies.push(payload); },
    update: async (payload) => { calls.updates.push(payload); },
    followUp: async (payload) => { calls.followUps.push(payload); },
    ...overrides,
  };
  return { calls, value };
}

test('/g-work is registered only with the RNG-game command set', () => {
  const base = { enabled: true, features: { rngGame: false }, rngGame: { enabled: false } };
  assert.equal(featureCommandsForConfig(base).some((command) => command.name === 'g-work'), false);
  const commands = featureCommandsForConfig({
    ...base,
    features: { rngGame: true },
    rngGame: { enabled: true },
  });
  assert.equal(commands.some((command) => command.name === 'g-work'), true);
});

test('initial work payload is a white Components V2 select with exact actions and emojis', () => {
  const payload = homePayload('123', () => 0);
  assert.equal((payload.flags & COMPONENTS_V2_FLAG) !== 0, true);
  assert.equal(payload.components[0].accent_color, 0xFFFFFF);
  assert.equal(payload.content, null);
  assert.deepEqual(payload.embeds, []);
  assert.match(content(payload), /<@123>, Ready to clock in\?/);
  const menu = payload.components[0].components[2].components[0];
  assert.equal(menu.custom_id, 'work:menu:123');
  assert.equal(menu.placeholder, 'Select Actions');
  assert.deepEqual(menu.options.map(({ label, value }) => ({ label, value })), [
    { label: 'Check Stat', value: 'check-stat' },
    { label: 'Work', value: 'work' },
  ]);
  assert.deepEqual(menu.options.map((option) => option.emoji.id), [
    '1536996978129510451', '1536996980801142784',
  ]);
});

test('rank selection includes every exact threshold and the preceding XP', () => {
  for (const [index, rank] of WORK_RANKS.entries()) {
    assert.equal(workRank(rank.threshold), rank);
    if (index > 0) assert.equal(workRank(rank.threshold - 1), WORK_RANKS[index - 1]);
  }
  assert.equal(workRank(1_000_000).name, 'Ascendant');
});

test('rank progress is local, clamped, and renders Ascendant as max rank', () => {
  assert.deepEqual(
    { ...workProgress(99), rank: workProgress(99).rank.name, nextRank: workProgress(99).nextRank.name },
    { rank: 'Rookie', nextRank: 'Novice', currentRankXp: 99n, requiredXp: 100n, percent: 99 },
  );
  assert.equal(workProgress(100).percent, 0);
  assert.equal(workProgress(249).percent, 99);
  assert.equal(workProgress(250).rank.name, 'Beginner');
  assert.equal(workProgress(80_000).percent, 100);
  assert.equal(workProgress(80_000).nextRank, null);
  assert.equal(progressBar(-10), '░'.repeat(10));
  assert.equal(progressBar(55), `${'█'.repeat(5)}${'░'.repeat(5)}`);
  assert.equal(progressBar(200), '█'.repeat(10));
  const payload = statPayload('worker', { totalXp: 80_000n }, WORK_GAMES);
  assert.match(content(payload), /██████████ 100% — MAX RANK/);
});

test('salary reward uses exact integer round-half-up', () => {
  assert.equal(boostedReward(30, 0), 30n);
  assert.equal(boostedReward(30, 2), 31n);
  assert.equal(boostedReward(55, 10), 61n);
  assert.equal(boostedReward(175, 150), 438n);
});

test('difficulty unlocks change at levels 1, 6, and 13', () => {
  assert.deepEqual(unlockedDifficulties(1), ['easy']);
  assert.deepEqual(unlockedDifficulties(5), ['easy']);
  assert.deepEqual(unlockedDifficulties(6), ['easy', 'medium']);
  assert.deepEqual(unlockedDifficulties(12), ['easy', 'medium']);
  assert.deepEqual(unlockedDifficulties(13), ['easy', 'medium', 'hard']);
});

test('game, customer, and game-message selection use injected randomness', () => {
  const game = feature({ workRandom: (maximum) => maximum - 1 });
  const result = start(game);
  assert.equal(result.status, 'ok');
  assert.equal(result.session.gameId, 'burger-service');
  assert.equal(result.session.customerId, 6, 'a level-one worker selects from easy customers only');
  assert.match(result.session.gameMessage, /burger skills/);
  game.close();
});

test('ingredient shuffle preserves every occurrence and assigns unique stable slot indexes', () => {
  const recipe = ['bunbottom', 'beef', 'beef', 'ketchup', 'buntop'];
  const slots = shuffleIngredients(recipe, () => 0);
  assert.deepEqual(slots.map((slot) => slot.ingredient).sort(), [...recipe].sort());
  assert.deepEqual(slots.map((slot) => slot.index), [0, 1, 2, 3, 4]);
});

test('duplicate and long recipes produce unique IDs in rows of at most five buttons', () => {
  const game = feature({ workRandom: (maximum) => maximum - 1 });
  game.workRepository.ensureProfile('worker', 1);
  game.db.prepare('UPDATE rng_work_profiles SET total_xp = 80000 WHERE user_id = ?').run('worker');
  const result = start(game);
  assert.equal(result.session.expectedRecipe.length, 12);
  const rows = ingredientRows(result.session);
  const ingredientButtons = rows.slice(0, -1).flatMap((row) => row.components);
  assert.equal(ingredientButtons.length, 12);
  assert.equal(new Set(ingredientButtons.map((button) => button.custom_id)).size, 12);
  assert.ok(rows.slice(0, -1).every((row) => row.components.length <= 5));
  assert.equal(ingredientButtons.every((button) => !('label' in button)), true);
  game.close();
});

test('a correct click advances one step and turns only that button green and disabled', () => {
  const game = feature();
  const session = start(game).session;
  const slot = slotFor(session, session.expectedRecipe[0]);
  const result = game.workService.press(session.id, 'worker', slot.index);
  assert.equal(result.status, 'advanced');
  assert.equal(result.session.currentProgress, 1);
  assert.deepEqual(result.session.consumedSlots, [slot.index]);
  const button = ingredientRows(result.session).flatMap((row) => row.components)
    .find((candidate) => candidate.custom_id === `work:ingredient:${session.id}:${slot.index}`);
  assert.equal(button.style, 3);
  assert.equal(button.disabled, true);
  game.close();
});

test('either unused duplicate ingredient button satisfies a duplicate step', () => {
  const game = feature({ workRandom: (maximum) => maximum - 1 });
  const session = start(game).session;
  assert.equal(session.customerId, 6);
  let current = session;
  for (const expected of current.expectedRecipe.slice(0, 3)) {
    const matching = current.buttonSlots.filter((slot) => (
      slot.ingredient === expected && !current.consumedSlots.includes(slot.index)
    ));
    const selected = expected === 'beef' ? matching.at(-1) : matching[0];
    const result = game.workService.press(current.id, 'worker', selected.index);
    assert.equal(result.status, 'advanced');
    current = result.session;
  }
  const remainingBeef = slotFor(current, 'beef', new Set(current.consumedSlots));
  assert.equal(game.workService.press(current.id, 'worker', remainingBeef.index).status, 'advanced');
  game.close();
});

test('an incorrect ingredient fails atomically without reward or XP', () => {
  const game = feature();
  const session = start(game).session;
  const wrong = session.buttonSlots.find((slot) => slot.ingredient !== session.expectedRecipe[0]);
  const result = game.workService.press(session.id, 'worker', wrong.index);
  assert.equal(result.status, 'failed');
  assert.equal(result.session.currentProgress, 0);
  assert.equal(game.repository.getPlayer('worker').tokenBalance, 0n);
  assert.equal(game.workService.profile('worker').totalXp, 0n);
  assert.equal(game.workService.profile('worker').failedShifts, 1n);
  game.close();
});

test('completion credits boosted tokens, base XP, and rank-up exactly once', () => {
  const game = feature();
  game.workRepository.ensureProfile('worker', 1);
  game.db.prepare('UPDATE rng_work_profiles SET total_xp = 249 WHERE user_id = ?').run('worker');
  const session = start(game).session;
  const result = finishRecipe(game, session);
  assert.equal(result.status, 'completed');
  assert.equal(result.finalReward, 31n);
  assert.equal(result.previousXp, 249n);
  assert.equal(result.totalXp, 279n);
  assert.equal(game.repository.getPlayer('worker').tokenBalance, 31n);
  assert.match(content(completePayload('worker', result)), /Rank up! You are now Beginner — Level 3/);
  const replay = game.workService.press(session.id, 'worker', session.buttonSlots[0].index);
  assert.equal(replay.status, 'resolved');
  assert.equal(game.repository.getPlayer('worker').tokenBalance, 31n);
  assert.equal(game.workService.profile('worker').completedShifts, 1n);
  game.close();
});

test('SQLite wallet overflow rolls back the final press and every work award', () => {
  const game = feature();
  const session = start(game).session;
  game.db.prepare('UPDATE rng_players SET token_balance = ? WHERE user_id = ?')
    .run(SQLITE_INTEGER_MAX, 'worker');
  let current = session;
  for (const ingredient of session.expectedRecipe.slice(0, -1)) {
    const slot = slotFor(current, ingredient, new Set(current.consumedSlots));
    current = game.workService.press(current.id, 'worker', slot.index).session;
  }
  const finalSlot = slotFor(current, current.expectedRecipe.at(-1), new Set(current.consumedSlots));
  assert.throws(
    () => game.workService.press(current.id, 'worker', finalSlot.index),
    /Token balance exceeds the SQLite signed 64-bit range/,
  );
  assert.equal(game.workRepository.session(session.id).state, 'active');
  assert.equal(game.workRepository.session(session.id).currentProgress, session.expectedRecipe.length - 1);
  assert.equal(game.repository.getPlayer('worker').tokenBalance, SQLITE_INTEGER_MAX);
  assert.equal(game.workService.profile('worker').totalXp, 0n);
  assert.equal(game.workService.profile('worker').completedShifts, 0n);
  game.close();
});

test('only one active work session is allowed and resolved sessions enter cooldown', () => {
  let now = 10_000;
  const game = feature({ clock: () => now });
  const first = start(game);
  assert.equal(start(game).status, 'already-active');
  assert.equal(game.workService.cancel(first.session.id, 'worker').status, 'canceled');
  assert.deepEqual(start(game), { status: 'cooldown', availableAt: 70_000 });
  now = 69_999;
  assert.equal(start(game).status, 'cooldown');
  now = 70_000;
  assert.equal(start(game).status, 'ok');
  game.close();
});

test('another user cannot operate a session', () => {
  const game = feature();
  const session = start(game).session;
  const result = game.workService.press(session.id, 'intruder', session.buttonSlots[0].index);
  assert.equal(result.status, 'unauthorized');
  assert.equal(game.workRepository.session(session.id).state, 'active');
  game.close();
});

test('expired sessions award nothing and release the active-session lock', () => {
  let now = 10_000;
  const game = feature({ clock: () => now, workSessionTtlMs: 1_000 });
  const session = start(game).session;
  now = 11_000;
  const result = game.workService.press(session.id, 'worker', session.buttonSlots[0].index);
  assert.equal(result.status, 'expired');
  assert.equal(game.repository.getPlayer('worker').tokenBalance, 0n);
  assert.equal(start(game).status, 'ok');
  game.close();
});

test('quit cancels without payment and Back restores the home screen', async () => {
  const game = feature();
  const session = start(game).session;
  const quit = interaction({
    customId: `work:quit:${session.id}`,
    isButton: () => true,
  });
  assert.equal(await game.handleInteraction(quit.value), true);
  assert.equal(quit.calls.updates.length, 1);
  assert.match(content(quit.calls.updates[0]), /Shift Canceled/);
  assert.equal(game.repository.getPlayer('worker').tokenBalance, 0n);

  const back = interaction({ customId: 'work:back:worker', isButton: () => true });
  await game.handleInteraction(back.value);
  assert.equal(back.calls.updates[0].components[0].accent_color, 0xFFFFFF);
  assert.match(content(back.calls.updates[0]), /Coinsprite/);
  assert.equal('flags' in back.calls.updates[0], false);
  game.close();
});

test('foreign controls receive the exact ephemeral ownership error', async () => {
  const game = feature();
  const attempt = interaction({
    customId: 'work:menu:worker',
    user: { id: 'intruder' },
    isStringSelectMenu: () => true,
    values: ['check-stat'],
  });
  await game.handleInteraction(attempt.value);
  assert.match(content(attempt.calls.replies[0]), /These aren't your work controls\. Run \/g-work to start your own shift\./);
  game.close();
});

test('expired component edits stale controls and sends the requested ephemeral error', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now, workSessionTtlMs: 100 });
  const session = start(game).session;
  now = 1_100;
  const slot = session.buttonSlots[0];
  const press = interaction({
    customId: `work:ingredient:${session.id}:${slot.index}`,
    isButton: () => true,
  });
  await game.handleInteraction(press.value);
  assert.equal(press.calls.edits.length, 1);
  assert.match(content(press.calls.edits[0]), /Shift Expired/);
  assert.match(content(press.calls.replies[0]), /This work shift has expired\. Run \/g-work to start another\./);
  game.close();
});

test('all customer definitions exactly preserve IDs, rewards, orders, and invariants', () => {
  const expectedRewards = [30, 30, 40, 40, 50, 55, 80, 85, 90, 95, 100, 105, 145, 145, 155, 155, 165, 165, 175, 175];
  const expectedLengths = [3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12];
  assert.equal(BURGER_CUSTOMERS.length, 20);
  assert.deepEqual(BURGER_CUSTOMERS.map((customer) => customer.id), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.deepEqual(BURGER_CUSTOMERS.map((customer) => customer.reward), expectedRewards);
  assert.deepEqual(BURGER_CUSTOMERS.map((customer) => customer.order.length), expectedLengths);
  for (const customer of BURGER_CUSTOMERS) {
    assert.equal(customer.order[0], 'bunbottom');
    assert.equal(customer.order.at(-1), 'buntop');
    assert.ok(customer.order.every((ingredient) => WORK_INGREDIENTS[ingredient]));
  }
});

test('migration 007 preserves an existing wallet balance', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-work-'));
  const databasePath = path.join(directory, 'rng.sqlite');
  const allMigrations = path.join(__dirname, '..', 'src', 'features', 'rng-game', 'migrations');
  const previousMigrations = path.join(directory, 'migrations');
  fs.mkdirSync(previousMigrations);
  for (const name of fs.readdirSync(allMigrations).filter((name) => name < '007_work_system.sql')) {
    fs.copyFileSync(path.join(allMigrations, name), path.join(previousMigrations, name));
  }
  const db = openDatabase({ databasePath, migrationsPath: previousMigrations });
  db.prepare(`INSERT INTO rng_players
    (user_id, sheckle_balance, inventory_capacity, inventory_upgrade_level, token_balance, created_at, updated_at)
    VALUES ('worker', 0, 100, 0, 987, 1, 1)`).run();
  migrate(db, allMigrations);
  assert.equal(db.prepare("SELECT token_balance FROM rng_players WHERE user_id = 'worker'").get().token_balance, 987n);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rng_work_sessions'").get());
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('work game payload uses white V2 edits and all custom IDs stay under Discord limits', () => {
  const game = feature({ workRandom: (maximum) => maximum - 1 });
  game.workRepository.ensureProfile('worker', 1);
  game.db.prepare('UPDATE rng_work_profiles SET total_xp = 80000 WHERE user_id = ?').run('worker');
  const session = start(game).session;
  const payload = gamePayload('worker', session, game.workService.customer(session), { initial: false });
  assert.equal(payload.components[0].accent_color, 0xFFFFFF);
  assert.equal('flags' in payload, false);
  const ids = payload.components[0].components.flatMap((component) => component.components || [])
    .map((component) => component.custom_id).filter(Boolean);
  assert.ok(ids.every((id) => id.length < 100));
  game.close();
});
