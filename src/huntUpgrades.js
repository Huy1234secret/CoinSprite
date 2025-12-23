const HUNT_UPGRADE_TOKEN_EMOJI = '<:ITHuntUpgradeToken:1452674049984430141>';

const HUNT_UPGRADE_TRACKS = {
  hunt_xp: {
    label: 'Hunt XP',
    tiers: [
      { cost: 1, value: 1 },
      { cost: 1, value: 2 },
      { cost: 1, value: 3.5 },
      { cost: 1, value: 5.5 },
      { cost: 1, value: 8 },
      { cost: 2, value: 11 },
      { cost: 2, value: 14.5 },
      { cost: 2, value: 18.5 },
      { cost: 2, value: 23 },
      { cost: 2, value: 28 },
      { cost: 3, value: 33.5 },
      { cost: 3, value: 39.5 },
      { cost: 3, value: 46 },
      { cost: 3, value: 53 },
      { cost: 3, value: 60.5 },
      { cost: 4, value: 68.5 },
      { cost: 4, value: 77 },
      { cost: 4, value: 86 },
      { cost: 4, value: 95.5 },
      { cost: 4, value: 105.5 },
      { cost: 5, value: 116 },
      { cost: 5, value: 127 },
      { cost: 5, value: 138.5 },
      { cost: 5, value: 150.5 },
      { cost: 5, value: 163 },
      { cost: 6, value: 176 },
      { cost: 7, value: 189.5 },
      { cost: 8, value: 203.5 },
      { cost: 9, value: 218 },
      { cost: 10, value: 233 },
    ],
  },
  item_luck: {
    label: 'Item Luck',
    tiers: [
      { cost: 1, value: 5 },
      { cost: 2, value: 10 },
      { cost: 3, value: 20 },
      { cost: 4, value: 35 },
      { cost: 5, value: 55 },
      { cost: 6, value: 80 },
      { cost: 8, value: 110 },
      { cost: 10, value: 145 },
      { cost: 15, value: 185 },
      { cost: 20, value: 230 },
    ],
  },
  creature_luck: {
    label: 'Creature Luck',
    tiers: [
      { cost: 2, value: 5 },
      { cost: 3, value: 10 },
      { cost: 4, value: 20 },
      { cost: 6, value: 35 },
      { cost: 8, value: 55 },
      { cost: 10, value: 80 },
      { cost: 13, value: 110 },
      { cost: 16, value: 145 },
      { cost: 18, value: 185 },
      { cost: 20, value: 230 },
    ],
  },
  dungeon_token_chance: {
    label: 'Dungeon Token Chance',
    tiers: [
      { cost: 5, value: 4 },
      { cost: 8, value: 9 },
      { cost: 10, value: 14 },
      { cost: 15, value: 19 },
      { cost: 20, value: 24 },
    ],
  },
  crit_chance: {
    label: 'Player / Allies Crit Chance',
    tiers: [
      { cost: 1, value: 1 },
      { cost: 2, value: 2 },
      { cost: 3, value: 3 },
      { cost: 4, value: 4 },
      { cost: 5, value: 5 },
      { cost: 6, value: 6 },
      { cost: 8, value: 7 },
      { cost: 10, value: 8 },
      { cost: 15, value: 9 },
      { cost: 20, value: 10 },
    ],
  },
  crit_damage: {
    label: 'Player / Allies Crit Damage',
    tiers: [
      { cost: 1, value: 5 },
      { cost: 2, value: 10 },
      { cost: 3, value: 15 },
      { cost: 4, value: 20 },
      { cost: 6, value: 25 },
      { cost: 8, value: 30 },
      { cost: 10, value: 40 },
      { cost: 15, value: 55 },
      { cost: 20, value: 75 },
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
