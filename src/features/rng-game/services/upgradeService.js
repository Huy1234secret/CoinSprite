const { bigUpgradeCost, luckUpgradeCost } = require('./gameService');

function createPowerUpgradeControls(actions, ownerId, player) {
  const luck = actions.create(ownerId, { kind: 'power-upgrade', upgradeKind: 'luck' });
  const big = actions.create(ownerId, { kind: 'power-upgrade', upgradeKind: 'big' });
  return {
    luckActionId: luck.id,
    bigActionId: big.id,
    luckCost: luckUpgradeCost(player.luckTier),
    bigCost: bigUpgradeCost(player.bigCropTier),
  };
}

module.exports = { createPowerUpgradeControls };
