const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUG_PATCH_UPDATE_ID,
  PERFORMANCE_BOOST_UPDATE_ID,
  REMOVED_NOTIFICATION_ROLE_KEYS,
  RETRACTED_NOTIFICATION_ROLE_UPDATE_IDS,
  UPDATE_ID,
  buildBugPatchesUpdatePayload,
  buildPerformanceBoostUpdatePayload,
  buildRoleCleanupUpdatePayload,
  collectGuilds,
  retractNotificationRoleUpdates,
  updateChannelForGuild,
} = require('../src/gag2Stock/updateAnnouncement');

test('GAG2 retracts stored Eclipse role-update announcements', async () => {
  const statePath = path.join(__dirname, 'tmp-gag2-eclipse-announcement-state.json');
  const guildId = '1493901002519347290';
  const channelId = '1525003375651848263';
  const messageIds = ['1527000000000000001', '1527000000000000002'];
  fs.writeFileSync(statePath, JSON.stringify({
    updateAnnouncements: Object.fromEntries(RETRACTED_NOTIFICATION_ROLE_UPDATE_IDS.map((updateId, index) => [
      updateId,
      { [guildId]: { channelId, messageId: messageIds[index] } },
    ])),
  }));
  const deleted = [];
  const guild = {
    id: guildId,
    channels: {
      cache: new Map([[channelId, {
        messages: { delete: async (messageId) => deleted.push(messageId) },
      }]]),
      fetch: async () => null,
    },
  };

  assert.equal(await retractNotificationRoleUpdates(guild, { statePath }), 2);
  assert.deepEqual(deleted, messageIds);
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.ok(RETRACTED_NOTIFICATION_ROLE_UPDATE_IDS.every((updateId) => !saved.updateAnnouncements?.[updateId]));
  fs.rmSync(statePath, { force: true });
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
