const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  getUserProfile,
  getInventoryCapacity,
  getInventoryItemCount,
  normalizeGearItem,
} = require('../src/huntProfile');
const { safeErrorReply } = require('../src/utils/interactions');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const INVENTORY_TYPE_SELECT_PREFIX = 'inventory:type:';
const INVENTORY_PAGE_SELECT_PREFIX = 'inventory:page:';
const ITEMS_PER_PAGE = 10;

const RARITY_EMOJIS = {
  Common: '⚪',
  Rare: '🔵',
  Epic: '🟣',
  Legendary: '🟡',
  Mythical: '🔴',
  Secret: '⚫',
};

const activeInventories = new Map();

function isEquippedGear(item, equippedGear) {
  return (
    equippedGear?.name === item.name &&
    (!Number.isFinite(equippedGear.durability) || item.durability === equippedGear.durability)
  );
}

function normalizeInventoryItem(item, equippedGear) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const normalized = normalizeGearItem(item) ?? { ...item };
  const amount = Number.isFinite(item.amount) ? item.amount : 1;
  const equipped = normalized.type === 'Tool/Gear' && isEquippedGear(normalized, equippedGear);

  return {
    amount,
    type: normalized.type ?? 'Material',
    rarity: normalized.rarity ?? 'Common',
    emoji: normalized.emoji ?? '',
    name: normalized.name ?? 'Unknown Item',
    value: Number.isFinite(normalized.value) ? normalized.value : 0,
    equippedCount: equipped ? 1 : 0,
    equippedDurability: equipped ? normalized.durability ?? null : null,
  };
}

function collectInventoryItems(profile) {
  const items = [...(profile.gear_inventory ?? []), ...(profile.misc_inventory ?? [])];
  const aggregated = new Map();

  for (const rawItem of items) {
    const normalized = normalizeInventoryItem(rawItem, profile.gear_equipped);
    if (!normalized) {
      continue;
    }

    const key = normalized.name;
    const existing = aggregated.get(key);
    if (existing) {
      existing.amount += normalized.amount;
      existing.equippedCount += normalized.equippedCount ?? 0;
      if (normalized.equippedDurability !== null && normalized.equippedDurability !== undefined) {
        existing.equippedDurability = normalized.equippedDurability;
      }
      continue;
    }

    aggregated.set(key, {
      ...normalized,
      equippedCount: normalized.equippedCount ?? 0,
      equippedDurability: normalized.equippedDurability ?? null,
    });
  }

  return Array.from(aggregated.values());
}

function formatItemLine(item) {
  const rarityEmoji = RARITY_EMOJIS[item.rarity] ?? '';
  const titleLine = `* ×${item.amount} ${item.name} ${item.emoji}`.trim();
  const rarityLine = `-# Rarity: ${item.rarity} ${rarityEmoji}`.trim();
  const typeLine = `-# Item type: ${item.type}`;
  const durabilityLine =
    item.equippedCount > 0
      ? `-# * Using ×${item.equippedCount} ${item.name} ${item.emoji}  - Durability left: ${
          Number.isFinite(item.equippedDurability) ? item.equippedDurability : '∞'
        }`
      : null;

  return [titleLine, durabilityLine, rarityLine, typeLine].filter(Boolean).join('\n');
}

function paginateItems(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * ITEMS_PER_PAGE;
  return {
    totalPages,
    page: safePage,
    slice: items.slice(start, start + ITEMS_PER_PAGE),
  };
}

function buildTypeSelect(userId, selectedTypes = []) {
  const options = ['Tool/Gear', 'Consumable', 'Container', 'Material'].map((label) => ({
    label,
    value: label,
    default: selectedTypes.includes(label),
  }));

  return {
    type: 3,
    custom_id: `${INVENTORY_TYPE_SELECT_PREFIX}${userId}`,
    placeholder: 'Sort item type',
    options,
    min_values: 0,
    max_values: options.length,
  };
}

function buildPageSelect(userId, totalPages, currentPage) {
  const options = Array.from({ length: totalPages }).map((_, index) => {
    const value = index + 1;
    return {
      label: `Page ${value}`,
      value: String(value),
      default: currentPage === value,
    };
  });

  return {
    type: 3,
    custom_id: `${INVENTORY_PAGE_SELECT_PREFIX}${userId}`,
    placeholder: `Page ${currentPage}`,
    options,
    min_values: 1,
    max_values: 1,
  };
}

function buildInventoryContent(profile, user, state) {
  const { selectedTypes = [], page = 1 } = state ?? {};
  const allItems = collectInventoryItems(profile);
  const filteredItems = selectedTypes.length
    ? allItems.filter((item) => selectedTypes.includes(item.type))
    : allItems;

  const totalValue = allItems.reduce((sum, item) => sum + item.value * item.amount, 0);
  const { totalPages, page: safePage, slice } = paginateItems(filteredItems, page);
  const listText = slice.length
    ? slice.map(formatItemLine).join('\n\n')
    : 'No items found for this page.';
  const itemCount = getInventoryItemCount(profile);

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: `### ${user.username} inventory\n-# capacity: ${itemCount} / ${getInventoryCapacity(
              profile
            )}\n-# T.Inventory Value: ${totalValue}`,
          },
          { type: 14 },
          { type: 10, content: listText },
          { type: 14 },
          {
            type: 1,
            components: [buildTypeSelect(user.id, selectedTypes)],
          },
          {
            type: 1,
            components: [buildPageSelect(user.id, totalPages, safePage)],
          },
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View your inventory [items]'),

  async execute(interaction) {
    const profile = getUserProfile(interaction.user.id);
    const state = { selectedTypes: [], page: 1 };
    activeInventories.set(interaction.user.id, state);

    await interaction.reply(buildInventoryContent(profile, interaction.user, state));
  },

  async handleComponent(interaction) {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith(INVENTORY_TYPE_SELECT_PREFIX)) {
        const userId = interaction.customId.replace(INVENTORY_TYPE_SELECT_PREFIX, '');
        if (interaction.user.id !== userId) {
          await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
          return true;
        }

        const selectedTypes = interaction.values ?? [];
        const state = { selectedTypes, page: 1 };
        activeInventories.set(userId, state);

        const profile = getUserProfile(userId);
        await interaction.update(buildInventoryContent(profile, interaction.user, state));
        return true;
      }

      if (interaction.customId.startsWith(INVENTORY_PAGE_SELECT_PREFIX)) {
        const userId = interaction.customId.replace(INVENTORY_PAGE_SELECT_PREFIX, '');
        if (interaction.user.id !== userId) {
          await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
          return true;
        }

        const existingState = activeInventories.get(userId) ?? { selectedTypes: [], page: 1 };
        const selectedPage = Number.parseInt(interaction.values?.[0], 10) || 1;
        const nextState = { ...existingState, page: selectedPage };
        activeInventories.set(userId, nextState);

        const profile = getUserProfile(userId);
        await interaction.update(buildInventoryContent(profile, interaction.user, nextState));
        return true;
      }
    }

    return false;
  },
};
