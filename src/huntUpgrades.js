const HUNT_UPGRADE_TOKEN_EMOJI = '<:ITHuntUpgradeToken:1452674049984430141>';

const HUNT_UPGRADE_TRACKS = {
  hunt_xp: {
    label: 'Hunt XP',
    tiers: [
      { cost: 1, value: 10 },
      { cost: 2, value: 25 },
      { cost: 3, value: 45 },
      { cost: 4, value: 70 },
      { cost: 5, value: 100 },
    ],
  },
  item_luck: {
    label: 'Item Luck',
    tiers: [
      { cost: 1, value: 5 },
      { cost: 2, value: 10 },
      { cost: 3, value: 35 },
      { cost: 4, value: 50 },
    ],
  },
  creature_luck: {
    label: 'Creature Luck',
    tiers: [
      { cost: 1, value: 15 },
      { cost: 2, value: 30 },
      { cost: 3, value: 45 },
      { cost: 4, value: 60 },
      { cost: 5, value: 75 },
      { cost: 6, value: 90 },
    ],
  },
  dungeon_token_chance: {
    label: 'Dungeon Token Chance',
    tiers: [
      { cost: 5, value: 1.5 },
      { cost: 5, value: 3.5 },
      { cost: 5, value: 6 },
      { cost: 5, value: 9 },
    ],
  },
  crit_chance: {
    label: 'Player / Allies Crit Chance',
    tiers: [
      { cost: 1, value: 1 },
      { cost: 2, value: 3 },
      { cost: 3, value: 5 },
      { cost: 4, value: 7 },
      { cost: 5, value: 10 },
    ],
  },
  crit_damage: {
    label: 'Player / Allies Crit Damage',
    tiers: [
      { cost: 1, value: 5 },
      { cost: 2, value: 10 },
      { cost: 3, value: 20 },
      { cost: 4, value: 35 },
      { cost: 5, value: 55 },
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
