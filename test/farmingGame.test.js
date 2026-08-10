const assert = require('node:assert/strict');
const test = require('node:test');

const { featureCommandsForConfig } = require('../src/applicationCommands');
const { createFarmingGameFeature } = require('../src/features/farming-game');
const { createRngGameFeature } = require('../src/features/rng-game');
const {
  farmingInventoryFields,
  farmActionOptions,
  farmPayload,
  farmStatusText,
  myInventoryPayload,
} = require('../src/features/farming-game/components/builders');
const { ITEMS, ITEM_BY_ID, STARTER_ITEM_QUANTITY } = require('../src/features/farming-game/data/items');
const { FarmingGameRepository } = require('../src/features/farming-game/repositories/farmingRepository');
const { PLOT_RECTS, STAGE_RENDER_HEIGHTS, anchorBounds } = require('../src/features/farming-game/renderer/config');
const { FarmingGameService } = require('../src/features/farming-game/services/farmingService');
const { evaluateFarmingGameAccess } = require('../src/features/farming-game/services/accessPolicy');
const { generatePlotAnchors, validPlotAnchors } = require('../src/features/farming-game/utils/anchors');
const { growthStage } = require('../src/features/farming-game/utils/growth');
const {
  filterInventoryStacks,
  inventoryPageData,
} = require('../src/features/farming-game/utils/inventory');

function fakeRenderer() {
  return { render: async () => Buffer.from('farm'), clear() {} };
}

function farmingFeature(options = {}) {
  return createFarmingGameFeature({ databasePath: ':memory:', farmRenderer: fakeRenderer(), ...options });
}

function stack(itemId, quantity = 1n) {
  return { itemId, quantity, item: ITEM_BY_ID[itemId], updatedAt: 1 };
}

function integratedGames(options = {}) {
  const rng = createRngGameFeature({
    databasePath: ':memory:',
    rng: (maximum) => maximum - 1,
    indexRenderer: { render: async () => Buffer.from('index'), invalidate() {}, clear() {} },
    ...options.rng,
  });
  const farming = createFarmingGameFeature({
    db: rng.db,
    farmRenderer: fakeRenderer(),
    ...options.farming,
  });
  return {
    farming,
    rng,
    close() {
      farming.close();
      rng.close();
    },
  };
}

test('Farming access is independently locked and accepts configured forum posts without bypass state', () => {
  const source = { guildId: 'guild', channelId: 'post', channel: { parentId: 'farm-forum' }, member: { roles: ['vip'] } };
  assert.match(evaluateFarmingGameAccess(source, () => ({ unlocked: false })).reason, /Farming Game is locked/);
  assert.match(evaluateFarmingGameAccess(source, () => ({ unlocked: true, enabled: false })).reason, /Farming Game is disabled/);
  assert.match(evaluateFarmingGameAccess(source, () => ({ unlocked: true, enabled: true, gameChannelIds: [] })).reason, /at least one game channel/);
  assert.deepEqual(evaluateFarmingGameAccess(source, () => ({
    unlocked: true,
    enabled: true,
    gameChannelIds: ['farm-forum'],
    cooldownBypassRoleIds: ['vip'],
  })), { allowed: true });
});

function componentText(payload) {
  return JSON.stringify(payload);
}

test('starter seed grant and nine empty plots are persistent and idempotent', () => {
  const game = farmingFeature();
  game.farmingService.ensureProfile('starter');
  assert.equal(game.repository.itemQuantity('starter', 'carrot_seed_package'), STARTER_ITEM_QUANTITY);
  assert.equal(game.repository.plots('starter').length, 9);
  assert.deepEqual(game.repository.plots('starter').map((plot) => plot.plotNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(game.repository.plots('starter').every((plot) => plot.cropId === null && plot.anchors.length === 0));

  game.farmingService.ensureProfile('starter');
  const restartedRepository = new FarmingGameRepository(game.db);
  restartedRepository.ensureProfile('starter', 2);
  assert.equal(restartedRepository.itemQuantity('starter', 'carrot_seed_package'), STARTER_ITEM_QUANTITY);
  assert.equal(game.db.prepare(`SELECT COUNT(*) AS count FROM farm_item_stacks
    WHERE owner_user_id = ? AND item_id = ?`).get('starter', 'carrot_seed_package').count, 1n);
  game.close();
});

test('planting multiple plots consumes one package per plot and persists five safe anchors', () => {
  let now = 100_000;
  const game = farmingFeature({ clock: () => now, rng: () => 0 });
  const result = game.farmingService.plant('planter', [1, 5, 9], 'carrot_seed_package');
  assert.equal(result.status, 'ok');
  assert.equal(result.remaining, STARTER_ITEM_QUANTITY - 3n);
  const planted = game.repository.plots('planter').filter((plot) => plot.cropId);
  assert.equal(planted.length, 3);
  for (const plot of planted) {
    assert.equal(plot.cropId, 'carrot');
    assert.equal(plot.plantedAt, now);
    assert.equal(plot.anchors.length, 5);
    assert.equal(validPlotAnchors(plot.plotNumber, plot.anchors), true);
  }
  game.close();
});

test('anchor generation is bounded, separated, and has a deterministic fallback', () => {
  for (const plot of PLOT_RECTS) {
    let draw = 0;
    const anchors = generatePlotAnchors(plot.number, (maximum) => (draw++ * 47) % maximum);
    assert.equal(validPlotAnchors(plot.number, anchors), true);
    for (let left = 0; left < anchors.length; left += 1) {
      for (let right = left + 1; right < anchors.length; right += 1) {
        assert.ok(Math.hypot(anchors[left].x - anchors[right].x, anchors[left].y - anchors[right].y) >= 38);
      }
    }
    const fallback = generatePlotAnchors(plot.number, () => 0);
    assert.equal(validPlotAnchors(plot.number, fallback), true);
    assert.deepEqual(fallback, generatePlotAnchors(plot.number, () => 0));
    const bounds = anchorBounds(plot.number);
    assert.ok(fallback.every((anchor) => anchor.x >= bounds.minX && anchor.x <= bounds.maxX));
  }
});

test('anchor coordinates remain unchanged across growth stages and repository restarts', () => {
  let now = 1_000_000;
  const game = farmingFeature({ clock: () => now, rng: () => 0 });
  game.farmingService.plant('persistent', [4], 'carrot_seed_package');
  const original = game.repository.plots('persistent')[3].anchors;
  now += 4 * 60 * 1000;
  assert.deepEqual(game.farmingService.farmState('persistent').plots[3].anchors, original);
  assert.equal(game.farmingService.farmState('persistent').plots[3].stage, 4);
  const restarted = new FarmingGameService({ repository: new FarmingGameRepository(game.db), clock: () => now });
  assert.deepEqual(restarted.farmState('persistent').plots[3].anchors, original);
  game.close();
});

test('growth stage boundaries advance at each minute and cap at stage six', () => {
  const plantedAt = 0;
  for (let stage = 0; stage <= 6; stage += 1) {
    assert.equal(growthStage(plantedAt, plantedAt + (stage * 60 * 1000)), stage);
    if (stage < 6) assert.equal(growthStage(plantedAt, plantedAt + ((stage + 1) * 60 * 1000) - 1), stage);
  }
  assert.equal(growthStage(plantedAt, plantedAt + (60 * 60 * 1000)), 6);
});

test('harvest is unavailable early, grants five carrots per ready plot, and cannot run twice', () => {
  let now = 2_000_000;
  const game = farmingFeature({ clock: () => now, rng: () => 0 });
  game.farmingService.plant('harvester', [1, 2], 'carrot_seed_package');
  now += (6 * 60 * 1000) - 1;
  assert.equal(game.farmingService.harvest('harvester', [1, 2]).status, 'nothing-ready');
  assert.equal(game.repository.itemQuantity('harvester', 'carrot'), 0n);
  now += 1;
  const result = game.farmingService.harvest('harvester', [1, 2]);
  assert.deepEqual(result.plotNumbers, [1, 2]);
  assert.equal(result.amount, 10n);
  assert.equal(game.repository.itemQuantity('harvester', 'carrot'), 10n);
  assert.ok(game.repository.plots('harvester').slice(0, 2).every((plot) => plot.cropId === null && plot.plantedAt === null && !plot.anchors.length));
  assert.equal(game.farmingService.harvest('harvester', [1, 2]).status, 'nothing-ready');
  assert.equal(game.repository.itemQuantity('harvester', 'carrot'), 10n);
  game.close();
});

test('shovel clears only occupied plots and gives no refund', () => {
  const game = farmingFeature({ clock: () => 3_000_000, rng: () => 0 });
  game.farmingService.plant('shoveler', [3, 4], 'carrot_seed_package');
  const afterPlant = game.repository.itemQuantity('shoveler', 'carrot_seed_package');
  const result = game.farmingService.shovel('shoveler', [2, 3, 4]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.plotNumbers, [3, 4]);
  assert.equal(game.repository.itemQuantity('shoveler', 'carrot_seed_package'), afterPlant);
  assert.ok(game.repository.plots('shoveler').slice(2, 4).every((plot) => !plot.cropId && !plot.anchors.length));
  assert.equal(game.farmingService.shovel('shoveler', [3, 4]).status, 'nothing-occupied');
  game.close();
});

test('stale or concurrent planting cannot overwrite occupied plots or double-consume seeds', () => {
  const game = farmingFeature({ clock: () => 4_000_000, rng: () => 0 });
  const first = game.farmingService.plant('race', [7], 'carrot_seed_package');
  const anchors = game.repository.plots('race')[6].anchors;
  const second = game.farmingService.plant('race', [7], 'carrot_seed_package');
  assert.equal(first.status, 'ok');
  assert.equal(second.status, 'plots-changed');
  assert.equal(game.repository.itemQuantity('race', 'carrot_seed_package'), STARTER_ITEM_QUANTITY - 1n);
  assert.deepEqual(game.repository.plots('race')[6].anchors, anchors);
  game.close();
});

test('plot and action dropdown rules follow the latest selected plot state', () => {
  let now = 5_000_000;
  const game = farmingFeature({ clock: () => now, rng: () => 0 });
  const empty = game.farmingService.farmState('menus');
  assert.deepEqual(farmActionOptions(empty, new Set([1, 2])).map((option) => option.value), ['plant', 'gear']);
  game.farmingService.plant('menus', [1], 'carrot_seed_package');
  const mixed = game.farmingService.farmState('menus');
  assert.deepEqual(farmActionOptions(mixed, new Set([1, 2])).map((option) => option.value), ['shovel', 'gear']);
  now += 6 * 60 * 1000;
  const ready = game.farmingService.farmState('menus');
  assert.deepEqual(farmActionOptions(ready, new Set([1, 2])).map((option) => option.value), ['harvest', 'shovel', 'gear']);
  const view = { id: 'view', selectedPlots: new Set() };
  const payload = farmPayload('menus', ready, view, Buffer.from('farm'), { initial: false });
  const actionMenu = payload.components[0].components.at(-1).components[0];
  assert.equal(actionMenu.placeholder, 'Actions');
  assert.equal(actionMenu.disabled, true);
  assert.deepEqual(payload.attachments, []);
  game.close();
});

test('farm status uses exact empty, countdown, and fully-grown formats', () => {
  const empty = { plots: Array.from({ length: 9 }, (_, index) => ({ plotNumber: index + 1, occupied: false })) };
  assert.equal(farmStatusText(empty), '* Your farm seems empty...');
  const growing = { plots: [{ plotNumber: 1, occupied: true, ready: false, stage: 2, readyAt: 1_700_000_000_000 }] };
  assert.match(farmStatusText(growing), /^-# \*\*#1\*\* - <:carrot_stage_2:/);
  assert.match(farmStatusText(growing), /<t:1700000000:R>\.$/);
  const ready = { plots: [{ plotNumber: 9, occupied: true, ready: true, stage: 6 }] };
  assert.match(farmStatusText(ready), /\*\*\*Carrot is FULLY grown!\*\*\*/);
});

test('farm rendering returns a valid 1254 by 1254 PNG', async () => {
  let now = 6_000_000;
  const game = createFarmingGameFeature({ databasePath: ':memory:', clock: () => now, rng: () => 0 });
  game.farmingService.plant('render', [1, 5, 9], 'carrot_seed_package');
  now += 6 * 60 * 1000;
  const image = await game.farmRenderer.render(game.farmingService.farmState('render'));
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 1254);
  assert.equal(image.readUInt32BE(20), 1254);
  game.close();
});

test('open farm views refresh at growth boundaries and shutdown clears their timers', async () => {
  let now = 6_500_000;
  const timers = [];
  const cleared = [];
  const game = farmingFeature({
    clock: () => now,
    rng: () => 0,
    setTimer(callback, delay) {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { cleared.push(timer); },
  });
  game.farmingService.plant('refresh', [1], 'carrot_seed_package');
  let edits = 0;
  const view = game.farmViews.createFarm('refresh', { editOriginal: async () => { edits += 1; } });
  game.refreshScheduler.schedule(view);
  assert.equal(timers[0].delay, 60_000);
  now += 60_000;
  await timers[0].callback();
  assert.equal(edits, 1);
  assert.equal(timers[1].delay, 60_000);
  game.close();
  assert.ok(cleared.includes(timers[1]));
});

test('farm controls reject non-owners and expired view tokens ephemerally', async () => {
  let now = 7_000_000;
  const game = farmingFeature({ clock: () => now, sessionTtlMs: 1_000 });
  const view = game.farmViews.createFarm('owner');
  let reply;
  const wrongUserHandled = await game.handleInteraction({
    customId: `farm:plot:select:${view.id}`,
    user: { id: 'intruder' },
    values: ['1'],
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    isRepliable: () => true,
    reply: async (payload) => { reply = payload; },
  });
  assert.equal(wrongUserHandled, true);
  assert.match(componentText(reply), /Not your farm/);
  assert.ok(reply.flags);

  now += 1_000;
  reply = null;
  await game.handleInteraction({
    customId: `farm:plot:select:${view.id}`,
    user: { id: 'owner' },
    values: ['1'],
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    isRepliable: () => true,
    reply: async (payload) => { reply = payload; },
  });
  assert.match(componentText(reply), /Expired farm controls/);
  game.close();
});

test('/my-inventory switches types while keeping the type selector above controls', async () => {
  const game = farmingFeature();
  const view = game.inventoryViews.createInventory('switcher');
  let edited;
  const handled = await game.handleInteraction({
    customId: `farm:inv:type:${view.id}`,
    user: { id: 'switcher', username: 'Switcher' },
    values: ['other'],
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    deferUpdate: async () => {},
    editReply: async (payload) => { edited = payload; },
    isRepliable: () => true,
  });
  assert.equal(handled, true);
  assert.equal(view.type, 'other');
  assert.equal(edited.components[0].components[0].custom_id, `farm:inv:type:${view.id}`);
  assert.equal(edited.components[0].components[0].options.find((option) => option.value === 'other').default, true);
  game.close();
});

test('Farming inventory renders harvested crops and seed packages from stack categories with Farming currency', () => {
  let now = 8_000_000;
  const game = farmingFeature({ clock: () => now, rng: () => 0 });
  game.farmingService.plant('farmer-inventory', [1], 'carrot_seed_package');
  now += 6 * 60 * 1000;
  game.farmingService.harvest('farmer-inventory', [1]);
  const stacks = game.farmingService.inventory('farmer-inventory');
  const view = game.inventoryViews.createInventory('farmer-inventory');

  const cropsPayload = myInventoryPayload({ id: 'farmer-inventory', username: 'Farmer' }, stacks, view);
  assert.match(componentText(cropsPayload), /ITcarrotcrop/);
  assert.match(componentText(cropsPayload), /Carrot ×5/);
  assert.match(componentText(cropsPayload), /Rarity: Common • Type: consumable, ingredient/);
  assert.match(componentText(cropsPayload), /Unit value: 4 🪙/);

  view.type = 'other';
  const otherPayload = myInventoryPayload({ id: 'farmer-inventory', username: 'Farmer' }, stacks, view);
  assert.match(componentText(otherPayload), /Carrot Seed Package/);
  assert.match(componentText(otherPayload), /Unit value: 10 🪙/);
  assert.equal(ITEM_BY_ID.carrot.inventoryCategory, 'crops');
  assert.equal(ITEM_BY_ID.carrot_seed_package.inventoryCategory, 'other');
  game.close();
});

test('carrot render heights use seven positive, strictly increasing growth stages', () => {
  assert.deepEqual(STAGE_RENDER_HEIGHTS, [28, 34, 40, 48, 56, 64, 72]);
  assert.equal(STAGE_RENDER_HEIGHTS.length, 7);
  assert.ok(STAGE_RENDER_HEIGHTS.every((height) => Number.isFinite(height) && height > 0));
  for (let stage = 1; stage < STAGE_RENDER_HEIGHTS.length; stage += 1) {
    assert.ok(STAGE_RENDER_HEIGHTS[stage] > STAGE_RENDER_HEIGHTS[stage - 1]);
  }
  assert.ok(STAGE_RENDER_HEIGHTS[1] > STAGE_RENDER_HEIGHTS[0]);
});

test('all seven carrot stages render proportionally, bottom-aligned, and inside the soil', async () => {
  const game = createFarmingGameFeature({ databasePath: ':memory:' });
  const plots = PLOT_RECTS.map((plot, index) => ({
    plotNumber: plot.number,
    occupied: index < STAGE_RENDER_HEIGHTS.length,
    cropId: index < STAGE_RENDER_HEIGHTS.length ? 'carrot' : null,
    plantedAt: index < STAGE_RENDER_HEIGHTS.length ? index : null,
    stage: index < STAGE_RENDER_HEIGHTS.length ? index : 0,
    anchors: index < STAGE_RENDER_HEIGHTS.length ? generatePlotAnchors(plot.number, () => 0) : [],
  }));

  for (let stage = 0; stage < STAGE_RENDER_HEIGHTS.length; stage += 1) {
    const sprite = await game.farmRenderer.stageSprite(stage);
    const height = STAGE_RENDER_HEIGHTS[stage];
    const width = Math.max(1, Math.round((sprite.width / sprite.height) * height));
    const plot = PLOT_RECTS[stage];
    for (const anchor of plots[stage].anchors) {
      const left = Math.round(anchor.x - (width / 2));
      const top = Math.round(anchor.y - height);
      assert.equal(top + height, anchor.y, `stage ${stage} must stay bottom-aligned`);
      assert.ok(left >= plot.x && left + width <= plot.x + plot.width, `stage ${stage} must fit horizontally`);
      assert.ok(top >= plot.y && top + height <= plot.y + plot.height, `stage ${stage} must fit vertically`);
    }
  }

  const image = await game.farmRenderer.render({ plots });
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 1254);
  assert.equal(image.readUInt32BE(20), 1254);
  game.close();
});

test('Farming inventory paginates six stack entries at a time and renders one-column unit values', () => {
  const stacks = Array.from({ length: 7 }, (_, index) => stack('carrot', BigInt(index + 1)));
  const view = { type: 'crops', cropPage: 1, cropFilters: {} };
  const first = inventoryPageData(stacks, view);
  assert.equal(first.pageItems.length, 6);
  assert.equal(first.maxPage, 2);
  view.cropPage = 2;
  assert.equal(inventoryPageData(stacks, view).pageItems.length, 1);

  const fields = farmingInventoryFields([stack('carrot', 12n)]);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].inline, false);
  assert.match(fields[0].name, /Carrot ×12/);
  assert.match(fields[0].value, /Type: consumable, ingredient/);
  assert.match(fields[0].value, /Unit value: 4 🪙/);
});

test('Farming stack filters enforce explicit category and use OR within types and AND across fields', () => {
  const stacks = [stack('carrot_seed_package', 5n), stack('carrot', 10n)];
  assert.deepEqual(filterInventoryStacks(stacks, 'other', {}).map((entry) => entry.itemId), ['carrot_seed_package']);
  assert.deepEqual(filterInventoryStacks(stacks, 'crops', {}).map((entry) => entry.itemId), ['carrot']);
  assert.deepEqual(filterInventoryStacks(stacks, 'crops', { itemTypes: ['seed', 'ingredient'] }).map((entry) => entry.itemId), ['carrot']);
  assert.deepEqual(filterInventoryStacks(stacks, 'other', { itemTypes: ['seed'] }).map((entry) => entry.itemId), ['carrot_seed_package']);
  assert.deepEqual(filterInventoryStacks(stacks, 'crops', {
    name: 'carrot', rarity: 'Common', itemTypes: ['ingredient'],
  }).map((entry) => entry.itemId), ['carrot']);
  assert.deepEqual(filterInventoryStacks(stacks, 'crops', {
    name: 'package', rarity: 'Common', itemTypes: ['ingredient'],
  }), []);
});

test('/my-inventory has no RNG weight, BIG, capacity, balance, or upgrade UI in either category', () => {
  const game = farmingFeature();
  const view = game.inventoryViews.createInventory('other-view');
  const stacks = game.farmingService.inventory('other-view');
  for (const type of ['crops', 'other']) {
    view.type = type;
    const payload = myInventoryPayload({ id: 'other-view', username: 'Farmer' }, stacks, view);
    const text = componentText(payload);
    assert.doesNotMatch(text, /Capacity|Total value|Sheckles|weight|\bBIG\b/i);
    assert.doesNotMatch(text, /farm:inv:upgrade|"label":"Upgrade"/);
    assert.ok(payload.embeds[0].fields.every((field) => field.inline === false));
  }
  game.close();
});

test('an RNG crop never appears in /my-inventory while a harvested Farming carrot does', () => {
  let now = 9_000_000;
  const games = integratedGames({
    rng: { clock: () => now },
    farming: { clock: () => now, rng: () => 0 },
  });
  const userId = 'independent-player';
  const rngRoll = games.rng.gameService.roll(userId, { bypassCooldown: true });
  assert.equal(rngRoll.status, 'ok');
  assert.equal(games.rng.db.prepare('SELECT COUNT(*) AS count FROM rng_inventory_items WHERE owner_user_id = ?').get(userId).count, 1n);

  games.farming.farmingService.ensureProfile(userId);
  const view = games.farming.inventoryViews.createInventory(userId);
  const beforeHarvest = myInventoryPayload(
    { id: userId, username: 'Independent' },
    games.farming.farmingService.inventory(userId),
    view,
  );
  assert.equal(beforeHarvest.embeds[0].fields[0].name, 'No crops found');
  assert.doesNotMatch(componentText(beforeHarvest), /kg|CarrotFruit/);

  games.farming.farmingService.plant(userId, [1], 'carrot_seed_package');
  now += 6 * 60 * 1000;
  games.farming.farmingService.harvest(userId, [1]);
  const afterHarvest = myInventoryPayload(
    { id: userId, username: 'Independent' },
    games.farming.farmingService.inventory(userId),
    view,
  );
  assert.match(componentText(afterHarvest), /ITcarrotcrop/);
  assert.match(componentText(afterHarvest), /Carrot ×5/);
  assert.equal(games.rng.db.prepare('SELECT COUNT(*) AS count FROM rng_inventory_items WHERE owner_user_id = ?').get(userId).count, 1n);
  games.close();
});

test('an active RNG sale session does not block /my-inventory or its controls', async () => {
  const games = integratedGames();
  const user = { id: 'sale-independent', username: 'Independent' };
  games.rng.saleSessions.create(user.id);
  let reply;
  const handled = await games.farming.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'my-inventory',
    user,
    reply: async (payload) => { reply = payload; },
  });
  assert.equal(handled, true);
  assert.match(componentText(reply), /Inventory — Crops/);
  assert.doesNotMatch(componentText(reply), /Sale in progress|Finish or deny/);

  const view = [...games.farming.inventoryViews.records.values()][0];
  let edited;
  const controlHandled = await games.farming.handleInteraction({
    customId: `farm:inv:type:${view.id}`,
    user,
    values: ['other'],
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    deferUpdate: async () => {},
    editReply: async (payload) => { edited = payload; },
    isRepliable: () => true,
  });
  assert.equal(controlHandled, true);
  assert.match(componentText(edited), /Carrot Seed Package/);
  assert.doesNotMatch(componentText(edited), /Sale in progress|Finish or deny/);
  games.close();
});

test('RNG inventory, sale, balance, and inventory upgrade remain unchanged beside Farming', async () => {
  const games = integratedGames();
  const user = {
    id: 'rng-regression',
    username: 'RNG Player',
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  };
  const roll = games.rng.gameService.roll(user.id, { bypassCooldown: true });
  assert.equal(roll.status, 'ok');
  assert.equal(games.rng.gameService.inventory(user.id).items.length, 1);

  let inventoryReply;
  const handled = await games.rng.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'inventory',
    user,
    reply: async (payload) => { inventoryReply = payload; },
  });
  assert.equal(handled, true);
  assert.match(componentText(inventoryReply), /Capacity: 1 \/ 100/);
  assert.match(componentText(inventoryReply), /kg/);

  const sale = games.rng.gameService.sell(user.id, [roll.item.id], 'farming-isolation-sale');
  assert.equal(sale.status, 'ok');
  assert.equal(games.rng.gameService.balance(user.id), sale.total);
  games.rng.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?').run(5_000n, user.id);
  const upgrade = games.rng.gameService.upgrade(user.id, 'farming-isolation-upgrade');
  assert.equal(upgrade.status, 'ok');
  assert.equal(upgrade.inventoryCapacity, 110);
  assert.equal(games.rng.gameService.balance(user.id), 4_000n);
  games.close();
});

test('Farming commands register under their own guild feature and use its access policy', async () => {
  const config = {
    enabled: true,
    features: { farmingGame: true },
    farmingGame: { enabled: true },
  };
  const names = featureCommandsForConfig(config).map((command) => command.name);
  assert.deepEqual(names.slice(-2), ['my-farm', 'my-inventory']);

  const game = farmingFeature({
    getGuildPolicy: () => ({ unlocked: true, enabled: true, gameChannelIds: ['farm-channel'] }),
  });
  let reply;
  const handled = await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'my-inventory',
    guildId: 'guild',
    channelId: 'other-channel',
    member: { roles: [] },
    user: { id: 'policy-user', username: 'Policy' },
    reply: async (payload) => { reply = payload; },
  });
  assert.equal(handled, true);
  assert.match(componentText(reply), /only available in <#farm-channel>/);
  game.close();
});

test('catalog is centralized and farming shutdown clears isolated stores without closing a shared database', () => {
  assert.equal(Object.isFrozen(ITEMS), true);
  assert.equal(Object.isFrozen(ITEMS[0]), true);
  assert.deepEqual(ITEMS.map((item) => item.id), ['carrot_seed_package', 'carrot']);
  const owner = farmingFeature();
  const shared = createFarmingGameFeature({ db: owner.db, farmRenderer: fakeRenderer() });
  shared.farmViews.createFarm('close');
  shared.inventoryViews.createInventory('close');
  shared.close();
  assert.equal(shared.farmViews.records.size, 0);
  assert.equal(shared.inventoryViews.records.size, 0);
  assert.equal('cropRepository' in shared, false);
  assert.equal('cropGameService' in shared, false);
  assert.equal('saleSessions' in shared, false);
  assert.equal(owner.db.open, true);
  owner.close();
});
