const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');

const {
  DEFAULT_TEMPLATE_LAYOUT,
  TEMPLATE_VERSION,
  buildTemplatePayload,
  createTemplate,
  duplicateTemplate,
  normalizeMessageTemplatesConfig,
  parseTemplateControlCustomId,
  parseTemplateDocument,
  templateButtonCustomId,
  templateDocument,
  templateOptionValue,
  templateSelectCustomId,
  updateTemplate,
} = require('../src/messageTemplates');
const { handleMessageTemplateInteraction } = require('../src/messageTemplateInteractions');
const { SCHEMA_VERSION, normalizeState } = require('../src/serverConfig');

const GUILD_ID = '123456789012345678';
const CHANNEL_ID = '223456789012345678';
const MEMBER_ID = '323456789012345678';
const ROLE_A = '423456789012345678';
const ROLE_B = '523456789012345678';

function action(type, target) {
  return ['give_role', 'remove_role'].includes(type) ? { type, roleId: target } : { type, templateId: target };
}

function emoji(name = '✨') {
  return { id: '', name, animated: false, source: 'default' };
}

function button(id, type, target, overrides = {}) {
  return {
    id,
    emoji: emoji(),
    label: overrides.label || id,
    style: overrides.style || 'Secondary',
    sortOrder: overrides.sortOrder || 0,
    action: action(type, target),
  };
}

function option(id, type, target, overrides = {}) {
  return {
    id,
    emoji: emoji(),
    title: overrides.title || id,
    description: overrides.description || '',
    sortOrder: overrides.sortOrder || 0,
    action: action(type, target),
  };
}

function controls(type, entries = [], overrides = {}) {
  return {
    type,
    buttons: type === 'button' ? entries : [],
    dropdown: {
      placeholder: overrides.placeholder || 'Choose an option',
      allowMultiple: overrides.allowMultiple === true,
      options: type === 'dropdown' ? entries : [],
    },
  };
}

function collectionWithTargets() {
  const collection = normalizeMessageTemplatesConfig();
  const channelTarget = createTemplate(collection, {
    name: 'Channel target', content: 'Sent to {channel}', layout: DEFAULT_TEMPLATE_LAYOUT,
  }, '2026-09-01T00:00:00Z');
  const dmTarget = createTemplate(collection, {
    name: 'DM target', content: 'Private hello from {server}', layout: DEFAULT_TEMPLATE_LAYOUT,
  }, '2026-09-01T00:00:01Z');
  return { collection, channelTarget, dmTarget };
}

function createSource(collection, controlValue, overrides = {}) {
  return createTemplate(collection, {
    name: 'Interactive source', content: overrides.content || 'Choose below', layout: DEFAULT_TEMPLATE_LAYOUT,
    additionalContainers: overrides.additionalContainers || [], controls: controlValue,
  }, overrides.now || '2026-09-01T00:01:00Z');
}

test('schema-20 and version-1 Message Templates migrate to version 2 without data loss', () => {
  const state = normalizeState({
    meta: { schemaVersion: 20, disabledGuilds: {} },
    guilds: { [GUILD_ID]: { messageTemplates: { items: [{
      id: 'template_legacy123', name: 'Legacy', version: 1, content: 'Keep me', layout: DEFAULT_TEMPLATE_LAYOUT,
      createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z',
    }] } } },
  });
  assert.equal(SCHEMA_VERSION, 21);
  const migrated = state.guilds[GUILD_ID].messageTemplates.items[0];
  assert.equal(migrated.version, 2);
  assert.equal(migrated.content, 'Keep me');
  assert.deepEqual(migrated.controls, controls('none'));
  assert.deepEqual(normalizeState(state), state);

  const imported = parseTemplateDocument({ version: 1, content: 'Legacy import', layout: DEFAULT_TEMPLATE_LAYOUT, additionalContainers: [] });
  assert.equal(imported.version, TEMPLATE_VERSION);
  assert.deepEqual(imported.controls, controls('none'));
});

test('control normalization is deterministic, bounded, idempotent, and strips malformed fields', () => {
  const malformed = { items: [{
    id: 'template_source123', name: 'Source', version: 2, content: 'Hello', layout: DEFAULT_TEMPLATE_LAYOUT,
    controls: { type: 'button', secret: 'drop', buttons: Array.from({ length: 30 }, (_, index) => ({
      id: index < 2 ? 'duplicate_control' : `control_${String(index).padStart(8, '0')}`,
      label: '', style: 'Link', webhook: 'drop', action: { type: 'not_real', token: 'drop' },
    })), dropdown: { options: 'bad' } },
  }] };
  const first = normalizeMessageTemplatesConfig(malformed);
  const second = normalizeMessageTemplatesConfig(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(second, first);
  assert.equal(first.items[0].controls.buttons.length, 25);
  assert.equal(new Set(first.items[0].controls.buttons.map((entry) => entry.id)).size, 25);
  assert.equal(first.items[0].controls.buttons[0].style, 'Secondary');
  assert.deepEqual(first.items[0].controls.buttons[0].action, { type: 'send_message', templateId: '' });
  assert.equal(first.items[0].controls.secret, undefined);
  assert.equal(first.items[0].controls.buttons[0].webhook, undefined);
});

test('strict version-2 JSON accepts all actions and rejects unknown, malformed, mismatched, and excessive fields', () => {
  const { collection, channelTarget, dmTarget } = collectionWithTargets();
  const valid = {
    version: 2,
    content: 'Choose',
    layout: DEFAULT_TEMPLATE_LAYOUT,
    additionalContainers: [],
    controls: controls('button', [
      button('control_send123', 'send_message', channelTarget.id, { sortOrder: 0 }),
      button('control_give123', 'give_role', ROLE_A, { sortOrder: 1 }),
      button('control_remove1', 'remove_role', ROLE_B, { sortOrder: 2 }),
      button('control_dm12345', 'dm_message', dmTarget.id, { sortOrder: 3 }),
    ]),
  };
  const parsed = parseTemplateDocument(valid, { collection });
  assert.deepEqual(parsed.controls.buttons.map((entry) => entry.action.type), ['send_message', 'give_role', 'remove_role', 'dm_message']);
  assert.throws(() => parseTemplateDocument({ ...valid, controls: { ...valid.controls, unknown: true } }, { collection }), /Unknown controls field/);
  assert.throws(() => parseTemplateDocument({ ...valid, controls: controls('button', [{ ...valid.controls.buttons[0], style: 'Link' }]) }, { collection }), /Button style/);
  assert.throws(() => parseTemplateDocument({ ...valid, controls: controls('button', [{ ...valid.controls.buttons[0], action: { type: 'explode', templateId: channelTarget.id } }]) }, { collection }), /type is invalid/);
  assert.throws(() => parseTemplateDocument({ ...valid, controls: controls('button', [{ ...valid.controls.buttons[1], action: { type: 'give_role', roleId: ROLE_A, templateId: channelTarget.id } }]) }, { collection }), /Unknown controls button 1 action field/);
  assert.throws(() => parseTemplateDocument({ ...valid, controls: controls('button', [{ ...valid.controls.buttons[1], action: { type: 'give_role', roleId: 'bad' } }]) }, { collection }), /Discord ID/);
  assert.throws(() => parseTemplateDocument({ ...valid, controls: controls('button', [button('control_missing1', 'send_message', 'template_missing123')]) }, { collection }), /this server/);
  assert.throws(() => parseTemplateDocument({ ...valid, controls: controls('button', Array.from({ length: 26 }, (_, index) => button(`control_${String(index).padStart(8, '0')}`, 'give_role', ROLE_A, { sortOrder: index }))) }, { collection }), /up to 25/);
});

test('25 buttons serialize into rows of five with bounded provenance IDs and excessive total components are rejected', () => {
  const { collection, channelTarget } = collectionWithTargets();
  const buttons = Array.from({ length: 25 }, (_, index) => button(`control_${String(index).padStart(8, '0')}`, 'send_message', channelTarget.id, { sortOrder: index }));
  const source = createSource(collection, controls('button', buttons));
  const guild = { id: GUILD_ID, name: 'Garden', iconURL: () => null };
  const channel = { id: CHANNEL_ID };
  const payload = buildTemplatePayload(source, guild, channel);
  const rows = payload.components.filter((component) => component.type === 1);
  assert.deepEqual(rows.map((row) => row.components.length), [5, 5, 5, 5, 5]);
  for (const component of rows.flatMap((row) => row.components)) {
    assert.ok(component.custom_id.length <= 100);
    const parsed = parseTemplateControlCustomId(component.custom_id);
    assert.equal(parsed.guildId, GUILD_ID);
    assert.equal(parsed.type, 'button');
  }

  const dense = Array.from({ length: 2 }, (_, index) => ({
    content: `A{separator}B{separator}C{separator}D{separator}E`,
    layout: { ...DEFAULT_TEMPLATE_LAYOUT, accentColor: index ? '#123456' : '#654321' },
  }));
  assert.throws(() => createSource(collection, controls('button', buttons), { content: 'A{separator}B{separator}C{separator}D{separator}E', additionalContainers: dense }), /40-component limit/);
});

test('dropdown serialization supports 25 options and selected-option tokens only', () => {
  const { collection, channelTarget } = collectionWithTargets();
  const options = Array.from({ length: 25 }, (_, index) => option(`control_${String(index).padStart(8, '0')}`, 'send_message', channelTarget.id, { sortOrder: index, description: `Action ${index + 1}` }));
  const source = createSource(collection, controls('dropdown', options, { allowMultiple: true, placeholder: 'Run actions' }));
  const payload = buildTemplatePayload(source, { id: GUILD_ID, name: 'Garden', iconURL: () => null }, { id: CHANNEL_ID });
  const menu = payload.components.find((component) => component.type === 1).components[0];
  assert.equal(menu.options.length, 25);
  assert.equal(menu.max_values, 25);
  assert.equal(menu.custom_id, templateSelectCustomId(GUILD_ID, source));
  assert.deepEqual(menu.options.map((entry) => entry.value), source.controls.dropdown.options.map(templateOptionValue));
});

function runtimeFixture(collection, { initialRoles = [], dmFails = false, guildInteraction = true } = {}) {
  const sent = [];
  const dms = [];
  const operations = [];
  const responses = [];
  const memberRoles = new Set(initialRoles);
  const makeRole = (id, name) => ({ id, name, managed: false, editable: true, permissions: { has: () => false }, comparePositionTo: () => -1 });
  const roles = new Map([[ROLE_A, makeRole(ROLE_A, 'Artist')], [ROLE_B, makeRole(ROLE_B, 'Gamer')]]);
  const botMember = { permissions: { has: (flag) => flag === PermissionFlagsBits.ManageRoles }, roles: { highest: { id: 'bot-role' } } };
  const member = {
    id: MEMBER_ID,
    roles: {
      cache: { has: (id) => memberRoles.has(id) },
      add: async (role) => { operations.push(`add:${role.id}`); memberRoles.add(role.id); },
      remove: async (role) => { operations.push(`remove:${role.id}`); memberRoles.delete(role.id); },
    },
  };
  const channel = {
    id: CHANNEL_ID, name: 'general',
    isTextBased: () => true, isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => { sent.push(payload); return { id: '623456789012345678', url: 'https://discord.example/message' }; },
  };
  const guild = {
    id: GUILD_ID, name: 'Garden', iconURL: () => null,
    channels: { cache: new Map([[CHANNEL_ID, channel]]), fetch: async (id) => id === CHANNEL_ID ? channel : null },
    roles: { cache: roles, fetch: async () => roles },
    members: { me: botMember, fetchMe: async () => botMember, fetch: async () => member },
  };
  const user = {
    id: MEMBER_ID,
    send: async (payload) => { if (dmFails) throw new Error('closed'); dms.push(payload); return { id: '723456789012345678' }; },
  };
  const interaction = {
    guildId: guildInteraction ? GUILD_ID : null,
    guild: guildInteraction ? guild : null,
    channelId: guildInteraction ? CHANNEL_ID : '823456789012345678',
    channel: guildInteraction ? channel : { id: '823456789012345678' },
    client: { guilds: { cache: new Map([[GUILD_ID, guild]]), fetch: async () => guild } },
    user, member: guildInteraction ? member : null, customId: '', values: [], deferred: false, replied: false,
    deferReply: async (payload) => { interaction.deferred = true; responses.push({ defer: payload }); },
    editReply: async (payload) => { responses.push(payload); },
    reply: async (payload) => { interaction.replied = true; responses.push(payload); },
  };
  return {
    interaction, guild, channel, memberRoles, operations, responses, sent, dms,
    getGuildConfigRaw: () => ({ enabled: true, messageTemplates: collection }),
  };
}

test('send-message and successful DM actions reuse full template payloads without chaining actions', async () => {
  const { collection, channelTarget, dmTarget } = collectionWithTargets();
  updateTemplate(collection, dmTarget.id, {
    document: { ...templateDocument(dmTarget), controls: controls('button', [button('control_nested12', 'send_message', channelTarget.id)]) },
  }, '2026-09-01T00:00:30Z');
  const source = createSource(collection, controls('dropdown', [
    option('control_send123', 'send_message', channelTarget.id, { sortOrder: 0 }),
    option('control_dm12345', 'dm_message', dmTarget.id, { sortOrder: 1 }),
  ], { allowMultiple: true }));
  const fixture = runtimeFixture(collection);
  fixture.interaction.customId = templateSelectCustomId(GUILD_ID, source);
  fixture.interaction.values = source.controls.dropdown.options.map(templateOptionValue);
  assert.equal(await handleMessageTemplateInteraction(fixture.interaction, { getGuildConfigRaw: fixture.getGuildConfigRaw, log: () => {} }), true);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.dms.length, 1);
  assert.deepEqual(fixture.sent[0].allowedMentions, { parse: [], users: [], roles: [] });
  assert.deepEqual(fixture.dms[0].allowedMentions, { parse: [], users: [], roles: [] });
  const dmButton = fixture.dms[0].components.find((component) => component.type === 1).components[0];
  assert.equal(parseTemplateControlCustomId(dmButton.custom_id).guildId, GUILD_ID);
  assert.equal(fixture.sent.length, 1, 'nested DM controls are delivered but not automatically executed');
  assert.match(fixture.responses.at(-1).content, /Completed 2 of 2 actions/);
});

test('DM failures are friendly and multi-select actions report partial success sequentially', async () => {
  const { collection, channelTarget, dmTarget } = collectionWithTargets();
  const source = createSource(collection, controls('dropdown', [
    option('control_send123', 'send_message', channelTarget.id, { sortOrder: 0 }),
    option('control_dm12345', 'dm_message', dmTarget.id, { sortOrder: 1 }),
  ], { allowMultiple: true }));
  const fixture = runtimeFixture(collection, { dmFails: true });
  fixture.interaction.customId = templateSelectCustomId(GUILD_ID, source);
  fixture.interaction.values = source.controls.dropdown.options.map(templateOptionValue);
  await handleMessageTemplateInteraction(fixture.interaction, { getGuildConfigRaw: fixture.getGuildConfigRaw, log: () => {} });
  assert.equal(fixture.sent.length, 1);
  assert.match(fixture.responses.at(-1).content, /Completed 1 of 2 actions/);
  assert.match(fixture.responses.at(-1).content, /direct messages may be closed/);
});

test('give/remove role actions are safe and idempotent, including controls clicked in DMs', async () => {
  const { collection } = collectionWithTargets();
  const source = createSource(collection, controls('dropdown', [
    option('control_give123', 'give_role', ROLE_A, { sortOrder: 0 }),
    option('control_remove1', 'remove_role', ROLE_B, { sortOrder: 1 }),
  ], { allowMultiple: true }));
  const fixture = runtimeFixture(collection, { initialRoles: [ROLE_A], guildInteraction: false });
  fixture.interaction.customId = templateSelectCustomId(GUILD_ID, source);
  fixture.interaction.values = source.controls.dropdown.options.map(templateOptionValue);
  const parsed = parseTemplateControlCustomId(fixture.interaction.customId);
  assert.equal(parsed.guildId, GUILD_ID);
  await handleMessageTemplateInteraction(fixture.interaction, { getGuildConfigRaw: fixture.getGuildConfigRaw, log: () => {} });
  assert.deepEqual(fixture.operations, []);
  assert.match(fixture.responses.at(-1).content, /already assigned/);
  assert.match(fixture.responses.at(-1).content, /already removed/);

  const addAndRemove = runtimeFixture(collection, { initialRoles: [ROLE_B] });
  addAndRemove.interaction.customId = templateSelectCustomId(GUILD_ID, source);
  addAndRemove.interaction.values = source.controls.dropdown.options.map(templateOptionValue);
  await handleMessageTemplateInteraction(addAndRemove.interaction, { getGuildConfigRaw: addAndRemove.getGuildConfigRaw, log: () => {} });
  assert.deepEqual(addAndRemove.operations, [`add:${ROLE_A}`, `remove:${ROLE_B}`]);

  const unsafe = runtimeFixture(collection);
  unsafe.guild.roles.cache.get(ROLE_A).permissions.has = (flag) => flag === PermissionFlagsBits.Administrator;
  unsafe.interaction.customId = templateSelectCustomId(GUILD_ID, source);
  unsafe.interaction.values = [templateOptionValue(source.controls.dropdown.options[0])];
  await handleMessageTemplateInteraction(unsafe.interaction, { getGuildConfigRaw: unsafe.getGuildConfigRaw, log: () => {} });
  assert.deepEqual(unsafe.operations, []);
  assert.match(unsafe.responses.at(-1).content, /Administrator roles/);
});

test('unknown, tampered, removed, stale, missing, and disabled controls fail without actions', async () => {
  const { collection, channelTarget } = collectionWithTargets();
  const source = createSource(collection, controls('button', [button('control_send123', 'send_message', channelTarget.id)]));
  const customId = templateButtonCustomId(GUILD_ID, source, source.controls.buttons[0]);

  const tampered = runtimeFixture(collection);
  tampered.interaction.customId = `${customId.slice(0, -1)}${customId.endsWith('a') ? 'b' : 'a'}`;
  await handleMessageTemplateInteraction(tampered.interaction, { getGuildConfigRaw: tampered.getGuildConfigRaw, log: () => {} });
  assert.match(tampered.responses.at(-1).content, /stale|removed/);
  assert.equal(tampered.sent.length, 0);

  const removedCollection = normalizeMessageTemplatesConfig(collection);
  removedCollection.items.find((item) => item.id === source.id).controls.buttons = [];
  const removed = runtimeFixture(removedCollection);
  removed.interaction.customId = customId;
  await handleMessageTemplateInteraction(removed.interaction, { getGuildConfigRaw: removed.getGuildConfigRaw, log: () => {} });
  assert.match(removed.responses.at(-1).content, /stale|removed/);

  const missingCollection = normalizeMessageTemplatesConfig(collection);
  missingCollection.items = missingCollection.items.filter((item) => item.id !== channelTarget.id);
  const missingSource = missingCollection.items.find((item) => item.id === source.id);
  assert.doesNotThrow(() => updateTemplate(missingCollection, missingSource.id, { name: 'Still valid', document: templateDocument(missingSource) }, '2026-09-01T02:00:00Z'));
  assert.doesNotThrow(() => duplicateTemplate(missingCollection, missingSource.id, '2026-09-01T02:01:00Z'));
  const missing = runtimeFixture(missingCollection);
  missing.interaction.customId = templateButtonCustomId(GUILD_ID, missingSource, missingSource.controls.buttons[0]);
  await handleMessageTemplateInteraction(missing.interaction, { getGuildConfigRaw: missing.getGuildConfigRaw, log: () => {} });
  assert.match(missing.responses.at(-1).content, /no longer exists/);

  const disabledCollection = normalizeMessageTemplatesConfig(collection);
  disabledCollection.items.find((item) => item.id === channelTarget.id).enabled = false;
  const disabledSource = disabledCollection.items.find((item) => item.id === source.id);
  const disabled = runtimeFixture(disabledCollection);
  disabled.interaction.customId = templateButtonCustomId(GUILD_ID, disabledSource, disabledSource.controls.buttons[0]);
  await handleMessageTemplateInteraction(disabled.interaction, { getGuildConfigRaw: disabled.getGuildConfigRaw, log: () => {} });
  assert.match(disabled.responses.at(-1).content, /disabled/);
});

test('dropdown rejects unknown selections before running any selected action', async () => {
  const { collection, channelTarget } = collectionWithTargets();
  const source = createSource(collection, controls('dropdown', [option('control_send123', 'send_message', channelTarget.id)], { allowMultiple: true }));
  const fixture = runtimeFixture(collection);
  fixture.interaction.customId = templateSelectCustomId(GUILD_ID, source);
  fixture.interaction.values = [templateOptionValue(source.controls.dropdown.options[0]), 'tampered_option'];
  await handleMessageTemplateInteraction(fixture.interaction, { getGuildConfigRaw: fixture.getGuildConfigRaw, log: () => {} });
  assert.equal(fixture.sent.length, 0);
  assert.match(fixture.responses.at(-1).content, /No actions were run/);
});

test('duplicating a template regenerates control IDs while preserving configured actions', () => {
  const { collection, channelTarget } = collectionWithTargets();
  const source = createSource(collection, controls('button', [button('control_send123', 'send_message', channelTarget.id)]));
  const duplicate = duplicateTemplate(collection, source.id, '2026-09-01T01:00:00Z');
  assert.notEqual(duplicate.controls.buttons[0].id, source.controls.buttons[0].id);
  assert.deepEqual(duplicate.controls.buttons[0].action, source.controls.buttons[0].action);
  assert.notEqual(templateButtonCustomId(GUILD_ID, duplicate, duplicate.controls.buttons[0]), templateButtonCustomId(GUILD_ID, source, source.controls.buttons[0]));
  assert.deepEqual(templateDocument(duplicate).controls, duplicate.controls);
});

test('dashboard exposes controls, accessible gear settings, JSON round-trip, and resolved preview hooks', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'admin', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'admin', 'style.css'), 'utf8');
  assert.match(html, /data-template-tab="controls"/);
  assert.match(html, /id="templateControlPreview"/);
  assert.match(html, /id="templateActionDialog"[\s\S]*aria-labelledby="templateActionTitle"/);
  assert.match(html, /id="templateActionTarget"[\s\S]*id="templateActionSave"/);
  assert.match(app, /aria-label="Configure action for/);
  assert.match(app, /controls: normalizeTemplateControlsClient/);
  assert.match(app, /state\.templateDraft\.controls = documentValue\.controls/);
  assert.match(app, /resolvedTemplatePayloadPreview[\s\S]*custom_id/);
  assert.match(app, /Only selected options run their configured actions/);
  assert.match(css, /\.template-control-row\.incomplete/);
  assert.match(css, /\.template-action-dialog/);
});
