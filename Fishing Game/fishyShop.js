const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE_ACCENT = 0xffffff;
const BUTTON_SECONDARY = 2;
const ITEMS_PER_PAGE = 6;
const ITEM_PNG_DIR = path.join(__dirname, '..', 'Fishing Game', 'Item Png');
const FISH_COIN = '<:CRFishCoin:1506701069990891751>';

const RARITY_EMOJI = {
  common: '<:SBCommon:1506965202585780274>',
  uncommon: '<:SBUncommon:1506965215743447040>',
  rare: '<:SBRare:1506965211607994461>',
  epic: '<:SBEpic:1506965204624474153>',
  legendary: '<:SBLegendary:1506965206197207131>',
  mythical: '<:SBMythical:1506965209271762954>',
  secret: '<:SBSecret:1506965213881307186>'
};

// We need to load items dynamically from fishingFeature.js or fishingStore to get actual market values
const { ITEMS: FISHING_ITEMS, FISH_BY_ID } = require('./fishingFeature');
const { getMarketSnapshot } = require('../src/fishingStore');

function getStoreItems() {
  const allItems = { ...FISHING_ITEMS };
  // Only items with price/value that are gear/tool or usable might be shown
  return Object.values(allItems).filter(item => !item.unsellable && item.id !== 'wooden_fishing_rod');
}

function getCurrentRestockWindow() {
  const msInHour = 60 * 60 * 1000;
  const now = Date.now();
  const utc7 = now + (7 * msInHour);
  const hourPart = Math.floor(utc7 / msInHour) * msInHour;
  const minutes = Math.floor((utc7 % msInHour) / 60000);
  let slot = 0;
  if (minutes >= 40) slot = 40;
  else if (minutes >= 20) slot = 20;
  return hourPart + (slot * 60000);
}

// In-memory stock storage (ideally we use a json DB, but keeping it simple here per user's system)
const userStocks = new Map();

function getUserStock(userId) {
  const currentWindow = getCurrentRestockWindow();

  if (!userStocks.has(userId) || userStocks.get(userId).window !== currentWindow) {
    // Generate new stock
    const newStock = {};
    const items = getStoreItems();

    for (const item of items) {
      if (item.id === 'bamboo_fishing_rod' || item.id === 'steel_fishing_rod') {
        const roll = Math.random() * 100;
        if (roll < 80) newStock[item.id] = 1;
        else if (roll < 99) newStock[item.id] = 2;
        else newStock[item.id] = 3;
      } else if (item.id === 'carbon_fishing_rod') {
        const roll = Math.random() * 100;
        if (roll < 15) newStock[item.id] = 0;
        else if (roll < 80) newStock[item.id] = 1; // 15 + 65
        else if (roll < 99) newStock[item.id] = 2; // 80 + 19
        else newStock[item.id] = 3;
      } else {
        // Generic stock for other items
        newStock[item.id] = Math.floor(Math.random() * 5) + 1;
      }
    }

    userStocks.set(userId, { window: currentWindow, stock: newStock });
  }

  return userStocks.get(userId).stock;
}

function decrementUserStock(userId, itemId, amount) {
  const stock = getUserStock(userId);
  if ((stock[itemId] || 0) < amount) return false;
  stock[itemId] -= amount;
  return true;
}

function msUntilNextRestock() {
  const msInHour = 60 * 60 * 1000;
  const now = Date.now();
  const utc7 = now + (7 * msInHour);
  const minutes = Math.floor((utc7 % msInHour) / 60000);
  let nextMinute = 0;
  if (minutes < 20) nextMinute = 20;
  else if (minutes < 40) nextMinute = 40;
  else nextMinute = 60;

  const msToNext = (nextMinute - minutes) * 60000 - (utc7 % 60000);
  return msToNext;
}

function getCountdownString() {
  const ms = msUntilNextRestock();
  const timestamp = Math.floor((Date.now() + ms) / 1000);
  return `<t:${timestamp}:R>`;
}

function parseCustomEmoji(emoji) {
  if (!emoji) return null;
  const match = String(emoji).match(/<a?:([a-zA-Z0-9_]+):(\d+)>/);
  if (!match) return null;
  return { name: match[1], id: match[2], animated: emoji.startsWith('<a:') };
}

function emojiImageUrl(emoji) {
  const parsed = parseCustomEmoji(emoji);
  if (!parsed) return null;
  return `https://cdn.discordapp.com/emojis/${parsed.id}.${parsed.animated ? 'gif' : 'png'}?quality=lossless`;
}

async function drawCustomEmoji(ctx, emoji, x, y, size) {
  const url = emojiImageUrl(emoji);
  if (!url) return false;
  try {
    const img = await loadImage(url);
    ctx.drawImage(img, x, y, size, size);
    return true;
  } catch (e) {
    return false;
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function fitText(ctx, text, maxWidth, baseSize, weight = '700') {
  let size = baseSize;
  do {
    ctx.font = `${weight} ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  } while (size >= 16);
  return size;
}

async function createGalleryImage(itemsOnPage, pageIndex) {
  const width = 900;
  const height = 600;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#181820';
  ctx.fillRect(0, 0, width, height);

  const cols = 3;
  const rows = 2;
  const gap = 24;
  const cardWidth = (width - gap * (cols + 1)) / cols;
  const cardHeight = (height - gap * (rows + 1)) / rows;

  for (let i = 0; i < itemsOnPage.length; i++) {
    const item = itemsOnPage[i];
    const x = gap + (i % cols) * (cardWidth + gap);
    const y = gap + Math.floor(i / cols) * (cardHeight + gap);
    const rarityEmoji = RARITY_EMOJI[item.rarity];

    // Card background
    ctx.fillStyle = '#292936';
    roundRect(ctx, x, y, cardWidth, cardHeight, 18);
    ctx.fill();
    ctx.strokeStyle = '#5a5a70';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Soft top shine
    const gradient = ctx.createLinearGradient(x, y, x, y + cardHeight);
    gradient.addColorStop(0, 'rgba(255,255,255,0.08)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = gradient;
    roundRect(ctx, x + 3, y + 3, cardWidth - 6, cardHeight - 6, 15);
    ctx.fill();

    // Rarity badge uses the rarity emoji as an image, not text.
    ctx.fillStyle = '#1e1e29';
    roundRect(ctx, x + cardWidth - 52, y + 12, 36, 36, 12);
    ctx.fill();
    const drewRarity = await drawCustomEmoji(ctx, rarityEmoji, x + cardWidth - 46, y + 18, 24);
    if (!drewRarity) {
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('★', x + cardWidth - 34, y + 39);
    }

    // Title fits inside the card so long names do not overlap cards.
    const titleMaxWidth = cardWidth - 78;
    const titleSize = fitText(ctx, item.name, titleMaxWidth, 25, '800');
    ctx.font = `800 ${titleSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f6f6ff';
    ctx.fillText(item.name, x + cardWidth / 2 - 10, y + 38);

    // Item image
    let foundPath = null;
    if (fs.existsSync(ITEM_PNG_DIR)) {
      for (const file of fs.readdirSync(ITEM_PNG_DIR)) {
        if (file.toLowerCase().includes(item.id.replace(/_/g, '').toLowerCase())) {
          foundPath = path.join(ITEM_PNG_DIR, file);
          break;
        }
      }
    }

    try {
      if (foundPath) {
        const img = await loadImage(foundPath);
        ctx.drawImage(img, x + cardWidth / 2 - 58, y + 66, 116, 116);
      } else {
        const emojiCleaned = (item.emoji || '?').replace(/<:[a-zA-Z0-9_]+:[0-9]+>/g, '?');
        ctx.font = '56px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(emojiCleaned, x + cardWidth / 2, y + 135);
      }
    } catch (e) {
      // Ignore item image failures so the shop still renders.
    }

    // Price row with fish coin emoji drawn as an image next to the value.
    const priceText = `${item.currentValue || item.value}`;
    ctx.font = '700 23px sans-serif';
    const labelWidth = ctx.measureText('Price: ').width;
    const valueWidth = ctx.measureText(priceText).width;
    const coinSize = 35;
    const priceRowWidth = labelWidth + valueWidth + 8 + coinSize;
    const priceX = x + cardWidth / 2 - priceRowWidth / 2;
    const priceY = y + cardHeight - 58;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#c9c9d4';
    ctx.fillText('Price: ', priceX, priceY + 21);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(priceText, priceX + labelWidth, priceY + 21);
    const drewCoin = await drawCustomEmoji(ctx, FISH_COIN, priceX + labelWidth + valueWidth + 8, priceY, coinSize);
    if (!drewCoin) {
      ctx.font = '22px sans-serif';
      ctx.fillText('🪙', priceX + labelWidth + valueWidth + 8, priceY + 22);
    }

    // Stock pill
    const stockText = `Stock: ${item.stockAmount}`;
    ctx.font = '600 18px sans-serif';
    const stockWidth = ctx.measureText(stockText).width + 24;
    ctx.fillStyle = '#20202a';
    roundRect(ctx, x + cardWidth / 2 - stockWidth / 2, y + cardHeight - 35, stockWidth, 24, 12);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = item.stockAmount > 0 ? '#aeb0bd' : '#ff9a9a';
    ctx.fillText(stockText, x + cardWidth / 2, y + cardHeight - 17);
  }

  return canvas.toBuffer('image/png');
}

function containerPayload(accent, innerComponents, files = []) {
  return { flags: COMPONENTS_V2_FLAG, files, components: [{ type: 17, accent_color: accent, components: innerComponents.filter(Boolean) }] };
}

function separator() { return { type: 14, divider: true, spacing: 1 }; }

async function renderShopPage(userId, username, page = 1) {
  const storeItems = getStoreItems();
  const market = getMarketSnapshot(); // Ensure market update is applied
  const userStock = getUserStock(userId);

  const mappedItems = storeItems.map(item => {
    let currentValue = item.value;
    if (market && market.entries && market.entries[item.id]) {
      currentValue = market.entries[item.id].currentValue || item.value;
    }
    return { ...item, currentValue, stockAmount: userStock[item.id] || 0 };
  });

  const maxPage = Math.ceil(mappedItems.length / ITEMS_PER_PAGE);
  const safePage = Math.min(Math.max(Number(page) || 1, 1), Math.max(maxPage, 1));
  const pagedItems = mappedItems.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  const buffer = await createGalleryImage(pagedItems, safePage);
  const attachment = new AttachmentBuilder(buffer, { name: 'shop.png' });

  const content = `## Welcome ${username} to Fishy Shop!\n-# Restock: ${getCountdownString()}`;

  const switchPageBtn = {
    type: 1,
    components: [{
      type: BUTTON_SECONDARY,
      custom_id: `fishyshop:page:${userId}:${safePage}:${maxPage}`,
      label: 'switch page',
      style: 2,
      disabled: maxPage <= 1
    }]
  };

  const selectMenu = {
    type: 1,
    components: [{
      type: 3,
      custom_id: `fishyshop:select:${userId}`,
      placeholder: 'Select an item to purchase',
      min_values: 1,
      max_values: 1,
      options: pagedItems.map(item => {
        const rarityStr = RARITY_EMOJI[item.rarity] || '';
        const match = rarityStr.match(/<:([^:]+):(\d+)>/);
        const emoji = match ? { name: match[1], id: match[2] } : undefined;
        return {
          label: item.name,
          value: item.id,
          description: `Price: ${item.currentValue} FC`,
          emoji: emoji
        };
      })
    }]
  };

  return containerPayload(WHITE_ACCENT, [
    { type: 10, content },
    { type: 12, items: [{ media: { url: `attachment://shop.png` } }] },
    separator(),
    switchPageBtn,
    selectMenu
  ], [attachment]);
}

const fishyShopCommand = {
  data: new SlashCommandBuilder()
    .setName('fishy-shop')
    .setDescription('Open the Fishy Shop'),
  suppressCommandLog: true,
  disableActionTimeout: true,
  async execute(interaction) {
    const payload = await renderShopPage(interaction.user.id, interaction.user.username, 1);
    await interaction.reply(payload);
  },
  async handleInteraction(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith('fishyshop:')) return false;
    const parts = id.split(':');
    const action = parts[1];
    const userId = parts[2];

    if (interaction.user.id !== userId) {
      interaction.reply({ content: 'Only the command owner can use this.', flags: EPHEMERAL_FLAG }).catch(() => null);
      return true;
    }

    if (action === 'page' && interaction.isButton?.()) {
       // Open modal for page switch
       await interaction.showModal({
         custom_id: `fishyshop:pagesubmit:${userId}`,
         title: 'Switch page',
         components: [{
           type: 1,
           components: [{
             type: 4,
             custom_id: 'shop_page',
             label: 'Which page?',
             style: 1,
             required: true,
             placeholder: `1 - ${parts[4]}`,
             max_length: 3
           }]
         }]
       });
       return true;
    }

    if (action === 'pagesubmit' && interaction.isModalSubmit?.()) {
       const page = Number(interaction.fields?.getTextInputValue('shop_page')?.trim() || 1);
       const payload = await renderShopPage(userId, interaction.user.username, page);
       if (typeof interaction.update === 'function') await interaction.update(payload);
       else { await interaction.deferUpdate(); await interaction.message?.edit(payload); }
       return true;
    }

    if (action === 'select' && interaction.isStringSelectMenu?.()) {
       const itemId = interaction.values?.[0];
       const currentStock = getUserStock(userId)[itemId] || 0;

       if (currentStock <= 0) {
         await interaction.reply({ content: 'This item is out of stock.', flags: EPHEMERAL_FLAG });
         return true;
       }

       // Open modal for quantity
       await interaction.showModal({
         custom_id: `fishyshop:buysubmit:${userId}:${itemId}`,
         title: 'Buy Item',
         components: [{
           type: 1,
           components: [{
             type: 4,
             custom_id: 'buy_amount',
             label: 'How much do you want to buy?',
             style: 1,
             required: true,
             placeholder: `1 - ${currentStock}`,
             max_length: 5
           }]
         }]
       });
       return true;
    }

    if (action === 'buysubmit' && interaction.isModalSubmit?.()) {
       const itemId = parts[3];
       const amountStr = interaction.fields?.getTextInputValue('buy_amount')?.trim() || '1';
       const amount = parseInt(amountStr, 10);

       const currentStock = getUserStock(userId)[itemId] || 0;

       if (isNaN(amount) || amount < 1 || amount > currentStock) {
         await interaction.reply({ content: 'Invalid amount or not enough stock.', flags: EPHEMERAL_FLAG });
         return true;
       }

       // Handle buy logic
       const storeItems = getStoreItems();
       const itemDef = storeItems.find(i => i.id === itemId);
       if (!itemDef) {
         await interaction.reply({ content: 'Item not found in shop', flags: EPHEMERAL_FLAG });
         return true;
       }

       const market = getMarketSnapshot();
       const currentPrice = market?.entries?.[itemId]?.currentValue || itemDef.value;
       const totalCost = currentPrice * amount;

       const { getUser, updateUser } = require('./fishingFeature');
       const { recordMarketBuy, addInventoryItem } = require('../src/fishingStore');

       let success = false;
       updateUser(userId, (user) => {
         if (user.fishCoins >= totalCost) {
           user.fishCoins -= totalCost;
           success = true;
         }
         return user;
       });

       if (!success) {
         await interaction.reply({ content: `You don't have enough Fish Coins to buy ${amount}x ${itemDef.name}. Need ${totalCost} Fish Coins.`, flags: EPHEMERAL_FLAG });
         return true;
       }

       addInventoryItem(userId, itemId, amount);
       decrementUserStock(userId, itemId, amount);

       try {
         recordMarketBuy(itemId, amount);
       } catch (e) {
         // ignore if recordMarketBuy not perfectly aligned
       }

       await interaction.reply({ content: `Successfully bought ${amount}x ${itemDef.name} for ${totalCost} Fish Coins!`, flags: EPHEMERAL_FLAG });
       return true;
    }

    return false;
  }
};

module.exports = {
  fishyShopCommand
};
