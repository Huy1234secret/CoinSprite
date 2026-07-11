const assert = require('node:assert/strict');
const test = require('node:test');

const { collectOwnerGuildIds } = require('../src/ownerPanelRoutes');

test('owner panel guild collection includes fetched guilds outside cache', async () => {
  const cachedGuildId = '111111111111111111';
  const fetchedGuildId = '222222222222222222';
  const fetchedValueGuildId = '333333333333333333';
  const configuredGuildId = '444444444444444444';
  const ids = await collectOwnerGuildIds({
    guilds: {
      cache: new Map([[cachedGuildId, { id: cachedGuildId }]]),
      fetch: async () => new Map([
        [fetchedGuildId, { id: fetchedGuildId }],
        ['not-a-discord-id', { id: fetchedValueGuildId }],
      ]),
    },
  }, [configuredGuildId]);

  assert.deepEqual([...ids].sort(), [
    cachedGuildId,
    configuredGuildId,
    fetchedGuildId,
    fetchedValueGuildId,
  ].sort());
});
