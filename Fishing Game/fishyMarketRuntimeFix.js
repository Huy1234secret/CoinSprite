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

const FISH_BY_ID = new Map(FISH.map((fish) => [fish.id, fish]));
const VARIANT_MULTIPLIER = { Normal: 1, Golden: 2, Rainbow: 5 };

function normalizeId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function stripFishTier(value) {
  return String(value || '').replace(/\bF[1-7]\s+(?=[A-Z])/g, '');
}

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

function getMarketKey(type, id) {
  return `${type}:${id}`;
}

function countExisting(state, type, id) {
  let total = 0;
  for (const user of Object.values(state.users || {})) {
    if (type === 'fish') total += (Array.isArray(user.fishBarrel) ? user.fishBarrel : []).filter((entry) => entry.fishId === id).length;
  }
  return total;
}

function ensureMarketEntry(state, type, id) {
  state.market = state.market && typeof state.market === 'object' ? state.market : { entries: {}, lastUpdateAt: 0 };
  state.market.entries = state.market.entries && typeof state.market.entries === 'object' ? state.market.entries : {};
  const key = getMarketKey(type, id);
  if (!state.market.entries[key]) {
    const fish = FISH_BY_ID.get(id);
    const baseValue = Math.max(1, fish?.value || 1);
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
  const marketValue = ensureMarketEntry(state, 'fish', fish.id).currentValue;
  const variant = VARIANT_MULTIPLIER[entry.variant] || 1;
  return Math.max(1, Math.round(marketValue * weightMultiplier(fish, entry) * variant * mutationMultiplier(entry)));
}

function rarityOptions() {
  return FILTER_RARITIES.map(([value, label]) => ({ label, value }));
}

const original = require('./fishyMarket');

function checkboxFilterForm(kind, userId) {
  const isFish = kind === 'fish';
  return {
    custom_id: `fm:${kind}filtersubmit:${userId}`,
    title: isFish ? 'Sell fish filter' : 'Sell item filter',
    components: [{
      type: 18,
      label: isFish ? 'Select fish rarity to sell' : 'Select item rarity to sell',
      component: {
        type: CHECKBOX_GROUP_COMPONENT_TYPE,
        custom_id: `${kind}_rarities`,
        min_values: 1,
        max_values: FILTER_RARITIES.length,
        required: true,
        options: rarityOptions(),
      },
    }],
  };
}

function getSelectedValues(interaction, customId) {
  const found = [];
  const addValues = (values) => {
    if (!Array.isArray(values)) return;
    for (const value of values) {
      const normalized = String(value || '').trim();
      if (normalized) found.push(normalized);
    }
  };

  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    const matches = value.customId === customId || value.custom_id === customId;
    if (matches) {
      addValues(value.values);
      addValues(value.selected_values);
      addValues(value.data?.values);
      addValues(value.data?.selected_values);
      if (typeof value.value === 'string') found.push(value.value);
      if (typeof value.selected_value === 'string') found.push(value.selected_value);
    }
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

function categorySelect(userId, selected = 'fish') {
  const labels = { fish: 'Sell-fish', item: 'Sell-item', chart: 'Value-Chart' };
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `fm:category:${userId}`,
      placeholder: 'Select a category',
      min_values: 1,
      max_values: 1,
      options: Object.entries(labels).map(([value, label]) => ({ label, value, default: selected === value })),
    }],
  };
}

function resultPayload(userId, message) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: WHITE_ACCENT,
      components: [
        { type: 10, content: '## Welcome to Fish Selling Market!' },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: message },
        {
          type: 1,
          components: [
            { type: 2, custom_id: `fm:sellfilter:${userId}`, label: 'Sell filter', style: BUTTON_SECONDARY },
          ],
        },
        categorySelect(userId, 'fish'),
      ],
    }],
  };
}

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
    user.fishIndex[fish.id] = {
      discoveredAt: previous.discoveredAt || entry.caughtAt || Date.now(),
      count: Math.max(1, Math.floor(Number(previous.count) || 0)),
      lastCaughtAt: previous.lastCaughtAt || entry.caughtAt || Date.now(),
    };

    updateMarketEntry(state, 'fish', fish.id, 1, 0);
    return false;
  });

  user.fishCoins += totalValue;
  saveState(state);

  if (!sold) {
    return resultPayload(userId, sellAll
      ? '-# **No unlocked fish found to sell.**'
      : '-# **No unlocked fish matched the selected rarities.**');
  }

  const rarityText = Object.entries(soldByRarity)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rarity, amount]) => `${amount} ${rarity}`)
    .join(', ');

  return resultPayload(userId, `-# **You've sold ${sold} fish (${rarityText}) - ${totalValue} ${FISH_COIN}**`);
}

function wrapCommand(command) {
  return {
    ...command,
    async handleInteraction(interaction, client) {
      const id = interaction.customId || '';
      const parts = id.split(':');
      const action = parts[1];
      const userId = parts[2];

      if (id.startsWith('fm:') && (action === 'sellfilter' || action === 'itemfilter')) {
        if (!isOwner(interaction, userId)) return true;
        await interaction.showModal(checkboxFilterForm(action === 'sellfilter' ? 'fish' : 'item', userId));
        return true;
      }

      if (id.startsWith('fm:') && action === 'sellfiltersubmit' && interaction.isModalSubmit?.()) {
        if (!isOwner(interaction, userId)) return true;
        const rarities = getSelectedValues(interaction, 'fish_rarities');
        if (!rarities.length) {
          await interaction.reply({ content: 'Please select at least one rarity.', flags: EPHEMERAL_FLAG });
          return true;
        }
        await updateInteraction(interaction, sellFishByRarity(userId, rarities));
        return true;
      }

      return command.handleInteraction(interaction, client);
    },
  };
}

module.exports = {
  fishyMarketCommand: wrapCommand(original.fishyMarketCommand),
  inventoryCommand: wrapCommand(original.inventoryCommand),
  fishBarrelCommand: wrapCommand(original.fishBarrelCommand),
};
