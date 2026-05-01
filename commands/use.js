const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GREEN_ACCENT, RED_ACCENT, formatNumber } = require('../src/gamblingConfig');
const { ALL_COLLECTABLES, BUCKET_OF_WORMS_ID, WORM_ID } = require('../src/fishingConfig');
const { getInventoryAmount, useBucketOfWorms } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const USABLE_ITEMS = ALL_COLLECTABLES.filter((item) => item.usable);

function panel(content, ok = true) {
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: ok ? GREEN_ACCENT : RED_ACCENT, components: [{ type: 10, content }] }] };
}

function normalizeItemId(raw) {
  const value = String(raw || '').trim();
  if (USABLE_ITEMS.some((item) => item.id === value)) return value;
  return USABLE_ITEMS.find((item) => item.name.toLowerCase() === value.toLowerCase())?.id || value;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use a usable item')
    .addStringOption((option) => option.setName('item').setDescription('The item to use').setRequired(true).setAutocomplete(true))
    .addIntegerOption((option) => option.setName('amount').setDescription('Amount to use').setMinValue(1).setRequired(false)),

  async execute(interaction) {
    const itemId = normalizeItemId(interaction.options.getString('item', true));
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    if (itemId !== BUCKET_OF_WORMS_ID) {
      await interaction.reply({ content: 'That item cannot be used.', flags: EPHEMERAL_FLAG });
      return;
    }
    const result = useBucketOfWorms(interaction.user.id, amount);
    if (!result.ok) {
      await interaction.reply(panel(`You do not have enough Bucket of Worms. Missing ×${formatNumber(result.missing)}.`, false));
      return;
    }
    await interaction.reply(panel(`Used ×${result.used} Bucket of Worms and gained ×${formatNumber(result.gained)} Worms.\n-# You now have ×${formatNumber(getInventoryAmount(interaction.user.id, WORM_ID))} Worms.`));
  },

  async handleInteraction(interaction) {
    if (!interaction.isAutocomplete?.() || interaction.commandName !== 'use') return false;
    const focused = String(interaction.options.getFocused() || '').toLowerCase();
    await interaction.respond(USABLE_ITEMS
      .filter((item) => item.name.toLowerCase().includes(focused) || item.id.includes(focused))
      .slice(0, 25)
      .map((item) => ({ name: `${item.name}`, value: item.id }))).catch(() => null);
    return true;
  },
};
