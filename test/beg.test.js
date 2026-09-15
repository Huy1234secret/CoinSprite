const assert = require('node:assert/strict');
const test = require('node:test');

const { featureCommandsForConfig } = require('../src/applicationCommands');
const {
  BUTTON_LABEL_LIMIT, OUTCOME_COLORS, buttonLabel, menuPayload, outcomeMessage, outcomePayload,
} = require('../src/features/beg/components');
const { parseBegCommand } = require('../src/features/beg/commands');
const {
  APPROACHES, APPROACHES_BY_TIER, APPROACH_BY_ID, MESSAGE_VARIANT_COUNT, MINIMUM_REWARD,
  TARGET_NET, TIERS,
} = require('../src/features/beg/data/approaches');
const { createBegFeature } = require('../src/features/beg');
const { migrateBeg } = require('../src/features/beg/migrate');
const { BegRepository, COOLDOWN_MS, SESSION_TTL_MS } = require('../src/features/beg/repository');
const { BegService, selectApproaches } = require('../src/features/beg/service');
const { messagePayloadErrors } = require('../src/features/shared/discordPayload');
const { openDatabase } = require('../src/features/work/repositories/database');
const { gameCommandAllowed, normalizeGamesConfig } = require('../src/serverConfig');

const USER = '100000000000000001';
const GUILD = '200000000000000002';
const CHANNEL = '300000000000000003';
const MESSAGE = '400000000000000004';
const OFFERED = Object.freeze([
  'cardboard-sign', 'borrowed-violin', 'merchant-dice', 'royal-carriage',
]);

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function setup(t, options = {}) {
  let now = options.now ?? 1_000_000;
  const db = openDatabase({ databasePath: ':memory:' });
  migrateBeg(db);
  const repository = new BegRepository(db, { clock: () => now });
  t.after(() => db.close());
  return { db, repository, now: () => now, advance: amount => { now += amount; } };
}

function context(overrides = {}) {
  return {
    userId: USER, guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE, ...overrides,
  };
}

function open(repository, sessionId = 'session', options = {}) {
  const opened = repository.open({
    sessionId,
    userId: options.userId || USER,
    guildId: options.guildId || GUILD,
    channelId: options.channelId || CHANNEL,
    approachIds: options.approachIds || OFFERED,
    bypassCooldown: options.bypassCooldown === true,
  });
  if (opened.status === 'opened') repository.attachMessage(sessionId, options.messageId || MESSAGE);
  return opened;
}

function resolve(repository, sessionId, approachId, outcome, amount, overrides = {}) {
  return repository.resolve(sessionId, {
    ...context(overrides), approachId, outcome, amount,
  });
}

function setBalance(db, userId, amount, now = 1_000_000) {
  db.prepare(`INSERT INTO counting_bronze_balances(user_id,balance,updated_at) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance,updated_at=excluded.updated_at`)
    .run(userId, BigInt(amount).toString(), BigInt(now));
}

function allComponentText(payload) {
  const result = [];
  function walk(component) {
    if (typeof component?.content === 'string') result.push(component.content);
    for (const child of component?.components || []) walk(child);
    if (component?.accessory) walk(component.accessory);
    if (component?.component) walk(component.component);
  }
  for (const component of payload.components || []) walk(component);
  return result;
}

function assertNoBlankLines(payload) {
  for (const content of allComponentText(payload)) {
    assert.doesNotMatch(content, /\n\n/);
    assert.ok(content.split('\n').every(line => line.length > 0));
  }
}

test('catalog has 100 unique authored approaches split evenly across four risk tiers', () => {
  assert.equal(APPROACHES.length, 100);
  assert.deepEqual(TIERS.map(tier => APPROACHES_BY_TIER[tier.id].length), [25, 25, 25, 25]);
  assert.deepEqual(TIERS.map(tier => tier.weight), [45, 30, 20, 5]);
  for (const key of ['id', 'name', 'success', 'failure', 'lossMessage']) {
    assert.equal(new Set(APPROACHES.map(item => item[key])).size, 100, `${key} must be unique`);
  }
  for (const item of APPROACHES) {
    assert.ok(item.successChance > 0 && item.successChance + item.lossChance <= 100);
    assert.ok(item.reward[0] >= MINIMUM_REWARD && item.reward[1] >= item.reward[0]);
    assert.ok(item.loss[0] >= 0 && item.loss[1] >= item.loss[0]);
    for (const key of ['successMessages', 'failureMessages', 'lossMessages']) {
      assert.equal(item[key].length, MESSAGE_VARIANT_COUNT);
      assert.equal(new Set(item[key]).size, MESSAGE_VARIANT_COUNT, `${item.id}.${key} must be unique`);
    }
    if (item.tier === 'safe') assert.deepEqual(item.loss, [0, 0]);
  }
  const allMessages = APPROACHES.flatMap(item => [
    ...item.successMessages, ...item.failureMessages, ...item.lossMessages,
  ]);
  assert.equal(allMessages.length, 6_000);
  assert.equal(new Set(allMessages).size, 6_000);
});

test('outcome message selection varies across attempts and remains stable for replays', () => {
  const approach = APPROACH_BY_ID['borrowed-violin'];
  for (const [outcome, messages] of [
    ['success', approach.successMessages],
    ['fail', approach.failureMessages],
    ['loss', approach.lossMessages],
  ]) {
    const selected = new Set(Array.from({ length: 2_000 }, (_, index) => (
      outcomeMessage(approach, outcome, `variant-session-${index}`)
    )));
    assert.equal(selected.size, MESSAGE_VARIANT_COUNT);
    assert.ok([...selected].every(message => messages.includes(message)));
    assert.equal(
      outcomeMessage(approach, outcome, 'stable-session'),
      outcomeMessage(approach, outcome, 'stable-session'),
    );
  }
});

test('rebalance keeps every approach at 100+ Bronze and every tier near the target net', () => {
  const averages = Object.fromEntries(TIERS.map((tier) => {
    const values = APPROACHES_BY_TIER[tier.id].map((item) => {
      const rewardAverage = (item.reward[0] + item.reward[1]) / 2;
      const lossAverage = (item.loss[0] + item.loss[1]) / 2;
      return item.successChance / 100 * rewardAverage - item.lossChance / 100 * lossAverage;
    });
    return [tier.id, values.reduce((sum, value) => sum + value, 0) / values.length];
  }));
  assert.equal(Math.min(...APPROACHES.map(item => item.reward[0])), MINIMUM_REWARD);
  for (const value of Object.values(averages)) {
    assert.ok(value >= TARGET_NET - 1 && value <= TARGET_NET + 1, String(averages));
  }
  assert.ok(APPROACH_BY_ID['coin-black-hole'].reward[1] > APPROACH_BY_ID['cardboard-sign'].reward[1] * 100);
});

test('weighted deterministic selection returns four unique stored-ready approaches', () => {
  const selected = selectApproaches(sequence([0, 0, 0.50, 0, 0.80, 0, 0.99, 0]));
  assert.deepEqual(selected.map(item => item.tier), ['safe', 'uncertain', 'risky', 'ridiculous']);
  assert.equal(new Set(selected.map(item => item.id)).size, 4);
  const repeatedTier = selectApproaches(() => 0);
  assert.deepEqual(repeatedTier.map(item => item.tier), ['safe', 'safe', 'safe', 'safe']);
  assert.equal(new Set(repeatedTier.map(item => item.id)).size, 4);
});

test('csbeg parsing and /cs-beg registration are exact', () => {
  for (const value of ['csbeg', ' CSBEG ', '\ncsBeg\t']) assert.equal(parseBegCommand(value), true);
  for (const value of ['/cs-beg', 'cs-beg', 'csbeg now', 'xcsbeg', '']) assert.equal(parseBegCommand(value), false);
  const commands = featureCommandsForConfig({ enabled: true });
  assert.ok(commands.some(command => command.name === 'cs-beg'));
  const games = normalizeGamesConfig({ commandSettings: [{ channelIds: [CHANNEL], commands: ['cs-beg'] }] });
  assert.equal(gameCommandAllowed({ games }, CHANNEL, 'cs-beg'), true);
  assert.equal(gameCommandAllowed({ games }, 'other', 'cs-beg'), false);
});

test('menu uses four grey text-only approach buttons with valid limits', () => {
  for (let index = 0; index < APPROACHES.length; index += 4) {
    const ids = APPROACHES.slice(index, index + 4).map(item => item.id);
    while (ids.length < 4) ids.push(APPROACHES[ids.length].id);
    const payload = menuPayload({ sessionId: 'abcdefghijklmnop', offeredApproachIds: ids });
    assert.deepEqual(messagePayloadErrors(payload), []);
    assertNoBlankLines(payload);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    assert.equal(container.accent_color, 0xffffff);
    assert.deepEqual(container.components.slice(0, 3), [
      { type: 10, content: '### What are you going to do?' },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: '-# Select an action' },
    ]);
    const buttons = container.components[3].components;
    assert.equal(buttons.length, 4);
    for (const [slot, button] of buttons.entries()) {
      const approach = APPROACH_BY_ID[ids[slot]];
      assert.equal(button.style, 2);
      assert.equal(button.label, approach.name);
      assert.equal(button.label, buttonLabel(approach));
      assert.equal(button.emoji, undefined);
      assert.ok(button.label.length <= BUTTON_LABEL_LIMIT);
      assert.ok(button.custom_id.length <= 100);
    }
  }
});

test('outcomes use unique flavor, shared currency formatting, result colors, and no blank lines', () => {
  for (const approach of APPROACHES) {
    for (const [outcome, amount, messages, color] of [
      ['success', 5n, approach.successMessages, OUTCOME_COLORS.success],
      ['fail', 0n, approach.failureMessages, OUTCOME_COLORS.fail],
      ['loss', 5n, approach.lossMessages, OUTCOME_COLORS.loss],
    ]) {
      const sessionId = `payload-${approach.id}-${outcome}`;
      const payload = outcomePayload({ session: {
        sessionId, approachId: approach.id, outcome, amount, balanceAfter: 123n, cooldownUntil: 1_060_000,
      } });
      assert.deepEqual(messagePayloadErrors(payload), []);
      assertNoBlankLines(payload);
      assert.equal(payload.components[0].accent_color, color);
      assert.equal(payload.components[0].components.length, 1);
      const text = payload.components[0].components[0].content;
      assert.match(text, new RegExp(`^### ${approach.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
      assert.ok(text.includes(outcomeMessage(approach, outcome, sessionId)));
      assert.ok(messages.some(message => text.includes(message)));
      assert.match(text, /<:CSBC:/);
    }
  }
});

test('opening persists four options, permits only one open menu, and expires at one minute', t => {
  const { repository, advance } = setup(t);
  const first = open(repository, 'first');
  assert.equal(first.status, 'opened');
  assert.deepEqual(repository.session('first').offeredApproachIds, OFFERED);
  const second = open(repository, 'second', { guildId: 'different-guild' });
  assert.equal(second.status, 'active');
  assert.equal(second.session.sessionId, 'first');
  advance(SESSION_TTL_MS - 1);
  assert.equal(open(repository, 'still-active').status, 'active');
  advance(1);
  assert.equal(open(repository, 'replacement').status, 'opened');
  assert.equal(repository.session('first').status, 'expired');
});

test('only an offered approach can settle and every interaction context field is enforced', t => {
  const { repository } = setup(t);
  open(repository, 'bound');
  const invalid = resolve(repository, 'bound', 'coin-black-hole', 'success', 999);
  assert.equal(invalid.status, 'invalid-approach');
  assert.equal(repository.balance(USER), 0n);
  assert.equal(repository.profile(USER).cooldownUntil, 0);
  for (const overrides of [
    { userId: 'wrong' }, { guildId: 'wrong' }, { channelId: 'wrong' }, { messageId: 'wrong' },
  ]) assert.equal(resolve(repository, 'bound', OFFERED[0], 'success', 5, overrides).status, 'denied');
  assert.equal(repository.session('bound').status, 'open');
});

test('success, ordinary failure, loss, zero cap, and safe no-loss outcomes settle correctly', t => {
  const { db, repository } = setup(t);
  open(repository, 'success');
  let result = resolve(repository, 'success', OFFERED[0], 'success', 6);
  assert.equal(result.session.balanceAfter, 6n);
  assert.equal(repository.profile(USER).successes, 1);

  open(repository, 'failure', { bypassCooldown: true });
  result = resolve(repository, 'failure', OFFERED[0], 'fail', 999);
  assert.equal(result.session.amount, 0n);
  assert.equal(result.session.balanceAfter, 6n);

  setBalance(db, USER, 20n);
  open(repository, 'loss', { bypassCooldown: true });
  result = resolve(repository, 'loss', OFFERED[1], 'loss', 7);
  assert.equal(result.session.balanceAfter, 13n);
  assert.equal(repository.profile(USER).losses, 1);

  setBalance(db, USER, 0n);
  open(repository, 'zero-loss', { bypassCooldown: true });
  result = resolve(repository, 'zero-loss', OFFERED[1], 'loss', 8);
  assert.equal(result.session.amount, 0n);
  assert.equal(result.session.balanceAfter, 0n);
  assert.equal(repository.balance(USER), 0n);

  const calls = [];
  const service = new BegService({ resolve(_id, input) { calls.push(input); return input; } }, { rng: () => 0.999 });
  for (const approach of APPROACHES_BY_TIER.safe) {
    assert.notEqual(service.resolve({ sessionId: 'x', approachId: approach.id }).outcome, 'loss');
  }
});

test('one outcome roll gives mutually exclusive absolute success, loss, and failure probabilities', () => {
  const calls = [];
  const repository = { resolve(_id, input) { calls.push(input); return input; } };
  const approach = APPROACH_BY_ID['borrowed-violin'];
  const values = [0, 0, approach.successChance / 100 + 0.001, 0, 0.999];
  const service = new BegService(repository, { rng: () => values.shift() });
  const input = { sessionId: 'x', approachId: approach.id };
  assert.equal(service.resolve(input).outcome, 'success');
  assert.equal(service.resolve(input).outcome, 'loss');
  assert.equal(service.resolve(input).outcome, 'fail');
  assert.equal(calls.length, 3);
});

test('cooldown starts on settlement and lasts exactly one minute globally per user', t => {
  const { repository, now, advance } = setup(t);
  open(repository, 'cooldown');
  const result = resolve(repository, 'cooldown', OFFERED[0], 'fail', 0);
  assert.equal(result.session.cooldownUntil, now() + COOLDOWN_MS);
  assert.equal(open(repository, 'early', { guildId: 'different-guild' }).status, 'cooldown');
  advance(COOLDOWN_MS - 1);
  assert.equal(open(repository, 'one-ms-early').status, 'cooldown');
  advance(1);
  assert.equal(open(repository, 'ready').status, 'opened');
});

test('duplicate and concurrent settlements move money exactly once and replay stored results', async t => {
  const { repository } = setup(t);
  open(repository, 'duplicate');
  const attempts = await Promise.all([
    Promise.resolve().then(() => resolve(repository, 'duplicate', OFFERED[0], 'success', 7)),
    Promise.resolve().then(() => resolve(repository, 'duplicate', OFFERED[0], 'success', 999)),
  ]);
  assert.equal(attempts.filter(item => item.replay === false).length, 1);
  assert.equal(attempts.filter(item => item.replay === true).length, 1);
  assert.equal(repository.balance(USER), 7n);
  assert.equal(repository.profile(USER).attempts, 1);
  assert.deepEqual(attempts[1].session, attempts[0].session);
});

test('settlement rollback restores wallet, statistics, cooldown, and open session', t => {
  const { db, repository } = setup(t);
  open(repository, 'rollback');
  db.exec(`CREATE TRIGGER abort_beg_settlement BEFORE UPDATE OF status ON beg_sessions
    WHEN NEW.status='settled' BEGIN SELECT RAISE(ABORT, 'forced rollback'); END`);
  assert.throws(() => resolve(repository, 'rollback', OFFERED[0], 'success', 50), /forced rollback/);
  assert.equal(repository.balance(USER), 0n);
  assert.equal(repository.profile(USER).attempts, 0);
  assert.equal(repository.profile(USER).cooldownUntil, 0);
  assert.equal(repository.session('rollback').status, 'open');
});

test('stored options and settled result survive repository restart', t => {
  const { db, repository, now } = setup(t);
  open(repository, 'restart');
  const original = resolve(repository, 'restart', OFFERED[2], 'success', 31);
  const restarted = new BegRepository(db, { clock: now });
  assert.deepEqual(restarted.session('restart'), original.session);
  const replay = resolve(restarted, 'restart', OFFERED[2], 'loss', 999);
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.session, original.session);
  assert.equal(restarted.balance(USER), 31n);
});

test('feature rejects unsafe sources and binds buttons to the offered message', async t => {
  const { db, repository, now, advance } = setup(t);
  const feature = createBegFeature({
    db, repository, clock: now, rng: () => 0, createId: () => 'feature-session',
    isCommandAllowed: () => true,
  });
  t.after(() => feature.close());
  const unsafe = [
    { content: 'csbeg', author: { id: USER }, guildId: null },
    { content: 'csbeg', author: { id: USER, bot: true }, guildId: GUILD },
    { content: 'csbeg', author: { id: USER }, guildId: GUILD, webhookId: 'hook' },
    { content: 'csbeg', author: { id: USER }, guildId: GUILD, system: true },
  ];
  for (const source of unsafe) assert.equal(await feature.handleMessage(source), false);
  assert.equal(await feature.handleInteraction({
    isChatInputCommand: () => true, commandName: 'cs-beg', guildId: null, user: { id: USER },
  }), false);

  const replies = [];
  const message = {
    content: 'csbeg', author: { id: USER }, guildId: GUILD, channelId: CHANNEL,
    async reply(payload) { replies.push(payload); return { id: MESSAGE }; },
  };
  assert.equal(await feature.handleMessage(message), true);
  assert.equal(replies.length, 1);
  assert.equal((replies[0].flags & 64), 0);
  assert.equal(repository.session('feature-session').messageId, MESSAGE);

  const deniedReplies = [];
  const denied = {
    isButton: () => true,
    customId: `csbeg:feature-session:${repository.session('feature-session').offeredApproachIds[0]}`,
    user: { id: 'wrong-user' }, guildId: GUILD, channelId: CHANNEL,
    message: { id: MESSAGE },
    async reply(payload) { deniedReplies.push(payload); },
  };
  assert.equal(await feature.handleInteraction(denied), true);
  assert.equal(deniedReplies.length, 1);
  assert.equal(repository.session('feature-session').status, 'open');

  const invalidReplies = [];
  const invalid = {
    ...denied, user: { id: USER }, customId: 'csbeg:feature-session:coin-black-hole',
    async reply(payload) { invalidReplies.push(payload); },
  };
  assert.equal(await feature.handleInteraction(invalid), true);
  assert.equal(invalidReplies.length, 1);
  assert.equal(repository.session('feature-session').status, 'open');

  advance(SESSION_TTL_MS);
  let edited;
  const expired = {
    ...denied, user: { id: USER },
    async deferUpdate() { this.deferred = true; },
    message: { id: MESSAGE, async edit(payload) { edited = payload; } },
  };
  assert.equal(await feature.handleInteraction(expired), true);
  assert.match(allComponentText(edited).join('\n'), /expired/i);
  assert.equal(repository.session('feature-session').status, 'expired');
});

test('failed initial message send expires the unfinished session', async t => {
  const { db, repository, now } = setup(t);
  const feature = createBegFeature({
    db, repository, clock: now, rng: () => 0, createId: () => 'send-failure',
    isCommandAllowed: () => true,
  });
  t.after(() => feature.close());
  await assert.rejects(feature.handleMessage({
    content: 'csbeg', author: { id: USER }, guildId: GUILD, channelId: CHANNEL,
    async reply() { throw new Error('send failed'); },
  }), /send failed/);
  assert.equal(repository.session('send-failure').status, 'expired');
});
