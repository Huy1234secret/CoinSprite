const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { PRCOIN, GREEN_ACCENT, RED_ACCENT, formatNumber } = require('../src/gamblingConfig');
const { ALL_COLLECTABLES, ITEM_BY_ID } = require('../src/fishingConfig');
const { getMarketSnapshot, resetMarketItem } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const OWNER_IDS = new Set((process.env.OWNER_IDS || process.env.OWNER_ID || '').split(',').map((id) => id.trim()).filter(Boolean));

function panel(content, ok = true) {
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: ok ? GREEN_ACCENT : RED_ACCENT, components: [{ type: 10, content }] }] };
}
function normalizeItemId(raw) {
  const query = String(raw || '').trim().toLowerCase();
  if (!query) return null;
  if (ITEM_BY_ID[query]) return query;
  return ALL_COLLECTABLES.find((item) => item.name.toLowerCase() === query || item.id.toLowerCase() === query)?.id
    || ALL_COLLECTABLES.find((item) => item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query))?.id
    || null;
}
function canUseEco(member, userId) {
  if (OWNER_IDS.has(userId)) return true;
  return member?.permissions?.has?.('Administrator');
}
async function resetMarketAndReply(target, itemQuery, member, userId) {
  if (!canUseEco(member, userId)) {
    await target.reply(panel('You do not have permission to use Eco admin commands.', false)).catch(() => null);
    return;
  }
  const itemId = normalizeItemId(itemQuery);
  if (!itemId) {
    await target.reply(panel(`Could not find item: **${itemQuery || 'none'}**`, false)).catch(() => null);
    return;
  }
  const market = resetMarketItem(itemId) || getMarketSnapshot(itemId);
  const item = ITEM_BY_ID[itemId];
  await target.reply(panel(`Reset market value for ${item.emoji || ''} **${item.name}**.\n-# Buy: ${formatNumber(market.buyPrice)} ${PRCOIN} • Sell: ${formatNumber(market.sellPrice)} ${PRCOIN}`)).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eco')
    .setDescription('Admin economy tools')
    .addSubcommand((sub) => sub.setName('reset').setDescription('Reset market value of an item').addStringOption((option) => option.setName('item').setDescription('Item name or ID').setRequired(true))),
  suppressCommandLog: true,
  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'reset') await resetMarketAndReply(interaction, interaction.options.getString('item', true), interaction.member, interaction.user.id);
  },
  async handleMessageCreate(message) {
    const content = String(message.content || '').trim();
    if (!/^!eco\s+/i.test(content)) return false;
    const parts = content.split(/\s+/);
    const sub = String(parts[1] || '').toLowerCase();
    if (sub !== 'reset') {
      await message.reply(panel('Usage: `!Eco reset {item}`', false)).catch(() => null);
      return true;
    }
    await resetMarketAndReply(message, parts.slice(2).join(' '), message.member, message.author.id);
    return true;
  },
};
