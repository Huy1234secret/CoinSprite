const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { ensureShopAssets, createShopImage, ITEM_PLACEHOLDER_EMOJI } = require('../src/shopImage');
const {
  ensureShopState,
  formatOrdinal,
  getShopItemsForUser,
  getShopSummary,
} = require('../src/shop');
const { safeErrorReply } = require('../src/utils/interactions');

const SHOP_PAGE_SELECT_PREFIX = 'shop-page-select:';
const SHOP_ITEM_BUTTON_PREFIX = 'shop-item-';
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const SHOP_THUMBNAIL_URL = 'https://i.ibb.co/sp8bcTq9/The-Collector.png';
const ITEMS_PER_PAGE = 6;

function normalizeEmojiForComponent(emoji, availableEmojiIds = null) {
  if (!emoji) {
    return null;
  }

  if (typeof emoji === 'object' && (emoji.id || emoji.name)) {
    if (emoji.id) {
      const id = String(emoji.id);
      if (!/^\d+$/.test(id)) {
        return null;
      }
      if (availableEmojiIds && !availableEmojiIds.has(id)) {
        return null;
      }
      return {
        id,
        name: emoji.name ? String(emoji.name) : undefined,
        animated: Boolean(emoji.animated),
      };
    }
    if (emoji.name) {
      const trimmed = String(emoji.name).trim();
      if (trimmed.length === 0) {
        return null;
      }
      return /[^\x00-\x7F]/.test(trimmed) ? { name: trimmed } : null;
    }
    return null;
  }

  if (typeof emoji !== 'string') {
    return null;
  }

  const trimmed = emoji.trim();
  if (!trimmed) {
    return null;
  }

  const customMatch = trimmed.match(/^<(a?):([^:>]+):(\d+)>$/);
  if (customMatch) {
    if (availableEmojiIds && !availableEmojiIds.has(customMatch[3])) {
      return null;
    }
    return {
      id: customMatch[3],
      name: customMatch[2],
      animated: customMatch[1] === 'a',
    };
  }

  return /[^\x00-\x7F]/.test(trimmed) ? { name: trimmed } : null;
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

async function buildShopPreview(interaction, page = 1) {
  const shopState = await ensureShopState(interaction.client);
  const assetPaths = await ensureShopAssets();
  const userItems = getShopItemsForUser(shopState, interaction.user.id);
  const { totalPages, page: safePage, slice } = paginateItems(userItems, page);
  const buffer = await createShopImage(slice, assetPaths.currencyIcon);
  const attachment = new AttachmentBuilder(buffer, { name: 'shop-view.png' });

  const summary = getShopSummary(shopState);
  const availableEmojiIds = getAvailableEmojiIds(interaction);
  const components = buildShopComponents({
    items: slice,
    userId: interaction.user.id,
    page: safePage,
    totalPages,
    summary,
    availableEmojiIds,
  });

  return { attachment, components, totalPages, page: safePage };
}

function getAvailableEmojiIds(interaction) {
  const ids = new Set();
  const guildEmojis = interaction.guild?.emojis?.cache;
  if (guildEmojis) {
    guildEmojis.forEach((emoji) => ids.add(emoji.id));
    return ids;
  }

  const clientEmojis = interaction.client?.emojis?.cache;
  if (clientEmojis) {
    clientEmojis.forEach((emoji) => ids.add(emoji.id));
  }

  return ids.size ? ids : null;
}

function buildShopComponents({ items, userId, page, totalPages, summary, availableEmojiIds }) {
  const restockLabel = formatOrdinal(summary.restockCount);
  const previewContainer = {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 10,
        content: `## The Collector's Shop - ${restockLabel}\n-# Shop restock <t:${summary.nextRestockAt}:R>`
      },
      {
        type: 12,
        items: [
          {
            media: {
              url: 'attachment://shop-view.png'
            }
          }
        ]
      },
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${SHOP_PAGE_SELECT_PREFIX}${userId}`)
            .setPlaceholder(`Page ${page}`)
            .addOptions(
              Array.from({ length: totalPages }, (_, index) => {
                const value = index + 1;
                return {
                  label: `Page ${value}`,
                  value: String(value),
                  default: value === page,
                };
              })
            )
            .setMinValues(1)
            .setMaxValues(1)
            .setDisabled(totalPages <= 1)
        )
        .toJSON()
    ],
    accessory: {
      type: 11,
      media: { url: SHOP_THUMBNAIL_URL },
      description: "The Collector's shopkeeper thumbnail"
    }
  };

  const BUTTONS_PER_ROW = 3;
  const buttonRows = [];

  for (let i = 0; i < items.length; i += BUTTONS_PER_ROW) {
    const slice = items.slice(i, i + BUTTONS_PER_ROW);
    const row = new ActionRowBuilder();

    slice.forEach((item, index) => {
      const rawEmoji = item.emoji ?? (!item.image ? ITEM_PLACEHOLDER_EMOJI : null);
      const buttonEmoji = normalizeEmojiForComponent(rawEmoji, availableEmojiIds);

      const button = new ButtonBuilder()
        .setCustomId(`${SHOP_ITEM_BUTTON_PREFIX}${item.id}`)
        .setLabel(item.name)
        .setStyle(ButtonStyle.Success);

      if (buttonEmoji) {
        button.setEmoji(buttonEmoji);
      }

      row.addComponents(button);
    });

    buttonRows.push(row.toJSON());
  }

  const buttonsContainer = {
    type: 17,
    accent_color: 0xffffff,
    components: buttonRows
  };

  return [previewContainer, buttonsContainer];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop-view')
    .setDescription('View your shop, here u can buy some stuff!'),

  async execute(interaction) {
    await interaction.deferReply({ flags: COMPONENTS_V2_FLAG });
    try {
      const { attachment, components } = await buildShopPreview(interaction);

      await interaction.editReply({
        files: [attachment],
        components,
        flags: COMPONENTS_V2_FLAG
      });
    } catch (error) {
      console.error('Failed to generate shop view:', error);
      await interaction.editReply({
        components: [
          {
            type: 10,
            content: 'Unable to generate the shop view right now.'
          }
        ],
        flags: COMPONENTS_V2_FLAG
      });
    }
  },

  async handleComponent(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith(SHOP_ITEM_BUTTON_PREFIX)) {
      await safeErrorReply(interaction, 'Item purchase is not available in the preview.');
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SHOP_PAGE_SELECT_PREFIX)) {
      const userId = interaction.customId.replace(SHOP_PAGE_SELECT_PREFIX, '');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }

      const selectedPage = Number.parseInt(interaction.values?.[0], 10) || 1;
      const { attachment, components } = await buildShopPreview(interaction, selectedPage);
      await interaction.update({
        files: [attachment],
        components,
        flags: COMPONENTS_V2_FLAG
      });
      return true;
    }

    return false;
  },

  async init(client) {
    await ensureShopState(client);
    setInterval(() => {
      ensureShopState(client);
    }, 60 * 1000);
  },
};
