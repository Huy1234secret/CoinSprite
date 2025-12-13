const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  DEFAULT_PROFILE,
  getUserProfile,
  normalizeGearItem,
} = require('../src/huntProfile');
const { safeErrorReply } = require('../src/utils/interactions');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const INVENTORY_TYPE_SELECT_PREFIX = 'inventory:type:';
const INVENTORY_PAGE_SELECT_PREFIX = 'inventory:page:';
const ITEMS_PER_PAGE = 5;

const RARITY_EMOJIS = {
  Common: '<:SBCommon:1447459423185272952>',
  Rare: '<:SBRare:1447459432165408789>',
  Epic: '<:SBEpic:1447459425303527465>',
  Legendary: '<:SBLegendary:1447459428273098835>',
  Mythical: '<:SBMythical:1447459430760317172>',
  Secret: '<:SBSecret:1447459434677665874>',
};

const activeInventories = new Map();

function normalizeInventoryItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const normalized = normalizeGearItem(item) ?? { ...item };
  const amount = Number.isFinite(item.amount) ? item.amount : 1;

  return {
    amount,
    type: normalized.type ?? 'Material',
    rarity: normalized.rarity ?? 'Common',
    emoji: normalized.emoji ?? '',
    name: normalized.name ?? 'Unknown Item',
    value: Number.isFinite(normalized.value) ? normalized.value : 0,
  };
}

function collectInventoryItems(profile) {
  const items = [...(profile.gear_inventory ?? []), ...(profile.misc_inventory ?? [])];
  const aggregated = new Map();

  for (const rawItem of items) {
    const normalized = normalizeInventoryItem(rawItem);
    if (!normalized) {
      continue;
    }

    const key = normalized.name;
    const existing = aggregated.get(key);
    if (existing) {
      existing.amount += normalized.amount;
      continue;
    }

    aggregated.set(key, { ...normalized });
  }

  return Array.from(aggregated.values());
}

function formatItemLine(item) {
  const rarityEmoji = RARITY_EMOJIS[item.rarity] ?? '';
  const titleLine = `* ×${item.amount} ${item.name} ${item.emoji}`.trim();
  const rarityLine = `-# Rarity: ${item.rarity} ${rarityEmoji}`.trim();
  const typeLine = `-# Item type: ${item.type}`;
  return `${titleLine}\n${rarityLine}\n${typeLine}`;
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

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: `### ${user.username} inventory\n-# capacity: ${allItems.length} / ${
              profile.inventory_capacity ?? DEFAULT_PROFILE.inventory_capacity
            }\n-# T.Inventory Value: ${totalValue}`,
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
    .setDescription('View your inventory items.'),

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
