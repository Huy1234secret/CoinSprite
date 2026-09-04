const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { featureCommandsForConfig } = require('../src/applicationCommands');
const { COMPONENTS_V2_FLAG } = require('../src/features/shared/components');
const { messagePayloadErrors } = require('../src/features/shared/discordPayload');
const { createInventoryFeature, parseInventoryCommand } = require('../src/features/inventory');
const {
  inventoryPageModal, inventoryPayload, itemLine,
} = require('../src/features/inventory/components/builders');
const { ITEM_CATALOG, itemMetadata } = require('../src/features/inventory/itemCatalog');
const { InventoryRepository } = require('../src/features/inventory/repositories/inventoryRepository');
const { PAGE_SIZE, paginateStacks } = require('../src/features/inventory/services/inventoryService');
const { openDatabase } = require('../src/features/work/repositories/database');
const { WorkRepository } = require('../src/features/work/repositories/workRepository');

const GUILD = '123456789012345678';
const CHANNEL = '223456789012345678';
const USER = '323456789012345678';
const OTHER_USER = '323456789012345679';

function textContent(payload) {
  return payload.components[0].components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');
}

function switchButton(payload) {
  return payload.components[0].components.find((component) => component.type === 1).components[0];
}

function insertStack(db, itemKey, quantity, userId = USER) {
  db.prepare(`INSERT INTO inventory (user_id,item_key,quantity,updated_at)
    VALUES (?,?,?,?)`).run(userId, itemKey, BigInt(quantity), 1n);
}

function modalInteraction(value, overrides = {}) {
  return {
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => true,
    customId: `csinventory:modal:${USER}`,
    user: { id: USER },
    guildId: GUILD,
    channelId: CHANNEL,
    deferred: false,
    replied: false,
    fields: { getTextInputValue: () => value },
    ...overrides,
  };
}

test('/cs-inventory is registered for enabled guilds and csinventory parsing is exact', () => {
  const commands = featureCommandsForConfig({
    enabled: true, features: { leveling: false }, leveling: { enabled: false },
  });
  const inventory = commands.find((command) => command.name === 'cs-inventory');
  assert.equal(inventory.description, 'View your CoinSprite inventory.');
  assert.equal(inventory.options?.length || 0, 0);
  for (const value of ['csinventory', ' CSINVENTORY ', '\nCsInventory\t']) {
    assert.equal(parseInventoryCommand(value), true);
  }
  for (const value of ['', 'cs-inventory', 'csinventory extra', 'csinventorytest', 'xcsinventory']) {
    assert.equal(parseInventoryCommand(value), false);
  }
});

test('catalog metadata, item lines, unknown fallback, sorting, and pagination are exact', () => {
  assert.deepEqual(ITEM_CATALOG[0], {
    itemKey: 'work_token', name: 'Work Token', emoji: '<:CSWorkToken:1545303925907918938>',
    rarity: 'C', type: 'Currency', sortOrder: 100,
  });
  const workToken = { ...ITEM_CATALOG[0], quantity: 9_007_199_254_740_993n };
  assert.equal(itemLine(workToken), '<:CSWorkToken:1545303925907918938> Work Token `×9007199254740993`\n-# Rarity: C • Currency');
  assert.deepEqual(itemMetadata('ancient_relic'), {
    itemKey: 'ancient_relic', name: 'Ancient Relic', emoji: '📦',
    rarity: 'Unknown', type: 'Item', sortOrder: Number.MAX_SAFE_INTEGER,
  });

  const stacks = [
    { itemKey: 'z_item', quantity: 1n },
    { itemKey: 'work_token', quantity: 3n },
    { itemKey: 'hidden_item', quantity: 0n },
    ...Array.from({ length: 9 }, (_, index) => ({ itemKey: `item_${String(index).padStart(2, '0')}`, quantity: 1n })),
  ];
  const first = paginateStacks(stacks, 1);
  const again = paginateStacks([...stacks].reverse(), 1);
  const second = paginateStacks(stacks, 2);
  assert.equal(PAGE_SIZE, 10);
  assert.equal(first.totalItemStacks, 11);
  assert.equal(first.maxPages, 2);
  assert.equal(first.items.length, 10);
  assert.equal(second.items.length, 1);
  assert.equal(first.items[0].itemKey, 'work_token');
  assert.deepEqual(first.items.map((item) => item.itemKey), again.items.map((item) => item.itemKey));
  assert.ok(!first.items.some((item) => item.itemKey === 'hidden_item'));
  assert.match(itemLine(second.items[0]), /^📦 Z Item `×1`\n-# Rarity: Unknown • Item$/);
});

test('empty and populated inventory payloads are valid restricted Components V2 messages', () => {
  const empty = inventoryPayload(USER, paginateStacks([]));
  assert.deepEqual(messagePayloadErrors(empty), []);
  assert.equal(empty.content, null);
  assert.deepEqual(empty.embeds, []);
  assert.deepEqual(empty.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
  assert.ok((empty.flags & COMPONENTS_V2_FLAG) !== 0);
  assert.match(textContent(empty), new RegExp(`### <@${USER}>'s Inventory`));
  assert.match(textContent(empty), /-# Your inventory is empty\./);
  assert.match(textContent(empty), /-# Page 1\/1 • 0 item stacks/);
  assert.equal(switchButton(empty).style, 2);
  assert.equal(switchButton(empty).label, 'Switch Page');
  assert.equal(switchButton(empty).disabled, true);
  assert.equal(switchButton(empty).custom_id, `csinventory:page:${USER}`);
  assert.ok(switchButton(empty).custom_id.length < 100);

  const multiple = inventoryPayload(USER, paginateStacks(Array.from(
    { length: 11 }, (_, index) => ({ itemKey: `item_${index}`, quantity: 1n }),
  )));
  assert.deepEqual(messagePayloadErrors(multiple), []);
  assert.equal(switchButton(multiple).disabled, false);
});

test('page modal uses the exact dynamic title, label, short input, and required setting', () => {
  const modal = inventoryPageModal(USER, 12);
  const input = modal.components[0].components[0];
  assert.equal(modal.custom_id, `csinventory:modal:${USER}`);
  assert.equal(modal.title, 'Switch Inventory Page');
  assert.equal(input.custom_id, 'page');
  assert.equal(input.label, 'Which page would you like to view?');
  assert.equal(input.placeholder, '1 - 12');
  assert.equal(input.style, 1);
  assert.equal(input.required, true);
  assert.ok(modal.custom_id.length < 100);
});

test('feature ignores unsafe text messages and displays only the invoking user inventory', async () => {
  const db = openDatabase({ databasePath: ':memory:' });
  const feature = createInventoryFeature({ db, isCommandAllowed: () => true });
  insertStack(db, 'work_token', 3n);
  const unsafe = [
    { guildId: null, content: 'csinventory', author: { id: USER } },
    { guildId: GUILD, content: 'csinventory', author: { id: USER, bot: true } },
    { guildId: GUILD, content: 'csinventory', author: { id: USER }, webhookId: 'hook' },
    { guildId: GUILD, content: 'csinventory', author: { id: USER }, system: true },
    { guildId: GUILD, content: 'csinventory extra', author: { id: USER } },
  ];
  for (const message of unsafe) assert.equal(await feature.handleMessage(message), false);

  let payload;
  assert.equal(await feature.handleMessage({
    guildId: GUILD, channelId: CHANNEL, content: ' CsInventory ', author: { id: USER },
    async reply(value) { payload = value; },
  }), true);
  assert.match(textContent(payload), /Work Token `×3`/);
  assert.equal(new InventoryRepository(db).list(USER)[0].quantity, 3n);

  let slashPayload;
  assert.equal(await feature.handleInteraction({
    isChatInputCommand: () => true, commandName: 'cs-inventory', guildId: GUILD, channelId: CHANNEL,
    user: { id: OTHER_USER }, async reply(value) { slashPayload = value; },
  }), true);
  assert.match(textContent(slashPayload), new RegExp(`<@${OTHER_USER}>'s Inventory`));
  assert.match(textContent(slashPayload), /Your inventory is empty/);
  db.close();
});

test('button and modal enforce ownership, validate pages, edit in place, and re-read inventory', async () => {
  const db = openDatabase({ databasePath: ':memory:' });
  const feature = createInventoryFeature({ db, isCommandAllowed: () => true });
  insertStack(db, 'work_token', 1n);
  for (let index = 0; index < 10; index += 1) insertStack(db, `item_${index}`, 1n);
  const before = feature.repository.list(USER);

  let deniedButton;
  let opened = false;
  await feature.handleInteraction({
    isChatInputCommand: () => false, isButton: () => true, isModalSubmit: () => false,
    customId: `csinventory:page:${USER}`, user: { id: OTHER_USER },
    async reply(payload) { deniedButton = payload; }, async showModal() { opened = true; },
  });
  assert.equal(opened, false);
  assert.ok(deniedButton.flags);
  assert.match(textContent(deniedButton), new RegExp(`This inventory menu belongs to <@${USER}>\\.`));

  let shownModal;
  await feature.handleInteraction({
    isChatInputCommand: () => false, isButton: () => true, isModalSubmit: () => false,
    customId: `csinventory:page:${USER}`, user: { id: USER },
    async showModal(modal) { shownModal = modal; },
  });
  assert.equal(shownModal.components[0].components[0].placeholder, '1 - 2');

  let deniedModal;
  await feature.handleInteraction(modalInteraction('2', {
    user: { id: OTHER_USER }, async reply(payload) { deniedModal = payload; },
  }));
  assert.match(textContent(deniedModal), new RegExp(`This inventory menu belongs to <@${USER}>\\.`));

  for (const invalid of ['', '0', '-1', '1.5', '1e1', 'hello', '3']) {
    let invalidPayload;
    let editCount = 0;
    await feature.handleInteraction(modalInteraction(invalid, {
      async reply(payload) { invalidPayload = payload; },
      async editReply() { editCount += 1; },
    }));
    assert.ok(invalidPayload.flags, invalid);
    assert.match(textContent(invalidPayload), /Enter a page number from 1 to 2\./, invalid);
    assert.equal(editCount, 0, invalid);
  }

  let deferred = 0;
  let edited;
  await feature.handleInteraction(modalInteraction(' 2 ', {
    async deferUpdate() { deferred += 1; this.deferred = true; },
    async editReply(payload) { edited = payload; },
  }));
  assert.equal(deferred, 1);
  assert.match(textContent(edited), /-# Page 2\/2 • 11 item stacks/);
  assert.equal(edited.flags, undefined);

  db.prepare("DELETE FROM inventory WHERE user_id=? AND item_key='item_9'").run(USER);
  let changedPayload;
  let changedEditCount = 0;
  await feature.handleInteraction(modalInteraction('2', {
    async reply(payload) { changedPayload = payload; },
    async editReply() { changedEditCount += 1; },
  }));
  assert.match(textContent(changedPayload), /Enter a page number from 1 to 1\./);
  assert.equal(changedEditCount, 0);

  const after = feature.repository.list(USER);
  assert.deepEqual(after, before.filter((stack) => stack.itemKey !== 'item_9'));
  db.close();
});

test('Work Token rewards remain in the shared persistent inventory table and quantities stay BigInt-safe', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-inventory-'));
  const databasePath = path.join(directory, 'games.sqlite');
  let db;
  try {
    db = openDatabase({ databasePath });
    const work = new WorkRepository(db, { clock: () => 1_000_000 });
    work.profile(USER);
    db.prepare('UPDATE work_profiles SET xp=90 WHERE user_id=?').run(USER);
    work.create({
      sessionId: 'inventory-reward', guildId: GUILD, channelId: CHANNEL, userId: USER,
      job: 'burger', difficulty: 'easy', normalizedDifficulty: 0, deadline: 2_000_000,
      state: { target: [], cursor: 0, buttons: [], message: '' }, baseSalary: 1, xpReward: 25,
    });
    assert.equal(work.settle('inventory-reward', 'succeeded').session.tokensAwarded, 1);
    insertStack(db, 'huge_stack', 9_007_199_254_740_993n);
    assert.equal(db.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type='table' AND name='inventory'").get().total, 1n);
    db.close(); db = null;

    db = openDatabase({ databasePath });
    const stacks = new InventoryRepository(db).list(USER);
    assert.equal(stacks.find((stack) => stack.itemKey === 'work_token').quantity, 1n);
    assert.equal(stacks.find((stack) => stack.itemKey === 'huge_stack').quantity, 9_007_199_254_740_993n);
  } finally {
    if (db?.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
