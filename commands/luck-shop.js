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

function getSlotItem(slot) {
  return LUCK_SHOP_ITEMS.find((entry) => entry.id === slot?.itemId) || null;
}

function buildPayload() {
  const state = getShopSnapshot();
  const nextRestock = nextHourDate();
  const components = [{ type: 10, content: '## Luck Shop' }];

  for (const slot of state.slots || []) {
    const item = getSlotItem(slot);
    if (!item) continue;
    const stock = Math.max(0, Math.floor(Number(slot.stock) || 0));
    components.push({
      type: 9,
      components: [
        {
          type: 10,
          content: [
            `### ${item.name}`,
            `-# 📦Stock: ${formatNumber(stock)}`,
            `-# 💵Cost: ${formatNumber(item.cost)} ${CLOVER} clover token each`,
          ].join('\n'),
        },
      ],
      accessory: {
        type: 2,
        custom_id: `${PREFIX}:buy:${slot.id}`,
        label: 'Buy',
        style: 2,
        disabled: stock <= 0,
      },
    });
  }

  components.push({
    type: 10,
    content: `-# Restocks: <t:${Math.floor(nextRestock.getTime() / 1000)}:R> (<t:${Math.floor(nextRestock.getTime() / 1000)}:T>)`,
  });

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components,
      },
    ],
  };
}

function buildBuyModal(slot, item) {
  return {
    custom_id: `${PREFIX}:modal:${slot.id}`,
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
      const slotId = interaction.customId.split(':')[2];
      const state = getShopSnapshot();
      const slot = state.slots.find((entry) => entry.id === slotId);
      const item = getSlotItem(slot);
      if (!slot || !item) {
        await interaction.reply({ content: 'That shop item is no longer in the shop.', flags: EPHEMERAL_FLAG });
        return true;
      }
      await interaction.showModal(buildBuyModal(slot, item));
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId.startsWith(`${PREFIX}:modal:`)) {
      const slotId = interaction.customId.split(':')[2];
      const amount = Math.floor(Number(getSubmittedValue(interaction, 'quantity')) || 0);
      if (!Number.isInteger(amount) || amount <= 0) {
        await interaction.reply({ content: 'Enter a whole number greater than 0.', flags: EPHEMERAL_FLAG });
        return true;
      }
      const result = buyItem(interaction.user.id, slotId, amount);
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
