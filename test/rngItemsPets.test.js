const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { loadImage } = require('@napi-rs/canvas');

const { createRngGameFeature, RNG_GAME_COMMANDS } = require('../src/features/rng-game');
const { inventoryPayload } = require('../src/features/rng-game/components/builders');
const {
  eggAnimationSource,
  eggOpeningPayload,
  hatchedPetsPayload,
  purchasePreviewPayload,
  shopPayload,
} = require('../src/features/rng-game/components/itemBuilders');
const { parsePrefixUse } = require('../src/features/rng-game/commands');
const {
  ITEMS,
  ITEM_BY_ID,
  SHOP_ITEM_CONFIG_VERSION,
} = require('../src/features/rng-game/data/items');
const { PETS, PET_SLOT_PRICES } = require('../src/features/rng-game/data/pets');
const { SEEDS } = require('../src/features/rng-game/data/seeds');
const { assertValidMessagePayload } = require('../src/features/shared/discordPayload');
const { COMPONENTS_V2_FLAG } = require('../src/features/shared/components');
const {
  MAX_EFFECTIVE_BIG_CHANCE_BPS,
  MAX_VALUE_BONUS_BPS,
  MAX_WEIGHT_MULTIPLIER_BPS,
  PROBABILITY_SCALE,
  MIN_COMMON_PROBABILITY_UNITS,
  applyRarityModifiers,
  generateInstance,
  rarityDistribution,
  valueForWeight,
} = require('../src/features/rng-game/services/rngService');
const {
  SHOP_PAGE_HEIGHT,
  SHOP_PAGE_WIDTH,
  ShopPageRenderer,
  pageCardPositions,
} = require('../src/features/rng-game/services/shopCardRenderer');
const {
  RESTOCK_INTERVAL_MS,
  currentRestockEpoch,
  nextRestockAt,
} = require('../src/features/rng-game/repositories/itemPetRepository');

function feature(options = {}) {
  return createRngGameFeature({
    databasePath: ':memory:',
    rng: (maximum) => maximum - 1,
    shopRenderer: { render: async () => Buffer.from('card'), clear() {} },
    ...options,
  });
}

function fund(game, userId, amount) {
  game.repository.ensurePlayer(userId, 1);
  game.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?').run(BigInt(amount), String(userId));
}

function grantItem(game, userId, itemId, amount, now = 1) {
  game.repository.ensurePlayer(userId, now);
  game.db.prepare(`INSERT INTO rng_player_items (user_id, item_id, quantity, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET
    quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`)
    .run(String(userId), String(itemId), BigInt(amount), BigInt(now));
}

function addPet(game, userId, petId, now = 1) {
  game.repository.ensurePlayer(userId, now);
  game.itemRepository.ensurePetSlots(userId, now);
  return String(game.db.prepare('INSERT INTO rng_pet_instances (owner_user_id, pet_id, hatched_at) VALUES (?, ?, ?)')
    .run(String(userId), String(petId), BigInt(now)).lastInsertRowid);
}

function purchasePreview(game, userId, itemId) {
  const state = game.shopService.state(userId);
  const current = state.items.find((item) => item.id === itemId);
  return {
    restockEpoch: state.restockEpoch,
    configVersion: current.configVersion,
    price: current.price,
  };
}

function user(id = 'user') {
  return {
    id,
    username: 'Tester',
    displayAvatarURL: () => 'https://cdn.example/avatar.png',
  };
}

test('/shop, c!shop, /use, and c!use are registered and routed', async () => {
  const commands = new Map(RNG_GAME_COMMANDS.map((entry) => [entry.data.name, entry.data.toJSON()]));
  assert.ok(commands.has('shop'));
  assert.ok(commands.has('use'));
  assert.equal(commands.get('use').options.find((option) => option.name === 'item').choices.length, ITEMS.length);

  const game = feature({ restockRng: () => 9_999 });
  let loadingReply;
  let shopReply;
  assert.equal(await game.handleMessage({
    id: 'prefix-shop',
    content: 'c!shop',
    author: { ...user('shop-user'), bot: false },
    reply: async (payload) => {
      loadingReply = payload;
      return { edit: async (edited) => { shopReply = edited; } };
    },
  }), true);
  assert.match(JSON.stringify(loadingReply), /Loading the item shop/);
  assert.equal(loadingReply.flags & COMPONENTS_V2_FLAG, COMPONENTS_V2_FLAG);
  assert.match(shopReply.components[0].components[0].content, /CoinSprite shop/);
  assert.equal(shopReply.flags, undefined, 'edits inherit the initial Components V2 message flag');
  assert.equal(shopReply.files.length, 1);

  let slashLoading;
  let slashShop;
  let deferCalls = 0;
  assert.equal(await game.handleInteraction({
    id: 'slash-shop',
    commandName: 'shop',
    isChatInputCommand: () => true,
    user: user('slash-shop-user'),
    deferReply: async () => { deferCalls += 1; },
    reply: async (payload) => { slashLoading = payload; },
    editReply: async (payload) => { slashShop = payload; },
  }), true);
  assert.equal(deferCalls, 0, 'Components V2 cannot be established by a deferred interaction response');
  assert.equal(slashLoading.flags & COMPONENTS_V2_FLAG, COMPONENTS_V2_FLAG);
  assert.match(slashShop.components[0].components[0].content, /CoinSprite shop/);
  game.close();
});

test('prefix /use parsing is case-insensitive, longest-name-first, and validates amounts', () => {
  assert.deepEqual(parsePrefixUse('c!use Super Watering Can 12'), {
    status: 'ok', itemId: 'super_watering_can', amount: 12n,
  });
  assert.deepEqual(parsePrefixUse('C!USE legendary mushroom'), {
    status: 'ok', itemId: 'legendary_mushroom', amount: 1n,
  });
  assert.equal(parsePrefixUse('c!use common sprinkler nope').status, 'invalid');
  assert.equal(parsePrefixUse('c!use not an item').status, 'invalid');
  assert.equal(parsePrefixUse('c!shop'), null);
});

test('authoritative fixed prices, effects, restock scarcity, and configuration version are exact', () => {
  const expected = {
    secret_mushroom: [6_000_000n, 200, 1, 1, 'rarity-flat'],
    super_mushroom: [1_000_000n, 400, 1, 1, 'rarity'],
    mythic_mushroom: [500_000n, 700, 1, 1, 'rarity'],
    legendary_mushroom: [350_000n, 1_000, 1, 1, 'rarity'],
    epic_mushroom: [75_000n, 1_800, 1, 2, 'rarity'],
    rare_mushroom: [15_000n, 3_000, 1, 3, 'rarity'],
    super_sprinkler: [1_500_000n, 200, 1, 1, 'sprinkler'],
    legendary_sprinkler: [750_000n, 400, 1, 1, 'sprinkler'],
    rare_sprinkler: [250_000n, 900, 1, 1, 'sprinkler'],
    uncommon_sprinkler: [75_000n, 1_800, 1, 2, 'sprinkler'],
    common_sprinkler: [25_000n, 3_500, 2, 4, 'sprinkler'],
    super_watering_can: [100_000n, 2_000, 1, 3, 'watering-can'],
    common_watering_can: [5_000n, 5_000, 3, 8, 'watering-can'],
    common_egg: [2_000_000n, 800, 1, 2, 'egg'],
  };
  for (const item of ITEMS) {
    assert.deepEqual([
      item.price,
      item.restockChanceBps,
      item.stock.minimum,
      item.stock.maximum,
      item.effect.kind,
    ], expected[item.id]);
    assert.equal(item.configVersion, SHOP_ITEM_CONFIG_VERSION);
  }
  assert.equal(ITEM_BY_ID.get('secret_mushroom').effect.addedProbabilityUnits, 250_000);
  assert.equal(ITEM_BY_ID.get('super_mushroom').effect.numerator, 10);
  assert.equal(ITEM_BY_ID.get('super_sprinkler').effect.weightBps, 15_000);
  assert.equal(ITEM_BY_ID.get('super_watering_can').effect.weightBps, 20_000);
});

test('every player sees the same fixed prices regardless of tiers, pets, or active items', () => {
  const game = feature({ clock: () => 1, restockRng: () => 0 });
  const initial = game.shopService.state('fixed-price-player');
  const initialPrices = new Map(initial.items.map((item) => [item.id, item.price]));
  assert.equal(initialPrices.get('secret_mushroom'), 6_000_000n);
  assert.equal(initialPrices.get('common_egg'), 2_000_000n);

  addPet(game, 'fixed-price-player', 'bear', 1);
  game.itemRepository.equipPet('fixed-price-player', 1, 'bear', 1);
  grantItem(game, 'fixed-price-player', 'rare_mushroom', 1, 1);
  game.itemRepository.use('fixed-price-player', 'rare_mushroom', 1, 'fixed-price-active-item', 1);
  game.db.prepare('UPDATE rng_players SET luck_tier = 49, big_crop_tier = 50 WHERE user_id = ?')
    .run('fixed-price-player');
  const manipulated = game.shopService.state('fixed-price-player');
  assert.deepEqual(
    manipulated.items.map((item) => item.price),
    initial.items.map((item) => item.price),
    'permanent tiers, pets, and active consumables cannot personalize Shop prices',
  );
  assert.ok(manipulated.items.every((item) => typeof item.price === 'bigint'));
  game.close();
});

test('a maximum-value normal Super crop cannot buy a fixed-price Secret Mushroom', () => {
  const maximumNormalSuper = BigInt(Math.max(
    ...SEEDS.filter((seed) => seed.rarity === 'Super').map((seed) => seed.maximumValue),
  ));
  const secret = ITEM_BY_ID.get('secret_mushroom');
  assert.ok(secret.price > maximumNormalSuper);
});

test('permanent-tier changes do not invalidate a fixed-price purchase preview', () => {
  const game = feature({ clock: () => 1, restockRng: () => 0 });
  fund(game, 'fixed-checkout', 1_000_000n);
  const preview = purchasePreview(game, 'fixed-checkout', 'rare_mushroom');
  const stockBefore = game.itemRepository.shopState(1).items
    .find((item) => item.id === 'rare_mushroom').stockRemaining;
  game.db.prepare('UPDATE rng_players SET luck_tier = 49, big_crop_tier = 50 WHERE user_id = ?').run('fixed-checkout');
  const purchased = game.itemRepository.purchase(
    'fixed-checkout', 'rare_mushroom', 1, 'fixed-price-operation', preview, 1,
  );
  assert.equal(purchased.status, 'ok');
  assert.equal(purchased.price, 15_000n);
  assert.equal(game.repository.getPlayer('fixed-checkout').balance, 985_000n);
  assert.equal(game.itemRepository.shopState(1).items.find((item) => item.id === 'rare_mushroom').stockRemaining, stockBefore - 1n);
  game.close();
});

test('purchase confirmation rejects a stale fixed price without charging or consuming stock', () => {
  const game = feature({ clock: () => 1, restockRng: () => 0 });
  fund(game, 'stale-fixed-price', 1_000_000n);
  const preview = purchasePreview(game, 'stale-fixed-price', 'rare_mushroom');
  preview.price += 1n;
  const stockBefore = game.itemRepository.shopState(1).items
    .find((item) => item.id === 'rare_mushroom').stockRemaining;
  const result = game.itemRepository.purchase(
    'stale-fixed-price', 'rare_mushroom', 1, 'stale-fixed-price-operation', preview, 1,
  );
  assert.equal(result.status, 'price-changed');
  assert.equal(result.current.price, 15_000n);
  assert.equal(result.current.configVersion, SHOP_ITEM_CONFIG_VERSION);
  assert.equal(game.repository.getPlayer('stale-fixed-price').balance, 1_000_000n);
  assert.equal(game.itemRepository.shopState(1).items.find((item) => item.id === 'rare_mushroom').stockRemaining, stockBefore);
  game.close();
});

test('purchase preview shows the fixed price without personalized pricing details', () => {
  const item = ITEM_BY_ID.get('secret_mushroom');
  const payload = purchasePreviewPayload({
    id: 'price-preview', amount: 1n, price: item.price, configVersion: item.configVersion,
  }, item);
  const rendered = JSON.stringify(payload);
  assert.match(rendered, /Fixed price.*6,000,000/);
  assert.match(rendered, /Exact total.*6,000,000/);
  assert.doesNotMatch(rendered, /Personalized|Permanent tiers|Luck 0|BIG 0|price breakdown/i);
  assertValidMessagePayload(payload);
});

test('shop pages attach one composite image and expose exactly the displayed stable IDs', () => {
  const displayed = ITEMS.slice(0, 6).map((item, index) => ({
    ...item, stockRemaining: BigInt(index), price: item.price,
  }));
  const page = {
    restockEpoch: 0,
    nextRestockAt: RESTOCK_INTERVAL_MS,
    page: 1,
    maxPage: 3,
    items: displayed,
    image: Buffer.from('composite-shop-page'),
  };
  const payload = shopPayload(page, { id: 'shop-view', page: 1 });
  const container = payload.components[0].components;
  assert.equal(container.find((component) => component.type === 12).items.length, 1);
  const select = container.flatMap((component) => component.components || []).find((component) => component.type === 3);
  assert.equal(select.placeholder, 'Select item to purchase');
  assert.deepEqual(select.options.map((option) => option.value), displayed.map((item) => item.id));
  assert.match(select.options[0].description, /OUT OF STOCK/);
  assert.equal(payload.files.length, 1);
  assert.doesNotMatch(JSON.stringify(payload), /Personalized for Luck/);
  assert.match(container[0].content, /^### CoinSprite shop\n-# Restock /);
  assert.ok(container.some((component) => component.type === 14));
  assert.ok(container.flatMap((component) => component.components || []).some((component) => component.label === 'Page 1 / 3'));
  assertValidMessagePayload(payload);
});

test('the 14-item catalogue paginates as 6, 6, and 2 without repeats or filler entries', async () => {
  const renderedPages = [];
  const game = feature({
    clock: () => 1,
    restockRng: () => 0,
    shopRenderer: {
      render: async (items, options) => {
        renderedPages.push({ ids: items.map((item) => item.id), options });
        return Buffer.from(`page-${options.page}`);
      },
      clear() {},
    },
  });
  const pages = await Promise.all([1, 2, 3].map((page) => game.shopService.page('any-player', page)));
  assert.deepEqual(pages.map((page) => page.items.length), [6, 6, 2]);
  assert.deepEqual(pages.map((page) => page.maxPage), [3, 3, 3]);
  assert.deepEqual(pages.flatMap((page) => page.items.map((item) => item.id)), ITEMS.map((item) => item.id));
  assert.deepEqual(renderedPages.map((entry) => entry.ids.length), [6, 6, 2]);
  assert.deepEqual(renderedPages.map((entry) => entry.options.page), [1, 2, 3]);
  assert.ok(renderedPages.every((entry) => entry.options.catalogueVersion === SHOP_ITEM_CONFIG_VERSION));
  game.close();
});

test('fixed restock boundaries use independent item rolls and do not carry stock', () => {
  assert.equal(currentRestockEpoch(RESTOCK_INTERVAL_MS + 123), RESTOCK_INTERVAL_MS);
  assert.equal(nextRestockAt(RESTOCK_INTERVAL_MS + 123), RESTOCK_INTERVAL_MS * 2);
  let calls = 0;
  const game = feature({
    clock: () => 1,
    restockRng(maximum) {
      calls += 1;
      return maximum - 1;
    },
  });
  const first = game.itemRepository.shopState(1);
  assert.ok(first.items.every((item) => item.stockRemaining === 0n));
  assert.equal(calls, ITEMS.length, 'each failed chance uses one independent draw');
  game.itemRepository.restockRng = () => 0;
  const second = game.itemRepository.shopState(RESTOCK_INTERVAL_MS + 1);
  assert.ok(second.items.every((item) => item.stockRemaining === BigInt(item.stock.minimum)));
  assert.notEqual(second.restockEpoch, first.restockEpoch);
  game.close();
});

test('restocks are restart-safe and a boundary epoch cannot be rolled twice', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-shop-restart-'));
  const databasePath = path.join(directory, 'rng.sqlite');
  try {
    let game = createRngGameFeature({
      databasePath,
      clock: () => 10,
      restockRng: () => 0,
      shopRenderer: { render: async () => Buffer.from('card'), clear() {} },
    });
    const original = game.itemRepository.shopState(10).items.map((item) => item.stockRemaining);
    game.close();
    game = createRngGameFeature({
      databasePath,
      clock: () => 20,
      restockRng: () => 9_999,
      shopRenderer: { render: async () => Buffer.from('card'), clear() {} },
    });
    assert.deepEqual(game.itemRepository.shopState(20).items.map((item) => item.stockRemaining), original);
    assert.equal(game.db.prepare('SELECT COUNT(*) AS count FROM rng_shop_restocks').get().count, 1n);
    game.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('purchases atomically recheck stock and balance and replay idempotently', () => {
  const game = feature({ clock: () => 1, restockRng: () => 0 });
  fund(game, 'buyer', 20_000n);
  const canPreview = purchasePreview(game, 'buyer', 'common_watering_can');
  const first = game.itemRepository.purchase('buyer', 'common_watering_can', 2, 'purchase:one', canPreview, 1);
  const replay = game.itemRepository.purchase('buyer', 'common_watering_can', 2, 'purchase:one', canPreview, 1);
  assert.equal(first.status, 'ok');
  assert.equal(replay.duplicate, true);
  assert.equal(game.repository.getPlayer('buyer').balance, 10_000n);
  assert.equal(game.itemRepository.itemInventory('buyer')[0].quantity, 2n);
  assert.equal(game.itemRepository.shopState(1).items.find((item) => item.id === 'common_watering_can').stockRemaining, 1n);
  const eggPreview = purchasePreview(game, 'buyer', 'common_egg');
  const insufficient = game.itemRepository.purchase('buyer', 'common_egg', 1, 'purchase:poor', eggPreview, 1);
  assert.equal(insufficient.status, 'insufficient');
  assert.equal(game.itemRepository.itemInventory('buyer').some((entry) => entry.itemId === 'common_egg'), false);
  game.close();
});

test('item inventory is unlimited, grouped, Components V2, and omits capacity upgrades', () => {
  const game = feature();
  grantItem(game, 'items-user', 'rare_mushroom', 7);
  grantItem(game, 'items-user', 'common_egg', 2);
  const view = { id: 'inventory-view', ownerId: 'items-user', type: 'items', page: 1, filters: {} };
  const payload = inventoryPayload(user('items-user'), {
    crops: game.gameService.inventory('items-user'),
    itemInventory: game.itemRepository.itemInventory('items-user'),
    pets: game.itemRepository.petState('items-user'),
  }, view);
  const rendered = JSON.stringify(payload);
  assert.match(rendered, /Rare Mushroom.*x7/);
  assert.match(rendered, /Common Egg.*x2/);
  assert.doesNotMatch(rendered, /Capacity:|rng:inv:upgrade/);
  assert.match(rendered, /Select inventory type/);
  assertValidMessagePayload(payload);
  game.close();
});

test('inventory type switching edits the owner view and rejects other users', async () => {
  const game = feature();
  const view = game.inventoryViews.create('owner', { type: 'crops' });
  let edited;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    customId: `rng:inv:type:${view.id}`,
    values: ['items'],
    user: user('owner'),
    deferUpdate: async () => {},
    editReply: async (payload) => { edited = payload; },
  });
  assert.equal(view.type, 'items');
  assert.match(JSON.stringify(edited), /You do not own any items/);

  let denied;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    isRepliable: () => true,
    customId: `rng:inv:type:${view.id}`,
    values: ['pets'],
    user: user('intruder'),
    reply: async (payload) => { denied = payload; },
  });
  assert.match(JSON.stringify(denied), /Only the command invoker/);
  assert.equal(view.type, 'items');
  game.close();
});

test('pet hatch boundaries total exactly 100% and persist every rolled instance', () => {
  const game = feature();
  assert.deepEqual(Object.fromEntries(PETS.map((pet) => [pet.id, pet.hatchWeight])), {
    frog: 3_000,
    bunny: 3_000,
    owl: 1_800,
    deer: 800,
    turtle: 800,
    robin: 160,
    bee: 140,
    butterfly: 100,
    monkey: 50,
    firefly: 50,
    golden_dragonfly: 40,
    unicorn: 35,
    bear: 25,
  });
  assert.equal(PETS.reduce((sum, pet) => sum + pet.hatchWeight, 0), 10_000);
  assert.deepEqual(PETS.reduce((totals, pet) => ({
    ...totals,
    [pet.rarity]: (totals[pet.rarity] || 0) + pet.hatchWeight,
  }), {}), { Common: 6_000, Uncommon: 1_800, Rare: 1_600, Legendary: 400, Mythic: 200 });
  let cumulative = 0;
  for (const pet of PETS) {
    cumulative += pet.hatchWeight;
    grantItem(game, 'hatcher', 'common_egg', 1);
    game.itemRepository.hatchRng = () => cumulative - 1;
    const result = game.itemRepository.use('hatcher', 'common_egg', 1, `hatch:${pet.id}`, 10);
    assert.equal(result.pets[0].petId, pet.id);
  }
  assert.equal(game.itemRepository.petState('hatcher').instances.length, PETS.length);
  game.close();
});

test('egg consumption and duplicate operation delivery persist pets only once', () => {
  const game = feature({ hatchRng: () => 0 });
  grantItem(game, 'duplicate-hatch', 'common_egg', 2);
  const first = game.itemRepository.use('duplicate-hatch', 'common_egg', 2, 'hatch:duplicate', 10);
  const replay = game.itemRepository.use('duplicate-hatch', 'common_egg', 2, 'hatch:duplicate', 11);
  assert.equal(first.pets.length, 2);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.pets[0].pet.id, 'frog');
  assert.equal(game.itemRepository.petState('duplicate-hatch').instances.length, 2);
  assert.equal(game.itemRepository.itemInventory('duplicate-hatch').length, 0);
  game.close();
});

test('egg opening waits exactly five injected seconds and edits the same prefix response', async () => {
  const delays = [];
  const edits = [];
  const game = feature({
    hatchRng: () => 0,
    hatchDelay: async (milliseconds) => { delays.push(milliseconds); },
  });
  grantItem(game, 'animated-hatch', 'common_egg', 1);
  let initial;
  await game.handleMessage({
    id: 'egg-message',
    content: 'c!use Common Egg',
    author: { ...user('animated-hatch'), bot: false },
    reply: async (payload) => {
      initial = payload;
      return { edit: async (edited) => { edits.push(edited); } };
    },
  });
  assert.deepEqual(delays, [5_000]);
  assert.match(JSON.stringify(initial), /Opening x1 Common Egg/);
  assert.equal(edits.length, 1);
  assert.match(JSON.stringify(edits[0]), /Pet hatched: Frog/);
  game.close();
});

test('missing egg animations fall back to default.gif, then to the pet emoji PNG', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-egg-assets-'));
  try {
    const instance = { petId: 'frog', pet: PETS[0] };
    const withoutAny = eggAnimationSource(instance, directory);
    assert.match(withoutAny.url, /cdn\.discordapp\.com\/emojis\/1537702944915325042\.png/);
    fs.writeFileSync(path.join(directory, 'default.gif'), Buffer.from('GIF89a'));
    const withDefault = eggAnimationSource(instance, directory);
    assert.equal(path.basename(withDefault.path), 'default.gif');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('pet slot prices and unlocking are atomic and idempotent', () => {
  const game = feature();
  assert.deepEqual(PET_SLOT_PRICES, { 1: 0n, 2: 10_000_000n, 3: 50_000_000n });
  fund(game, 'slots', 10_000_000n);
  const first = game.itemRepository.unlockSlot('slots', 2, 'unlock:2', 10);
  const replay = game.itemRepository.unlockSlot('slots', 2, 'unlock:2', 11);
  assert.equal(first.status, 'ok');
  assert.equal(replay.duplicate, true);
  assert.equal(game.repository.getPlayer('slots').balance, 0n);
  assert.equal(game.itemRepository.petState('slots').slots[1].unlocked, true);
  assert.equal(game.itemRepository.unlockSlot('slots', 3, 'unlock:3', 12).status, 'insufficient');
  game.close();
});

test('duplicate pet equipment is limited by actual instances and unequipping frees a copy', () => {
  const game = feature();
  fund(game, 'equipper', 10_000_000n);
  game.itemRepository.unlockSlot('equipper', 2, 'unlock:equip', 1);
  addPet(game, 'equipper', 'bunny', 2);
  assert.equal(game.itemRepository.equipPet('equipper', 1, 'bunny', 3).status, 'ok');
  assert.equal(game.itemRepository.equipPet('equipper', 2, 'bunny', 4).status, 'unavailable-pet');
  addPet(game, 'equipper', 'bunny', 5);
  assert.equal(game.itemRepository.equipPet('equipper', 2, 'bunny', 6).status, 'ok');
  assert.equal(game.itemRepository.equipPet('equipper', 1, 'unequip', 7).status, 'ok');
  const state = game.itemRepository.petState('equipper');
  assert.equal(state.slots[0].pet, null);
  assert.equal(state.slots[1].pet.petId, 'bunny');
  assert.equal(game.itemRepository.availablePetSpecies('equipper', 1).available[0].count, 2);
  game.close();
});

test('timed effects expire, extend linearly, and reject a different active sprinkler without consumption', () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  grantItem(game, 'effects', 'common_sprinkler', 2, now);
  grantItem(game, 'effects', 'rare_sprinkler', 1, now);
  const first = game.itemRepository.use('effects', 'common_sprinkler', 1, 'use:sprinkler-1', now);
  now += 5_000;
  const extended = game.itemRepository.use('effects', 'common_sprinkler', 1, 'use:sprinkler-2', now);
  assert.equal(extended.endsAt - first.endsAt, 30 * 60 * 1_000);
  const conflict = game.itemRepository.use('effects', 'rare_sprinkler', 1, 'use:conflict', now);
  assert.equal(conflict.status, 'sprinkler-conflict');
  assert.equal(game.itemRepository.itemInventory('effects').find((entry) => entry.itemId === 'rare_sprinkler').quantity, 1n);
  now = extended.endsAt;
  assert.equal(game.itemRepository.activeEffects('effects', now).length, 0);
  game.close();
});

test('reusing Secret Mushroom extends duration without stacking its fixed bonus', () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  grantItem(game, 'secret-extension', 'secret_mushroom', 2, now);
  const first = game.itemRepository.use(
    'secret-extension', 'secret_mushroom', 1, 'use:secret-first', now,
  );
  now += 5_000;
  const second = game.itemRepository.use(
    'secret-extension', 'secret_mushroom', 1, 'use:secret-second', now,
  );
  assert.equal(second.endsAt - first.endsAt, 60 * 60 * 1_000);
  const modifiers = game.itemRepository.resolveRollModifiers('secret-extension', now)
    .rarityModifiers.filter((entry) => entry.rarity === 'Secret');
  assert.equal(modifiers.length, 1);
  const base = rarityDistribution(49);
  const boosted = applyRarityModifiers(base, modifiers);
  assert.equal(boosted.Secret, base.Secret + 250_000n);
  assert.equal(Object.values(boosted).reduce((sum, units) => sum + units, 0n), PROBABILITY_SCALE);
  game.close();
});

test('Items and Pets inventory display exact active and capped combined bonuses', () => {
  const game = feature({ clock: () => 1_000 });
  grantItem(game, 'boost-summary', 'rare_sprinkler', 1, 1_000);
  grantItem(game, 'boost-summary', 'super_watering_can', 3, 1_000);
  game.itemRepository.use('boost-summary', 'rare_sprinkler', 1, 'summary:sprinkler', 1_000);
  game.itemRepository.use('boost-summary', 'super_watering_can', 3, 'summary:watering', 1_000);
  const itemView = { id: 'boost-items', ownerId: 'boost-summary', type: 'items', page: 1, filters: {} };
  const itemPayload = inventoryPayload(user('boost-summary'), {
    crops: game.gameService.inventory('boost-summary'),
    itemInventory: game.itemRepository.itemInventory('boost-summary'),
    boosts: game.itemRepository.activeBoosts('boost-summary', 1_000),
    pets: game.itemRepository.petState('boost-summary', 1_000),
  }, itemView);
  const itemText = JSON.stringify(itemPayload);
  assert.match(itemText, /Active Boosts/);
  assert.match(itemText, /Rare Sprinkler.*Crop weight ×1\.20.*BIG chance \+1\.00 percentage point/);
  assert.match(itemText, /Expires <t:1801:R>.*Manual \+ Auto Rolls/);
  assert.match(itemText, /Super Watering Can.*Remaining charges.*3.*Manual \+ Auto Rolls/);

  fund(game, 'boost-summary', 60_000_000n);
  game.itemRepository.unlockSlot('boost-summary', 2, 'summary:slot-2', 1_000);
  game.itemRepository.unlockSlot('boost-summary', 3, 'summary:slot-3', 1_000);
  for (let index = 0; index < 3; index += 1) addPet(game, 'boost-summary', 'bear', 1_000 + index);
  for (let slot = 1; slot <= 3; slot += 1) game.itemRepository.equipPet('boost-summary', slot, 'bear', 2_000 + slot);
  const petState = game.itemRepository.petState('boost-summary', 3_000);
  const petView = { id: 'boost-pets', ownerId: 'boost-summary', type: 'pets', page: 1, filters: {} };
  const petPayload = inventoryPayload(user('boost-summary'), {
    crops: game.gameService.inventory('boost-summary'),
    itemInventory: [],
    pets: petState,
  }, petView);
  const petText = JSON.stringify(petPayload);
  assert.match(petText, /Equipped Pet Bonuses/);
  assert.match(petText, /Crop weight.*×1\.259/);
  assert.match(petText, /BIG chance.*\+0\.75 percentage points/);
  assert.ok(petState.bonuses.weightMultiplierBps <= MAX_WEIGHT_MULTIPLIER_BPS);
  assert.ok(petState.bonuses.valueBonusBps <= MAX_VALUE_BONUS_BPS);
  assert.ok(petState.bonuses.effectiveBigChanceBps <= MAX_EFFECTIVE_BIG_CHANCE_BPS);
  assert.ok(petState.bonuses.boosted.rarityUnits.Common >= MIN_COMMON_PROBABILITY_UNITS);
  assertValidMessagePayload(itemPayload);
  assertValidMessagePayload(petPayload);
  game.close();
});

test('watering-can charges are consumed only after a successful committed roll', () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  grantItem(game, 'watering', 'common_watering_can', 2, now);
  game.itemRepository.use('watering', 'common_watering_can', 2, 'use:watering', now);
  game.db.prepare('UPDATE rng_players SET inventory_capacity = 0 WHERE user_id = ?').run('watering');
  assert.equal(game.gameService.roll('watering').status, 'full');
  assert.equal(game.itemRepository.resolveRollModifiers('watering', now).wateringCanItemId, 'common_watering_can');
  game.db.prepare('UPDATE rng_players SET inventory_capacity = 100 WHERE user_id = ?').run('watering');
  const rolled = game.gameService.roll('watering');
  assert.equal(rolled.status, 'ok');
  assert.equal(rolled.item.modifierSnapshot.wateringCanItemId, 'common_watering_can');
  now += 1;
  assert.equal(game.gameService.roll('watering').status, 'cooldown');
  assert.equal(game.db.prepare('SELECT charges FROM rng_watering_can_charges WHERE user_id = ?').get('watering').charges, 1n);
  game.close();
});

test('manual and Auto Roll resolve the same active modifier snapshot', () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  for (const id of ['manual-modifiers', 'auto-modifiers']) {
    grantItem(game, id, 'rare_sprinkler', 1, now);
    game.itemRepository.use(id, 'rare_sprinkler', 1, `use:${id}`, now);
  }
  const manual = game.gameService.roll('manual-modifiers');
  fund(game, 'auto-modifiers', 1_000_000n);
  const preview = game.autoRollService.preview('auto-modifiers', '1m', []);
  const started = game.autoRollService.start('auto-modifiers', preview, { guildId: 'g', channelId: 'c' });
  now = started.job.nextTickAt;
  const automatic = game.autoRollService.processTick(started.job.id, now, now);
  assert.equal(manual.item.modifierSnapshot.weightMultiplierBps, 12_000);
  assert.equal(automatic.item.modifierSnapshot.weightMultiplierBps, 12_000);
  assert.equal(manual.item.modifierSnapshot.bigBonusBps, automatic.item.modifierSnapshot.bigBonusBps);
  game.close();
});

test('rarity modifiers preserve 100%, pet caps, Common floor, and exact Secret Mushroom semantics', () => {
  const luck = rarityDistribution(49);
  const modified = applyRarityModifiers(luck, [
    { kind: 'rarity', rarity: 'Mythic', numerator: 200, denominator: 100, phase: 'pet' },
    { kind: 'rarity', rarity: 'Mythic', numerator: 200, denominator: 100, phase: 'pet' },
    { kind: 'rarity-flat', rarity: 'Secret', addedProbabilityUnits: 250_000, phase: 'item', sourceId: 'secret_mushroom' },
  ]);
  assert.equal(Object.values(modified).reduce((sum, units) => sum + units, 0n), PROBABILITY_SCALE);
  assert.ok(modified.Mythic <= (luck.Mythic * 150n) / 100n);
  assert.equal(modified.Secret, luck.Secret + 250_000n);
  assert.ok(modified.Common >= MIN_COMMON_PROBABILITY_UNITS);
});

test('maximum-tier pet and simultaneous mushroom stacking preserves every rarity cap', () => {
  const base = rarityDistribution(49);
  const unicorn = PETS.find((pet) => pet.id === 'unicorn');
  const petModifiers = Array.from({ length: 3 }, () => ({
    ...unicorn.effect,
    phase: 'pet',
    sourceId: unicorn.id,
  }));
  const mushroomModifiers = ITEMS.filter((item) => item.type === 'Mushroom').map((item) => ({
    ...item.effect,
    phase: 'item',
    sourceId: item.id,
  }));
  const modified = applyRarityModifiers(base, [...petModifiers, ...mushroomModifiers]);
  assert.equal(Object.values(modified).reduce((sum, units) => sum + units, 0n), PROBABILITY_SCALE);
  assert.ok(modified.Common >= MIN_COMMON_PROBABILITY_UNITS);
  assert.equal(modified.Secret, base.Secret + 250_000n);
  assert.ok(modified.Epic <= PROBABILITY_SCALE);
  assert.ok(modified.Legendary <= PROBABILITY_SCALE);
  assert.ok(modified.Mythic <= PROBABILITY_SCALE);
  assert.ok(modified.Super <= PROBABILITY_SCALE);

  const floorLimited = applyRarityModifiers(base, [
    { kind: 'rarity', rarity: 'Rare', numerator: 100, denominator: 1, phase: 'item', sourceId: 'test-rare' },
    { kind: 'rarity', rarity: 'Epic', numerator: 100, denominator: 1, phase: 'item', sourceId: 'test-epic' },
    { kind: 'rarity', rarity: 'Legendary', numerator: 100, denominator: 1, phase: 'item', sourceId: 'test-legendary' },
  ]);
  assert.equal(floorLimited.Common, MIN_COMMON_PROBABILITY_UNITS);
  assert.equal(Object.values(floorLimited).reduce((sum, units) => sum + units, 0n), PROBABILITY_SCALE);
});

test('weight, value, and BIG bonuses use fixed point and obey global caps', () => {
  const seed = SEEDS.at(-1);
  const draws = [10, 999];
  const instance = generateInstance(seed, () => draws.shift(), {
    bigCropTier: 50,
    bigBonusBps: 50_000,
    weightMultiplierBps: 99_999,
    valueBonusBps: 2_000,
  });
  assert.equal(instance.modifierSnapshot.weightMultiplierBps, 25_000);
  assert.equal(instance.modifierSnapshot.effectiveBigChanceBps, 1_500);
  assert.equal(instance.weightedBaseUnits, Math.floor((20 * 25_000) / 10_000));
  const expected = (valueForWeight(seed, instance.weightedBaseUnits, { clamp: false }) * 12_000n) / 10_000n;
  assert.equal(instance.value, expected * 4n);
  assert.equal(instance.isBig, true);
});

test('shop page renderer returns one cached 1920x1080 3x2 composite and centers the final two items', async () => {
  const renderer = new ShopPageRenderer({ loadImage: async () => { throw new Error('missing'); } });
  const items = ITEMS.slice(0, 6).map((item, index) => ({ ...item, stockRemaining: BigInt(index) }));
  const options = { restockEpoch: 0, page: 1, catalogueVersion: SHOP_ITEM_CONFIG_VERSION };
  const first = await renderer.render(items, options);
  const second = await renderer.render(items, options);
  assert.equal(first, second, 'identical composite page state is cached');
  const image = await loadImage(first);
  assert.equal(image.width, SHOP_PAGE_WIDTH);
  assert.equal(image.height, SHOP_PAGE_HEIGHT);
  assert.deepEqual([SHOP_PAGE_WIDTH, SHOP_PAGE_HEIGHT], [1920, 1080]);
  assert.equal(SHOP_PAGE_WIDTH / SHOP_PAGE_HEIGHT, 16 / 9);
  const fullPositions = pageCardPositions(6);
  assert.equal(new Set(fullPositions.slice(0, 3).map((position) => position.y)).size, 1);
  assert.equal(new Set(fullPositions.slice(3).map((position) => position.y)).size, 1);
  assert.ok(fullPositions[0].x < fullPositions[1].x && fullPositions[1].x < fullPositions[2].x);

  const finalPageItems = ITEMS.slice(12).map((item) => ({ ...item, stockRemaining: 1n }));
  const finalPage = await renderer.render(finalPageItems, {
    restockEpoch: 0, page: 3, catalogueVersion: SHOP_ITEM_CONFIG_VERSION,
  });
  const finalImage = await loadImage(finalPage);
  assert.equal(finalImage.width, SHOP_PAGE_WIDTH);
  assert.equal(finalImage.height, SHOP_PAGE_HEIGHT);
  const finalPositions = pageCardPositions(2);
  assert.equal(finalPositions.length, 2);
  assert.equal(finalPositions[0].y, finalPositions[1].y);
  assert.equal((finalPositions[0].x + finalPositions[1].x + 592) / 2, SHOP_PAGE_WIDTH / 2,
    'the two-card group is horizontally centered');
  assert.ok(finalPositions[0].y > 48, 'the two-card final page is vertically centered');

  const changedStock = await renderer.render(
    items.map((item, index) => (index === 0 ? { ...item, stockRemaining: 99n } : item)),
    options,
  );
  assert.notEqual(changedStock, first, 'stock values participate in the composite cache key');
  assert.notEqual(await renderer.render(items, { ...options, restockEpoch: 1 }), first, 'restock epoch participates in the composite cache key');
  assert.notEqual(await renderer.render(items, { ...options, page: 2 }), first, 'page participates in the composite cache key');
  assert.notEqual(await renderer.render(items, { ...options, catalogueVersion: SHOP_ITEM_CONFIG_VERSION + 1 }), first, 'catalogue version participates in the composite cache key');
  assert.notEqual(await renderer.render(
    items.map((item, index) => (index === 0 ? { ...item, price: item.price + 1n } : item)),
    options,
  ), first, 'prices participate in the composite cache key');
  renderer.clear();
});

test('shop, inventory, egg animation, and hatch result payloads stay within Components V2 limits', () => {
  const egg = ITEM_BY_ID.get('common_egg');
  const pets = Array.from({ length: 10 }, (_, index) => ({
    id: String(index + 1), petId: PETS[index % PETS.length].id, pet: PETS[index % PETS.length], hatchedAt: 1,
  }));
  assertValidMessagePayload(eggOpeningPayload(egg, pets));
  assertValidMessagePayload(hatchedPetsPayload(pets));
  const game = feature();
  for (const pet of PETS) addPet(game, 'payload-pets', pet.id);
  const view = { id: 'pet-payload-view', ownerId: 'payload-pets', type: 'pets', page: 1, filters: {} };
  assertValidMessagePayload(inventoryPayload(user('payload-pets'), {
    crops: game.gameService.inventory('payload-pets'),
    itemInventory: [],
    pets: game.itemRepository.petState('payload-pets'),
  }, view));
  game.close();
});
