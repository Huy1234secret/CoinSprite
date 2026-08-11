const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { featureCommandsForConfig } = require('../src/applicationCommands');
const { createFarmingGameFeature } = require('../src/features/farming-game');
const { createRngGameFeature } = require('../src/features/rng-game');
const {
  farmingInventoryFields,
  farmingStackFields,
  farmActionOptions,
  farmPayload,
  farmStatusText,
  myInventoryPayload,
} = require('../src/features/farming-game/components/builders');
const { ITEMS, ITEM_BY_ID, STARTER_ITEM_QUANTITY } = require('../src/features/farming-game/data/items');
const { migrateFarmingGame } = require('../src/features/farming-game/repositories/database');
const { FarmingGameRepository } = require('../src/features/farming-game/repositories/farmingRepository');
const { openSqliteDatabase } = require('../src/features/shared/database');
const { PLOT_RECTS, STAGE_TARGET_LONG_SIDES, anchorBounds } = require('../src/features/farming-game/renderer/config');
const {
  FarmRenderer,
  normalizedStageDimensions,
  renderKey,
  rotatedBounds,
  safeDrawCenter,
  safeDrawRect,
  stageRenderDimensions,
} = require('../src/features/farming-game/renderer/farmRenderer');
const { FarmingGameService } = require('../src/features/farming-game/services/farmingService');
const { evaluateFarmingGameAccess } = require('../src/features/farming-game/services/accessPolicy');
const { generatePlotAnchors, validPlotAnchors } = require('../src/features/farming-game/utils/anchors');
const { growthStage } = require('../src/features/farming-game/utils/growth');
const {
  CARROT_CONFIG,
  carrotValueForWeight,
  carrotWeightScale,
} = require('../src/features/farming-game/utils/crops');
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

function crop(id, weightUnits = 50, overrides = {}) {
  return {
    id: String(id),
    ownerUserId: 'farmer',
    cropId: 'carrot',
    rarity: 'Common',
    weightUnits,
    storedValue: BigInt(carrotValueForWeight(weightUnits)),
    state: 'inventory',
    plotNumber: null,
    anchor: null,
    item: ITEM_BY_ID.carrot,
    ...overrides,
  };
}

function renderedVisibleArea(sprite, dimensions) {
  const canvas = createCanvas(dimensions.width, dimensions.height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(sprite, 0, 0, dimensions.width, dimensions.height);
  const pixels = context.getImageData(0, 0, dimensions.width, dimensions.height).data;
  let visible = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) visible += 1;
  }
  return visible;
}

function rotatedRenderedVisibleArea(sprite, dimensions, rotationDegrees) {
  const bounds = rotatedBounds(dimensions.width, dimensions.height, rotationDegrees);
  const canvas = createCanvas(Math.ceil(bounds.width) + 4, Math.ceil(bounds.height) + 4);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotationDegrees * Math.PI) / 180);
  context.drawImage(
    sprite,
    -(dimensions.width / 2),
    -(dimensions.height / 2),
    dimensions.width,
    dimensions.height,
  );
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let visible = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) visible += 1;
  }
  return visible;
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

test('planting consumes one package per plot and creates five unique stable crop instances per plot', () => {
  let now = 100_000;
  let nextId = 0;
  const game = farmingFeature({ clock: () => now, rng: () => 0, idGenerator: () => `crop-${nextId += 1}` });
  const result = game.farmingService.plant('planter', [1, 5, 9], 'carrot_seed_package');
  assert.equal(result.status, 'ok');
  assert.equal(result.remaining, STARTER_ITEM_QUANTITY - 3n);
  const planted = game.repository.plots('planter').filter((plot) => plot.cropId);
  assert.equal(planted.length, 3);
  for (const plot of planted) {
    assert.equal(plot.cropId, 'carrot');
    assert.equal(plot.plantedAt, now);
    assert.equal(plot.anchors.length, 5);
    assert.equal(plot.cropInstances.length, 5);
    assert.ok(plot.cropInstances.every((instance) => (
      instance.weightUnits === 20
        && instance.storedValue === 2n
        && instance.seedRotationDegrees === 0
    )));
    assert.equal(validPlotAnchors(plot.plotNumber, plot.anchors), true);
  }
  const instances = game.repository.plantedCropInstancesForOwner('planter');
  assert.equal(instances.length, 15);
  assert.equal(new Set(instances.map((instance) => instance.id)).size, 15);
  assert.ok(instances.every((instance) => instance.seedRotationDegrees >= 0 && instance.seedRotationDegrees <= 359));
  game.close();
});

test('seed rotation is generated exactly once per crop with injected RNG and remains stored', async () => {
  const rotations = [7, 83, 159, 241, 359];
  let cropIndex = 0;
  let randomCalls = 0;
  const game = farmingFeature({
    clock: () => 200_000,
    anchorGenerator: (plotNumber) => generatePlotAnchors(plotNumber, () => 0),
    rng(maximum) {
      randomCalls += 1;
      if (maximum === 61) return cropIndex;
      if (maximum === 360) return rotations[cropIndex++];
      throw new Error(`Unexpected Farming RNG maximum: ${maximum}`);
    },
  });
  game.farmingService.plant('rotations', [1], 'carrot_seed_package');
  assert.equal(randomCalls, 10);
  const firstRead = game.repository.plantedCropInstancesForOwner('rotations');
  assert.deepEqual(firstRead.map((instance) => instance.seedRotationDegrees).sort((a, b) => a - b), rotations);
  assert.ok(firstRead.every((instance) => instance.seedRotationDegrees >= 0 && instance.seedRotationDegrees <= 359));
  await game.farmRenderer.render(game.farmingService.farmState('rotations'));
  const secondRead = game.repository.plantedCropInstancesForOwner('rotations');
  assert.deepEqual(
    secondRead.map((instance) => [instance.id, instance.seedRotationDegrees]),
    firstRead.map((instance) => [instance.id, instance.seedRotationDegrees]),
  );
  assert.equal(randomCalls, 10, 'rendering and reads must not call Farming RNG');
  game.close();
});

test('migration preserves legacy planted anchors and stacked carrots without touching RNG inventory', () => {
  const db = openSqliteDatabase(':memory:');
  db.exec(fs.readFileSync(require.resolve('../src/features/farming-game/migrations/001_farming_game.sql'), 'utf8'));
  db.exec(`CREATE TABLE rng_inventory_items (id INTEGER PRIMARY KEY, marker TEXT NOT NULL)`);
  db.prepare('INSERT INTO rng_inventory_items (marker) VALUES (?)').run('rng-kept');
  db.prepare(`INSERT INTO farm_profiles (user_id, starter_granted, created_at, updated_at)
    VALUES ('legacy', 1, 10, 90)`).run();
  const anchors = [
    { x: 330, y: 400 }, { x: 380, y: 400 }, { x: 430, y: 400 }, { x: 355, y: 455 }, { x: 415, y: 455 },
  ];
  db.prepare(`INSERT INTO farm_plots
    (owner_user_id, plot_number, crop_id, planted_at, anchors_json, updated_at)
    VALUES ('legacy', 1, 'carrot', 10, ?, 90)`).run(JSON.stringify(anchors));
  db.prepare(`INSERT INTO farm_item_stacks (owner_user_id, item_id, quantity, updated_at)
    VALUES ('legacy', 'carrot', 3, 90)`).run();

  migrateFarmingGame(db);
  const repository = new FarmingGameRepository(db);
  const planted = repository.plantedCropInstancesForOwner('legacy');
  const inventory = repository.inventoryCropInstances('legacy');
  assert.equal(planted.length, 5);
  assert.equal(inventory.length, 3);
  assert.deepEqual(planted.map((instance) => instance.anchor), anchors);
  assert.ok([...planted, ...inventory].every((instance) => (
    instance.weightUnits >= 20 && instance.weightUnits <= 80
      && instance.storedValue >= 2n && instance.storedValue <= 12n
      && instance.seedRotationDegrees >= 0 && instance.seedRotationDegrees <= 359
  )));
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM farm_item_stacks WHERE item_id = 'carrot'`).get().count, 0n);
  assert.equal(db.prepare(`SELECT crop_id FROM farm_plots WHERE owner_user_id = 'legacy' AND plot_number = 1`).get().crop_id, null);
  assert.equal(db.prepare('SELECT marker FROM rng_inventory_items').get().marker, 'rng-kept');
  const stable = [...planted, ...inventory].map((instance) => [
    instance.id,
    instance.weightUnits,
    instance.storedValue,
    instance.seedRotationDegrees,
  ]);
  migrateFarmingGame(db);
  assert.deepEqual([
    ...repository.plantedCropInstancesForOwner('legacy'),
    ...repository.inventoryCropInstances('legacy'),
  ].map((instance) => [
    instance.id,
    instance.weightUnits,
    instance.storedValue,
    instance.seedRotationDegrees,
  ]), stable);
  db.close();
});

test('migration backfills one stable seed rotation for existing crop instances', () => {
  const db = openSqliteDatabase(':memory:');
  db.exec(fs.readFileSync(require.resolve('../src/features/farming-game/migrations/001_farming_game.sql'), 'utf8'));
  db.exec(fs.readFileSync(require.resolve('../src/features/farming-game/migrations/002_crop_instances.sql'), 'utf8'));
  db.prepare(`INSERT INTO farm_profiles (user_id, starter_granted, created_at, updated_at)
    VALUES ('pre-rotation', 1, 10, 10)`).run();
  db.prepare(`INSERT INTO farm_crop_instances
    (id, owner_user_id, crop_id, rarity, weight_units, stored_value, state,
      plot_number, anchor_x, anchor_y, planted_at, harvested_at, created_at, updated_at)
    VALUES ('existing-crop', 'pre-rotation', 'carrot', 'Common', 50, 7, 'planted',
      1, 350, 430, 10, NULL, 10, 10)`).run();
  migrateFarmingGame(db);
  const first = db.prepare(`SELECT seed_rotation_degrees FROM farm_crop_instances
    WHERE id = 'existing-crop'`).get().seed_rotation_degrees;
  assert.ok(first >= 0n && first <= 359n);
  migrateFarmingGame(db);
  assert.equal(db.prepare(`SELECT seed_rotation_degrees FROM farm_crop_instances
    WHERE id = 'existing-crop'`).get().seed_rotation_degrees, first);
  db.close();
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

test('harvest atomically moves five stable instances per ready plot without creating carrot stacks', async () => {
  let now = 2_000_000;
  let randomDraw = 0;
  const game = farmingFeature({ clock: () => now, rng: (maximum) => (randomDraw++ % maximum) });
  game.farmingService.plant('harvester', [1, 2], 'carrot_seed_package');
  const planted = game.repository.plantedCropInstancesForOwner('harvester');
  const stable = planted.map((cropInstance) => ({
    id: cropInstance.id,
    weightUnits: cropInstance.weightUnits,
    storedValue: cropInstance.storedValue,
    seedRotationDegrees: cropInstance.seedRotationDegrees,
  }));
  await game.farmRenderer.render(game.farmingService.farmState('harvester'));
  assert.deepEqual(game.repository.plantedCropInstancesForOwner('harvester').map((instance) => ({
    id: instance.id,
    weightUnits: instance.weightUnits,
    storedValue: instance.storedValue,
    seedRotationDegrees: instance.seedRotationDegrees,
  })), stable);
  now += (6 * 60 * 1000) - 1;
  assert.equal(game.farmingService.harvest('harvester', [1, 2]).status, 'nothing-ready');
  assert.equal(game.repository.inventoryCropInstances('harvester').length, 0);
  now += 1;
  const result = game.farmingService.harvest('harvester', [1, 2]);
  assert.deepEqual(result.plotNumbers, [1, 2]);
  assert.equal(result.amount, 10n);
  const inventory = game.repository.inventoryCropInstances('harvester');
  assert.equal(inventory.length, 10);
  assert.deepEqual(inventory.map((instance) => ({
    id: instance.id,
    weightUnits: instance.weightUnits,
    storedValue: instance.storedValue,
    seedRotationDegrees: instance.seedRotationDegrees,
  })).sort((a, b) => a.id.localeCompare(b.id)), stable.sort((a, b) => a.id.localeCompare(b.id)));
  assert.ok(inventory.every((instance) => instance.plotNumber === null && instance.anchor === null));
  assert.equal(game.db.prepare(`SELECT COUNT(*) AS count FROM farm_item_stacks
    WHERE owner_user_id = ? AND item_id = 'carrot'`).get('harvester').count, 0n);
  assert.ok(game.repository.plots('harvester').slice(0, 2).every((plot) => plot.cropId === null && plot.plantedAt === null && !plot.anchors.length));
  assert.equal(game.farmingService.harvest('harvester', [1, 2]).status, 'nothing-ready');
  assert.equal(game.repository.inventoryCropInstances('harvester').length, 10);
  game.close();
});

test('Farming carrot weights are inclusive and values are monotonic at exact endpoints', () => {
  assert.deepEqual(CARROT_CONFIG, {
    minimumWeight: 0.20,
    maximumWeight: 0.80,
    minimumWeightUnits: 20,
    maximumWeightUnits: 80,
    minimumValue: 2,
    maximumValue: 12,
    rarity: 'Common',
  });
  let previous = -1;
  for (let weightUnits = 20; weightUnits <= 80; weightUnits += 1) {
    const value = carrotValueForWeight(weightUnits);
    assert.ok(value >= previous);
    assert.ok(value >= 2 && value <= 12);
    previous = value;
  }
  assert.equal(carrotValueForWeight(20), 2);
  assert.equal(carrotValueForWeight(80), 12);

  const minimum = farmingFeature({ rng: () => 0 });
  minimum.farmingService.plant('minimum', [1], 'carrot_seed_package');
  assert.ok(minimum.repository.plantedCropInstancesForOwner('minimum').every((instance) => instance.weightUnits === 20));
  minimum.close();
  const maximum = farmingFeature({ rng: (upper) => upper - 1 });
  maximum.farmingService.plant('maximum', [1], 'carrot_seed_package');
  assert.ok(maximum.repository.plantedCropInstancesForOwner('maximum').every((instance) => instance.weightUnits === 80));
  maximum.close();
});

test('shovel clears only occupied plots and gives no refund', () => {
  const game = farmingFeature({ clock: () => 3_000_000, rng: () => 0 });
  game.farmingService.plant('shoveler', [3, 4], 'carrot_seed_package');
  const afterPlant = game.repository.itemQuantity('shoveler', 'carrot_seed_package');
  const result = game.farmingService.shovel('shoveler', [2, 3, 4]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.plotNumbers, [3, 4]);
  assert.equal(game.repository.itemQuantity('shoveler', 'carrot_seed_package'), afterPlant);
  assert.equal(result.deletedCount, 10);
  assert.equal(game.repository.plantedCropInstancesForOwner('shoveler').length, 0);
  assert.equal(game.repository.inventoryCropInstances('shoveler').length, 0);
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

test('/my-farm renders current growth only when explicitly run and creates no live timers or editors', async () => {
  let now = 6_500_000;
  let timerCreations = 0;
  const renderedStages = [];
  const game = farmingFeature({
    clock: () => now,
    rng: () => 0,
    farmRenderer: {
      async render(state) {
        renderedStages.push(state.plots[0].stage);
        return Buffer.from('farm');
      },
      clear() {},
    },
    setTimer() { timerCreations += 1; },
  });
  game.farmingService.plant('refresh', [1], 'carrot_seed_package');
  const runFarm = async () => {
    let edits = 0;
    await game.handleInteraction({
      isChatInputCommand: () => true,
      commandName: 'my-farm',
      user: { id: 'refresh' },
      reply: async () => {},
      editReply: async () => { edits += 1; },
    });
    return edits;
  };
  assert.equal(await runFarm(), 1);
  now += 3 * 60_000;
  assert.deepEqual(renderedStages, [0]);
  assert.equal(await runFarm(), 1);
  assert.deepEqual(renderedStages, [0, 3]);
  assert.equal(timerCreations, 0);
  assert.equal('refreshScheduler' in game, false);
  assert.ok([...game.farmViews.records.values()].every((view) => !Object.hasOwn(view, 'editOriginal')));
  game.close();
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

test('Farming inventory renders individual two-column crops while Other stays stack-based with Farming currency', () => {
  let now = 8_000_000;
  const game = farmingFeature({ clock: () => now, rng: () => 0 });
  game.farmingService.plant('farmer-inventory', [1], 'carrot_seed_package');
  now += 6 * 60 * 1000;
  game.farmingService.harvest('farmer-inventory', [1]);
  const inventory = game.farmingService.inventory('farmer-inventory');
  const view = game.inventoryViews.createInventory('farmer-inventory');

  const cropsPayload = myInventoryPayload({ id: 'farmer-inventory', username: 'Farmer' }, inventory, view);
  const cropFields = cropsPayload.embeds[0].fields;
  assert.equal(inventory.crops.length, 5);
  assert.equal(inventory.stacks.some((entry) => entry.itemId === 'carrot'), false);
  assert.equal(cropFields.length, 7);
  assert.deepEqual(cropFields[0], {
    name: `${ITEM_BY_ID.carrot.emoji} Carrot`,
    value: `-# 0.20 kg - ${ITEM_BY_ID.carrot.rarityEmoji}`,
    inline: true,
  });
  assert.deepEqual(cropFields[2], { name: '\u200b', value: '\u200b', inline: true });
  assert.doesNotMatch(JSON.stringify(cropFields), /quantity|Unit value|Type:|\bBIG\b|×5/i);

  view.type = 'other';
  const otherPayload = myInventoryPayload({ id: 'farmer-inventory', username: 'Farmer' }, inventory, view);
  assert.match(componentText(otherPayload), /Carrot Seed Package/);
  assert.match(componentText(otherPayload), /Unit value: 10 🪙/);
  assert.equal(ITEM_BY_ID.carrot.inventoryCategory, 'crops');
  assert.equal(ITEM_BY_ID.carrot_seed_package.inventoryCategory, 'other');
  game.close();
});

test('target longest sides and measured visible pixels strictly increase across every stage', async () => {
  assert.deepEqual(STAGE_TARGET_LONG_SIDES, [28, 38, 50, 66, 78, 90, 102]);
  assert.ok(STAGE_TARGET_LONG_SIDES.every((target, index) => index === 0 || target > STAGE_TARGET_LONG_SIDES[index - 1]));
  const game = createFarmingGameFeature({ databasePath: ':memory:' });
  const sprites = await Promise.all(Array.from({ length: 7 }, (_, stage) => game.farmRenderer.stageSprite(stage)));
  assert.deepEqual(sprites.map((sprite) => [sprite.width, sprite.height]), [
    [564, 640], [60, 72], [150, 110], [98, 180], [205, 250], [287, 330], [347, 380],
  ]);
  const normalized = sprites.map((sprite, stage) => normalizedStageDimensions(sprite, stage));
  assert.deepEqual(normalized.map(({ width, height }) => Math.max(width, height)), STAGE_TARGET_LONG_SIDES);
  const normalizedVisibleAreas = normalized.map((dimensions, stage) => renderedVisibleArea(sprites[stage], dimensions));
  assert.ok(normalizedVisibleAreas.every((area, index) => index === 0 || area > normalizedVisibleAreas[index - 1]));
  assert.ok(normalizedVisibleAreas[3] > normalizedVisibleAreas[2], 'narrow stage 3 must visibly exceed stage 2');

  for (const weightUnits of [20, 50, 80]) {
    const dimensions = sprites.map((sprite, stage) => stageRenderDimensions(sprite, stage, weightUnits));
    const visibleAreas = dimensions.map((entry, stage) => renderedVisibleArea(sprites[stage], entry));
    assert.ok(visibleAreas.every((area, index) => index === 0 || area > visibleAreas[index - 1]),
      `stage visible area must increase at weight ${weightUnits}`);
    for (const rotation of [0, 47, 137, 271, 359]) {
      const rotatedAreas = [...visibleAreas];
      rotatedAreas[0] = rotatedRenderedVisibleArea(sprites[0], dimensions[0], rotation);
      assert.ok(rotatedAreas.every((area, index) => index === 0 || area > rotatedAreas[index - 1]),
        `rotated stage visible area must increase at weight ${weightUnits} and rotation ${rotation}`);
    }
  }

  const mature = stageRenderDimensions(sprites[6], 6, 50);
  const previousMatureVisibleArea = renderedVisibleArea(sprites[6], { width: 83, height: 91 });
  assert.ok(renderedVisibleArea(sprites[6], mature) > previousMatureVisibleArea * 1.2,
    'stage 6 must be substantially larger than the previous mature render');
  game.close();
});

test('longest-side rendering preserves aspect ratios, weight scaling, soil anchoring, and safe bounds', async () => {
  const game = createFarmingGameFeature({ databasePath: ':memory:' });
  for (let stage = 0; stage < 7; stage += 1) {
    const sprite = await game.farmRenderer.stageSprite(stage);
    const plot = PLOT_RECTS[stage];
    const light = stageRenderDimensions(sprite, stage, 20);
    const heavy = stageRenderDimensions(sprite, stage, 80);
    assert.ok(heavy.width > light.width && heavy.height > light.height);
    assert.ok(Math.abs((heavy.width / heavy.height) - (sprite.width / sprite.height)) < 0.05);
    const anchor = { x: plot.x + (plot.width / 2), y: plot.y + plot.height - 16 };
    if (stage === 0) {
      const bounds = rotatedBounds(heavy.width, heavy.height, 47);
      const center = safeDrawCenter(plot, anchor, bounds.width, bounds.height);
      assert.ok(center.x - (bounds.width / 2) >= plot.x + 6);
      assert.ok(center.x + (bounds.width / 2) <= plot.x + plot.width - 6);
      assert.ok(center.y - (bounds.height / 2) >= plot.y + 6);
      assert.ok(center.y + (bounds.height / 2) <= plot.y + plot.height - 6);
    } else {
      const draw = safeDrawRect(plot, anchor, heavy.width, heavy.height);
      assert.equal(draw.y + draw.height, anchor.y, `stage ${stage} stays bottom-aligned when it fits`);
      assert.ok(draw.x >= plot.x + 6 && draw.x + draw.width <= plot.x + plot.width - 6);
      assert.ok(draw.y >= plot.y + 6 && draw.y + draw.height <= plot.y + plot.height - 6);
      const shifted = safeDrawRect(plot, { x: plot.x, y: plot.y }, heavy.width, heavy.height);
      assert.equal(shifted.width, heavy.width, 'clipping resolution must not resize crops');
      assert.equal(shifted.height, heavy.height, 'clipping resolution must not resize crops');
      assert.ok(shifted.x >= plot.x + 6 && shifted.y >= plot.y + 6, `stage ${stage} is shifted inside safe bounds`);
    }
  }
  assert.equal(carrotWeightScale(20), 0.90);
  assert.equal(carrotWeightScale(80), 1.15);
  game.close();
});

test('stored seed rotations are deterministic, visually distinct at stage 0, and ignored later', async () => {
  const transparent = createCanvas(1254, 1254);
  const renderer = new FarmRenderer({
    baseImagePath: 'transparent',
    loadImage: async (source) => (source === 'transparent' ? transparent : loadImage(source)),
  });
  const plot = PLOT_RECTS[0];
  const anchor = { x: plot.x + (plot.width / 2), y: plot.y + plot.height - 16 };
  const state = (stage, seedRotationDegrees) => ({
    plots: [{
      plotNumber: 1,
      occupied: true,
      cropId: 'carrot',
      plantedAt: 1,
      stage,
      anchors: [anchor],
      cropInstances: [{
        id: 'rotating-seed',
        weightUnits: 50,
        seedRotationDegrees,
        anchorX: anchor.x,
        anchorY: anchor.y,
        anchor,
      }],
    }],
  });

  const first = await renderer.render(state(0, 37));
  renderer.renderCache.clear();
  const repeated = await renderer.render(state(0, 37));
  assert.ok(first.equals(repeated), 're-rendering a stored rotation must be pixel-identical');
  const zeroDegrees = await renderer.render(state(0, 0));
  const ninetyDegrees = await renderer.render(state(0, 90));
  assert.ok(!zeroDegrees.equals(ninetyDegrees), 'different stored rotations must change stage-0 pixels');
  assert.notEqual(renderKey(state(0, 0)), renderKey(state(0, 90)));

  const uprightA = await renderer.render(state(1, 0));
  const uprightB = await renderer.render(state(1, 271));
  assert.ok(uprightA.equals(uprightB), 'seed rotation must be ignored after stage 0');
  renderer.clear();
});

test('rotated seeds and mature carrots keep every visible pixel inside plot safe bounds', async () => {
  const transparent = createCanvas(1254, 1254);
  const renderer = new FarmRenderer({
    baseImagePath: 'transparent',
    loadImage: async (source) => (source === 'transparent' ? transparent : loadImage(source)),
  });
  const plot = PLOT_RECTS[0];
  const anchor = { x: plot.x + 38, y: plot.y + 78 };

  async function visiblePixelCounts(stage, rotation) {
    const buffer = await renderer.render({
      plots: [{
        plotNumber: 1,
        occupied: true,
        cropId: 'carrot',
        plantedAt: 1,
        stage,
        anchors: [anchor],
        cropInstances: [{
          id: `edge-${stage}-${rotation}`,
          weightUnits: 80,
          seedRotationDegrees: rotation,
          anchorX: anchor.x,
          anchorY: anchor.y,
          anchor,
        }],
      }],
    });
    const image = await loadImage(buffer);
    const canvas = createCanvas(1254, 1254);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, 1254, 1254).data;
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < 1254; y += 1) {
      for (let x = 0; x < 1254; x += 1) {
        if (pixels[((y * 1254) + x) * 4 + 3] === 0) continue;
        if (x >= plot.x + 6 && x < plot.x + plot.width - 6
          && y >= plot.y + 6 && y < plot.y + plot.height - 6) inside += 1;
        else outside += 1;
      }
    }
    return { inside, outside };
  }

  for (const [stage, rotation] of [[0, 47], [6, 271]]) {
    const counts = await visiblePixelCounts(stage, rotation);
    assert.ok(counts.inside > 0);
    assert.equal(counts.outside, 0);
  }
  renderer.clear();
});

test('selected plot numbers are cached and rendered as sharp white dashed inset outlines', async () => {
  const black = createCanvas(1254, 1254);
  const blackContext = black.getContext('2d');
  blackContext.fillStyle = '#000000';
  blackContext.fillRect(0, 0, 1254, 1254);
  const renderer = new FarmRenderer({ baseImagePath: 'black', loadImage: async () => black });
  const state = { plots: PLOT_RECTS.map((plot) => ({ plotNumber: plot.number, occupied: false, anchors: [] })) };
  assert.equal(renderKey(state, { selectedPlotNumbers: [3, 1, 3] }), renderKey(state, { selectedPlotNumbers: [1, 3] }));
  assert.notEqual(renderKey(state), renderKey(state, { selectedPlotNumbers: [1] }));

  async function whitePixels(buffer, plot) {
    const image = await loadImage(buffer);
    const canvas = createCanvas(1254, 1254);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(plot.x + 4, plot.y + 4, plot.width - 8, 6).data;
    let white = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] === 255 && pixels[index + 1] === 255 && pixels[index + 2] === 255 && pixels[index + 3] === 255) white += 1;
    }
    return white;
  }

  const plain = await renderer.render(state);
  const selected = await renderer.render(state, { selectedPlotNumbers: [1, 2] });
  assert.equal(await whitePixels(plain, PLOT_RECTS[0]), 0);
  assert.ok(await whitePixels(selected, PLOT_RECTS[0]) > 50);
  assert.ok(await whitePixels(selected, PLOT_RECTS[1]) > 50);
  assert.equal(await whitePixels(selected, PLOT_RECTS[2]), 0);
  assert.ok(renderer.renderCache.size <= 12);
  renderer.clear();
});

test('Farming crop inventory paginates 12 instances and inserts a spacer after every pair', () => {
  const inventory = { crops: Array.from({ length: 13 }, (_, index) => crop(index + 1, 20 + index)), stacks: [] };
  const view = { type: 'crops', cropPage: 1, cropFilters: {} };
  const first = inventoryPageData(inventory, view);
  assert.equal(first.pageItems.length, 12);
  assert.equal(first.maxPage, 2);
  view.cropPage = 2;
  assert.equal(inventoryPageData(inventory, view).pageItems.length, 1);

  const fields = farmingInventoryFields(inventory.crops.slice(0, 4));
  assert.equal(fields.length, 6);
  assert.ok(fields.every((field) => field.inline));
  assert.deepEqual([fields[2].name, fields[5].name], ['\u200b', '\u200b']);
  assert.deepEqual(fields[0], {
    name: `${ITEM_BY_ID.carrot.emoji} Carrot`,
    value: `-# 0.20 kg - ${ITEM_BY_ID.carrot.rarityEmoji}`,
    inline: true,
  });

  const other = farmingStackFields([stack('carrot_seed_package', 12n)]);
  assert.equal(other[0].inline, false);
  assert.match(other[0].value, /Unit value: 10 🪙/);
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

test('/my-inventory uses only Farming crop fields and has no RNG capacity, balance, BIG, or upgrade UI', () => {
  let now = 1_000;
  const game = farmingFeature({ clock: () => now, rng: () => 0 });
  game.farmingService.plant('other-view', [1], 'carrot_seed_package');
  now += 6 * 60_000;
  game.farmingService.harvest('other-view', [1]);
  const view = game.inventoryViews.createInventory('other-view');
  const inventory = game.farmingService.inventory('other-view');
  for (const type of ['crops', 'other']) {
    view.type = type;
    const payload = myInventoryPayload({ id: 'other-view', username: 'Farmer' }, inventory, view);
    const text = componentText(payload);
    assert.doesNotMatch(text, /Capacity|Total value|Sheckles|Weight:|\bBIG\b/i);
    assert.doesNotMatch(text, /farm:inv:upgrade|"label":"Upgrade"/);
    assert.ok(payload.embeds[0].fields.every((field) => field.inline === (type === 'crops')));
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
  assert.equal(afterHarvest.embeds[0].fields.filter((field) => field.name.includes('Carrot')).length, 5);
  assert.doesNotMatch(componentText(afterHarvest), /CarrotFruit/);
  assert.equal(games.farming.db.prepare(`SELECT COUNT(*) AS count FROM farm_crop_instances
    WHERE owner_user_id = ? AND state = 'inventory'`).get(userId).count, 5n);
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
