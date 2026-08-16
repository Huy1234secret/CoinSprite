const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ALLOWED_GUILD_IDS,
  createGuildCreateHandler,
  isGuildAllowlisted,
  leaveUnauthorizedGuilds,
} = require('../src/guildAllowlist');

test('guild allowlist is immutable and contains exactly the two deployment guilds', () => {
  assert.equal(Object.isFrozen(ALLOWED_GUILD_IDS), true);
  assert.deepEqual(ALLOWED_GUILD_IDS, ['1534541772850724967', '1493901002519347290']);
  for (const guildId of ALLOWED_GUILD_IDS) assert.equal(isGuildAllowlisted(guildId), true);
  assert.equal(isGuildAllowlisted('123456789012345678'), false);
});

test('startup cleanup never leaves allowed guilds and leaves every other guild sequentially', async () => {
  const calls = [];
  let active = 0;
  let peak = 0;
  const guilds = [
    ...ALLOWED_GUILD_IDS.map((id) => ({ id, leave: async () => calls.push(`forbidden:${id}`) })),
    ...['123456789012345678', '223456789012345678'].map((id) => ({
      id,
      async leave() {
        active += 1;
        peak = Math.max(peak, active);
        calls.push(id);
        await Promise.resolve();
        active -= 1;
      },
    })),
  ];

  await leaveUnauthorizedGuilds(guilds);
  assert.deepEqual(calls, ['123456789012345678', '223456789012345678']);
  assert.equal(peak, 1);
});

test('one failed startup leave does not stop cleanup of later guilds', async () => {
  const calls = [];
  const logs = [];
  await leaveUnauthorizedGuilds([
    { id: '123456789012345678', leave: async () => { calls.push('first'); throw new Error('denied'); } },
    { id: '223456789012345678', leave: async () => { calls.push('second'); } },
  ], { log: (line) => logs.push(line) });
  assert.deepEqual(calls, ['first', 'second']);
  assert.ok(logs.some((line) => /123456789012345678.*denied/.test(line)));
});

test('GuildCreate immediately leaves unauthorized guilds without configuration or command sync', async () => {
  const calls = [];
  const handler = createGuildCreateHandler({
    ensureGuildConfig: () => calls.push('config'),
    syncGuildCommands: async () => calls.push('commands'),
  });
  const result = await handler({ id: '323456789012345678', leave: async () => calls.push('leave') });
  assert.deepEqual(result, { allowed: false });
  assert.deepEqual(calls, ['leave']);
});

test('GuildCreate initializes allowed guilds without ever calling leave', async () => {
  for (const id of ALLOWED_GUILD_IDS) {
    const calls = [];
    const handler = createGuildCreateHandler({
      ensureGuildConfig: (guildId) => calls.push(`config:${guildId}`),
      syncGuildCommands: async (guild) => calls.push(`commands:${guild.id}`),
    });
    const result = await handler({ id, leave: async () => calls.push('leave') });
    assert.equal(result.initialized, true);
    assert.deepEqual(calls, [`config:${id}`, `commands:${id}`]);
  }
});
