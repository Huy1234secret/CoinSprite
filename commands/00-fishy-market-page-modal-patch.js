const path = require('path');
const Module = require('module');

const originalCompile = Module.prototype._compile;

function isFishyMarketFile(filename) {
  return path.normalize(filename).split(path.sep).join('/').endsWith('/Fishing Game/fishyMarket.js');
}

function cleanupLegacySellFilterSource(source) {
  return source
    .replace(/function rarityFilterSelect\(userId\) \{[\s\S]*?\n\}\n\nfunction itemFilterSelect\(userId\) \{[\s\S]*?\n\}\n\nfunction renderSellFilter\(userId\) \{[\s\S]*?\n\}\n\nfunction renderItemSellFilter\(userId\) \{[\s\S]*?\n\}/, '')
    .replace(/function renderSellFilter\(userId\) \{[\s\S]*?\n\}\n\nfunction renderItemSellFilter\(userId\) \{[\s\S]*?\n\}/, '')
    .replace(/content: '## Sell fish filter\r?\n([^']*)'/g, "content: `## Sell fish filter\n$1`");
}

function patchFishyMarketPageSource(source) {
  return cleanupLegacySellFilterSource(source
    .replace("button(`fm:fishpage:${userId}:${paged.page + 1}`, 'Switch page'", "button(`fm:fishpage:${userId}:${paged.page}:${paged.maxPage}`, 'Switch page'")
    .replace("button(`fm:itempage:${userId}:${paged.page + 1}`, 'Switch page'", "button(`fm:itempage:${userId}:${paged.page}:${paged.maxPage}`, 'Switch page'")
    .replace("button(`fm:chartpage:${userId}:${type}:${paged.page + 1}`, 'Switch page'", "button(`fm:chartpage:${userId}:${type}:${paged.page}:${paged.maxPage}`, 'Switch page'")
    .replace("button(`fm:invpage:${userId}:${paged.page + 1}`, 'Switch page'", "button(`fm:invpage:${userId}:${paged.page}:${paged.maxPage}`, 'Switch page'")
    .replace("button(`fm:barrelpage:${userId}:${paged.page + 1}`, 'Switch page'", "button(`fm:barrelpage:${userId}:${paged.page}:${paged.maxPage}`, 'Switch page'")
    .replace(`function parseList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}`, `function getField(interaction, customId) {
  return interaction.fields?.getTextInputValue(customId)?.trim() || '';
}

function pageModal(kind, userId, minPage, maxPage, currentPage, extra = '') {
  const safeCurrentPage = Math.max(Number(minPage) || 1, Math.min(Number(maxPage) || 1, Number(currentPage) || 1));
  return {
    custom_id: \`fm:\${kind}pagesubmit:\${userId}\${extra}\`,
    title: 'Switch page',
    components: [{ type: 1, components: [{ type: 4, custom_id: \`fm_\${kind}_page\`, label: 'What page you wanna switch?', style: 1, required: true, placeholder: \`\${minPage} - \${maxPage}: Current page \${safeCurrentPage}\`, max_length: 20 }] }],
  };
}

function parseList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}`)
    .replace("  if (action === 'fishpage') return updateInteraction(interaction, renderFishMarket(userId, parts[3]));", `  if (action === 'fishpage') { await interaction.showModal(pageModal('fish', userId, 1, parts[4] || 1, parts[3] || 1)); return true; }`)
    .replace("  if (action === 'itempage') return updateInteraction(interaction, renderItemMarket(userId, parts[3]));", `  if (action === 'itempage') { await interaction.showModal(pageModal('item', userId, 1, parts[4] || 1, parts[3] || 1)); return true; }`)
    .replace("  if (action === 'invpage') return updateInteraction(interaction, renderInventory(userId, interaction.user.username, parts[3]));", `  if (action === 'invpage') { await interaction.showModal(pageModal('inv', userId, 1, parts[4] || 1, parts[3] || 1)); return true; }`)
    .replace("  if (action === 'barrelpage') return updateInteraction(interaction, renderFishBarrel(userId, interaction.user.username, parts[3]));", `  if (action === 'barrelpage') { await interaction.showModal(pageModal('barrel', userId, 1, parts[4] || 1, parts[3] || 1)); return true; }`)
    .replace("  if (action === 'chartpage') return updateInteraction(interaction, renderValueChart(userId, parts[3], parts[4]));", `  if (action === 'chartpage') { await interaction.showModal(pageModal('chart', userId, 1, parts[5] || 1, parts[4] || 1, \`:\${parts[3] || 'fish'}\`)); return true; }`)
    .replace("  if (action === 'fishpage') return updateInteraction(interaction, () => renderFishMarket(userId, parts[3]));", `  if (action === 'fishpage') { await interaction.showModal(pageModal('fish', userId, 1, parts[4] || 1, parts[3] || 1)); return true; }`)
    .replace("  if (action === 'itempage') return updateInteraction(interaction, () => renderItemMarket(userId, parts[3]));", `  if (action === 'itempage') { await interaction.showModal(pageModal('item', userId, 1, parts[4] || 1, parts[3] || 1)); return true; }`)
    .replace("  if (action === 'invpage') return updateInteraction(interaction, () => renderInventory(userId, interaction.user.username, parts[3]));", `  if (action === 'invpage') { await interaction.showModal(pageModal('inv', userId, 1, parts[4] || 1, parts[3] || 1)); return true; }`)
    .replace("  if (action === 'barrelpage') return updateInteraction(interaction, () => renderFishBarrel(userId, interaction.user.username, parts[3]));", `  if (action === 'barrelpage') { await interaction.showModal(pageModal('barrel', userId, 1, parts[4] || 1, parts[3] || 1)); return true; }`)
    .replace("  if (action === 'chartpage') return updateInteraction(interaction, () => renderValueChart(userId, parts[3], parts[4]));", `  if (action === 'chartpage') { await interaction.showModal(pageModal('chart', userId, 1, parts[5] || 1, parts[4] || 1, \`:\${parts[3] || 'fish'}\`)); return true; }`)
    .replace("  if (action === 'sellfish') return updateInteraction(interaction, sellFish(userId, parts[3]).payload);", `  if (action === 'fishpagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderFishMarket(userId, Number(getField(interaction, 'fm_fish_page'))));
  if (action === 'itempagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderItemMarket(userId, Number(getField(interaction, 'fm_item_page'))));
  if (action === 'invpagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderInventory(userId, interaction.user.username, Number(getField(interaction, 'fm_inv_page'))));
  if (action === 'barrelpagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderFishBarrel(userId, interaction.user.username, Number(getField(interaction, 'fm_barrel_page'))));
  if (action === 'chartpagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderValueChart(userId, parts[3] || 'fish', Number(getField(interaction, 'fm_chart_page'))));
  if (action === 'sellfish') return updateInteraction(interaction, sellFish(userId, parts[3]).payload);`)
    .replace("  if (action === 'sellfish') return updateInteraction(interaction, () => sellFish(userId, parts[3]).payload);", `  if (action === 'fishpagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderFishMarket(userId, Number(getField(interaction, 'fm_fish_page'))));
  if (action === 'itempagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderItemMarket(userId, Number(getField(interaction, 'fm_item_page'))));
  if (action === 'invpagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderInventory(userId, interaction.user.username, Number(getField(interaction, 'fm_inv_page'))));
  if (action === 'barrelpagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderFishBarrel(userId, interaction.user.username, Number(getField(interaction, 'fm_barrel_page'))));
  if (action === 'chartpagesubmit' && interaction.isModalSubmit?.()) return updateInteraction(interaction, renderValueChart(userId, parts[3] || 'fish', Number(getField(interaction, 'fm_chart_page'))));
  if (action === 'sellfish') return updateInteraction(interaction, () => sellFish(userId, parts[3]).payload);`));
}

if (!globalThis.__fishyMarketPageModalPatch) {
  globalThis.__fishyMarketPageModalPatch = true;
  Module.prototype._compile = function patchedFishyMarketCompile(source, filename) {
    const nextSource = isFishyMarketFile(filename) ? cleanupLegacySellFilterSource(patchFishyMarketPageSource(source)) : source;
    return originalCompile.call(this, nextSource, filename);
  };
}

module.exports = { patchFishyMarketPageSource };
