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
  shopPayload,
} = require('../src/features/rng-game/components/itemBuilders');
const { parsePrefixUse } = require('../src/features/rng-game/commands');
const { ITEMS, ITEM_BY_ID } = require('../src/features/rng-game/data/items');
const { PETS, PET_SLOT_PRICES } = require('../src/features/rng-game/data/pets');
const { SEEDS } = require('../src/features/rng-game/data/seeds');
const { assertValidMessagePayload } = require('../src/features/shared/discordPayload');
const { COMPONENTS_V2_FLAG } = require('../src/features/shared/components');
const {
  PROBABILITY_SCALE,
  applyRarityModifiers,
  generateInstance,
  rarityDistribution,
  valueForWeight,
} = require('../src/features/rng-game/services/rngService');
const { ShopCardRenderer, SHOP_CARD_HEIGHT, SHOP_CARD_WIDTH } = require('../src/features/rng-game/services/shopCardRenderer');
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
  assert.equal(shopReply.files.length, 6);

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

test('shop pages render six cards and expose exactly the displayed stable IDs', () => {
  const displayed = ITEMS.slice(0, 6).map((item, index) => ({
    ...item, stockRemaining: BigInt(index), price: item.price,
  }));
  const page = {
    restockEpoch: 0,
    nextRestockAt: RESTOCK_INTERVAL_MS,
    page: 1,
    maxPage: 3,
    items: displayed,
    cards: displayed.map((item) => ({ item, image: Buffer.from(item.id) })),
  };
  const payload = shopPayload(page, { id: 'shop-view', page: 1 });
  const container = payload.components[0].components;
  assert.equal(container.find((component) => component.type === 12).items.length, 6);
  const select = container.flatMap((component) => component.components || []).find((component) => component.type === 3);
  assert.equal(select.placeholder, 'Select item to purchase');
  assert.deepEqual(select.options.map((option) => option.value), displayed.map((item) => item.id));
  assert.match(select.options[0].description, /OUT OF STOCK/);
  assert.equal(payload.files.length, 6);
  assertValidMessagePayload(payload);
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
  fund(game, 'buyer', 1_000n);
  const first = game.itemRepository.purchase('buyer', 'common_watering_can', 2, 'purchase:one', 1);
  const replay = game.itemRepository.purchase('buyer', 'common_watering_can', 2, 'purchase:one', 1);
  assert.equal(first.status, 'ok');
  assert.equal(replay.duplicate, true);
  assert.equal(game.repository.getPlayer('buyer').balance, 500n);
  assert.equal(game.itemRepository.itemInventory('buyer')[0].quantity, 2n);
  assert.equal(game.itemRepository.shopState(1).items.find((item) => item.id === 'common_watering_can').stockRemaining, 3n);
  const insufficient = game.itemRepository.purchase('buyer', 'common_egg', 1, 'purchase:poor', 1);
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
  assert.equal(PETS.reduce((sum, pet) => sum + pet.hatchWeight, 0), 10_000);
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
  assert.deepEqual(PET_SLOT_PRICES, { 1: 0n, 2: 100_000n, 3: 1_000_000n });
  fund(game, 'slots', 100_000n);
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
  fund(game, 'equipper', 100_000n);
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
  assert.equal(manual.item.modifierSnapshot.weightMultiplierBps, 10_800);
  assert.equal(automatic.item.modifierSnapshot.weightMultiplierBps, 10_800);
  assert.equal(manual.item.modifierSnapshot.bigBonusBps, automatic.item.modifierSnapshot.bigBonusBps);
  game.close();
});

test('rarity modifiers preserve 100%, pet caps, and Secret Mushroom base-only semantics', () => {
  const luck = rarityDistribution(49);
  const modified = applyRarityModifiers(luck, [
    { kind: 'rarity', rarity: 'Mythic', numerator: 200, denominator: 100, phase: 'pet' },
    { kind: 'rarity', rarity: 'Mythic', numerator: 200, denominator: 100, phase: 'pet' },
    { kind: 'rarity', rarity: 'Secret', numerator: 125, denominator: 100, baseOnly: true, phase: 'item' },
  ]);
  assert.equal(Object.values(modified).reduce((sum, units) => sum + units, 0n), PROBABILITY_SCALE);
  assert.ok(modified.Mythic <= (luck.Mythic * 150n) / 100n);
  const base = rarityDistribution(0);
  assert.equal(modified.Secret, luck.Secret + ((base.Secret * 25n) / 100n));
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
  assert.equal(instance.modifierSnapshot.weightMultiplierBps, 17_500);
  assert.equal(instance.modifierSnapshot.effectiveBigChanceBps, 1_000);
  assert.equal(instance.weightedBaseUnits, Math.floor((20 * 17_500) / 10_000));
  const expected = (valueForWeight(seed, instance.weightedBaseUnits, { clamp: false }) * 12_000n) / 10_000n;
  assert.equal(instance.value, expected * 4n);
  assert.equal(instance.isBig, true);
});

test('shop card renderer returns a consistent PNG even when all emoji downloads fail', async () => {
  const renderer = new ShopCardRenderer({ loadImage: async () => { throw new Error('missing'); } });
  const item = { ...ITEM_BY_ID.get('common_egg'), stockRemaining: 0n };
  const first = await renderer.render(item, 0);
  const second = await renderer.render(item, 0);
  assert.equal(first, second, 'identical card state is cached');
  const image = await loadImage(first);
  assert.equal(image.width, SHOP_CARD_WIDTH);
  assert.equal(image.height, SHOP_CARD_HEIGHT);
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
