const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  LUCK_SHOP_ITEMS,
  activateInventoryBoost,
  getUserSnapshot,
} = require('../src/luckShopStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const PREFIX = 'rollsinv';

function formatNumber(value) {
  return Math.floor(Number(value) || 0).toLocaleString('en-US');
}

function getSubmittedValue(interaction, customId) {
  if (typeof interaction.fields?.getTextInputValue === 'function') {
    try { return interaction.fields.getTextInputValue(customId); } catch { /* fall through */ }
  }
  return '';
}

function buildInventoryPayload(user) {
  const snapshot = getUserSnapshot(user.id);
  const activeBoostText = snapshot.activeBoosts.length > 0
    ? `\n-# Active next-roll luck: ${formatNumber(snapshot.activeBoosts.reduce((total, boost) => total + boost.multiplier, 0))}x from ${formatNumber(snapshot.activeBoosts.length)} boost${snapshot.activeBoosts.length === 1 ? '' : 's'}`
    : '';

  const components = [
    { type: 10, content: `## ${user.username} role inventory${activeBoostText}` },
  ];

  for (const item of LUCK_SHOP_ITEMS) {
    const amount = Math.max(0, Math.floor(Number(snapshot.inventory[item.id]) || 0));
    components.push({
      type: 9,
      components: [
        {
          type: 10,
          content: [`### ${item.name}`, `-# 📦Amount: ${formatNumber(amount)}`].join('\n'),
        },
      ],
      accessory: {
        type: 2,
        custom_id: `${PREFIX}:use:${user.id}:${item.id}`,
        label: 'Use',
        style: 2,
        disabled: amount <= 0,
      },
    });
  }

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: 0xffffff, components }],
  };
}

function buildUseModal(ownerId, item, owned) {
  return {
    custom_id: `${PREFIX}:modal:${ownerId}:${item.id}`,
    title: `Use ${item.name}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'quantity',
            label: 'How many do you want to use?',
            style: 1,
            min_length: 1,
            max_length: 6,
            placeholder: String(Math.max(0, Math.floor(Number(owned) || 0))),
            required: true,
          },
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolls-inventory')
    .setDescription('Show and use your luck roll inventory.'),
  suppressCommandLog: true,

  async execute(interaction) {
    await interaction.reply(buildInventoryPayload(interaction.user));
  },

  async handleInteraction(interaction) {
    if (!interaction.customId?.startsWith(`${PREFIX}:`)) return false;

    if (interaction.isButton?.() && interaction.customId.startsWith(`${PREFIX}:use:`)) {
      const [, , ownerId, itemId] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'This inventory is not yours.', flags: EPHEMERAL_FLAG });
        return true;
      }
      const item = LUCK_SHOP_ITEMS.find((entry) => entry.id === itemId);
      if (!item) {
        await interaction.reply({ content: 'That inventory item no longer exists.', flags: EPHEMERAL_FLAG });
        return true;
      }
      const snapshot = getUserSnapshot(interaction.user.id);
      const owned = Math.max(0, Math.floor(Number(snapshot.inventory[item.id]) || 0));
      await interaction.showModal(buildUseModal(ownerId, item, owned));
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId.startsWith(`${PREFIX}:modal:`)) {
      const [, , ownerId, itemId] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'This inventory is not yours.', flags: EPHEMERAL_FLAG });
        return true;
      }
      const amount = Math.floor(Number(getSubmittedValue(interaction, 'quantity')) || 0);
      if (!Number.isInteger(amount) || amount <= 0) {
        await interaction.reply({ content: 'Enter a whole number greater than 0.', flags: EPHEMERAL_FLAG });
        return true;
      }
      const result = activateInventoryBoost(interaction.user.id, itemId, amount);
      if (!result.ok) {
        const message = result.reason === 'inventory'
          ? `You only have **${formatNumber(result.owned)} ${result.item.name}**.`
          : 'I could not use that item.';
        await interaction.reply({ content: message, flags: EPHEMERAL_FLAG });
        return true;
      }
      await interaction.reply({
        content: `Activated **${formatNumber(result.quantity)} ${result.item.name}** for your next roll. Added luck: **${formatNumber(result.activeMultiplier)}x**.`,
        flags: EPHEMERAL_FLAG,
      });
      return true;
    }

    return false;
  },

  _test: { buildInventoryPayload },
};
