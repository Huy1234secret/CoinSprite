const path = require('path');
const Module = require('module');

const originalLoader = Module._extensions['.js'];

function isFishyMarketFile(filename) {
  return path.normalize(filename).split(path.sep).join('/').endsWith('/Fishing Game/fishyMarket.js');
}

function patchFishyMarketSource(source) {
  return source
    .replace(/function getChartRecords\(state, userId, type\) \{[\s\S]*?\n\}\n\nfunction chartPathFor/, `function getChartRecords(state, userId, type) {
  if (type === 'fish') return FISH.map((fish) => ({ id: fish.id, name: fish.displayName, emoji: fish.emoji }));
  return userItemRecords(state, userId).map((record) => ({ id: record.id, name: record.item.name, emoji: record.item.emoji }));
}

function chartPathFor`)
    .replace(`function fishTotalValue(state, entry, fish) {
  const marketValue = getMarketValue(state, 'fish', fish.id);
  const sellValue = Math.max(1, Math.floor(marketValue * 0.25));
  const variant = VARIANT_MULTIPLIER[entry.variant] || 1;
  return Math.max(1, Math.round(sellValue * weightMultiplier(fish, entry) * variant * mutationMultiplier(entry)));
}`, `function fishTotalValue(state, entry, fish) {
  const marketValue = getMarketValue(state, 'fish', fish.id);
  const variant = VARIANT_MULTIPLIER[entry.variant] || 1;
  return Math.max(1, Math.round(marketValue * weightMultiplier(fish, entry) * variant * mutationMultiplier(entry)));
}`)
    .replace(`  const values = history.map((point) => point.value);`, `  const displayChartValue = (rawValue) => Number(rawValue) || entry.baseValue;
  const values = history.map((point) => displayChartValue(point.value));`)
    .replace(`  ctx.fillText(entry.type === 'fish' ? 'Fish Value Chart' : 'Item Value Chart', 52, 70);`, `  ctx.fillText(entry.type === 'fish' ? 'Fish Value Chart' : 'Item Value Chart', 52, 70);`)
    .replace('  ctx.fillText(`Current: ${entry.currentValue} coins`, 620, 70);', "  const currentChartValue = displayChartValue(entry.currentValue);\n  ctx.fillText(`Current: ${currentChartValue} coins`, 620, 70);")
    .replace(`    y: y0 - (((point.value - scale.min) / (scale.max - scale.min)) * h),`, `    y: y0 - (((displayChartValue(point.value) - scale.min) / (scale.max - scale.min)) * h),`)
    .replace('  ctx.fillText(`Base: ${entry.baseValue} coins`, 52, 430);', '  ctx.fillText(`Base: ${displayChartValue(entry.baseValue)} coins`, 52, 430);')
    .replace(`  ctx.fillText('Value changes based on supply and demand', 52, 458);`, `  ctx.fillText(entry.type === 'fish' ? 'Fish value changes when fish are obtained and sold' : 'Value changes based on supply and demand', 52, 458);`)
    .replace(`for (const record of paged.items) {
    rows.push({ type: 9, components: [{ type: 10, content: \`**\${record.name} \${record.emoji}**\` }], accessory: button(\`fm:chartcheck:\${userId}:\${type}:\${record.id}:\${paged.page}\`, 'Check', BUTTON_SUCCESS) });
  }`, `for (const record of paged.items) {
    const chartEntry = ensureMarketEntry(state, type, record.id);
    const displayValue = chartEntry.currentValue;
    rows.push({ type: 9, components: [{ type: 10, content: \`**\${record.name} \${record.emoji}**\n-# Value: \${displayValue} \${FISH_COIN}\` }], accessory: button(\`fm:chartcheck:\${userId}:\${type}:\${record.id}:\${paged.page}\`, 'Check', BUTTON_SUCCESS) });
  }`)
    .replace(`  rows.push(separator(), { type: 10, content: actionMessage }, actionRow([button(\`fm:itempage:\${userId}:\${paged.page + 1}\`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)]), categorySelect(userId, 'item'));`, `  rows.push(separator(), { type: 10, content: actionMessage }, actionRow([button(\`fm:itempage:\${userId}:\${paged.page + 1}\`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1), button(\`fm:itemfilter:\${userId}\`, 'Sell filter', BUTTON_SECONDARY, paged.items.length === 0)]), categorySelect(userId, 'item'));`)
    .replace(`function sellFishByRarity(userId, rarities) {
  const wanted = new Set(rarities.map((rarity) => rarity.toLowerCase()));
  const state = loadState();
  const user = ensureUser(state, userId);
  let totalValue = 0;
  let sold = 0;
  user.fishBarrel = user.fishBarrel.filter((entry) => {
    const fish = FISH_BY_ID.get(entry.fishId);
    if (!fish || entry.locked || !wanted.has(fish.rarity.toLowerCase())) return true;
    totalValue += fishTotalValue(state, entry, fish);
    sold += 1;
    updateMarketEntry(state, 'fish', fish.id, 1, 0);
    return false;
  });
  user.fishCoins += totalValue;
  saveState(state);
  const message = sold ? \`-# **You've sold \${sold} fish - \${totalValue} \${FISH_COIN}**\` : '-# **No unlocked fish matched that rarity**';
  return renderFishMarket(userId, 1, message);
}

function filterModal(userId) {
  return {
    custom_id: \`fm:sellfiltersubmit:\${userId}\`,
    title: 'Sell fish filter',
    components: [{ type: 1, components: [{ type: 4, custom_id: 'rarities', label: 'Select rarity to sell', style: 1, required: true, placeholder: 'common, uncommon, rare, epic, legendary, mythical, secret', max_length: 120 }] }],
  };
}

function parseList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}`, `function sellFishByRarity(userId, rarities) {
  const selected = Array.isArray(rarities) ? rarities : [];
  const wanted = new Set(selected.map((rarity) => String(rarity || '').toLowerCase()));
  const sellAll = wanted.has('all');
  const state = loadState();
  const user = ensureUser(state, userId);
  let totalValue = 0;
  let sold = 0;
  user.fishBarrel = user.fishBarrel.filter((entry) => {
    const fish = FISH_BY_ID.get(entry.fishId);
    if (!fish || entry.locked || (!sellAll && !wanted.has(fish.rarity.toLowerCase()))) return true;
    totalValue += fishTotalValue(state, entry, fish);
    sold += 1;
    updateMarketEntry(state, 'fish', fish.id, 1, 0);
    return false;
  });
  user.fishCoins += totalValue;
  saveState(state);
  const message = sold ? \`-# **You've sold \${sold} fish - \${totalValue} \${FISH_COIN}**\` : '-# **No unlocked fish matched that rarity**';
  return renderFishMarket(userId, 1, message);
}

function sellItemsById(userId, itemIds) {
  const selected = Array.isArray(itemIds) ? itemIds : [];
  const wanted = new Set(selected.map((itemId) => String(itemId || '').toLowerCase()));
  const sellAll = wanted.has('all');
  const state = loadState();
  const user = ensureUser(state, userId);
  let totalValue = 0;
  let sold = 0;
  for (const record of userItemRecords(state, userId)) {
    if (!record.item || record.item.unsellable || record.entry.locked || (!sellAll && !wanted.has(record.id))) continue;
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

function rarityFilterSelect(userId) {
  const options = [
    ['all', 'All'],
    ['secret', 'Secret'],
    ['mythical', 'Mythical'],
    ['legendary', 'Legendary'],
    ['epic', 'Epic'],
    ['rare', 'Rare'],
    ['uncommon', 'Uncommon'],
    ['common', 'Common'],
  ];
  return actionRow([{ type: 3, custom_id: \`fm:sellfilterselect:\${userId}\`, placeholder: 'Select rarity to sell', min_values: 1, max_values: options.length, options: options.map(([value, label]) => ({ label, value })) }]);
}

function itemFilterSelect(userId) {
  const state = loadState();
  const options = [{ label: 'All', value: 'all' }];
  for (const record of userItemRecords(state, userId)) {
    if (!record.item || record.item.unsellable || record.entry.locked) continue;
    options.push({ label: \`\\u00d7\${record.entry.amount} \${record.item.name}\`.slice(0, 100), value: record.id });
  }
  return actionRow([{ type: 3, custom_id: \`fm:itemfilterselect:\${userId}\`, placeholder: 'Select items to sell', min_values: 1, max_values: Math.min(25, options.length), options: options.slice(0, 25) }]);
}

function renderSellFilter(userId) {
  return containerPayload(WHITE_ACCENT, [
    { type: 10, content: '## Sell fish filter\\\\n-# Select one or more rarities to sell.' },
    separator(),
    rarityFilterSelect(userId),
    categorySelect(userId, 'fish'),
  ]);
}

function renderItemSellFilter(userId) {
  return containerPayload(WHITE_ACCENT, [
    { type: 10, content: '## Sell item filter\\\\n-# Select one or more items to sell.' },
    separator(),
    itemFilterSelect(userId),
    categorySelect(userId, 'item'),
  ]);
}`)
    .replace(`if (action === 'sellfilter') { await interaction.showModal(filterModal(userId)); return true; }
  if (action === 'sellfiltersubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, sellFishByRarity(userId, parseList(interaction.fields?.getTextInputValue('rarities'))));`, `if (action === 'sellfilter') return updateInteraction(interaction, renderSellFilter(userId)).then(() => true);
  if (action === 'sellfilterselect') return updateInteraction(interaction, sellFishByRarity(userId, interaction.values || [])).then(() => true);
  if (action === 'itemfilter') return updateInteraction(interaction, renderItemSellFilter(userId)).then(() => true);
  if (action === 'itemfilterselect') return updateInteraction(interaction, sellItemsById(userId, interaction.values || [])).then(() => true);`)
    .replace(`const total = fishTotalValue(state, entry, fish);
  user.fishBarrel.splice(index, 1);`, `const total = fishTotalValue(state, entry, fish);
  user.fishIndex = user.fishIndex && typeof user.fishIndex === 'object' ? user.fishIndex : {};
  const previous = user.fishIndex[fish.id] && typeof user.fishIndex[fish.id] === 'object' ? user.fishIndex[fish.id] : {};
  user.fishIndex[fish.id] = { discoveredAt: previous.discoveredAt || entry.caughtAt || Date.now(), count: Math.max(1, Math.floor(Number(previous.count) || 0)), lastCaughtAt: previous.lastCaughtAt || entry.caughtAt || Date.now() };
  user.fishBarrel.splice(index, 1);`)
    .replace(`totalValue += fishTotalValue(state, entry, fish);
    sold += 1;
    updateMarketEntry(state, 'fish', fish.id, 1, 0);`, `totalValue += fishTotalValue(state, entry, fish);
    sold += 1;
    user.fishIndex = user.fishIndex && typeof user.fishIndex === 'object' ? user.fishIndex : {};
    const previous = user.fishIndex[fish.id] && typeof user.fishIndex[fish.id] === 'object' ? user.fishIndex[fish.id] : {};
    user.fishIndex[fish.id] = { discoveredAt: previous.discoveredAt || entry.caughtAt || Date.now(), count: Math.max(1, Math.floor(Number(previous.count) || 0)), lastCaughtAt: previous.lastCaughtAt || entry.caughtAt || Date.now() };
    updateMarketEntry(state, 'fish', fish.id, 1, 0);`);
}

if (!globalThis.__fishyMarketValuePatch) {
  globalThis.__fishyMarketValuePatch = true;
  Module._extensions['.js'] = function patchedFishyMarketValueLoader(module, filename) {
    if (!isFishyMarketFile(filename)) return originalLoader(module, filename);
    const originalCompile = module._compile;
    module._compile = function patchedCompile(source, compileFilename) {
      return originalCompile.call(this, patchFishyMarketSource(source), compileFilename);
    };
    try {
      return originalLoader(module, filename);
    } finally {
      module._compile = originalCompile;
    }
  };
}

module.exports = { patchFishyMarketSource };
