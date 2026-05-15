const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  CLOVER,
  LUCK_SHOP_ITEMS,
  buyItem,
  ensureFreshShop,
  getShopSnapshot,
  nextHourDate,
} = require('../src/luckShopStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const PREFIX = 'luckshop';
let restockScheduler = null;

function formatNumber(value) {
  return Math.floor(Number(value) || 0).toLocaleString('en-US');
}

function getSubmittedValue(interaction, customId) {
  if (typeof interaction.fields?.getTextInputValue === 'function') {
    try { return interaction.fields.getTextInputValue(customId); } catch { /* fall through */ }
  }
  return '';
}

function buildPayload() {
  const state = getShopSnapshot();
  const nextRestock = nextHourDate();
  const lines = ['## Luck Shop'];
  for (const item of LUCK_SHOP_ITEMS) {
    const stock = Math.max(0, Math.floor(Number(state.stock[item.id]) || 0));
    lines.push(
      `### ${item.name}`,
      `-# 📦Stock: ${formatNumber(stock)}`,
      `-# 💵Cost: ${formatNumber(item.cost)} ${CLOVER} clover token each`,
      ''
    );
  }
  lines.push(`-# Restocks: <t:${Math.floor(nextRestock.getTime() / 1000)}:R> (<t:${Math.floor(nextRestock.getTime() / 1000)}:T>)`);

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          { type: 10, content: lines.join('\n').trim() },
          {
            type: 1,
            components: LUCK_SHOP_ITEMS.slice(0, 5).map((item) => ({
              type: 2,
              custom_id: `${PREFIX}:buy:${item.id}`,
              label: `Buy ${item.name}`,
              style: 2,
              disabled: Math.max(0, Math.floor(Number(state.stock[item.id]) || 0)) <= 0,
            })),
          },
          {
            type: 1,
            components: LUCK_SHOP_ITEMS.slice(5).map((item) => ({
              type: 2,
              custom_id: `${PREFIX}:buy:${item.id}`,
              label: `Buy ${item.name}`,
              style: 2,
              disabled: Math.max(0, Math.floor(Number(state.stock[item.id]) || 0)) <= 0,
            })),
          },
        ],
      },
    ],
  };
}

function buildBuyModal(item) {
  return {
    custom_id: `${PREFIX}:modal:${item.id}`,
    title: `Buy ${item.name}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'quantity',
            label: 'How many do you want to buy?',
            style: 1,
            min_length: 1,
            max_length: 6,
            placeholder: '1',
            required: true,
          },
        ],
      },
    ],
  };
}

function scheduleRestock() {
  if (restockScheduler) clearTimeout(restockScheduler);
  const delay = Math.max(1_000, nextHourDate().getTime() - Date.now());
  restockScheduler = setTimeout(() => {
    ensureFreshShop();
    scheduleRestock();
  }, delay);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('luck-shop')
    .setDescription('Show the hourly luck roll shop.'),
  suppressCommandLog: true,

  async init() {
    ensureFreshShop();
    scheduleRestock();
  },

  async execute(interaction) {
    await interaction.reply(buildPayload());
  },

  async handleInteraction(interaction) {
    if (!interaction.customId?.startsWith(`${PREFIX}:`)) return false;

    if (interaction.isButton?.() && interaction.customId.startsWith(`${PREFIX}:buy:`)) {
      const itemId = interaction.customId.split(':')[2];
      const item = LUCK_SHOP_ITEMS.find((entry) => entry.id === itemId);
      if (!item) {
        await interaction.reply({ content: 'That shop item no longer exists.', flags: EPHEMERAL_FLAG });
        return true;
      }
      await interaction.showModal(buildBuyModal(item));
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId.startsWith(`${PREFIX}:modal:`)) {
      const itemId = interaction.customId.split(':')[2];
      const amount = Math.floor(Number(getSubmittedValue(interaction, 'quantity')) || 0);
      if (!Number.isInteger(amount) || amount <= 0) {
        await interaction.reply({ content: 'Enter a whole number greater than 0.', flags: EPHEMERAL_FLAG });
        return true;
      }
      const result = buyItem(interaction.user.id, itemId, amount);
      if (!result.ok) {
        const message = result.reason === 'stock'
          ? `Only **${formatNumber(result.stock)}** are currently in stock.`
          : result.reason === 'tokens'
            ? `You need **${formatNumber(result.cost)} ${CLOVER}** but only have **${formatNumber(result.balance)} ${CLOVER}**.`
            : 'I could not buy that item.';
        await interaction.reply({ content: message, flags: EPHEMERAL_FLAG });
        return true;
      }
      await interaction.reply({
        content: `Bought **${formatNumber(result.quantity)} ${result.item.name}** for **${formatNumber(result.cost)} ${CLOVER}**. Remaining balance: **${formatNumber(result.balance)} ${CLOVER}**.`,
        flags: EPHEMERAL_FLAG,
      });
      return true;
    }

    return false;
  },

  _test: { buildPayload },
};
