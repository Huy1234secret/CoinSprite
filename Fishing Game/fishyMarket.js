const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const fishing = require('./fishingFeature');

const { ITEMS, FISH_BY_ID, getUser, updateUser, inventoryCommand, fishBarrelCommand } = fishing;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE = 0xffffff;
const BUTTON_SECONDARY = 2;
const BUTTON_DANGER = 4;
const FISH_COIN = '<:CRFishCoin:1506701069990891751>';
const PAGE_SIZE = 5;
const RARITY_EMOJI = { common: '<:SBCommon:1506965202585780274>', uncommon: '<:SBUncommon:1506965215743447040>', rare: '<:SBRare:1506965211607994461>', epic: '<:SBEpic:1506965204624474153>', legendary: '<:SBLegendary:1506965206197207131>', mythical: '<:SBMythical:1506965209271762954>', secret: '<:SBSecret:1506965213881307186>' };

function container(components) { return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: WHITE, components: components.filter(Boolean) }] }; }
function row(components) { return { type: 1, components }; }
function sep() { return { type: 14, divider: true, spacing: 1 }; }
function button(customId, label, style = BUTTON_SECONDARY, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function rarityLabel(rarity) { return RARITY_EMOJI[String(rarity || '').toLowerCase()] || ''; }
function pageItems(items, page) { const maxPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE)); const safePage = Math.max(1, Math.min(maxPage, Math.floor(Number(page) || 1))); return { page: safePage, maxPage, items: items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) }; }
function categorySelect(userId, selected = 'fish') { return row([{ type: 3, custom_id: `fm:category:${userId}`, placeholder: 'Select a category', min_values: 1, max_values: 1, options: [{ label: 'Sell-fish', value: 'fish', default: selected === 'fish' }, { label: 'Sell-item', value: 'item', default: selected === 'item' }] }]); }
function variantMultiplier(entry) { if (entry?.variant === 'Rainbow') return 5; if (entry?.variant === 'Golden') return 2; return 1; }
function mutationMultiplier(entry) { return entry?.mutation && String(entry.mutation).toLowerCase() !== 'none' ? Number(entry.mutationMultiplier) || 1 : 1; }
function fishValue(entry, fish) { const base = Number(entry.sellValue || fish.sellValue || fish.value || 1); return Math.max(1, Math.round(base * variantMultiplier(entry) * mutationMultiplier(entry))); }
function fishRecords(user) { return (Array.isArray(user.fishBarrel) ? user.fishBarrel : []).map((entry, index) => ({ entry, index, fish: FISH_BY_ID.get(entry.fishId) })).filter((record) => record.fish); }
function itemRecords(user) { return Object.entries(user.inventory || {}).map(([itemId, entry]) => ({ itemId, entry, item: ITEMS[itemId] })).filter((record) => record.item && Math.max(0, Math.floor(Number(record.entry?.amount) || 0)) > 0); }
function renderFishLine(record) { const value = fishValue(record.entry, record.fish); const mutation = record.entry.mutation ? `${record.entry.mutation} ${record.entry.mutationEmoji || ''}`.trim() : 'None'; return `### ${record.fish.emoji} ${record.fish.displayName || record.fish.name}\n-# Rarity: ${rarityLabel(record.fish.rarity)} - Weigh: ${Number(record.entry.weight || 0).toFixed(2)} kg\n-# Variant / Mutation: ${record.entry.variant || 'Normal'} ${record.entry.variantEmoji || ''} / ${mutation}\n-# Value: **${value} ${FISH_COIN}**`; }
function renderItemLine(record) { const amount = Math.max(0, Math.floor(Number(record.entry.amount) || 0)); const value = Math.max(1, Math.floor(Number(record.item.value || 1) * 0.25)); return `### x${amount} ${record.item.emoji} ${record.item.name}\n-# Rarity: ${rarityLabel(record.item.rarity)} - Type: ${record.item.type}\n-# Sell Value: **${value * amount} ${FISH_COIN}**`; }
function renderHome(userId) { return container([{ type: 10, content: '## Welcome to Fishy Market!\n-# Select a category.' }, sep(), categorySelect(userId)]); }
function renderFishMarket(userId, page = 1, message = '') { const user = getUser(userId); const paged = pageItems(fishRecords(user), page); const rows = [{ type: 10, content: ['## Fish Selling Market', message].filter(Boolean).join('\n') }]; for (const record of paged.items) rows.push({ type: 9, components: [{ type: 10, content: renderFishLine(record) }], accessory: button(`fm:sellfish:${userId}:${record.entry.id || record.index}:${paged.page}`, record.entry.locked ? 'Locked' : 'Sell', BUTTON_DANGER, Boolean(record.entry.locked)) }); if (!paged.items.length) rows.push({ type: 10, content: '-# No fish found.' }); rows.push(sep(), row([button(`fm:fishpage:${userId}:${paged.page}:${paged.maxPage}`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)]), categorySelect(userId, 'fish')); return container(rows); }
function renderItemMarket(userId, page = 1, message = '') { const user = getUser(userId); const paged = pageItems(itemRecords(user), page); const rows = [{ type: 10, content: ['## Item Selling Market', message].filter(Boolean).join('\n') }]; for (const record of paged.items) { const unsellable = record.item.unsellable || record.item.id === 'wooden_fishing_rod'; rows.push({ type: 9, components: [{ type: 10, content: renderItemLine(record) }], accessory: button(`fm:sellitem:${userId}:${record.itemId}:${paged.page}`, unsellable ? 'Unsellable' : 'Sell', unsellable ? BUTTON_SECONDARY : BUTTON_DANGER, unsellable) }); } if (!paged.items.length) rows.push({ type: 10, content: '-# No items found.' }); rows.push(sep(), row([button(`fm:itempage:${userId}:${paged.page}:${paged.maxPage}`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)]), categorySelect(userId, 'item')); return container(rows); }
function findFishIndex(user, key) { return (Array.isArray(user.fishBarrel) ? user.fishBarrel : []).findIndex((entry, index) => String(entry.id || index) === String(key)); }
function sellFish(userId, fishKey) { let message = '-# Fish not found.'; updateUser(userId, (user) => { const index = findFishIndex(user, fishKey); if (index < 0) return user; const entry = user.fishBarrel[index]; const fish = FISH_BY_ID.get(entry.fishId); if (!fish || entry.locked) { message = '-# That fish is locked.'; return user; } const value = fishValue(entry, fish); user.fishCoins = Math.max(0, Math.floor(Number(user.fishCoins) || 0)) + value; user.fishBarrel.splice(index, 1); message = `-# Sold ${fish.emoji} ${fish.displayName || fish.name} for ${value} ${FISH_COIN}.`; return user; }); return message; }
function sellItem(userId, itemId) { let message = '-# Item not found.'; updateUser(userId, (user) => { const item = ITEMS[itemId]; const entry = user.inventory?.[itemId]; const amount = Math.max(0, Math.floor(Number(entry?.amount) || 0)); if (!item || !entry || amount <= 0) return user; if (item.unsellable || item.id === 'wooden_fishing_rod') { message = '-# That item cannot be sold.'; return user; } const value = Math.max(1, Math.floor(Number(item.value || 1) * 0.25)) * amount; delete user.inventory[itemId]; user.fishCoins = Math.max(0, Math.floor(Number(user.fishCoins) || 0)) + value; message = `-# Sold x${amount} ${item.emoji} ${item.name} for ${value} ${FISH_COIN}.`; return user; }); return message; }
async function updateInteraction(interaction, payload) { if (typeof interaction.update === 'function') return interaction.update(payload); await interaction.deferUpdate(); return interaction.message?.edit(payload); }
function isOwner(interaction, userId) { if (interaction.user.id === userId) return true; interaction.reply({ content: 'Only the command owner can use this control.', flags: EPHEMERAL_FLAG }).catch(() => null); return false; }

async function handleMarketInteraction(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('fm:')) return false;
  const parts = id.split(':');
  const action = parts[1];
  const userId = parts[2];
  if (!isOwner(interaction, userId)) return true;
  if (action === 'category' && interaction.isStringSelectMenu?.()) return updateInteraction(interaction, interaction.values?.[0] === 'item' ? renderItemMarket(userId) : renderFishMarket(userId));
  if (action === 'fishpage') { const max = Math.max(1, Number(parts[4]) || 1); return updateInteraction(interaction, renderFishMarket(userId, ((Number(parts[3]) || 1) % max) + 1)); }
  if (action === 'itempage') { const max = Math.max(1, Number(parts[4]) || 1); return updateInteraction(interaction, renderItemMarket(userId, ((Number(parts[3]) || 1) % max) + 1)); }
  if (action === 'sellfish') return updateInteraction(interaction, renderFishMarket(userId, parts[4] || 1, sellFish(userId, parts[3])));
  if (action === 'sellitem') return updateInteraction(interaction, renderItemMarket(userId, parts[4] || 1, sellItem(userId, parts[3])));
  return false;
}

const fishyMarketCommand = { data: new SlashCommandBuilder().setName('fishy-market').setDescription('Open the Fishy Market'), suppressCommandLog: true, async execute(interaction) { await interaction.reply(renderHome(interaction.user.id)); }, async handleInteraction(interaction) { return handleMarketInteraction(interaction); } };

module.exports = { fishyMarketCommand, inventoryCommand, fishBarrelCommand };
