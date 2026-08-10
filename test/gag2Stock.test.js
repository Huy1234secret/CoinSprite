const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');

const {
  buildPostKey,
  buildStockPayload,
  buildTypePayload,
  buildTypePayloads,
  buildTypePostKey,
  displayableTextSize,
  nextCycleRestockAtMs,
  parseSellPayload,
  parseRestockPayload,
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
  CHECK_SCHEDULE_SECOND_MS,
  FALL_HARVEST_END_AT_MS,
  FALL_SELL_API_URL,
  FALL_STOCK_API_URL,
  REQUEST_TIMEOUT_MS,
  SELL_UNCHANGED_RETRY_MS,
  SELL_API_URL,
  SELL_CHECK_INTERVAL_MS,
  SELL_CHECK_SCHEDULE_SECOND_MS,
  SELL_FAILURE_RETRY_LIMIT,
  STOCK_API_URL,
  STOCK_FAILURE_RETRY_LIMIT,
  STOCK_FAILURE_RETRY_MS,
  WEATHER_CHECK_INTERVAL_MS,
  isFallHarvestActive,
} = require('../src/gag2Stock/config');
const { fetchFallSellPayload, fetchFallStockPayload, fetchJson, fetchStockPayload } = require('../src/gag2Stock/source');
const { colorForType, emojiForType, roleSpecsForType } = require('../src/gag2Stock/catalog');
const { buildRoleAssignmentPanelPayload, ROLE_ASSIGN_TYPES } = require('../src/gag2Stock/roleAssignment');
const { Gag2StockPoster, activeFallTypes, currentGag2StockCycleAtMs, diagnosePostPermissions, filterSellEntry, filteredRoleSpecs, isInactiveWeatherEntry, isRecentUnavailableMessage, nextGag2StockTickAtMs } = require('../src/gag2Stock/manager');

function testPermissions(...flags) {
  const allowed = new Set(flags);
  return { has: (flag) => allowed.has(flag) };
}

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

test('GAG2 uses the new world-aware Garden Valley and Fall Harvest endpoints', () => {
  assert.equal(STOCK_API_URL, 'https://gag.gg/api/seed-restock?world=main');
  assert.equal(FALL_STOCK_API_URL, 'https://gag.gg/api/seed-restock?world=fall');
  assert.equal(SELL_API_URL, 'https://gag.gg/api/fruit-stock?world=main');
  assert.equal(FALL_SELL_API_URL, FALL_STOCK_API_URL);
});

test('GAG2 never mixes a legacy stock source into a failed gag.gg cycle', async () => {
  const requested = [];
  await assert.rejects(fetchStockPayload({
    retries: 0,
    fetchImpl: async (url) => {
      requested.push(url);
      return { ok: false, status: 403 };
    },
  }), /HTTP 403/);

  assert.deepEqual(requested, [STOCK_API_URL]);
});

test('GAG2 reads Fall stock only from the Fall restock endpoint', async () => {
  const requested = [];
  const window = 1785639300;
  const parsed = await fetchFallStockPayload({
    retries: 0,
    fetchImpl: async (url) => {
      requested.push(url);
      return { ok: true, json: async () => ({
        world: 'fall',
        window,
        seeds: [{ name: 'Maple Apple', slug: 'maple-apple', lastStockedAt: window, lastQty: 2 }],
        gears: [{ name: 'Harp', slug: 'harp', lastStockedAt: window, lastQty: 1 }],
        props: [{ name: 'Rake Crate', slug: 'rake-crate', lastStockedAt: window, lastQty: 1 }],
      }) };
    },
  });

  assert.deepEqual(requested, [FALL_STOCK_API_URL]);
  assert.deepEqual(parsed.stock.map((entry) => entry.items.map((item) => item.key)), [
    ['maple_apple'],
    ['harp'],
    ['rake_crate'],
  ]);
});

test('GAG2 reads embedded Fall sell prices from the Fall restock endpoint', async () => {
  const requested = [];
  const parsed = await fetchFallSellPayload({
    retries: 0,
    fetchImpl: async (url) => {
      requested.push(url);
      return {
        ok: true,
        json: async () => ({ window: 1785639300, sellPrices: [
          { key: 'carrot', name: 'Carrot', multiplier: 2 },
          { key: 'maple_apple', name: 'Maple Apple', currentMultiplier: 2 },
          { key: 'romanesco', name: 'Romanesco', sellMultiplier: 1.1 },
        ] }),
      };
    },
  });

  assert.deepEqual(requested, [FALL_STOCK_API_URL]);
  assert.deepEqual(parsed.entries.map((entry) => entry.key), ['maple_apple', 'romanesco']);
});

test('GAG2 parses the new restock response shape for each world', () => {
  const window = 1785639300;
  const parsed = parseRestockPayload({
    world: 'fall',
    window,
    seeds: [
      { name: 'Maple Carrot', slug: 'maple-carrot', lastStockedAt: window, lastQty: 3, inStockNow: true },
      { name: 'Romanesco', slug: 'romanesco', lastStockedAt: window - 300, lastQty: 1, inStockNow: false },
    ],
    gears: [{ name: 'Harp', slug: 'harp', lastStockedAt: window, lastQty: 1, inStockNow: true }],
    props: [{ name: 'Rake Crate', slug: 'rake-crate', lastStockedAt: window, lastQty: 2, inStockNow: true }],
  }, { world: 'fall' });

  assert.equal(parsed.world, 'fall');
  assert.equal(parsed.stock[0].nextRestockAtMs, (window + 300) * 1000);
  assert.deepEqual(parsed.stock[0].items.map((item) => [item.key, item.quantity]), [['maple_carrot', 3]]);
  assert.deepEqual(parsed.stock[1].items.map((item) => item.key), ['harp']);
  assert.deepEqual(parsed.stock[2].items.map((item) => item.key), ['rake_crate']);
});

test('GAG2 ignores stale props marked in stock when their timestamp is from an older window', () => {
  const window = 1785639300;
  const parsed = parseRestockPayload({
    world: 'main',
    window,
    seeds: [],
    gears: [],
    props: [
      { name: 'Bench', slug: 'bench', lastStockedAt: window - 300, lastQty: 2, inStockNow: true },
      { name: 'Boombox', slug: 'boombox', lastStockedAt: window, lastQty: 1, inStockNow: true },
    ],
  });

  assert.deepEqual(parsed.stock[2].items.map((item) => item.key), ['boombox']);
});

test('GAG2 keeps Fall-only items out of Garden Valley until the event type is enabled', () => {
  const main = parseRestockPayload({
    world: 'main',
    window: 1785639300,
    seeds: [
      { name: 'Tulip', slug: 'tulip', lastStockedAt: 1785639300, lastQty: 3, inStockNow: true },
      { name: 'Maple Apple', slug: 'maple-apple', lastStockedAt: 1785639300, lastQty: 1, inStockNow: true },
    ],
    gears: [
      { name: 'Trowel', slug: 'trowel', lastStockedAt: 1785639300, lastQty: 1, inStockNow: true },
      { name: 'Harp', slug: 'harp', lastStockedAt: 1785639300, lastQty: 1, inStockNow: true },
    ],
    props: [{ name: 'Rake Crate', slug: 'rake-crate', lastStockedAt: 1785639300, lastQty: 1, inStockNow: true }],
  }, { world: 'main' });
  const fall = parseRestockPayload({
    world: 'fall',
    window: 1785639300,
    seeds: [{ name: 'Maple Apple', slug: 'maple-apple', lastStockedAt: 1785639300, lastQty: 1, inStockNow: true }],
    gears: [{ name: 'Harp', slug: 'harp', lastStockedAt: 1785639300, lastQty: 1, inStockNow: true }],
    props: [{ name: 'Rake Crate', slug: 'rake-crate', lastStockedAt: 1785639300, lastQty: 1, inStockNow: true }],
  }, { world: 'fall' });

  assert.deepEqual(main.stock[0].items.map((item) => item.key), ['tulip']);
  assert.deepEqual(main.stock[1].items.map((item) => item.key), ['trowel']);
  assert.deepEqual(main.stock[2].items, []);
  assert.deepEqual(fall.stock.map((entry) => entry.items.map((item) => item.key)), [
    ['maple_apple'],
    ['harp'],
    ['rake_crate'],
  ]);
});

test('GAG2 keeps Fall-only sell prices out of Garden Valley', () => {
  const entries = [
    { name: 'Carrot', slug: 'carrot', multiplier: 1.5 },
    { name: 'Maple Apple', slug: 'maple-apple', multiplier: 2 },
  ];
  const main = parseSellPayload({ world: 'main', entries }, { world: 'main' });
  const fall = parseSellPayload({ world: 'fall', entries }, { world: 'fall' });

  assert.deepEqual(main.entries.map((item) => item.key), ['carrot']);
  assert.deepEqual(fall.entries.map((item) => item.key), ['maple_apple']);
});

test('GAG2 Fall sell reuses Garden Valley multiplier roles', () => {
  const main = parseSellPayload({ entries: [{ name: 'Carrot', slug: 'carrot', multiplier: 2 }] }, { world: 'main' });
  const fall = parseSellPayload({ entries: [
    { name: 'Maple Apple', slug: 'maple-apple', multiplier: 2 },
    { name: 'Romanesco', slug: 'romanesco', multiplier: 1.1 },
  ] }, { world: 'fall' });
  const roleId = '123456789012345678';
  const payload = buildTypePayload('sell', { ...main, fall }, {
    roleIds: { uncommon_2x: roleId },
    fallRoleIds: { maple_apple: '987654321098765432' },
  });
  const content = JSON.stringify(payload.components);
  const fallContent = payload.components.find((component) => component.accent_color === 0xC96F2B).components[0].content;

  assert.match(content, /FALL HARVEST/);
  assert.match(content, new RegExp(`<@&${roleId}>`));
  assert.match(fallContent, new RegExp(`<@&${roleId}>`));
  assert.doesNotMatch(fallContent, /987654321098765432/);
  assert.deepEqual(payload.allowedMentions.roles, [roleId]);
});

test('GAG2 appends Fall Harvest items and roles to the same Garden Valley stock message', () => {
  const main = parseStockPayload(fixture()).stock.find((entry) => entry.category === 'seed');
  const fall = parseRestockPayload({
    world: 'fall',
    window: 1785639300,
    seeds: [
      { name: 'Amber Cranberry', slug: 'amber-cranberry', lastStockedAt: 1785639300, lastQty: 1, inStockNow: true },
      { name: 'Conifer Cone', slug: 'conifer-cone', lastStockedAt: 1785639300, lastQty: 2, inStockNow: true },
    ],
    gears: [],
    props: [],
  }, { world: 'fall' }).stock[0];
  const payload = buildTypePayload('seed', { ...main, fall }, {
    roleIds: {},
    fallRoleIds: { conifer_cone: '123456789012345678' },
  });
  const content = payload.components[0].components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');

  assert.equal(payload.components.filter((component) => component.type === 17).length, 1);
  assert.match(content, /-# \*\*🌿GARDEN VALLEY🌻\*\*/);
  assert.match(content, /-# \*\*🍂FALL HARVEST🍁\*\*/);
  assert.match(content, /<:ambercranberry:1533299246315475045> \*\*Amber Cranberry\*\* x1/);
  assert.match(content, /<:conifercone:1533299251638042787> <@&123456789012345678> x2/);
  assert.deepEqual(payload.allowedMentions.roles, ['123456789012345678']);
  assert.notEqual(buildTypePostKey('seed', main), buildTypePostKey('seed', { ...main, fall }));
});

test('GAG2 Fall Harvest role catalog uses item emojis and rarity colors', () => {
  const coniferCone = roleSpecsForType('fallSeed').find((spec) => spec.key === 'conifer_cone');
  const amberCranberry = roleSpecsForType('fallSeed').find((spec) => spec.key === 'amber_cranberry');
  const rakeCrate = roleSpecsForType('fallCrate').find((spec) => spec.key === 'rake_crate');
  assert.deepEqual(
    { emoji: coniferCone.emoji, rarity: coniferCone.rarity, color: coniferCone.color },
    { emoji: '<:conifercone:1533299251638042787>', rarity: 'mythic', color: 0xD62928 },
  );
  const mapleAppleSell = roleSpecsForType('fallSell').find((spec) => spec.key === 'maple_apple');
  assert.equal(mapleAppleSell.emoji, '<:mapleapple:1533299264757825536>');
  assert.equal(mapleAppleSell.roleName, 'Fall Sell · Maple Apple');
  assert.equal(roleSpecsForType('fallSeed').some((spec) => ['potato', 'cinnamon_stick', 'honeysuckle', 'plum', 'romanesco'].includes(spec.key)), false);
  assert.equal(emojiForType('fallSell', { key: 'romanesco' }), '<:romanesco:1533299314363732089>');
  assert.equal(amberCranberry.color, 0xB71E99);
  assert.equal(rakeCrate.color, 0xE2AB0F);
});

test('GAG2 role assignment panel separates Garden Valley and Fall buttons', () => {
  const payload = buildRoleAssignmentPanelPayload({ gag2Stock: { channels: {}, roleIds: {} } });
  const components = payload.components[0].components;
  const text = components.filter((component) => component.type === 10).map((component) => component.content).join('\n');
  const buttons = components.flatMap((component) => component.components || []).map((component) => component.custom_id).filter(Boolean);

  assert.match(text, /-# \*\*🌿GARDEN VALLEY🌻\*\*/);
  assert.match(text, /-# \*\*🍂FALL HARVEST🍁\*\*/);
  assert.equal(components.filter((component) => component.type === 14).length, 2);
  assert.equal(ROLE_ASSIGN_TYPES.includes('fallSell'), false);
  assert.equal(buttons.some((id) => id.endsWith(':fallSell')), false);
});

test('GAG2 stock payload normalizes API stock and sorts by catalog order', () => {
  const parsed = parseStockPayload(fixture());

  assert.equal(parsed.stock.length, 3);
  assert.equal(parsed.stock[0].category, 'seed');
  assert.deepEqual(parsed.stock[0].items.map((item) => item.name), ['Carrot', 'Grape']);
  assert.match(buildPostKey(parsed), /^seed:/);
});

test('GAG2 stock payload builds a Components V2 container without source footer text', () => {
  const parsed = parseStockPayload(fixture());
  const payload = buildStockPayload(parsed, { sourceUrl: STOCK_API_URL });
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

test('GAG2 notification payloads end with the Fall Harvest dashboard link button', () => {
  const parsed = parseStockPayload(fixture());
  const seed = parsed.stock.find((entry) => entry.category === 'seed');
  const payload = buildTypePayload('seed', seed);
  const container = payload.components.at(-1);
  const row = container.components.at(-1);
  const button = row.components[0];

  assert.equal(container.type, 17);
  assert.equal(row.type, 1);
  assert.deepEqual(button, {
    type: 2,
    style: 5,
    label: 'Config Fall Harvest stock notify! [NEW]',
    emoji: { name: '🍂' },
    url: 'https://panel.coin-sprite.com/',
  });

  const combined = buildStockPayload(parsed);
  assert.deepEqual(combined.components.at(-1).components.at(-1), row);
});

test('GAG2 stock dedupe posts every new cycle and ignores same-cycle quantity changes', () => {
  for (const category of ['seed', 'gear', 'crate']) {
    const base = parseStockPayload({
      stock: [{
        category,
        restockedAt: '2026-07-10T16:00:00.000Z',
        nextRestockAt: '2026-07-10T16:05:00.000Z',
        items: [{ key: 'test_item', name: 'Test Item', quantity: 1 }],
      }],
    }).stock[0];
    const sameCycleRetimed = parseStockPayload({
      stock: [{
        category,
        restockedAt: '2026-07-10T16:00:00.000Z',
        nextRestockAt: '2026-07-10T16:06:00.000Z',
        items: [{ key: 'test_item', name: 'Test Item', quantity: 1 }],
      }],
    }).stock[0];
    const nextCycle = parseStockPayload({
      stock: [{
        category,
        restockedAt: '2026-07-10T16:05:00.000Z',
        nextRestockAt: '2026-07-10T16:10:00.000Z',
        items: [{ key: 'test_item', name: 'Test Item', quantity: 1 }],
      }],
    }).stock[0];
    const changed = parseStockPayload({
      stock: [{
        category,
        restockedAt: '2026-07-10T16:00:00.000Z',
        nextRestockAt: '2026-07-10T16:05:00.000Z',
        items: [{ key: 'test_item', name: 'Test Item', quantity: 2 }],
      }],
    }).stock[0];

    assert.equal(buildTypePostKey(category, base), buildTypePostKey(category, sameCycleRetimed));
    assert.notEqual(buildTypePostKey(category, base), buildTypePostKey(category, nextCycle));
    assert.equal(buildTypePostKey(category, base), buildTypePostKey(category, changed));
  }
});

test('GAG2 replaces the previous-cycle restock timer with the next five-minute boundary', () => {
  const window = Date.parse('2026-08-02T06:10:00.000Z');
  const parsed = parseRestockPayload({
    window: Math.floor(window / 1000),
    nextRestock: Math.floor(window / 1000),
    seeds: [{ name: 'Carrot', slug: 'carrot', lastStockedAt: Math.floor(window / 1000), lastQty: 1, inStockNow: true }],
    gears: [],
    props: [],
  });

  assert.equal(parsed.stock[0].restockedAtMs, window);
  assert.equal(parsed.stock[0].nextRestockAtMs, window + 5 * 60 * 1000);
  assert.equal(nextCycleRestockAtMs(window, window), window + 5 * 60 * 1000);
});

test('GAG2 splits oversized Components V2 sell output into ordered messages', () => {
  const entries = Array.from({ length: 140 }, (_, index) => ({
    key: `fruit_${index}`,
    name: `Very Long Garden Fruit ${index}`,
    multiplier: 1.25,
    rarity: 'Common',
    tier: 'normal',
  }));
  const payloads = buildTypePayloads('sell', { entries, enabledMultipliers: ['normal'] });
  const combined = payloads.map((payload) => JSON.stringify(payload.components)).join('\n');

  assert.ok(payloads.length > 1);
  assert.ok(payloads.every((payload) => payload.components.reduce((total, component) => total + displayableTextSize(component), 0) <= 3_900));
  assert.match(combined, /Very Long Garden Fruit 0/);
  assert.match(combined, /Very Long Garden Fruit 139/);
  const buttonRows = payloads
    .flatMap((payload) => payload.components)
    .flatMap((container) => container.components || [])
    .filter((component) => component.type === 1);
  assert.equal(buttonRows.length, 1);
  assert.equal(payloads.at(-1).components.at(-1).components.at(-1).components[0].url, 'https://panel.coin-sprite.com/');
});

test('GAG2 sell header shows the refresh timer and Garden Valley before Fall Harvest', () => {
  const nextRefreshAtMs = Date.parse('2026-08-02T15:20:00.000Z');
  const main = parseSellPayload({
    nextRefresh: Math.floor(nextRefreshAtMs / 1000),
    entries: [{ name: 'Carrot', slug: 'carrot', multiplier: 1.1 }],
  });
  const fall = parseSellPayload({
    world: 'fall',
    nextRefresh: Math.floor(nextRefreshAtMs / 1000),
    entries: [{ name: 'Amber Cranberry', slug: 'amber-cranberry', multiplier: 2 }],
  }, { world: 'fall' });
  const payload = buildTypePayload('sell', { ...main, fall });
  const text = payload.components
    .flatMap((component) => component.components || [])
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');

  assert.match(text, new RegExp(`## GAG2 Sell Price Track\\n-# Refresh <t:${Math.floor(nextRefreshAtMs / 1000)}:R>\\n-# \\*\\*🌿GARDEN VALLEY🌻\\*\\*`));
  assert.match(text, /-# \*\*🍂FALL HARVEST🍁\*\*/);
  assert.equal((text.match(/-# Refresh/g) || []).length, 1);
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
  const mainSellContainer = sellPayload.components.find((component) => component.accent_color === 0xFFFFFF);
  assert.ok(mainSellContainer);
  assert.match(mainSellContainer.components[0].content, /\* <:tomato:1525195241026617435> \*\*Tomato\*\* x1.10/);
  assert.match(mainSellContainer.components[0].content, /\* <:glow_mushroom:1525390121929805926> \*\*Glow Mushroom\*\* x1.05/);
  assert.match(mainSellContainer.components[0].content, /\* <:eclipse_bloom:1526031940749361163> \*\*Eclipse Bloom\*\* x1.25/);
  assert.doesNotMatch(mainSellContainer.components[0].content, /Briar Rose/);
  assert.doesNotMatch(mainSellContainer.components[0].content, /<:mushroom:1525195225511760072>| - normal| - big/);
  assert.doesNotMatch(mainSellContainer.components[0].content, /<@&345678901234567890>|<@&456789012345678901>|^## <:tomato/m);
});

test('GAG2 combines Rare, Mythic, and Secret sell subscriptions into one notification', () => {
  const sell = parseSellPayload({
    sell: {
      nextRefreshUnix: 1785642600,
      entries: [
        { key: 'corn', name: 'Corn', multiplier: 2, rarity: 'Rare', tier: 'big' },
        { key: 'venom_spitter', name: 'Venom Spitter', multiplier: 2, rarity: 'Mythic', tier: 'big' },
        { key: 'eclipse_bloom', name: 'Eclipse Bloom', multiplier: 2, rarity: 'Secret', tier: 'big' },
      ],
    },
  });
  const payloads = buildTypePayloads('sell', sell, {
    roleIds: {
      rare_2x: '111111111111111111',
      mythic_2x: '222222222222222222',
      secret_2x: '333333333333333333',
    },
  });

  assert.equal(payloads.length, 1);
  const text = JSON.stringify(payloads[0].components);
  assert.match(text, /<@&111111111111111111> <@&222222222222222222> <@&333333333333333333> Sell Price/);
  assert.deepEqual(payloads[0].allowedMentions.roles, [
    '111111111111111111',
    '222222222222222222',
    '333333333333333333',
  ]);
});

test('GAG2 de-duplicates repeated sell subscription role IDs', () => {
  const sell = parseSellPayload({
    sell: {
      nextRefreshUnix: 1785642600,
      entries: [
        { key: 'corn', name: 'Corn', multiplier: 2, rarity: 'Rare', tier: 'big' },
        { key: 'venom_spitter', name: 'Venom Spitter', multiplier: 2, rarity: 'Mythic', tier: 'big' },
        { key: 'eclipse_bloom', name: 'Eclipse Bloom', multiplier: 2, rarity: 'Secret', tier: 'big' },
      ],
    },
  });
  const sharedRoleId = '111111111111111111';
  const payloads = buildTypePayloads('sell', sell, {
    roleIds: { rare_2x: sharedRoleId, mythic_2x: sharedRoleId, secret_2x: sharedRoleId },
  });

  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].allowedMentions.roles, [sharedRoleId]);
  const heading = payloads[0].components[0].components[0].content.split('\n')[0];
  assert.equal((heading.match(new RegExp(sharedRoleId, 'g')) || []).length, 1);
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
  const content = payload.components.find((component) => component.accent_color === 0xFFFFFF).components[0].content;

  assert.match(content, /<:sun_bloom:1525996662449766431> \*\*Sun Bloom\*\*/);
  assert.match(content, /<:star_fruit:1525996660000428112> \*\*Star Fruit\*\*/);
  assert.equal(content.split('\n').length, entries.length + 3);
});

test('GAG2 filters default to every supported rarity and sell multiplier', () => {
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.rarities.seed, GAG2_ROLE_FILTER_RARITIES);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.rarities.gear, GAG2_ROLE_FILTER_RARITIES);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.rarities.crate, GAG2_ROLE_FILTER_RARITIES);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.rarities.sell, GAG2_SELL_FILTER_RARITIES);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.sellMultipliers, GAG2_SELL_MULTIPLIERS);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.fall.sellMultipliers, ['normal', '2x', '4x']);
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.roleItems.seed, roleSpecsForType('seed').map((spec) => spec.key));
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.roleItems.gear, roleSpecsForType('gear').map((spec) => spec.key));
  assert.deepEqual(DEFAULT_GAG2_STOCK_CONFIG.filters.roleItems.crate, roleSpecsForType('crate').map((spec) => spec.key));
});

test('GAG2 migrates legacy Garden Valley rarity filters to matching item selections', () => {
  const config = normalizeGag2StockConfig({
    filters: {
      rarities: { seed: ['common'], gear: ['rare'], crate: ['legendary'], sell: ['common'] },
    },
  });

  assert.deepEqual(config.filters.roleItems.seed, ['carrot', 'strawberry', 'blueberry']);
  assert.deepEqual(
    config.filters.roleItems.gear,
    roleSpecsForType('gear').filter((spec) => spec.rarity === 'rare').map((spec) => spec.key),
  );
  assert.deepEqual(
    config.filters.roleItems.crate,
    roleSpecsForType('crate').filter((spec) => spec.rarity === 'legendary').map((spec) => spec.key),
  );
});

test('GAG2 Fall Harvest config keeps valid event types and exact opt-in item roles', () => {
  const normalized = normalizeGag2StockConfig({
    channels: { seed: '123456789012345678' },
    fall: {
      enabledTypes: ['seed', 'sell', 'weather'],
      sellMultipliers: ['4x', 'normal'],
      roleItems: {
        seed: ['maple_carrot', 'conifer_cone', 'romanesco', 'not_real'],
        sell: ['amber_cranberry'],
      },
    },
  });
  assert.deepEqual(normalized.fall.enabledTypes, ['seed', 'sell']);
  assert.deepEqual(normalized.fall.roleItems.seed, ['maple_carrot', 'conifer_cone']);
  assert.equal(normalized.fall.roleItems.sell, undefined);
  assert.deepEqual(normalized.fall.sellMultipliers, ['normal', '4x']);
  assert.deepEqual(normalized.fall.roleItems.gear, []);
});

test('GAG2 Fall Harvest role filtering creates only explicitly selected item roles', () => {
  const specs = roleSpecsForType('fallSeed');
  const filtered = filteredRoleSpecs('fallSeed', specs, {
    fall: { roleItems: { seed: ['conifer_cone', 'maple_carrot'] } },
  });
  assert.deepEqual(filtered.map((spec) => spec.key), ['maple_carrot', 'conifer_cone']);
});

test('GAG2 filter config preserves empty choices and removes unsupported values', () => {
  const config = normalizeGag2StockConfig({
    filters: {
      rarities: { seed: [], gear: ['rare', 'invalid'], crate: ['super'], sell: ['secret', 'common', 'invalid'] },
      roleItems: { seed: ['carrot', 'grape', 'not_real'], gear: [], crate: ['ladder_crate'] },
      sellMultipliers: ['4x', 'invalid'],
    },
  });
  assert.deepEqual(config.filters.rarities.seed, []);
  assert.deepEqual(config.filters.rarities.gear, ['rare']);
  assert.deepEqual(config.filters.rarities.crate, ['super']);
  assert.deepEqual(config.filters.rarities.sell, ['common', 'secret']);
  assert.deepEqual(config.filters.sellMultipliers, ['4x']);
  assert.deepEqual(config.filters.roleItems.seed, ['carrot', 'grape']);
  assert.deepEqual(config.filters.roleItems.gear, []);
  assert.deepEqual(config.filters.roleItems.crate, ['ladder_crate']);
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
  assert.equal(payload.components.filter((component) => component.type === 17).length, 1);
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

test('GAG2 Garden Valley role filters retain individual items inside an enabled rarity', () => {
  const seedSpecs = filteredRoleSpecs('seed', roleSpecsForType('seed'), {
    rarities: { seed: ['common'] },
    roleItems: { seed: ['carrot', 'blueberry'] },
  });

  assert.deepEqual(seedSpecs.map((spec) => spec.key), ['carrot', 'blueberry']);
});

test('GAG2 weather post key changes only for current weather identity, not timestamps or recent history', () => {
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
  const currentTimestampsChanged = parseWeatherPayload({
    weather: {
      current: { type: 'goldmoon', name: 'Goldmoon', startsAt: '2026-07-10T16:01:00.000Z', endsAt: '2026-07-10T16:08:00.000Z' },
      recent: [
        { key: 'rainbow', name: 'Rainbow', lastSeenAt: '2026-07-10T15:56:00.000Z' },
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
  assert.equal(buildTypePostKey('weather', base), buildTypePostKey('weather', currentTimestampsChanged));
  assert.notEqual(buildTypePostKey('weather', base), buildTypePostKey('weather', currentChanged));
});

test('GAG2 weather skips inactive events and rearms after an inactive gap', async () => {
  let now = Date.parse('2026-07-10T16:10:00.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-weather-inactive-state.json');
  fs.rmSync(statePath, { force: true });
  const weather = (startsAt, endsAt) => parseWeatherPayload({
    weather: {
      current: { type: 'sunburst', name: 'Sunburst', startsAt, endsAt },
    },
  });
  const expired = weather('2026-07-10T16:00:00.000Z', '2026-07-10T16:09:59.000Z');
  const future = weather('2026-07-10T16:11:00.000Z', '2026-07-10T16:15:00.000Z');
  const active = weather('2026-07-10T16:09:00.000Z', '2026-07-10T16:12:00.000Z');
  const activeWithoutBoundaries = weather(null, null);
  const retimedActive = weather('2026-07-10T16:08:00.000Z', '2026-07-10T16:13:00.000Z');
  const state = { posts: {} };
  const target = {
    guildId: '1493901002519347290',
    type: 'weather',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  let sends = 0;
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    send: async () => ({ id: `message-${++sends}` }),
  };
  const poster = new Gag2StockPoster({
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { now: () => now, statePath });

  assert.equal(isInactiveWeatherEntry(expired, now), true);
  assert.equal(isInactiveWeatherEntry(future, now), true);
  assert.equal(isInactiveWeatherEntry(active, now), false);
  assert.equal(isInactiveWeatherEntry(activeWithoutBoundaries, now), false);
  await poster.postEntry(state, target, expired);
  await poster.postEntry(state, target, future);
  assert.equal(sends, 0);

  await poster.postEntry(state, target, active);
  await poster.postEntry(state, target, retimedActive);
  assert.equal(sends, 1, 'timestamp drift does not reannounce the same active weather');

  now = Date.parse('2026-07-10T16:14:00.000Z');
  await poster.postEntry(state, target, retimedActive);
  assert.equal(state.posts[target.guildId].weather.lastPostedKey, null);

  const laterOccurrence = weather('2026-07-10T16:14:00.000Z', '2026-07-10T16:18:00.000Z');
  await poster.postEntry(state, target, laterOccurrence);
  assert.equal(sends, 2, 'the same weather can announce once again after an inactive gap');
  fs.rmSync(statePath, { force: true });
});

test('GAG2 sell dedupe includes price changes after the fortieth item', () => {
  const entries = Array.from({ length: 41 }, (_, index) => ({
    key: `item_${String(index).padStart(2, '0')}`,
    name: `Item ${index}`,
    multiplier: 1,
  }));
  const changedEntries = entries.map((entry, index) => (
    index === 40 ? { ...entry, multiplier: 1.25 } : entry
  ));

  const base = parseSellPayload({ sell: { entries } });
  const changed = parseSellPayload({ sell: { entries: changedEntries } });

  assert.notEqual(buildTypePostKey('sell', base), buildTypePostKey('sell', changed));
});

test('GAG2 source errors are never sent to Discord or saved with sensitive details', async () => {
  const statePath = path.join(__dirname, 'tmp-gag2-private-source-error-state.json');
  fs.rmSync(statePath, { force: true });
  let sends = 0;
  const channel = {
    id: '1525003375651848263',
    isTextBased: () => true,
    send: async () => { sends += 1; return { id: 'error-message' }; },
  };
  const poster = new Gag2StockPoster({
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { statePath });
  const error = Object.assign(new Error(`${STOCK_API_URL}: HTTP 403`), { status: 403 });

  await poster.postUnavailableOnce({}, {
    guildId: '1493901002519347290',
    type: 'seed',
    channelId: channel.id,
  }, error);

  assert.equal(sends, 0);
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(saved.unavailable['1493901002519347290'].seed.lastErrorMessage, undefined);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 startup cleanup deletes recent bot source-error messages across configured servers', async () => {
  const now = Date.parse('2026-08-02T04:00:00.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-source-error-cleanup-state.json');
  fs.rmSync(statePath, { force: true });
  let deletedErrors = 0;
  let deletedNormal = 0;
  const errorMessage = {
    author: { id: '123456789012345678', bot: true },
    createdTimestamp: now - 60_000,
    components: [{ type: 17, components: [{ type: 10, content: '## GAG2 Seed stock\n* Status: **source unavailable**\n-# HTTP 403' }] }],
    delete: async () => { deletedErrors += 1; },
  };
  const normalMessage = {
    author: { id: '123456789012345678', bot: true },
    createdTimestamp: now - 30_000,
    components: [{ type: 17, components: [{ type: 10, content: '## GAG2 Seed stock\n* Carrot x1' }] }],
    delete: async () => { deletedNormal += 1; },
  };
  const channel = {
    id: '1525003375651848263',
    isTextBased: () => true,
    messages: { fetch: async () => new Map([['error', errorMessage], ['normal', normalMessage]]) },
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { now: () => now, statePath });
  poster.cleanupTargets = () => [{ guildId: '222222222222222222', type: 'seed', channelId: channel.id }];

  assert.equal(isRecentUnavailableMessage(errorMessage, '123456789012345678', now), true);
  assert.equal(isRecentUnavailableMessage({
    author: { id: '123456789012345678', bot: true },
    createdTimestamp: now,
    content: 'SYSTEM // GAG2 stock source temporarily unavailable (HTTP 403; 1 request attempt).',
  }, '123456789012345678', now), true);
  assert.equal(isRecentUnavailableMessage(normalMessage, '123456789012345678', now), false);
  assert.equal(await poster.deleteRecentUnavailableMessages(), 1);
  assert.equal(deletedErrors, 1);
  assert.equal(deletedNormal, 0);
  fs.rmSync(statePath, { force: true });
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
    ['harvest_moon', 'Harvest Moon', 0xC96F2B],
    ['starfall', 'Starfall', 0x8C7CFF],
    ['snowfall', 'Snowfall', 0xBDEBFF],
    ['rain', 'Rain', 0x4A90E2],
    ['rainbow_moon', 'Rainbow Moon', 0xC86BFA],
    ['rainbow', 'Rainbow', 0xFF5C8A],
    ['mega_moon', 'Mega Moon', 0xD9D7FF],
    ['goldmoon', 'Gold Moon', 0xF4C542],
    ['bloodmoon', 'Blood Moon', 0xB3202A],
    ['aurora', 'Aurora', 0x35E6A4],
  ]);
});

test('GAG2 creates an orange Harvest Moon weather role', () => {
  const harvestMoon = roleSpecsForType('weather').find((entry) => entry.key === 'harvest_moon');
  assert.equal(harvestMoon.key, 'harvest_moon');
  assert.equal(harvestMoon.roleName, 'Harvest Moon');
  assert.equal(harvestMoon.emoji, '🌕');
  assert.equal(harvestMoon.color, 0xC96F2B);
  assert.equal(colorForType('weather', { name: 'Harvest Moon' }), 0xC96F2B);
  assert.equal(emojiForType('weather', { type: 'harvestmoon' }), '🌕');
});

test('GAG2 Eclipse weather uses its emoji and color without creating or pinging a role', () => {
  const weather = parseWeatherPayload({
    weather: {
      current: { type: 'eclipse', name: 'Eclipse', endsAt: '2026-07-13T01:00:00.000Z' },
      recent: [{ key: 'eclipse', name: 'Eclipse', lastSeenAt: '2026-07-13T00:55:00.000Z' }],
    },
  });
  const payload = buildTypePayload('weather', weather, { roleIds: { eclipse: '123456789012345678' } });
  const content = payload.components[0].components[0].components[0].content;

  assert.equal(payload.components[0].accent_color, 0x9B59FF);
  assert.match(content, /Current: <:eclipse:1526025549858738287> \*\*Eclipse\*\*/);
  assert.match(content, /<:eclipse:1526025549858738287> \*\*Eclipse\*\*/);
  assert.doesNotMatch(content, /<@&123456789012345678>/);
  assert.deepEqual(payload.allowedMentions.roles, []);
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

test('GAG2 stock and sell schedulers run at second one on UTC+7 boundaries', () => {
  assert.equal(CHECK_SCHEDULE_SECOND_MS, 1_000);
  assert.equal(SELL_CHECK_SCHEDULE_SECOND_MS, 1_000);
  assert.equal(
    new Date(nextGag2StockTickAtMs(Date.parse('2026-07-10T17:00:00.000Z'))).toISOString(),
    '2026-07-10T17:00:01.000Z',
  );
  assert.equal(
    new Date(nextGag2StockTickAtMs(Date.parse('2026-07-10T17:00:06.000Z'))).toISOString(),
    '2026-07-10T17:05:01.000Z',
  );
  assert.equal(
    new Date(nextGag2StockTickAtMs(Date.parse('2026-07-10T17:04:59.000Z'))).toISOString(),
    '2026-07-10T17:05:01.000Z',
  );
  assert.equal(
    new Date(nextGag2StockTickAtMs(Date.parse('2026-07-10T17:05:00.000Z'))).toISOString(),
    '2026-07-10T17:05:01.000Z',
  );
  assert.equal(
    new Date(nextGag2StockTickAtMs(Date.parse('2026-07-10T17:00:00.000Z'), {
      intervalMs: SELL_CHECK_INTERVAL_MS,
      secondMs: SELL_CHECK_SCHEDULE_SECOND_MS,
      offsetMs: 7 * 60 * 60 * 1000,
    })).toISOString(),
    '2026-07-10T17:00:01.000Z',
  );
});

test('GAG2 Garden Valley and Fall Harvest sell multipliers filter independently', () => {
  const filtered = filterSellEntry({
    entries: [{ key: 'carrot', name: 'Carrot', multiplier: 4 }],
    fall: { entries: [
      { key: 'amber_cranberry', name: 'Amber Cranberry', multiplier: 1.1 },
      { key: 'maple_apple', name: 'Maple Apple', multiplier: 2 },
    ] },
  }, {
    rarities: { sell: ['common'] },
    sellMultipliers: ['4x'],
    fall: { sellMultipliers: ['normal'] },
  });

  assert.deepEqual(filtered.entries.map((entry) => entry.key), ['carrot']);
  assert.deepEqual(filtered.fall.entries.map((entry) => entry.key), ['amber_cranberry']);
});

test('GAG2 disables Fall Harvest exactly at the October 1 UTC+7 deadline', () => {
  const config = { gag2Stock: { fall: { enabledTypes: ['seed', 'sell'] } } };
  assert.equal(new Date(FALL_HARVEST_END_AT_MS).toISOString(), '2026-10-01T07:00:00.000Z');
  assert.equal(isFallHarvestActive(FALL_HARVEST_END_AT_MS - 1), true);
  assert.equal(isFallHarvestActive(FALL_HARVEST_END_AT_MS), false);
  assert.equal(isFallHarvestActive(FALL_HARVEST_END_AT_MS + 1), false);
  assert.deepEqual([...activeFallTypes(config, FALL_HARVEST_END_AT_MS - 1)], ['seed', 'sell']);
  assert.deepEqual([...activeFallTypes(config, FALL_HARVEST_END_AT_MS)], []);
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

test('GAG2 sell failures retry every two seconds up to three times', () => {
  assert.equal(SELL_UNCHANGED_RETRY_MS, 2_000);
  assert.equal(SELL_FAILURE_RETRY_LIMIT, 3);
});

test('GAG2 stock source failures retry quickly without moving the normal five-minute schedule', () => {
  let now = Date.parse('2026-08-02T06:10:01.000Z');
  const poster = new Gag2StockPoster({}, { now: () => now });
  poster.started = true;
  assert.equal(STOCK_FAILURE_RETRY_MS, 2_000);
  assert.equal(STOCK_FAILURE_RETRY_LIMIT, 12);
  for (let attempt = 1; attempt <= STOCK_FAILURE_RETRY_LIMIT; attempt += 1) {
    poster.stop();
    poster.started = true;
    poster.nextDelayOverrideMs = STOCK_FAILURE_RETRY_MS;
    assert.equal(poster.scheduleNextTick(), now + STOCK_FAILURE_RETRY_MS);
    assert.equal(poster.stockFailureRetryCount, attempt);
    now += STOCK_FAILURE_RETRY_MS;
  }
  poster.stop();
  poster.started = true;
  poster.nextDelayOverrideMs = STOCK_FAILURE_RETRY_MS;
  assert.equal(poster.scheduleNextTick(), Date.parse('2026-08-02T06:15:01.000Z'));
  assert.equal(poster.stockFailureRetryCount, 0);
  poster.stop();
});

test('GAG2 stock and sell schedules stay on fixed boundaries and cap rapid retries', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'gag2Stock', 'manager.js'), 'utf8');
  assert.match(source, /this\.scheduleNextTick\(\)/);
  assert.match(source, /this\.scheduleSellTick\(\)/);
  assert.doesNotMatch(source, /nextStockRefreshAtMs/);
  assert.doesNotMatch(source, /nextSellRefreshAtMs/);
  assert.doesNotMatch(source, /nextApiRefreshAtMsForTypes/);
  assert.match(source, /scheduleSellTick\(\)/);
  assert.match(source, /this\.tick\(SELL_POST_TYPES, 'sell'\)/);
  assert.match(source, /const SELL_POST_TYPES = Object\.freeze\(\[\.\.\.STOCK_TYPE_GROUPS\.sell\]\)/);

  const now = Date.parse('2026-07-10T17:00:00.000Z');
  const stockPoster = new Gag2StockPoster({}, { now: () => now });
  stockPoster.started = true;
  assert.equal(
    new Date(stockPoster.scheduleNextTick()).toISOString(),
    '2026-07-10T17:00:01.000Z',
  );
  stockPoster.stop();

  const sellPoster = new Gag2StockPoster({}, { now: () => now });
  sellPoster.started = true;
  assert.equal(
    new Date(sellPoster.scheduleSellTick()).toISOString(),
    '2026-07-10T17:00:01.000Z',
  );
  for (let attempt = 1; attempt <= SELL_FAILURE_RETRY_LIMIT; attempt += 1) {
    sellPoster.stop();
    sellPoster.started = true;
    sellPoster.nextSellDelayOverrideMs = SELL_UNCHANGED_RETRY_MS;
    assert.equal(sellPoster.scheduleSellTick(), now + SELL_UNCHANGED_RETRY_MS);
    assert.equal(sellPoster.sellFailureRetryCount, attempt);
  }
  sellPoster.stop();
  sellPoster.started = true;
  sellPoster.nextSellDelayOverrideMs = SELL_UNCHANGED_RETRY_MS;
  assert.equal(sellPoster.scheduleSellTick(), Date.parse('2026-07-10T17:00:01.000Z'));
  assert.equal(sellPoster.sellFailureRetryCount, 0);
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

test('GAG2 sell dedupe ignores hidden API tier changes', () => {
  const normal = parseSellPayload({
    sell: {
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.1, tier: 'normal' }],
    },
  });
  const renamedTier = parseSellPayload({
    sell: {
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.1, tier: 'standard' }],
    },
  });

  assert.equal(buildTypePostKey('sell', normal), buildTypePostKey('sell', renamedTier));
});

test('GAG2 sell rejects an older refresh snapshot after a newer one was posted', async () => {
  const now = Date.parse('2026-07-13T15:52:00.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-sell-stale-state.json');
  fs.rmSync(statePath, { force: true });
  const oldEntry = parseSellPayload({
    fetchedAt: '2026-07-13T15:40:05.000Z',
    sell: {
      nextRefreshUnix: Math.floor(Date.parse('2026-07-13T15:50:00.000Z') / 1000),
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.05, tier: 'normal' }],
    },
  });
  const newEntry = parseSellPayload({
    fetchedAt: '2026-07-13T15:50:05.000Z',
    sell: {
      nextRefreshUnix: Math.floor(Date.parse('2026-07-13T16:00:00.000Z') / 1000),
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.15, tier: 'normal' }],
    },
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  let sends = 0;
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: { fetch: async () => new Map() },
    send: async () => {
      sends += 1;
      return { id: `message-${sends}` };
    },
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { now: () => now, statePath });
  const state = {
    posts: {
      [target.guildId]: {
        sell: {
          channelId: target.channelId,
          lastPostedKey: buildTypePostKey('sell', newEntry),
          lastSellNextRefreshAtMs: newEntry.nextRefreshAtMs,
          lastSourceFetchedAtMs: newEntry.fetchedAtMs,
        },
      },
    },
  };

  assert.equal(await poster.postEntry(state, target, oldEntry), null);
  assert.equal(sends, 0);
  assert.equal(state.posts[target.guildId].sell.lastPostedKey, buildTypePostKey('sell', newEntry));
  fs.rmSync(statePath, { force: true });
});

test('GAG2 sell does not replay a recent old snapshot from the same refresh cycle', async () => {
  const now = Date.parse('2026-07-13T15:52:00.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-sell-replay-state.json');
  fs.rmSync(statePath, { force: true });
  const nextRefreshUnix = Math.floor(Date.parse('2026-07-13T16:00:00.000Z') / 1000);
  const oldEntry = parseSellPayload({
    fetchedAt: '2026-07-13T15:51:30.000Z',
    sell: {
      nextRefreshUnix,
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.05, tier: 'normal' }],
    },
  });
  const newEntry = parseSellPayload({
    fetchedAt: '2026-07-13T15:51:00.000Z',
    sell: {
      nextRefreshUnix,
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.15, tier: 'normal' }],
    },
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  const oldPayload = buildTypePayload('sell', oldEntry, { roleIds: {} });
  let sends = 0;
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: {
      fetch: async () => new Map([['old-message', {
        id: 'old-message',
        author: { id: '123456789012345678', bot: true },
        createdTimestamp: now - 60_000,
        components: oldPayload.components,
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
  const state = {
    posts: {
      [target.guildId]: {
        sell: {
          channelId: target.channelId,
          lastPostedKey: buildTypePostKey('sell', newEntry),
          lastSellNextRefreshAtMs: newEntry.nextRefreshAtMs,
          lastSourceFetchedAtMs: newEntry.fetchedAtMs,
        },
      },
    },
  };

  assert.equal(await poster.postEntry(state, target, oldEntry), null);
  assert.equal(sends, 0);
  assert.equal(state.posts[target.guildId].sell.lastPostedKey, buildTypePostKey('sell', newEntry));
  assert.ok(state.posts[target.guildId].sell.recentPostedKeys.includes(buildTypePostKey('sell', oldEntry)));
  fs.rmSync(statePath, { force: true });
});

test('GAG2 sell serializes concurrent delivery to the same channel', async () => {
  const now = Date.parse('2026-07-13T15:52:00.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-sell-concurrent-state.json');
  fs.rmSync(statePath, { force: true });
  const entry = parseSellPayload({
    fetchedAt: '2026-07-13T15:51:30.000Z',
    sell: {
      nextRefreshUnix: Math.floor(Date.parse('2026-07-13T16:00:00.000Z') / 1000),
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.15, tier: 'normal' }],
    },
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  let sends = 0;
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: { fetch: async () => new Map() },
    send: async () => {
      sends += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return { id: `message-${sends}` };
    },
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { now: () => now, statePath });
  const state = { posts: {} };

  await Promise.all([
    poster.postEntry(state, target, entry),
    poster.postEntry(state, target, entry),
  ]);
  assert.equal(sends, 1);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 sell reloads persisted delivery state after acquiring the channel lock', async () => {
  const now = Date.parse('2026-07-13T15:52:00.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-sell-reload-state.json');
  fs.rmSync(statePath, { force: true });
  const entry = parseSellPayload({
    fetchedAt: '2026-07-13T15:51:30.000Z',
    sell: {
      nextRefreshUnix: Math.floor(Date.parse('2026-07-13T16:00:00.000Z') / 1000),
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.15, tier: 'normal' }],
    },
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  fs.writeFileSync(statePath, JSON.stringify({
    version: 2,
    posts: {
      [target.guildId]: {
        sell: {
          channelId: target.channelId,
          lastPostedKey: buildTypePostKey('sell', entry),
          lastSellNextRefreshAtMs: entry.nextRefreshAtMs,
        },
      },
    },
  }));
  let sends = 0;
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: { fetch: async () => new Map() },
    send: async () => { sends += 1; return { id: `message-${sends}` }; },
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { now: () => now, statePath });

  await poster.postEntry({ posts: {} }, target, entry);

  assert.equal(sends, 0);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 converges three simultaneous Sell Price posters to the deterministic oldest message', async () => {
  const now = Date.parse('2026-08-02T06:20:00.000Z');
  const statePaths = [1, 2, 3].map((id) => path.join(__dirname, `tmp-gag2-sell-instance-${id}-state.json`));
  statePaths.forEach((statePath) => fs.rmSync(statePath, { force: true }));
  const entry = parseSellPayload({
    fetchedAt: '2026-08-02T06:19:59.000Z',
    sell: {
      nextRefreshUnix: Math.floor(Date.parse('2026-08-02T06:30:00.000Z') / 1000),
      entries: [{ key: 'carrot', name: 'Carrot', multiplier: 1.15, rarity: 'Common', tier: 'normal' }],
    },
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  const messages = new Map();
  let preflightCalls = 0;
  let releasePreflight;
  const allPreflight = new Promise((resolve) => { releasePreflight = resolve; });
  let sendCalls = 0;
  let releaseSends;
  const allSent = new Promise((resolve) => { releaseSends = resolve; });
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: {
      fetch: async () => {
        if (preflightCalls < 3) {
          preflightCalls += 1;
          if (preflightCalls === 3) releasePreflight();
          await allPreflight;
          return new Map();
        }
        return new Map(messages);
      },
    },
    send: async (payload) => {
      sendCalls += 1;
      const id = `15250033756518482${sendCalls}`;
      const message = {
        id,
        author: { id: '123456789012345678', bot: true },
        components: payload.components,
        createdTimestamp: now + sendCalls,
        delete: async () => { messages.delete(id); },
      };
      messages.set(id, message);
      if (sendCalls === 3) releaseSends();
      await allSent;
      return message;
    },
  };
  const client = {
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  };
  const posters = statePaths.map((statePath) => new Gag2StockPoster(client, {
    logSystem: () => null,
    now: () => now,
    statePath,
  }));

  await Promise.all(posters.map((poster) => poster.postEntry({ posts: {} }, target, entry)));

  assert.equal(sendCalls, 3, 'the test forces every stateless instance through preflight');
  assert.deepEqual([...messages.keys()], ['152500337565184821']);
  for (const statePath of statePaths) {
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(saved.posts[target.guildId].sell.lastMessageId, '152500337565184821');
    fs.rmSync(statePath, { force: true });
  }
});

test('GAG2 Sell reconciliation preserves a different payload and allows the same crop in a later cycle', async () => {
  const now = Date.parse('2026-08-02T06:20:00.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-sell-legitimate-cycles-state.json');
  fs.rmSync(statePath, { force: true });
  const refreshOne = Date.parse('2026-08-02T06:30:00.000Z');
  const refreshTwo = Date.parse('2026-08-02T06:40:00.000Z');
  const refreshThree = Date.parse('2026-08-02T06:50:00.000Z');
  const entry = (multiplier, nextRefreshAtMs) => parseSellPayload({
    fetchedAt: new Date(now).toISOString(),
    sell: {
      nextRefreshUnix: Math.floor(nextRefreshAtMs / 1000),
      entries: [{ key: 'carrot', name: 'Carrot', multiplier, rarity: 'Common', tier: 'normal' }],
    },
  });
  const first = entry(1.1, refreshOne);
  const changed = entry(1.2, refreshTwo);
  const later = entry(1.2, refreshThree);
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  const messages = new Map();
  let sends = 0;
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: { fetch: async () => new Map(messages) },
    send: async (payload) => {
      sends += 1;
      const id = `15250033756518483${sends}`;
      const message = {
        id,
        author: { id: '123456789012345678', bot: true },
        components: payload.components,
        createdTimestamp: now + sends,
        delete: async () => { messages.delete(id); },
      };
      messages.set(id, message);
      return message;
    },
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { now: () => now, statePath });
  const state = { posts: {} };

  await poster.postEntry(state, target, first);
  await poster.postEntry(state, target, changed);
  await poster.postEntry(state, target, later);

  assert.equal(sends, 3);
  assert.equal(messages.size, 3, 'different payloads and later cycles remain legitimate messages');
  fs.rmSync(statePath, { force: true });
});

test('GAG2 sell poster delivers every ordered component split and records all message IDs', async () => {
  const now = Date.parse('2026-08-02T06:20:00.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-sell-split-state.json');
  fs.rmSync(statePath, { force: true });
  const entry = parseSellPayload({
    fetchedAt: '2026-08-02T06:19:59.000Z',
    sell: {
      nextRefreshUnix: Math.floor(Date.parse('2026-08-02T06:30:00.000Z') / 1000),
      entries: Array.from({ length: 140 }, (_, index) => ({
        key: `fruit_${index}`,
        name: `Very Long Garden Fruit ${index}`,
        multiplier: 1.25,
        rarity: 'Common',
        tier: 'normal',
      })),
    },
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'sell',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  const sentPayloads = [];
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: { fetch: async () => new Map() },
    send: async (payload) => {
      sentPayloads.push(payload);
      return { id: `message-${sentPayloads.length}`, delete: async () => null };
    },
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { now: () => now, statePath });
  const state = { posts: {} };

  await poster.postEntry(state, target, entry);

  assert.ok(sentPayloads.length > 1);
  assert.ok(sentPayloads.every((payload) => payload.components.reduce(
    (total, component) => total + displayableTextSize(component),
    0,
  ) <= 3_900));
  assert.deepEqual(
    state.posts[target.guildId].sell.lastMessageIds,
    sentPayloads.map((_, index) => `message-${index + 1}`),
  );
  fs.rmSync(statePath, { force: true });
});

test('GAG2 stock delivery cycle stays fixed across same-cycle retries', () => {
  assert.equal(
    currentGag2StockCycleAtMs(Date.parse('2026-08-02T06:10:00.500Z')),
    Date.parse('2026-08-02T06:10:00.000Z'),
  );
  assert.equal(
    currentGag2StockCycleAtMs(Date.parse('2026-08-02T06:10:03.500Z')),
    Date.parse('2026-08-02T06:10:00.000Z'),
  );
  assert.equal(
    currentGag2StockCycleAtMs(Date.parse('2026-08-02T06:15:00.500Z')),
    Date.parse('2026-08-02T06:15:00.000Z'),
  );
});

test('GAG2 stock poster never relabels or sends an expired source restock', async () => {
  let now = Date.parse('2026-08-02T06:10:00.500Z');
  const statePath = path.join(__dirname, 'tmp-gag2-fixed-source-cycle-state.json');
  fs.rmSync(statePath, { force: true });
  const parsed = parseStockPayload({
    stock: [{
      category: 'seed',
      restockedAt: '2026-08-02T06:05:00.000Z',
      nextRestockAt: '2026-08-02T06:10:00.000Z',
      items: [{ key: 'carrot', name: 'Carrot', rarity: 'Common', quantity: 1 }],
    }],
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'seed',
    channelId: '1525003375651848263',
    roleIds: {},
    filters: DEFAULT_GAG2_STOCK_CONFIG.filters,
  };
  const sentPayloads = [];
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    send: async (payload) => {
      sentPayloads.push(payload);
      return { id: `message-${sentPayloads.length}` };
    },
  };
  const poster = new Gag2StockPoster({
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, {
    fetchStockPayload: async () => parsed,
    now: () => now,
    statePath,
  });
  poster.targets = () => [target];

  await poster.tick(['seed'], 'stock');
  now = Date.parse('2026-08-02T06:10:03.500Z');
  await poster.tick(['seed'], 'stock');
  now = Date.parse('2026-08-02T06:15:00.500Z');
  await poster.tick(['seed'], 'stock');

  assert.equal(sentPayloads.length, 0, 'an expired source window is retried instead of being relabelled as current stock');
  fs.rmSync(statePath, { force: true });
});

test('GAG2 waits through a stale boundary snapshot and sends only the refreshed stock', async () => {
  const now = Date.parse('2026-08-02T06:10:00.500Z');
  const statePath = path.join(__dirname, 'tmp-gag2-stale-boundary-state.json');
  fs.rmSync(statePath, { force: true });
  const stale = parseStockPayload({
    stock: [{
      category: 'crate',
      restockedAt: '2026-08-02T06:05:00.000Z',
      nextRestockAt: '2026-08-02T06:10:00.000Z',
      items: [{ key: 'bench_crate', name: 'Bench Crate', rarity: 'Uncommon', quantity: 1 }],
    }],
  });
  const fresh = parseStockPayload({
    stock: [{
      category: 'crate',
      restockedAt: '2026-08-02T06:10:03.000Z',
      nextRestockAt: '2026-08-02T06:15:00.000Z',
      items: [{ key: 'boombox', name: 'Boombox', rarity: 'Legendary', quantity: 1 }],
    }],
  });
  const target = {
    guildId: '1493901002519347290',
    type: 'crate',
    channelId: '1525003375651848265',
    roleIds: {},
    filters: DEFAULT_GAG2_STOCK_CONFIG.filters,
  };
  let fetchCalls = 0;
  let sends = 0;
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: { fetch: async () => new Map() },
    send: async () => ({ id: `message-${++sends}` }),
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, {
    fetchStockPayload: async () => (++fetchCalls === 1 ? stale : fresh),
    now: () => now,
    statePath,
  });
  poster.targets = () => [target];

  await poster.tick(['crate'], 'stale boundary');
  assert.equal(sends, 0);
  assert.equal(poster.nextDelayOverrideMs, STOCK_FAILURE_RETRY_MS);
  await poster.tick(['crate'], 'fresh boundary');

  assert.equal(fetchCalls, 2);
  assert.equal(sends, 1);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 restores seed and gear cycle dedupe from recent Discord messages', async () => {
  for (const type of ['seed', 'gear']) {
    const now = Date.parse('2026-08-02T06:10:00.500Z');
    const statePath = path.join(__dirname, `tmp-gag2-discord-${type}-state.json`);
    fs.rmSync(statePath, { force: true });
    const entry = parseStockPayload({
      stock: [{
        category: type,
        restockedAt: '2026-08-02T06:10:00.000Z',
        nextRestockAt: '2026-08-02T06:15:00.000Z',
        items: [{ key: type === 'seed' ? 'carrot' : 'trowel', name: type === 'seed' ? 'Carrot' : 'Trowel', rarity: 'Common', quantity: 1 }],
      }],
    }).stock[0];
    const target = {
      guildId: '1493901002519347290',
      type,
      channelId: type === 'seed' ? '1525003375651848263' : '1525003375651848264',
      roleIds: {},
    };
    const payload = buildTypePayload(type, entry);
    const logs = [];
    const existing = {
      id: '1525003375651848299',
      author: { id: '123456789012345678' },
      components: payload.components,
      createdTimestamp: now - 1_000,
      delete: async () => null,
    };
    let sends = 0;
    const channel = {
      id: target.channelId,
      isTextBased: () => true,
      messages: { fetch: async () => new Map([[existing.id, existing]]) },
      send: async () => ({ id: `message-${++sends}` }),
    };
    const poster = new Gag2StockPoster({
      user: { id: '123456789012345678' },
      channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
    }, { logSystem: (message) => logs.push(message), now: () => now, statePath });

    await poster.postEntry({}, target, entry);

    assert.equal(sends, 0, `${type} is not reposted when Discord already has that restock cycle`);
    assert.equal(logs.length, 0, `${type} duplicate suppression stays out of the owner console`);
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(saved.posts[target.guildId][type].lastMessageId, existing.id);
    fs.rmSync(statePath, { force: true });
  }
});

test('GAG2 suppresses an old prop cycle when Discord already has the current one', async () => {
  const now = Date.parse('2026-08-02T06:10:00.500Z');
  const statePath = path.join(__dirname, 'tmp-gag2-discord-stale-crate-state.json');
  fs.rmSync(statePath, { force: true });
  const stale = parseStockPayload({
    stock: [{
      category: 'crate',
      restockedAt: '2026-08-02T06:05:00.000Z',
      nextRestockAt: '2026-08-02T06:10:00.000Z',
      items: [{ key: 'bench_crate', name: 'Bench Crate', rarity: 'Uncommon', quantity: 1 }],
    }],
  }).stock[0];
  const current = parseStockPayload({
    stock: [{
      category: 'crate',
      restockedAt: '2026-08-02T06:10:00.000Z',
      nextRestockAt: '2026-08-02T06:15:00.000Z',
      items: [{ key: 'boombox', name: 'Boombox', rarity: 'Legendary', quantity: 1 }],
    }],
  }).stock[0];
  const target = {
    guildId: '1493901002519347290',
    type: 'crate',
    channelId: '1525003375651848265',
    roleIds: {},
  };
  const currentPayload = buildTypePayload('crate', current);
  const existing = {
    id: '1525003375651848299',
    author: { id: '123456789012345678' },
    components: currentPayload.components,
    createdTimestamp: now - 250,
    delete: async () => null,
  };
  let sends = 0;
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: { fetch: async () => new Map([[existing.id, existing]]) },
    send: async () => ({ id: `message-${++sends}` }),
  };
  const poster = new Gag2StockPoster({
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, { now: () => now, statePath });

  await poster.postEntry({}, target, stale);

  assert.equal(sends, 0);
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(saved.posts[target.guildId].crate.lastStockNextRestockAtMs, current.nextRestockAtMs);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 converges overlapping bot instances to one stock message', async () => {
  const now = Date.parse('2026-08-02T06:10:00.500Z');
  const statePaths = [1, 2].map((id) => path.join(__dirname, `tmp-gag2-instance-${id}-state.json`));
  statePaths.forEach((statePath) => fs.rmSync(statePath, { force: true }));
  const entry = parseStockPayload({
    stock: [{
      category: 'seed',
      restockedAt: '2026-08-02T06:10:00.000Z',
      nextRestockAt: '2026-08-02T06:15:00.000Z',
      items: [{ key: 'carrot', name: 'Carrot', rarity: 'Common', quantity: 1 }],
    }],
  }).stock[0];
  const target = {
    guildId: '1493901002519347290',
    type: 'seed',
    channelId: '1525003375651848263',
    roleIds: {},
  };
  const messages = new Map();
  let preflightCalls = 0;
  let releasePreflight;
  const preflight = new Promise((resolve) => { releasePreflight = resolve; });
  let sendCalls = 0;
  let releaseSends;
  const bothSent = new Promise((resolve) => { releaseSends = resolve; });
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    messages: {
      fetch: async () => {
        if (preflightCalls < 2) {
          preflightCalls += 1;
          if (preflightCalls === 2) releasePreflight();
          await preflight;
          return new Map();
        }
        return new Map(messages);
      },
    },
    send: async (payload) => {
      sendCalls += 1;
      const id = `15250033756518482${sendCalls}`;
      const message = {
        id,
        author: { id: '123456789012345678' },
        components: payload.components,
        createdTimestamp: now + sendCalls,
        delete: async () => { messages.delete(id); },
      };
      messages.set(id, message);
      if (sendCalls === 2) releaseSends();
      await bothSent;
      return message;
    },
  };
  const client = {
    user: { id: '123456789012345678' },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  };
  const posters = statePaths.map((statePath) => new Gag2StockPoster(client, { now: () => now, statePath }));

  await Promise.all(posters.map((poster) => poster.postEntry({}, target, entry)));

  assert.equal(sendCalls, 2, 'the test forces both stateless instances through their preflight check');
  assert.equal(messages.size, 1, 'the post-send reconciliation removes the duplicate deterministically');
  statePaths.forEach((statePath) => fs.rmSync(statePath, { force: true }));
});

test('GAG2 overlapping stock retry groups share the latest persisted dedupe state', async () => {
  for (const type of ['seed', 'gear']) {
    const now = Date.parse('2026-08-02T06:10:00.500Z');
    const statePath = path.join(__dirname, `tmp-gag2-overlap-${type}-state.json`);
    fs.rmSync(statePath, { force: true });
    const parsed = parseStockPayload({
      stock: [{
        category: type,
        restockedAt: '2026-08-02T06:10:00.000Z',
        nextRestockAt: '2026-08-02T06:15:00.000Z',
        items: [{ key: type === 'seed' ? 'carrot' : 'trowel', name: type === 'seed' ? 'Carrot' : 'Trowel', rarity: 'Common', quantity: 1 }],
      }],
    });
    const target = {
      guildId: '1493901002519347290',
      type,
      channelId: type === 'seed' ? '1525003375651848263' : '1525003375651848264',
      roleIds: {},
      filters: DEFAULT_GAG2_STOCK_CONFIG.filters,
    };
    let sends = 0;
    const channel = {
      id: target.channelId,
      isTextBased: () => true,
      send: async () => {
        sends += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { id: `message-${sends}` };
      },
    };
    const poster = new Gag2StockPoster({
      channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
    }, {
      fetchStockPayload: async () => parsed,
      now: () => now,
      statePath,
    });
    poster.targets = (types) => types.includes(type) ? [target] : [];

    await Promise.all([
      poster.tick([type], 'single retry'),
      poster.tick(['seed', 'gear', 'crate'], 'stock group'),
    ]);

    assert.equal(sends, 1, `${type} posts once even when retry groups overlap`);
    fs.rmSync(statePath, { force: true });
  }
});

test('GAG2 fetches main and Fall stock together instead of adding their delays', async () => {
  const now = Date.parse('2026-08-02T06:10:00.500Z');
  const statePath = path.join(__dirname, 'tmp-gag2-parallel-stock-source-state.json');
  fs.rmSync(statePath, { force: true });
  const parsed = parseStockPayload(fixture());
  let mainFinished = false;
  let fallStartedBeforeMainFinished = false;
  const target = {
    guildId: '1493901002519347290',
    type: 'seed',
    channelId: '1525003375651848263',
    roleIds: {},
    fallEnabled: true,
    fallRoleIds: {},
    filters: DEFAULT_GAG2_STOCK_CONFIG.filters,
  };
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    send: async () => ({ id: 'message-1' }),
  };
  const poster = new Gag2StockPoster({
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, {
    fetchStockPayload: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      mainFinished = true;
      return parsed;
    },
    fetchFallStockPayload: async () => {
      fallStartedBeforeMainFinished = !mainFinished;
      return parsed;
    },
    now: () => now,
    statePath,
  });
  poster.targets = () => [target];

  await poster.tick(['seed'], 'stock');

  assert.equal(fallStartedBeforeMainFinished, true);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 stock poster broadcasts to guild channels concurrently with a safe worker limit', async () => {
  const now = Date.parse('2026-07-10T16:50:05.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-concurrent-broadcast-state.json');
  fs.rmSync(statePath, { force: true });
  const parsed = parseStockPayload(fixture());
  const targets = Array.from({ length: 7 }, (_, index) => ({
    guildId: `14939010025193472${index}`,
    type: 'seed',
    channelId: `15250033756518482${index}`,
    roleIds: {},
    filters: DEFAULT_GAG2_STOCK_CONFIG.filters,
  }));
  let activeSends = 0;
  let maxActiveSends = 0;
  const channels = new Map(targets.map((target, index) => [target.channelId, {
    id: target.channelId,
    isTextBased: () => true,
    send: async () => {
      activeSends += 1;
      maxActiveSends = Math.max(maxActiveSends, activeSends);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeSends -= 1;
      return { id: `message-${index}` };
    },
  }]));
  const poster = new Gag2StockPoster({
    channels: { cache: channels, fetch: async (channelId) => channels.get(channelId) || null },
  }, {
    broadcastConcurrency: 3,
    fetchStockPayload: async () => parsed,
    now: () => now,
    statePath,
  });
  poster.targets = () => targets;

  const sent = await poster.tick(['seed'], 'stock');

  assert.equal(sent.length, targets.length);
  assert.equal(maxActiveSends, 3);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 still posts main stock when the Fall source is unavailable', async () => {
  const now = Date.parse('2026-07-10T16:50:05.000Z');
  const statePath = path.join(__dirname, 'tmp-gag2-fall-source-failure-state.json');
  fs.rmSync(statePath, { force: true });
  const parsed = parseStockPayload(fixture());
  const sentPayloads = [];
  const target = {
    guildId: '222222222222222222',
    type: 'seed',
    channelId: '1525003375651848263',
    roleIds: {},
    fallEnabled: true,
    fallRoleIds: {},
    filters: DEFAULT_GAG2_STOCK_CONFIG.filters,
  };
  const channel = {
    id: target.channelId,
    isTextBased: () => true,
    send: async (payload) => {
      sentPayloads.push(payload);
      return { id: 'main-stock-message' };
    },
  };
  const fallError = Object.assign(new Error(`${FALL_STOCK_API_URL}: HTTP 403`), { status: 403 });
  const poster = new Gag2StockPoster({
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
  }, {
    fetchStockPayload: async () => parsed,
    fetchFallStockPayload: async () => { throw fallError; },
    now: () => now,
    statePath,
  });
  poster.targets = () => [target];

  const sent = await poster.tick(['seed'], 'stock');

  assert.equal(sent.length, 1);
  assert.equal(sentPayloads.length, 1);
  const sentContent = sentPayloads[0].components
    .flatMap((component) => component.components || [])
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');
  assert.doesNotMatch(sentContent, /-# \*\*🍂FALL HARVEST🍁\*\*/i);
  fs.rmSync(statePath, { force: true });
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

test('GAG2 source reports the full retry count for transient HTTP failures', async () => {
  let calls = 0;
  await assert.rejects(
    fetchJson('https://example.test/gag2', {
      retryDelayMs: 0,
      retries: 2,
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 503 };
      },
    }),
    (error) => error.status === 503 && error.attempts === 3,
  );
  assert.equal(calls, 3);
});

test('GAG2 retries a temporary Cloudflare 403 against the same approved API', async () => {
  let calls = 0;
  const payload = await fetchJson(STOCK_API_URL, {
    retryDelayMs: 0,
    retries: 1,
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(url, STOCK_API_URL);
      if (calls === 1) return { ok: false, status: 403 };
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(payload, { ok: true });
});

test('GAG2 poster keeps the previous good message throughout transient source failures', async () => {
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

  for (let failure = 0; failure < 5; failure += 1) {
    assert.equal(await poster.postUnavailableOnce(state, target, error), null);
  }

  assert.equal(sent.length, 0);
  assert.equal(state.unavailable[target.guildId].sell.consecutiveFailures, 5);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 keeps a shared weather outage silent across every destination', async () => {
  const statePath = path.join(__dirname, 'tmp-gag2-weather-outage-state.json');
  fs.rmSync(statePath, { force: true });
  let now = Date.parse('2026-07-14T02:42:54.000Z');
  let fetchCalls = 0;
  const logs = [];
  const error = new Error('GAG2 source timed out after 3 attempts (5s each)');
  error.gag2Transient = true;
  error.attempts = 3;
  const targets = [
    { guildId: 'guild-1', type: 'weather', channelId: 'weather-1' },
    { guildId: 'guild-1', type: 'moon', channelId: 'moon-1' },
    { guildId: 'guild-2', type: 'weather', channelId: 'weather-2' },
    { guildId: 'guild-2', type: 'moon', channelId: 'moon-2' },
    { guildId: 'guild-3', type: 'weather', channelId: 'weather-3' },
  ];
  const poster = new Gag2StockPoster({ channels: { cache: new Map(), fetch: async () => null } }, {
    fetchWeatherPayload: async () => {
      fetchCalls += 1;
      throw error;
    },
    logSystem: (message) => logs.push(message),
    now: () => now,
    statePath,
  });
  poster.targets = () => targets;

  await poster.tick(['weather', 'moon'], 'weather');
  now += 5_000;
  await poster.tick(['weather', 'moon'], 'weather');

  assert.equal(fetchCalls, 2, 'weather is fetched once per polling cycle, not once per destination');
  assert.equal(logs.length, 0, 'source failures never enter the owner console');
  assert.equal(poster.sourceHealth.get('weather').consecutiveFailures, 2);

  poster.updateSourceHealth(targets, new Map());
  assert.equal(logs.length, 0);
  assert.equal(poster.sourceHealth.has('weather'), false);
  fs.rmSync(statePath, { force: true });
});

test('GAG2 pauses only the failed destination and reports an unchanged permission issue once', async () => {
  const logs = [];
  let sends = 0;
  const allPostingPermissions = testPermissions(
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.UseExternalEmojis,
  );
  const missingSendInChannel = testPermissions(
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.UseExternalEmojis,
  );
  const member = { permissions: allPostingPermissions };
  const channel = {
    id: '152643215642198019',
    name: 'gag2-weather',
    guild: { members: { me: member } },
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => missingSendInChannel,
    send: async () => {
      sends += 1;
      return { id: `message-${sends}` };
    },
  };
  const channels = new Map([[channel.id, channel]]);
  const poster = new Gag2StockPoster({
    channels: { cache: channels, fetch: async (id) => channels.get(id) || null },
  }, {
    logSystem: (message) => logs.push(message),
  });
  const target = {
    guildId: '1526432156421980180',
    type: 'seed',
    channelId: channel.id,
    roleIds: {},
  };
  const entry = parseStockPayload(fixture()).stock.find((item) => item.category === 'seed');
  const state = {};

  for (let check = 0; check < 6; check += 1) await poster.postEntry(state, target, entry);

  assert.equal(sends, 0);
  assert.equal(logs.length, 1, 'the same broken destination is reported once');
  assert.match(logs[0], /posting paused/);
  assert.match(logs[0], /Missing channel\/category permissions in #gag2-weather \(152643215642198019\): Send Messages/);
  assert.match(logs[0], /Only this destination is skipped until its permissions are restored/);
  assert.equal(poster.nextDelayOverrideMs, null, 'one bad destination does not retry every stock channel');

  const nextEntry = {
    ...entry,
    restockedAtMs: entry.restockedAtMs + 5 * 60 * 1000,
    nextRestockAtMs: entry.nextRestockAtMs + 5 * 60 * 1000,
    items: entry.items.map((item, index) => index ? item : { ...item, quantity: item.quantity + 1 }),
  };
  await poster.postEntry(state, target, nextEntry);
  assert.equal(logs.length, 1, 'the same permission problem remains quiet on later stock cycles');
});

test('GAG2 distinguishes server role permissions from channel overrides', () => {
  const member = {
    permissions: testPermissions(
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ),
  };
  const channel = {
    isThread: () => false,
    permissionsFor: () => testPermissions(
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ),
  };

  const diagnostic = diagnosePostPermissions(channel, member, 'weather');

  assert.deepEqual(diagnostic.server, ['Use External Emojis']);
  assert.deepEqual(diagnostic.channel, []);
});
