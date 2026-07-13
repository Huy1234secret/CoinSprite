const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REMOVED_NOTIFICATION_ROLE_KEYS,
  UPDATE_ID,
  buildRoleCleanupUpdatePayload,
  collectGuilds,
  updateChannelForGuild,
} = require('../src/gag2Stock/updateAnnouncement');

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
  assert.match(content, /Sign.*Megaphone.*Lantern.*Teleporter.*Wheelbarrow/);
  assert.deepEqual(payload.allowedMentions.roles, []);
  assert.deepEqual(REMOVED_NOTIFICATION_ROLE_KEYS.gear, ['sign', 'megaphone', 'lantern', 'teleporter', 'wheelbarrow']);
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
