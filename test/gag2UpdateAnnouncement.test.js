const assert = require('node:assert/strict');
const test = require('node:test');

const {
  UPDATE_ID,
  buildEclipseBloomUpdatePayload,
  collectGuilds,
  updateChannelForGuild,
} = require('../src/gag2Stock/updateAnnouncement');

test('GAG2 Update 3 announces Eclipse Bloom with its role and emoji', () => {
  const payload = buildEclipseBloomUpdatePayload('123456789012345678');
  const container = payload.components[0];
  const content = container.components[0].content;

  assert.equal(UPDATE_ID, 'gag2-update-3-eclipse-bloom');
  assert.equal(payload.flags, 32768);
  assert.equal(container.accent_color, 0xFFFFFF);
  assert.match(content, /^### Update 3/);
  assert.match(content, /<:eclipse_bloom:1526031940749361163> \*\*<@&123456789012345678>\*\*/);
  assert.match(content, /Secret 2x/);
  assert.match(content, /Secret 4x/);
  assert.match(content, /Briar Rose/);
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
