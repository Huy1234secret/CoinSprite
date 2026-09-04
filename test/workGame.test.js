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
const { WORK_COOLDOWN_MS, shuffleIngredients } = require('../src/features/work/services/workService');
const { COMPONENTS_V2_FLAG } = require('../src/features/shared/components');
const {
  WORK_STREAK_FAILURE_LIMIT,
  WORK_STREAK_MAX,
  WORK_STREAK_TIMEOUT_MS,
} = require('../src/features/work/repositories/workRepository');

function feature(options = {}) {
  let id = 0;
  return createRngGameFeature({
    databasePath: ':memory:',
    workRandom: () => 0,
    workCreateId: () => `work-session-${++id}`,
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
  const calls = { acknowledgements: [], replies: [], updates: [], edits: [], followUps: [] };
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
    deferUpdate: async () => { calls.acknowledgements.push('update'); value.deferred = true; },
    editReply: async (payload) => { calls.updates.push(payload); },
    followUp: async (payload) => { calls.followUps.push(payload); },
    ...overrides,
  };
  return { calls, value };
}

test('/g-work is no longer registered with the removed RNG-game commands', () => {
  const base = { enabled: true, features: { rngGame: false }, rngGame: { enabled: false } };
  assert.equal(featureCommandsForConfig(base).some((command) => command.name === 'g-work'), false);
  const commands = featureCommandsForConfig({
    ...base,
    features: { rngGame: true },
    rngGame: { enabled: true },
  });
  assert.equal(commands.some((command) => command.name === 'g-work'), false);
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

test('work stats replace salary ranges with rank boost and work streak', () => {
  const payload = statPayload('worker', { totalXp: 0n, workStreak: 42 }, WORK_GAMES);
  const text = content(payload);
  assert.match(text, /-# Rank boost: \+0% salary\./);
  assert.match(text, /-# 🔥Work Streak: 42 `\+42% salary\.`/);
  assert.doesNotMatch(text, /Salary:|per completed order|Token1/);
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
  assert.equal(result.finalReward, 1n);
  assert.equal(result.previousXp, 249n);
  assert.equal(result.totalXp, 250n);
  assert.equal(game.repository.getPlayer('worker').tokenBalance, 1n);
  assert.match(content(completePayload('worker', result)), /Rank up! You are now Beginner — Level 3/);
  const replay = game.workService.press(session.id, 'worker', session.buttonSlots[0].index);
  assert.equal(replay.status, 'resolved');
  assert.equal(game.repository.getPlayer('worker').tokenBalance, 1n);
  assert.equal(game.workService.profile('worker').completedShifts, 1n);
  assert.equal(game.workService.profile('worker').workStreak, 1);
  game.close();
});

test('streak salary is captured at shift start and uses round-half-up reward math', () => {
  const game = feature();
  game.workRepository.ensureProfile('worker', 1);
  game.db.prepare(`UPDATE rng_work_profiles SET work_streak = 50, last_shift_end_at = NULL
    WHERE user_id = ?`).run('worker');
  const session = start(game).session;
  assert.equal(session.streakBoost, 50);
  assert.equal(session.salaryBoost, 50);
  const result = finishRecipe(game, session);
  assert.equal(result.finalReward, 2n, 'base reward 1 with +50% rounds half up to 2');
  assert.equal(game.workService.profile('worker').workStreak, 51);
  game.close();
});

test('work streak caps at +1000% while rank boost remains additive', () => {
  const game = feature();
  game.workRepository.ensureProfile('worker', 1);
  game.db.prepare(`UPDATE rng_work_profiles SET total_xp = 80000, work_streak = ?,
    last_shift_end_at = NULL WHERE user_id = ?`).run(BigInt(WORK_STREAK_MAX), 'worker');
  const session = start(game).session;
  assert.equal(session.streakBoost, 1_000);
  assert.equal(session.salaryBoost, 1_150);
  finishRecipe(game, session);
  assert.equal(game.workService.profile('worker').workStreak, 1_000);
  game.close();
});

test('work streak expires at exactly twelve hours of inactivity', () => {
  let now = 50_000;
  const game = feature({ clock: () => now });
  game.workRepository.ensureProfile('worker', now);
  game.db.prepare(`UPDATE rng_work_profiles SET work_streak = 25, streak_failures = 3,
    last_shift_end_at = ? WHERE user_id = ?`).run(BigInt(now), 'worker');
  now += WORK_STREAK_TIMEOUT_MS - 1;
  assert.deepEqual(
    [game.workService.profile('worker').workStreak, game.workService.profile('worker').streakFailures],
    [25, 3],
  );
  now += 1;
  assert.deepEqual(
    [game.workService.profile('worker').workStreak, game.workService.profile('worker').streakFailures],
    [0, 0],
  );
  game.close();
});

test('the fifth failure breaks an active streak without changing lifetime failures', () => {
  let now = 10_000;
  const game = feature({ clock: () => now });
  game.workRepository.ensureProfile('worker', now);
  game.db.prepare(`UPDATE rng_work_profiles SET work_streak = 10, last_shift_end_at = ?
    WHERE user_id = ?`).run(BigInt(now), 'worker');
  for (let failure = 1; failure <= WORK_STREAK_FAILURE_LIMIT; failure += 1) {
    now += 60 * 60 * 1_000;
    const session = start(game).session;
    const wrong = session.buttonSlots.find((slot) => slot.ingredient !== session.expectedRecipe[0]);
    assert.equal(game.workService.press(session.id, 'worker', wrong.index).status, 'failed');
    const profile = game.workService.profile('worker');
    if (failure < WORK_STREAK_FAILURE_LIMIT) {
      assert.equal(profile.workStreak, 10);
      assert.equal(profile.streakFailures, failure);
    } else {
      assert.equal(profile.workStreak, 0);
      assert.equal(profile.streakFailures, 0);
    }
    assert.equal(profile.failedShifts, BigInt(failure));
  }
  game.close();
});

test('successful work increments streak without clearing accumulated streak failures', () => {
  const game = feature();
  game.workRepository.ensureProfile('worker', 1);
  game.db.prepare(`UPDATE rng_work_profiles SET work_streak = 3, streak_failures = 2,
    last_shift_end_at = NULL WHERE user_id = ?`).run('worker');
  finishRecipe(game, start(game).session);
  const profile = game.workService.profile('worker');
  assert.equal(profile.workStreak, 4);
  assert.equal(profile.streakFailures, 2);
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
  assert.equal(WORK_COOLDOWN_MS, 60 * 60 * 1_000);
  assert.deepEqual(start(game), { status: 'cooldown', availableAt: 3_610_000 });
  now = 3_609_999;
  assert.equal(start(game).status, 'cooldown');
  now = 3_610_000;
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
  assert.match(content(attempt.calls.replies[0]), /These aren't your work controls\./);
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
  assert.equal(press.calls.updates.length, 1);
  assert.match(content(press.calls.updates[0]), /Shift Expired/);
  assert.match(content(press.calls.followUps[0]), /This work shift has expired\./);
  game.close();
});

test('all customer definitions exactly preserve IDs, rewards, orders, and invariants', () => {
  const expectedRewards = [1, 4, 7, 9, 12, 15, 8, 12, 17, 21, 26, 30, 15, 20, 25, 30, 35, 40, 45, 50];
  const expectedLengths = [3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12];
  assert.equal(BURGER_CUSTOMERS.length, 20);
  assert.deepEqual(BURGER_CUSTOMERS.map((customer) => customer.id), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.deepEqual(BURGER_CUSTOMERS.map((customer) => customer.reward), expectedRewards);
  assert.equal(WORK_INGREDIENTS.cheese, '<:cheese:1537045258838478848>');
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

test('migration 008 preserves work profiles and initializes streak state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-streak-'));
  const databasePath = path.join(directory, 'rng.sqlite');
  const allMigrations = path.join(__dirname, '..', 'src', 'features', 'rng-game', 'migrations');
  const previousMigrations = path.join(directory, 'migrations');
  fs.mkdirSync(previousMigrations);
  for (const name of fs.readdirSync(allMigrations).filter((name) => name < '008_work_streaks.sql')) {
    fs.copyFileSync(path.join(allMigrations, name), path.join(previousMigrations, name));
  }
  const db = openDatabase({ databasePath, migrationsPath: previousMigrations });
  db.prepare(`INSERT INTO rng_players
    (user_id, sheckle_balance, inventory_capacity, inventory_upgrade_level, token_balance, created_at, updated_at)
    VALUES ('worker', 0, 100, 0, 77, 1, 1)`).run();
  db.prepare(`INSERT INTO rng_work_profiles
    (user_id, total_xp, completed_shifts, failed_shifts, total_token_salary, created_at, updated_at)
    VALUES ('worker', 123, 4, 2, 55, 1, 1)`).run();
  migrate(db, allMigrations);
  const profile = db.prepare("SELECT * FROM rng_work_profiles WHERE user_id = 'worker'").get();
  assert.deepEqual(
    [profile.total_xp, profile.completed_shifts, profile.failed_shifts, profile.total_token_salary],
    [123n, 4n, 2n, 55n],
  );
  assert.deepEqual([profile.work_streak, profile.streak_failures], [0n, 0n]);
  assert.equal(db.prepare("SELECT token_balance FROM rng_players WHERE user_id = 'worker'").get().token_balance, 77n);
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

