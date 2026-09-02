const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-message-templates-'));
process.env.SERVER_CONFIG_STORE_PATH = path.join(temporary, 'server-config.json');
process.env.ADMIN_SESSION_STORE_PATH = path.join(temporary, 'admin-sessions.json');

const {
  DEFAULT_GUILD_CONFIG,
  DEFAULT_MESSAGE_TEMPLATES_CONFIG,
  SCHEMA_VERSION,
  getGuildConfigRaw,
  normalizeState,
} = require('../src/serverConfig');
const {
  DEFAULT_TEMPLATE_LAYOUT,
  MESSAGE_TEMPLATE_LIMITS,
  buildTemplatePayload,
  createFolder,
  createTemplate,
  deleteFolder,
  deleteTemplate,
  duplicateTemplate,
  normalizeMessageTemplatesConfig,
  parseTemplateDocument,
  renameFolder,
  sendTemplate,
  templateDocument,
  unresolvedVariables,
  updateTemplate,
} = require('../src/messageTemplates');
const { createAdminRequestHandler, safeOAuthReturnTo } = require('../src/adminServer');

const GUILD_A = '123456789012345678';
const GUILD_B = '223456789012345678';
const ADMIN_ID = '323456789012345678';
const NON_ADMIN_ID = '423456789012345678';
const CHANNEL_ID = '523456789012345678';
const sessionSecret = 'message-template-test-secret';
const csrfToken = 'message-template-csrf';

function newCollection() {
  return normalizeMessageTemplatesConfig();
}

function newTemplate(collection, overrides = {}, now = '2026-08-31T00:00:00.000Z') {
  return createTemplate(collection, {
    name: 'Welcome card',
    content: '## Welcome to {server}!\nPosted in {channel}.',
    layout: DEFAULT_TEMPLATE_LAYOUT,
    ...overrides,
  }, now);
}

test('schema 20 preserves existing configuration while upgrading Message Templates to schema 22', () => {
  const state = normalizeState({
    meta: { schemaVersion: 17, disabledGuilds: {} },
    guilds: {
      [GUILD_A]: {
        enabled: true,
        memberMessages: { enabled: false },
        leveling: { enabled: false, xp: { min: 22, max: 44, cooldownSeconds: 90 } },
      },
    },
  });
  assert.equal(SCHEMA_VERSION, 22);
  assert.deepEqual(DEFAULT_GUILD_CONFIG.messageTemplates, DEFAULT_MESSAGE_TEMPLATES_CONFIG);
  assert.deepEqual(state.guilds[GUILD_A].messageTemplates, { folders: [], items: [] });
  assert.equal(state.guilds[GUILD_A].leveling.xp.min, 22);
  assert.equal(state.guilds[GUILD_A].memberMessages.enabled, false);
});

test('malformed template storage normalizes idempotently with unique stable IDs and safe fields', () => {
  const malformed = {
    folders: [
      { id: 'duplicate_id', name: '  Alerts  ', extra: 'drop' },
      { id: 'duplicate_id', name: 'Also alerts' },
      { id: '../unsafe', name: '' },
    ],
    items: [
      {
        id: 'duplicate_template', folderId: 'duplicate_id', name: '  Launch  ', description: 'x'.repeat(800),
        content: `Hello${'{separator}'.repeat(10)}world`, defaultChannelId: 'bad', enabled: false,
        layout: { accentColor: '#GGGGGG', thumbnailEnabled: true, thumbnailUrl: 'javascript:alert(1)', galleryUrls: ['https://example.com/a.png', 'file:///secret', 'https://example.com/a.png'] },
        createdAt: 'invalid', updatedAt: 'invalid', ownerToken: 'secret',
      },
      { id: 'duplicate_template', name: 'Second', layout: {} },
    ],
  };
  const first = normalizeMessageTemplatesConfig(malformed);
  const second = normalizeMessageTemplatesConfig(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(second, first);
  assert.equal(new Set(first.folders.map((folder) => folder.id)).size, 3);
  assert.equal(new Set(first.items.map((item) => item.id)).size, 2);
  assert.equal(first.items[0].folderId, first.folders[0].id);
  assert.equal(first.items[0].description.length, MESSAGE_TEMPLATE_LIMITS.description);
  assert.equal((first.items[0].content.match(/\{separator\}/g) || []).length, 4);
  assert.equal(first.items[0].layout.thumbnailUrl, '');
  assert.deepEqual(first.items[0].layout.galleryUrls, ['https://example.com/a.png']);
  assert.equal(first.items[0].ownerToken, undefined);
  assert.equal(first.items[0].createdAt, '1970-01-01T00:00:00.000Z');
});

test('folder CRUD validates names and deleting a folder moves templates to Unfiled', () => {
  const collection = newCollection();
  const folder = createFolder(collection, { name: '  Onboarding  ' }, '2026-08-31T01:00:00Z');
  assert.equal(folder.name, 'Onboarding');
  const item = newTemplate(collection, { folderId: folder.id });
  assert.equal(item.folderId, folder.id);
  renameFolder(collection, folder.id, { name: 'Community' }, '2026-08-31T02:00:00Z');
  assert.equal(collection.folders[0].name, 'Community');
  const deleted = deleteFolder(collection, folder.id, '2026-08-31T03:00:00Z');
  assert.equal(deleted.moved, 1);
  assert.equal(collection.folders.length, 0);
  assert.equal(item.folderId, null);
  assert.equal(item.updatedAt, '2026-08-31T03:00:00.000Z');
  assert.throws(() => createFolder(collection, { name: '   ' }), /required/);
});

test('template create, update, move, duplicate, and delete use stable IDs and server timestamps', () => {
  const collection = newCollection();
  const one = createFolder(collection, { name: 'One' }, '2026-08-31T00:00:00Z');
  const two = createFolder(collection, { name: 'Two' }, '2026-08-31T00:00:00Z');
  const item = newTemplate(collection, { folderId: one.id }, '2026-08-31T01:00:00Z');
  assert.match(item.id, /^template_[a-f0-9-]{36}$/);
  const createdAt = item.createdAt;
  updateTemplate(collection, item.id, {
    name: 'Launch announcement', folderId: two.id, description: 'Ready to ship', enabled: false,
    defaultChannelId: CHANNEL_ID,
    document: { version: 1, content: 'Ship at {timestamp}', layout: { ...DEFAULT_TEMPLATE_LAYOUT, container: false } },
  }, '2026-08-31T02:00:00Z');
  assert.equal(item.createdAt, createdAt);
  assert.equal(item.updatedAt, '2026-08-31T02:00:00.000Z');
  assert.equal(item.folderId, two.id);
  assert.equal(item.content, 'Ship at {timestamp}');
  const copy = duplicateTemplate(collection, item.id, '2026-08-31T03:00:00Z');
  assert.notEqual(copy.id, item.id);
  assert.equal(copy.name, 'Launch announcement copy');
  assert.deepEqual(templateDocument(copy), templateDocument(item));
  assert.equal(deleteTemplate(collection, item.id).id, item.id);
  assert.deepEqual(collection.items.map((entry) => entry.id), [copy.id]);
  assert.throws(() => updateTemplate(collection, copy.id, { updatedAt: 'client supplied' }), /Unknown template update field/);
});

test('strict JSON accepts the versioned document and rejects unknown, unsafe, and over-limit fields', () => {
  const document = parseTemplateDocument({
    version: 1,
    content: '## Welcome {server}',
    layout: { container: true, accentColor: '#B9F547', thumbnailEnabled: true, thumbnailUrl: '{server_icon}', galleryUrls: ['https://example.com/one.png'] },
    additionalContainers: [{
      content: 'Second block in {channel}',
      layout: { container: false, accentColor: '#123456', thumbnailEnabled: false, thumbnailUrl: '', galleryUrls: [] },
    }],
  });
  assert.equal(document.layout.accentColor, '#b9f547');
  assert.equal(document.additionalContainers[0].layout.container, true);
  assert.throws(() => parseTemplateDocument({ ...document, webhookToken: 'secret' }), /Unknown template json field/i);
  assert.throws(() => parseTemplateDocument({ ...document, layout: { ...document.layout, script: '<script>' } }), /Unknown layout field/);
  assert.throws(() => parseTemplateDocument({ ...document, layout: { ...document.layout, thumbnailUrl: 'javascript:alert(1)' } }), /Thumbnail must/);
  assert.throws(() => parseTemplateDocument({ ...document, content: 'x'.repeat(4001) }), /4000/);
  assert.throws(() => parseTemplateDocument({ ...document, content: '{separator}'.repeat(5) }), /up to 4/);
  assert.throws(() => parseTemplateDocument({ ...document, additionalContainers: Array(3).fill(document.additionalContainers[0]) }), /up to 2 additional containers/);
  assert.throws(() => createTemplate(newCollection(), { name: 'Unsafe', unknown: true }), /Unknown template field/);
});

test('folder and template limits are enforced without partial writes', () => {
  const folders = newCollection();
  for (let index = 0; index < MESSAGE_TEMPLATE_LIMITS.folders; index += 1) createFolder(folders, { name: `Folder ${index}` });
  assert.throws(() => createFolder(folders, { name: 'Overflow' }), /up to 50/);
  assert.equal(folders.folders.length, 50);

  const templates = newCollection();
  for (let index = 0; index < MESSAGE_TEMPLATE_LIMITS.templates; index += 1) newTemplate(templates, { name: `Template ${index}` });
  assert.throws(() => newTemplate(templates, { name: 'Overflow' }), /up to 100/);
  assert.equal(templates.items.length, 100);
});

function sendFixture({ permissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], type = ChannelType.GuildText } = {}) {
  const sent = [];
  const permissionSet = new Set(permissions);
  const botMember = { id: '623456789012345678' };
  const channel = {
    id: CHANNEL_ID, name: 'announcements', type,
    isTextBased: () => true, isThread: () => false,
    permissionsFor: () => ({ has: (flag) => permissionSet.has(flag) }),
    send: async (payload) => {
      sent.push(payload);
      return { id: '723456789012345678', url: 'https://discord.com/channels/example/message' };
    },
  };
  const guild = {
    id: GUILD_A, name: 'Sprite Garden', iconURL: () => 'https://cdn.example/server.png',
    channels: { cache: new Map([[CHANNEL_ID, channel]]), fetch: async (id) => (id === CHANNEL_ID ? channel : null) },
    members: { me: botMember, fetchMe: async () => botMember },
  };
  return { channel, guild, sent };
}

test('generic variables and Components V2 payloads resolve with safe mentions and media', () => {
  const collection = newCollection();
  const item = newTemplate(collection, {
    content: '{server} in {channel} at {timestamp}{separator}No pings <@&123456789012345678>',
    layout: { ...DEFAULT_TEMPLATE_LAYOUT, thumbnailEnabled: true, thumbnailUrl: '{server_icon}', galleryUrls: ['https://example.com/gallery.png'] },
    additionalContainers: [{
      content: 'More news for {server}',
      layout: { ...DEFAULT_TEMPLATE_LAYOUT, accentColor: '#123456', thumbnailEnabled: true, thumbnailUrl: 'https://example.com/extra.png', galleryUrls: ['https://example.com/extra-gallery.png'] },
    }],
  });
  const { channel, guild } = sendFixture();
  const payload = buildTemplatePayload(item, guild, channel, { nowMs: 1_700_000_000_000 });
  assert.equal(payload.flags, 32768);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: [] });
  assert.equal(payload.components[0].type, 17);
  assert.equal(payload.components[0].components[0].type, 9);
  assert.match(payload.components[0].components[0].components[0].content, /Sprite Garden in <#523456789012345678> at <t:1700000000:F>/);
  assert.ok(payload.components[0].components.some((component) => component.type === 14));
  assert.equal(payload.components[0].components.at(-1).type, 12);
  assert.equal(payload.components[1].type, 17);
  assert.equal(payload.components[1].accent_color, 0x123456);
  assert.match(payload.components[1].components[0].components[0].content, /More news for Sprite Garden/);
  assert.doesNotMatch(JSON.stringify(payload), /"description"/);
});

test('unresolved context variables block direct sending but remain preserved for feature snapshots', () => {
  const collection = newCollection();
  const item = newTemplate(collection, {
    content: 'Congrats {user} on level {level}',
    layout: { ...DEFAULT_TEMPLATE_LAYOUT, thumbnailEnabled: true, thumbnailUrl: '{user_profile}' },
  });
  assert.deepEqual(unresolvedVariables(item), ['user', 'level', 'user_profile']);
  const { channel, guild } = sendFixture();
  assert.throws(() => buildTemplatePayload(item, guild, channel), /Resolve context-specific variables.*\{user\}.*\{level\}.*\{user_profile\}/);
  assert.equal(templateDocument(item).content, 'Congrats {user} on level {level}');
  assert.equal(templateDocument(item).layout.thumbnailUrl, '{user_profile}');
});

test('test and normal delivery recheck channels and Discord permissions', async () => {
  const collection = newCollection();
  const item = newTemplate(collection, { defaultChannelId: CHANNEL_ID });
  const allowed = sendFixture();
  const testSend = await sendTemplate(item, allowed.guild, { test: true });
  assert.equal(allowed.sent.length, 1);
  assert.doesNotMatch(JSON.stringify(testSend.payload), /TEST MESSAGE/);
  assert.match(testSend.payload.components[0].components[0].content, /Welcome to Sprite Garden/);
  assert.deepEqual(testSend.payload.allowedMentions, { parse: [], users: [], roles: [] });
  await sendTemplate(item, allowed.guild, { test: false });
  assert.equal(allowed.sent.length, 2);

  const denied = sendFixture({ permissions: [PermissionFlagsBits.ViewChannel] });
  await assert.rejects(() => sendTemplate(item, denied.guild), (error) => error.code === 'MISSING_PERMISSIONS' && /SendMessages/.test(error.message));
  assert.equal(denied.sent.length, 0);
  const forum = sendFixture({ type: ChannelType.GuildForum });
  await assert.rejects(() => sendTemplate(item, forum.guild), (error) => error.code === 'MISSING_CHANNEL');
});

function signedSession(raw, userId, token = csrfToken) {
  const signature = crypto.createHmac('sha256', sessionSecret).update(raw).digest('base64url');
  const id = `${raw}.${signature}`;
  return {
    id,
    record: { createdAt: Date.now(), expiresAt: Date.now() + 60_000, csrfToken: token, oauthState: null, user: { id: userId, username: 'Tester', globalName: 'Tester', avatar: null } },
  };
}

async function withAdminServer(run) {
  const admin = signedSession('templates-admin-session', ADMIN_ID);
  const nonAdmin = signedSession('templates-non-admin-session', NON_ADMIN_ID);
  fs.writeFileSync(process.env.ADMIN_SESSION_STORE_PATH, JSON.stringify({ sessions: { [admin.id]: admin.record, [nonAdmin.id]: nonAdmin.record } }));
  fs.writeFileSync(process.env.SERVER_CONFIG_STORE_PATH, JSON.stringify(normalizeState({
    meta: { schemaVersion: SCHEMA_VERSION, disabledGuilds: {} },
    guilds: { [GUILD_A]: {}, [GUILD_B]: {} },
  })));

  const sends = [];
  const botMember = { id: '823456789012345678', permissions: { has: () => true } };
  const channel = {
    id: CHANNEL_ID, name: 'announcements', type: ChannelType.GuildText,
    isTextBased: () => true, isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => { sends.push(payload); return { id: '923456789012345678', url: 'https://discord.com/channels/guild/channel/message' }; },
  };
  const guild = (id) => ({
    id, name: `Guild ${id}`, iconURL: () => null,
    channels: { cache: new Map([[CHANNEL_ID, channel]]), fetch: async (channelId) => channelId === CHANNEL_ID ? channel : null },
    members: {
      me: botMember, fetchMe: async () => botMember,
      fetch: async (userId) => ({ permissions: { has: (flag) => userId === ADMIN_ID && flag === PermissionFlagsBits.Administrator } }),
    },
  });
  const guilds = new Map([[GUILD_A, guild(GUILD_A)], [GUILD_B, guild(GUILD_B)]]);
  const client = { guilds: { cache: guilds, fetch: async (id) => guilds.get(id) || null }, application: { owner: { id: '000000000000000000' } }, user: { id: botMember.id } };
  const env = { sessionSecret, cookieSecure: false, publicOrigin: 'http://127.0.0.1', redirectUri: 'http://127.0.0.1/auth/discord/callback', host: '127.0.0.1', port: 0 };
  const server = http.createServer(createAdminRequestHandler(env, client));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (pathname, options = {}) => fetch(`${origin}${pathname}`, {
    ...options,
    headers: { ...(options.cookie ? { Cookie: `coinsprite_admin=${options.cookie}` } : {}), ...(options.headers || {}) },
  });
  try { await run({ admin, nonAdmin, request, sends }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('template APIs enforce authentication, Administrator permission, CSRF, and guild isolation', async () => {
  await withAdminServer(async ({ admin, nonAdmin, request }) => {
    assert.equal((await request(`/api/guilds/${GUILD_A}/message-templates`)).status, 401);
    assert.equal((await request(`/api/guilds/${GUILD_A}/message-templates`, { cookie: nonAdmin.id })).status, 403);
    assert.equal((await request(`/api/guilds/${GUILD_A}/message-templates`, {
      method: 'POST', cookie: admin.id, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'No CSRF' }),
    })).status, 403);

    const created = await request(`/api/guilds/${GUILD_A}/message-templates`, {
      method: 'POST', cookie: admin.id,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ name: 'Guild A only', content: 'Hello {server}', layout: DEFAULT_TEMPLATE_LAYOUT }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.messageTemplates.items.length, 1);

    const guildB = await request(`/api/guilds/${GUILD_B}/message-templates`, { cookie: admin.id });
    assert.equal(guildB.status, 200);
    assert.equal((await guildB.json()).messageTemplates.items.length, 0);
    assert.equal(getGuildConfigRaw(GUILD_A).messageTemplates.items.length, 1);
    assert.equal(getGuildConfigRaw(GUILD_B).messageTemplates.items.length, 0);
  });
});

test('template send API requires confirmation and returns a safe message link', async () => {
  await withAdminServer(async ({ admin, request, sends }) => {
    const create = await request(`/api/guilds/${GUILD_A}/message-templates`, {
      method: 'POST', cookie: admin.id,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ name: 'Send me', defaultChannelId: CHANNEL_ID, content: 'Hello {server}', layout: DEFAULT_TEMPLATE_LAYOUT }),
    });
    const item = (await create.json()).item;
    const unconfirmed = await request(`/api/guilds/${GUILD_A}/message-templates/${item.id}/send`, {
      method: 'POST', cookie: admin.id,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ mode: 'send', channelId: CHANNEL_ID }),
    });
    assert.equal(unconfirmed.status, 400);
    assert.equal(sends.length, 0);
    const confirmed = await request(`/api/guilds/${GUILD_A}/message-templates/${item.id}/send`, {
      method: 'POST', cookie: admin.id,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ mode: 'send', channelId: CHANNEL_ID, confirm: true }),
    });
    assert.equal(confirmed.status, 201);
    assert.equal((await confirmed.json()).messageUrl, 'https://discord.com/channels/guild/channel/message');
    assert.deepEqual(sends[0].allowedMentions, { parse: [], users: [], roles: [] });
  });
});

test('authenticated deep links are bounded and the dashboard wires all snapshot destinations', () => {
  const id = 'template_12345678';
  assert.equal(safeOAuthReturnTo(`/admin?guild=${GUILD_A}&view=message-templates&template=${id}&folder=folder_12345678`), `/admin?guild=${GUILD_A}&view=message-templates&template=${id}&folder=folder_12345678`);
  assert.equal(safeOAuthReturnTo('https://evil.example/admin?view=message-templates'), '/admin');
  assert.equal(safeOAuthReturnTo('/admin?guild=bad&view=owner&token=secret'), '/admin');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'admin', 'app.js'), 'utf8');
  assert.match(html, /data-view="message-templates"/);
  assert.match(html, /data-template-tab="editor"[\s\S]*data-template-tab="controls"[\s\S]*data-template-tab="json"[\s\S]*data-template-tab="settings"[\s\S]*data-template-tab="share"/);
  assert.match(html, /id="levelingUseTemplate"[\s\S]*id="levelingSaveAsTemplate"/);
  assert.match(html, /id="welcomeUseTemplate"[\s\S]*id="welcomeSaveAsTemplate"/);
  assert.match(html, /id="levelingAdditionalContainerAdd"[\s\S]*id="welcomeAdditionalContainerAdd"[\s\S]*id="templateAdditionalContainerAdd"/);
  assert.doesNotMatch(html, /id="template(?:Reset|Save)Button"/);
  assert.match(app, /state\.currentView === 'message-templates'[\s\S]*saveMessageTemplate/);
  assert.match(app, /templateMode \|\| reactionMode \? 'Save changes' : 'Apply changes'/);
  assert.match(app, /state\.config\.leveling\.announcements\.template = item\.content/);
  assert.match(app, /announcements\.additionalContainers = clone\(item\.additionalContainers\)/);
  assert.match(app, /const event = currentMemberMessage\(\);[\s\S]*event\.template = item\.content/);
  assert.match(app, /MEMBER_MESSAGE_EVENT_VARIABLES\[state\.memberMessageEvent\]/);
  assert.match(app, /deepLink\.get\('template'\)/);
  assert.match(app, /allowedMentions: \{ parse: \[\], users: \[\], roles: \[\] \}/);
});
