const { MessageFlags } = require('discord.js');
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
function canUseEco(message) {
  if (!OWNER_IDS.size) return message.member?.permissions?.has?.('Administrator');
  return OWNER_IDS.has(message.author.id) || message.member?.permissions?.has?.('Administrator');
}

module.exports = {
  suppressCommandLog: true,
  async handleMessageCreate(message) {
    const content = String(message.content || '').trim();
    if (!/^!eco\s+/i.test(content)) return false;
    if (!canUseEco(message)) {
      await message.reply(panel('You do not have permission to use Eco admin commands.', false)).catch(() => null);
      return true;
    }
    const parts = content.split(/\s+/);
    const sub = String(parts[1] || '').toLowerCase();
    if (sub !== 'reset') {
      await message.reply(panel('Usage: `!Eco reset {item}`', false)).catch(() => null);
      return true;
    }
    const itemQuery = parts.slice(2).join(' ');
    const itemId = normalizeItemId(itemQuery);
    if (!itemId) {
      await message.reply(panel(`Could not find item: **${itemQuery || 'none'}**`, false)).catch(() => null);
      return true;
    }
    const market = resetMarketItem(itemId) || getMarketSnapshot(itemId);
    const item = ITEM_BY_ID[itemId];
    await message.reply(panel(`Reset market value for ${item.emoji || ''} **${item.name}**.\n-# Buy: ${formatNumber(market.buyPrice)} ${PRCOIN} • Sell: ${formatNumber(market.sellPrice)} ${PRCOIN}`)).catch(() => null);
    return true;
  },
};
