const HUNT_UPGRADE_TOKEN_EMOJI = '<:ITHuntUpgradeToken:1452674049984430141>';

const HUNT_UPGRADE_TRACKS = {
  hunt_xp: {
    label: 'Hunt XP',
    tiers: [
      { cost: 2, value: 5 },
      { cost: 4, value: 10 },
      { cost: 6, value: 15 },
      { cost: 8, value: 20 },
      { cost: 10, value: 25 },
      { cost: 12, value: 30 },
      { cost: 14, value: 35 },
      { cost: 16, value: 40 },
      { cost: 18, value: 45 },
      { cost: 20, value: 50 },
    ],
  },
  item_luck: {
    label: 'Item Luck',
    tiers: [
      { cost: 2, value: 2 },
      { cost: 4, value: 5 },
      { cost: 6, value: 9 },
      { cost: 8, value: 14 },
      { cost: 10, value: 20 },
      { cost: 12, value: 27 },
      { cost: 14, value: 35 },
      { cost: 16, value: 44 },
      { cost: 18, value: 54 },
      { cost: 20, value: 65 },
    ],
  },
  creature_luck: {
    label: 'Creature Luck',
    tiers: [
      { cost: 2, value: 15 },
      { cost: 3, value: 30 },
      { cost: 4, value: 45 },
      { cost: 6, value: 60 },
      { cost: 8, value: 75 },
      { cost: 10, value: 90 },
      { cost: 13, value: 105 },
      { cost: 16, value: 120 },
      { cost: 18, value: 135 },
      { cost: 20, value: 150 },
    ],
  },
  dungeon_token_chance: {
    label: 'Dungeon Token Chance',
    tiers: [
      { cost: 2, value: 2 },
      { cost: 4, value: 4 },
      { cost: 6, value: 6 },
      { cost: 8, value: 8 },
      { cost: 10, value: 10 },
    ],
  },
  crit_chance: {
    label: 'Player / Allies Crit Chance',
    tiers: [
      { cost: 2, value: 1 },
      { cost: 4, value: 3 },
      { cost: 6, value: 5 },
      { cost: 8, value: 7 },
      { cost: 10, value: 9 },
    ],
  },
  crit_damage: {
    label: 'Player / Allies Crit Damage',
    tiers: [
      { cost: 2, value: 5 },
      { cost: 3, value: 10 },
      { cost: 4, value: 15 },
      { cost: 6, value: 20 },
      { cost: 8, value: 25 },
      { cost: 10, value: 30 },
      { cost: 13, value: 35 },
      { cost: 16, value: 40 },
      { cost: 18, value: 45 },
      { cost: 20, value: 50 },
    ],
  },
};

const DEFAULT_HUNT_UPGRADES = Object.keys(HUNT_UPGRADE_TRACKS).reduce((acc, key) => {
  acc[key] = 0;
  return acc;
}, {});

function getMaxTier(key) {
  return HUNT_UPGRADE_TRACKS[key]?.tiers.length ?? 0;
}

function normalizeHuntUpgrades(upgrades = {}) {
  const normalized = { ...DEFAULT_HUNT_UPGRADES };
  for (const key of Object.keys(DEFAULT_HUNT_UPGRADES)) {
    const value = Number.isFinite(upgrades[key]) ? Math.max(0, Math.floor(upgrades[key])) : 0;
    normalized[key] = Math.min(value, getMaxTier(key));
  }
  return normalized;
}

function getUpgradeValue(key, tier) {
  if (!tier || tier <= 0) {
    return 0;
  }
  return HUNT_UPGRADE_TRACKS[key]?.tiers[tier - 1]?.value ?? 0;
}

function getUpgradeNextCost(key, tier) {
  return HUNT_UPGRADE_TRACKS[key]?.tiers[tier]?.cost ?? null;
}

function getUpgradeCostForTier(key, tier) {
  if (!tier || tier <= 0) {
    return 0;
  }
  return HUNT_UPGRADE_TRACKS[key]?.tiers[tier - 1]?.cost ?? 0;
}

function getTotalUpgradeTiers() {
  return Object.values(HUNT_UPGRADE_TRACKS).reduce((sum, track) => sum + track.tiers.length, 0);
}

function getTotalUpgradeTokens(key) {
  return HUNT_UPGRADE_TRACKS[key]?.tiers.reduce((sum, tier) => sum + tier.cost, 0) ?? 0;
}

function getHuntUpgradeStats(profile) {
  const upgrades = normalizeHuntUpgrades(profile?.hunt_upgrades ?? {});
  return {
    huntXpPercent: getUpgradeValue('hunt_xp', upgrades.hunt_xp),
    itemLuckPercent: getUpgradeValue('item_luck', upgrades.item_luck),
    creatureLuckPercent: getUpgradeValue('creature_luck', upgrades.creature_luck),
    dungeonTokenChancePercent: getUpgradeValue('dungeon_token_chance', upgrades.dungeon_token_chance),
    critChancePercent: getUpgradeValue('crit_chance', upgrades.crit_chance),
    critDamagePercent: getUpgradeValue('crit_damage', upgrades.crit_damage),
    upgrades,
  };
}

module.exports = {
  DEFAULT_HUNT_UPGRADES,
  HUNT_UPGRADE_TOKEN_EMOJI,
  HUNT_UPGRADE_TRACKS,
  getHuntUpgradeStats,
  getMaxTier,
  getTotalUpgradeTiers,
  getTotalUpgradeTokens,
  getUpgradeCostForTier,
  getUpgradeNextCost,
  getUpgradeValue,
  normalizeHuntUpgrades,
};
