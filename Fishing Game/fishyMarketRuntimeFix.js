const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const CHECKBOX_GROUP_COMPONENT_TYPE = 22;
const BUTTON_SECONDARY = 2;
const WHITE_ACCENT = 0xffffff;
const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-game.json');
const FISH_COIN = '<:CRFishCoin:1506701069990891751>';
const MARKET_UPDATE_MS = 30 * 60 * 1000;
const MARKET_TIMEZONE_OFFSET_MS = 7 * 60 * 60 * 1000;

const MARKET_RULES = {
  minMultiplier: 0.35,
  maxMultiplier: 3.0,
  fishCaughtSupplyDownRate: 0.01,
  itemObtainedSupplyDownRate: 0.008,
  soldDownRate: 0.015,
  boughtDemandUpRate: 0.012,
  unchangedRecoveryRate: 0.02,
};

const FILTER_RARITIES = [
  ['all', 'All'],
  ['secret', 'Secret'],
  ['mythical', 'Mythical'],
  ['legendary', 'Legendary'],
  ['epic', 'Epic'],
  ['rare', 'Rare'],
  ['uncommon', 'Uncommon'],
  ['common', 'Common'],
];

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
].map(([emoji, name, rarity, minWeight, maxWeight, value]) => ({ id: normalizeId(name), emoji, name, displayName: stripFishTier(name), rarity, minWeight, maxWeight, value }));

const ITEMS = {
  wooden_fishing_rod: { id: 'wooden_fishing_rod', name: 'Wooden Fishing Rod', value: 0, unsellable: true },
  bamboo_fishing_rod: { id: 'bamboo_fishing_rod', name: 'Bamboo Fishing Rod', value: 350 },
  steel_fishing_rod: { id: 'steel_fishing_rod', name: 'Steel Fishing Rod', value: 1250 },
  carbon_fishing_rod: { id: 'carbon_fishing_rod', name: 'Carbon Fishing Rod', value: 5000 },
};

const FISH_BY_ID = new Map(FISH.map((fish) => [fish.id, fish]));
const VARIANT_MULTIPLIER = { Normal: 1, Golden: 2, Rainbow: 5 };
let marketValueTimerStarted = false;

function normalizeId(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function stripFishTier(value) { return String(value || '').replace(/\bF[1-7]\s+(?=[A-Z])/g, ''); }
function emptyState() { return { users: {}, weather: {}, forecasts: {}, market: { entries: {}, lastUpdateAt: 0 } }; }
function ensureStoreFile() { const dir = path.dirname(STORE_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(emptyState(), null, 2), 'utf8'); }
function loadState() { ensureStoreFile(); try { const state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); return { ...emptyState(), ...(state && typeof state === 'object' ? state : {}) }; } catch { return emptyState(); } }
function saveState(state) { ensureStoreFile(); state.market = state.market && typeof state.market === 'object' ? state.market : { entries: {}, lastUpdateAt: 0 }; state.market.entries = state.market.entries && typeof state.market.entries === 'object' ? state.market.entries : {}; fs.writeFileSync(STORE_PATH, JSON.stringify({ ...emptyState(), ...state }, null, 2), 'utf8'); }
function ensureUser(state, userId) { if (!state.users[userId]) state.users[userId] = { fishCoins: 0, inventory: {}, fishBarrel: [], fishCapacity: 10 }; const user = state.users[userId]; user.inventory = user.inventory && typeof user.inventory === 'object' ? user.inventory : {}; user.fishBarrel = Array.isArray(user.fishBarrel) ? user.fishBarrel : []; user.fishCoins = Math.max(0, Math.floor(Number(user.fishCoins) || 0)); user.fishCapacity = Math.max(10, Math.floor(Number(user.fishCapacity) || 10)); if (!user.inventory.wooden_fishing_rod) user.inventory.wooden_fishing_rod = { amount: 1, durability: null }; return user; }
function getMarketKey(type, id) { return `${type}:${id}`; }
function getBaseValue(type, id) { if (type === 'fish') return Math.max(1, FISH_BY_ID.get(id)?.value || 1); return Math.max(1, ITEMS[id]?.value || 1); }
function countExisting(state, type, id) { let total = 0; for (const user of Object.values(state.users || {})) { if (type === 'fish') total += (Array.isArray(user.fishBarrel) ? user.fishBarrel : []).filter((entry) => entry.fishId === id).length; else total += Math.max(0, Math.floor(Number(user.inventory?.[id]?.amount) || 0)); } return total; }
function ensureMarketRoot(state) { state.market = state.market && typeof state.market === 'object' ? state.market : { entries: {}, lastUpdateAt: 0 }; state.market.entries = state.market.entries && typeof state.market.entries === 'object' ? state.market.entries : {}; return state.market; }
function marketUpdateSlotAt(at = Date.now()) { return (Math.floor((at + MARKET_TIMEZONE_OFFSET_MS) / MARKET_UPDATE_MS) * MARKET_UPDATE_MS) - MARKET_TIMEZONE_OFFSET_MS; }
function msUntilNextMarketUpdate() { const now = Date.now(); const nextSlot = marketUpdateSlotAt(now) + MARKET_UPDATE_MS; return Math.max(1000, nextSlot - now); }

function ensureMarketEntry(state, type, id) {
  const market = ensureMarketRoot(state);
  const key = getMarketKey(type, id);
  if (!market.entries[key]) {
    const baseValue = getBaseValue(type, id);
    const existing = countExisting(state, type, id);
    market.entries[key] = { type, id, baseValue, currentValue: baseValue, history: [{ at: Date.now(), value: baseValue }], lastExistAmount: existing, lastObservedAmount: existing, lastMarketRuleUpdateAt: marketUpdateSlotAt(Date.now()), chartPath: null };
  }
  const entry = market.entries[key];
  entry.type = entry.type || type;
  entry.id = entry.id || id;
  entry.baseValue = Math.max(1, Number(entry.baseValue) || getBaseValue(type, id));
  entry.currentValue = Math.max(1, Number(entry.currentValue) || entry.baseValue);
  entry.history = Array.isArray(entry.history) ? entry.history : [{ at: Date.now(), value: entry.currentValue }];
  if (!Number.isFinite(Number(entry.lastObservedAmount))) entry.lastObservedAmount = Number.isFinite(Number(entry.lastExistAmount)) ? Number(entry.lastExistAmount) : countExisting(state, type, id);
  if (!Number.isFinite(Number(entry.lastMarketRuleUpdateAt))) entry.lastMarketRuleUpdateAt = marketUpdateSlotAt(Date.now());
  return entry;
}

function clampMarketValue(entry, value) { const min = entry.baseValue * MARKET_RULES.minMultiplier; const max = entry.baseValue * MARKET_RULES.maxMultiplier; return Math.max(1, Math.round(Math.max(min, Math.min(max, value)))); }
function pushMarketHistory(entry, at = Date.now()) { entry.history = Array.isArray(entry.history) ? entry.history : []; const last = entry.history[entry.history.length - 1]; const value = Math.max(1, Math.round(Number(entry.currentValue) || entry.baseValue)); if (last && Math.abs((Number(last.at) || 0) - at) < 1000) last.value = value; else entry.history.push({ at, value }); entry.history = entry.history.slice(-36); }
function recoverTowardBase(current, base) { if (current === base) return current; return current + ((base - current) * MARKET_RULES.unchangedRecoveryRate); }

function applyMarketRules(state, type, id, options = {}) {
  const entry = ensureMarketEntry(state, type, id);
  const at = Number(options.at) || Date.now();
  const currentAmount = countExisting(state, type, id);
  const previousAmount = Number.isFinite(Number(options.previousAmount)) ? Number(options.previousAmount) : Number(entry.lastObservedAmount);
  const amountChange = Number.isFinite(Number(options.amountChange)) ? Number(options.amountChange) : currentAmount - previousAmount;
  const soldAmount = Math.max(0, Math.floor(Number(options.soldAmount) || 0));
  const boughtAmount = Math.max(0, Math.floor(Number(options.boughtAmount) || 0));
  const forceUpdate = Boolean(options.forceUpdate);
  const elapsed = at - (Number(entry.lastMarketRuleUpdateAt) || 0);
  const shouldRecover = forceUpdate || elapsed >= MARKET_UPDATE_MS;
  let next = Number(entry.currentValue) || entry.baseValue;
  let changed = false;

  if (amountChange > 0) {
    const supplyRate = type === 'fish' ? MARKET_RULES.fishCaughtSupplyDownRate : MARKET_RULES.itemObtainedSupplyDownRate;
    next -= next * Math.min(0.8, amountChange * supplyRate);
    changed = true;
  } else if (amountChange < 0 && soldAmount <= 0) {
    next += next * Math.min(0.5, Math.abs(amountChange) * 0.006);
    changed = true;
  }
  if (soldAmount > 0) { next -= next * Math.min(0.85, soldAmount * MARKET_RULES.soldDownRate); changed = true; }
  if (boughtAmount > 0) { next += next * Math.min(0.75, boughtAmount * MARKET_RULES.boughtDemandUpRate); changed = true; }
  if (!changed && shouldRecover) { next = recoverTowardBase(next, entry.baseValue); changed = Math.round(next) !== Math.round(entry.currentValue); }

  entry.currentValue = clampMarketValue(entry, next);
  entry.lastExistAmount = currentAmount;
  entry.lastObservedAmount = currentAmount;
  if (changed || forceUpdate) pushMarketHistory(entry, at);
  if (changed || shouldRecover) entry.lastMarketRuleUpdateAt = at;
  return entry;
}

function seedKnownMarketEntries(state) { for (const fish of FISH) ensureMarketEntry(state, 'fish', fish.id); for (const itemId of Object.keys(ITEMS)) ensureMarketEntry(state, 'item', itemId); }
function syncMarketValues(forceUpdate = false, at = Date.now()) { const state = loadState(); seedKnownMarketEntries(state); for (const key of Object.keys(state.market?.entries || {})) { const entry = state.market.entries[key]; if (!entry?.type || !entry?.id) continue; applyMarketRules(state, entry.type, entry.id, { at, forceUpdate }); } state.market.lastUpdateAt = at; saveState(state); }
function startMarketValueTimer() { if (marketValueTimerStarted) return; marketValueTimerStarted = true; syncMarketValues(false); setTimeout(function tick() { syncMarketValues(true, marketUpdateSlotAt(Date.now())); setTimeout(tick, msUntilNextMarketUpdate()).unref?.(); }, msUntilNextMarketUpdate()).unref?.(); }

function snapshotUserAmounts(userId) { const state = loadState(); const user = ensureUser(state, userId); const fish = {}; for (const entry of user.fishBarrel) { if (entry?.fishId) fish[entry.fishId] = (fish[entry.fishId] || 0) + 1; } const items = {}; for (const [itemId, entry] of Object.entries(user.inventory || {})) items[itemId] = Math.max(0, Math.floor(Number(entry?.amount) || 0)); return { fish, items }; }
function diffSoldAmounts(before, after, bucket) { const sold = {}; const keys = new Set([...Object.keys(before?.[bucket] || {}), ...Object.keys(after?.[bucket] || {})]); for (const key of keys) { const diff = Math.max(0, Math.floor(Number(before?.[bucket]?.[key] || 0) - Number(after?.[bucket]?.[key] || 0))); if (diff > 0) sold[key] = diff; } return sold; }
function applyDetectedSales(before, after) { const state = loadState(); const at = Date.now(); for (const [fishId, amount] of Object.entries(diffSoldAmounts(before, after, 'fish'))) applyMarketRules(state, 'fish', fishId, { soldAmount: amount, at }); for (const [itemId, amount] of Object.entries(diffSoldAmounts(before, after, 'items'))) applyMarketRules(state, 'item', itemId, { soldAmount: amount, at }); saveState(state); }

function updateMarketEntry(state, type, id, soldAmount = 0, boughtAmount = 0) { return applyMarketRules(state, type, id, { soldAmount, boughtAmount, at: Date.now() }); }
function weightMultiplier(fish, entry) { const weight = Number(entry.weight) || fish.minWeight; if (fish.maxWeight <= fish.minWeight) return 1; const progress = Math.max(0, Math.min(1, (weight - fish.minWeight) / (fish.maxWeight - fish.minWeight))); return 1 + (progress * 0.5); }
function mutationMultiplier(entry) { if (!entry.mutation || String(entry.mutation).toLowerCase() === 'none') return 1; return Number(entry.mutationMultiplier) || 1; }
function fishTotalValue(state, entry, fish) { const marketValue = ensureMarketEntry(state, 'fish', fish.id).currentValue; const variant = VARIANT_MULTIPLIER[entry.variant] || 1; return Math.max(1, Math.round(marketValue * weightMultiplier(fish, entry) * variant * mutationMultiplier(entry))); }
function rarityOptions() { return FILTER_RARITIES.map(([value, label]) => ({ label, value })); }

const original = require('./fishyMarket');

function checkboxFilterForm(kind, userId) {
  const isFish = kind === 'fish';
  return { custom_id: isFish ? `fm:sellfiltersubmit:${userId}` : `fm:itemfiltersubmit:${userId}`, title: isFish ? 'Sell fish filter' : 'Sell item filter', components: [{ type: 18, label: isFish ? 'Select fish rarity to sell' : 'Select item rarity to sell', component: { type: CHECKBOX_GROUP_COMPONENT_TYPE, custom_id: `${kind}_rarities`, min_values: 1, max_values: FILTER_RARITIES.length, required: true, options: rarityOptions() } }] };
}

function getSelectedValues(interaction, customId) {
  const found = [];
  const addValues = (values) => { if (!Array.isArray(values)) return; for (const value of values) { const normalized = String(value || '').trim(); if (normalized) found.push(normalized); } };
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    const matches = value.customId === customId || value.custom_id === customId;
    if (matches) { addValues(value.values); addValues(value.selected_values); addValues(value.data?.values); addValues(value.data?.selected_values); if (typeof value.value === 'string') found.push(value.value); if (typeof value.selected_value === 'string') found.push(value.selected_value); }
    if (value.component) visit(value.component);
    if (Array.isArray(value.components)) value.components.forEach(visit);
    if (Array.isArray(value.data?.components)) value.data.components.forEach(visit);
    if (value.fields && typeof value.fields.values === 'function') Array.from(value.fields.values()).forEach(visit);
    if (value.fields?.fields && typeof value.fields.fields.values === 'function') Array.from(value.fields.fields.values()).forEach(visit);
  };
  addValues(interaction.values);
  try { visit(interaction.fields?.getField?.(customId)); } catch {}
  try { visit(interaction.toJSON?.()); } catch {}
  visit(interaction);
  return [...new Set(found.map((item) => String(item || '').trim()).filter(Boolean))];
}

function isOwner(interaction, userId) { if (interaction.user.id === userId) return true; interaction.reply({ content: 'Only the command owner can use this control.', flags: EPHEMERAL_FLAG }).catch(() => null); return false; }
async function updateInteraction(interaction, payload) { if (typeof interaction.update === 'function') return interaction.update(payload); if (typeof interaction.deferUpdate === 'function') { await interaction.deferUpdate(); return interaction.message?.edit(payload); } return interaction.reply(payload); }
function categorySelect(userId, selected = 'fish') { const labels = { fish: 'Sell-fish', item: 'Sell-item', chart: 'Value-Chart' }; return { type: 1, components: [{ type: 3, custom_id: `fm:category:${userId}`, placeholder: 'Select a category', min_values: 1, max_values: 1, options: Object.entries(labels).map(([value, label]) => ({ label, value, default: selected === value })) }] }; }
function resultPayload(userId, message) { return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE_ACCENT, components: [{ type: 10, content: '## Welcome to Fish Selling Market!' }, { type: 14, divider: true, spacing: 1 }, { type: 10, content: message }, { type: 1, components: [{ type: 2, custom_id: `fm:sellfilter:${userId}`, label: 'Sell filter', style: BUTTON_SECONDARY }] }, categorySelect(userId, 'fish')] }] }; }

function sellFishByRarity(userId, rarities) {
  const selected = Array.isArray(rarities) ? rarities : [];
  const wanted = new Set(selected.map((rarity) => String(rarity || '').toLowerCase()).filter(Boolean));
  const sellAll = wanted.has('all');
  const state = loadState();
  const user = ensureUser(state, userId);
  let totalValue = 0;
  let sold = 0;
  const soldByRarity = {};
  user.fishBarrel = user.fishBarrel.filter((entry) => {
    const fish = FISH_BY_ID.get(entry.fishId);
    if (!fish || entry.locked) return true;
    if (!sellAll && !wanted.has(String(fish.rarity || '').toLowerCase())) return true;
    const value = fishTotalValue(state, entry, fish);
    totalValue += value;
    sold += 1;
    soldByRarity[fish.rarity] = (soldByRarity[fish.rarity] || 0) + 1;
    user.fishIndex = user.fishIndex && typeof user.fishIndex === 'object' ? user.fishIndex : {};
    const previous = user.fishIndex[fish.id] && typeof user.fishIndex[fish.id] === 'object' ? user.fishIndex[fish.id] : {};
    user.fishIndex[fish.id] = { discoveredAt: previous.discoveredAt || entry.caughtAt || Date.now(), count: Math.max(1, Math.floor(Number(previous.count) || 0)), lastCaughtAt: previous.lastCaughtAt || entry.caughtAt || Date.now() };
    updateMarketEntry(state, 'fish', fish.id, 1, 0);
    return false;
  });
  user.fishCoins += totalValue;
  saveState(state);
  if (!sold) return resultPayload(userId, sellAll ? '-# **No unlocked fish found to sell.**' : '-# **No unlocked fish matched the selected rarities.**');
  const rarityText = Object.entries(soldByRarity).sort(([a], [b]) => a.localeCompare(b)).map(([rarity, amount]) => `${amount} ${rarity}`).join(', ');
  return resultPayload(userId, `-# **You've sold ${sold} fish (${rarityText}) - ${totalValue} ${FISH_COIN}**`);
}

function isMarketActionThatMaySell(action) { return ['sellfish', 'sellitem', 'sellfiltersubmit', 'itemfiltersubmit'].includes(action); }

function wrapCommand(command) {
  return {
    ...command,
    init: startMarketValueTimer,
    async execute(interaction, client) { syncMarketValues(false); if (typeof command.execute !== 'function') return undefined; return command.execute(interaction, client); },
    async handleInteraction(interaction, client) {
      const id = interaction.customId || '';
      const parts = id.split(':');
      const action = parts[1];
      const userId = parts[2];
      if (id.startsWith('fm:')) syncMarketValues(false);
      if (id.startsWith('fm:') && (action === 'sellfilter' || action === 'itemfilter')) { if (!isOwner(interaction, userId)) return true; await interaction.showModal(checkboxFilterForm(action === 'sellfilter' ? 'fish' : 'item', userId)); return true; }
      if (id.startsWith('fm:') && action === 'sellfiltersubmit' && interaction.isModalSubmit?.()) { if (!isOwner(interaction, userId)) return true; const rarities = getSelectedValues(interaction, 'fish_rarities'); if (!rarities.length) { await interaction.reply({ content: 'Please select at least one rarity.', flags: EPHEMERAL_FLAG }); return true; } await updateInteraction(interaction, sellFishByRarity(userId, rarities)); return true; }
      const before = id.startsWith('fm:') && isMarketActionThatMaySell(action) ? snapshotUserAmounts(userId) : null;
      const handled = await command.handleInteraction(interaction, client);
      if (before) applyDetectedSales(before, snapshotUserAmounts(userId));
      return handled;
    },
  };
}

module.exports = {
  fishyMarketCommand: wrapCommand(original.fishyMarketCommand),
  inventoryCommand: wrapCommand(original.inventoryCommand),
  fishBarrelCommand: wrapCommand(original.fishBarrelCommand),
};
