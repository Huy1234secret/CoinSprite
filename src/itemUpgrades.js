const COIN_EMOJI = '<:CRCoin:1447459216574124074>';

const ITEM_UPGRADE_MAX_SLOTS = 1;

const ITEM_UPGRADES = [
  {
    key: 'backpack_inventory_1',
    name: 'Backpack Inventory 1',
    requirementKey: null,
    cost: [{ type: 'coins', amount: 100000, label: 'coins', emoji: COIN_EMOJI }],
    inventoryCapacity: 600,
    durationSeconds: 3600,
    alwaysAvailable: true,
  },
  {
    key: 'backpack_inventory_2',
    name: 'Backpack Inventory 2',
    requirementKey: 'backpack_inventory_1',
    cost: [{ type: 'coins', amount: 800000, label: 'coins', emoji: COIN_EMOJI }],
    inventoryCapacity: 800,
    durationSeconds: 14400,
    alwaysAvailable: true,
  },
  {
    key: 'backpack_inventory_3',
    name: 'Backpack Inventory 3',
    requirementKey: 'backpack_inventory_2',
    cost: [{ type: 'coins', amount: 3000000, label: 'coins', emoji: COIN_EMOJI }],
    inventoryCapacity: 1100,
    durationSeconds: 43200,
    alwaysAvailable: true,
  },
  {
    key: 'backpack_inventory_4',
    name: 'Backpack Inventory 4',
    requirementKey: 'backpack_inventory_3',
    cost: [{ type: 'coins', amount: 25000000, label: 'coins', emoji: COIN_EMOJI }],
    inventoryCapacity: 1500,
    durationSeconds: 86400,
    alwaysAvailable: true,
  },
  {
    key: 'backpack_inventory_5',
    name: 'Backpack Inventory 5',
    requirementKey: 'backpack_inventory_4',
    cost: [{ type: 'coins', amount: 99000000, label: 'coins', emoji: COIN_EMOJI }],
    inventoryCapacity: 2000,
    durationSeconds: 172800,
    alwaysAvailable: true,
  },
  {
    key: 'backpack_inventory_6',
    name: 'Backpack Inventory 6',
    requirementKey: 'backpack_inventory_5',
    cost: [{ type: 'coins', amount: 456000000, label: 'coins', emoji: COIN_EMOJI }],
    inventoryCapacity: 2600,
    durationSeconds: 360000,
    alwaysAvailable: true,
  },
];

const ITEM_UPGRADES_BY_KEY = new Map(ITEM_UPGRADES.map((upgrade) => [upgrade.key, upgrade]));

function getItemUpgradeDefinition(key) {
  return ITEM_UPGRADES_BY_KEY.get(key) ?? null;
}

function getOwnedItemUpgrades(profile) {
  if (!profile || typeof profile.item_upgrades !== 'object' || profile.item_upgrades === null) {
    return new Set();
  }

  return new Set(Object.keys(profile.item_upgrades).filter((key) => profile.item_upgrades[key]));
}

function hasItemUpgrade(profile, upgradeKey) {
  return Boolean(profile?.item_upgrades?.[upgradeKey]);
}

module.exports = {
  COIN_EMOJI,
  ITEM_UPGRADES,
  ITEM_UPGRADE_MAX_SLOTS,
  getItemUpgradeDefinition,
  getOwnedItemUpgrades,
  hasItemUpgrade,
};
