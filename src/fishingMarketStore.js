const fs = require('fs');
const path = require('path');
const { getBalance, spendBalance, addBalance } = require('./gamblingStore');

const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-market-store.json');
const PR = '<:prcoin:1498171678310174770>';

const ITEMS = {
  fishing_rod: { id: 'fishing_rod', name: 'Fishing rod', emoji: '<:ICFishingrod:1499589442518913296>', price: 10000, buyable: true, stockMin: 1, stockMax: 3, shop: 'general', rarity: 'common', usable: false, type: 'gear' },
  worm: { id: 'worm', name: 'Worm', emoji: '<:ICWorm:1499589444590768188>', price: 10000, buyable: false, shop: 'n/a', rarity: 'common', usable: false, type: 'ingredient' },
  bucket_worms: { id: 'bucket_worms', name: 'Bucket of Worms', emoji: '<:ICBucketofworms:1499589440362905740>', price: 3000, buyable: true, stockMin: 2, stockMax: 5, shop: 'general', rarity: 'common', usable: true, type: 'usable' },
};

function baseState() { return { users: {}, market: { lastUpdateHour: null, shopStock: {}, prices: {}, history: {} } }; }
function ensure() { if (!fs.existsSync(path.dirname(STORE_PATH))) fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true }); if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(baseState(), null, 2)); }
function load() { ensure(); try { return { ...baseState(), ...JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) }; } catch { return baseState(); } }
function save(s) { fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2)); }
function uid(s, userId) { if (!s.users[userId]) s.users[userId] = { inventory: {}, equippedRodDurability: 0, upgrades: { luck: 0, fishValue: 0, rodStrength: 0, durabilityTier: 0 } }; return s.users[userId]; }
function addItem(userId, itemId, amount) { const s = load(); const u = uid(s, userId); u.inventory[itemId] = (u.inventory[itemId] || 0) + amount; save(s); return u.inventory[itemId]; }
function removeItem(userId, itemId, amount) { const s = load(); const u = uid(s, userId); if ((u.inventory[itemId] || 0) < amount) return false; u.inventory[itemId] -= amount; if (u.inventory[itemId] <= 0) delete u.inventory[itemId]; save(s); return true; }
function getUser(userId) { const s = load(); return uid(s, userId); }
function getInventory(userId) { return getUser(userId).inventory; }
function hourKey(d = new Date()) { return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}-${d.getUTCHours()}`; }
function updateShopAndMarket() { const s = load(); const hk = hourKey(); if (s.market.lastUpdateHour === hk) return s; s.market.lastUpdateHour = hk; for (const item of Object.values(ITEMS)) { if (item.buyable) s.market.shopStock[item.id] = Math.floor(item.stockMin + Math.random() * (item.stockMax - item.stockMin + 1)); const base = item.price; const prev = s.market.prices[item.id]?.buy ?? base; const drift = Math.max(0.7, Math.min(1.5, 1 + ((Math.random() - 0.5) * 0.12))); const buy = Math.max(Math.floor(base * 0.5), Math.floor(prev * drift)); const sell = Math.max(1, Math.floor(buy * 0.9)); s.market.prices[item.id] = { buy, sell }; if (!s.market.history[item.id]) s.market.history[item.id] = []; s.market.history[item.id].push({ t: Date.now(), buy, sell }); s.market.history[item.id] = s.market.history[item.id].slice(-48); }
 save(s); return s; }
function buyItem(userId, itemId, qty) { const s = updateShopAndMarket(); const item = ITEMS[itemId]; if (!item?.buyable) return { ok: false, msg: 'Not buyable.' }; const stock = s.market.shopStock[itemId] || 0; if (qty > stock) return { ok: false, msg: `Stock only ${stock}.` }; const total = item.price * qty; if (!spendBalance(userId, total)) return { ok: false, msg: `Need ${total - getBalance(userId)} ${PR} more.` }; const u = uid(s, userId); u.inventory[itemId] = (u.inventory[itemId] || 0) + qty; s.market.shopStock[itemId] -= qty; save(s); return { ok: true, total }; }
module.exports = { ITEMS, PR, load, save, getUser, getInventory, addItem, removeItem, updateShopAndMarket, buyItem, getBalance, addBalance, spendBalance };
