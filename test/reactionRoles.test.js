const assert = require('node:assert/strict');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');
const {
  DEFAULT_GUILD_CONFIG,
  SCHEMA_VERSION,
  normalizeState,
} = require('../src/serverConfig');
const {
  ReactionRoleError,
  buildReactionRolePayload,
  createReactionRoleTemplate,
  deleteReactionRoleTemplate,
  duplicateReactionRoleTemplate,
  handleReactionRoleInteraction,
  normalizeReactionRolesConfig,
  parseReactionRoleCustomId,
  publishReactionRoleTemplate,
  reactionRoleButtonCustomId,
  reactionRoleSelectCustomId,
  updateReactionRoleTemplate,
} = require('../src/reactionRoles');
const { fetchDirectoryEmojis } = require('../src/adminServer');

const GUILD_ID = '123456789012345678';
const CHANNEL_ID = '223456789012345678';
const MESSAGE_ID = '323456789012345678';
const MEMBER_ID = '423456789012345678';
const ROLE_A = '523456789012345678';
const ROLE_B = '623456789012345678';

function collection() {
  return normalizeReactionRolesConfig();
}

function buttonEntry(roleId, overrides = {}) {
  return {
    id: overrides.id,
    emoji: overrides.emoji || { id: '', name: '🔥', animated: false, source: 'default' },
    label: overrides.label || 'Artist',
    style: overrides.style || 'Secondary',
    roleId,
    sortOrder: overrides.sortOrder || 0,
  };
}

function optionEntry(roleId, overrides = {}) {
  return {
    id: overrides.id,
    emoji: overrides.emoji || { id: '', name: '🔥', animated: false, source: 'default' },
    title: overrides.title || 'Artist',
    description: overrides.description || '',
    roleId,
    sortOrder: overrides.sortOrder || 0,
  };
}

function createItem(overrides = {}) {
  const entries = overrides.buttons || [buttonEntry(ROLE_A, { id: 'button_artist' })];
  return createReactionRoleTemplate(collection(), {
    name: 'Choose roles',
    channelId: CHANNEL_ID,
    interactionType: 'button',
    buttons: entries,
    ...overrides,
  }, '2026-09-01T00:00:00Z');
}

test('schema 19 configuration upgrades safely to schema 20 with Reaction Roles defaults', () => {
  const state = normalizeState({
    meta: { schemaVersion: 19, disabledGuilds: {} },
    guilds: { [GUILD_ID]: { leveling: { xp: { min: 21, max: 42 } } } },
  });
  assert.equal(SCHEMA_VERSION, 20);
  assert.deepEqual(DEFAULT_GUILD_CONFIG.reactionRoles, { items: [] });
  assert.deepEqual(state.guilds[GUILD_ID].reactionRoles, { items: [] });
  assert.equal(state.guilds[GUILD_ID].leveling.xp.min, 21);
});

test('Reaction Role normalization is bounded, stable, safe, and idempotent', () => {
  const malformed = {
    items: [{
      id: '../bad', name: '', secret: 'drop', interactionType: 'dropdown', channelId: 'bad',
      message: { content: `Hello\0${'x'.repeat(5000)}`, layout: { accentColor: '#bad' }, extra: true },
      dropdown: { placeholder: 'Pick', allowMultiple: true, options: [
        { id: 'duplicate_id', title: 'One', roleId: ROLE_A, emoji: { id: ROLE_B, name: 'party', animated: true, source: 'bot' } },
        { id: 'duplicate_id', title: 'Two', roleId: ROLE_B },
      ] },
    }],
  };
  const first = normalizeReactionRolesConfig(malformed);
  const second = normalizeReactionRolesConfig(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(second, first);
  assert.match(first.items[0].id, /^rr_[a-f0-9]{24}$/);
  assert.equal(first.items[0].name, 'Reaction Roles 1');
  assert.equal(first.items[0].message.content.length, 4000);
  assert.equal(first.items[0].secret, undefined);
  assert.equal(first.items[0].message.extra, undefined);
  assert.equal(new Set(first.items[0].dropdown.options.map((option) => option.id)).size, 2);
  assert.deepEqual(first.items[0].dropdown.options[0].emoji, { id: ROLE_B, name: 'party', animated: true, source: 'bot' });
});

test('strict CRUD rejects unknown fields and unsupported button styles', () => {
  const records = collection();
  assert.throws(() => createReactionRoleTemplate(records, { name: 'Unsafe', webhookToken: 'secret' }), /Unknown reaction role field/i);
  assert.throws(() => createReactionRoleTemplate(records, { name: 'Unsafe', buttons: [{ ...buttonEntry(ROLE_A), style: 'Link' }] }), /Link and Premium/);
  assert.throws(() => createReactionRoleTemplate(records, { name: 'Unsafe', buttons: [{ ...buttonEntry(ROLE_A), emoji: { name: '🔥', script: true } }] }), /Unknown reaction role button 1 emoji field/i);
  const item = createReactionRoleTemplate(records, { name: 'Roles' }, '2026-09-01T00:00:00Z');
  updateReactionRoleTemplate(records, item.id, { enabled: false, channelId: CHANNEL_ID }, '2026-09-01T01:00:00Z');
  assert.equal(item.enabled, false);
  assert.equal(item.createdAt, '2026-09-01T00:00:00.000Z');
  assert.equal(item.updatedAt, '2026-09-01T01:00:00.000Z');
  const copy = duplicateReactionRoleTemplate(records, item.id, '2026-09-01T02:00:00Z');
  assert.notEqual(copy.id, item.id);
  assert.equal(copy.enabled, false);
  assert.equal(copy.publishedMessageId, '');
  assert.equal(deleteReactionRoleTemplate(records, item.id).id, item.id);
});

test('button payloads serialize Unicode, static, and animated emojis into rows of five', () => {
  const buttons = Array.from({ length: 6 }, (_, index) => buttonEntry(String(BigInt(ROLE_A) + BigInt(index)), {
    id: `button_${String(index).padStart(8, '0')}`,
    label: `Role ${index + 1}`,
    emoji: index === 0
      ? { id: '', name: '🔥', animated: false, source: 'default' }
      : index === 1
        ? { id: ROLE_B, name: 'static', animated: false, source: 'group' }
        : { id: String(BigInt(ROLE_B) + BigInt(index)), name: 'dance', animated: true, source: 'bot' },
  }));
  const item = createItem({ buttons });
  const payload = buildReactionRolePayload(item);
  const rows = payload.components.filter((component) => component.type === 1);
  assert.deepEqual(rows.map((row) => row.components.length), [5, 1]);
  assert.deepEqual(rows[0].components[0].emoji, { name: '🔥' });
  assert.deepEqual(rows[0].components[1].emoji, { id: ROLE_B, name: 'static', animated: false });
  assert.equal(rows[0].components[2].emoji.animated, true);
  assert.ok(rows.flatMap((row) => row.components).every((button) => button.custom_id.length <= 100));
});

test('dropdown payloads enforce selection behavior and Discord option limits', () => {
  const options = [optionEntry(ROLE_A, { id: 'option_artist', title: 'Artist' }), optionEntry(ROLE_B, { id: 'option_gamer', title: 'Gamer' })];
  const item = createItem({ interactionType: 'dropdown', buttons: [], dropdown: { placeholder: 'Pick roles', allowMultiple: true, options } });
  const menu = buildReactionRolePayload(item).components.find((component) => component.type === 1).components[0];
  assert.equal(menu.type, 3);
  assert.equal(menu.max_values, 2);
  assert.equal(menu.options.length, 2);
  assert.equal(menu.options[0].value, 'option_artist');
  assert.throws(() => createReactionRoleTemplate(collection(), {
    name: 'Too many', interactionType: 'dropdown', dropdown: { options: Array.from({ length: 26 }, (_, index) => optionEntry(String(BigInt(ROLE_A) + BigInt(index)))) },
  }), /up to 25/);
});

function runtimeFixture(item, initialRoles = []) {
  item.publishedMessageId = MESSAGE_ID;
  const memberRoles = new Set(initialRoles);
  const operations = [];
  const role = (id, name) => ({
    id, name, managed: false, editable: true, permissions: { has: () => false },
    comparePositionTo: () => -1,
  });
  const roleA = role(ROLE_A, 'Artist');
  const roleB = role(ROLE_B, 'Gamer');
  const botMember = { permissions: { has: (flag) => flag === PermissionFlagsBits.ManageRoles }, roles: { highest: { id: 'bot-highest' } } };
  const member = {
    id: MEMBER_ID,
    roles: {
      cache: { has: (id) => memberRoles.has(id) },
      add: async (entry) => { operations.push(`add:${entry.id}`); memberRoles.add(entry.id); },
      remove: async (entry) => { operations.push(`remove:${entry.id}`); memberRoles.delete(entry.id); },
    },
  };
  const responses = [];
  const guild = {
    id: GUILD_ID,
    roles: { cache: new Map([[ROLE_A, roleA], [ROLE_B, roleB]]), fetch: async () => new Map([[ROLE_A, roleA], [ROLE_B, roleB]]) },
    members: { me: botMember, fetchMe: async () => botMember, fetch: async () => member },
  };
  const interaction = {
    guildId: GUILD_ID, guild, channelId: CHANNEL_ID, message: { id: MESSAGE_ID }, user: { id: MEMBER_ID }, member,
    customId: '', values: [], deferred: false, replied: false,
    deferReply: async (payload) => { interaction.deferred = true; responses.push({ defer: payload }); },
    editReply: async (payload) => { responses.push(payload); },
    reply: async (payload) => { interaction.replied = true; responses.push(payload); },
  };
  return { interaction, memberRoles, operations, responses, getGuildConfigRaw: () => ({ reactionRoles: { items: [item] } }) };
}

test('button interactions toggle roles and confirm ephemerally', async () => {
  const item = createItem();
  const added = runtimeFixture(item);
  added.interaction.customId = reactionRoleButtonCustomId(item.id, item.buttons[0].id);
  assert.equal(await handleReactionRoleInteraction(added.interaction, { getGuildConfigRaw: added.getGuildConfigRaw, log: () => {} }), true);
  assert.deepEqual(added.operations, [`add:${ROLE_A}`]);
  assert.match(added.responses.at(-1).content, /Role given: <@&523456789012345678>/);
  assert.deepEqual(added.responses[0].defer, { flags: 64 });

  const removed = runtimeFixture(item, [ROLE_A]);
  removed.interaction.customId = reactionRoleButtonCustomId(item.id, item.buttons[0].id);
  await handleReactionRoleInteraction(removed.interaction, { getGuildConfigRaw: removed.getGuildConfigRaw, log: () => {} });
  assert.deepEqual(removed.operations, [`remove:${ROLE_A}`]);
  assert.match(removed.responses.at(-1).content, /Role removed/);
});

test('single and multiple dropdown selections synchronize only template-managed roles', async () => {
  const options = [optionEntry(ROLE_A, { id: 'option_artist' }), optionEntry(ROLE_B, { id: 'option_gamer' })];
  const single = createItem({ interactionType: 'dropdown', buttons: [], dropdown: { placeholder: 'Pick', allowMultiple: false, options } });
  const one = runtimeFixture(single, [ROLE_A, '723456789012345678']);
  one.interaction.customId = reactionRoleSelectCustomId(single.id); one.interaction.values = ['option_gamer'];
  await handleReactionRoleInteraction(one.interaction, { getGuildConfigRaw: one.getGuildConfigRaw, log: () => {} });
  assert.deepEqual(one.operations, [`remove:${ROLE_A}`, `add:${ROLE_B}`]);
  assert.ok(one.memberRoles.has('723456789012345678'));
  assert.match(one.responses.at(-1).content, /Roles updated/);

  const multiple = createItem({ interactionType: 'dropdown', buttons: [], dropdown: { placeholder: 'Pick', allowMultiple: true, options } });
  const many = runtimeFixture(multiple, [ROLE_B]);
  many.interaction.customId = reactionRoleSelectCustomId(multiple.id); many.interaction.values = ['option_artist'];
  await handleReactionRoleInteraction(many.interaction, { getGuildConfigRaw: many.getGuildConfigRaw, log: () => {} });
  assert.deepEqual(many.operations, [`add:${ROLE_A}`, `remove:${ROLE_B}`]);
});

test('runtime verifies custom IDs, published location, and Manage Roles', async () => {
  const item = createItem();
  assert.equal(parseReactionRoleCustomId('unrelated'), null);
  assert.deepEqual(parseReactionRoleCustomId(reactionRoleButtonCustomId(item.id, item.buttons[0].id)), { templateId: item.id, type: 'button', itemId: item.buttons[0].id });
  const wrongMessage = runtimeFixture(item);
  wrongMessage.interaction.customId = reactionRoleButtonCustomId(item.id, item.buttons[0].id);
  wrongMessage.interaction.message.id = '999999999999999999';
  await handleReactionRoleInteraction(wrongMessage.interaction, { getGuildConfigRaw: wrongMessage.getGuildConfigRaw, log: () => {} });
  assert.match(wrongMessage.responses.at(-1).content, /no longer attached/);

  const denied = runtimeFixture(item);
  denied.interaction.customId = reactionRoleButtonCustomId(item.id, item.buttons[0].id);
  denied.interaction.guild.members.me.permissions.has = () => false;
  await handleReactionRoleInteraction(denied.interaction, { getGuildConfigRaw: denied.getGuildConfigRaw, log: () => {} });
  assert.match(denied.responses.at(-1).content, /Manage Roles/);
  assert.deepEqual(denied.operations, []);
});

test('publishing sends a new message after deletion and updates an existing message', async () => {
  const item = createItem();
  const sent = [];
  const edited = [];
  const role = { id: ROLE_A, name: 'Artist', managed: false, editable: true, permissions: { has: () => false }, comparePositionTo: () => -1 };
  const botMember = { permissions: { has: () => true }, roles: { highest: {} } };
  const channel = {
    id: CHANNEL_ID, name: 'roles', isTextBased: () => true, isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => null },
    send: async (payload) => { sent.push(payload); return { id: MESSAGE_ID, url: 'https://discord.example/message' }; },
  };
  const guild = {
    id: GUILD_ID, name: 'Garden', iconURL: () => null,
    channels: { cache: new Map([[CHANNEL_ID, channel]]), fetch: async () => channel },
    roles: { cache: new Map([[ROLE_A, role]]), fetch: async () => new Map([[ROLE_A, role]]) },
    members: { me: botMember, fetchMe: async () => botMember },
  };
  item.publishedMessageId = '999999999999999999';
  const created = await publishReactionRoleTemplate(item, guild);
  assert.equal(created.updated, false);
  assert.equal(sent.length, 1);

  channel.messages.fetch = async () => ({ id: MESSAGE_ID, edit: async (payload) => { edited.push(payload); return { id: MESSAGE_ID, url: 'https://discord.example/message' }; } });
  item.publishedMessageId = MESSAGE_ID;
  const updated = await publishReactionRoleTemplate(item, guild);
  assert.equal(updated.updated, true);
  assert.equal(edited.length, 1);
});

test('application and guild emojis load independently, exclude unavailable entries, and deduplicate IDs', async () => {
  const applicationEmoji = { id: ROLE_A, name: 'app_party', animated: true, imageURL: () => 'https://cdn.example/app.gif' };
  const guildEmoji = { id: ROLE_B, name: 'guild_party', animated: false, available: true, imageURL: () => 'https://cdn.example/guild.png' };
  const unavailable = { id: '723456789012345678', name: 'gone', available: false };
  const guild = {
    client: { application: { emojis: { fetch: async () => new Map([[ROLE_A, applicationEmoji]]) } } },
    emojis: { fetch: async () => new Map([[ROLE_B, guildEmoji], [unavailable.id, unavailable]]) },
  };
  const both = await fetchDirectoryEmojis(guild);
  assert.deepEqual(both.bot, [{ id: ROLE_A, name: 'app_party', animated: true, url: 'https://cdn.example/app.gif', source: 'bot' }]);
  assert.deepEqual(both.group, [{ id: ROLE_B, name: 'guild_party', animated: false, url: 'https://cdn.example/guild.png', source: 'group' }]);
  assert.deepEqual(both.errors, { bot: false, group: false });

  guild.client.application.emojis.fetch = async () => { throw new Error('application unavailable'); };
  const partial = await fetchDirectoryEmojis(guild);
  assert.deepEqual(partial.bot, []);
  assert.equal(partial.group.length, 1);
  assert.deepEqual(partial.errors, { bot: true, group: false });
});

test('dashboard exposes the shared picker and exactly three Reaction Roles tabs', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'admin', 'app.js'), 'utf8');
  const emojiData = fs.readFileSync(path.join(__dirname, '..', 'admin', 'emojiData.js'), 'utf8');
  const emojiContext = { window: {} };
  vm.runInNewContext(emojiData, emojiContext);
  assert.match(html, /data-view="message-templates"[\s\S]*data-view="reaction-roles"[\s\S]*data-view="rng-game"/);
  assert.deepEqual([...html.matchAll(/data-reaction-tab="([^"]+)"/g)].map((match) => match[1]), ['message', 'role-reaction', 'channel']);
  for (const id of ['levelingEmojiToggle', 'welcomeEmojiToggle', 'templateEmojiToggle', 'xpDropEmojiToggle', 'xpClaimEmojiToggle', 'reactionRoleEmojiToggle']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /input\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
  assert.match(app, /replaceChildren\(\)/);
  assert.match(app, /source: 'default'/);
  assert.equal(emojiContext.window.COINSPRITE_EMOJI_DATA.version, '17.0');
  assert.equal(emojiContext.window.COINSPRITE_EMOJI_DATA.groups.length, 8);
  assert.ok(emojiContext.window.COINSPRITE_EMOJI_DATA.emojiCount >= 3000);
  assert.match(html, /id="emojiPickerCategories"/);
});
