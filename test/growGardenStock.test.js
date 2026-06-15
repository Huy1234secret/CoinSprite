const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertSafeEndpointUrl,
  buildStockPayload,
  normalizeStockPayload,
  stockSignature,
} = require('../src/growGardenStock');

test('normalizes common Grow a Garden stock arrays', () => {
  const stock = normalizeStockPayload({
    seed_stock: [
      { display_name: 'Carrot', quantity: 12, start_date_unix: 1_800_000_000 },
      { display_name: 'Sold Out Seed', quantity: 0 },
    ],
    gear_stock: [{ display_name: 'Watering Can', quantity: 2 }],
    egg_stock: [{ display_name: 'Common Egg', quantity: 1 }],
  });

  assert.equal(stock.updatedAt, 1_800_000_000_000);
  assert.deepEqual(stock.categories.map((category) => category.key), ['seeds', 'gear', 'eggs']);
  assert.deepEqual(stock.categories[0].items, [{ name: 'Carrot', quantity: '12', icon: '' }]);
});

test('normalizes object-based and custom categories', () => {
  const stock = normalizeStockPayload({
    stock: {
      seeds: { Carrot: 4, Strawberry: { stock: 2 } },
    },
    categories: {
      pets: [{ name: 'Garden Dog', count: 1 }],
    },
  });

  assert.equal(stock.categories[0].items[0].name, 'Carrot');
  assert.equal(stock.categories[0].items[1].name, 'Strawberry');
  assert.equal(stock.categories.at(-1).label, 'Pets');
});

test('rejects unsafe stock endpoint URLs', () => {
  assert.throws(() => assertSafeEndpointUrl('http://example.com/stock'), /HTTPS/);
  assert.throws(() => assertSafeEndpointUrl('https://localhost/stock'), /public hostname/);
  assert.throws(() => assertSafeEndpointUrl('https://192.168.1.20/stock'), /private/);
  assert.equal(assertSafeEndpointUrl('https://stock.example.com/api'), 'https://stock.example.com/api');
});

test('builds a Discord embed and stable stock signature', () => {
  const stock = normalizeStockPayload({ seeds: [{ name: 'Carrot', quantity: 3 }] });
  const config = {
    title: 'Grow a Garden 2 Stock',
    pollIntervalMs: 300_000,
    pingRoleId: '123456789012345678',
  };
  const payload = buildStockPayload(stock, config, { ping: true });
  const embed = payload.embeds[0].toJSON();

  assert.equal(payload.content, '<@&123456789012345678> Stock updated.');
  assert.equal(embed.title, 'Grow a Garden 2 Stock');
  assert.match(embed.fields[0].value, /x3.*Carrot/);
  assert.equal(stockSignature(stock), stockSignature(JSON.parse(JSON.stringify(stock))));
});
