const { bigUpgradeCost, luckUpgradeCost } = require('./gameService');

function createPowerUpgradeControls(actions, ownerId, player) {
  const luck = player.luckTier >= 20
    ? null
    : actions.create(ownerId, { kind: 'power-upgrade', upgradeKind: 'luck' });
  const big = player.bigCropTier >= 20
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
