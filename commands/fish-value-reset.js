const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { FISH, FISH_BY_ID } = require('../Fishing Game/Data/FishData');
const { ITEMS } = require('../Fishing Game/Data/Item Data');
const { resetMarketValue } = require('../Fishing Game/fishyMarket');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const FISH_COIN = '<:CRFishCoin:1506701069990891751>';

function fishChoices() {
  return FISH.map((fish) => ({
    name: fish.displayName || fish.name,
    value: fish.id,
  })).slice(0, 25);
}

function itemChoices() {
  return Object.values(ITEMS).map((item) => ({
    name: item.name,
    value: item.id,
  })).slice(0, 25);
}

function formatResetLine(type, id) {
  const entry = resetMarketValue(type, id);
  const name = type === 'fish'
    ? (FISH_BY_ID.get(id)?.displayName || FISH_BY_ID.get(id)?.name || id)
    : (ITEMS[id]?.name || id);
  return `- ${name}: reset to ${entry.currentValue} ${FISH_COIN}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fish-value-reset')
    .setDescription('Admin: reset fish or item market value back to base value')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option
      .setName('item')
      .setDescription('Item market value to reset')
      .setRequired(false)
      .addChoices(...itemChoices()))
    .addStringOption((option) => option
      .setName('fish')
      .setDescription('Fish market value to reset')
      .setRequired(false)
      .addChoices(...fishChoices())),
  suppressCommandLog: true,
  async execute(interaction) {
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Only administrators can reset fish market values.', flags: EPHEMERAL_FLAG });
      return;
    }

    const itemId = interaction.options.getString('item');
    const fishId = interaction.options.getString('fish');
    const lines = [];

    if (itemId && ITEMS[itemId]) lines.push(formatResetLine('item', itemId));
    if (fishId && FISH_BY_ID.has(fishId)) lines.push(formatResetLine('fish', fishId));

    await interaction.reply({
      content: lines.length
        ? `Reset market value to base value:\n${lines.join('\n')}`
        : 'Choose an item, a fish, or both to reset.',
      flags: EPHEMERAL_FLAG,
    });
  },
};
