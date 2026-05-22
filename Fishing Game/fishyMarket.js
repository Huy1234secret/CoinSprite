const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');

const displayCommands = require('./fishingDisplayHotfix');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE_ACCENT = 0xffffff;
const BUTTON_SECONDARY = 2;
const BUTTON_SUCCESS = 3;
const BUTTON_DANGER = 4;
const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-game.json');
const SYMBOL_DIR = path.join(__dirname, 'Symbol');
const CHART_DIR = path.join(__dirname, 'Value Charts');
const FISH_COIN = '<:CRFishCoin:1506701069990891751>';
const FISH_EMOJI = '<:SBFish:1506659437165936690>';
const GOLDEN_FISH_EMOJI = '<:SBGoldenFish:1506659439502168245>';
const RAINBOW_FISH_EMOJI = '<:SBRainbowFish:1506660311380398211>';
const WOODEN_ROD_EMOJI = '<:IGWoodenFishingRod:1506709123646095430>';
const MARKET_UPDATE_MS = 30 * 60 * 1000;
const PAGE_SIZE = 5;

const RARITY_EMOJI = {
  common: '<:F1Bluegill:1506653228245455039>',
  uncommon: '<:F2BlackCrappie:1506653236512166019>',
  rare: '<:F3Walleye:1506653246255792198>',
  epic: '<:F4NorthernPike:1506653248147292290>',
  legendary: '<:F5LakeSturgeon:1506653250621935827>',
  mythical: '<:F6GoldenMahseer:1506653252530212975>',
  secret: '<:F7AsianArowana:1506653254677954700>',
};

function normalizeId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function stripFishTier(value) {
  return String(value || '').replace(/\bF[1-7]\s+(?=[A-Z])/g, '');
}

const FISH = [
  ['<:F1Bluegill:1506653228245455039>', 'F1 Bluegill', 'common', 0.1, 1.0, 8],
  ['<:F1CommonCarp:1506653230376030318>', 'F1 Common Carp', 'common', 1.0, 8.0, 12],
  ['<:F1FatheadMinnow:1506653232146022531>', 'F1 Fathead Minnow', 'common', 0.02, 0.15, 5],
  ['<:F1YellowPerch:1506653234419466290>', 'F1 Yellow Perch', 'common', 0.1, 1.5, 10],
  ['<:F2BlackCrappie:1506653236512166019>', 'F2 Black Crappie', 'uncommon', 0.2, 2.0, 22],
  ['<:F2ChannelCatfish:1506653238605254798>', 'F2 Channel Catfish', 'uncommon', 1.5, 12.0, 30],
  ['<:F2RainbowTrout:1506653240756801708>', 'F2 Rainbow Trout', 'uncommon', 0.5, 4.0, 35],
  ['<:F3LargemouthBass:1506653242506088478>', 'F3 Largemouth Bass', 'rare', 0.8, 6.0, 65],
  ['<:F3Walleye:1506653246255792198>', 'F3 Walleye', 'rare', 0.7, 5.5, 75],
  ['<:F4NorthernPike:1506653248147292290>', 'F4 Northern Pike', 'epic', 2.0, 15.0, 140],
  ['<:F5LakeSturgeon:1506653250621935827>', 'F5 Lake Sturgeon', 'legendary', 8.0, 60.0, 350],
  ['<:F6GoldenMahseer:1506653252530212975>', 'F6 Golden Mahseer', 'mythical', 3.0, 25.0, 850],
  ['<:F7AsianArowana:1506653254677954700>', 'F7 Asian Arowana', 'secret', 2.0, 10.0, 2500],
].map(([emoji, name, rarity, minWeight, maxWeight, value]) => ({
  id: normalizeId(name),
  emoji,
  name,
  displayName: stripFishTier(name),
  rarity,
  minWeight,
  maxWeight,
  value,
}));

const ITEMS = {
  wooden_fishing_rod: {
    id: 'wooden_fishing_rod',
    name: 'Wooden Fishing Rod',
    emoji: WOODEN_ROD_EMOJI,
    type: 'Gear/Tool',
    rarity: 'common',
    value: 0,
    unsellable: true,
  },
};

const FISH_BY_ID = new Map(FISH.map((fish) => [fish.id, fish]));
const VARIANT_MULTIPLIER = { Normal: 1, Golden: 2, Rainbow: 5 };
let marketTimerStarted = false;

function emptyState() {
  return { users: {}, weather: {}, forecasts: {}, market: { entries: {}, lastUpdateAt: 0 } };
}

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(emptyState(), null, 2), 'utf8');
}

function loadState() {
  ensureStoreFile();
  try {
    const state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return { ...emptyState(), ...(state && typeof state === 'object' ? state : {}) };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  ensureStoreFile();
  state.market = state.market && typeof state.market === 'object' ? state.market : { entries: {}, lastUpdateAt: 0 };
  state.market.entries = state.market.entries && typeof state.market.entries === 'object' ? state.market.entries : {};
  fs.writeFileSync(STORE_PATH, JSON.stringify({ ...emptyState(), ...state }, null, 2), 'utf8');
}

function ensureUser(state, userId) {
  if (!state.users[userId]) state.users[userId] = { fishCoins: 0, inventory: {}, fishBarrel: [], fishCapacity: 10 };
  const user = state.users[userId];
  user.inventory = user.inventory && typeof user.inventory === 'object' ? user.inventory : {};
  user.fishBarrel = Array.isArray(user.fishBarrel) ? user.fishBarrel : [];
  user.fishCoins = Math.max(0, Math.floor(Number(user.fishCoins) || 0));
  user.fishCapacity = Math.max(10, Math.floor(Number(user.fishCapacity) || 10));
  if (!user.inventory.wooden_fishing_rod) user.inventory.wooden_fishing_rod = { amount: 1, durability: null };
  return user;
}

function getItem(itemId) {
  return ITEMS[itemId] || null;
}

function getMarketKey(type, id) {
  return `${type}:${id}`;
}

function getBaseValue(type, id) {
  if (type === 'fish') return FISH_BY_ID.get(id)?.value || 1;
  return Math.max(1, getItem(id)?.value || 1);
}

function countExisting(state, type, id) {
  let total = 0;
  for (const user of Object.values(state.users || {})) {
    if (type === 'fish') total += (Array.isArray(user.fishBarrel) ? user.fishBarrel : []).filter((entry) => entry.fishId === id).length;
    else total += Math.max(0, Math.floor(Number(user.inventory?.[id]?.amount) || 0));
  }
  return total;
}

function ensureMarketEntry(state, type, id) {
  state.market = state.market && typeof state.market === 'object' ? state.market : { entries: {}, lastUpdateAt: 0 };
  state.market.entries = state.market.entries && typeof state.market.entries === 'object' ? state.market.entries : {};
  const key = getMarketKey(type, id);
  if (!state.market.entries[key]) {
    const baseValue = getBaseValue(type, id);
    state.market.entries[key] = {
      type,
      id,
      baseValue,
      currentValue: baseValue,
      history: [{ at: Date.now(), value: baseValue }],
      lastExistAmount: countExisting(state, type, id),
      chartPath: null,
    };
  }
  return state.market.entries[key];
}

function updateMarketEntry(state, type, id, soldAmount = 0, boughtAmount = 0) {
  const entry = ensureMarketEntry(state, type, id);
  const existAmount = countExisting(state, type, id);
  const existChange = existAmount - (Number(entry.lastExistAmount) || 0);
  let next = Number(entry.currentValue) || entry.baseValue;
  next -= next * (soldAmount * 0.003);
  next += next * (boughtAmount * 0.004);
  if (existChange > 0) next -= next * (existChange * 0.001);
  if (existChange < 0) next += next * (Math.abs(existChange) * 0.0015);
  next = Math.max(entry.baseValue * 0.35, next);
  next = Math.min(entry.baseValue * 3.0, next);
  entry.currentValue = Math.max(1, Math.round(next));
  entry.lastExistAmount = existAmount;
  entry.history = Array.isArray(entry.history) ? entry.history : [];
  entry.history.push({ at: Date.now(), value: entry.currentValue });
  entry.history = entry.history.slice(-36);
  return entry;
}

function getDisplayName(type, id) {
  if (type === 'fish') return FISH_BY_ID.get(id)?.displayName || id;
  return getItem(id)?.name || id;
}

function updateExistingMarkets(state) {
  for (const key of Object.keys(state.market?.entries || {})) {
    const entry = state.market.entries[key];
    if (!entry?.type || !entry?.id) continue;
    updateMarketEntry(state, entry.type, entry.id, 0, 0);
    if (entry.chartPath) renderChartImage(entry, getDisplayName(entry.type, entry.id));
  }
  state.market.lastUpdateAt = Date.now();
}

function msUntilNextMarketUpdate() {
  return MARKET_UPDATE_MS - (Date.now() % MARKET_UPDATE_MS);
}

function startMarketTimer() {
  if (marketTimerStarted) return;
  marketTimerStarted = true;
  setTimeout(function tick() {
    const state = loadState();
    updateExistingMarkets(state);
    saveState(state);
    setTimeout(tick, msUntilNextMarketUpdate()).unref?.();
  }, msUntilNextMarketUpdate()).unref?.();
}

function getMarketValue(state, type, id) {
  return ensureMarketEntry(state, type, id).currentValue;
}

function weightMultiplier(fish, entry) {
  const weight = Number(entry.weight) || fish.minWeight;
  if (fish.maxWeight <= fish.minWeight) return 1;
  const progress = Math.max(0, Math.min(1, (weight - fish.minWeight) / (fish.maxWeight - fish.minWeight)));
  return 1 + (progress * 0.5);
}

function mutationMultiplier(entry) {
  if (!entry.mutation || String(entry.mutation).toLowerCase() === 'none') return 1;
  return Number(entry.mutationMultiplier) || 1;
}

function fishTotalValue(state, entry, fish) {
  const marketValue = getMarketValue(state, 'fish', fish.id);
  const variant = VARIANT_MULTIPLIER[entry.variant] || 1;
  return Math.max(1, Math.round(marketValue * weightMultiplier(fish, entry) * variant * mutationMultiplier(entry)));
}

function rarityLabel(rarity) {
  return `${RARITY_EMOJI[rarity] || ''} ${rarity}`.trim();
}

function variantLabel(entry) {
  const emoji = entry.variantEmoji || (entry.variant === 'Golden' ? GOLDEN_FISH_EMOJI : entry.variant === 'Rainbow' ? RAINBOW_FISH_EMOJI : FISH_EMOJI);
  return `${entry.variant || 'Normal'} ${emoji}`;
}

function mutationLabel(entry) {
  return entry.mutation ? `${entry.mutation} ${entry.mutationEmoji || ''}`.trim() : 'None';
}

function pageItems(items, page) {
  const maxPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.max(1, Math.min(maxPage, Math.floor(Number(page) || 1)));
  return { page: safePage, maxPage, items: items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) };
}

function actionRow(components) {
  return { type: 1, components };
}

function separator() {
  return { type: 14, divider: true, spacing: 1 };
}

function button(customId, label, style = BUTTON_SECONDARY, disabled = false) {
  return { type: 2, custom_id: customId, label, style, disabled };
}

function categorySelect(userId, selected = null) {
  const labels = { fish: 'Sell-fish', item: 'Sell-item', chart: 'Value-Chart' };
  return actionRow([{ type: 3, custom_id: `fm:category:${userId}`, placeholder: 'Select a category', min_values: 1, max_values: 1, options: Object.entries(labels).map(([value, label]) => ({ label, value, default: selected === value })) }]);
}

function symbolAttachment(fileName, files) {
  const imagePath = path.join(SYMBOL_DIR, fileName);
  if (!fs.existsSync(imagePath)) return null;
  files.push(new AttachmentBuilder(imagePath, { name: fileName }));
  return fileName;
}

function withThumbnail(components, fileName) {
  if (!fileName || !components[0] || components[0].type !== 10) return components;
  const [first, ...rest] = components;
  return [{ type: 9, components: [first], accessory: { type: 11, media: { url: `attachment://${fileName}` } } }, ...rest];
}

function containerPayload(accent, components, files = []) {
  return { flags: COMPONENTS_V2_FLAG, files, components: [{ type: 17, accent_color: accent, components: components.filter(Boolean) }] };
}

function renderMarketHome(userId) {
  const files = [];
  const thumb = symbolAttachment('SBFishSellMarket.png', files);
  return containerPayload(WHITE_ACCENT, withThumbnail([{ type: 10, content: '## Welcome to Fishy Market!\n* Select a category' }, separator(), categorySelect(userId)], thumb), files);
}

function userFishRecords(state, userId) {
  const user = ensureUser(state, userId);
  return user.fishBarrel.map((entry, index) => ({ entry, fish: FISH_BY_ID.get(entry.fishId), index })).filter((record) => record.fish);
}

function userItemRecords(state, userId) {
  const user = ensureUser(state, userId);
  return Object.entries(user.inventory).map(([id, entry]) => ({ item: getItem(id), id, entry })).filter((record) => record.item && Number(record.entry.amount) > 0);
}

function renderFishLine(state, record) {
  const totalValue = fishTotalValue(state, record.entry, record.fish);
  const marketValue = getMarketValue(state, 'fish', record.fish.id);
  return `**${record.fish.displayName} ${record.fish.emoji} - ${Number(record.entry.weight || 0).toFixed(2)} kg**\n-# Rarity: ${rarityLabel(record.fish.rarity)} - Value: ${marketValue} // **${totalValue} ${FISH_COIN}**\n-# Variant/Mutation: ${variantLabel(record.entry)} / ${mutationLabel(record.entry)}`;
}

function renderItemLine(state, record) {
  const value = getMarketValue(state, 'item', record.id);
  return `**\u00d7${record.entry.amount} ${record.item.name} ${record.item.emoji} - ${record.item.type}**\n-# Rarity: ${rarityLabel(record.item.rarity)} - Value: ${value} ${FISH_COIN}`;
}

function renderFishMarket(userId, page = 1, actionMessage = '-# **Anything you sold will appear here**') {
  const state = loadState();
  const files = [];
  const thumb = symbolAttachment('SBFishSellMarket.png', files);
  const paged = pageItems(userFishRecords(state, userId), page);
  const rows = [{ type: 10, content: '## Welcome to Fish Selling Market!' }];
  for (const record of paged.items) {
    const locked = Boolean(record.entry.locked);
    rows.push({ type: 9, components: [{ type: 10, content: renderFishLine(state, record) }], accessory: button(`fm:sellfish:${userId}:${record.entry.id || record.index}:${paged.page}`, locked ? 'Locked' : 'Sell', BUTTON_SECONDARY, locked) });
  }
  if (!paged.items.length) rows.push({ type: 10, content: '-# No fish found.' });
  rows.push(separator(), { type: 10, content: actionMessage }, actionRow([button(`fm:fishpage:${userId}:${paged.page + 1}`, 'Switch page', BUTTON_DANGER, paged.maxPage <= 1), button(`fm:sellfilter:${userId}`, 'Sell filter', BUTTON_SECONDARY, paged.items.length === 0)]), categorySelect(userId, 'fish'));
  return containerPayload(WHITE_ACCENT, withThumbnail(rows, thumb), files);
}

function renderItemMarket(userId, page = 1, actionMessage = '-# **Anything you sold will appear here**') {
  const state = loadState();
  const files = [];
  const thumb = symbolAttachment('SBItemSellMarket.png', files);
  const paged = pageItems(userItemRecords(state, userId), page);
  const rows = [{ type: 10, content: '## Welcome to Item Selling Market!' }];
  for (const record of paged.items) {
    const locked = Boolean(record.entry.locked);
    const unsellable = Boolean(record.item.unsellable);
    const label = locked ? 'Locked' : unsellable ? 'Unsellable' : 'Sell';
    rows.push({ type: 9, components: [{ type: 10, content: renderItemLine(state, record) }], accessory: button(`fm:sellitem:${userId}:${record.id}:${paged.page}`, label, unsellable || locked ? BUTTON_SECONDARY : BUTTON_DANGER, unsellable || locked) });
  }
  if (!paged.items.length) rows.push({ type: 10, content: '-# No items found.' });
  rows.push(separator(), { type: 10, content: actionMessage }, actionRow([button(`fm:itempage:${userId}:${paged.page + 1}`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)]), categorySelect(userId, 'item'));
  return containerPayload(WHITE_ACCENT, withThumbnail(rows, thumb), files);
}

function getChartRecords(state, userId, type) {
  if (type === 'fish') {
    const seen = new Set();
    return userFishRecords(state, userId).filter((record) => {
      if (seen.has(record.fish.id)) return false;
      seen.add(record.fish.id);
      return true;
    }).map((record) => ({ id: record.fish.id, name: record.fish.displayName, emoji: record.fish.emoji }));
  }
  return userItemRecords(state, userId).map((record) => ({ id: record.id, name: record.item.name, emoji: record.item.emoji }));
}

function chartPathFor(type, id) {
  return path.join(CHART_DIR, `${type}-${normalizeId(id)}.png`);
}

function roundedRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderChartImage(entry, itemName) {
  if (!fs.existsSync(CHART_DIR)) fs.mkdirSync(CHART_DIR, { recursive: true });
  const canvas = createCanvas(900, 500);
  const ctx = canvas.getContext('2d');
  const values = (entry.history?.length ? entry.history : [{ value: entry.baseValue }]).map((point) => Number(point.value) || entry.baseValue);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const x0 = 90;
  const y0 = 350;
  const w = 760;
  const h = 220;
  ctx.fillStyle = '#10141f';
  ctx.fillRect(0, 0, 900, 500);
  roundedRect(ctx, 24, 24, 852, 452, 24, '#161c2a', '#2d3a55');
  ctx.fillStyle = '#f4f7fb';
  ctx.font = '700 30px Arial';
  ctx.fillText(entry.type === 'fish' ? 'Fish Value Chart' : 'Item Value Chart', 52, 70);
  ctx.font = '600 20px Arial';
  ctx.fillStyle = '#9fd4ff';
  ctx.fillText(itemName, 52, 102);
  ctx.fillStyle = '#f4f7fb';
  ctx.fillText(`Current: ${entry.currentValue} coins`, 620, 70);
  ctx.strokeStyle = '#3b4966';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - h);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + w, y0);
  ctx.stroke();
  ctx.fillStyle = '#93a4bf';
  ctx.font = '14px Arial';
  ctx.fillText('Coins', 42, 220);
  ctx.fillText('Market Updates', 390, 390);
  const minY = Math.max(1, low * 0.9);
  const maxY = Math.max(minY + 1, high * 1.1);
  const points = values.map((value, index) => ({
    x: x0 + ((values.length === 1 ? 0.5 : index / (values.length - 1)) * w),
    y: y0 - (((value - minY) / (maxY - minY)) * h),
  }));
  ctx.strokeStyle = '#52f2c2';
  ctx.lineWidth = 4;
  ctx.beginPath();
  points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
  ctx.stroke();
  ctx.fillStyle = '#52f2c2';
  points.forEach((point) => { ctx.beginPath(); ctx.arc(point.x, point.y, 5, 0, Math.PI * 2); ctx.fill(); });
  ctx.font = '700 16px Arial';
  ctx.fillText('Value', x0 + w - 60, Math.max(y0 - h + 20, points[points.length - 1].y - 12));
  ctx.fillStyle = '#d6dfef';
  ctx.font = '16px Arial';
  ctx.fillText(`Base: ${entry.baseValue} coins`, 52, 430);
  ctx.fillText(`High: ${high} coins`, 270, 430);
  ctx.fillText(`Low: ${low} coins`, 470, 430);
  ctx.fillStyle = '#7f8faa';
  ctx.fillText('Value changes based on supply and demand', 52, 458);
  const chartPath = chartPathFor(entry.type, entry.id);
  fs.writeFileSync(chartPath, canvas.toBuffer('image/png'));
  entry.chartPath = chartPath;
  return chartPath;
}

function renderValueChart(userId, type = 'fish', page = 1, selectedId = null) {
  const state = loadState();
  const files = [];
  const thumb = symbolAttachment('SBValueChart.png', files);
  const paged = pageItems(getChartRecords(state, userId, type), page);
  const rows = [{ type: 10, content: '## Welcome to Value Chart!' }];
  for (const record of paged.items) {
    rows.push({ type: 9, components: [{ type: 10, content: `**${record.name} ${record.emoji}**` }], accessory: button(`fm:chartcheck:${userId}:${type}:${record.id}:${paged.page}`, 'Check', BUTTON_SUCCESS) });
  }
  if (!paged.items.length) rows.push({ type: 10, content: '-# No entries found.' });
  rows.push(separator());
  if (selectedId) {
    const entry = ensureMarketEntry(state, type, selectedId);
    const chartPath = renderChartImage(entry, getDisplayName(type, selectedId));
    saveState(state);
    files.push(new AttachmentBuilder(chartPath, { name: 'value-chart.png' }));
    rows.push({ type: 12, items: [{ media: { url: 'attachment://value-chart.png' } }] });
  } else {
    rows.push({ type: 10, content: '-# Select something to check its value' });
  }
  rows.push(separator(), actionRow([button(`fm:chartpage:${userId}:${type}:${paged.page + 1}`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1), button(`fm:charttoggle:${userId}:${type}`, `[Value: ${type.toUpperCase()}]`, BUTTON_SECONDARY)]), categorySelect(userId, 'chart'));
  return containerPayload(WHITE_ACCENT, withThumbnail(rows, thumb), files);
}

function lockButton(customId, locked) {
  return button(customId, locked ? '\uD83D\uDD12' : '\uD83D\uDD13', locked ? BUTTON_SUCCESS : BUTTON_SECONDARY);
}

function renderInventory(userId, username, page = 1) {
  const state = loadState();
  ensureUser(state, userId);
  const paged = pageItems(userItemRecords(state, userId), page);
  const rows = [{ type: 10, content: `## ${username}'s inventory` }];
  for (const record of paged.items) {
    rows.push({ type: 9, components: [{ type: 10, content: renderItemLine(state, record) }], accessory: lockButton(`fm:lockitem:${userId}:${record.id}:${paged.page}`, Boolean(record.entry.locked)) });
  }
  if (!paged.items.length) rows.push({ type: 10, content: '-# No items found.' });
  rows.push(separator(), actionRow([button(`fm:invpage:${userId}:${paged.page + 1}`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)]));
  saveState(state);
  return containerPayload(WHITE_ACCENT, rows);
}

function renderFishBarrel(userId, username, page = 1) {
  const state = loadState();
  const user = ensureUser(state, userId);
  const paged = pageItems(userFishRecords(state, userId), page);
  const rows = [{ type: 10, content: `## ${username}'s inventory\n-# Capacity: ${user.fishBarrel.length} / ${user.fishCapacity}` }];
  for (const record of paged.items) {
    rows.push({ type: 9, components: [{ type: 10, content: renderFishLine(state, record) }], accessory: lockButton(`fm:lockfish:${userId}:${record.entry.id || record.index}:${paged.page}`, Boolean(record.entry.locked)) });
  }
  if (!paged.items.length) rows.push({ type: 10, content: '-# No fish found.' });
  rows.push(separator(), actionRow([button(`fm:barrelpage:${userId}:${paged.page + 1}`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)]));
  saveState(state);
  return containerPayload(WHITE_ACCENT, rows);
}

function findFishIndex(user, fishKey) {
  return user.fishBarrel.findIndex((entry, index) => String(entry.id || index) === String(fishKey));
}

function soldFishMessage(fish, entry, value) {
  return `-# **You've sold ${fish.displayName} ${fish.emoji} - ${fish.rarity} - ${Number(entry.weight || 0).toFixed(2)} kg - ${value} ${FISH_COIN}**`;
}

function soldItemMessage(item, amount, value) {
  return `-# **You've sold \u00d7${amount} ${item.name} ${item.emoji} - ${item.rarity} - ${value} ${FISH_COIN}**`;
}

function sellFish(userId, fishKey) {
  const state = loadState();
  const user = ensureUser(state, userId);
  const index = findFishIndex(user, fishKey);
  if (index < 0) return { payload: renderFishMarket(userId), message: '-# **Fish not found**' };
  const entry = user.fishBarrel[index];
  const fish = FISH_BY_ID.get(entry.fishId);
  if (!fish || entry.locked) return { payload: renderFishMarket(userId), message: '-# **That fish is locked**' };
  const total = fishTotalValue(state, entry, fish);
  user.fishBarrel.splice(index, 1);
  user.fishCoins += total;
  updateMarketEntry(state, 'fish', fish.id, 1, 0);
  saveState(state);
  return { payload: renderFishMarket(userId, 1, soldFishMessage(fish, entry, total)) };
}

function sellItem(userId, itemId) {
  const state = loadState();
  const user = ensureUser(state, userId);
  const item = getItem(itemId);
  const entry = user.inventory[itemId];
  if (!item || !entry || Number(entry.amount) <= 0) return { payload: renderItemMarket(userId), message: '-# **Item not found**' };
  if (item.unsellable || entry.locked) return { payload: renderItemMarket(userId), message: '-# **That item cannot be sold**' };
  const amount = Math.floor(Number(entry.amount) || 0);
  const value = Math.max(1, Math.round(getMarketValue(state, 'item', itemId) * amount));
  delete user.inventory[itemId];
  user.fishCoins += value;
  updateMarketEntry(state, 'item', itemId, amount, 0);
  saveState(state);
  return { payload: renderItemMarket(userId, 1, soldItemMessage(item, amount, value)) };
}

function sellFishByRarity(userId, rarities) {
  const wanted = new Set(rarities.map((rarity) => rarity.toLowerCase()));
  const state = loadState();
  const user = ensureUser(state, userId);
  let totalValue = 0;
  let sold = 0;
  user.fishBarrel = user.fishBarrel.filter((entry) => {
    const fish = FISH_BY_ID.get(entry.fishId);
    if (!fish || entry.locked || !wanted.has(fish.rarity.toLowerCase())) return true;
    totalValue += fishTotalValue(state, entry, fish);
    sold += 1;
    updateMarketEntry(state, 'fish', fish.id, 1, 0);
    return false;
  });
  user.fishCoins += totalValue;
  saveState(state);
  const message = sold ? `-# **You've sold ${sold} fish - ${totalValue} ${FISH_COIN}**` : '-# **No unlocked fish matched that rarity**';
  return renderFishMarket(userId, 1, message);
}

function filterModal(userId) {
  return {
    custom_id: `fm:sellfiltersubmit:${userId}`,
    title: 'Sell fish filter',
    components: [{ type: 1, components: [{ type: 4, custom_id: 'rarities', label: 'Select rarity to sell', style: 1, required: true, placeholder: 'common, uncommon, rare, epic, legendary, mythical, secret', max_length: 120 }] }],
  };
}

function parseList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function isOwner(interaction, userId) {
  if (interaction.user.id === userId) return true;
  interaction.reply({ content: 'Only the command owner can use this control.', flags: EPHEMERAL_FLAG }).catch(() => null);
  return false;
}

async function updateInteraction(interaction, payload) {
  if (typeof interaction.update === 'function') return interaction.update(payload);
  if (typeof interaction.deferUpdate === 'function') {
    await interaction.deferUpdate();
    return interaction.message?.edit(payload);
  }
  return interaction.reply(payload);
}

async function handleMarketInteraction(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('fm:')) return false;
  const parts = id.split(':');
  const action = parts[1];
  const userId = parts[2];
  if (!isOwner(interaction, userId)) return true;
  if (action === 'category') {
    const value = interaction.values?.[0];
    if (value === 'fish') await interaction.update(renderFishMarket(userId));
    else if (value === 'item') await interaction.update(renderItemMarket(userId));
    else await interaction.update(renderValueChart(userId, 'fish'));
    return true;
  }
  if (action === 'fishpage') return updateInteraction(interaction, renderFishMarket(userId, parts[3]));
  if (action === 'itempage') return updateInteraction(interaction, renderItemMarket(userId, parts[3]));
  if (action === 'invpage') return updateInteraction(interaction, renderInventory(userId, interaction.user.username, parts[3]));
  if (action === 'barrelpage') return updateInteraction(interaction, renderFishBarrel(userId, interaction.user.username, parts[3]));
  if (action === 'sellfish') return updateInteraction(interaction, sellFish(userId, parts[3]).payload);
  if (action === 'sellitem') return updateInteraction(interaction, sellItem(userId, parts[3]).payload);
  if (action === 'sellfilter') { await interaction.showModal(filterModal(userId)); return true; }
  if (action === 'sellfiltersubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, sellFishByRarity(userId, parseList(interaction.fields?.getTextInputValue('rarities'))));
  if (action === 'lockitem') {
    const state = loadState();
    const entry = ensureUser(state, userId).inventory[parts[3]];
    if (entry) entry.locked = !entry.locked;
    saveState(state);
    return updateInteraction(interaction, renderInventory(userId, interaction.user.username, parts[4]));
  }
  if (action === 'lockfish') {
    const state = loadState();
    const user = ensureUser(state, userId);
    const index = findFishIndex(user, parts[3]);
    if (index >= 0) user.fishBarrel[index].locked = !user.fishBarrel[index].locked;
    saveState(state);
    return updateInteraction(interaction, renderFishBarrel(userId, interaction.user.username, parts[4]));
  }
  if (action === 'chartpage') return updateInteraction(interaction, renderValueChart(userId, parts[3], parts[4]));
  if (action === 'charttoggle') return updateInteraction(interaction, renderValueChart(userId, parts[3] === 'fish' ? 'item' : 'fish'));
  if (action === 'chartcheck') return updateInteraction(interaction, renderValueChart(userId, parts[3], parts[5], parts[4]));
  return false;
}

const fishyMarketCommand = {
  data: new SlashCommandBuilder().setName('fishy-market').setDescription('Open the Fishy Market'),
  suppressCommandLog: true,
  init: startMarketTimer,
  async execute(interaction) {
    await interaction.reply(renderMarketHome(interaction.user.id));
  },
  async handleInteraction(interaction) {
    return handleMarketInteraction(interaction);
  },
};

const inventoryCommand = {
  ...displayCommands.inventoryCommand,
  disableActionTimeout: false,
  async execute(interaction) {
    await interaction.reply(renderInventory(interaction.user.id, interaction.user.username));
  },
  async handleInteraction(interaction, client) {
    const handled = await handleMarketInteraction(interaction);
    if (handled) return true;
    return displayCommands.inventoryCommand.handleInteraction(interaction, client);
  },
};

const fishBarrelCommand = {
  ...displayCommands.fishBarrelCommand,
  disableActionTimeout: false,
  async execute(interaction) {
    await interaction.reply(renderFishBarrel(interaction.user.id, interaction.user.username));
  },
  async handleInteraction(interaction, client) {
    const handled = await handleMarketInteraction(interaction);
    if (handled) return true;
    return displayCommands.fishBarrelCommand.handleInteraction(interaction, client);
  },
};

module.exports = {
  fishyMarketCommand,
  inventoryCommand,
  fishBarrelCommand,
};
