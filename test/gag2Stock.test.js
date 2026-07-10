const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPostKey,
  buildStockPayload,
  buildTypePayload,
  buildTypePostKey,
  buildUnavailablePayload,
  parseSellPayload,
  parseStockPayload,
  parseWeatherPayload,
} = require('../src/gag2Stock/stockPayload');
const { roleSpecsForType } = require('../src/gag2Stock/catalog');

function fixture() {
  return {
    fetchedAt: '2026-07-10T16:50:05.000Z',
    stock: [
      {
        category: 'seed',
        restockedAt: '2026-07-10T16:50:01.143Z',
        nextRestockAt: '2026-07-10T16:55:00.000Z',
        items: [
          { key: 'carrot', name: 'Carrot', rarity: 'Common', emoji: '🥕', quantity: 3 },
          { key: 'grape', name: 'Grape', rarity: 'Epic', emoji: '🍇', quantity: 1 },
        ],
      },
      {
        category: 'gear',
        restockedAt: '2026-07-10T16:50:01.143Z',
        nextRestockAt: '2026-07-10T16:55:00.000Z',
        items: [
          { key: 'trowel', name: 'Trowel', rarity: 'Rare', emoji: '🛠️', quantity: 2 },
        ],
      },
      {
        category: 'crate',
        restockedAt: '2026-07-10T16:50:01.143Z',
        nextRestockAt: '2026-07-10T16:55:00.000Z',
        items: [
          { key: 'bench_crate', name: 'Bench Crate', rarity: 'Uncommon', emoji: '📦', quantity: 2 },
        ],
      },
    ],
  };
}

test('GAG2 stock payload normalizes API stock and sorts by catalog order', () => {
  const parsed = parseStockPayload(fixture());

  assert.equal(parsed.stock.length, 3);
  assert.equal(parsed.stock[0].category, 'seed');
  assert.deepEqual(parsed.stock[0].items.map((item) => item.name), ['Carrot', 'Grape']);
  assert.match(buildPostKey(parsed), /^seed:/);
});

test('GAG2 stock payload builds a Components V2 container without source footer text', () => {
  const parsed = parseStockPayload(fixture());
  const payload = buildStockPayload(parsed, { sourceUrl: 'https://api.gag2.gg/api/live/stock' });
  const container = payload.components[0];
  const content = container.components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');

  assert.equal(payload.flags, 32768);
  assert.equal(container.type, 17);
  assert.match(content, /## GAG2 Seed stock/);
  assert.match(content, /## GAG2 Gear/);
  assert.match(content, /## GAG2 Crate stock/);
  assert.match(content, /<:grape:1525195212236914779> \*\*Grape\*\* x1/);
  assert.match(content, /<:bench_crate:1525201076276433056> \*\*Bench\*\* x2/);
  assert.doesNotMatch(content, / - Epic/);
  assert.doesNotMatch(content, / - Common/);
  assert.doesNotMatch(content, /Source:/);
  assert.doesNotMatch(content, /Third-party live stock feeds/);
});

test('GAG2 stock type payload builds one separate message for one category', () => {
  const parsed = parseStockPayload(fixture());
  const seed = parsed.stock.find((entry) => entry.category === 'seed');
  const payload = buildTypePayload('seed', seed, { roleIds: { grape: '123456789012345678' } });
  const content = payload.components[0].components[0].content;

  assert.match(buildTypePostKey('seed', seed), /^seed:/);
  assert.match(content, /## GAG2 Seed stock/);
  assert.match(content, /<:grape:1525195212236914779> <@&123456789012345678> x1/);
  assert.doesNotMatch(content, /Trowel/);
  assert.doesNotMatch(content, / - Epic/);
  assert.doesNotMatch(content, /Source:/);
  assert.deepEqual(payload.allowedMentions.roles, ['123456789012345678']);
});

test('GAG2 weather and sell payloads parse public live endpoints', () => {
  const weather = parseWeatherPayload({
    weather: {
      current: { type: 'rain', name: 'Rain', emoji: '🌧️', endsAt: '2026-07-10T16:10:00.000Z' },
      upcomingMoons: [{ name: 'Mega Moon', boundary: 1783707480 }],
      recent: [{ key: 'rain', name: 'Rain', lastSeenAt: '2026-07-10T16:00:11.143Z' }],
    },
  });
  const sell = parseSellPayload({
    sell: {
      entries: [
        { key: 'mushroom', name: 'Mushroom', multiplier: 2, tier: 'big' },
        { key: 'tomato', name: 'Tomato', multiplier: 1.1, tier: 'normal' },
      ],
    },
  });

  assert.equal(weather.current.name, 'Rain');
  assert.equal(weather.upcomingMoons[0].name, 'Mega Moon');
  assert.equal(sell.entries[0].name, 'Tomato');
  const weatherPayload = buildTypePayload('weather', weather, { roleIds: { rain: '123456789012345678' } });
  assert.equal(weatherPayload.components[0].accent_color, 0x4A90E2);
  assert.equal(weatherPayload.components[0].components[0].type, 9);
  assert.match(weatherPayload.components[0].components[0].components[0].content, /<:rain:1525203824376156390> <@&123456789012345678>/);
  assert.match(buildTypePayload('moon', weather).components[0].components[0].content, /<:mega_moon:1525203817686106172>.*Mega Moon/);
  const sellPayload = buildTypePayload('sell', sell);
  assert.equal(sellPayload.components[0].accent_color, 0xE2AB0F);
  assert.match(sellPayload.components[0].components[0].content, /Gold 2x Sell Price/);
  assert.match(sellPayload.components.at(-1).components[0].content, /## <:tomato:1525195241026617435> \*\*Tomato\*\* x1.10 - normal/);
  assert.match(sellPayload.components.at(-1).components[0].content, /## <:mushroom:1525195225511760072> \*\*Mushroom\*\* x2.00 - big/);
});

test('GAG2 stock unavailable payload is a red Components V2 container', () => {
  const payload = buildUnavailablePayload('HTTP 500', Date.parse('2026-07-10T16:50:00.000Z'));

  assert.equal(payload.flags, 32768);
  assert.equal(payload.components[0].accent_color, 0xed4245);
  assert.match(payload.components[0].components[0].content, /source unavailable/);
});

test('GAG2 role specs use requested names and colors', () => {
  const seeds = roleSpecsForType('seed');
  const gear = roleSpecsForType('gear');
  const sell = roleSpecsForType('sell');

  assert.deepEqual(seeds.slice(0, 3).map((spec) => spec.roleName), ['Carrot', 'Strawberry', 'Blueberry']);
  assert.equal(seeds.find((spec) => spec.key === 'dragon_s_breath').roleName, 'Dragon’s Breath');
  assert.equal(seeds.find((spec) => spec.key === 'dragon_s_breath').color, 0xB71E99);
  assert.equal(gear.find((spec) => spec.key === 'player_magnet').roleName, 'Player Magnet');
  assert.equal(gear.find((spec) => spec.key === 'player_magnet').color, 0xD62928);
  assert.equal(sell.find((spec) => spec.key === 'common_2x').roleName, 'Common 2x');
  assert.equal(sell.find((spec) => spec.key === 'common_2x').color, 0xE2AB0F);
  assert.equal(sell.find((spec) => spec.key === 'super_4x').roleName, 'Super 4x');
  assert.equal(sell.find((spec) => spec.key === 'super_4x').color, 0x7DE3FF);
});
