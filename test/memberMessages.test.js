const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { MessageType, PermissionFlagsBits } = require('discord.js');

const {
  DEFAULT_MEMBER_MESSAGES_CONFIG,
  normalizeMemberMessagesConfig,
  normalizeState,
} = require('../src/serverConfig');
const {
  handleBoostSystemMessage,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  handleGuildMemberUpdate,
  interpolateTemplate,
  memberMessageValues,
  resetBoostDeduplication,
  sendMemberMessage,
} = require('../src/memberMessages');

const GUILD_ID = '123456789012345678';
const USER_ID = '223456789012345678';
const CHANNEL_ID = '323456789012345678';

function eventConfig(overrides = {}) {
  return {
    enabled: true,
    channelId: CHANNEL_ID,
    template: 'Hello {user} in {server}',
    layout: {
      container: true,
      accentColor: '#57f287',
      thumbnailEnabled: false,
      thumbnailUrl: '',
      galleryUrls: [],
    },
    ...overrides,
  };
}

function memberConfig(overrides = {}) {
  return {
    enabled: true,
    join: eventConfig(),
    leave: eventConfig({ template: 'Goodbye {display_name}' }),
    boost: eventConfig({ template: 'Thanks {user}: {boost_count}/{boost_level}' }),
    ...overrides,
  };
}

function fixture({ allowed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], config = memberConfig() } = {}) {
  const sends = [];
  const permissionSet = new Set(allowed);
  const botMember = { id: '423456789012345678' };
  const channel = {
    id: CHANNEL_ID,
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: (flag) => permissionSet.has(flag) }),
    send: async (payload) => { sends.push(payload); return payload; },
  };
  const guild = {
    id: GUILD_ID,
    name: 'Sprite Garden',
    memberCount: 42,
    premiumSubscriptionCount: 7,
    premiumTier: 2,
    iconURL: () => 'https://cdn.example/server.png',
    channels: { cache: new Map([[CHANNEL_ID, channel]]), fetch: async (id) => (id === CHANNEL_ID ? channel : null) },
    members: { me: botMember, cache: new Map(), fetchMe: async () => botMember },
  };
  const member = {
    id: USER_ID,
    guild,
    displayName: 'Garden Hero',
    joinedTimestamp: 1_700_000_000_000,
    premiumSinceTimestamp: 1_710_000_000_000,
    user: {
      id: USER_ID,
      username: 'GardenHero',
      globalName: 'Garden Hero',
      createdTimestamp: 1_600_000_000_000,
      displayAvatarURL: () => 'https://cdn.example/avatar.png',
    },
  };
  guild.members.cache.set(USER_ID, member);
  guild.members.fetch = async (id) => guild.members.cache.get(id) || null;
  return { channel, config, guild, member, sends };
}

test('Welcome Messages defaults and normalization are backward compatible and strict', () => {
  const defaults = normalizeMemberMessagesConfig();
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.join.enabled, false);
  assert.equal(defaults.join.template, DEFAULT_MEMBER_MESSAGES_CONFIG.join.template);
  assert.equal(defaults.leave.layout.accentColor, '#ed4245');
  assert.equal(defaults.boost.layout.accentColor, '#f47fff');

  const normalized = normalizeMemberMessagesConfig({
    enabled: false,
    join: {
      enabled: true,
      channelId: 'invalid',
      template: 'x'.repeat(5000),
      layout: {
        accentColor: '#GGGGGG', thumbnailEnabled: true, thumbnailUrl: 'javascript:alert(1)',
        galleryUrls: ['https://example.com/one.png', '{user_avatar}', 'file:///secret', ...Array(20).fill('https://example.com/one.png')],
      },
      unknown: 'discard me',
    },
  });
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.join.channelId, '');
  assert.equal(normalized.join.template.length, 3000);
  assert.equal(normalized.join.layout.accentColor, '#57f287');
  assert.equal(normalized.join.layout.thumbnailUrl, '');
  assert.deepEqual(normalized.join.layout.galleryUrls, ['https://example.com/one.png', '{user_avatar}']);
  assert.equal(normalized.join.unknown, undefined);
});

test('all three Welcome Messages event configs survive a state serialization round trip', () => {
  const configured = memberConfig({
    join: eventConfig({ template: 'Join {account_age}', layout: { ...eventConfig().layout, accentColor: '#112233', galleryUrls: ['https://example.com/join.png'] } }),
    leave: eventConfig({ channelId: '523456789012345678', template: 'Leave {time_in_server}' }),
    boost: eventConfig({ channelId: '623456789012345678', template: 'Boost {boost_count}', layout: { ...eventConfig().layout, thumbnailEnabled: true, thumbnailUrl: '{server_icon}' } }),
  });
  const first = normalizeState({ meta: { schemaVersion: 17 }, guilds: { [GUILD_ID]: { memberMessages: configured } } });
  const second = normalizeState(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(second.guilds[GUILD_ID].memberMessages, first.guilds[GUILD_ID].memberMessages);
  assert.equal(second.guilds[GUILD_ID].memberMessages.leave.channelId, '523456789012345678');
  assert.equal(second.guilds[GUILD_ID].memberMessages.boost.layout.thumbnailUrl, '{server_icon}');
});

test('join, leave, and boost placeholders interpolate with stable missing-value fallbacks', () => {
  const { member } = fixture();
  const join = memberMessageValues('join', member, { channelId: CHANNEL_ID, nowMs: 1_720_000_000_000 });
  const leave = memberMessageValues('leave', member, { channelId: CHANNEL_ID, nowMs: 1_720_000_000_000 });
  const boost = memberMessageValues('boost', member, { channelId: CHANNEL_ID, nowMs: 1_720_000_000_000 });
  assert.equal(interpolateTemplate('{user}|{username}|{display_name}|{account_age}|{unknown}', join), '<@223456789012345678>|GardenHero|Garden Hero|3 years|{unknown}');
  assert.equal(interpolateTemplate('{joined_at}|{time_in_server}', leave), '<t:1700000000:F>|7 months');
  assert.equal(interpolateTemplate('{boost_count}|{boost_level}|{boost_since}', boost), '7|2|<t:1710000000:F>');

  const missing = memberMessageValues('leave', { guild: { name: 'Server' }, user: {} }, { nowMs: 1_720_000_000_000 });
  assert.equal(missing.display_name, 'Member');
  assert.equal(missing.joined_at, 'Not available');
  assert.equal(missing.time_in_server, 'Not available');
  assert.doesNotMatch(interpolateTemplate('{display_name} {time_in_server}', missing), /undefined/);
});

test('global and event switches stop delivery before resolving a channel', async () => {
  const { member } = fixture();
  assert.equal((await sendMemberMessage('join', member, { config: memberConfig({ enabled: false }) })).reason, 'global-disabled');
  assert.equal((await sendMemberMessage('join', member, { config: memberConfig({ join: eventConfig({ enabled: false }) }) })).reason, 'event-disabled');
});

test('missing channels and insufficient permissions fail safely with useful reasons', async () => {
  const missing = fixture({ config: memberConfig({ join: eventConfig({ channelId: '923456789012345678' }) }) });
  const logs = [];
  const missingResult = await sendMemberMessage('join', missing.member, { config: missing.config, log: (line) => logs.push(line) });
  assert.equal(missingResult.reason, 'missing-channel');
  assert.match(logs[0], /unavailable/);

  const denied = fixture({ allowed: [PermissionFlagsBits.ViewChannel] });
  const deniedResult = await sendMemberMessage('join', denied.member, { config: denied.config, log: (line) => logs.push(line) });
  assert.equal(deniedResult.reason, 'insufficient-permissions');
  assert.deepEqual(deniedResult.missing, ['SendMessages']);
  assert.equal(denied.sends.length, 0);
});

test('join and leave handlers deliver safe Components V2 payloads', async () => {
  const { config, member, sends } = fixture();
  assert.equal((await handleGuildMemberAdd(member, { config })).sent, true);
  assert.equal((await handleGuildMemberRemove(member, { config })).sent, true);
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0].allowedMentions, { parse: [], users: [USER_ID], roles: [] });
  assert.equal(sends[0].components[0].type, 17);
  assert.match(sends[0].components[0].components[0].content, new RegExp(`<@${USER_ID}>`));
  assert.match(sends[1].components[0].components[0].content, /Garden Hero/);
});

test('member-update and system-message boost signals produce one announcement', async () => {
  resetBoostDeduplication();
  const { config, guild, member, sends } = fixture();
  const oldMember = { ...member, premiumSinceTimestamp: null };
  const updateResult = await handleGuildMemberUpdate(oldMember, member, { config, nowMs: 1_720_000_000_000 });
  const messageResult = await handleBoostSystemMessage({
    type: MessageType.GuildBoost,
    guild,
    member,
    author: member.user,
  }, { config, nowMs: 1_720_000_001_000 });
  assert.equal(updateResult.sent, true);
  assert.equal(messageResult.reason, 'duplicate');
  assert.equal(sends.length, 1);
  assert.match(sends[0].components[0].components[0].content, /7\/2/);
  assert.equal((await handleGuildMemberUpdate(member, member, { config })).reason, 'not-a-new-boost');

  resetBoostDeduplication();
  sends.length = 0;
  const staleSystemMember = { ...member, premiumSinceTimestamp: null };
  const firstSystemResult = await handleBoostSystemMessage({
    type: MessageType.GuildBoost, guild, member: staleSystemMember, author: member.user,
  }, { config, nowMs: 1_730_000_000_000 });
  const laterUpdateResult = await handleGuildMemberUpdate(oldMember, member, { config, nowMs: 1_730_000_001_000 });
  assert.equal(firstSystemResult.sent, true);
  assert.equal(laterUpdateResult.reason, 'duplicate');
  assert.equal(sends.length, 1);
});

test('dashboard, shared media API, and Discord entrypoint expose the complete feature', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'src', 'adminServer.js'), 'utf8');
  const entrypoint = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  assert.match(html, /data-view="leveling"[\s\S]*data-view="member-messages"[\s\S]*data-view="rng-game"/);
  assert.match(html, /data-member-event="join"/);
  assert.match(html, /data-member-event="leave"/);
  assert.match(html, /data-member-event="boost"/);
  assert.match(app, /normalizeMemberMessagesConfig/);
  assert.match(app, /data-insert-member-variable/);
  assert.match(app, /Unavailable channel/);
  assert.match(server, /message-media/);
  assert.match(server, /sendable: channelSendable/);
  assert.match(entrypoint, /Events\.GuildMemberAdd/);
  assert.match(entrypoint, /Events\.GuildMemberRemove/);
  assert.match(entrypoint, /Events\.GuildMemberUpdate/);
  assert.match(entrypoint, /handleBoostSystemMessage/);
});
