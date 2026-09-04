const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const levelingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-leveling-scope-'));
const previousLevelingDataPath = process.env.LEVELING_DATA_PATH;
process.env.LEVELING_DATA_PATH = path.join(levelingDirectory, 'leveling.json');

const {
  DEFAULT_LEVELING_CONFIG, gameCommandAllowed, normalizeState,
} = require('../src/serverConfig');
const { CountingRepository } = require('../src/features/counting/repositories/countingRepository');
const { migrate: migrateCounting } = require('../src/features/counting/repositories/database');
const { CountingService } = require('../src/features/counting/services/countingService');
const { InventoryRepository } = require('../src/features/inventory/repositories/inventoryRepository');
const { InventoryService } = require('../src/features/inventory/services/inventoryService');
const {
  memberStats, processMessageXp, resetLevelingCache,
} = require('../src/leveling');
const { openSqliteDatabase } = require('../src/features/shared/database');
const {
  MIGRATIONS_PATH: WORK_MIGRATIONS_PATH,
  migrate: migrateWork,
  openDatabase: openWorkDatabase,
} = require('../src/features/work/repositories/database');
const {
  WORK_COOLDOWN_MS, WORK_TOKEN_KEY, WorkRepository,
} = require('../src/features/work/repositories/workRepository');

const GUILD_A = '123456789012345678';
const GUILD_B = '223456789012345678';
const CHANNEL_A = '323456789012345678';
const CHANNEL_B = '423456789012345678';
const USER_A = '523456789012345678';
const USER_B = '623456789012345678';

test.after(() => {
  resetLevelingCache();
  if (previousLevelingDataPath === undefined) delete process.env.LEVELING_DATA_PATH;
  else process.env.LEVELING_DATA_PATH = previousLevelingDataPath;
  fs.rmSync(levelingDirectory, { recursive: true, force: true, maxRetries: 3 });
});

function gameDatabase(clock = () => 1_000_000) {
  const db = openWorkDatabase({ databasePath: ':memory:' });
  migrateCounting(db);
  return {
    db,
    counting: new CountingService(new CountingRepository(db, { clock })),
    work: new WorkRepository(db, { clock }),
    inventory: new InventoryService(new InventoryRepository(db)),
  };
}

function countMessage(id, guildId, userId, content) {
  return { id, guildId, channelId: guildId === GUILD_A ? CHANNEL_A : CHANNEL_B, author: { id: userId }, content };
}

function workSession(overrides = {}) {
  return {
    sessionId: 'scope-session', guildId: GUILD_A, channelId: CHANNEL_A, userId: USER_A,
    job: 'burger', difficulty: 'easy', normalizedDifficulty: 0, deadline: 2_000_000,
    state: { target: ['bottom_bun'], cursor: 0, buttons: ['bottom_bun'] },
    baseSalary: 25, xpReward: 25, ...overrides,
  };
}

test('Bronze is global while Counting sequences and turn ownership remain independent per guild', () => {
  const { db, counting } = gameDatabase();
  try {
    assert.equal(counting.processMessage(countMessage('a-1', GUILD_A, USER_A, '1')).status, 'correct');
    assert.equal(counting.balance(USER_A), 1n, 'Bronze earned in guild A is visible through the global user balance');
    assert.equal(counting.nextExpected(GUILD_A), '2');
    assert.equal(counting.nextExpected(GUILD_B), '1');

    assert.equal(counting.processMessage(countMessage('b-1', GUILD_B, USER_A, '1')).status, 'correct');
    assert.equal(counting.balance(USER_A), 2n, 'the same user accumulates one balance across guilds');
    assert.equal(counting.nextExpected(GUILD_A), '2');
    assert.equal(counting.nextExpected(GUILD_B), '2');

    assert.equal(counting.processMessage(countMessage('a-2', GUILD_A, USER_B, '2')).status, 'correct');
    assert.equal(counting.nextExpected(GUILD_A), '3');
    assert.equal(counting.nextExpected(GUILD_B), '2');
    assert.equal(counting.balance(USER_B), 2n);
    assert.equal(counting.balance(USER_A), 2n, 'different users never share Bronze');
  } finally {
    db.close();
  }
});

test('Work progression, inventory, active-session lock, and cooldown are global but isolated by user', () => {
  let now = 1_000_000;
  const { db, work, inventory } = gameDatabase(() => now);
  try {
    work.profile(USER_A);
    db.prepare('UPDATE work_profiles SET xp = 90, streak = 7 WHERE user_id = ?').run(USER_A);
    assert.equal(work.create(workSession()).status, 'created');

    const activeAcrossGuilds = work.create(workSession({
      sessionId: 'guild-b-active-attempt', guildId: GUILD_B, channelId: CHANNEL_B,
    }));
    assert.equal(activeAcrossGuilds.status, 'active');
    assert.equal(activeAcrossGuilds.session.guildId, GUILD_A, 'session location remains contextual history');

    const settlement = work.settle('scope-session', 'succeeded');
    assert.deepEqual(settlement.profile, {
      userId: USER_A, level: 2, xp: 15, streak: 8, cooldownUntil: now + WORK_COOLDOWN_MS,
    });
    assert.equal(work.balance(USER_A), 27n);

    const inventoryInGuildB = inventory.page(USER_A);
    assert.deepEqual(inventoryInGuildB.items.map(({ itemKey, quantity }) => ({ itemKey, quantity })), [
      { itemKey: WORK_TOKEN_KEY, quantity: 1n },
    ]);

    const cooldownAcrossGuilds = work.create(workSession({
      sessionId: 'guild-b-cooldown-attempt', guildId: GUILD_B, channelId: CHANNEL_B,
    }));
    assert.equal(cooldownAcrossGuilds.status, 'cooldown');
    assert.deepEqual(cooldownAcrossGuilds.profile, settlement.profile);

    assert.deepEqual(work.profile(USER_A), settlement.profile, 'Work profile has one user-only identity in every guild');
    assert.deepEqual(work.profile(USER_B), {
      userId: USER_B, level: 1, xp: 0, streak: 0, cooldownUntil: 0,
    });
    assert.equal(work.balance(USER_B), 0n);
    assert.deepEqual(inventory.page(USER_B).items, []);
    assert.equal(work.create(workSession({
      sessionId: 'other-user', guildId: GUILD_B, channelId: CHANNEL_B, userId: USER_B,
    })).status, 'created', 'another user is not blocked by the first user\'s active session or cooldown');

    now += WORK_COOLDOWN_MS;
    assert.equal(work.create(workSession({
      sessionId: 'same-user-ready', guildId: GUILD_B, channelId: CHANNEL_B,
    })).status, 'created');
  } finally {
    db.close();
  }
});

test('Games configuration remains independent per guild', () => {
  const state = normalizeState({ guilds: {
    [GUILD_A]: { games: { commandSettings: [{ id: 'a', channelIds: [CHANNEL_A], commands: ['cs-work'] }] } },
    [GUILD_B]: { games: { commandSettings: [{ id: 'b', channelIds: [CHANNEL_B], commands: ['cs-balance'] }] } },
  } });

  assert.equal(gameCommandAllowed(state.guilds[GUILD_A], CHANNEL_A, 'cs-work'), true);
  assert.equal(gameCommandAllowed(state.guilds[GUILD_A], CHANNEL_B, 'cs-work'), false);
  assert.equal(gameCommandAllowed(state.guilds[GUILD_B], CHANNEL_B, 'cs-balance'), true);
  assert.equal(gameCommandAllowed(state.guilds[GUILD_B], CHANNEL_A, 'cs-balance'), false);
  assert.notDeepEqual(state.guilds[GUILD_A].games, state.guilds[GUILD_B].games);
});

test('Leveling XP, cooldown, and leaderboard state remain independent per guild for the same user', () => {
  resetLevelingCache();
  const config = structuredClone(DEFAULT_LEVELING_CONFIG);
  config.enabled = true;
  config.xp = { min: 1, max: 100, cooldownSeconds: 60 };
  config.channelMultipliers = { [CHANNEL_A]: 1, [CHANNEL_B]: 1 };
  const message = (guildId, channelId, userId, content) => ({
    guildId, channelId, content, author: { id: userId }, member: { roles: { cache: new Map() } }, channel: {},
  });

  assert.equal(processMessageXp(message(GUILD_A, CHANNEL_A, USER_A, 'guild a'), {
    config, nowMs: 1_000, amount: 10, fingerprint: 'guild-a-1',
  }).awarded, true);
  assert.equal(processMessageXp(message(GUILD_B, CHANNEL_B, USER_A, 'guild b'), {
    config, nowMs: 1_000, amount: 30, fingerprint: 'guild-b-1',
  }).awarded, true);
  assert.equal(processMessageXp(message(GUILD_A, CHANNEL_A, USER_A, 'guild a cooldown'), {
    config, nowMs: 2_000, amount: 10, fingerprint: 'guild-a-2',
  }).reason, 'cooldown');
  assert.equal(processMessageXp(message(GUILD_B, CHANNEL_B, USER_A, 'guild b ready'), {
    config, nowMs: 62_000, amount: 20, fingerprint: 'guild-b-2',
  }).awarded, true);
  assert.equal(processMessageXp(message(GUILD_A, CHANNEL_A, USER_B, 'guild a leader'), {
    config, nowMs: 1_000, amount: 50, fingerprint: 'guild-a-other',
  }).awarded, true);

  assert.equal(memberStats(GUILD_A, USER_A, config).xp, 10);
  assert.equal(memberStats(GUILD_A, USER_A, config).rank, 2);
  assert.equal(memberStats(GUILD_B, USER_A, config).xp, 50);
  assert.equal(memberStats(GUILD_B, USER_A, config).rank, 1);
});

test('schema keys global player data by user and retains guild provenance for shared/context records', () => {
  const { db } = gameDatabase();
  try {
    const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all()
      .map((column) => ({ name: column.name, primaryKeyOrder: Number(column.pk) }));
    assert.deepEqual(columns('counting_bronze_balances').filter((column) => column.primaryKeyOrder), [
      { name: 'user_id', primaryKeyOrder: 1 },
    ]);
    assert.deepEqual(columns('work_profiles').filter((column) => column.primaryKeyOrder), [
      { name: 'user_id', primaryKeyOrder: 1 },
    ]);
    assert.deepEqual(columns('inventory').filter((column) => column.primaryKeyOrder), [
      { name: 'user_id', primaryKeyOrder: 1 }, { name: 'item_key', primaryKeyOrder: 2 },
    ]);
    for (const table of ['counting_bronze_balances', 'work_profiles', 'inventory']) {
      assert.equal(columns(table).some((column) => column.name === 'guild_id'), false);
    }
    for (const table of ['counting_guild_state', 'counting_processed_messages', 'work_sessions']) {
      assert.equal(columns(table).some((column) => column.name === 'guild_id'), true);
    }
    const activeIndex = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'work_one_active_user'").get();
    assert.match(activeIndex.sql, /ON work_sessions \(user_id\) WHERE status = 'active'/);
  } finally {
    db.close();
  }
});

test('legacy per-guild Work cooldowns migrate transactionally to the highest global value and migration is idempotent', () => {
  const stagedMigrations = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-work-migrations-'));
  const db = openSqliteDatabase(':memory:');
  try {
    for (const name of ['001_work.sql', '002_work_economy.sql']) {
      fs.copyFileSync(path.join(WORK_MIGRATIONS_PATH, name), path.join(stagedMigrations, name));
    }
    migrateWork(db, stagedMigrations);
    db.prepare(`INSERT INTO work_profiles
      (user_id, level, xp, streak, cooldown_until, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(USER_A, 7, 88, 9, 2_500, 123);
    const insertLegacy = db.prepare('INSERT INTO work_cooldowns (guild_id, user_id, next_work_at) VALUES (?, ?, ?)');
    insertLegacy.run(GUILD_A, USER_A, 1_000);
    insertLegacy.run(GUILD_B, USER_A, 3_000);
    insertLegacy.run(GUILD_A, USER_B, 5_000);
    insertLegacy.run(GUILD_B, USER_B, 4_000);
    insertLegacy.run(GUILD_A, 'invalid-user', -1);

    migrateWork(db, WORK_MIGRATIONS_PATH);
    assert.deepEqual(db.prepare('SELECT level, xp, streak, cooldown_until FROM work_profiles WHERE user_id = ?').get(USER_A), {
      level: 7n, xp: 88n, streak: 9n, cooldown_until: 3_000n,
    });
    assert.deepEqual(db.prepare('SELECT level, xp, streak, cooldown_until FROM work_profiles WHERE user_id = ?').get(USER_B), {
      level: 1n, xp: 0n, streak: 0n, cooldown_until: 5_000n,
    });
    assert.equal(db.prepare("SELECT 1 FROM work_profiles WHERE user_id = 'invalid-user'").get(), undefined);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_cooldowns'").get(), undefined);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM work_schema_migrations WHERE version = '003_global_work_cooldowns.sql'").get().count, 1n);

    const before = db.prepare('SELECT * FROM work_profiles ORDER BY user_id').all();
    migrateWork(db, WORK_MIGRATIONS_PATH);
    assert.deepEqual(db.prepare('SELECT * FROM work_profiles ORDER BY user_id').all(), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM work_schema_migrations WHERE version = '003_global_work_cooldowns.sql'").get().count, 1n);
  } finally {
    db.close();
    fs.rmSync(stagedMigrations, { recursive: true, force: true, maxRetries: 3 });
  }
});
