const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const {
  getUserProfile,
  normalizeGearItem,
  updateUserProfile,
} = require('../src/huntProfile');
const { addCoinsToUser } = require('../src/userStats');
const {
  getSellablePrice,
  getRarityEmoji,
  normalizeKey,
  resolveItem,
} = require('../src/shop');
const { safeErrorReply } = require('../src/utils/interactions');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const COIN_EMOJI = '<:CRCoin:1447459216574124074>';
const RECEIPT_CHANNEL_ID = '1461407730303762563';

const MARKET_DATA_FILE = path.join(__dirname, '..', 'data', 'market_state.json');
const MARKET_ADD_BUTTON_PREFIX = 'market:add:';
const MARKET_SELL_BUTTON_PREFIX = 'market:sell:';
const MARKET_CANCEL_BUTTON_PREFIX = 'market:cancel:';
const MARKET_MODAL_PREFIX = 'market:modal:';
const MARKET_CONFIRM_PREFIX = 'market:confirm:';
const MARKET_DENY_PREFIX = 'market:deny:';

const activeMarketViews = new Map();

function loadMarketState() {
  if (!fs.existsSync(MARKET_DATA_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(MARKET_DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    console.warn('Failed to read market state; starting fresh.', error);
    return {};
  }
}

function saveMarketState(state) {
  const safeState = typeof state === 'object' && state !== null ? state : {};
  fs.mkdirSync(path.dirname(MARKET_DATA_FILE), { recursive: true });
  fs.writeFileSync(MARKET_DATA_FILE, JSON.stringify(safeState));
}

function getUserMarketState(userId) {
  const allState = loadMarketState();
  if (!allState[userId]) {
    allState[userId] = { items: {} };
    saveMarketState(allState);
  }
  return allState[userId];
}

function setUserMarketState(userId, state) {
  const allState = loadMarketState();
  allState[userId] = state;
  saveMarketState(allState);
}

function clearUserMarketState(userId) {
  const allState = loadMarketState();
  if (allState[userId]) {
    allState[userId] = { items: {} };
    saveMarketState(allState);
  }
}

function collectInventoryItems(profile) {
  const items = [...(profile.gear_inventory ?? []), ...(profile.misc_inventory ?? [])];
  const aggregated = new Map();

  for (const rawItem of items) {
    const normalized = normalizeGearItem(rawItem) ?? { ...rawItem };
    if (!normalized?.name) {
      continue;
    }

    const amount = Number.isFinite(rawItem?.amount) ? rawItem.amount : 1;
    const key = normalized.id ?? normalized.name;
    const existing = aggregated.get(key);

    if (existing) {
      existing.amount += amount;
    } else {
      aggregated.set(key, {
        item: normalized,
        amount,
      });
    }
  }

  return Array.from(aggregated.values());
}

function scoreMatch(query, candidate) {
  if (!query || !candidate) {
    return 0;
  }

  if (query === candidate) {
    return 1000;
  }

  if (candidate.includes(query)) {
    return 500 + query.length;
  }

  if (query.includes(candidate)) {
    return 200 + candidate.length;
  }

  return 0;
}

function findBestInventoryMatch(query, inventory) {
  const normalizedQuery = normalizeKey(query);
  let best = null;
  let bestScore = 0;

  for (const entry of inventory) {
    const item = entry.item;
    const nameKey = normalizeKey(item.name);
    const idKey = normalizeKey(item.id);
    const score = Math.max(scoreMatch(normalizedQuery, nameKey), scoreMatch(normalizedQuery, idKey));

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore > 0 ? best : null;
}

function findInventoryMatches(query, inventory) {
  const normalizedQuery = normalizeKey(query);
  if (!normalizedQuery) {
    return [];
  }

  return inventory.filter((entry) => {
    const item = entry.item;
    const nameKey = normalizeKey(item.name);
    const idKey = normalizeKey(item.id);
    return Math.max(scoreMatch(normalizedQuery, nameKey), scoreMatch(normalizedQuery, idKey)) > 0;
  });
}

function findMarketItemMatch(query, currentState) {
  const normalizedQuery = normalizeKey(query);
  if (!normalizedQuery) {
    return null;
  }

  let best = null;
  let bestScore = 0;
  const entries = Object.entries(currentState.items ?? {});

  for (const [itemId] of entries) {
    const item = resolveItem(itemId);
    if (!item) {
      continue;
    }

    const nameKey = normalizeKey(item.name);
    const idKey = normalizeKey(item.id);
    const score = Math.max(scoreMatch(normalizedQuery, nameKey), scoreMatch(normalizedQuery, idKey));

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return bestScore > 0 ? best : null;
}

function parseValueCondition(line) {
  const match = line.match(/^(.+?)\s*(?:as\s*)?["']?value\s*(<=|>=|<|>)\s*(\d+)\s*["']?$/i);
  if (!match) {
    return null;
  }

  return {
    query: match[1].trim(),
    operator: match[2],
    value: Number.parseInt(match[3], 10),
  };
}

function parseRarityCondition(line) {
  const match = line.match(
    /^(.+?)\s*(?:to\s+sell\s+as|as)?\s*#(common|rare|epic|legendary|mythical|secret)\s*$/i
  );
  if (!match) {
    return null;
  }

  return {
    query: match[1].trim(),
    rarity: match[2],
  };
}

function compareValue(operator, left, right) {
  switch (operator) {
    case '<':
      return left < right;
    case '>':
      return left > right;
    case '<=':
      return left <= right;
    case '>=':
      return left >= right;
    default:
      return false;
  }
}

function buildMarketItemLines(items) {
  if (!items.length) {
    return ['No items in your sell list.'];
  }

  return items.map((entry) => {
    const item = entry.item;
    return `${item.emoji ?? ''} ${item.name} • ${getRarityEmoji(item.rarity)} • ×${entry.amount}`;
  });
}

function buildMarketView(userId) {
  const state = getUserMarketState(userId);
  const entries = Object.entries(state.items ?? {})
    .map(([itemId, amount]) => {
      const item = resolveItem(itemId);
      if (!item) {
        return null;
      }
      return { item, amount };
    })
    .filter(Boolean)
    .sort((a, b) => a.item.name.localeCompare(b.item.name));

  const itemLines = buildMarketItemLines(entries);
  const totalItems = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const totalCoins = entries.reduce((sum, entry) => {
    const sellPrice = getSellablePrice(entry.item) ?? 0;
    return sum + sellPrice * entry.amount;
  }, 0);

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          { type: 10, content: `## The Collector's Market\n-# Wanna sell something?` },
          { type: 14 },
          { type: 10, content: itemLines.join('\n') },
          { type: 14 },
          { type: 10, content: `* Selling: ${totalItems} items\n* Total: ${totalCoins} ${COIN_EMOJI}` },
        ],
      },
      {
        type: 17,
        accent_color: 0x808080,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${MARKET_SELL_BUTTON_PREFIX}${userId}`)
              .setLabel('Sell')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(totalItems === 0),
            new ButtonBuilder()
              .setCustomId(`${MARKET_ADD_BUTTON_PREFIX}${userId}`)
              .setLabel('Add item')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`${MARKET_CANCEL_BUTTON_PREFIX}${userId}`)
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
          ).toJSON(),
        ],
      },
    ],
  };
}

async function updateMarketMessage(client, userId) {
  const view = activeMarketViews.get(userId);
  if (!view) {
    return;
  }

  try {
    const channel = await client.channels.fetch(view.channelId);
    if (!channel) {
      return;
    }
    const message = await channel.messages.fetch(view.messageId);
    if (!message) {
      return;
    }
    await message.edit(buildMarketView(userId));
  } catch (error) {
    console.warn('Failed to update market message:', error);
  }
}

function parseMarketInput(input, profile, currentState) {
  const inventoryEntries = collectInventoryItems(profile);
  const errors = [];
  const updates = [];
  const lines = input.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const removeMatch = line.match(/^(.+?)\s*-\s*(r|remove)$/i);
    if (removeMatch) {
      const query = removeMatch[1].trim();
      const item = findMarketItemMatch(query, currentState);
      if (!item) {
        errors.push('That item is not in your market list.');
        break;
      }

      const existingAmount = currentState.items?.[item.id] ?? 0;
      if (existingAmount > 0) {
        updates.push({ itemId: item.id, amount: -existingAmount });
      }
      continue;
    }

    const amountMatch = line.match(/^(.+?)\s*-\s*([-+]?\d+)$/);
    if (amountMatch) {
      const query = amountMatch[1].trim();
      const amount = Number.parseInt(amountMatch[2], 10);
      if (!Number.isFinite(amount) || amount === 0) {
        continue;
      }

      const inventoryMatch = findBestInventoryMatch(query, inventoryEntries);
      if (!inventoryMatch) {
        errors.push('You do not have that item in your inventory.');
        break;
      }

      const item = inventoryMatch.item;
      const sellPrice = getSellablePrice(item);
      if (sellPrice === null) {
        errors.push('That item cannot be sold.');
        break;
      }

      const existingAmount = currentState.items?.[item.id] ?? 0;
      if (amount > 0 && existingAmount + amount > inventoryMatch.amount) {
        errors.push('You do not have enough of that item.');
        break;
      }

      updates.push({ itemId: item.id, amount });
      continue;
    }

    const valueCondition = parseValueCondition(line);
    if (valueCondition) {
      const { query, operator, value } = valueCondition;
      const matches = findInventoryMatches(query, inventoryEntries).filter((entry) => {
        const sellPrice = getSellablePrice(entry.item);
        return sellPrice !== null && compareValue(operator, sellPrice, value);
      });

      if (!matches.length) {
        errors.push('No sellable items matched that value filter.');
        break;
      }

      for (const entry of matches) {
        const existingAmount = currentState.items?.[entry.item.id] ?? 0;
        const amountToAdd = entry.amount - existingAmount;
        if (amountToAdd > 0) {
          updates.push({ itemId: entry.item.id, amount: amountToAdd });
        }
      }
      continue;
    }

    const rarityCondition = parseRarityCondition(line);
    if (rarityCondition) {
      const { query, rarity } = rarityCondition;
      const matches = findInventoryMatches(query, inventoryEntries).filter((entry) => {
        const sellPrice = getSellablePrice(entry.item);
        return sellPrice !== null && normalizeKey(entry.item.rarity) === normalizeKey(rarity);
      });

      if (!matches.length) {
        errors.push('No sellable items matched that rarity filter.');
        break;
      }

      for (const entry of matches) {
        const existingAmount = currentState.items?.[entry.item.id] ?? 0;
        const amountToAdd = entry.amount - existingAmount;
        if (amountToAdd > 0) {
          updates.push({ itemId: entry.item.id, amount: amountToAdd });
        }
      }
      continue;
    }

    errors.push('Invalid format detected.');
    break;
  }

  return { errors, updates };
}

function applyMarketUpdates(currentState, updates) {
  const nextItems = { ...(currentState.items ?? {}) };

  for (const update of updates) {
    const existing = nextItems[update.itemId] ?? 0;
    const nextAmount = existing + update.amount;

    if (nextAmount <= 0) {
      delete nextItems[update.itemId];
      continue;
    }

    nextItems[update.itemId] = nextAmount;
  }

  return { items: nextItems };
}

function removeInventoryItems(profile, item, amount) {
  let remaining = amount;

  const applyRemoval = (list = []) => {
    const updated = [];
    for (const entry of list) {
      if (remaining <= 0) {
        updated.push(entry);
        continue;
      }

      if (entry?.name !== item.name && entry?.id !== item.id) {
        updated.push(entry);
        continue;
      }

      const currentAmount = Number.isFinite(entry.amount) ? entry.amount : 1;
      if (currentAmount <= remaining) {
        remaining -= currentAmount;
        continue;
      }

      updated.push({ ...entry, amount: currentAmount - remaining });
      remaining = 0;
    }

    return updated;
  };

  profile.misc_inventory = applyRemoval(profile.misc_inventory);
  profile.gear_inventory = applyRemoval(profile.gear_inventory);

  if (profile.gear_equipped?.name === item.name && remaining >= 0) {
    const stillOwned = profile.gear_inventory?.some((entry) => entry?.name === item.name);
    if (!stillOwned) {
      profile.gear_equipped = null;
    }
  }
}

async function sendReceipt(user, receiptPayload) {
  try {
    await user.send(receiptPayload);
  } catch (error) {
    try {
      const channel = await user.client.channels.fetch(RECEIPT_CHANNEL_ID);
      if (channel) {
        await channel.send(receiptPayload);
      }
    } catch (channelError) {
      console.warn('Failed to send receipt fallback:', channelError);
    }
  }
}

function buildReceiptPayload(totalItems, totalCoins, itemLines, timestamp) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0x64ff64,
        components: [
          {
            type: 10,
            content: `## Selling Receipt\n-# You have sold a total of ${totalItems} items on <t:${timestamp}:F>`
          },
          { type: 14 },
          { type: 10, content: itemLines.join('\n') },
          { type: 14 },
          { type: 10, content: `* Earned: ${totalCoins} ${COIN_EMOJI}` },
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my-market')
    .setDescription('Manage your sell list in The Collector\'s Market'),

  async execute(interaction) {
    const response = buildMarketView(interaction.user.id);
    await interaction.reply(response);
    const message = await interaction.fetchReply();
    activeMarketViews.set(interaction.user.id, {
      messageId: message.id,
      channelId: message.channelId,
    });
  },

  async handleComponent(interaction) {
    if (!interaction.isButton() && !interaction.isModalSubmit()) {
      return false;
    }

    if (interaction.isButton()) {
      const { customId } = interaction;

      if (customId.startsWith(MARKET_ADD_BUTTON_PREFIX)) {
        const userId = customId.replace(MARKET_ADD_BUTTON_PREFIX, '');
        if (interaction.user.id !== userId) {
          await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
          return true;
        }

        const modal = new ModalBuilder()
          .setCustomId(`${MARKET_MODAL_PREFIX}${userId}`)
          .setTitle("The Collector's Market")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('items')
                .setLabel('Which items?')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder(
                  'Format: {item} - {amount}. Or {item} #Rarity / {item} Value<1000. Use "- R" to remove.'
                )
                .setRequired(true)
            )
          );

        await interaction.showModal(modal);
        return true;
      }

      if (customId.startsWith(MARKET_CANCEL_BUTTON_PREFIX)) {
        const userId = customId.replace(MARKET_CANCEL_BUTTON_PREFIX, '');
        if (interaction.user.id !== userId) {
          await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
          return true;
        }

        clearUserMarketState(userId);
        await updateMarketMessage(interaction.client, userId);
        await interaction.reply({ content: 'Market selection cleared.', ephemeral: true });
        return true;
      }

      if (customId.startsWith(MARKET_SELL_BUTTON_PREFIX)) {
        const userId = customId.replace(MARKET_SELL_BUTTON_PREFIX, '');
        if (interaction.user.id !== userId) {
          await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
          return true;
        }

        await interaction.reply({
          ephemeral: true,
          content: '### Are you sure you want to sell these items?',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`${MARKET_CONFIRM_PREFIX}${userId}`)
                .setLabel('YES')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`${MARKET_DENY_PREFIX}${userId}`)
                .setLabel('NO')
                .setStyle(ButtonStyle.Danger)
            ),
          ],
        });
        return true;
      }

      if (customId.startsWith(MARKET_CONFIRM_PREFIX)) {
        const userId = customId.replace(MARKET_CONFIRM_PREFIX, '');
        if (interaction.user.id !== userId) {
          await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
          return true;
        }

        const profile = getUserProfile(userId);
        const state = getUserMarketState(userId);
        const entries = Object.entries(state.items ?? {})
          .map(([itemId, amount]) => {
            const item = resolveItem(itemId);
            if (!item) {
              return null;
            }
            return { item, amount };
          })
          .filter(Boolean);

        if (!entries.length) {
          await interaction.update({ content: 'Your sell list is empty.', components: [] });
          return true;
        }

        const inventoryEntries = collectInventoryItems(profile);
        for (const entry of entries) {
          const inventoryMatch = inventoryEntries.find((itemEntry) => itemEntry.item.id === entry.item.id);
          if (!inventoryMatch || inventoryMatch.amount < entry.amount) {
            await interaction.update({ content: 'You no longer have enough of those items.', components: [] });
            return true;
          }
        }

        let totalCoins = 0;
        let totalItems = 0;
        for (const entry of entries) {
          const sellPrice = getSellablePrice(entry.item) ?? 0;
          totalCoins += sellPrice * entry.amount;
          totalItems += entry.amount;
          removeInventoryItems(profile, entry.item, entry.amount);
        }

        profile.coins = Math.max(0, (profile.coins ?? 0) + totalCoins);
        updateUserProfile(userId, profile);
        addCoinsToUser(userId, totalCoins);

        clearUserMarketState(userId);
        await updateMarketMessage(interaction.client, userId);

        const itemLines = buildMarketItemLines(entries);
        const timestamp = Math.floor(Date.now() / 1000);
        const receiptPayload = buildReceiptPayload(totalItems, totalCoins, itemLines, timestamp);
        await sendReceipt(interaction.user, receiptPayload);

        await interaction.update({ content: 'Sale completed!', components: [] });
        return true;
      }

      if (customId.startsWith(MARKET_DENY_PREFIX)) {
        const userId = customId.replace(MARKET_DENY_PREFIX, '');
        if (interaction.user.id !== userId) {
          await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
          return true;
        }

        await interaction.update({ content: 'Sale canceled.', components: [] });
        return true;
      }

      return false;
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith(MARKET_MODAL_PREFIX)) {
        return false;
      }

      const userId = interaction.customId.replace(MARKET_MODAL_PREFIX, '');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }

      const input = interaction.fields.getTextInputValue('items');
      const profile = getUserProfile(userId);
      const currentState = getUserMarketState(userId);
      const { errors, updates } = parseMarketInput(input, profile, currentState);

      if (errors.length) {
        await interaction.reply({ content: errors[0], ephemeral: true });
        return true;
      }

      const nextState = applyMarketUpdates(currentState, updates);
      setUserMarketState(userId, nextState);
      await updateMarketMessage(interaction.client, userId);
      await interaction.reply({ content: 'Your market list has been updated.', ephemeral: true });
      return true;
    }

    return false;
  },
};
