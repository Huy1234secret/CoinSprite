const { bigUpgradeCost, luckUpgradeCost } = require('./gameService');
const { MAX_BIG_CROP_TIER, MAX_LUCK_TIER } = require('../config/upgrades');

function createPowerUpgradeControls(actions, ownerId, player) {
  const luck = player.luckTier >= MAX_LUCK_TIER
    ? null
    : actions.create(ownerId, { kind: 'power-upgrade', upgradeKind: 'luck' });
  const big = player.bigCropTier >= MAX_BIG_CROP_TIER
    ? null
    : actions.create(ownerId, { kind: 'power-upgrade', upgradeKind: 'big' });
  return {
    luckActionId: luck?.id || null,
    bigActionId: big?.id || null,
    luckCost: luck ? luckUpgradeCost(player.luckTier) : null,
    bigCost: big ? bigUpgradeCost(player.bigCropTier) : null,
  };
}

module.exports = { createPowerUpgradeControls };
