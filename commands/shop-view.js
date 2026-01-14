const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const { ensureShopAssets, createShopImage, getPlaceholderItems, ITEM_PLACEHOLDER_EMOJI } = require('../src/shopImage');
const { safeErrorReply } = require('../src/utils/interactions');

const SHOP_RESTOCK_INTERVAL_HOURS = 1;
const SHOP_PAGE_SELECT_ID = 'shop-page-select';
const SHOP_ITEM_BUTTON_PREFIX = 'shop-item-';
const COMPONENTS_V2_FLAG = 1 << 15;

function getRestockTimestamp() {
  const now = new Date();
  const nextRestock = new Date(now);
  nextRestock.setMinutes(0, 0, 0);

  if (now >= nextRestock) {
    nextRestock.setHours(nextRestock.getHours() + SHOP_RESTOCK_INTERVAL_HOURS);
  }

  return Math.floor(nextRestock.getTime() / 1000);
}

async function buildShopPreview() {
  const assetPaths = await ensureShopAssets();
  const items = getPlaceholderItems(assetPaths);
  const buffer = await createShopImage(items, assetPaths.currencyIcon);
  const attachment = new AttachmentBuilder(buffer, { name: 'shop-view.png' });

  const components = buildShopComponents(items);

  return { attachment, components };
}

function buildShopComponents(items) {
  const previewContainer = {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 10,
        content: `## Jag's Shop\n-# Shop restock <t:${getRestockTimestamp()}:R>`
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
            .setCustomId(SHOP_PAGE_SELECT_ID)
            .setPlaceholder('Page 1')
            .addOptions({ label: 'Page 1', value: 'page-1', default: true })
        )
        .toJSON()
    ]
  };

  const BUTTONS_PER_ROW = 3;
  const buttonRows = [];

  for (let i = 0; i < items.length; i += BUTTONS_PER_ROW) {
    const slice = items.slice(i, i + BUTTONS_PER_ROW);
    const row = new ActionRowBuilder();

    slice.forEach((item, index) => {
      const buttonEmoji = item.emoji || (!item.image ? ITEM_PLACEHOLDER_EMOJI : null);

      const button = new ButtonBuilder()
        .setCustomId(`${SHOP_ITEM_BUTTON_PREFIX}${i + index}`)
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
      const { attachment, components } = await buildShopPreview();

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

    if (interaction.isStringSelectMenu() && interaction.customId === SHOP_PAGE_SELECT_ID) {
      await safeErrorReply(interaction, 'Pagination will be available when multiple pages exist.');
      return true;
    }

    return false;
  }
};
