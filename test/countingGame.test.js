const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ChannelType } = require('discord.js');

const {
  COUNT_FAILURE_EMOJI,
  COUNT_SUCCESS_EMOJI,
  SAFE_ALLOWED_MENTIONS,
  createCountingFeature,
} = require('../src/features/counting');
const {
  BRONZE_COIN_EMOJI,
  balancePayload,
  formatBronzeBalance,
} = require('../src/features/counting/components/builders');
const { parseBalanceCommand } = require('../src/features/counting/commands');
const { openDatabase } = require('../src/features/counting/repositories/database');
const { CountingRepository } = require('../src/features/counting/repositories/countingRepository');
const { validateCountingChannel } = require('../src/adminServer');
const { featureCommandsForConfig } = require('../src/applicationCommands');
const { normalizeState, SCHEMA_VERSION } = require('../src/serverConfig');

const GUILD_ID = '123456789012345678';
const CHANNEL_ID = '223456789012345678';
const OTHER_CHANNEL_ID = '323456789012345678';
const USER_ID = '423456789012345678';
const OTHER_USER_ID = '823456789012345678';
let messageSequence = 0;

function user(id = USER_ID, name = 'Counter') {
  return {
    id,
    username: name,
    displayAvatarURL: () => `https://cdn.example/${id}.png`,
  };
}

function fakeMessage(content, options = {}) {
  const calls = { reactions: [], sends: [], replies: [] };
  const author = options.author || user();
  const fetchedUsers = options.fetchedUsers || new Map();
  const message = {
    id: options.id || `52345678901234${String(++messageSequence).padStart(4, '0')}`,
    guildId: options.dm ? null : (options.guildId || GUILD_ID),
    channelId: options.channelId || CHANNEL_ID,
    content,
    author: { ...author, bot: options.bot === true },
    webhookId: options.webhook ? '623456789012345678' : null,
    system: options.system === true,
    guild: options.dm ? null : { members: { cache: options.memberCache || new Map() } },
    mentions: { users: options.mentions || new Map() },
    client: { users: { fetch: async (id) => {
      if (!fetchedUsers.has(id)) throw new Error('Unknown user');
      return fetchedUsers.get(id);
    } } },
    channel: { send: async (payload) => { calls.sends.push(payload); return payload; } },
    react: async (emoji) => { calls.reactions.push(emoji); },
    reply: async (payload) => { calls.replies.push(payload); return payload; },
  };
  return { message, calls };
}

function memoryFeature(options = {}) {
  const db = openDatabase({ databasePath: ':memory:' });
  const feature = createCountingFeature({
    db,
    getChannelId: options.getChannelId || (() => CHANNEL_ID),
    onError: options.onError,
  });
  return { db, feature };
}

test('a new sequence begins at 1 and correct messages advance, award, and react', async () => {
  const { db, feature } = memoryFeature();
  assert.equal(feature.service.nextExpected(GUILD_ID), '1');

  const first = fakeMessage('1');
  assert.equal(await feature.handleMessage(first.message), true);
  assert.equal(feature.service.nextExpected(GUILD_ID), '2');
  assert.equal(feature.service.balance(USER_ID), 1n);
  assert.deepEqual(first.calls.reactions, [COUNT_SUCCESS_EMOJI]);
  assert.deepEqual(first.calls.sends, []);

  const second = fakeMessage('2', { author: user(OTHER_USER_ID, 'Other') });
  await feature.handleMessage(second.message);
  assert.equal(feature.service.nextExpected(GUILD_ID), '3');
  assert.equal(feature.service.balance(USER_ID), 1n);
  assert.equal(feature.service.balance(OTHER_USER_ID), 2n);
  assert.deepEqual(second.calls.reactions, [COUNT_SUCCESS_EMOJI]);
  db.close();
});

test('duplicate, skipped, lower, malformed, and repeated attempts reset without rewards', async () => {
  for (const attempted of ['1', '2', '3', '0', 'nope', '1']) {
    const { db, feature } = memoryFeature();
    const first = fakeMessage('1');
    await feature.handleMessage(first.message);
    const priorBalance = feature.service.balance(USER_ID);
    const broken = fakeMessage(attempted, { author: user(OTHER_USER_ID, 'Other') });
    await feature.handleMessage(broken.message);

    if (attempted === '2') {
      const repeated = fakeMessage('2');
      await feature.handleMessage(repeated.message);
      assert.equal(feature.service.nextExpected(GUILD_ID), '1');
      assert.equal(feature.service.balance(USER_ID), 1n);
      assert.equal(feature.service.balance(OTHER_USER_ID), 2n);
      assert.deepEqual(repeated.calls.reactions, [COUNT_FAILURE_EMOJI]);
      assert.equal(repeated.calls.sends.length, 1);
    } else {
      assert.equal(feature.service.nextExpected(GUILD_ID), '1');
      assert.equal(feature.service.balance(USER_ID), priorBalance);
      assert.deepEqual(broken.calls.reactions, [COUNT_FAILURE_EMOJI]);
      assert.deepEqual(broken.calls.sends, [{
        content: `The count was broken by <@${OTHER_USER_ID}>. Start again at **1**.`,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      }]);
    }
    db.close();
  }
});

test('the same user cannot count twice in a row', async () => {
  const { db, feature } = memoryFeature();
  await feature.handleMessage(fakeMessage('1').message);

  const repeated = fakeMessage('2');
  await feature.handleMessage(repeated.message);

  assert.equal(feature.service.nextExpected(GUILD_ID), '1');
  assert.equal(feature.service.balance(USER_ID), 1n);
  assert.deepEqual(repeated.calls.reactions, [COUNT_FAILURE_EMOJI]);
  assert.deepEqual(repeated.calls.sends, [{
    content: `<@${USER_ID}> counted twice in a row. Wait for someone else to take a turn. Start again at **1**.`,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  }]);

  const restarted = fakeMessage('1');
  await feature.handleMessage(restarted.message);
  assert.equal(feature.service.nextExpected(GUILD_ID), '2');
  db.close();
});

test('other channels, bots, webhooks, system messages, and DMs are ignored', async () => {
  const { db, feature } = memoryFeature();
  const cases = [
    fakeMessage('1', { channelId: OTHER_CHANNEL_ID }),
    fakeMessage('1', { bot: true }),
    fakeMessage('1', { webhook: true }),
    fakeMessage('1', { system: true }),
    fakeMessage('1', { dm: true }),
  ];
  for (const entry of cases) assert.equal(await feature.handleMessage(entry.message), false);
  assert.equal(feature.service.nextExpected(GUILD_ID), '1');
  assert.equal(feature.service.balance(USER_ID), 0n);
  db.close();
});

test('csbalance is a complete, case-insensitive command and never breaks Counting', async () => {
  assert.deepEqual(parseBalanceCommand('CSBALANCE'), { argument: '' });
  assert.deepEqual(parseBalanceCommand(`csbalance <@${USER_ID}>`), { argument: `<@${USER_ID}>` });
  assert.equal(parseBalanceCommand('csbalanceplus'), null);

  const { db, feature } = memoryFeature();
  const command = fakeMessage('csbalance');
  assert.equal(await feature.handleMessage(command.message), true);
  assert.equal(feature.service.nextExpected(GUILD_ID), '1');
  assert.deepEqual(command.calls.reactions, []);
  assert.equal(command.calls.replies.length, 1);
  db.close();
});

test('state and balances persist after reopening the Counting database', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-counting-'));
  const databasePath = path.join(directory, 'counting.sqlite');
  try {
    const first = createCountingFeature({ databasePath, getChannelId: () => CHANNEL_ID });
    await first.handleMessage(fakeMessage('1').message);
    await first.handleMessage(fakeMessage('2', { author: user(OTHER_USER_ID, 'Other') }).message);
    first.close();

    const reopened = createCountingFeature({ databasePath, getChannelId: () => CHANNEL_ID });
    assert.equal(reopened.service.nextExpected(GUILD_ID), '3');
    assert.equal(reopened.service.balance(USER_ID), 1n);
    assert.equal(reopened.service.balance(OTHER_USER_ID), 2n);
    reopened.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('duplicate deliveries and near-simultaneous messages are transactionally safe', async () => {
  const { db, feature } = memoryFeature();
  const duplicate = fakeMessage('1', { id: '723456789012345678' });
  await Promise.all([
    feature.handleMessage(duplicate.message),
    feature.handleMessage(duplicate.message),
  ]);
  assert.equal(feature.service.balance(USER_ID), 1n);
  assert.equal(feature.service.nextExpected(GUILD_ID), '2');
  assert.equal(duplicate.calls.reactions.length, 1);

  const one = fakeMessage('2', { author: user(OTHER_USER_ID, 'Other') });
  const two = fakeMessage('3');
  await Promise.all([feature.handleMessage(one.message), feature.handleMessage(two.message)]);
  assert.equal(feature.service.balance(USER_ID), 4n);
  assert.equal(feature.service.balance(OTHER_USER_ID), 2n);
  assert.equal(feature.service.nextExpected(GUILD_ID), '4');
  db.close();
});

test('Bronze rewards cap at 1,000,000 while arbitrary-precision counts keep advancing', async () => {
  const { db, feature } = memoryFeature();
  const now = BigInt(Date.now());
  db.prepare('INSERT INTO counting_guild_state (guild_id, next_expected, updated_at) VALUES (?, ?, ?)')
    .run(GUILD_ID, '1000000', now);
  db.prepare('INSERT INTO counting_bronze_balances (user_id, balance, updated_at) VALUES (?, ?, ?)')
    .run(USER_ID, 999999n, now);

  await feature.handleMessage(fakeMessage('1000000').message);
  assert.equal(feature.service.balance(USER_ID), 1_000_000n);
  assert.equal(feature.service.nextExpected(GUILD_ID), '1000001');
  await feature.handleMessage(fakeMessage('1000001', { author: user(OTHER_USER_ID, 'Other') }).message);
  assert.equal(feature.service.balance(USER_ID), 1_000_000n);
  assert.equal(feature.service.nextExpected(GUILD_ID), '1000002');

  db.prepare('UPDATE counting_guild_state SET next_expected = ? WHERE guild_id = ?')
    .run('9007199254740993', GUILD_ID);
  await feature.handleMessage(fakeMessage('9007199254740993').message);
  assert.equal(feature.service.nextExpected(GUILD_ID), '9007199254740994');
  assert.equal(feature.service.balance(USER_ID), 1_000_000n);
  db.close();
});

test('slash and text balance commands share global balance data and resolve all targets', async () => {
  const { db, feature } = memoryFeature();
  await feature.handleMessage(fakeMessage('1').message);

  const other = user('823456789012345678', 'Other');
  const slashReplies = [];
  const slash = {
    commandName: 'cs-balance',
    isChatInputCommand: () => true,
    user: user(),
    options: { getUser: () => null },
    reply: async (payload) => slashReplies.push(payload),
  };
  assert.equal(await feature.handleInteraction(slash), true);
  assert.match(slashReplies[0].components[0].components[0].components[0].content, /- 1 <:CSBC:/);

  slash.options.getUser = () => other;
  await feature.handleInteraction(slash);
  assert.match(slashReplies[1].components[0].components[0].components[0].content, new RegExp(`<@${other.id}>'s Balance`));

  const mention = fakeMessage(`csbalance <@${other.id}>`, { mentions: new Map([[other.id, other]]) });
  await feature.handleMessage(mention.message);
  assert.match(mention.calls.replies[0].components[0].components[0].components[0].content, new RegExp(`<@${other.id}>`));

  const raw = fakeMessage(`csbalance ${other.id}`, { fetchedUsers: new Map([[other.id, other]]), channelId: OTHER_CHANNEL_ID });
  await feature.handleMessage(raw.message);
  assert.match(raw.calls.replies[0].components[0].components[0].components[0].content, new RegExp(`<@${other.id}>`));

  const invalid = fakeMessage('csbalance nobody', { channelId: OTHER_CHANNEL_ID });
  await feature.handleMessage(invalid.message);
  assert.match(invalid.calls.replies[0].components[0].components[0].content, /User not found/);
  db.close();
});

test('balance response is a white Components V2 container with thumbnail, text, and Bronze emoji', () => {
  const target = user();
  const payload = balancePayload(target, 13_500n);
  const container = payload.components[0];
  const section = container.components[0];
  assert.equal(container.type, 17);
  assert.equal(container.accent_color, 0xFFFFFF);
  assert.equal(section.type, 9);
  assert.equal(section.accessory.type, 11);
  assert.equal(section.accessory.media.url, `https://cdn.example/${USER_ID}.png`);
  assert.equal(section.components[0].content, `### <@${USER_ID}>'s Balance\n\n- 13.5k ${BRONZE_COIN_EMOJI}`);
  assert.deepEqual(payload.allowedMentions, SAFE_ALLOWED_MENTIONS);
});

test('Bronze balance formatter abbreviates without floating point', () => {
  const examples = new Map([
    [0n, '0'], [999n, '999'], [1_000n, '1k'], [13_500n, '13.5k'],
    [100_000n, '100k'], [999_999n, '999.9k'], [1_000_000n, '1m'], [9_000_000n, '1m'],
  ]);
  for (const [value, expected] of examples) assert.equal(formatBronzeBalance(value), expected);
});

test('game commands are registered for every enabled guild even when no Counting channel is set', () => {
  const commands = featureCommandsForConfig({
    enabled: true,
    features: { leveling: false },
    counting: { channelId: '' },
  });
  assert.deepEqual(commands.map((command) => command.name), ['cs-balance', 'cs-work']);
});

test('configuration migration preserves existing settings and normalizes Counting', () => {
  const normalized = normalizeState({
    meta: { schemaVersion: SCHEMA_VERSION - 1, disabledGuilds: {} },
    guilds: {
      [GUILD_ID]: {
        enabled: true,
        memberMessages: { enabled: false },
        counting: { channelId: CHANNEL_ID },
      },
    },
  });
  assert.equal(normalized.meta.schemaVersion, SCHEMA_VERSION);
  assert.equal(normalized.guilds[GUILD_ID].memberMessages.enabled, false);
  assert.deepEqual(normalized.guilds[GUILD_ID].counting, { channelId: CHANNEL_ID });
  assert.deepEqual(normalizeState({ guilds: { [GUILD_ID]: {} } }).guilds[GUILD_ID].counting, { channelId: '' });
  assert.deepEqual(normalizeState({ guilds: { [GUILD_ID]: { counting: { channelId: 'bad' } } } }).guilds[GUILD_ID].counting, { channelId: '' });
});

test('dashboard exposes Games/Counting and PATCH channel validation is guild isolated', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'admin', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'adminServer.js'), 'utf8');
  assert.match(html, /data-view="games"[^>]*>[\s\S]*?<strong>Games<\/strong>/);
  assert.match(html, /class="games-tabs"[\s\S]*?>Counting<\/button>/);
  assert.equal((html.match(/id="countingChannel"/g) || []).length, 1);
  assert.match(script, /body = \{ memberMessages, counting, games \}/);
  assert.match(server, /requireGuildAdmin\(req, res, env, client, guildId\)/);
  assert.match(server, /requireCsrf\(req, res, auth\.session\)/);

  const channel = {
    id: CHANNEL_ID,
    guildId: GUILD_ID,
    type: ChannelType.GuildText,
    isTextBased: () => true,
  };
  const guild = { id: GUILD_ID, channels: { fetch: async () => channel } };
  assert.equal(await validateCountingChannel(guild, CHANNEL_ID), CHANNEL_ID);
  assert.equal(await validateCountingChannel(guild, ''), '');
  await assert.rejects(
    () => validateCountingChannel({ ...guild, channels: { fetch: async () => ({ ...channel, guildId: OTHER_CHANNEL_ID }) } }, CHANNEL_ID),
    /in this server/,
  );
  await assert.rejects(
    () => validateCountingChannel({ ...guild, channels: { fetch: async () => ({ ...channel, type: ChannelType.GuildVoice, isTextBased: () => false }) } }, CHANNEL_ID),
    /message-capable/,
  );
});

test('repository operation results remain explicit and never require JSON serialization of BigInt state', () => {
  const db = openDatabase({ databasePath: ':memory:' });
  const repository = new CountingRepository(db, { clock: () => 1 });
  const result = repository.processAttempt({
    messageId: '923456789012345678', guildId: GUILD_ID, channelId: CHANNEL_ID, userId: USER_ID, submittedValue: '1',
  });
  assert.equal(result.status, 'correct');
  assert.equal(result.nextExpected, '2');
  assert.equal(repository.nextExpected(GUILD_ID), '2');
  db.close();
});

