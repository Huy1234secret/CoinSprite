const path = require('path');
const Module = require('module');

const originalCompile = Module.prototype._compile;

function isFishyMarketFile(filename) {
  return path.normalize(filename).split(path.sep).join('/').endsWith('/Fishing Game/fishyMarket.js');
}

const filterFormHelpers = `function sellItemsByRarity(userId, rarities) {
  const selected = Array.isArray(rarities) ? rarities : [];
  const wanted = new Set(selected.map((rarity) => String(rarity || '').toLowerCase()));
  const sellAll = wanted.has('all');
  const state = loadState();
  const user = ensureUser(state, userId);
  let totalValue = 0;
  let sold = 0;
  for (const record of userItemRecords(state, userId)) {
    if (!record.item || record.item.unsellable || record.entry.locked || (!sellAll && !wanted.has(String(record.item.rarity || '').toLowerCase()))) continue;
    const amount = Math.floor(Number(record.entry.amount) || 0);
    if (amount <= 0) continue;
    const marketValue = getMarketValue(state, 'item', record.id);
    const sellValue = Math.max(1, Math.floor(marketValue * 0.25));
    totalValue += sellValue * amount;
    sold += amount;
    delete user.inventory[record.id];
    updateMarketEntry(state, 'item', record.id, amount, 0);
  }
  user.fishCoins += totalValue;
  saveState(state);
  const message = sold ? \`-# **You've sold \\u00d7\${sold} items - \${totalValue} \${FISH_COIN}**\` : '-# **No unlocked sellable items matched that filter**';
  return renderItemMarket(userId, 1, message);
}

const FILTER_RARITIES = [
  ['all', 'All'],
  ['secret', 'Secret'],
  ['mythical', 'Mythical'],
  ['legendary', 'Legendary'],
  ['epic', 'Epic'],
  ['rare', 'Rare'],
  ['uncommon', 'Uncommon'],
  ['common', 'Common'],
];

function rarityOptions() {
  return FILTER_RARITIES.map(([value, label]) => ({ label, value }));
}

function filterForm(kind, userId) {
  const isFish = kind === 'fish';
  return {
    custom_id: \`fm:\${kind}filtersubmit:\${userId}\`,
    title: isFish ? 'Sell fish filter' : 'Sell item filter',
    components: [{
      type: 18,
      label: isFish ? 'Select fish rarity to sell' : 'Select item rarity to sell',
      component: {
        type: 3,
        custom_id: \`\${kind}_rarities\`,
        placeholder: 'Select rarity to sell',
        min_values: 1,
        max_values: FILTER_RARITIES.length,
        options: rarityOptions(),
      },
    }],
  };
}

function getSelectedValues(interaction, customId) {
  const found = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if ((value.customId === customId || value.custom_id === customId) && Array.isArray(value.values)) found.push(...value.values);
    if ((value.customId === customId || value.custom_id === customId) && typeof value.value === 'string') found.push(value.value);
    if (value.component) visit(value.component);
    if (Array.isArray(value.components)) value.components.forEach(visit);
    if (value.fields && typeof value.fields.values === 'function') Array.from(value.fields.values()).forEach(visit);
  };
  if (Array.isArray(interaction.values)) found.push(...interaction.values);
  try { visit(interaction.fields?.getField?.(customId)); } catch {}
  visit(interaction);
  return [...new Set(found.map((item) => String(item || '').trim()).filter(Boolean))];
}`;

function patchFishyMarketFilterForms(source) {
  let next = source;

  next = next.replace(
    /function sellItemsById\(userId, itemIds\) \{[\s\S]*?\n\}\n\nfunction rarityFilterSelect\(userId\) \{[\s\S]*?\n\}\n\nfunction itemFilterSelect\(userId\) \{[\s\S]*?\n\}\n\nfunction renderSellFilter\(userId\) \{[\s\S]*?\n\}\n\nfunction renderItemSellFilter\(userId\) \{[\s\S]*?\n\}/,
    filterFormHelpers
  );

  next = next.replace(
    /function renderSellFilter\(userId\) \{[\s\S]*?\n\}\n\nfunction renderItemSellFilter\(userId\) \{[\s\S]*?\n\}/,
    filterFormHelpers
  );

  next = next.replace(
    /if \(action === 'sellfilter'\) return updateInteraction\(interaction, renderSellFilter\(userId\)\)\.then\(\(\) => true\);\n\s*if \(action === 'sellfilterselect'\) return updateInteraction\(interaction, sellFishByRarity\(userId, interaction\.values \|\| \[\]\)\)\.then\(\(\) => true\);\n\s*if \(action === 'itemfilter'\) return updateInteraction\(interaction, renderItemSellFilter\(userId\)\)\.then\(\(\) => true\);\n\s*if \(action === 'itemfilterselect'\) return updateInteraction\(interaction, sellItemsById\(userId, interaction\.values \|\| \[\]\)\)\.then\(\(\) => true\);/,
    "if (action === 'sellfilter') { await interaction.showModal(filterForm('fish', userId)); return true; }\n  if (action === 'sellfiltersubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, sellFishByRarity(userId, getSelectedValues(interaction, 'fish_rarities')));\n  if (action === 'itemfilter') { await interaction.showModal(filterForm('item', userId)); return true; }\n  if (action === 'itemfiltersubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, sellItemsByRarity(userId, getSelectedValues(interaction, 'item_rarities')));"
  );

  next = next.replace(
    /if \(action === 'sellfilter'\) \{ await interaction\.showModal\(filterModal\(userId\)\); return true; \}\n\s*if \(action === 'sellfiltersubmit' && interaction\.isModalSubmit\?\.\(\)\) return updateInteraction\(interaction, sellFishByRarity\(userId, parseList\(interaction\.fields\?\.getTextInputValue\('rarities'\)\)\)\);/,
    "if (action === 'sellfilter') { await interaction.showModal(filterForm('fish', userId)); return true; }\n  if (action === 'sellfiltersubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, sellFishByRarity(userId, getSelectedValues(interaction, 'fish_rarities')));\n  if (action === 'itemfilter') { await interaction.showModal(filterForm('item', userId)); return true; }\n  if (action === 'itemfiltersubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, sellItemsByRarity(userId, getSelectedValues(interaction, 'item_rarities')));"
  );

  return next;
}

if (!globalThis.__fishyMarketFilterFormFixPatch) {
  globalThis.__fishyMarketFilterFormFixPatch = true;
  Module.prototype._compile = function patchedFishyMarketFilterFormFix(source, filename) {
    const nextSource = isFishyMarketFile(filename) ? patchFishyMarketFilterForms(source) : source;
    return originalCompile.call(this, nextSource, filename);
  };
}

module.exports = { patchFishyMarketFilterForms };
