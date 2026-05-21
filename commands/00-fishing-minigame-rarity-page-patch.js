const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoader = Module._extensions['.js'];

function isFishingFeatureFile(filename) {
  return path.normalize(filename).split(path.sep).join('/').endsWith('/Fishing Game/fishingFeature.js');
}

function patchFishingFeatureSource(source) {
  return source
    .replace(`const RAINBOW_FISH_EMOJI = '<:SBRainbowFish:1506660311380398211>';`, `const RAINBOW_FISH_EMOJI = '<:SBRainbowFish:1506660311380398211>';
const RARITY_EMOJI = {
  common: '<:SBCommon:1506965202585780274>',
  uncommon: '<:SBUncommon:1506965215743447040>',
  rare: '<:SBRare:1506965211607994461>',
  epic: '<:SBEpic:1506965204624474153>',
  legendary: '<:SBLegendary:1506965206197207131>',
  mythical: '<:SBMythical:1506965209271762954>',
  secret: '<:SBSecret:1506965213881307186>',
};

function rarityLabel(rarity) {
  return RARITY_EMOJI[String(rarity || '').toLowerCase()] || '';
}`)
    .replaceAll('-# * Rarity: ${fish.rarity}', '-# * Rarity: ${rarityLabel(fish.rarity)}')
    .replaceAll('-# Rarity: ${item.rarity}', '-# Rarity: ${rarityLabel(item.rarity)}')
    .replaceAll('-# Rarity: ${fish.rarity}', '-# Rarity: ${rarityLabel(fish.rarity)}')
    .replace(`function pageModal(kind, userId, minPage, maxPage) { return { custom_id: \`fish:\${kind}pagesubmit:\${userId}\`, title: 'Switch page', components: [textInput(\`fish_\${kind}_page\`, 'Which page?', \`\${minPage} - \${maxPage}\`, true)] }; }`, `function pageModal(kind, userId, minPage, maxPage, currentPage) { const safeCurrentPage = Math.max(Number(minPage) || 1, Math.min(Number(maxPage) || 1, Number(currentPage) || 1)); return { custom_id: \`fish:\${kind}pagesubmit:\${userId}\`, title: 'Switch page', components: [textInput(\`fish_\${kind}_page\`, 'What page you wanna switch?', \`\${minPage} - \${maxPage}: Current page \${safeCurrentPage}\`, true)] }; }`)
    .replace("await interaction.showModal(pageModal('inv', userId, 1, parts[4] || 1));", "await interaction.showModal(pageModal('inv', userId, 1, parts[4] || 1, parts[3] || 1));")
    .replace("await interaction.showModal(pageModal('barrel', userId, 1, parts[4] || 1));", "await interaction.showModal(pageModal('barrel', userId, 1, parts[4] || 1, parts[3] || 1));");
}

if (!globalThis.__fishingMinigameRarityPagePatch) {
  globalThis.__fishingMinigameRarityPagePatch = true;
  Module._extensions['.js'] = function patchedFishingFeatureLoader(module, filename) {
    if (!isFishingFeatureFile(filename)) return originalLoader(module, filename);
    const source = patchFishingFeatureSource(fs.readFileSync(filename, 'utf8'));
    return module._compile(source, filename);
  };
}

module.exports = { patchFishingFeatureSource };
