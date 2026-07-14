const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUG_PATCH_UPDATE_ID,
  NOTIFICATION_ROLE_UPDATE_ID,
  PERFORMANCE_BOOST_UPDATE_ID,
  REMOVED_NOTIFICATION_ROLE_KEYS,
  UPDATE_ID,
  buildBugPatchesUpdatePayload,
  buildNotificationRoleUpdatePayload,
  buildPerformanceBoostUpdatePayload,
  buildRoleCleanupUpdatePayload,
  collectGuilds,
  updateChannelForGuild,
} = require('../src/gag2Stock/updateAnnouncement');

test('GAG2 Notification Role Update announces the Eclipse role restoration', () => {
  const payload = buildNotificationRoleUpdatePayload({ hasRoleAssignment: true });
  const container = payload.components[0];
  const content = container.components[0].content;

  assert.equal(NOTIFICATION_ROLE_UPDATE_ID, 'gag2-notification-role-update-eclipse-channel-v2');
  assert.equal(payload.flags, 32768);
  assert.equal(container.accent_color, 0x9B59FF);
  assert.match(content, /^### Notification Role Update/);
  assert.match(content, /<:eclipse:1526025549858738287> \*\*Eclipse\*\*/);
  assert.match(content, /Re-added the weather notification role/);
  assert.match(content, /Members can select it again from the Weather role assignment menu/);
  assert.doesNotMatch(content, /Sign|sign_crate/);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: [] });
  assert.deepEqual(REMOVED_NOTIFICATION_ROLE_KEYS.crate, ['fourth_of_july_crate']);
});

test('GAG2 Eclipse announcement only mentions role assignment when the guild has its channel', () => {
  const withoutRoleAssignment = buildNotificationRoleUpdatePayload().components[0].components[0].content;
  const withRoleAssignment = buildNotificationRoleUpdatePayload({ hasRoleAssignment: true }).components[0].components[0].content;

  assert.doesNotMatch(withoutRoleAssignment, /role assignment menu/i);
  assert.match(withRoleAssignment, /role assignment menu/i);
});

test('GAG2 Performance Boost announces the faster concurrent delivery update', () => {
  const payload = buildPerformanceBoostUpdatePayload();
  const container = payload.components[0];
  const content = container.components[0].content;

  assert.equal(PERFORMANCE_BOOST_UPDATE_ID, 'gag2-performance-boost-concurrent-broadcasts');
  assert.equal(payload.flags, 32768);
  assert.equal(container.accent_color, 0xE2AB0F);
  assert.match(content, /^### Performance Boost! ⭐/);
  assert.match(content, /multiple servers at the same time/);
  assert.match(content, /Stock, weather, moon, sell-price, and bot-update notifications/);
  assert.match(content, /rate-limit safe/);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: [] });
});

test('GAG2 Bug Patches announces the sell replay and duplicate-send fixes', () => {
  const payload = buildBugPatchesUpdatePayload();
  const container = payload.components[0];
  const content = container.components[0].content;

  assert.equal(BUG_PATCH_UPDATE_ID, 'gag2-bug-patches-sell-price-dedupe');
  assert.equal(payload.flags, 32768);
  assert.equal(container.accent_color, 0x3EC044);
  assert.match(content, /^### Bug Patches/);
  assert.match(content, /replay an older price update/);
  assert.match(content, /same sell price notification twice/);
  assert.match(content, /only when the displayed prices change/);
  assert.deepEqual(payload.allowedMentions.roles, []);
});

test('GAG2 Update 4 clearly explains the notification role cleanup', () => {
  const payload = buildRoleCleanupUpdatePayload();
  const container = payload.components[0];
  const content = container.components[0].content;

  assert.equal(UPDATE_ID, 'gag2-update-4-notification-role-cleanup');
  assert.equal(payload.flags, 32768);
  assert.equal(container.accent_color, 0xB0ADAC);
  assert.match(content, /^### Update 4/);
  assert.match(content, /seed-pack-only seeds/);
  assert.match(content, /Baby Cactus/);
  assert.match(content, /Rocket Pop/);
  assert.match(content, /Fourth of July/);
  assert.match(content, /Eclipse Bloom is obtained through merging/);
  assert.match(content, /Sign.*Megaphone.*Lantern.*Teleporter.*Wheelbarrow.*Strawberry Sniper/);
  assert.deepEqual(payload.allowedMentions.roles, []);
  assert.deepEqual(REMOVED_NOTIFICATION_ROLE_KEYS.gear, ['sign', 'megaphone', 'lantern', 'teleporter', 'wheelbarrow', 'strawberry_sniper']);
});

test('GAG2 update notification falls back to the seed channel', async () => {
  const seedChannel = { id: '223456789012345678', isTextBased: () => true, send: async () => null };
  const guild = {
    channels: {
      cache: new Map([[seedChannel.id, seedChannel]]),
      fetch: async () => null,
    },
  };
  const config = {
    gag2Stock: {
      channels: { updates: '', seed: seedChannel.id },
    },
  };

  assert.equal(await updateChannelForGuild(guild, config), seedChannel);
});

test('GAG2 update announcement discovers guilds outside cache', async () => {
  const cachedGuild = { id: '123456789012345678', channels: {}, roles: {} };
  const fetchedGuild = { id: '223456789012345678', channels: {}, roles: {} };
  const client = {
    guilds: {
      cache: new Map([[cachedGuild.id, cachedGuild]]),
      fetch: async (guildId) => guildId ? fetchedGuild : new Map([[fetchedGuild.id, { id: fetchedGuild.id }]]),
    },
  };

  assert.deepEqual((await collectGuilds(client)).map((guild) => guild.id), [cachedGuild.id, fetchedGuild.id]);
});
