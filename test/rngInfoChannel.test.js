const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-info-'));
const configPath = path.join(temporary, 'server-config.json');
const sessionPath = path.join(temporary, 'sessions.json');
process.env.SERVER_CONFIG_STORE_PATH = configPath;
process.env.ADMIN_SESSION_STORE_PATH = sessionPath;

const GUILD_ID = '123456789012345678';
const ADMIN_ID = '223456789012345678';
const BOT_ID = '323456789012345678';
const CHANNEL_ID = '423456789012345678';
const SECOND_CHANNEL_ID = '423456789012345679';
const MESSAGE_ID = '523456789012345678';
const CSRF = 'info-channel-csrf';
const SESSION_SECRET = 'info-channel-session-secret';
const RAW_SESSION_ID = 'info-channel-session';
const SIGNATURE = crypto.createHmac('sha256', SESSION_SECRET).update(RAW_SESSION_ID).digest('base64url');
const SESSION_ID = `${RAW_SESSION_ID}.${SIGNATURE}`;

fs.writeFileSync(sessionPath, JSON.stringify({
  sessions: {
    [SESSION_ID]: {
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1_000,
      csrfToken: CSRF,
      oauthState: null,
      user: { id: ADMIN_ID, username: 'admin', globalName: 'Admin', avatar: null },
    },
  },
}));
fs.writeFileSync(configPath, JSON.stringify({
  meta: { schemaVersion: 13, disabledGuilds: {} },
  guilds: {
    [GUILD_ID]: {
      enabled: true,
      features: { gag2Stock: true, leveling: false, rngGame: true },
      rngGame: { enabled: true, gameChannelIds: [CHANNEL_ID], cooldownBypassRoleIds: [] },
    },
  },
}));

const {
  DEFAULT_RNG_GAME_CONFIG,
  SCHEMA_VERSION,
  getGuildConfigRaw,
  normalizeRngGameConfig,
  normalizeState,
  setGuildFeatureAccess,
} = require('../src/serverConfig');
const {
  createAdminRequestHandler,
  infoChannelPermissionStatus,
} = require('../src/adminServer');
const {
  INFO_MESSAGE_VERSION,
  INFO_SELECT_CUSTOM_ID,
  INFO_TOPICS,
  prefixCommands,
  publicSeeds,
  slashCommands,
  topicPages,
} = require('../src/features/rng-game/info/catalog');
const { infoMessagePayload, topicPayload } = require('../src/features/rng-game/info/builders');
const { createInfoHandler } = require('../src/features/rng-game/info/handler');
const { InfoPublishError, InfoPublisher, restPayload } = require('../src/features/rng-game/info/publisher');
const { RNG_GAME_COMMANDS, PREFIX_COMMANDS } = require('../src/features/rng-game/commands');
const { WORK_COMMANDS } = require('../src/features/work/commands');
const { SEEDS } = require('../src/features/rng-game/data/seeds');
const {
  MAX_BIG_CROP_TIER,
  MAX_LUCK_TIER,
} = require('../src/features/rng-game/config/upgrades');
const { AUTO_ROLL_INTERVAL_MS, MAX_AUTO_ROLL_MINUTES } = require('../src/features/rng-game/utils/autoRoll');
const { EXCHANGE_WINDOW_LIMIT } = require('../src/features/rng-game/repositories/tokenRepository');
const { MIN_BET, MAX_BET } = require('../src/features/rng-game/services/rpsRules');
const { WORK_GAMES } = require('../src/features/work/data');
const { WORK_RANKS, boostedReward } = require('../src/features/work/ranks');
const {
  WORK_STREAK_FAILURE_LIMIT,
  WORK_STREAK_MAX,
  WORK_STREAK_TIMEOUT_MS,
} = require('../src/features/work/repositories/workRepository');

function allComponentNodes(payload) {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const child of node.components || []) visit(child);
  };
  for (const component of payload.components || []) visit(component);
  return nodes;
}

function message(id, authorId = BOT_ID) {
  return { id, author: { id: authorId } };
}

test('RNG configuration normalizes the backward-compatible Info Channel record', () => {
  assert.equal(SCHEMA_VERSION, 13);
  assert.deepEqual(DEFAULT_RNG_GAME_CONFIG.info, {
    channelId: '', messageChannelId: '', messageId: '', publishedAt: '', messageVersion: 1,
  });
  const legacy = normalizeRngGameConfig({ enabled: true, gameChannelId: CHANNEL_ID });
  assert.deepEqual(legacy.info, DEFAULT_RNG_GAME_CONFIG.info);
  const normalized = normalizeRngGameConfig({
    info: {
      channelId: CHANNEL_ID,
      messageChannelId: 'invalid',
      messageId: MESSAGE_ID,
      publishedAt: 'not-a-date',
      messageVersion: 9999,
    },
  });
  assert.deepEqual(normalized.info, {
    channelId: CHANNEL_ID,
    messageChannelId: '',
    messageId: MESSAGE_ID,
    publishedAt: '',
    messageVersion: 1_000,
  });
  const migrated = normalizeState({
    meta: { schemaVersion: 12 },
    guilds: { [GUILD_ID]: { features: { rngGame: true }, rngGame: { enabled: true } } },
  });
  assert.equal(migrated.meta.schemaVersion, 13);
  assert.deepEqual(migrated.guilds[GUILD_ID].rngGame.info, DEFAULT_RNG_GAME_CONFIG.info);
});

test('initial information message is a safe white Components V2 topic menu', () => {
  const payload = infoMessagePayload(BOT_ID);
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.embeds.length, 0);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
  assert.equal(payload.components.length, 1);
  const container = payload.components[0];
  assert.equal(container.type, 17);
  assert.equal(container.accent_color, 0xFFFFFF);
  assert.match(container.components[0].content, new RegExp(`<@${BOT_ID}>'s Information`));
  assert.match(container.components[0].content, /Everything you need to start, progress, and master/);
  assert.equal(container.components[1].type, 14);
  const select = container.components[2].components[0];
  assert.equal(select.custom_id, INFO_SELECT_CUSTOM_ID);
  assert.equal(select.placeholder, 'Choose an information topic');
  assert.equal(select.options.length, 16);
  assert.ok(select.options.length <= 25);
  for (const option of select.options) {
    assert.ok(option.label.length <= 100);
    assert.ok(option.description.length <= 100);
    assert.ok(option.value.length <= 100);
  }
});

test('every topic and stateless page fits Discord limits and responds ephemerally', () => {
  for (const topic of INFO_TOPICS) {
    const result = topicPages(topic.id, { discoveries: [] });
    assert.ok(result.pages.length >= 1, topic.id);
    for (let page = 1; page <= result.pages.length; page += 1) {
      const payload = topicPayload(topic.id, page, { discoveries: [] });
      assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
      assert.equal(payload.embeds.length, 0);
      for (const node of allComponentNodes(payload)) {
        if (node.content) assert.ok(node.content.length <= 4_000, `${topic.id} text length`);
        if (node.custom_id) assert.ok(node.custom_id.length <= 100, `${topic.id} custom ID length`);
      }
    }
  }
});

test('information catalog stays synchronized with command and gameplay sources', () => {
  assert.deepEqual(
    slashCommands().map((command) => command.name),
    [...RNG_GAME_COMMANDS, ...WORK_COMMANDS].map((command) => command.data.toJSON().name),
  );
  assert.deepEqual(prefixCommands(), [...PREFIX_COMMANDS].map(([prefix, slash]) => ({ prefix, slash })));
  assert.equal(publicSeeds({ discoveries: [] }).length, SEEDS.filter((seed) => !seed.secretUntilDiscovered).length);
  assert.equal(publicSeeds({ discoveries: [{ seedId: 'eclipse_bloom' }] }).length, SEEDS.length);

  const luck = topicPages('luck').pages.join('\n');
  assert.match(luck, new RegExp(`0–${MAX_LUCK_TIER}`));
  const big = topicPages('big-crops').pages.join('\n');
  assert.match(big, new RegExp(`0–${MAX_BIG_CROP_TIER}`));
  const auto = topicPages('auto-roll').pages.join('\n');
  assert.match(auto, new RegExp(`${AUTO_ROLL_INTERVAL_MS / 1_000}-second`));
  assert.match(auto, new RegExp(`${MAX_AUTO_ROLL_MINUTES / 1_440} day`));
  const tokens = topicPages('tokens').pages.join('\n');
  assert.match(tokens, new RegExp(`1–${EXCHANGE_WINDOW_LIMIT}`));
  const rps = topicPages('rps').pages.join('\n');
  assert.match(rps, new RegExp(`${MIN_BET.toLocaleString('en-US')}–${MAX_BET.toLocaleString('en-US')}`));
  const work = topicPages('work').pages.join('\n');
  assert.match(work, new RegExp(`${WORK_RANKS.length}`));
  assert.match(work, new RegExp(`${WORK_GAMES[0].customers.length}`));
});

test('Work wiki derives streak limits, failure behavior, rank boosts, and rounding', () => {
  const work = topicPages('work').pages.join('\n');
  assert.match(work, new RegExp(`capped at \\*\\*${WORK_STREAK_MAX.toLocaleString()}`));
  assert.match(work, new RegExp(`failure ${WORK_STREAK_FAILURE_LIMIT}`));
  assert.match(work, new RegExp(`${WORK_STREAK_TIMEOUT_MS / 3_600_000} hours`));
  assert.match(work, new RegExp(`\\+${WORK_RANKS.at(-1).salaryBoost}% rank salary`));
  assert.match(work, new RegExp(`becomes \\*\\*${boostedReward(1, 50)}`));
  assert.match(work, /Successful shifts do not clear accumulated failures/);
  assert.match(work, /Work Stat shows rank progress, rank salary boost, current streak/);
});

test('secret crop facts are private until the interacting player discovers them', () => {
  const hidden = topicPages('crops', { discoveries: [] }).pages.join('\n');
  assert.doesNotMatch(hidden, /Eclipse Bloom|eclipse_bloom|Secret •/);
  const revealed = topicPages('crops', { discoveries: [{ seedId: 'eclipse_bloom' }] }).pages.join('\n');
  assert.match(revealed, /Eclipse Bloom/);
  assert.match(revealed, /Secret/);
});

test('topic interaction supports every player, stateless pagination, and safe stale errors', async () => {
  const replies = [];
  const updates = [];
  const handler = createInfoHandler({
    getGuildPolicy: () => ({ unlocked: true, enabled: true }),
    repository: { discoveries: (userId) => userId === ADMIN_ID ? [{ seedId: 'eclipse_bloom' }] : [] },
  });
  const select = {
    customId: INFO_SELECT_CUSTOM_ID,
    guildId: GUILD_ID,
    user: { id: ADMIN_ID },
    values: ['work'],
    isStringSelectMenu: () => true,
    reply: async (payload) => replies.push(payload),
  };
  assert.equal(await handler(select), true);
  assert.equal(replies[0].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const work = topicPages('work');
  if (work.pages.length > 1) {
    const button = {
      customId: `rng:info:page:v${INFO_MESSAGE_VERSION}:work:2`,
      guildId: GUILD_ID,
      user: { id: '999999999999999999' },
      isButton: () => true,
      update: async (payload) => updates.push(payload),
    };
    assert.equal(await handler(button), true);
    assert.equal(updates[0].flags, undefined);
  }
  for (const customId of ['rng:info:broken', 'rng:info:page:v999:work:1']) {
    const staleReplies = [];
    await handler({
      customId, guildId: GUILD_ID, user: { id: ADMIN_ID }, isButton: () => true,
      reply: async (payload) => staleReplies.push(payload),
    });
    assert.equal(staleReplies[0].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  }
  for (const policy of [{ unlocked: false, enabled: true }, { unlocked: true, enabled: false }]) {
    const denied = createInfoHandler({ getGuildPolicy: () => policy });
    const deniedReplies = [];
    await denied({
      customId: INFO_SELECT_CUSTOM_ID, guildId: GUILD_ID, user: { id: ADMIN_ID }, values: ['work'],
      isStringSelectMenu: () => true, reply: async (payload) => deniedReplies.push(payload),
    });
    assert.match(deniedReplies[0].components[0].components[0].content, /locked|disabled/i);
  }
});

test('publisher creates, edits, reposts, changes channels, and refuses foreign messages', async () => {
  const sent = [];
  const fetched = [];
  const edits = [];
  const channels = new Map();
  const firstChannel = {
    id: CHANNEL_ID,
    messages: { fetch: async (id) => { fetched.push(id); const item = message(id); item.edit = async (payload) => { edits.push(payload); return item; }; return item; } },
    send: async (payload) => { sent.push([CHANNEL_ID, payload]); return message(MESSAGE_ID); },
  };
  const secondChannel = {
    id: SECOND_CHANNEL_ID,
    messages: { fetch: async () => { throw new Error('old channel should not be fetched'); } },
    send: async (payload) => { sent.push([SECOND_CHANNEL_ID, payload]); return message('523456789012345679'); },
  };
  channels.set(CHANNEL_ID, firstChannel);
  channels.set(SECOND_CHANNEL_ID, secondChannel);
  const publisher = new InfoPublisher({ client: { user: { id: BOT_ID }, channels: { cache: channels } } });

  assert.equal((await publisher.publish(CHANNEL_ID)).action, 'published');
  assert.equal((await publisher.publish(CHANNEL_ID, { messageChannelId: CHANNEL_ID, messageId: MESSAGE_ID })).action, 'updated');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].flags, undefined, 'editing an existing V2 message does not resend initial-only flags');
  assert.equal((await publisher.publish(SECOND_CHANNEL_ID, { messageChannelId: CHANNEL_ID, messageId: MESSAGE_ID })).action, 'reposted');
  assert.equal(fetched.length, 1, 'changing channel does not fetch, edit, or delete the old message');

  firstChannel.messages.fetch = async (id) => { const item = message(id, '999999999999999999'); return item; };
  await assert.rejects(
    publisher.publish(CHANNEL_ID, { messageChannelId: CHANNEL_ID, messageId: MESSAGE_ID }),
    (error) => error instanceof InfoPublishError && error.statusCode === 409,
  );

  firstChannel.messages.fetch = async () => { const error = new Error('deleted'); error.code = 10008; throw error; };
  assert.equal((await publisher.publish(CHANNEL_ID, { messageChannelId: CHANNEL_ID, messageId: MESSAGE_ID })).action, 'reposted');
  assert.ok(sent.length >= 3);
});

test('panel-safe Discord REST publisher uses bot auth and reports failures without secrets', async () => {
  const calls = [];
  const publisher = new InfoPublisher({
    client: { user: { id: BOT_ID } },
    token: 'super-secret-token',
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: false, status: 500, json: async () => ({ token: 'must-not-surface' }) };
    },
  });
  await assert.rejects(publisher.publish(CHANNEL_ID), (error) => {
    assert.doesNotMatch(error.message, /super-secret-token|must-not-surface/);
    return /500/.test(error.message);
  });
  assert.equal(calls[0].options.headers.Authorization, 'Bot super-secret-token');
  const raw = restPayload(infoMessagePayload(BOT_ID));
  assert.equal(raw.allowedMentions, undefined);
  assert.deepEqual(raw.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
});

test('channel permission checks require all three publication permissions', () => {
  const member = {};
  const all = new Set([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ]);
  const channel = { type: ChannelType.GuildText, permissionsFor: () => ({ has: (flag) => all.has(flag) }) };
  assert.deepEqual(infoChannelPermissionStatus(channel, member), { usable: true, missing: [] });
  all.delete(PermissionFlagsBits.ReadMessageHistory);
  assert.deepEqual(infoChannelPermissionStatus(channel, member), { usable: false, missing: ['Read Message History'] });
  channel.type = ChannelType.GuildForum;
  assert.equal(infoChannelPermissionStatus(channel, member).usable, false);
});

function mockGuild() {
  const permissions = new Set([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ]);
  const botMember = { id: BOT_ID };
  const makeChannel = (id, type = ChannelType.GuildText, guildId = GUILD_ID) => ({
    id, type, guildId, name: `channel-${id.slice(-2)}`, archived: false, rawPosition: 1,
    permissionsFor: () => ({ has: (flag) => permissions.has(flag) }),
  });
  const channels = new Map([
    [CHANNEL_ID, makeChannel(CHANNEL_ID)],
    [SECOND_CHANNEL_ID, makeChannel(SECOND_CHANNEL_ID, ChannelType.GuildAnnouncement)],
    ['623456789012345678', makeChannel('623456789012345678', ChannelType.GuildForum)],
    ['723456789012345678', makeChannel('723456789012345678', ChannelType.GuildText, '999999999999999999')],
  ]);
  const guild = {
    id: GUILD_ID,
    name: 'Info Guild',
    members: {
      me: botMember,
      fetchMe: async () => botMember,
      fetch: async (id) => id === ADMIN_ID
        ? { permissions: { has: (flag) => flag === PermissionFlagsBits.Administrator } } : null,
    },
    channels: {
      cache: channels,
      fetch: async (id) => channels.get(id) || null,
      fetchActiveThreads: async () => ({ threads: new Map() }),
    },
    roles: { cache: new Map(), fetch: async () => new Map() },
  };
  return { guild, channels, permissions };
}

async function startAdminApi(infoPublisher, guild) {
  const client = {
    user: { id: BOT_ID, displayAvatarURL: () => null },
    application: { owner: null },
    guilds: { cache: new Map([[GUILD_ID, guild]]), fetch: async (id) => id === GUILD_ID ? guild : null },
  };
  const env = {
    clientId: 'client', clientSecret: 'secret', redirectUri: 'http://localhost/callback',
    sessionSecret: SESSION_SECRET, cookieSecure: false, publicOrigin: '', botToken: 'token',
  };
  const server = http.createServer(createAdminRequestHandler(env, client, { infoPublisher, clock: () => 1_700_000_000_000 }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('publishing API enforces admin auth, CSRF, owner lock, guild channels, types, and permissions', async (t) => {
  const { guild, permissions } = mockGuild();
  const calls = [];
  const infoPublisher = {
    inspect: async () => ({ state: 'not-published', canEdit: false, warning: '' }),
    publish: async (channelId, reference) => {
      calls.push({ channelId, reference });
      return { action: reference.messageId ? 'updated' : 'published', message: message(MESSAGE_ID), messageVersion: 1 };
    },
  };
  const { server, origin } = await startAdminApi(infoPublisher, guild);
  t.after(() => server.close());
  const cookie = { Cookie: `coinsprite_admin=${encodeURIComponent(SESSION_ID)}` };
  const headers = { ...cookie, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' };
  const endpoint = `${origin}/api/guilds/${GUILD_ID}/rng-game/info/publish`;

  assert.equal((await fetch(endpoint, { method: 'POST', body: JSON.stringify({ channelId: CHANNEL_ID }) })).status, 401);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: CHANNEL_ID }) })).status, 403);

  setGuildFeatureAccess(GUILD_ID, { rngGame: false });
  const locked = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ channelId: CHANNEL_ID }) });
  assert.equal(locked.status, 403);
  assert.match((await locked.json()).error, /locked/i);
  setGuildFeatureAccess(GUILD_ID, { rngGame: true });

  for (const channelId of ['623456789012345678', '723456789012345678']) {
    const rejected = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ channelId }) });
    assert.equal(rejected.status, 400);
  }

  permissions.delete(PermissionFlagsBits.ViewChannel);
  let rejected = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ channelId: CHANNEL_ID }) });
  assert.equal(rejected.status, 403);
  assert.match((await rejected.json()).error, /View Channel/);
  permissions.add(PermissionFlagsBits.ViewChannel);
  permissions.delete(PermissionFlagsBits.SendMessages);
  rejected = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ channelId: CHANNEL_ID }) });
  assert.match((await rejected.json()).error, /Send Messages/);
  permissions.add(PermissionFlagsBits.SendMessages);
  permissions.delete(PermissionFlagsBits.ReadMessageHistory);
  rejected = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ channelId: CHANNEL_ID }) });
  assert.match((await rejected.json()).error, /Read Message History/);
  permissions.add(PermissionFlagsBits.ReadMessageHistory);

  const published = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ channelId: CHANNEL_ID }) });
  assert.equal(published.status, 200);
  const payload = await published.json();
  assert.equal(payload.publication.messageId, MESSAGE_ID);
  assert.equal(payload.publication.messageLink, `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`);
  assert.equal(calls.length, 1);
  assert.deepEqual(getGuildConfigRaw(GUILD_ID).rngGame.info, {
    channelId: CHANNEL_ID,
    messageChannelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    publishedAt: '2023-11-14T22:13:20.000Z',
    messageVersion: 1,
  });

  const patched = await fetch(`${origin}/api/guilds/${GUILD_ID}/config`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ rngGame: { info: { channelId: SECOND_CHANNEL_ID, messageId: '999999999999999999' } } }),
  });
  assert.equal(patched.status, 200);
  assert.deepEqual(getGuildConfigRaw(GUILD_ID).rngGame.info, {
    channelId: SECOND_CHANNEL_ID,
    messageChannelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    publishedAt: '2023-11-14T22:13:20.000Z',
    messageVersion: 1,
  }, 'dashboard PATCH may select a new channel but cannot replace the server-owned message reference');

  setGuildFeatureAccess(GUILD_ID, { rngGame: false });
  assert.equal(getGuildConfigRaw(GUILD_ID).rngGame.info.messageId, MESSAGE_ID, 'owner locking preserves publication state');
  setGuildFeatureAccess(GUILD_ID, { rngGame: true });

  const status = await fetch(`${origin}/api/guilds/${GUILD_ID}/rng-game/info`, { headers: cookie });
  assert.equal(status.status, 200);
});

test('dashboard includes locked navigation, usable-channel filtering, preview, status, and actions', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'admin', 'style.css'), 'utf8');
  assert.match(html, /data-view="info-channel"/);
  assert.ok(html.indexOf('data-view="info-channel"') > html.indexOf('data-view="rng-game"'));
  assert.match(html, /Interactive game wiki|Locked by owner/);
  assert.match(html, /id="infoChannelSelect"/);
  assert.match(html, /Choose an information topic/);
  assert.match(html, /id="infoPublicationState"/);
  assert.match(html, /id="infoMessageLink"/);
  assert.match(html, /id="infoPublishButton"/);
  assert.match(source, /channel\.infoUsable === true/);
  assert.match(source, /Update information/);
  assert.match(source, /Repost information/);
  assert.match(source, /rng-game\/info\/publish/);
  assert.match(css, /\.info-publication-grid/);
  assert.match(css, /@media \(max-width: 620px\)/);
});

test.after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
});
