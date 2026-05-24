const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { ITEMS, updateUser } = require('./fishingFeature');
const { getMarketSnapshot, recordMarketBuy } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE = 0xffffff;
const BUTTON_SECONDARY = 2;
const ITEMS_PER_PAGE = 6;
const FISH_COIN = '<:CRFishCoin:1506701069990891751>';
const ITEM_PNG_DIR = path.join(__dirname, 'Item Png');
const RARITY_EMOJI = { common: '<:SBCommon:1506965202585780274>', uncommon: '<:SBUncommon:1506965215743447040>', rare: '<:SBRare:1506965211607994461>', epic: '<:SBEpic:1506965204624474153>', legendary: '<:SBLegendary:1506965206197207131>', mythical: '<:SBMythical:1506965209271762954>', secret: '<:SBSecret:1506965213881307186>' };
const userStocks = new Map();

function randomInt(min, max) { return Math.floor(Math.random() * ((max - min) + 1)) + min; }
function storeItems() { return Object.values(ITEMS).filter((item) => item.id !== 'wooden_fishing_rod' && !item.unsellable && Number(item.value) > 0); }
function restockWindow() { const now = Date.now(); const utc7 = now + 7 * 60 * 60 * 1000; const hour = Math.floor(utc7 / 3600000) * 3600000; const minute = Math.floor((utc7 % 3600000) / 60000); return hour + (minute >= 40 ? 40 : minute >= 20 ? 20 : 0) * 60000; }
function getUserStock(userId) { const window = restockWindow(); const cached = userStocks.get(userId); if (cached?.window === window) return cached.stock; const stock = {}; for (const item of storeItems()) { if (item.id === 'carbon_fishing_rod') stock[item.id] = Math.random() < 0.15 ? 0 : Math.random() < 0.8 ? 1 : 2; else if (item.type === 'Gear/Tool') stock[item.id] = Math.random() < 0.8 ? 1 : Math.random() < 0.95 ? 2 : 3; else stock[item.id] = randomInt(1, 5); } userStocks.set(userId, { window, stock }); return stock; }
function pageItems(items, page) { const maxPage = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE)); const safePage = Math.max(1, Math.min(maxPage, Math.floor(Number(page) || 1))); return { page: safePage, maxPage, items: items.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE) }; }
function cleanPayload(value) { if (Buffer.isBuffer(value) || value instanceof AttachmentBuilder) return value; if (Array.isArray(value)) return value.map(cleanPayload).filter((entry) => entry !== undefined); if (!value || typeof value !== 'object') return value; const out = {}; for (const [key, entry] of Object.entries(value)) if (entry !== undefined) out[key] = cleanPayload(entry); return out; }
function container(components, files = []) { const payload = cleanPayload({ flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE, components: components.filter(Boolean) }] }); if (files.length) payload.files = files; return payload; }
function row(components) { return { type: 1, components }; }
function button(customId, label, style = BUTTON_SECONDARY, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function priceFor(item) { const market = getMarketSnapshot(); return Math.max(1, Math.floor(Number(market?.entries?.[item.id]?.currentValue || market?.items?.[item.id]?.buyPrice || item.value || 1))); }
function restockCountdown() { return `<t:${Math.floor((restockWindow() + 20 * 60 * 1000) / 1000)}:R>`; }
function emojiUrl(emoji) { const match = String(emoji || '').match(/<a?:([A-Za-z0-9_]+):(\d+)>/); return match ? `https://cdn.discordapp.com/emojis/${match[2]}.${String(emoji).startsWith('<a:') ? 'gif' : 'png'}?quality=lossless` : null; }
async function drawEmoji(ctx, emoji, x, y, size) { const url = emojiUrl(emoji); if (!url) return false; try { ctx.drawImage(await loadImage(url), x, y, size, size); return true; } catch { return false; } }
function roundRect(ctx, x, y, width, height, radius) { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); }
function fitText(ctx, text, maxWidth, baseSize, weight = '800') { for (let size = baseSize; size >= 14; size -= 1) { ctx.font = `${weight} ${size}px sans-serif`; if (ctx.measureText(text).width <= maxWidth) return size; } return 14; }
function itemImagePath(item) { if (!fs.existsSync(ITEM_PNG_DIR)) return null; const wanted = String(item.id || '').replace(/_/g, '').toLowerCase(); for (const file of fs.readdirSync(ITEM_PNG_DIR)) { const name = path.basename(file, '.png').replace(/[^a-z0-9]/gi, '').toLowerCase(); if (path.extname(file).toLowerCase() === '.png' && name.includes(wanted)) return path.join(ITEM_PNG_DIR, file); } return null; }
function selectEmoji(emoji) { const match = String(emoji || '').match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/); return match ? { name: match[1], id: match[2], animated: String(emoji).startsWith('<a:') } : undefined; }

async function createShopImage(items) {
  const canvas = createCanvas(900, 600);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#181820'; ctx.fillRect(0, 0, 900, 600);
  const gap = 24;
  const cardWidth = (900 - gap * 4) / 3;
  const cardHeight = (600 - gap * 3) / 2;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const x = gap + (index % 3) * (cardWidth + gap);
    const y = gap + Math.floor(index / 3) * (cardHeight + gap);
    ctx.fillStyle = '#292936'; roundRect(ctx, x, y, cardWidth, cardHeight, 16); ctx.fill();
    ctx.strokeStyle = item.stock > 0 ? '#5a5a70' : '#573b44'; ctx.lineWidth = 3; ctx.stroke();
    await drawEmoji(ctx, RARITY_EMOJI[item.rarity], x + cardWidth - 46, y + 16, 28);
    ctx.font = `800 ${fitText(ctx, item.name, cardWidth - 74, 23)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#f6f6ff'; ctx.fillText(item.name, x + cardWidth / 2 - 10, y + 40);
    try { const imgPath = itemImagePath(item); if (imgPath) ctx.drawImage(await loadImage(imgPath), x + cardWidth / 2 - 54, y + 70, 108, 108); else await drawEmoji(ctx, item.emoji, x + cardWidth / 2 - 36, y + 86, 72); } catch {}
    const priceText = String(item.price); ctx.font = '700 22px sans-serif';
    const labelWidth = ctx.measureText('Price: ').width; const valueWidth = ctx.measureText(priceText).width; const coinSize = 31;
    const priceX = x + cardWidth / 2 - (labelWidth + valueWidth + 8 + coinSize) / 2; const priceY = y + cardHeight - 58;
    ctx.textAlign = 'left'; ctx.fillStyle = '#c9c9d4'; ctx.fillText('Price: ', priceX, priceY + 22); ctx.fillStyle = '#ffffff'; ctx.fillText(priceText, priceX + labelWidth, priceY + 22);
    if (!await drawEmoji(ctx, FISH_COIN, priceX + labelWidth + valueWidth + 8, priceY, coinSize)) ctx.fillText('FC', priceX + labelWidth + valueWidth + 8, priceY + 22);
    const stockText = `Stock: ${item.stock}`; ctx.font = '700 17px sans-serif'; const stockWidth = ctx.measureText(stockText).width + 24;
    ctx.fillStyle = '#20202a'; roundRect(ctx, x + cardWidth / 2 - stockWidth / 2, y + cardHeight - 30, stockWidth, 24, 12); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = item.stock > 0 ? '#aeb0bd' : '#ff9a9a'; ctx.fillText(stockText, x + cardWidth / 2, y + cardHeight - 12);
  }
  const buffer = await canvas.toBuffer('image/png');
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}
function grantShopInventoryItem(user, item, amount) { user.inventory = user.inventory && typeof user.inventory === 'object' ? user.inventory : {}; const entry = user.inventory[item.id] && typeof user.inventory[item.id] === 'object' ? user.inventory[item.id] : { amount: 0 }; entry.amount = Math.max(0, Math.floor(Number(entry.amount) || 0)) + amount; if (item.type === 'Gear/Tool' && item.durability !== null) { entry.durabilities = Array.isArray(entry.durabilities) ? entry.durabilities : []; for (let index = 0; index < amount; index += 1) entry.durabilities.push(item.durability); entry.durability = entry.durabilities[0] ?? item.durability; } else if (item.durability === null) entry.durability = null; user.inventory[item.id] = entry; }
async function renderShop(userId, username, page = 1, message = '') { const stock = getUserStock(userId); const mapped = storeItems().map((item) => ({ ...item, price: priceFor(item), stock: stock[item.id] || 0 })); const paged = pageItems(mapped, page); const attachment = new AttachmentBuilder(await createShopImage(paged.items), { name: 'fishy-shop.png' }); const options = paged.items.map((item) => ({ label: item.name, value: item.id, description: `${item.price} Fish Coins - Stock ${item.stock}`, ...(selectEmoji(item.emoji) ? { emoji: selectEmoji(item.emoji) } : {}) })); return container([{ type: 10, content: [`## Welcome ${username} to Fishy Shop!`, `-# Restock: ${restockCountdown()}`, message].filter(Boolean).join('\n') }, { type: 12, items: [{ media: { url: 'attachment://fishy-shop.png' } }] }, row([button(`fishyshop:page:${userId}:${paged.page}:${paged.maxPage}`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)]), options.length ? row([{ type: 3, custom_id: `fishyshop:select:${userId}:${paged.page}`, placeholder: 'Select an item to purchase', min_values: 1, max_values: 1, options }]) : null], [attachment]); }
async function updateReply(interaction, payload) { const clean = cleanPayload(payload); if (typeof interaction.update === 'function') return interaction.update(clean); await interaction.deferUpdate(); return interaction.message?.edit(clean); }
const fishyShopCommand = { data: new SlashCommandBuilder().setName('fishy-shop').setDescription('Open the Fishy Shop'), suppressCommandLog: true, disableActionTimeout: true, async execute(interaction) { await interaction.reply(await renderShop(interaction.user.id, interaction.user.username)); }, async handleInteraction(interaction) { const id = interaction.customId || ''; if (!id.startsWith('fishyshop:')) return false; const parts = id.split(':'); const action = parts[1]; const userId = parts[2]; if (interaction.user.id !== userId) { await interaction.reply({ content: 'Only the command owner can use this.', flags: EPHEMERAL_FLAG }).catch(() => null); return true; } if (action === 'page' && interaction.isButton?.()) { const maxPage = Math.max(1, Number(parts[4]) || 1); const nextPage = ((Number(parts[3]) || 1) % maxPage) + 1; await updateReply(interaction, await renderShop(userId, interaction.user.username, nextPage)); return true; } if (action === 'select' && interaction.isStringSelectMenu?.()) { const itemId = interaction.values?.[0]; const item = ITEMS[itemId]; const stock = getUserStock(userId); if (!item || (stock[itemId] || 0) <= 0) { await interaction.reply({ content: 'This item is out of stock.', flags: EPHEMERAL_FLAG }); return true; } const cost = priceFor(item); let ok = false; updateUser(userId, (user) => { if (user.fishCoins < cost) return user; user.fishCoins -= cost; grantShopInventoryItem(user, item, 1); ok = true; return user; }); if (!ok) { await interaction.reply({ content: `You do not have enough Fish Coins to buy ${item.name}.`, flags: EPHEMERAL_FLAG }); return true; } stock[itemId] -= 1; try { recordMarketBuy(itemId, 1); } catch {} await updateReply(interaction, await renderShop(userId, interaction.user.username, parts[3] || 1, `-# Bought 1 ${item.emoji} ${item.name} for ${cost} ${FISH_COIN}.`)); return true; } return false; } };
module.exports = { fishyShopCommand };