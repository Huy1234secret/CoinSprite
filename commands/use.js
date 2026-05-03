const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GREEN_ACCENT, RED_ACCENT, WHITE_ACCENT, formatNumber } = require('../src/gamblingConfig');
const { ALL_COLLECTABLES, BUCKET_OF_WORMS_ID, WORM_ID, ITEM_BY_ID } = require('../src/fishingConfig');
const { getInventoryAmount, getInventoryEntries, useBucketOfWorms } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const USABLE_ITEMS = ALL_COLLECTABLES.filter((item) => item.usable);

function panel(content, ok = true) {
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: ok ? GREEN_ACCENT : RED_ACCENT, components: [{ type: 10, content }] }] };
}
function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function parseEmojiObject(emoji) { const match = String(emoji || '').match(/<a?:(\w+):(\d+)>/); return match ? { name: match[1], id: match[2] } : undefined; }
function itemEmoji(item) { return item?.emojiObject || parseEmojiObject(item?.emoji); }
function ownerFromId(customId) { return String(customId || '').split(':')[2]; }
function normalizeItemId(raw) {
  const value = String(raw || '').trim();
  if (USABLE_ITEMS.some((item) => item.id === value)) return value;
  return USABLE_ITEMS.find((item) => item.name.toLowerCase() === value.toLowerCase())?.id || value;
}
function usableOptions(userId) {
  const owned = new Set(getInventoryEntries(userId).filter((entry) => entry.amount > 0).map((entry) => entry.item.id));
  return USABLE_ITEMS.filter((item) => owned.has(item.id)).slice(0, 25).map((item) => ({ label: item.name.slice(0, 100), value: item.id, description: `Owned: ${formatNumber(getInventoryAmount(userId, item.id))}`.slice(0, 100), emoji: itemEmoji(item) }));
}
function chooserPayload(interaction) {
  const options = usableOptions(interaction.user.id);
  const components = [text(`## ${interaction.user} choose an item to use`), separator()];
  if (!options.length) components.push(text('-# You do not own any usable items.'));
  else components.push({ type: 1, components: [{ type: 3, custom_id: `use:item:${interaction.user.id}`, placeholder: 'Select item', min_values: 1, max_values: 1, options }] });
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE_ACCENT, components }] };
}
async function useItem(interaction, itemId, amount = 1, update = false) {
  if (itemId !== BUCKET_OF_WORMS_ID) {
    const reply = panel('That item cannot be used.', false);
    if (update && typeof interaction.update === 'function') await interaction.update(reply); else await interaction.reply(reply);
    return;
  }
  const result = useBucketOfWorms(interaction.user.id, amount);
  if (!result.ok) {
    const reply = panel(`You do not have enough Bucket of Worms. Missing ×${formatNumber(result.missing)}.`, false);
    if (update && typeof interaction.update === 'function') await interaction.update(reply); else await interaction.reply(reply);
    return;
  }
  const bucketLabel = `${ITEM_BY_ID[BUCKET_OF_WORMS_ID]?.emoji || ''} Bucket of Worms`.trim();
  const wormLabel = `${ITEM_BY_ID[WORM_ID]?.emoji || ''} Worms`.trim();
  const reply = panel(`Used ×${result.used} ${bucketLabel} and gained ×${formatNumber(result.gained)} ${wormLabel}.\n-# You now have ×${formatNumber(getInventoryAmount(interaction.user.id, WORM_ID))} ${wormLabel}.`);
  if (update && typeof interaction.update === 'function') await interaction.update(reply); else await interaction.reply(reply);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use a usable item')
    .addStringOption((option) => option.setName('item').setDescription('The item to use').setRequired(false).setAutocomplete(true))
    .addIntegerOption((option) => option.setName('amount').setDescription('Amount to use').setMinValue(1).setRequired(false)),

  async execute(interaction) {
    const rawItem = interaction.options.getString('item', false);
    if (!rawItem) { await interaction.reply(chooserPayload(interaction)); return; }
    await useItem(interaction, normalizeItemId(rawItem), Math.max(1, interaction.options.getInteger('amount') || 1));
  },

  async handleInteraction(interaction) {
    if (interaction.isAutocomplete?.() && interaction.commandName === 'use') {
      const focused = String(interaction.options.getFocused() || '').toLowerCase();
      await interaction.respond(USABLE_ITEMS.filter((item) => item.name.toLowerCase().includes(focused) || item.id.includes(focused)).slice(0, 25).map((item) => ({ name: item.name, value: item.id }))).catch(() => null);
      return true;
    }
    if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith('use:item:')) {
      if (ownerFromId(interaction.customId) !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own item menu.', flags: EPHEMERAL_FLAG }); return true; }
      await useItem(interaction, interaction.values?.[0], 1, true);
      return true;
    }
    return false;
  },
};
