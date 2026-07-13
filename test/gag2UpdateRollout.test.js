const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  UPDATE_ANNOUNCEMENT_AT_MS,
  UPDATE_CHANNEL_KEY,
  UPDATE_CHANNEL_NAME,
  UPDATE_ID,
  buildUpdateAnnouncementPayload,
  collectRolloutGuilds,
  loadRolloutState,
  saveRolloutState,
} = require('../src/gag2Stock/updateRollout');

test('GAG2 Update 1 uses the two new Super seed roles and emojis', () => {
  const payload = buildUpdateAnnouncementPayload({
    sun_bloom: '123456789012345678',
    star_fruit: '223456789012345678',
  });
  const container = payload.components[0];
  const content = container.components[0].content;

  assert.equal(payload.flags, 32768);
  assert.equal(container.type, 17);
  assert.equal(container.accent_color, 0xB71E99);
  assert.match(content, /^### Update 1/);
  assert.match(content, /<:sun_bloom:1525996662449766431> \*\*<@&123456789012345678>\*\*/);
  assert.match(content, /<:star_fruit:1525996660000428112> \*\*<@&223456789012345678>\*\*/);
  assert.deepEqual(payload.allowedMentions.roles, ['123456789012345678', '223456789012345678']);
});

test('GAG2 update rollout includes guilds returned outside the client cache', async () => {
  const cachedGuild = { id: '123456789012345678', channels: {}, roles: {} };
  const fetchedGuild = { id: '223456789012345678', channels: {}, roles: {} };
  const cache = new Map([[cachedGuild.id, cachedGuild]]);
  const fetched = new Map([[fetchedGuild.id, { id: fetchedGuild.id }]]);
  const client = {
    guilds: {
      cache,
      fetch: async (guildId) => guildId ? fetchedGuild : fetched,
    },
  };

  assert.deepEqual((await collectRolloutGuilds(client)).map((guild) => guild.id), [cachedGuild.id, fetchedGuild.id]);
});

test('GAG2 Update 1 is scheduled for July 13 2026 at 06:00 UTC+7', () => {
  assert.equal(new Date(UPDATE_ANNOUNCEMENT_AT_MS).toISOString(), '2026-07-12T23:00:00.000Z');
  assert.equal(UPDATE_CHANNEL_KEY, 'updates');
  assert.equal(UPDATE_CHANNEL_NAME, 'Bot Update');
});

test('GAG2 update rollout state persists its one-time guild markers', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-gag2-update-'));
  const statePath = path.join(directory, 'rollout.json');
  try {
    const state = loadRolloutState(statePath);
    state.guilds['123456789012345678'] = {
      channelId: '223456789012345678',
      provisionedAt: '2026-07-12T22:00:00.000Z',
      announcedAt: '2026-07-12T23:00:00.000Z',
    };
    saveRolloutState(state, statePath);
    const restored = loadRolloutState(statePath);
    assert.equal(restored.updateId, UPDATE_ID);
    assert.equal(restored.guilds['123456789012345678'].channelId, '223456789012345678');
    assert.equal(restored.guilds['123456789012345678'].announcedAt, '2026-07-12T23:00:00.000Z');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
