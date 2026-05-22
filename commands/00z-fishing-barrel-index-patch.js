const path = require('path');
const Module = require('module');

const originalLoader = Module._extensions['.js'];

function isFishingFeatureFile(filename) {
  return path.normalize(filename).split(path.sep).join('/').endsWith('/Fishing Game/fishingFeature.js');
}

function patchFishingFeatureSource(source) {
  return source
    .replace(`function renderLocationComingSoon(userId) { return containerPayload(BLACK_ACCENT, [{ type: 10, content: '## coming soon...' }, fishActionSelect(userId, 'Select an action', ['fishing', 'equipment'])]); }`, `function renderLocationComingSoon(userId) { return containerPayload(BLACK_ACCENT, [{ type: 10, content: '## coming soon...' }, fishActionSelect(userId, 'Select an action', ['fishing', 'equipment'])]); }
function renderFishBarrelFull(userId, username = 'Your') { const user = getUser(userId); const used = Array.isArray(user.fishBarrel) ? user.fishBarrel.length : 0; const capacity = Math.max(10, Math.floor(Number(user.fishCapacity) || 10)); return containerPayload(WHITE_ACCENT, [{ type: 10, content: \`## \${username}'s Fish Barrel is full!\n-# Capacity: \${used} / \${capacity}\n-# Sell some fish in /fishy-market or manage your barrel before fishing again.\` }, separator(), fishActionSelect(userId, 'Select an action', ['equipment', 'location'])]); }`)
    .replace(`async function startFishing(interaction) { const userId = interaction.user.id; const weather = getCurrentWeather();`, `async function startFishing(interaction) { const userId = interaction.user.id; const currentUser = getUser(userId); if ((Array.isArray(currentUser.fishBarrel) ? currentUser.fishBarrel.length : 0) >= Math.max(10, Math.floor(Number(currentUser.fishCapacity) || 10))) { await interaction.update(renderFishBarrelFull(userId, interaction.user.username)); return; } const weather = getCurrentWeather();`)
    .replace(`updateUser(session.ownerId, (user) => { if (user.fishBarrel.length < user.fishCapacity) user.fishBarrel.push(caught); return user; }); activeGames.delete(session.id); await interaction.update(renderCaught(session.ownerId, caught));`, `let storedCaught = false; updateUser(session.ownerId, (user) => { user.fishIndex = user.fishIndex && typeof user.fishIndex === 'object' ? user.fishIndex : {}; const previous = user.fishIndex[fish.id] && typeof user.fishIndex[fish.id] === 'object' ? user.fishIndex[fish.id] : {}; user.fishIndex[fish.id] = { discoveredAt: previous.discoveredAt || Date.now(), count: Math.max(0, Math.floor(Number(previous.count) || 0)) + 1, lastCaughtAt: Date.now() }; if (user.fishBarrel.length < user.fishCapacity) { user.fishBarrel.push(caught); storedCaught = true; } return user; }); activeGames.delete(session.id); if (!storedCaught) { await interaction.update(renderFishBarrelFull(session.ownerId, interaction.user.username)); return true; } await interaction.update(renderCaught(session.ownerId, caught));`);
}

if (!globalThis.__fishingBarrelIndexPatch) {
  globalThis.__fishingBarrelIndexPatch = true;
  Module._extensions['.js'] = function patchedFishingBarrelIndexLoader(module, filename) {
    if (!isFishingFeatureFile(filename)) return originalLoader(module, filename);
    const originalCompile = module._compile;
    module._compile = function patchedCompile(source, compileFilename) {
      return originalCompile.call(this, patchFishingFeatureSource(source), compileFilename);
    };
    try {
      return originalLoader(module, filename);
    } finally {
      module._compile = originalCompile;
    }
  };
}

module.exports = { patchFishingFeatureSource };
