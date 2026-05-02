const { SlashCommandBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { PRCOIN, JPCOIN, WHITE_ACCENT, formatNumber } = require('../src/gamblingConfig');
const { getBalance, spendBalance } = require('../src/gamblingStore');
const { ITEMS, ITEM_BY_ID, SHOP_TYPES, getNextHourlyBoundaryUtcPlus7 } = require('../src/fishingConfig');
const { addInventoryItem, decrementShopStock, getShopState, recordMarketBuy } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const ITEMS_PER_PAGE = 5;
function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function getOwner(customId) { return String(customId || '').split(':')[2]; }
function coinForShop(shopKey) { return shopKey === 'exclusive' ? JPCOIN : PRCOIN; }
function parseAmount(raw) { const n = Math.floor(Number(String(raw || '').replace(/,/g, '').trim())); return Number.isFinite(n) ? n : 0; }
function countdown() { const unix = Math.floor(getNextHourlyBoundaryUtcPlus7().getTime() / 1000); return `-# Restock <t:${unix}:R> (<t:${unix}:t> UTC+7)`; }
function getShopItems(shopKey) { return ITEMS.filter((item) => item.shop === shopKey && item.stockMin != null && item.stockMax != null); }

function buildShopPayload(interaction, shopKey = 'general', page = 0) {
  const userId = interaction.user.id;
  const shopStock = getShopState(interaction.user.id);
  const items = getShopItems(shopKey);
  const pages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const safePage = ((Number(page) || 0) % pages + pages) % pages;
  const shown = items.slice(safePage * ITEMS_PER_PAGE, (safePage * ITEMS_PER_PAGE) + ITEMS_PER_PAGE);
  const components = [text(`## Welcome ${interaction.user} to Shop\n${countdown()}`)];
  if (!shown.length) components.push(text('-# This shop has no stocked items yet.'));
  for (const item of shown) {
    const stock = Math.max(0, Math.floor(Number(shopStock?.[shopKey]?.[item.id]) || 0));
    components.push(text(`### ${item.name} ${item.emoji} - ${formatNumber(item.price)} ${coinForShop(shopKey)}\n-# ${item.description}\n-# 📦Stock: ${stock}`));
    components.push(row(button(`shop:buy:${userId}:${shopKey}:${item.id}`, 'BUY', stock > 0 ? 3 : 4, stock <= 0)));
  }
  components.push(separator());
  components.push(row(button(`shop:page:${userId}:${shopKey}:${safePage}:${pages}`, 'Switch page', 2, pages <= 1)));
  components.push({ type: 1, components: [{ type: 3, custom_id: `shop:switch:${userId}:${shopKey}:${safePage}`, placeholder: 'Switch shop', min_values: 1, max_values: 1, options: Object.entries(SHOP_TYPES).map(([key, config]) => ({ label: config.label, value: key, emoji: config.emoji, default: key === shopKey })) }] });
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE_ACCENT, components }] };
}



async function showPageModal(interaction, shopKey, currentPage, maxPage) {
  const modal = new ModalBuilder().setCustomId(`shop:pageform:${interaction.user.id}:${shopKey}:${currentPage}:${maxPage}`).setTitle('Switch shop page').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('page_input').setLabel('Which page u wanna switch to').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(6).setPlaceholder(`1-${maxPage}`)),
  );
  await interaction.showModal(modal);
}

async function showBuyModal(interaction, shopKey, itemId) {
  const stock = Math.max(0, Math.floor(Number(getShopState(interaction.user.id)?.[shopKey]?.[itemId]) || 0));
  const item = ITEM_BY_ID[itemId];
  if (!item || stock <= 0) { await interaction.reply({ content: 'That item is out of stock.', flags: EPHEMERAL_FLAG }); return; }
  const modal = new ModalBuilder().setCustomId(`shopmodal:${interaction.user.id}:${shopKey}:${itemId}`).setTitle(`Buy ${item.name}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('How many do you want to buy?').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(8).setPlaceholder(`Stock: ${stock}`)),
  );
  await interaction.showModal(modal);
}

module.exports = {
  data: new SlashCommandBuilder().setName('shop').setDescription('Open the rotating item shop'),
  async execute(interaction) { await interaction.reply(buildShopPayload(interaction, 'general', 0)); },
  async handleInteraction(interaction) {
    if (interaction.isButton?.() && interaction.customId?.startsWith('shop:')) {
      const parts = interaction.customId.split(':');
      if (getOwner(interaction.customId) !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own shop controls.', flags: EPHEMERAL_FLAG }); return true; }
      if (parts[1] === 'page') { await showPageModal(interaction, parts[3], Number(parts[4]) || 0, Math.max(1, Number(parts[5]) || 1)); return true; }
      if (parts[1] === 'buy') { await showBuyModal(interaction, parts[3], parts[4]); return true; }
      if (parts[1] === 'confirm') {
        const [, , , shopKey, itemId, rawAmount] = parts;
        const item = ITEM_BY_ID[itemId];
        const amount = Math.max(1, parseAmount(rawAmount));
        const total = item.price * amount;
        if (!decrementShopStock(interaction.user.id, shopKey, itemId, amount)) { await interaction.update({ content: 'That shop stock changed and there is not enough left.', components: [] }); return true; }
        if (!spendBalance(interaction.user.id, total)) { await interaction.update({ content: `You no longer have enough ${coinForShop(shopKey)} for this purchase.`, components: [] }); return true; }
        addInventoryItem(interaction.user.id, itemId, amount); recordMarketBuy(itemId, amount);
        await interaction.update({ content: `Purchased ×${amount} ${item.name} ${item.emoji} for ${formatNumber(total)} ${coinForShop(shopKey)}.`, components: [] });
        return true;
      }
    }
    if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith('shop:switch:')) {
      if (getOwner(interaction.customId) !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own shop controls.', flags: EPHEMERAL_FLAG }); return true; }
      await interaction.update(buildShopPayload(interaction, interaction.values?.[0] || 'general', 0)); return true;
    }
    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('shop:pageform:')) {
      const [, , , ownerId, shopKey, currentPage, maxPage] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own shop controls.', flags: EPHEMERAL_FLAG }); return true; }
      const asked = Number(interaction.fields.getTextInputValue('page_input'));
      const finalPage = Number.isFinite(asked) ? Math.min(Math.max(1, Math.floor(asked)), Math.max(1, Number(maxPage) || 1)) : (Number(currentPage) || 0) + 1;
      await interaction.reply(buildShopPayload(interaction, shopKey, finalPage - 1)); return true;
    }
    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('shopmodal:')) {
      const [, ownerId, shopKey, itemId] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only buy from your own shop prompt.', flags: EPHEMERAL_FLAG }); return true; }
      const item = ITEM_BY_ID[itemId];
      const amount = parseAmount(interaction.fields.getTextInputValue('amount'));
      if (!item || amount <= 0) { await interaction.reply({ content: 'Please enter a valid amount.', flags: EPHEMERAL_FLAG }); return true; }
      const stock = Math.max(0, Math.floor(Number(getShopState(interaction.user.id)?.[shopKey]?.[itemId]) || 0));
      if (amount > stock) { await interaction.reply({ content: `Only ${stock} ${item.name} ${item.emoji} are in stock.`, flags: EPHEMERAL_FLAG }); return true; }
      const total = item.price * amount;
      const balance = getBalance(interaction.user.id);
      if (balance < total) { await interaction.reply({ content: `You don't have enough to buy ×${amount} ${item.name} ${item.emoji}, you need ${formatNumber(total - balance)} ${coinForShop(shopKey)} more!`, flags: EPHEMERAL_FLAG }); return true; }
      await interaction.reply({ content: `Are you sure you wanna buy ×${amount} ${item.name} ${item.emoji} for ${formatNumber(total)} ${coinForShop(shopKey)}`, flags: EPHEMERAL_FLAG, components: [row(button(`shop:confirm:${interaction.user.id}:${shopKey}:${itemId}:${amount}`, 'Yes', 3, false))] });
      return true;
    }
    return false;
  },
};
