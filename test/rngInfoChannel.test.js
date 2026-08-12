const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
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
  REQUIRED_GUIDE_FIELDS,
  auditCommandCatalog,
  commandByKey,
  commandCatalog,
  paginateCommands,
  prefixCommands,
  slashCommands,
} = require('../src/features/rng-game/info/catalog');
const {
  browseCustomId,
  commandPayload,
  detailCustomId,
  escapeDiscordText,
  guidePages,
  infoMessagePayload,
  selectCustomId,
} = require('../src/features/rng-game/info/builders');
const { createInfoHandler } = require('../src/features/rng-game/info/handler');
const {
  commandMention,
  resolveCachedCommandIds,
  resolveRegisteredCommandIds,
} = require('../src/features/rng-game/info/mentions');
const { InfoPublishError, InfoPublisher, restPayload } = require('../src/features/rng-game/info/publisher');
const { resolveEmoji } = require('../src/features/shared/emojis');
const {
  DISCORD_MESSAGE_LIMITS,
  messagePayloadErrors,
  payloadMetrics,
} = require('../src/features/shared/discordPayload');
const { RNG_GAME_COMMANDS, PREFIX_COMMANDS } = require('../src/features/rng-game/commands');
const { WORK_COMMANDS } = require('../src/features/work/commands');
const { WORK_GAMES } = require('../src/features/work/data');

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
    channelId: '', messageChannelId: '', messageId: '', publishedAt: '', messageVersion: 3,
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

function commandGuideText(commandKey, commands = commandCatalog()) {
  const command = commandByKey(commandKey, commands);
  return guidePages(command, { commands, commandIds: commandIdsFor(commands) }).map((page) => page.content).join('\n');
}

test('landing page keeps command names and purposes in the selector without duplicate command lists', () => {
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
  assert.doesNotMatch(container.components[0].content, /## Quick Start|## Browse Commands|## Core Game|## Progression|## Tokens & Activities/);
  const select = allComponentNodes(payload).find((node) => node.type === 3);
  assert.equal(select.custom_id, INFO_SELECT_CUSTOM_ID);
  assert.equal(select.placeholder, 'Choose a command');
  assert.deepEqual(select.options.map((option) => option.value), commands.map((command) => command.key));
  assert.deepEqual(select.options.map((option) => option.label), commands.map((command) => `/${command.path}`));
  assert.deepEqual(select.options.map((option) => option.description), commands.map((command) => command.description));
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

test('interaction-safe command ID resolution uses caches without making Discord REST requests', () => {
  let fetches = 0;
  const client = {
    application: { commands: {
      cache: new Map([['roll', { name: 'roll', id: '723456789012345677' }]]),
      fetch: async () => { fetches += 1; return new Map(); },
    } },
    guilds: { cache: new Map([[GUILD_ID, { commands: {
      cache: new Map([['roll', { name: 'roll', id: '723456789012345678' }]]),
      fetch: async () => { fetches += 1; return new Map(); },
    } }]]) },
  };
  assert.equal(resolveCachedCommandIds(client, GUILD_ID).get('roll'), '723456789012345678');
  assert.equal(fetches, 0);
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

test('every registered player command has explicit, complete metadata and every slash argument is rendered', () => {
  const commands = commandCatalog();
  assert.deepEqual(auditCommandCatalog(commands), { commandCount: commands.length, optionCount: 1 });
  assert.deepEqual(commands.map((command) => command.key), [
    'roll', 'inventory', 'sell', 'balance', 'auto-roll', 'upgrade', 'index', 'stat',
    'calculate-chance', 'exchange-token', 'g-rps', 'g-work',
  ]);
  for (const command of commands) {
    assert.equal(command.hasExplicitGuide, true, `${command.key} must not use fallback metadata`);
    for (const field of REQUIRED_GUIDE_FIELDS) {
      assert.ok(field === 'purpose' ? command[field] : command[field].length, `${command.key} has ${field}`);
    }
    const usage = guidePages(command, { commands }).map((page) => page.content).join('\n');
    for (const option of command.options) {
      assert.match(usage, new RegExp(`\\\\?\`${option.name}\\\\?\``));
      assert.match(usage, new RegExp(option.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
});

test('auto-roll guide is dynamically paginated without losing scheduler and economy rules', () => {
  const pages = guidePages(commandByKey('auto-roll'), {
    commands: commandCatalog(),
    commandIds: commandIdsFor(),
  });
  const text = commandGuideText('auto-roll');
  assert.ok(pages.length > 1);
  assert.match(pages[0].content, /Page 1\/\d+/);
  assert.match(pages.at(-1).content, new RegExp(`Page ${pages.length}/${pages.length}`));
  assert.match(text, /## Mechanics, Costs & Limits/);
  assert.match(text, /## Results & Rewards/);
  assert.match(text, /## Common Problems/);
  assert.match(text, /minimum `1 minute`, maximum `1 day`/);
  assert.match(text, /`12` rolls per minute/);
  assert.match(text, /max\(5, ceil\(\(gross expected crop value − 30\) \/ 4\)\)/);
  assert.match(text, /unprocessed paid roll is refunded/i);
  assert.match(text, /no manual cancel button/i);
  assert.match(text, /Manual `\/roll` and `\/sell` are locked|Manual <\/roll:/);
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

test('short roll guide stays on one page without pagination controls', () => {
  const commands = commandCatalog();
  const payload = commandPayload('roll', {
    commands,
    commandIds: commandIdsFor(commands),
    ownerId: ADMIN_ID,
  }, { ephemeral: true });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const text = payloadText(payload);
  assert.match(text, /^# 🎲 `\/roll`/m);
  assert.doesNotMatch(text, /Page 1\/1/);
  assert.match(text, /\*\*Slash:\*\* <\/roll:723456789012345678>/);
  assert.match(text, /\*\*Prefix:\*\* `c!roll`/);
  const completeGuide = commandGuideText('roll', commands);
  assert.match(completeGuide, /## Invocations/);
  assert.match(completeGuide, /5 seconds/);
  assert.match(completeGuide, /inventory full/i);
  assert.match(completeGuide, /## Results & Rewards/);
  assert.match(completeGuide, /## Examples/);
  assert.match(completeGuide, /## Common Problems/);
  const select = allComponentNodes(payload).find((node) => node.type === 3);
  assert.equal(select.custom_id, selectCustomId(ADMIN_ID, 1));
  assert.equal(select.options.find((option) => option.value === 'roll').default, true);
  assert.equal(guidePages(commandByKey('roll', commands), { commands }).length, 1);
  assert.equal(allComponentNodes(payload).some((node) => ['Previous', 'Next'].includes(node.label)), false);
  assert.equal(allComponentNodes(payload).some((node) => /^Page \d+\/\d+$/.test(node.label || '')), false);
});

test('prefix usage is shown only for supported commands and slash options come from command definitions', () => {
  const commands = commandCatalog();
  const context = { commands, commandIds: commandIdsFor(commands), ownerId: ADMIN_ID };
  assert.match(commandGuideText('inventory', commands), /\*\*Prefix:\*\* `c!inventory`/);
  assert.doesNotMatch(commandGuideText('g-rps', commands), /\*\*Prefix:\*\*/);
  const exchange = commandGuideText('exchange-token', commands);
  assert.match(exchange, /### Slash Arguments/);
  assert.match(exchange, /`amount-token` — Token value to receive \(up to 100 per four hours\)/);
  assert.match(exchange, /Integer; required; minimum `1`; maximum `100`/);
  assert.match(exchange, /<amount-token>/);
});

test('every selector option maps to a valid detail and all payload strings respect Discord limits', () => {
  const commands = commandCatalog();
  const context = { commands, commandIds: commandIdsFor(commands), ownerId: ADMIN_ID };
  const landing = infoMessagePayload(BOT_ID, context);
  const options = allComponentNodes(landing).find((node) => node.type === 3).options;
  assert.deepEqual(new Set(options.map((option) => option.value)), new Set(commands.map((command) => command.key)));
  for (const option of options) assert.ok(commandByKey(option.value, commands));
  const payloads = [landing];
  for (const command of commands) {
    const pages = guidePages(command, context);
    for (let guidePage = 1; guidePage <= pages.length; guidePage += 1) {
      payloads.push(commandPayload(command.key, { ...context, guidePage }, { ephemeral: true }));
    }
  }
  for (const payload of payloads) {
    assert.deepEqual(messagePayloadErrors(payload), []);
    const metrics = payloadMetrics(payload);
    assert.ok(metrics.components <= DISCORD_MESSAGE_LIMITS.components);
    assert.ok(metrics.embedChars <= DISCORD_MESSAGE_LIMITS.embedTotal);
    assert.ok(metrics.customIds.every((length) => length <= DISCORD_MESSAGE_LIMITS.componentCustomId));
    assert.ok(metrics.labels.every((length) => length <= DISCORD_MESSAGE_LIMITS.buttonLabel));
  }
});

test('payload validation identifies duplicate custom IDs and nested embed limit paths', () => {
  const payload = {
    embeds: [{
      description: 'x'.repeat(DISCORD_MESSAGE_LIMITS.embedDescription + 1),
      fields: Array.from({ length: DISCORD_MESSAGE_LIMITS.embedFields + 1 }, (_, index) => ({
        name: `Field ${index}`,
        value: 'value',
      })),
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 2, label: 'First', custom_id: 'duplicate' },
        { type: 2, style: 2, label: 'x'.repeat(DISCORD_MESSAGE_LIMITS.buttonLabel + 1), custom_id: 'duplicate' },
      ],
    }],
  };
  const errors = messagePayloadErrors(payload);
  assert.ok(errors.some((error) => error.path === 'embeds[0].description'));
  assert.ok(errors.some((error) => error.path === 'embeds[0].fields'));
  assert.ok(errors.some((error) => error.path === 'components[0].components[1].label'));
  assert.ok(errors.some((error) => (
    error.path === 'components[0].components[1].custom_id' && /unique/.test(error.message)
  )));
});

test('detail navigation preserves command state and sets boundary buttons correctly', () => {
  const commands = commandCatalog();
  const pages = guidePages(commandByKey('auto-roll', commands), { commands, commandIds: commandIdsFor(commands) });
  const context = {
    commands,
    commandIds: commandIdsFor(commands),
    ownerId: ADMIN_ID,
    selectorPage: 1,
  };
  const first = commandPayload('auto-roll', { ...context, guidePage: 1 });
  assert.match(payloadText(first), new RegExp(`Page 1/${pages.length}`));
  const firstNodes = allComponentNodes(first);
  const select = firstNodes.find((node) => node.type === 3);
  assert.equal(select.options.find((option) => option.value === 'auto-roll').default, true);
  assert.equal(firstNodes.find((node) => node.label === 'Previous').disabled, true);
  assert.equal(firstNodes.find((node) => node.label === 'Next').disabled, false);
  assert.equal(firstNodes.find((node) => /^Page /.test(node.label || '')).disabled, true);
  const firstCustomIds = firstNodes.filter((node) => node.custom_id).map((node) => node.custom_id);
  assert.equal(new Set(firstCustomIds).size, firstCustomIds.length);

  const last = commandPayload('auto-roll', { ...context, guidePage: pages.length });
  const lastNodes = allComponentNodes(last);
  assert.equal(lastNodes.find((node) => node.label === 'Previous').disabled, false);
  assert.equal(lastNodes.find((node) => node.label === 'Next').disabled, true);
  assert.ok(lastNodes.some((node) => node.custom_id === detailCustomId(ADMIN_ID, 5, pages.length - 1, 1)));

  const withoutOptionalSections = {
    ...commandByKey('roll', commands), warnings: [], tips: [],
  };
  const optionalText = guidePages(withoutOptionalSections, { commands }).map((page) => page.content).join('\n');
  assert.doesNotMatch(optionalText, /## Important/);
  assert.doesNotMatch(optionalText, /## Tips|## Warnings/);
});

test('oversized guide sections split safely across valid pages without truncation', () => {
  const commands = commandCatalog();
  const longLine = '🙂'.repeat(2_500);
  const tooLong = { ...commands[0], mechanics: [`First paragraph.\n\n${longLine}\n${'final line '.repeat(600)}`] };
  const pages = guidePages(tooLong, { commands });
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.content.length <= DISCORD_MESSAGE_LIMITS.textDisplay));
  assert.match(pages.map((page) => page.content).join('\n'), /First paragraph/);
  assert.equal(pages.map((page) => page.content).join('\n').includes(longLine), false, 'page breaks split an oversized line');
  assert.equal(pages.map((page) => page.content).join('').replace(/[^🙂]/gu, '').length, longLine.length);
  const rendered = [
    payloadText(infoMessagePayload(BOT_ID, { commands, commandIds: commandIdsFor(commands) })),
    ...commands.flatMap((command) => guidePages(command, { commands, commandIds: commandIdsFor(commands) }).map((page) => page.content)),
  ].join('\n');
  assert.doesNotMatch(rendered, /\[\[[a-z0-9:-]+\]\]|ACTUAL_COMMAND_ID|<actual|<supported argument>|<\/\{/i);
});

test('Work help is isolated from protected customer identities, rewards, mappings, and source data', () => {
  const commands = commandCatalog();
  const rendered = [
    payloadText(infoMessagePayload(BOT_ID, { commands })),
    commandGuideText('g-work', commands),
  ].join('\n');
  const lower = rendered.toLowerCase();
  for (const game of WORK_GAMES) {
    for (const customer of game.customers) {
      assert.doesNotMatch(rendered, new RegExp(customer.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      assert.ok(!lower.includes(JSON.stringify(customer).toLowerCase()), 'a customer record must never be rendered');
      assert.ok(!lower.includes(`${customer.id}:${customer.reward}`), 'customer-to-reward pairs must never be rendered');
      assert.ok(!lower.includes(customer.order.join(' → ').toLowerCase()), 'customer orders must never be copied into help');
    }
  }
  assert.doesNotMatch(rendered, /customer\s*(?:#|id)?\s*\d+[^\n]{0,80}(?:reward|salary)|(?:reward|salary)[^\n]{0,80}customer\s*(?:#|id)?\s*\d+/i);
  assert.doesNotMatch(rendered, /customer (?:reward range|selection (?:chance|weight)|reward table)|base reward/i);
  assert.match(rendered, /customer identities and customer-specific rewards are intentionally left/i);
  const guideSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'rng-game', 'info', 'guides.js'), 'utf8');
  assert.doesNotMatch(guideSource, /require\(['"]\.\.\/\.\.\/work\/data['"]\)/);
  const isolationCheck = execFileSync(process.execPath, ['-e', [
    "require('./src/features/rng-game/info/catalog');",
    "process.stdout.write(String(Boolean(require.cache[require.resolve('./src/features/work/data')])));",
  ].join('')], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(isolationCheck.trim().endsWith('false'), true, 'loading information metadata must not load protected Work data');
});

test('notices escape mentions and Markdown while payloads disable mention parsing', () => {
  const notice = '@everyone **open _this_** `now`';
  assert.notEqual(escapeDiscordText(notice), notice);
  const payload = infoMessagePayload(BOT_ID, { notice });
  const rendered = payloadText(payload);
  assert.doesNotMatch(rendered, /@everyone|\*\*open _this_\*\*|`now`/);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
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
  const nextCommands = allComponentNodes(first).find((node) => node.type === 2 && node.label === 'Next Commands');
  assert.equal(nextCommands.custom_id, browseCustomId('0', 2, 0, 1));
  const detail = commandPayload(commands[25].key, { commands, ownerId: ADMIN_ID, selectorPage: 2 });
  const detailSelect = allComponentNodes(detail).find((node) => node.type === 3);
  assert.equal(detailSelect.custom_id, selectCustomId(ADMIN_ID, 2));
  assert.equal(detailSelect.options.find((option) => option.value === commands[25].key).default, true);
  assert.deepEqual(
    [...firstOptions, ...secondOptions].map((option) => option.label),
    commands.map((command) => `/${command.path}`),
  );
});

test('selecting roll replaces the deferred ephemeral response exactly once', async () => {
  const handler = createInfoHandler({ getGuildPolicy: () => ({ unlocked: true, enabled: true }) });
  const calls = [];
  let deferred = false;
  const interaction = {
    customId: INFO_SELECT_CUSTOM_ID,
    guildId: GUILD_ID,
    user: { id: ADMIN_ID },
    values: ['roll'],
    get deferred() { return deferred; },
    replied: false,
    isStringSelectMenu: () => true,
    deferReply: async (options) => { deferred = true; calls.push(['defer', options]); },
    editReply: async (payload) => calls.push(['edit', payload]),
    reply: async () => calls.push(['reply']),
    update: async () => calls.push(['update']),
  };
  assert.equal(await handler(interaction), true);
  assert.deepEqual(calls.map(([operation]) => operation), ['defer', 'edit']);
  assert.deepEqual(calls[0][1], { flags: MessageFlags.Ephemeral });
  assert.match(payloadText(calls[1][1]), /`\/roll`/);
  assert.deepEqual(messagePayloadErrors(calls[1][1]), []);
});

test('command interactions keep private navigation, enforce ownership, and recover from stale selections', async () => {
  const replies = [];
  const updates = [];
  const registered = new Map(commandCatalog().map((command) => [command.root, {
    name: command.root,
    id: '723456789012345678',
  }]));
  let interactionCommandFetches = 0;
  const client = {
    user: { id: BOT_ID },
    application: { commands: {
      cache: new Map(),
      fetch: async () => { interactionCommandFetches += 1; return new Map(); },
    } },
    guilds: { cache: new Map([[GUILD_ID, { commands: {
      cache: registered,
      fetch: async () => { interactionCommandFetches += 1; return registered; },
    } }]]) },
  };
  const handler = createInfoHandler({
    getGuildPolicy: () => ({ unlocked: true, enabled: true }),
    getClient: () => client,
  });
  const publicAcknowledgements = [];
  assert.equal(await handler({
    customId: INFO_SELECT_CUSTOM_ID,
    guildId: GUILD_ID,
    client,
    user: { id: ADMIN_ID },
    values: ['roll'],
    isStringSelectMenu: () => true,
    deferReply: async (options) => publicAcknowledgements.push(options),
    editReply: async (payload) => replies.push(payload),
  }), true);
  assert.deepEqual(publicAcknowledgements, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(replies[0].flags, MessageFlags.IsComponentsV2);
  assert.match(payloadText(replies[0]), /<\/roll:723456789012345678>/);
  assert.equal(interactionCommandFetches, 0, 'interactions must not wait for command REST fetches');
  const privateSelect = allComponentNodes(replies[0]).find((node) => node.type === 3);
  assert.equal(privateSelect.custom_id, selectCustomId(ADMIN_ID, 1));

  await handler({
    customId: privateSelect.custom_id,
    guildId: GUILD_ID,
    client,
    user: { id: ADMIN_ID },
    values: ['auto-roll'],
    isStringSelectMenu: () => true,
    deferUpdate: async () => {},
    editReply: async (payload) => updates.push(payload),
  });
  const nextGuidePage = allComponentNodes(updates[0]).find((node) => node.type === 2 && node.label === 'Next');
  assert.equal(nextGuidePage.custom_id, detailCustomId(ADMIN_ID, 5, 2, 1));
  const guideUpdates = [];
  await handler({
    customId: nextGuidePage.custom_id,
    guildId: GUILD_ID,
    client,
    user: { id: ADMIN_ID },
    isButton: () => true,
    deferUpdate: async () => {},
    editReply: async (payload) => guideUpdates.push(payload),
  });
  assert.match(payloadText(guideUpdates[0]), /Page 2\/\d+/);
  assert.equal(
    allComponentNodes(guideUpdates[0]).find((node) => node.type === 3).options.find((option) => option.value === 'auto-roll').default,
    true,
  );

  const deniedPagination = [];
  await handler({
    customId: nextGuidePage.custom_id,
    guildId: GUILD_ID,
    client,
    user: { id: '999999999999999999' },
    isButton: () => true,
    reply: async (payload) => deniedPagination.push(payload),
  });
  assert.match(payloadText(deniedPagination[0]), /Only the player/i);

  await handler({
    customId: privateSelect.custom_id,
    guildId: GUILD_ID,
    client,
    user: { id: ADMIN_ID },
    values: ['inventory'],
    isStringSelectMenu: () => true,
    deferUpdate: async () => {},
    editReply: async (payload) => updates.push(payload),
  });
  assert.equal(updates[1].flags, undefined);
  assert.match(payloadText(updates[1]), /`\/inventory`/);

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
  const staleAcknowledgements = [];
  for (const request of [
    { customId: INFO_SELECT_CUSTOM_ID, values: ['removed-command'], isStringSelectMenu: () => true },
    { customId: 'rng:info:topic:v1', isButton: () => true },
  ]) {
    await handler({
      ...request,
      guildId: GUILD_ID,
      client,
      user: { id: ADMIN_ID },
      deferReply: async (options) => staleAcknowledgements.push(options),
      editReply: async (payload) => stale.push(payload),
      reply: async (payload) => stale.push(payload),
    });
  }
  assert.deepEqual(staleAcknowledgements, [{ flags: MessageFlags.Ephemeral }]);
  assert.match(payloadText(stale[0]), /not a supported RNG command/i);
  assert.match(payloadText(stale[1]), /malformed or outdated/i);

  const unknownPage = [];
  await handler({
    customId: detailCustomId(ADMIN_ID, 999, 1, 1),
    guildId: GUILD_ID,
    client,
    user: { id: ADMIN_ID },
    isButton: () => true,
    deferUpdate: async () => {},
    editReply: async (payload) => unknownPage.push(payload),
  });
  assert.match(payloadText(unknownPage[0]), /no longer available/i);

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

test('info selection acknowledges before delayed guide rendering and exposes edit failures', async () => {
  const events = [];
  let releaseRender;
  const renderGate = new Promise((resolve) => { releaseRender = resolve; });
  const handler = createInfoHandler({
    getGuildPolicy: () => ({ unlocked: true, enabled: true }),
    buildCommandPayload: async (...args) => {
      events.push('render-start');
      await renderGate;
      events.push('render-finish');
      return commandPayload(...args);
    },
  });
  const interaction = {
    customId: INFO_SELECT_CUSTOM_ID,
    guildId: GUILD_ID,
    user: { id: ADMIN_ID },
    values: ['roll'],
    isStringSelectMenu: () => true,
    deferReply: async () => { events.push('ack'); },
    editReply: async () => { events.push('edit'); },
  };
  const handling = handler(interaction);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ['ack', 'render-start']);
  releaseRender();
  await handling;
  assert.deepEqual(events, ['ack', 'render-start', 'render-finish', 'edit']);

  let deferred = false;
  let completed = false;
  let deferCalls = 0;
  let replyCalls = 0;
  let editCalls = 0;
  const editError = new Error('Discord rejected edit');
  await assert.rejects(handler({
    ...interaction,
    get deferred() { return deferred; },
    replied: false,
    deferReply: async () => { deferCalls += 1; deferred = true; },
    reply: async () => { replyCalls += 1; },
    editReply: async () => {
      editCalls += 1;
      if (editCalls === 1) throw editError;
      completed = true;
    },
  }), /Discord rejected edit/);
  assert.equal(deferCalls, 1);
  assert.equal(replyCalls, 0);
  assert.equal(editCalls, 2, 'the failed detail edit is replaced by one safe completion edit');
  assert.equal(completed, true, 'the deferred thinking response is completed on the error path');

  const freshErrors = [];
  const brokenPolicyHandler = createInfoHandler({
    getGuildPolicy: () => { throw new Error('Policy unavailable'); },
  });
  await assert.rejects(brokenPolicyHandler({
    customId: INFO_SELECT_CUSTOM_ID,
    guildId: GUILD_ID,
    user: { id: ADMIN_ID },
    values: ['roll'],
    isStringSelectMenu: () => true,
    reply: async (payload) => freshErrors.push(payload),
  }), /Policy unavailable/);
  assert.equal(freshErrors.length, 1);
  assert.match(payloadText(freshErrors[0]), /could not finish this guide/i);
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
  const publishedSelect = allComponentNodes(sent[0][1]).find((node) => node.type === 3);
  assert.equal(publishedSelect.options[0].label, '/roll');
  assert.equal(publishedSelect.options[0].description, 'Roll a seed crop.');
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
      return { action: reference.messageId ? 'updated' : 'published', message: message(MESSAGE_ID), messageVersion: 3 };
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
    messageVersion: 3,
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
    messageVersion: 3,
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
