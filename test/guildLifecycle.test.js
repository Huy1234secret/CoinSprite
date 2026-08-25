const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-guilds-'));
delete process.env.DEFAULT_GUILD_ID;
process.env.SERVER_CONFIG_STORE_PATH = path.join(temporaryDirectory, 'server-config.json');

const { createGuildCreateHandler } = require('../src/guildLifecycle');
const {
  ensureGuildConfig,
  getConfiguredGuildIds,
  setGuildFeatureAccess,
} = require('../src/serverConfig');

test.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

test('GuildCreate initializes every valid server without leaving it', async () => {
  const guildId = '323456789012345678';
  const calls = [];
  const handler = createGuildCreateHandler({
    ensureGuildConfig: (id) => calls.push(`config:${id}`),
    syncGuildCommands: async (guild) => calls.push(`commands:${guild.id}`),
  });

  const result = await handler({ guildId, id: guildId, leave: async () => calls.push('leave') });

  assert.deepEqual(result, { initialized: true });
  assert.deepEqual(calls, [`config:${guildId}`, `commands:${guildId}`]);
});

test('configuration and feature access accept arbitrary valid server IDs', () => {
  const firstGuildId = '123456789012345678';
  const secondGuildId = '223456789012345678';

  assert.ok(ensureGuildConfig(firstGuildId));
  assert.ok(ensureGuildConfig(secondGuildId));
  const updated = setGuildFeatureAccess(secondGuildId, { leveling: true, rngGame: true });

  assert.equal(updated.features.leveling, true);
  assert.equal(updated.features.rngGame, true);
  assert.deepEqual(getConfiguredGuildIds().sort(), [firstGuildId, secondGuildId].sort());
});

test('panel-only runtime ignores join events without removing the server', async () => {
  const calls = [];
  const handler = createGuildCreateHandler({
    botEnabled: false,
    ensureGuildConfig: () => calls.push('config'),
    syncGuildCommands: async () => calls.push('commands'),
  });

  const result = await handler({ id: '423456789012345678', leave: async () => calls.push('leave') });

  assert.deepEqual(result, { initialized: false });
  assert.deepEqual(calls, []);
});
