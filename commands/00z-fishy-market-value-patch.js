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
    .replace(`  const values = history.map((point) => point.value);`, `  const displayChartValue = (rawValue) => {
    const value = Number(rawValue) || entry.baseValue;
    return entry.type === 'fish' ? Math.max(1, Math.floor(value * 0.25)) : value;
  };
  const values = history.map((point) => displayChartValue(point.value));`)
    .replace(`  ctx.fillText(entry.type === 'fish' ? 'Fish Value Chart' : 'Item Value Chart', 52, 70);`, `  ctx.fillText(entry.type === 'fish' ? 'Fish Sell Value Chart' : 'Item Value Chart', 52, 70);`)
    .replace('  ctx.fillText(`Current: ${entry.currentValue} coins`, 620, 70);', "  const currentChartValue = displayChartValue(entry.currentValue);\n  ctx.fillText(`${entry.type === 'fish' ? 'Sell value' : 'Current'}: ${currentChartValue} coins`, 620, 70);")
    .replace(`    y: y0 - (((point.value - scale.min) / (scale.max - scale.min)) * h),`, `    y: y0 - (((displayChartValue(point.value) - scale.min) / (scale.max - scale.min)) * h),`)
    .replace('  ctx.fillText(`Base: ${entry.baseValue} coins`, 52, 430);', '  ctx.fillText(`Base: ${displayChartValue(entry.baseValue)} coins`, 52, 430);')
    .replace(`  ctx.fillText('Value changes based on supply and demand', 52, 458);`, `  ctx.fillText(entry.type === 'fish' ? 'Fish value changes when fish are obtained and sold' : 'Value changes based on supply and demand', 52, 458);`)
    .replace(`for (const record of paged.items) {
    rows.push({ type: 9, components: [{ type: 10, content: \`**\${record.name} \${record.emoji}**\` }], accessory: button(\`fm:chartcheck:\${userId}:\${type}:\${record.id}:\${paged.page}\`, 'Check', BUTTON_SUCCESS) });
  }`, `for (const record of paged.items) {
    const chartEntry = ensureMarketEntry(state, type, record.id);
    const displayValue = type === 'fish' ? Math.max(1, Math.floor(chartEntry.currentValue * 0.25)) : chartEntry.currentValue;
    const valueLabel = type === 'fish' ? 'Sell value' : 'Value';
    rows.push({ type: 9, components: [{ type: 10, content: \`**\${record.name} \${record.emoji}**\n-# \${valueLabel}: \${displayValue} \${FISH_COIN}\` }], accessory: button(\`fm:chartcheck:\${userId}:\${type}:\${record.id}:\${paged.page}\`, 'Check', BUTTON_SUCCESS) });
  }`)
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
