const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
const {
  DEFAULT_GAG2_STOCK_CONFIG,
  GAG2_ROLE_FILTER_RARITIES,
  GAG2_SELL_FILTER_RARITIES,
  GAG2_SELL_MULTIPLIERS,
  normalizeGag2StockConfig,
} = require('../src/serverConfig');
const {
  REQUEST_TIMEOUT_MS,
  SELL_UNCHANGED_RETRY_MS,
  STALE_STOCK_RETRY_MS,
  WEATHER_CHECK_INTERVAL_MS,
} = require('../src/gag2Stock/config');
const { fetchJson } = require('../src/gag2Stock/source');
const { colorForType, emojiForType, roleSpecsForType } = require('../src/gag2Stock/catalog');
const { Gag2StockPoster, filterSellEntry, filteredRoleSpecs, isStaleStockEntry, nextGag2StockTickAtMs } = require('../src/gag2Stock/manager');

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
  assert.match(content, /-# Restock <t:\d+:R>/);
  assert.doesNotMatch(content, /Next restock/);
  assert.match(content, /<:grape:1525195212236914779> \*\*Grape\*\* x1/);
  assert.match(content, /<:bench_crate:1525201076276433056> \*\*Bench\*\* x2/);
  assert.ok(container.components.some((component) => component.type === 14 && component.divider));
  assert.doesNotMatch(content, / - Epic/);
  assert.doesNotMatch(content, / - Common/);
  assert.doesNotMatch(content, /Source:/);
  assert.doesNotMatch(content, /Third-party live stock feeds/);
});

test('GAG2 stock parser excludes sell-only Eclipse Bloom from seed stock', () => {
  const parsed = parseStockPayload({
    stock: [{
      category: 'seed',
      items: [
        { key: 'carrot', name: 'Carrot', rarity: 'Common', quantity: 1 },
        { key: 'eclipse_bloom', name: 'Eclipse Bloom', rarity: 'Secret', quantity: 1 },
      ],
    }],
  });
  assert.deepEqual(parsed.stock[0].items.map((item) => item.key), ['carrot']);
});

test('GAG2 stock type payload builds one separate message for one category', () => {
  const parsed = parseStockPayload(fixture());
  const seed = parsed.stock.find((entry) => entry.category === 'seed');
  const payload = buildTypePayload('seed', seed, { roleIds: { grape: '123456789012345678' } });
  const innerComponents = payload.components[0].components;
  const content = innerComponents.filter((component) => component.type === 10).map((component) => component.content).join('\n');

  assert.match(buildTypePostKey('seed', seed), /^seed:/);
  assert.match(content, /## GAG2 Seed stock/);
  assert.match(content, /-# Restock <t:\d+:R>/);
  assert.doesNotMatch(content, /Next restock/);
  assert.equal(innerComponents[1].type, 14);
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
      nextRefreshUnix: 1783857600,
      entries: [
        { key: 'mushroom', name: 'Mushroom', multiplier: 2, tier: 'big' },
        { key: 'tomato', name: 'Tomato', multiplier: 1.1, tier: 'normal' },
        { key: 'glow_mushroom', name: 'Glow Mushroom', multiplier: 1.05, tier: 'normal' },
        { key: 'eclipse_bloom', name: 'Eclipse Bloom', multiplier: 1.25, tier: 'normal' },
        { key: 'briar_rose', name: 'Briar Rose', multiplier: 1.2, tier: 'normal' },
      ],
    },
  });

  assert.equal(weather.current.name, 'Rain');
  assert.equal(weather.upcomingMoons[0].name, 'Mega Moon');
  assert.equal(sell.entries[0].name, 'Tomato');
  assert.ok(sell.entries.some((entry) => entry.key === 'eclipse_bloom'));
  assert.ok(sell.entries.every((entry) => entry.key !== 'briar_rose'));
  assert.equal(new Date(sell.nextRefreshAtMs).toISOString(), '2026-07-12T12:00:00.000Z');
  const weatherPayload = buildTypePayload('weather', weather, { roleIds: { rain: '123456789012345678' } });
  assert.equal(weatherPayload.components[0].accent_color, 0x4A90E2);
  assert.equal(weatherPayload.components[0].components[0].type, 9);
  assert.match(weatherPayload.components[0].components[0].components[0].content, /<:rain:1525203824376156390> <@&123456789012345678>/);
  const moonPayload = buildTypePayload('moon', weather, { roleIds: { mega_moon: '678901234567890123' } });
  assert.deepEqual(moonPayload.allowedMentions.roles, []);
  assert.match(moonPayload.components[0].components[0].content, /<:mega_moon:1525203817686106172> <@&678901234567890123>/);
  assert.doesNotMatch(moonPayload.components[0].components[0].content, /\*\*Mega Moon\*\* <@&678901234567890123>/);
  const sellPayload = buildTypePayload('sell', sell, {
    roleIds: {
      mushroom: '345678901234567890',
      tomato: '456789012345678901',
      epic_2x: '567890123456789012',
    },
  });
  assert.equal(sellPayload.components[0].accent_color, 0xE2AB0F);
  assert.match(sellPayload.components[0].components[0].content, /## <@&567890123456789012> Sell Price/);
  assert.match(sellPayload.components[0].components[0].content, /\* <:mushroom:1525195225511760072> \*\*Mushroom\*\* x2.00/);
  assert.doesNotMatch(sellPayload.components[0].components[0].content, / - big| - normal/);
  assert.equal(sellPayload.components.at(-1).accent_color, 0xFFFFFF);
  assert.match(sellPayload.components.at(-1).components[0].content, /\* <:tomato:1525195241026617435> \*\*Tomato\*\* x1.10/);
  assert.match(sellPayload.components.at(-1).components[0].content, /\* <:glow_mushroom:1525390121929805926> \*\*Glow Mushroom\*\* x1.05/);
  assert.match(sellPayload.components.at(-1).components[0].content, /\* <:eclipse_bloom:1526031940749361163> \*\*Eclipse Bloom\*\* x1.25/);
  assert.doesNotMatch(sellPayload.components.at(-1).components[0].content, /Briar Rose/);
  assert.doesNotMatch(sellPayload.components.at(-1).components[0].content, /<:mushroom:1525195225511760072>| - normal| - big/);
  assert.doesNotMatch(sellPayload.components.at(-1).components[0].content, /<@&345678901234567890>|<@&456789012345678901>|^## <:tomato/m);
});

test('GAG2 current weather uses role mention while recent weather stays plain text', () => {
  const weather = parseWeatherPayload({
    weather: {
      current: { type: 'rainbow', name: 'Rainbow', endsAt: '2026-07-10T16:10:00.000Z' },
      recent: [
        { key: 'rainbow', name: 'Rainbow', lastSeenAt: '2026-07-10T16:00:11.143Z' },
        { key: 'aurora', name: 'Aurora', lastSeenAt: '2026-07-10T15:57:11.143Z' },
      ],
    },
  });
  const payload = buildTypePayload('weather', weather, {
    roleIds: {
      rainbow: '123456789012345678',
      aurora: '234567890123456789',
    },
  });
  const content = payload.components[0].components[0].components[0].content;
  const lines = content.split('\n');
  const currentLine = lines.find((line) => line.includes('Current:'));
  const recentLines = lines.filter((line) => line.startsWith('* ') && !line.includes('Current:') && !line.includes('Ends:'));

  assert.match(currentLine, /<:rainbow:1525203819775135764> <@&123456789012345678>/);
  assert.doesNotMatch(currentLine, /\*\*Rainbow\*\*/);
  assert.match(recentLines.join('\n'), /<:rainbow:1525203819775135764> \*\*Rainbow\*\*/);
  assert.match(recentLines.join('\n'), /<:aurora:1525203810467840000> \*\*Aurora\*\*/);
  assert.doesNotMatch(recentLines.join('\n'), /<@&123456789012345678>|<@&234567890123456789>/);
});

test('GAG2 normal sell container includes seeds after the old 25-item cutoff', () => {
  const entries = roleSpecsForType('seed').map((spec, index) => ({
    key: spec.key,
    name: spec.roleName,
    multiplier: 1 + (index / 100),
    tier: 'normal',
  }));
  const payload = buildTypePayload('sell', { entries });
  const content = payload.components.at(-1).components[0].content;

  assert.match(content, /<:sun_bloom:1525996662449766431> \*\*Sun Bloom\*\*/);
  assert.match(content, /<:star_fruit:1525996660000428112> \*\*Star Fruit\*\*/);
  assert.equal(content.split('\n').length, entries.length + 1);
});

test('GAG2 filters default to every supported rarity and sell multiplier', () => {
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.rarities.seed, GAG2_ROLE_FILTER_RARITIES);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.rarities.gear, GAG2_ROLE_FILTER_RARITIES);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.rarities.crate, GAG2_ROLE_FILTER_RARITIES);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.rarities.sell, GAG2_SELL_FILTER_RARITIES);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.sellMultipliers, GAG2_SELL_MULTIPLIERS);
});

test('GAG2 filter config preserves empty choices and removes unsupported values', () => {
  const config = normalizeGag2StockConfig({
    filters: {
      rarities: { seed: [], gear: ['rare', 'invalid'], crate: ['super'], sell: ['secret', 'common', 'invalid'] },
      sellMultipliers: ['4x', 'invalid'],
    },
  });
  assert.deepEqual(config.filters.rarities.seed, []);
  assert.deepEqual(config.filters.rarities.gear, ['rare']);
  assert.deepEqual(config.filters.rarities.crate, ['super']);
  assert.deepEqual(config.filters.rarities.sell, ['common', 'secret']);
  assert.deepEqual(config.filters.sellMultipliers, ['4x']);
});

test('GAG2 sell filter can announce only Common 4x fruit without a normal container', () => {
  const filtered = filterSellEntry({
    entries: [
      { key: 'carrot', name: 'Carrot', multiplier: 4, tier: 'big' },
      { key: 'blueberry', name: 'Blueberry', multiplier: 1.5, tier: 'normal' },
      { key: 'corn', name: 'Corn', multiplier: 4, tier: 'big' },
    ],
  }, {
    rarities: { sell: ['common'] },
    sellMultipliers: ['4x'],
  });
  const payload = buildTypePayload('sell', filtered, { roleIds: { common_4x: '123456789012345678' } });
  const content = payload.components[0].components[0].content;

  assert.deepEqual(filtered.entries.map((entry) => entry.key), ['carrot']);
  assert.deepEqual(filtered.enabledMultipliers, ['4x']);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].accent_color, 0x7DE3FF);
  assert.match(content, /<@&123456789012345678>/);
  assert.match(content, /Carrot/);
  assert.doesNotMatch(content, /Blueberry|Corn|GAG2 Sell Price Track/);
});

test('GAG2 role rarity filters retain only requested role specs', () => {
  const seedSpecs = filteredRoleSpecs('seed', roleSpecsForType('seed'), {
    rarities: { seed: ['common'] },
  });
  const sellSpecs = filteredRoleSpecs('sell', roleSpecsForType('sell'), {
    rarities: { sell: ['common'] },
    sellMultipliers: ['4x'],
  });

  assert.deepEqual(seedSpecs.filter((spec) => spec.rarity === 'common').map((spec) => spec.key), ['carrot', 'strawberry', 'blueberry']);
  assert.ok(seedSpecs.every((spec) => spec.key !== 'eclipse_bloom'), 'Sell-only Eclipse Bloom does not create a seed notification role');
  assert.deepEqual(sellSpecs.map((spec) => spec.key), ['common_4x']);
});

test('GAG2 weather post key changes only for current weather, not recent history', () => {
  const base = parseWeatherPayload({
    weather: {
      current: { type: 'goldmoon', name: 'Goldmoon', startsAt: '2026-07-10T16:00:00.000Z', endsAt: '2026-07-10T16:03:00.000Z' },
      recent: [
        { key: 'rainbow', name: 'Rainbow', lastSeenAt: '2026-07-10T15:55:00.000Z' },
      ],
    },
  });
  const recentOnlyChanged = parseWeatherPayload({
    weather: {
      current: { type: 'goldmoon', name: 'Goldmoon', startsAt: '2026-07-10T16:00:00.000Z', endsAt: '2026-07-10T16:03:00.000Z' },
      recent: [
        { key: 'rainbow', name: 'Rainbow', lastSeenAt: '2026-07-10T15:56:00.000Z' },
        { key: 'aurora', name: 'Aurora', lastSeenAt: '2026-07-10T15:54:00.000Z' },
      ],
    },
  });
  const currentChanged = parseWeatherPayload({
    weather: {
      current: { type: 'bloodmoon', name: 'Blood Moon', startsAt: '2026-07-10T16:04:00.000Z', endsAt: '2026-07-10T16:07:00.000Z' },
      recent: [
        { key: 'goldmoon', name: 'Goldmoon', lastSeenAt: '2026-07-10T16:03:00.000Z' },
      ],
    },
  });

  assert.equal(buildTypePostKey('weather', base), buildTypePostKey('weather', recentOnlyChanged));
  assert.notEqual(buildTypePostKey('weather', base), buildTypePostKey('weather', currentChanged));
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
  const crate = roleSpecsForType('crate');
  const sell = roleSpecsForType('sell');
  const weather = roleSpecsForType('weather');

  assert.deepEqual(seeds.slice(0, 3).map((spec) => spec.roleName), ['Carrot', 'Strawberry', 'Blueberry']);
  assert.equal(seeds.find((spec) => spec.key === 'carrot').emoji, '<:carrot:1525195196864925817>');
  assert.equal(seeds.find((spec) => spec.key === 'dragon_s_breath').roleName, 'Dragon’s Breath');
  assert.equal(seeds.find((spec) => spec.key === 'dragon_s_breath').color, 0xB71E99);
  assert.deepEqual(
    seeds.filter((spec) => ['sun_bloom', 'star_fruit'].includes(spec.key)).map((spec) => [spec.key, spec.roleName, spec.emoji, spec.color]),
    [
      ['sun_bloom', 'Sun Bloom', '<:sun_bloom:1525996662449766431>', 0xB71E99],
      ['star_fruit', 'Star Fruit', '<:star_fruit:1525996660000428112>', 0xB71E99],
    ],
  );
  assert.equal(seeds.find((spec) => spec.key === 'poison_ivy'), undefined);
  assert.equal(seeds.find((spec) => spec.key === 'horned_melon'), undefined);
  assert.equal(seeds.find((spec) => spec.key === 'glow_mushroom'), undefined);
  assert.equal(seeds.find((spec) => spec.key === 'ghost_pepper'), undefined);
  assert.equal(seeds.find((spec) => spec.key === 'baby_cactus'), undefined);
  assert.equal(emojiForType('seed', { key: 'poison_ivy' }), '<:poison_ivy:1525390125935366194>');
  assert.equal(emojiForType('sell', { key: 'horned_melon' }), '<:horned_melon:1525390123875831919>');
  assert.equal(emojiForType('seed', { key: 'glow_mushroom' }), '<:glow_mushroom:1525390121929805926>');
  assert.equal(emojiForType('sell', { key: 'ghost_pepper' }), '<:ghost_pepper:1525390119664750612>');
  assert.equal(emojiForType('seed', { key: 'baby_cactus' }), '<:baby_cactus:1525390117345427507>');
  assert.equal(colorForType('seed', { key: 'baby_cactus' }), 0x3E7EF4);
  assert.equal(colorForType('seed', { key: 'glow_mushroom' }), 0x9D3CD2);
  assert.equal(colorForType('seed', { key: 'poison_ivy' }), 0xE2AB0F);
  assert.equal(colorForType('seed', { key: 'ghost_pepper' }), 0xD62928);
  assert.equal(gear.find((spec) => spec.key === 'player_magnet').roleName, 'Player Magnet');
  assert.equal(gear.find((spec) => spec.key === 'player_magnet').color, 0xD62928);
  assert.equal(crate.find((spec) => spec.key === 'ladder_crate').rarity, 'common');
  assert.equal(crate.find((spec) => spec.key === 'spring_crate').rarity, 'epic');
  assert.equal(crate.find((spec) => spec.key === 'teleporter_pad_crate').rarity, 'mythic');
  assert.equal(sell.length, 16);
  assert.equal(sell.find((spec) => spec.key === 'moon_bloom'), undefined);
  const excludedSeedRoles = ['baby_cactus', 'horned_melon', 'glow_mushroom', 'poison_ivy', 'ghost_pepper', 'rocket_pop', 'eclipse_bloom'];
  const excludedGearRoles = ['sign', 'megaphone', 'lantern', 'teleporter', 'wheelbarrow', 'strawberry_sniper'];
  assert.ok(excludedSeedRoles.every((key) => !seeds.some((spec) => spec.key === key)));
  assert.ok(excludedGearRoles.every((key) => !gear.some((spec) => spec.key === key)));
  assert.equal(crate.some((spec) => spec.key === 'fourth_of_july_crate'), false);
  assert.equal(emojiForType('seed', { key: 'eclipse_bloom' }), '');
  assert.equal(emojiForType('sell', { key: 'eclipse_bloom' }), '<:eclipse_bloom:1526031940749361163>');
  assert.equal(colorForType('sell', { key: 'eclipse_bloom' }), 0xFFFFFF);
  assert.equal(sell.find((spec) => spec.key === 'common_2x').roleName, 'Common 2x');
  assert.equal(sell.find((spec) => spec.key === 'common_2x').emoji, '<:sheckles:1525368044824825976>');
  assert.equal(sell.find((spec) => spec.key === 'common_2x').color, 0xE2AB0F);
  assert.equal(sell.find((spec) => spec.key === 'super_4x').roleName, 'Super 4x');
  assert.equal(sell.find((spec) => spec.key === 'super_4x').color, 0x7DE3FF);
  assert.equal(sell.find((spec) => spec.key === 'secret_2x').roleName, 'Secret 2x');
  assert.equal(sell.find((spec) => spec.key === 'secret_4x').roleName, 'Secret 4x');
  assert.deepEqual(weather.map((spec) => [spec.key, spec.roleName, spec.color]), [
    ['lightning', 'Lightning', 0xFFD23F],
    ['sunburst', 'Sunburst', 0xFF8C42],
    ['starfall', 'Starfall', 0x8C7CFF],
    ['snowfall', 'Snowfall', 0xBDEBFF],
    ['rain', 'Rain', 0x4A90E2],
    ['rainbow_moon', 'Rainbow Moon', 0xC86BFA],
    ['rainbow', 'Rainbow', 0xFF5C8A],
    ['mega_moon', 'Mega Moon', 0xD9D7FF],
    ['goldmoon', 'Gold Moon', 0xF4C542],
    ['bloodmoon', 'Blood Moon', 0xB3202A],
    ['aurora', 'Aurora', 0x35E6A4],
    ['eclipse', 'Eclipse', 0x9B59FF],
  ]);
});

test('GAG2 Eclipse weather uses its emoji, role, and purple container', () => {
  const weather = parseWeatherPayload({
    weather: {
      current: { type: 'eclipse', name: 'Eclipse', endsAt: '2026-07-13T01:00:00.000Z' },
      recent: [{ key: 'eclipse', name: 'Eclipse', lastSeenAt: '2026-07-13T00:55:00.000Z' }],
    },
  });
  const payload = buildTypePayload('weather', weather, { roleIds: { eclipse: '123456789012345678' } });
  const content = payload.components[0].components[0].components[0].content;

  assert.equal(payload.components[0].accent_color, 0x9B59FF);
  assert.match(content, /Current: <:eclipse:1526025549858738287> <@&123456789012345678>/);
  assert.match(content, /<:eclipse:1526025549858738287> \*\*Eclipse\*\*/);
});

test('GAG2 role sync deletes unassigned category roles instead of only clearing ids', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'gag2Stock', 'manager.js'), 'utf8');
  assert.match(source, /async function clearDisabledTypeRoles\(guild, config, enabledTypes, roles, progress\)/);
  assert.match(source, /const enabledRoleIds = roleIdsForTypes\(config, enabledTypes\)/);
  assert.match(source, /enabledRoleIds\.has\(clean\)/);
  assert.match(source, /await role\.delete\(`CoinSprite GAG2 category unassigned`\)/);
  assert.match(source, /failedRoleIds\.add\(roleId\)/);
  assert.match(source, /failedRoleIds\.has\(roleId\)/);
  assert.match(source, /async function clearFilteredTypeRoles\(guild, config, enabledTypes, specsByType, roles, progress\)/);
  assert.match(source, /CoinSprite GAG2 rarity or multiplier filter disabled/);
  assert.match(source, /const filteredRemoval = await clearFilteredTypeRoles/);
  assert.doesNotMatch(source, /clearDisabledTypeRoleIds/);
});

test('GAG2 role creation and edits use the current Discord colors option', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'gag2Stock', 'manager.js'), 'utf8');
  assert.match(source, /createOptions\.colors = \{ primaryColor: color \}/);
  assert.match(source, /role\.edit\(\{\s*colors: \{ primaryColor: color \}/);
  assert.doesNotMatch(source, /createOptions\.color = color/);
  assert.doesNotMatch(source, /role\.edit\(\{\s*color,/);
});

test('GAG2 stock scheduler targets UTC+7 five-minute marks at second 5', () => {
  assert.equal(
    new Date(nextGag2StockTickAtMs(Date.parse('2026-07-10T17:00:00.000Z'))).toISOString(),
    '2026-07-10T17:00:05.000Z',
  );
  assert.equal(
    new Date(nextGag2StockTickAtMs(Date.parse('2026-07-10T17:00:06.000Z'))).toISOString(),
    '2026-07-10T17:05:05.000Z',
  );
  assert.equal(
    new Date(nextGag2StockTickAtMs(Date.parse('2026-07-10T17:04:59.000Z'))).toISOString(),
    '2026-07-10T17:05:05.000Z',
  );
  assert.equal(
    new Date(nextGag2StockTickAtMs(Date.parse('2026-07-10T17:05:05.000Z'))).toISOString(),
    '2026-07-10T17:10:05.000Z',
  );
});

test('GAG2 weather and moon use a separate 5 second polling loop', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'gag2Stock', 'manager.js'), 'utf8');
  assert.equal(WEATHER_CHECK_INTERVAL_MS, 5_000);
  assert.match(source, /scheduleWeatherTick\(this\.weatherInitialDelayMs\)/);
  assert.match(source, /this\.tick\(WEATHER_POST_TYPES, 'weather'\)/);
  assert.match(source, /this\.tick\(STOCK_POST_TYPES, 'stock'\)/);
  assert.match(source, /delayOverrideMs !== null && Number\.isFinite\(override\)/);
  assert.match(source, /const STOCK_POST_TYPES = Object\.freeze\(\[\.\.\.STOCK_TYPE_GROUPS\.stock\]\)/);
  assert.match(source, /const WEATHER_POST_TYPES = Object\.freeze\(\[\.\.\.STOCK_TYPE_GROUPS\.weather\]\)/);
  assert.doesNotMatch(source, /LIVE_POST_TYPES|scheduleLiveTick|liveTimer|LIVE_CHECK_INTERVAL_MS/);
});

test('GAG2 refresh gaps retry every second', () => {
  assert.equal(SELL_UNCHANGED_RETRY_MS, 1_000);
  assert.equal(STALE_STOCK_RETRY_MS, 1_000);
});

test('GAG2 stock and sell schedules prefer API refresh timestamps', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'gag2Stock', 'manager.js'), 'utf8');
  assert.match(source, /scheduleNextTick\(this\.stockInitialDelayMs\)/);
  assert.match(source, /scheduleSellTick\(this\.sellInitialDelayMs\)/);
  assert.match(source, /nextStockRefreshAtMs/);
  assert.match(source, /nextSellRefreshAtMs/);
  assert.match(source, /nextApiRefreshAtMsForTypes/);
  assert.match(source, /scheduleSellTick\(\)/);
  assert.match(source, /this\.tick\(SELL_POST_TYPES, 'sell'\)/);
  assert.match(source, /const SELL_POST_TYPES = Object\.freeze\(\[\.\.\.STOCK_TYPE_GROUPS\.sell\]\)/);

  const now = Date.parse('2026-07-10T17:00:00.000Z');
  const stockPoster = new Gag2StockPoster({}, { now: () => now });
  stockPoster.started = true;
  stockPoster.nextStockRefreshAtMs = Date.parse('2026-07-10T17:04:00.000Z');
  assert.equal(
    new Date(stockPoster.scheduleNextTick()).toISOString(),
    '2026-07-10T17:04:00.000Z',
  );
  stockPoster.stop();

  const sellPoster = new Gag2StockPoster({}, { now: () => now });
  sellPoster.started = true;
  sellPoster.nextSellRefreshAtMs = Date.parse('2026-07-10T17:10:00.000Z');
  assert.equal(
    new Date(sellPoster.scheduleSellTick()).toISOString(),
    '2026-07-10T17:10:00.000Z',
  );
  sellPoster.stop();
});

test('GAG2 sell unchanged post only arms the rapid retry when API refresh is due', async () => {
  const now = Date.parse('2026-07-10T17:00:00.000Z');
  const dueSell = parseSellPayload({
    sell: {
      nextRefreshUnix: Math.floor((now - 1_000) / 1000),
      entries: [
        { key: 'tomato', name: 'Tomato', multiplier: 1.1, tier: 'normal' },
      ],
    },
  });
  const futureSell = parseSellPayload({
    sell: {
      nextRefreshUnix: Math.floor((now + 60_000) / 1000),
      entries: [
        { key: 'tomato', name: 'Tomato', multiplier: 1.1, tier: 'normal' },
      ],
    },
  });
  const poster = new Gag2StockPoster({
    channels: {
      cache: new Map(),
      fetch: async () => null,
    },
  }, {
    now: () => now,
    sellUnchangedRetryMs: SELL_UNCHANGED_RETRY_MS,
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
  };
  const state = {
    posts: {
      [target.guildId]: {
        sell: {
          channelId: target.channelId,
          lastPostedKey: buildTypePostKey('sell', dueSell),
        },
      },
    },
  };

  assert.equal(await poster.postEntry(state, target, dueSell), null);
  assert.equal(poster.nextSellDelayOverrideMs, SELL_UNCHANGED_RETRY_MS);
  poster.nextSellDelayOverrideMs = null;
  assert.equal(await poster.postEntry(state, target, futureSell), null);
  assert.equal(poster.nextSellDelayOverrideMs, null);
});

test('GAG2 sell skips an expired API snapshot and posts the fresh cycle only once', async () => {
  const now = Date.parse('2026-07-10T17:00:10.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-sell-cycle-state.json');
  fs.rmSync(statePath, { force: true });
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
    roleIds: {},
    filters: DEFAULT_GAG2_STOCK_CONFIG.filters,
  };
  const expired = parseSellPayload({
    sell: {
      nextRefreshUnix: Math.floor((now - 1_000) / 1000),
      entries: [{ key: 'tomato', name: 'Tomato', multiplier: 1.05, rarity: 'Uncommon', tier: 'normal' }],
    },
  });
  const fresh = parseSellPayload({
    sell: {
      nextRefreshUnix: Math.floor((now + 10 * 60_000) / 1000),
      entries: [{ key: 'tomato', name: 'Tomato', multiplier: 1.15, rarity: 'Uncommon', tier: 'normal' }],
    },
  });
  let current = expired;
  const sent = [];
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: { fetch: async () => new Map() },
    send: async (payload) => {
      sent.push(payload);
      return { id: `message-${sent.length}` };
    },
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, {
    now: () => now,
    statePath,
    sellUnchangedRetryMs: SELL_UNCHANGED_RETRY_MS,
    fetchSellPayload: async () => current,
  });
  poster.targets = () => [target];

  await poster.tick(['sell'], 'sell');
  assert.equal(sent.length, 0);
  assert.equal(poster.nextSellDelayOverrideMs, SELL_UNCHANGED_RETRY_MS);

  current = fresh;
  await poster.tick(['sell'], 'sell');
  await poster.tick(['sell'], 'sell');
  assert.equal(sent.length, 1);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 sell restores duplicate state from a recent matching Discord message after restart', async () => {
  const now = Date.parse('2026-07-10T17:02:00.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-sell-restart-state.json');
  fs.rmSync(statePath, { force: true });
  const entry = parseSellPayload({
    sell: {
      nextRefreshUnix: Math.floor((now + 8 * 60_000) / 1000),
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.1, rarity: 'Common', tier: 'normal' }],
    },
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  const previousPayload = buildTypePayload('sell', entry, { roleIds: {} });
  let sends = 0;
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: {
      fetch: async () => new Map([['existing-message', {
        id: 'existing-message',
        author: { id: '123456789012345678', bot: true },
        createdTimestamp: now - 5_000,
        components: previousPayload.components,
      }]]),
    },
    send: async () => {
      sends += 1;
      return { id: `message-${sends}` };
    },
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { now: () => now, statePath });
  const state = { posts: {} };

  assert.equal(await poster.postEntry(state, target, entry), null);
  assert.equal(sends, 0);
  assert.equal(state.posts[target.guildId].sell.lastMessageId, 'existing-message');
  assert.equal(state.posts[target.guildId].sell.lastPostedKey, buildTypePostKey('sell', entry));
  fs.rmSync(statePath, { force: true });
});

test('GAG2 stock poster treats expired restock stock as stale', () => {
  const now = Date.parse('2026-07-10T17:00:51.000Z');
  assert.equal(isStaleStockEntry('seed', { nextRestockAtMs: now - 1 }, now), true);
  assert.equal(isStaleStockEntry('gear', { nextRestockAtMs: now }, now), true);
  assert.equal(isStaleStockEntry('crate', { nextRestockAtMs: now + 1 }, now), false);
  assert.equal(isStaleStockEntry('sell', { nextRestockAtMs: now - 1 }, now), false);
  assert.equal(isStaleStockEntry('weather', { nextRestockAtMs: now - 1 }, now), false);
});

test('GAG2 source uses a 5s timeout and retries transient aborts', async () => {
  let calls = 0;
  const payload = await fetchJson('https://example.test/gag2', {
    retryDelayMs: 0,
    retries: 1,
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.ok(options.signal);
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers['cache-control'], 'no-cache');
      assert.equal(options.headers.pragma, 'no-cache');
      if (calls === 1) {
        const error = new Error('This operation was aborted');
        error.name = 'AbortError';
        throw error;
      }
      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    },
  });

  assert.equal(REQUEST_TIMEOUT_MS, 5_000);
  assert.equal(calls, 2);
  assert.deepEqual(payload, { ok: true });
});

test('GAG2 poster keeps the previous good message for temporary source failures', async () => {
  const sent = [];
  const channel = {
    isTextBased: () => true,
    send: async (payload) => {
      sent.push(payload);
      return { id: `message-${sent.length}` };
    },
  };
  const client = {
    channels: {
      cache: new Map([['1525003375651848263', channel]]),
      fetch: async () => null,
    },
  };
  const statePath = path.join(__dirname, 'tmp-gag2-transient-state.json');
  fs.rmSync(statePath, { force: true });
  const poster = new Gag2StockPoster(client, {
    now: () => Date.parse('2026-07-11T12:00:00.000Z'),
    statePath,
    transientUnavailableNoticeFailures: 3,
  });
  const state = {
    posts: {
      '1493901002519347290': {
        sell: { lastPostedKey: 'sell:previous-good-stock' },
      },
    },
  };
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
  };
  const error = new Error('GAG2 source timed out after 3 attempts (5s each)');
  error.gag2Transient = true;

  assert.equal(await poster.postUnavailableOnce(state, target, error), null);
  assert.equal(await poster.postUnavailableOnce(state, target, error), null);
  const message = await poster.postUnavailableOnce(state, target, error);

  assert.equal(sent.length, 1);
  assert.equal(message.id, 'message-1');
  assert.equal(state.unavailable[target.guildId].sell.consecutiveFailures, 3);
  fs.rmSync(statePath, { force: true });
});
