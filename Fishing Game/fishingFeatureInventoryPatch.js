const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalPath = path.join(__dirname, 'fishingFeature.js');
let source = fs.readFileSync(originalPath, 'utf8');

function replaceRequired(search, replacement) {
  if (!source.includes(search)) throw new Error(`Missing fishing feature patch target: ${search.slice(0, 80)}`);
  source = source.replace(search, replacement);
}

replaceRequired(
  "function rarityLabel(rarity) { return RARITY_EMOJI[String(rarity || '').toLowerCase()] || ''; }\nfunction rodDurability(user, rodId) {",
  `function rarityLabel(rarity) { return RARITY_EMOJI[String(rarity || '').toLowerCase()] || ''; }
function ensureInventoryMarketState(state) {
  state.market = state.market && typeof state.market === 'object' ? state.market : { entries: {}, lastUpdateAt: 0 };
  state.market.entries = state.market.entries && typeof state.market.entries === 'object' ? state.market.entries : {};
  return state.market;
}
function inventoryMarketKey(type, id) { return \`${'${type}'}:${'${id}'}\`; }
function inventoryBaseMarketValue(type, id) {
  if (type === 'fish') return Math.max(1, Number(FISH_BY_ID.get(id)?.value || FISH_BY_ID.get(id)?.sellValue) || 1);
  const item = getItemDefinition(id);
  if (item?.unsellable && !Number(item.value)) return 0;
  return Math.max(1, Number(item?.value) || 1);
}
function inventoryExistingAmount(state, type, id) {
  let total = 0;
  for (const account of Object.values(state.users || {})) {
    if (type === 'fish') total += (Array.isArray(account.fishBarrel) ? account.fishBarrel : []).filter((entry) => entry?.fishId === id).length;
    else total += Math.max(0, Math.floor(Number(account.inventory?.[id]?.amount) || 0));
  }
  return total;
}
function ensureInventoryMarketEntry(state, type, id) {
  ensureInventoryMarketState(state);
  const key = inventoryMarketKey(type, id);
  if (!state.market.entries[key]) {
    const baseValue = inventoryBaseMarketValue(type, id);
    state.market.entries[key] = { type, id, baseValue, currentValue: baseValue, history: [{ at: Date.now(), value: baseValue }], lastExistAmount: inventoryExistingAmount(state, type, id), chartPath: null };
  }
  return state.market.entries[key];
}
function inventoryMarketValue(state, type, id) {
  const entry = ensureInventoryMarketEntry(state, type, id);
  return Math.max(0, Math.round(Number(entry.currentValue) || Number(entry.baseValue) || 0));
}
function inventoryWeightMultiplier(fish, entry) {
  const weight = Number(entry.weight) || fish.minWeight;
  if (fish.maxWeight <= fish.minWeight) return 1;
  const progress = Math.max(0, Math.min(1, (weight - fish.minWeight) / (fish.maxWeight - fish.minWeight)));
  return 1 + (progress * 0.5);
}
function inventoryMutationMultiplier(entry) {
  if (!entry?.mutation || String(entry.mutation).toLowerCase() === 'none') return 1;
  return Number(entry.mutationMultiplier) || 1;
}
function inventoryVariantMultiplier(entry) {
  return Number(VARIANTS.find((variant) => variant.key === entry?.variant)?.multiplier) || 1;
}
function inventoryFishValues(state, entry, fish) {
  const marketValue = inventoryMarketValue(state, 'fish', fish.id);
  const totalValue = Math.max(1, Math.round(marketValue * inventoryWeightMultiplier(fish, entry) * inventoryVariantMultiplier(entry) * inventoryMutationMultiplier(entry)));
  return { marketValue, totalValue };
}
function inventoryMutationLabel(entry) {
  if (!entry?.mutation || String(entry.mutation).toLowerCase() === 'none') return 'None';
  return \`${'${entry.mutation}'} ${'${entry.mutationEmoji || \"\"}'}\`.trim();
}
function rodDurability(user, rodId) {`
);

const replacement = `function renderInventory(userId, username, requestedPage = 1) {
  const state = loadState();
  const user = ensureUser(state, userId);
  const records = Object.entries(user.inventory).map(([itemId, entry]) => ({ item: getItemDefinition(itemId), itemId, entry })).filter((record) => record.item && Number(record.entry.amount) > 0);
  const paged = pageItems(records, requestedPage);
  const rows = [{ type: 10, content: \`## ${'${username}'}'s inventory\` }];
  for (const { item, itemId, entry } of paged.items) {
    const amount = Math.max(0, Math.floor(Number(entry.amount) || 0));
    const marketValue = inventoryMarketValue(state, 'item', itemId);
    const totalValue = marketValue * amount;
    const using = user.equippedRodId === itemId ? \`\\n-# You are using a ${'${item.emoji}'} ${'${item.name}'} - Durability: ${'${rodDurability(user, itemId)}'}\` : '';
    const dur = item.type === 'Gear/Tool' ? \`\\n-# Durability: ${'${rodDurability(user, itemId)}'}\` : '';
    const content = \`### x${'${amount}'} ${'${item.name}'} ${'${item.emoji}'} \\`${'${item.type}'}\\`${'${dur}'}${'${using}'}\\n-# Rarity: ${'${rarityLabel(item.rarity)}'} - Value: ${'${marketValue}'} // **${'${totalValue}'} ${'${FISH_COIN}'}**\`;
    rows.push({ type: 9, components: [{ type: 10, content }], accessory: button(\`fish:destroyitem:${'${userId}'}:${'${itemId}'}:${'${paged.page}'}\`, 'Destroy', BUTTON_DANGER) });
  }
  if (!paged.items.length) rows.push({ type: 10, content: '-# No items found.' });
  rows.push(sep(), row([button(\`fish:invpage:${'${userId}'}:${'${paged.page}'}:${'${paged.maxPage}'}\`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)]));
  saveState(state);
  return container(WHITE, rows);
}
function renderFishBarrel(userId, username, requestedPage = 1) {
  const state = loadState();
  const user = ensureUser(state, userId);
  const records = user.fishBarrel.map((entry) => ({ entry, fish: FISH_BY_ID.get(entry.fishId) })).filter((record) => record.fish);
  const paged = pageItems(records, requestedPage);
  const lines = paged.items.map(({ entry, fish }) => {
    const values = inventoryFishValues(state, entry, fish);
    return \`### x1 ${'${fish.displayName || fish.name}'} ${'${fish.emoji}'}\\n-# Rarity: ${'${rarityLabel(fish.rarity)}'}\\n-# Weigh: ${'${Number(entry.weight || 0).toFixed(2)}'} kg - Value: ${'${values.marketValue}'} // **${'${values.totalValue}'} ${'${FISH_COIN}'}**\\n-# Variant / Mutation: ${'${entry.variant}'} ${'${entry.variantEmoji}'} / ${'${inventoryMutationLabel(entry)}'}\`;
  });
  saveState(state);
  return container(WHITE, [{ type: 10, content: [\`## ${'${username}'}'s inventory\`, \`-# Capacity: ${'${user.fishBarrel.length}'} / ${'${user.fishCapacity}'}\`, lines.join('\\n') || '-# No fish found.'].join('\\n') }]);
}
function renderCaught`;

source = source.replace(/function renderInventory\(userId, username, requestedPage = 1\) \{[\s\S]*?\nfunction renderCaught/, replacement);

const patchedModule = new Module(originalPath, module.parent);
patchedModule.filename = originalPath;
patchedModule.paths = Module._nodeModulePaths(path.dirname(originalPath));
patchedModule._compile(source, originalPath);

module.exports = patchedModule.exports;
