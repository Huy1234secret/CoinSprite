const assert = require('node:assert/strict');
const test = require('node:test');

const fs = require('node:fs');
const path = require('node:path');

const { collectOwnerGuildIds, collectOwnerGuildRecords, handleOwnerMetrics } = require('../src/ownerPanelRoutes');

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

test('owner panel guild collection keeps partial fetched guild metadata', async () => {
  const cachedGuildId = '111111111111111111';
  const fetchedGuildId = '222222222222222222';
  const fetchedValueGuildId = '333333333333333333';
  const configuredGuildId = '444444444444444444';
  const cachedGuild = { id: cachedGuildId, name: 'Cached Guild', channels: {}, roles: {} };
  const fetchedGuild = { id: fetchedGuildId, name: 'Fetched Partial' };
  const fetchedValueGuild = { id: fetchedValueGuildId, name: 'Fetched Value Partial' };

  const records = await collectOwnerGuildRecords({
    guilds: {
      cache: new Map([[cachedGuildId, cachedGuild]]),
      fetch: async () => new Map([
        [fetchedGuildId, fetchedGuild],
        ['not-a-discord-id', fetchedValueGuild],
      ]),
    },
  }, [configuredGuildId]);

  assert.equal(records.get(cachedGuildId), cachedGuild);
  assert.equal(records.get(fetchedGuildId), fetchedGuild);
  assert.equal(records.get(fetchedValueGuildId), fetchedValueGuild);
  assert.deepEqual(records.get(configuredGuildId), { id: configuredGuildId });
});

test('owner panel labels partial guild rows as limited info', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin', 'owner-panel.js'), 'utf8');
  assert.match(source, /Limited info from Discord guild list/);
  assert.match(source, /Channel\/role counts unavailable/);
  assert.match(source, /guild\.limitedInfo/);
});

test('owner metrics route returns live CPU and heap limits', async () => {
  let response = null;
  await handleOwnerMetrics({}, {}, {}, {}, {
    sendJson: (_res, status, payload) => {
      response = { status, payload };
    },
  });

  assert.equal(response.status, 200);
  assert.ok(response.payload.cpu.maxVcpu >= 1);
  assert.ok(response.payload.cpu.usageRatio >= 0 && response.payload.cpu.usageRatio <= 1);
  assert.ok(response.payload.heap.maxBytes >= response.payload.heap.usedBytes);
  assert.ok(response.payload.heap.peakBytes >= response.payload.heap.usedBytes);
});
