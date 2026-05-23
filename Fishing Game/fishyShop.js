const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { ITEMS, updateUser } = require('./fishingFeature');
const { getMarketSnapshot, recordMarketBuy } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE = 0xffffff;
const BUTTON_SECONDARY = 2;
const BUTTON_SUCCESS = 3;
const ITEMS_PER_PAGE = 6;
const FISH_COIN = '<:CRFishCoin:1506701069990891751>';

const userStocks = new Map();

function storeItems() {
  return Object.values(ITEMS).filter((item) => item.id !== 'wooden_fishing_rod' && !item.unsellable && Number(item.value) > 0);
}

function restockWindow() {
  const now = Date.now();
  const utc7 = now + 7 * 60 * 60 * 1000;
  const hour = Math.floor(utc7 / 3600000) * 3600000;
  const minute = Math.floor((utc7 % 3600000) / 60000);
  const slot = minute >= 40 ? 40 : minute >= 20 ? 20 : 0;
  return hour + slot * 60000;
}

function getUserStock(userId) {
  const window = restockWindow();
  const cached = userStocks.get(userId);
  if (cached?.window === window) return cached.stock;
  const stock = {};
  for (const item of storeItems()) {
    if (item.id === 'carbon_fishing_rod') stock[item.id] = Math.random() < 0.15 ? 0 : Math.random() < 0.8 ? 1 : 2;
    else if (item.type === 'Gear/Tool') stock[item.id] = Math.random() < 0.8 ? 1 : Math.random() < 0.95 ? 2 : 3;
    else stock[item.id] = randomInt(1, 5);
  }
  userStocks.set(userId, { window, stock });
  return stock;
}

function randomInt(min, max) { return Math.floor(Math.random() * ((max - min) + 1)) + min; }
function pageItems(items, page) { const maxPage = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE)); const safePage = Math.max(1, Math.min(maxPage, Math.floor(Number(page) || 1))); return { page: safePage, maxPage, items: items.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE) }; }
function container(components) { return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE, components: components.filter(Boolean) }] }; }
function row(components) { return { type: 1, components }; }
function button(customId, label, style = BUTTON_SECONDARY, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function priceFor(item) { const market = getMarketSnapshot(); return Math.max(1, Math.floor(Number(market?.entries?.[item.id]?.currentValue || item.value || 1))); }
function restockCountdown() { const now = Date.now(); const next = restockWindow() + 20 * 60 * 1000; return `<t:${Math.floor(next / 1000)}:R>`; }

function grantShopInventoryItem(user, item, amount) {
  user.inventory = user.inventory && typeof user.inventory === 'object' ? user.inventory : {};
  const entry = user.inventory[item.id] && typeof user.inventory[item.id] === 'object' ? user.inventory[item.id] : { amount: 0 };
  entry.amount = Math.max(0, Math.floor(Number(entry.amount) || 0)) + amount;
  if (item.type === 'Gear/Tool') {
    if (item.durability === null) {
      entry.durability = null;
      delete entry.durabilities;
    } else {
      entry.durabilities = Array.isArray(entry.durabilities) ? entry.durabilities : [];
      while (entry.durabilities.length < entry.amount - amount) entry.durabilities.push(Math.max(0, Math.floor(Number(entry.durability ?? item.durability) || item.durability)));
      for (let index = 0; index < amount; index += 1) entry.durabilities.push(item.durability);
      entry.durability = entry.durabilities[0] ?? item.durability;
    }
  } else if (!Object.prototype.hasOwnProperty.call(entry, 'durability')) {
    entry.durability = item.durability ?? null;
  }
  user.inventory[item.id] = entry;
}

function renderShop(userId, username, page = 1, message = '') {
  const stock = getUserStock(userId);
  const mapped = storeItems().map((item) => ({ ...item, price: priceFor(item), stock: stock[item.id] || 0 }));
  const paged = pageItems(mapped, page);
  const lines = paged.items.map((item) => `### ${item.emoji} ${item.name}\n-# Price: ${item.price} ${FISH_COIN}\n-# Stock: ${item.stock}`).join('\n');
  const options = paged.items.map((item) => ({ label: item.name, value: item.id, description: `${item.price} Fish Coins - Stock ${item.stock}` }));
  return container([
    { type: 10, content: [`## Welcome ${username} to Fishy Shop!`, `-# Restock: ${restockCountdown()}`, message, lines || '-# No items in stock list.'].filter(Boolean).join('\n') },
    row([button(`fishyshop:page:${userId}:${paged.page}:${paged.maxPage}`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)]),
    options.length ? row([{ type: 3, custom_id: `fishyshop:select:${userId}:${paged.page}`, placeholder: 'Select an item to purchase', min_values: 1, max_values: 1, options }]) : null,
  ]);
}

async function updateReply(interaction, payload) { if (typeof interaction.update === 'function') return interaction.update(payload); await interaction.deferUpdate(); return interaction.message?.edit(payload); }

const fishyShopCommand = {
  data: new SlashCommandBuilder().setName('fishy-shop').setDescription('Open the Fishy Shop'),
  suppressCommandLog: true,
  disableActionTimeout: true,
  async execute(interaction) { await interaction.reply(renderShop(interaction.user.id, interaction.user.username)); },
  async handleInteraction(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith('fishyshop:')) return false;
    const parts = id.split(':');
    const action = parts[1];
    const userId = parts[2];
    if (interaction.user.id !== userId) { await interaction.reply({ content: 'Only the command owner can use this.', flags: EPHEMERAL_FLAG }).catch(() => null); return true; }
    if (action === 'page' && interaction.isButton?.()) { const maxPage = Math.max(1, Number(parts[4]) || 1); const nextPage = ((Number(parts[3]) || 1) % maxPage) + 1; await updateReply(interaction, renderShop(userId, interaction.user.username, nextPage)); return true; }
    if (action === 'select' && interaction.isStringSelectMenu?.()) {
      const itemId = interaction.values?.[0];
      const item = ITEMS[itemId];
      const stock = getUserStock(userId);
      if (!item || (stock[itemId] || 0) <= 0) { await interaction.reply({ content: 'This item is out of stock.', flags: EPHEMERAL_FLAG }); return true; }
      const cost = priceFor(item);
      let ok = false;
      updateUser(userId, (user) => { if (user.fishCoins < cost) return user; user.fishCoins -= cost; grantShopInventoryItem(user, item, 1); ok = true; return user; });
      if (!ok) { await interaction.reply({ content: `You do not have enough Fish Coins to buy ${item.name}.`, flags: EPHEMERAL_FLAG }); return true; }
      stock[itemId] -= 1;
      try { recordMarketBuy(itemId, 1); } catch {}
      await updateReply(interaction, renderShop(userId, interaction.user.username, parts[3] || 1, `-# Bought 1 ${item.emoji} ${item.name} for ${cost} ${FISH_COIN}.`));
      return true;
    }
    return false;
  },
};

module.exports = { fishyShopCommand };
