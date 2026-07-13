const assert = require('node:assert/strict');
const test = require('node:test');

const {
  UPDATE_ID,
  buildEclipseUpdatePayload,
  collectGuilds,
  updateChannelForGuild,
} = require('../src/gag2Stock/updateAnnouncement');

test('GAG2 Update 2 announces Eclipse with its role and emoji', () => {
  const payload = buildEclipseUpdatePayload('123456789012345678');
  const container = payload.components[0];
  const content = container.components[0].content;

  assert.equal(UPDATE_ID, 'gag2-update-2-eclipse');
  assert.equal(payload.flags, 32768);
  assert.equal(container.accent_color, 0x9B59FF);
  assert.match(content, /^### Update 2/);
  assert.match(content, /<:eclipse:1526025549858738287> \*\*<@&123456789012345678>\*\*/);
  assert.deepEqual(payload.allowedMentions.roles, ['123456789012345678']);
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
