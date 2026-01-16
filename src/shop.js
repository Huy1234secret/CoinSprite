const fs = require('fs');
const path = require('path');

const { ITEMS, ITEMS_BY_ID } = require('./items');

const SHOP_STATE_FILE = path.join(__dirname, '..', 'data', 'shop_state.json');
const SHOP_RESTOCK_INTERVAL_MS = 60 * 60 * 1000;
const SHOP_TIMEZONE_OFFSET_MS = 7 * 60 * 60 * 1000;
const SHOP_RESTOCK_CHANNEL_ID = '1445637955631710261';

const SHOP_RARITY_PRICE_MULTIPLIER = {
  common: 250,
  rare: 500,
  epic: 1000,
  legendary: 2500,
  mythical: 5000,
};

const SHOP_RARITY_SELL_MULTIPLIER = {
  common: 25,
  rare: 50,
  epic: 100,
  legendary: 250,
  mythical: 500,
};

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythical'];

const RARITY_EMOJIS = {
  common: '<:SBCommon:1460922405932498994>',
  rare: '<:SBRare:1460922389914189930>',
  epic: '<:SBEpic:1460922387137560699>',
  legendary: '<:SBLegendary:1460922396335669268>',
  mythical: '<:SBMythical:1460922392187633684>',
};

const RARITY_ACCENT_COLORS = {
  common: 0x95a5a6,
  rare: 0x3498db,
  epic: 0x9b59b6,
  legendary: 0xf1c40f,
  mythical: 0xe74c3c,
};

const SHOP_ITEM_CONFIG = [
  { name: 'Wooden Sword', chance: 3, minStock: 1, maxStock: 2 },
  { name: 'Dungeon Token', chance: 0.86, minStock: 1, maxStock: 5 },
  { name: 'Beast Meat', chance: 19.68, minStock: 1, maxStock: 10 },
  { name: 'Mossy Shavings', chance: 19.08, minStock: 1, maxStock: 10 },
  { name: 'Vine Fiber', chance: 19.76, minStock: 1, maxStock: 10 },
  { name: 'Sharp Fang', chance: 18.6, minStock: 1, maxStock: 10 },
  { name: 'Weak Venom Gland', chance: 19.52, minStock: 1, maxStock: 10 },
  { name: 'Jungle Feather', chance: 19.2, minStock: 1, maxStock: 10 },
  { name: 'Razor Talon', chance: 18, minStock: 1, maxStock: 10 },
  { name: 'Heavy Horn Fragment', chance: 15.2, minStock: 1, maxStock: 10 },
  { name: 'Tough Hide Scrap', chance: 18.4, minStock: 1, maxStock: 10 },
  { name: 'Worldroot Fragment', chance: 11.76, minStock: 1, maxStock: 10 },
  { name: 'Ancient Jungle Tablet', chance: 2.3, minStock: 1, maxStock: 10 },
  { name: 'Resin Lump', chance: 16.8, minStock: 1, maxStock: 10 },
  { name: 'Burrower Scale', chance: 14, minStock: 1, maxStock: 10 },
  { name: 'Razorfeather Quill', chance: 15.2, minStock: 1, maxStock: 10 },
  { name: 'Hunter Pelt Strip', chance: 15.08, minStock: 1, maxStock: 10 },
  { name: 'Jaguar Soul Fang', chance: 12.48, minStock: 1, maxStock: 10 },
  { name: 'Beetle Carapace Shard', chance: 16, minStock: 1, maxStock: 10 },
  { name: 'Poison Spore Cluster', chance: 14.92, minStock: 1, maxStock: 10 },
  { name: 'Shellguard Plate', chance: 13.88, minStock: 1, maxStock: 10 },
  { name: 'Rootbinding Splinter', chance: 13.24, minStock: 1, maxStock: 10 },
  { name: 'Storm Core Shard', chance: 2.795, minStock: 1, maxStock: 5 },
  { name: 'Thundertrace Clawband', chance: 10.4, minStock: 1, maxStock: 10 },
  { name: 'Bloom Petal Cluster', chance: 2.555, minStock: 1, maxStock: 4 },
  { name: 'Spirit Mist Essence', chance: 2.318, minStock: 1, maxStock: 4 },
  { name: "Warden's Veil Shard", chance: 1.145, minStock: 1, maxStock: 10 },
  { name: 'Totem Stone Chip', chance: 5.85, minStock: 1, maxStock: 10 },
  { name: 'Guardian Core', chance: 3.395, minStock: 1, maxStock: 10 },
  { name: 'Sunfire Pelt', chance: 6.4, minStock: 1, maxStock: 10 },
  { name: 'Solar Core', chance: 3.2, minStock: 1, maxStock: 4 },
  { name: 'Phantom Orchid Petal', chance: 1.102, minStock: 1, maxStock: 3 },
  { name: 'Dirt', chance: 19.8, minStock: 1, maxStock: 10 },
  { name: 'Bone', chance: 19, minStock: 1, maxStock: 10 },
  { name: 'Leaf', chance: 19.68, minStock: 1, maxStock: 10 },
  { name: 'Feathers', chance: 19.6, minStock: 1, maxStock: 10 },
  { name: 'Clay', chance: 16.8, minStock: 1, maxStock: 10 },
  { name: 'Pebbles', chance: 18, minStock: 1, maxStock: 10 },
  { name: 'Twigs', chance: 18.6, minStock: 1, maxStock: 10 },
  { name: 'Stone', chance: 18.2, minStock: 1, maxStock: 10 },
  { name: 'Coal', chance: 18.6, minStock: 1, maxStock: 10 },
  { name: 'Fossil', chance: 18, minStock: 1, maxStock: 10 },
  { name: 'Copper Ore', chance: 16.8, minStock: 1, maxStock: 8 },
  { name: 'Iron Ore', chance: 15.2, minStock: 1, maxStock: 8 },
  { name: 'Gold Ore', chance: 10, minStock: 1, maxStock: 8 },
  { name: 'Amethyst Ore', chance: 7, minStock: 1, maxStock: 4 },
  { name: 'Basalt Iron', chance: 3.05, minStock: 1, maxStock: 2 },
  { name: 'Magma Core', chance: 0.48, minStock: 1, maxStock: 2 },
  { name: 'Magmatic Ore', chance: 0.86, minStock: 1, maxStock: 2 },
  { name: 'Sulfur Clumps', chance: 2.51, minStock: 1, maxStock: 2 },
  { name: 'Obsidian', chance: 2.9, minStock: 1, maxStock: 2 },
  { name: 'Sapphire Ore', chance: 6.75, minStock: 1, maxStock: 4 },
  { name: 'Emerald Ore', chance: 3.05, minStock: 1, maxStock: 4 },
  { name: 'Ruby Ore', chance: 2.75, minStock: 1, maxStock: 4 },
  { name: 'Diamond Ore', chance: 0.86, minStock: 1, maxStock: 4 },
  { name: 'Tree Bark', chance: 19.4, minStock: 1, maxStock: 10 },
  { name: 'Acorn', chance: 17.6, minStock: 1, maxStock: 10 },
  { name: 'Common Treasure Chest', chance: 5, minStock: 1, maxStock: 2 },
  { name: 'Rare Treasure Chest', chance: 1, minStock: 1, maxStock: 2 },
  { name: 'Epic Treasure Chest', chance: 0.5, minStock: 1, maxStock: 2 },
  { name: 'Legendary Treasure Chest', chance: 0.15, minStock: 1, maxStock: 2 },
  { name: 'Mythical Treasure Chest', chance: 0.05, minStock: 1, maxStock: 2 },
];

function normalizeKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]/g, '');
}

const ITEM_LOOKUP = ITEMS.reduce((acc, item) => {
  const nameKey = normalizeKey(item.name);
  const idKey = normalizeKey(item.id);
  if (nameKey) {
    acc[nameKey] = item;
  }
  if (idKey) {
    acc[idKey] = item;
  }
  return acc;
}, {});

function resolveItem(identifier) {
  if (!identifier) {
    return null;
  }

  if (ITEMS_BY_ID[identifier]) {
    return ITEMS_BY_ID[identifier];
  }

  const key = normalizeKey(identifier);
  return ITEM_LOOKUP[key] ?? null;
}

const RESOLVED_SHOP_ITEMS = SHOP_ITEM_CONFIG.map((entry) => {
  const item = resolveItem(entry.name);
  if (!item) {
    console.warn(`Shop item not found: ${entry.name}`);
    return null;
  }

  return { ...entry, item };
}).filter(Boolean);

function loadShopState() {
  if (!fs.existsSync(SHOP_STATE_FILE)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(SHOP_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch (error) {
    console.warn('Failed to load shop state; resetting.', error);
    return null;
  }
}

function saveShopState(state) {
  fs.mkdirSync(path.dirname(SHOP_STATE_FILE), { recursive: true });
  fs.writeFileSync(SHOP_STATE_FILE, JSON.stringify(state));
}

function getRarityKey(rarity) {
  return String(rarity ?? '').toLowerCase();
}

function getRarityOrder(rarity) {
  const key = getRarityKey(rarity);
  const index = RARITY_ORDER.indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function getRarityEmoji(rarity) {
  return RARITY_EMOJIS[getRarityKey(rarity)] ?? '';
}

function getAccentColorForRarity(rarity) {
  return RARITY_ACCENT_COLORS[getRarityKey(rarity)] ?? 0xffffff;
}

function getShopPrice(item) {
  const rarityKey = getRarityKey(item?.rarity);
  const multiplier = SHOP_RARITY_PRICE_MULTIPLIER[rarityKey] ?? 0;
  const value = Number.isFinite(item?.value) ? item.value : 0;
  return Math.max(0, Math.round(value * multiplier));
}

function getSellPrice(item) {
  const rarityKey = getRarityKey(item?.rarity);
  const multiplier = SHOP_RARITY_SELL_MULTIPLIER[rarityKey] ?? 0;
  const value = Number.isFinite(item?.value) ? item.value : 0;
  return Math.max(0, Math.round(value * multiplier));
}

function rollStockAmount(minStock, maxStock) {
  const min = Math.max(0, Math.floor(minStock));
  const max = Math.max(min, Math.floor(maxStock));
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollRestockItems() {
  const items = [];

  for (const entry of RESOLVED_SHOP_ITEMS) {
    const roll = Math.random() * 100;
    if (roll <= entry.chance) {
      const stock = rollStockAmount(entry.minStock, entry.maxStock);
      items.push({ itemId: entry.item.id, stock });
    }
  }

  if (!items.length && RESOLVED_SHOP_ITEMS.length) {
    const fallback = RESOLVED_SHOP_ITEMS[0];
    const stock = rollStockAmount(fallback.minStock, fallback.maxStock);
    items.push({ itemId: fallback.item.id, stock });
  }

  return items;
}

function formatOrdinal(value) {
  const number = Math.max(0, Math.floor(value));
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const mod100 = number % 100;
  const mod10 = number % 10;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : suffixes[mod10] || 'th';
  return `${number}${suffix}`;
}

function getUserPurchaseState(state, userId) {
  if (!state.userPurchases) {
    state.userPurchases = {};
  }

  const existing = state.userPurchases[userId];
  if (!existing || existing.restockCount !== state.restockCount) {
    state.userPurchases[userId] = { restockCount: state.restockCount, items: {} };
  }

  return state.userPurchases[userId];
}

function buildRestockState(previous, restockedAt) {
  const restockCount = (previous?.restockCount ?? 0) + 1;
  const restockedAtMs = restockedAt * 1000;
  return {
    restockCount,
    restockedAt,
    nextRestockAt: getNextRestockAtMs(restockedAtMs),
    items: rollRestockItems(),
    userPurchases: {},
  };
}

function getNextRestockAtMs(referenceMs) {
  const baseMs = Number.isFinite(referenceMs) ? referenceMs : Date.now();
  const localMs = baseMs + SHOP_TIMEZONE_OFFSET_MS;
  const nextLocal = new Date(localMs);
  nextLocal.setMinutes(0, 0, 0);
  if (nextLocal.getTime() <= localMs) {
    nextLocal.setHours(nextLocal.getHours() + 1);
  }
  return nextLocal.getTime() - SHOP_TIMEZONE_OFFSET_MS;
}

function getNextRestockTimestamp(state) {
  const nextRestockAt = Number(state?.nextRestockAt);
  if (Number.isFinite(nextRestockAt) && nextRestockAt > 0) {
    return Math.floor(nextRestockAt / 1000);
  }
  return Math.floor(getNextRestockAtMs(Date.now()) / 1000);
}

function shouldRestock(state) {
  if (!state) {
    return true;
  }

  if (!Array.isArray(state.items) || state.items.length === 0) {
    return true;
  }

  const nextRestockAt = Number(state.nextRestockAt);
  if (!Number.isFinite(nextRestockAt)) {
    return true;
  }

  return Date.now() >= nextRestockAt;
}

function getShopItemsForUser(state, userId) {
  const userPurchases = getUserPurchaseState(state, userId);
  const purchases = userPurchases.items ?? {};

  return state.items
    .map((entry) => {
      const item = resolveItem(entry.itemId);
      if (!item) {
        return null;
      }
      const purchased = purchases[item.id] ?? 0;
      const remaining = Math.max(0, entry.stock - purchased);
      return {
        ...item,
        price: getShopPrice(item),
        stock: remaining,
      };
    })
    .filter((item) => item && item.stock > 0)
    .sort((a, b) => {
      const rarityDiff = getRarityOrder(a.rarity) - getRarityOrder(b.rarity);
      if (rarityDiff !== 0) {
        return rarityDiff;
      }
      return a.name.localeCompare(b.name);
    });
}

function getRestockMessagePayload(state) {
  const restockedAt = state.restockedAt ?? Math.floor(Date.now() / 1000);
  const itemEntries = state.items
    .map((entry) => {
      const item = resolveItem(entry.itemId);
      if (!item) {
        return null;
      }
      return { ...item, stock: entry.stock };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const rarityDiff = getRarityOrder(a.rarity) - getRarityOrder(b.rarity);
      if (rarityDiff !== 0) {
        return rarityDiff;
      }
      return a.name.localeCompare(b.name);
    });

  const rarest = itemEntries
    .slice()
    .sort((a, b) => getRarityOrder(b.rarity) - getRarityOrder(a.rarity))[0];
  const accentColor = getAccentColorForRarity(rarest?.rarity ?? 'common');
  const itemLines = itemEntries.length
    ? itemEntries.map((item) => `${item.emoji ?? ''} ${item.name} • ${getRarityEmoji(item.rarity)} • ${item.stock}`)
    : ['No items were restocked this time.'];

  const content = [
    `## 🔄The Collector's Shop Restock - ${formatOrdinal(state.restockCount)}#📦`,
    `-# restocked <t:${restockedAt}:R>`,
  ].join('\n');

  return {
    content,
    accentColor,
    itemLines,
  };
}

async function announceRestock(client, state) {
  if (!client) {
    return;
  }

  try {
    const channel = await client.channels.fetch(SHOP_RESTOCK_CHANNEL_ID);
    if (!channel) {
      return;
    }

    const payload = getRestockMessagePayload(state);

    await channel.send({
      embeds: [
        {
          color: payload.accentColor,
          description: [payload.content, payload.itemLines.join('\n')].join('\n\n'),
        },
      ],
    });
  } catch (error) {
    console.warn('Failed to announce shop restock:', error);
  }
}

async function ensureShopState(client) {
  const previous = loadShopState();

  if (!shouldRestock(previous)) {
    return previous;
  }

  const restockedAt = Math.floor(Date.now() / 1000);
  const nextState = buildRestockState(previous, restockedAt);
  saveShopState(nextState);
  await announceRestock(client, nextState);
  return nextState;
}

function getShopSummary(state) {
  return {
    restockCount: state.restockCount ?? 0,
    restockedAt: state.restockedAt ?? Math.floor(Date.now() / 1000),
    nextRestockAt: getNextRestockTimestamp(state),
  };
}

function getSellablePrice(item) {
  if (!item || item.sellPrice === null) {
    return null;
  }

  return getSellPrice(item);
}

function getShopState() {
  return loadShopState();
}

module.exports = {
  SHOP_RESTOCK_INTERVAL_MS,
  SHOP_RARITY_PRICE_MULTIPLIER,
  SHOP_RARITY_SELL_MULTIPLIER,
  RARITY_EMOJIS,
  RARITY_ORDER,
  getShopItemsForUser,
  getShopPrice,
  getShopSummary,
  getSellPrice,
  getSellablePrice,
  formatOrdinal,
  getRarityEmoji,
  getRarityOrder,
  getAccentColorForRarity,
  getShopState,
  getNextRestockTimestamp,
  ensureShopState,
  resolveItem,
  normalizeKey,
};
