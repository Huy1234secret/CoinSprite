const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { PRCOIN, WHITE_ACCENT, formatNumber } = require('../src/gamblingConfig');
const { ITEM_BY_ID, getNextHourlyBoundaryUtcPlus7 } = require('../src/fishingConfig');
const { getInventoryEntries, getMarketSnapshot, updateMarket } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function ownerFromId(customId) { return String(customId || '').split(':')[2]; }
function nextUpdateLine() {
  const unix = Math.floor(getNextHourlyBoundaryUtcPlus7().getTime() / 1000);
  return `-# Value update <t:${unix}:R> (<t:${unix}:t> UTC+7)`;
}
function optionsFor(userId, selectedId) {
  const entries = getInventoryEntries(userId).filter((entry) => entry.amount > 0).slice(0, 25);
  if (!entries.length) {
    return [{ label: 'Fishing rod', value: 'fishing_rod', description: 'No owned items found', default: selectedId === 'fishing_rod' }];
  }
  return entries.map((entry) => ({
    label: entry.item.name.slice(0, 100),
    value: entry.item.id,
    description: `Owned: ${entry.amount}`.slice(0, 100),
    default: entry.item.id === selectedId,
  }));
}
function payload(interaction, itemId = null) {
  updateMarket();
  const choices = optionsFor(interaction.user.id, itemId || '');
  const selectedId = itemId || choices[0]?.value || 'fishing_rod';
  const item = ITEM_BY_ID[selectedId];
  const market = getMarketSnapshot(selectedId);
  const options = optionsFor(interaction.user.id, selectedId);
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: WHITE_ACCENT,
      components: [
        text([
          `## Welcome ${interaction.user} to Market's Value Checker`,
          `-# Selected: **${item?.name || selectedId}**`,
          nextUpdateLine(),
          `-# Buy: **${formatNumber(market.buyPrice)}** ${PRCOIN} | Sell: **${formatNumber(market.sellPrice)}** ${PRCOIN}`,
        ].join('\n')),
        separator(),
        { type: 1, components: [{ type: 3, custom_id: `market:item:${interaction.user.id}`, placeholder: 'Select item', min_values: 1, max_values: 1, options }] },
      ],
    }],
  };
}

module.exports = {
  data: new SlashCommandBuilder().setName('sell-market').setDescription('Check item market values'),
  async init() { updateMarket(); },
  async execute(interaction) { await interaction.reply(payload(interaction)); },
  async handleInteraction(interaction) {
    if (!interaction.isStringSelectMenu?.() || !interaction.customId?.startsWith('market:item:')) return false;
    if (ownerFromId(interaction.customId) !== interaction.user.id) {
      await interaction.reply({ content: 'You can only use your own market controls.', flags: EPHEMERAL_FLAG });
      return true;
    }
    await interaction.update(payload(interaction, interaction.values?.[0])).catch(() => null);
    return true;
  },
};
