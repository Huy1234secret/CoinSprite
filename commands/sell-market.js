const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { PRCOIN, WHITE_ACCENT, GREEN_ACCENT, formatNumber } = require('../src/gamblingConfig');
const { addBalance } = require('../src/gamblingStore');
const { ITEM_BY_ID, getNextHourlyBoundaryUtcPlus7 } = require('../src/fishingConfig');
const { getInventoryEntries, getMarketSnapshot, recordMarketSell, removeInventoryItem, updateMarket } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const MARKET_CACHE_DIR = path.join(__dirname, '..', 'data', 'market-charts');
function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function ownerFromId(customId) { return String(customId || '').split(':')[2]; }
function nextUpdateLine() { const unix = Math.floor(getNextHourlyBoundaryUtcPlus7().getTime() / 1000); return `-# Value update <t:${unix}:R> (<t:${unix}:t> UTC+7)`; }
function parseAmount(raw) { const n = Math.floor(Number(String(raw || '').replace(/,/g, '').trim())); return Number.isFinite(n) ? n : 0; }
function userItemOptions(userId) { return getInventoryEntries(userId).filter((entry) => entry.amount > 0).slice(0, 25).map((entry) => ({ label: entry.item.name.slice(0, 100), value: entry.item.id, description: `Owned: ${entry.amount}`.slice(0, 100) })); }

function buildHomePayload(interaction) {
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE_ACCENT, components: [text(`## Welcome ${interaction.user} to Market!\n* Select an action`), separator(), { type: 1, components: [{ type: 3, custom_id: `market:action:${interaction.user.id}`, placeholder: 'Actions', min_values: 1, max_values: 1, options: [{ label: 'Check value', value: 'check', emoji: { name: '📊' }, description: 'Check the current market value of an item' }, { label: 'Sell items', value: 'sell', emoji: { name: '💲' }, description: 'sell your items' }] }] }] }] };
}

function ensureChartDir() { fs.mkdirSync(MARKET_CACHE_DIR, { recursive: true }); }
function drawMarketChart(itemId) {
  ensureChartDir();
  const item = ITEM_BY_ID[itemId];
  const market = getMarketSnapshot(itemId);
  const points = ((market.history || []).slice(-24));
  if (!points.length) points.push({ t: Date.now(), buy: market.buyPrice, sell: market.sellPrice });
  const canvas = createCanvas(900, 420);
  const ctx = canvas.getContext('2d');
  const width = 900, height = 420, padding = 60, plotTop = 100, plotHeight = height - 155, plotWidth = width - (padding * 2);
  ctx.fillStyle = '#111214'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 28px sans-serif'; ctx.fillText(`${item?.name || itemId} Market Value`, padding, 44);
  ctx.font = '16px sans-serif'; ctx.fillText('Buy Price Line', padding, 75); ctx.fillText('Sell Price Line', padding + 170, 75);
  const values = points.flatMap((point) => [point.buy, point.sell]);
  const min = Math.min(...values, 1), max = Math.max(...values, min + 1), span = Math.max(1, max - min);
  ctx.strokeStyle = '#3a3c42'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) { const y = plotTop + ((plotHeight / 4) * i); ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(padding + plotWidth, y); ctx.stroke(); ctx.fillStyle = '#b5bac1'; ctx.fillText(formatNumber(max - ((span / 4) * i)), 8, y + 5); }
  function xy(point, index, key) { return { x: padding + (points.length <= 1 ? plotWidth : (plotWidth * index) / (points.length - 1)), y: plotTop + plotHeight - (((point[key] - min) / span) * plotHeight) }; }
  function drawLine(key, stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 4; ctx.beginPath(); points.forEach((point, index) => { const pos = xy(point, index, key); if (index === 0) ctx.moveTo(pos.x, pos.y); else ctx.lineTo(pos.x, pos.y); }); ctx.stroke(); ctx.fillStyle = stroke; points.forEach((point, index) => { const pos = xy(point, index, key); ctx.beginPath(); ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2); ctx.fill(); }); }
  drawLine('buy', '#57f287'); drawLine('sell', '#fee75c');
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(padding, plotTop, plotWidth, plotHeight);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(`Current Buy: ${formatNumber(market.buyPrice)} ${PRCOIN}`, padding, height - 38); ctx.fillText(`Current Sell: ${formatNumber(market.sellPrice)} ${PRCOIN}`, padding + 360, height - 38);
  const filePath = path.join(MARKET_CACHE_DIR, `market-${itemId}-${Date.now()}.png`);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  return new AttachmentBuilder(filePath, { name: 'market-chart.png' });
}

async function buildCheckPayload(interaction, itemId = null) {
  updateMarket();
  const options = userItemOptions(interaction.user.id);
  const selectedId = itemId || options[0]?.value || 'fishing_rod';
  const item = ITEM_BY_ID[selectedId];
  const market = getMarketSnapshot(selectedId);
  const selectOptions = options.length ? options.map((option) => ({ ...option, default: option.value === selectedId })) : [{ label: item?.name || 'Fishing rod', value: selectedId, description: 'No owned items found', default: true }];
  return { flags: COMPONENTS_V2_FLAG, files: [drawMarketChart(selectedId)], components: [{ type: 17, accent_color: WHITE_ACCENT, components: [text(`## Welcome ${interaction.user} to Market's Value Checker\n-# Select an item to check it value\n${nextUpdateLine()}\n-# Buy: ${formatNumber(market.buyPrice)} ${PRCOIN} • Sell: ${formatNumber(market.sellPrice)} ${PRCOIN}`), { type: 12, items: [{ media: { url: 'attachment://market-chart.png' } }] }, separator(), { type: 1, components: [{ type: 3, custom_id: `market:item:${interaction.user.id}`, placeholder: 'Select item', min_values: 1, max_values: 1, options: selectOptions }] }, row(button(`market:back:${interaction.user.id}`, 'Back', 2, false))] }] };
}

function buildSellChooserPayload(interaction) {
  const options = userItemOptions(interaction.user.id);
  const components = [text(`## Welcome ${interaction.user} to Market Selling\n-# Select an item you want to sell\n${nextUpdateLine()}`), separator()];
  if (!options.length) components.push(text('-# You do not have any sellable items.'));
  else components.push({ type: 1, components: [{ type: 3, custom_id: `market:sellselect:${interaction.user.id}`, placeholder: 'Select item to sell', min_values: 1, max_values: 1, options }] });
  components.push(row(button(`market:back:${interaction.user.id}`, 'Back', 2, false)));
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE_ACCENT, components }] };
}

async function showSellModal(interaction, itemId) {
  const entry = getInventoryEntries(interaction.user.id).find((x) => x.item.id === itemId);
  if (!entry || entry.amount <= 0) { await interaction.reply({ content: 'You do not own that item anymore.', flags: EPHEMERAL_FLAG }); return; }
  const item = ITEM_BY_ID[itemId]; const market = getMarketSnapshot(itemId);
  const modal = new ModalBuilder().setCustomId(`marketmodal:${interaction.user.id}:${itemId}`).setTitle(`Sell ${item.name}`).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('How many do you want to sell?').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(8).setPlaceholder(`Owned: ${entry.amount} • Each: ${formatNumber(market.sellPrice)}`)));
  await interaction.showModal(modal);
}

module.exports = {
  data: new SlashCommandBuilder().setName('sell-market').setDescription('Check item market values or sell items'),
  async init() { updateMarket(); },
  async execute(interaction) { await interaction.reply(buildHomePayload(interaction)); },
  async handleInteraction(interaction) {
    if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith('market:action:')) {
      if (ownerFromId(interaction.customId) !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own market controls.', flags: EPHEMERAL_FLAG }); return true; }
      if (interaction.values?.[0] === 'check') { await interaction.deferUpdate(); await interaction.editReply(await buildCheckPayload(interaction)); return true; }
      await interaction.update(buildSellChooserPayload(interaction)); return true;
    }
    if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith('market:item:')) {
      if (ownerFromId(interaction.customId) !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own market controls.', flags: EPHEMERAL_FLAG }); return true; }
      await interaction.deferUpdate(); await interaction.editReply(await buildCheckPayload(interaction, interaction.values?.[0])); return true;
    }
    if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith('market:sellselect:')) {
      if (ownerFromId(interaction.customId) !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own market controls.', flags: EPHEMERAL_FLAG }); return true; }
      await showSellModal(interaction, interaction.values?.[0]); return true;
    }
    if (interaction.isButton?.() && interaction.customId?.startsWith('market:back:')) {
      if (ownerFromId(interaction.customId) !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own market controls.', flags: EPHEMERAL_FLAG }); return true; }
      await interaction.update(buildHomePayload(interaction)); return true;
    }
    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('marketmodal:')) {
      const [, ownerId, itemId] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own market controls.', flags: EPHEMERAL_FLAG }); return true; }
      const item = ITEM_BY_ID[itemId]; const amount = parseAmount(interaction.fields.getTextInputValue('amount'));
      if (!item || amount <= 0) { await interaction.reply({ content: 'Please enter a valid amount.', flags: EPHEMERAL_FLAG }); return true; }
      const owned = getInventoryEntries(interaction.user.id).find((entry) => entry.item.id === itemId)?.amount || 0;
      if (owned < amount) { await interaction.reply({ content: `You only own ×${owned} ${item.name}.`, flags: EPHEMERAL_FLAG }); return true; }
      const market = getMarketSnapshot(itemId); const total = market.sellPrice * amount;
      if (!removeInventoryItem(interaction.user.id, itemId, amount)) { await interaction.reply({ content: 'That item is no longer available in your inventory.', flags: EPHEMERAL_FLAG }); return true; }
      addBalance(interaction.user.id, total); recordMarketSell(itemId, amount);
      await interaction.reply({ flags: COMPONENTS_V2_FLAG | EPHEMERAL_FLAG, components: [{ type: 17, accent_color: GREEN_ACCENT, components: [text(`Sold ×${amount} ${item.name} ${item.emoji || ''} for ${formatNumber(total)} ${PRCOIN}.`)] }] });
      return true;
    }
    return false;
  },
};
