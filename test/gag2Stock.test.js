const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPostKey,
  buildStockPayload,
  buildStockSnapshot,
  parseStockApiResponse,
} = require('../src/gag2Stock/predictor');

function fixturePayload() {
  return {
    now: 1000,
    period: 300,
    upcoming: {
      seeds: [
        {
          time: 1000,
          items: [
            { name: 'Carrot', rarity: 'Common', qty: 3 },
            { name: 'Blueberry', rarity: 'Common', qty: 1 },
          ],
        },
        {
          time: 1300,
          items: [
            { name: 'Carrot', rarity: 'Common', qty: 2 },
            { name: 'Moon Bloom', rarity: 'Super', qty: 1 },
          ],
        },
        {
          time: 1600,
          items: [{ name: 'Carrot', rarity: 'Common', qty: 4 }],
        },
      ],
      gears: [
        {
          time: 1000,
          items: [{ name: 'Common Watering Can', rarity: 'Common', qty: 2 }],
        },
        {
          time: 1300,
          items: [{ name: 'Super Sprinkler', rarity: 'Super', qty: 1 }],
        },
      ],
      crates: [
        {
          time: 1000,
          items: [{ name: 'Teleporter Pad Crate', rarity: 'Mythic', qty: 1 }],
        },
        {
          time: 1300,
          items: [{ name: 'Light Crate', rarity: 'Uncommon', qty: 1 }],
        },
      ],
    },
  };
}

test('GAG2 stock parses API data and builds current stock by category', () => {
  const data = parseStockApiResponse(fixturePayload());
  const snapshot = buildStockSnapshot(data, 1000 * 1000);

  assert.equal(snapshot.sourceStale, false);
  assert.equal(snapshot.currentWindowEndsAtMs, 1300 * 1000);
  assert.equal(snapshot.nextRestockAtMs, 1300 * 1000);
  assert.equal(snapshot.categories.length, 3);
  assert.deepEqual(snapshot.categories[0].current.map((item) => item.name), ['Carrot', 'Blueberry']);
  assert.deepEqual(snapshot.categories[0].upcoming.map((item) => item.name), ['Moon Bloom', 'Carrot']);
  assert.match(buildPostKey(snapshot), /^stock:seeds:1000000\|gears:1000000\|crates:1000000$/);
});

test('GAG2 stock payload is a Components V2 container with all categories', () => {
  const data = parseStockApiResponse(fixturePayload());
  const snapshot = buildStockSnapshot(data, 1000 * 1000);
  const payload = buildStockPayload(snapshot, { sourceUrl: 'https://www.game.guide/api/gag2-stock' });
  const container = payload.components[0];
  const content = container.components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');

  assert.equal(payload.flags, 32768);
  assert.equal(container.type, 17);
  assert.match(content, /## GAG2 Stock/);
  assert.match(content, /### Seed stock/);
  assert.match(content, /### Gear stock/);
  assert.match(content, /### Crate stock/);
  assert.match(content, /Teleporter Pad Crate/);
  assert.doesNotMatch(content, /source data expired/);
});

test('GAG2 stock marks stale API data instead of extending old stock', () => {
  const data = parseStockApiResponse(fixturePayload());
  const snapshot = buildStockSnapshot(data, 2000 * 1000);
  const payload = buildStockPayload(snapshot);
  const content = payload.components[0].components[0].content;

  assert.equal(snapshot.sourceStale, true);
  assert.match(buildPostKey(snapshot), /^stale:/);
  assert.match(content, /source data stale/);
});
