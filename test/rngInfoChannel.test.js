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
  INFO_COMMAND_PAGE_SIZE,
  INFO_MESSAGE_VERSION,
  INFO_SELECT_CUSTOM_ID,
  commandByKey,
  commandCatalog,
  paginateCommands,
  prefixCommands,
  slashCommands,
} = require('../src/features/rng-game/info/catalog');
const {
  commandPayload,
  infoMessagePayload,
  selectCustomId,
} = require('../src/features/rng-game/info/builders');
const { createInfoHandler } = require('../src/features/rng-game/info/handler');
const {
  commandMention,
  resolveRegisteredCommandIds,
} = require('../src/features/rng-game/info/mentions');
const { InfoPublishError, InfoPublisher, restPayload } = require('../src/features/rng-game/info/publisher');
const { resolveEmoji } = require('../src/features/shared/emojis');
const { RNG_GAME_COMMANDS, PREFIX_COMMANDS } = require('../src/features/rng-game/commands');
const { WORK_COMMANDS } = require('../src/features/work/commands');

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
    channelId: '', messageChannelId: '', messageId: '', publishedAt: '', messageVersion: 2,
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

function commandIdsFor(commands = commandCatalog()) {
  return new Map(commands.map((command) => [command.root, '723456789012345678']));
}

function payloadText(payload) {
  return allComponentNodes(payload).filter((node) => node.content).map((node) => node.content).join('\n');
}

test('landing page lists every registered command with real choices and safe clickable mentions', () => {
  const commands = commandCatalog();
  const commandIds = commandIdsFor(commands);
  const payload = infoMessagePayload(BOT_ID, { commands, commandIds });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.embeds.length, 0);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
  assert.equal(payload.components.length, 1);
  const container = payload.components[0];
  assert.equal(container.type, 17);
  assert.equal(container.accent_color, 0xFFFFFF);
  assert.match(container.components[0].content, /^# 🎲 RNG Game Commands/m);
  assert.match(container.components[0].content, /## Quick Start/);
  assert.match(container.components[0].content, /## Browse Commands/);
  for (const command of commands) {
    assert.match(container.components[0].content, new RegExp(`</${command.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:723456789012345678>`));
  }
  const select = allComponentNodes(payload).find((node) => node.type === 3);
  assert.equal(select.custom_id, INFO_SELECT_CUSTOM_ID);
  assert.equal(select.placeholder, 'Choose a command');
  assert.deepEqual(select.options.map((option) => option.value), commands.map((command) => command.key));
  assert.ok(select.options.every((option) => option.label.startsWith('/')));
});

test('command mention resolver supports parents, subcommands, guild IDs, and safe fallback', async () => {
  const ids = new Map([['roll', '723456789012345678']]);
  assert.equal(commandMention('roll', ids), '</roll:723456789012345678>');
  assert.equal(commandMention('roll boosted', ids), '</roll boosted:723456789012345678>');
  assert.equal(commandMention('roll group boosted', ids), '</roll group boosted:723456789012345678>');
  assert.equal(commandMention('inventory', ids), '`/inventory`');
  assert.equal(commandMention('inventory', { inventory: 'not-an-id' }), '`/inventory`');

  const client = {
    application: { commands: { fetch: async () => new Map([['global', { name: 'roll', id: '723456789012345677' }]]) } },
    guilds: {
      cache: new Map([[GUILD_ID, {
        commands: { fetch: async () => new Map([['guild', { name: 'roll', id: '723456789012345678' }]]) },
      }]]),
    },
  };
  assert.equal((await resolveRegisteredCommandIds(client, GUILD_ID)).get('roll'), '723456789012345678');
});

test('catalog derives selectable commands and prefixes from the live registries', () => {
  const commands = commandCatalog();
  assert.deepEqual(
    slashCommands().map((command) => command.name),
    [...RNG_GAME_COMMANDS, ...WORK_COMMANDS].map((command) => command.data.toJSON().name),
  );
  assert.deepEqual(prefixCommands(), [...PREFIX_COMMANDS].map(([prefix, slash]) => ({ prefix, slash })));
  assert.deepEqual(commands.map((command) => command.root), slashCommands().map((command) => command.name));
  assert.ok(commandByKey('roll', commands).prefixes.includes('c!roll'));
  assert.deepEqual(commandByKey('g-rps', commands).prefixes, []);
});

test('emoji resolver handles Unicode, static custom, animated custom, and unavailable fallback', () => {
  const usable = { emojis: { cache: new Map([['723456789012345678', {}]]) } };
  assert.deepEqual(resolveEmoji('🎲', '🎮'), { text: '🎲', component: { name: '🎲' } });
  assert.deepEqual(resolveEmoji('<:roll:723456789012345678>', '🎲', usable), {
    text: '<:roll:723456789012345678>',
    component: { id: '723456789012345678', name: 'roll', animated: false },
  });
  assert.deepEqual(resolveEmoji('<a:roll:723456789012345678>', '🎲', usable), {
    text: '<a:roll:723456789012345678>',
    component: { id: '723456789012345678', name: 'roll', animated: true },
  });
  assert.deepEqual(resolveEmoji('<:missing:823456789012345678>', '🎲', usable), {
    text: '🎲', component: { name: '🎲' },
  });
});

test('roll selection renders a complete detail page and preserves the selected command menu', () => {
  const commands = commandCatalog();
  const payload = commandPayload('roll', {
    commands,
    commandIds: commandIdsFor(commands),
    ownerId: ADMIN_ID,
  }, { ephemeral: true });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const text = payloadText(payload);
  assert.match(text, /^# 🎲 `\/roll`/m);
  assert.match(text, /## How to Use/);
  assert.match(text, /\*\*Slash:\*\* <\/roll:723456789012345678>/);
  assert.match(text, /\*\*Prefix:\*\* `c!roll`/);
  assert.match(text, /## What It Does/);
  assert.match(text, /## Examples/);
  assert.match(text, /## Important/);
  const select = allComponentNodes(payload).find((node) => node.type === 3);
  assert.equal(select.custom_id, selectCustomId(ADMIN_ID, 1));
  assert.equal(select.options.find((option) => option.value === 'roll').default, true);
});

test('prefix usage is shown only for supported commands and slash options come from command definitions', () => {
  const commands = commandCatalog();
  const context = { commands, commandIds: commandIdsFor(commands), ownerId: ADMIN_ID };
  assert.match(payloadText(commandPayload('inventory', context)), /\*\*Prefix:\*\* `c!inventory`/);
  assert.doesNotMatch(payloadText(commandPayload('g-rps', context)), /\*\*Prefix:\*\*/);
  const exchange = payloadText(commandPayload('exchange-token', context));
  assert.match(exchange, /## Options/);
  assert.match(exchange, /`amount-token` \(Integer\)/);
});

test('every selector option maps to a valid detail and all payload strings respect Discord limits', () => {
  const commands = commandCatalog();
  const context = { commands, commandIds: commandIdsFor(commands), ownerId: ADMIN_ID };
  const landing = infoMessagePayload(BOT_ID, context);
  const options = allComponentNodes(landing).find((node) => node.type === 3).options;
  assert.deepEqual(new Set(options.map((option) => option.value)), new Set(commands.map((command) => command.key)));
  for (const option of options) assert.ok(commandByKey(option.value, commands));
  for (const payload of [landing, ...commands.map((command) => commandPayload(command.key, context, { ephemeral: true }))]) {
    for (const node of allComponentNodes(payload)) {
      if (node.content) assert.ok(node.content.length <= 4_000);
      if (node.custom_id) assert.ok(node.custom_id.length <= 100);
      for (const option of node.options || []) {
        assert.ok(option.label.length <= 100);
        assert.ok(option.description.length <= 100);
        assert.ok(option.value.length <= 100);
      }
    }
  }
});

test('more than 25 commands are paginated without hiding commands', () => {
  const definitions = Array.from({ length: 30 }, (_, index) => ({
    name: `command-${String(index).padStart(2, '0')}`,
    description: `Open command ${index}.`,
  }));
  const commands = commandCatalog(definitions);
  const first = infoMessagePayload(BOT_ID, { commands, page: 1 });
  const second = infoMessagePayload(BOT_ID, { commands, page: 2 });
  const firstOptions = allComponentNodes(first).find((node) => node.type === 3).options;
  const secondOptions = allComponentNodes(second).find((node) => node.type === 3).options;
  assert.equal(firstOptions.length, INFO_COMMAND_PAGE_SIZE);
  assert.equal(secondOptions.length, 5);
  assert.deepEqual(
    new Set([...firstOptions, ...secondOptions].map((option) => option.value)),
    new Set(commands.map((command) => command.key)),
  );
  assert.equal(paginateCommands(commands, 99).page, 2);
  assert.ok(allComponentNodes(first).some((node) => node.type === 2 && node.label === 'Next'));
  for (const command of commands) assert.match(payloadText(first), new RegExp(`/${command.path}`));
});

test('command interactions keep private navigation, enforce ownership, and recover from stale selections', async () => {
  const replies = [];
  const updates = [];
  const registered = new Map(commandCatalog().map((command) => [command.root, {
    name: command.root,
    id: '723456789012345678',
  }]));
  const client = {
    user: { id: BOT_ID },
    application: { commands: { fetch: async () => new Map() } },
    guilds: { cache: new Map([[GUILD_ID, { commands: { fetch: async () => registered } }]]) },
  };
  const handler = createInfoHandler({
    getGuildPolicy: () => ({ unlocked: true, enabled: true }),
    getClient: () => client,
  });
  assert.equal(await handler({
    customId: INFO_SELECT_CUSTOM_ID,
    guildId: GUILD_ID,
    client,
    user: { id: ADMIN_ID },
    values: ['roll'],
    isStringSelectMenu: () => true,
    reply: async (payload) => replies.push(payload),
  }), true);
  assert.equal(replies[0].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.match(payloadText(replies[0]), /<\/roll:723456789012345678>/);
  const privateSelect = allComponentNodes(replies[0]).find((node) => node.type === 3);
  assert.equal(privateSelect.custom_id, selectCustomId(ADMIN_ID, 1));

  await handler({
    customId: privateSelect.custom_id,
    guildId: GUILD_ID,
    client,
    user: { id: ADMIN_ID },
    values: ['inventory'],
    isStringSelectMenu: () => true,
    update: async (payload) => updates.push(payload),
  });
  assert.equal(updates[0].flags, undefined);
  assert.match(payloadText(updates[0]), /`\/inventory`/);

  const denied = [];
  await handler({
    customId: privateSelect.custom_id,
    guildId: GUILD_ID,
    client,
    user: { id: '999999999999999999' },
    values: ['roll'],
    isStringSelectMenu: () => true,
    reply: async (payload) => denied.push(payload),
  });
  assert.match(payloadText(denied[0]), /Only the player/i);

  const stale = [];
  for (const request of [
    { customId: INFO_SELECT_CUSTOM_ID, values: ['removed-command'], isStringSelectMenu: () => true },
    { customId: 'rng:info:topic:v1', isButton: () => true },
  ]) {
    await handler({
      ...request,
      guildId: GUILD_ID,
      client,
      user: { id: ADMIN_ID },
      reply: async (payload) => stale.push(payload),
    });
  }
  assert.match(payloadText(stale[0]), /selection is stale/i);
  assert.match(payloadText(stale[1]), /malformed or outdated/i);

  for (const policy of [{ unlocked: false, enabled: true }, { unlocked: true, enabled: false }]) {
    const deniedHandler = createInfoHandler({ getGuildPolicy: () => policy });
    const policyReplies = [];
    await deniedHandler({
      customId: INFO_SELECT_CUSTOM_ID, guildId: GUILD_ID, user: { id: ADMIN_ID }, values: ['roll'],
      isStringSelectMenu: () => true, reply: async (payload) => policyReplies.push(payload),
    });
    assert.match(payloadText(policyReplies[0]), /locked|disabled/i);
  }
});

test('publisher creates, edits, reposts, changes channels, and refuses foreign messages', async () => {
  const sent = [];
  const fetched = [];
  const edits = [];
  const channels = new Map();
  const firstChannel = {
    id: CHANNEL_ID,
    guildId: GUILD_ID,
    messages: { fetch: async (id) => { fetched.push(id); const item = message(id); item.edit = async (payload) => { edits.push(payload); return item; }; return item; } },
    send: async (payload) => { sent.push([CHANNEL_ID, payload]); return message(MESSAGE_ID); },
  };
  const secondChannel = {
    id: SECOND_CHANNEL_ID,
    guildId: GUILD_ID,
    messages: { fetch: async () => { throw new Error('old channel should not be fetched'); } },
    send: async (payload) => { sent.push([SECOND_CHANNEL_ID, payload]); return message('523456789012345679'); },
  };
  channels.set(CHANNEL_ID, firstChannel);
  channels.set(SECOND_CHANNEL_ID, secondChannel);
  const registered = new Map([['roll', { name: 'roll', id: '723456789012345678' }]]);
  const publisher = new InfoPublisher({ client: {
    user: { id: BOT_ID },
    application: { commands: { cache: new Map() } },
    channels: { cache: channels },
    guilds: { cache: new Map([[GUILD_ID, { commands: { cache: registered } }]]) },
  } });

  assert.equal((await publisher.publish(CHANNEL_ID)).action, 'published');
  assert.match(payloadText(sent[0][1]), /<\/roll:723456789012345678>/);
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
      return { action: reference.messageId ? 'updated' : 'published', message: message(MESSAGE_ID), messageVersion: 2 };
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
    messageVersion: 2,
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
    messageVersion: 2,
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
  assert.match(source, /Command browser|Locked by owner/);
  assert.match(html, /id="infoChannelSelect"/);
  assert.match(html, /Choose a command/);
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
