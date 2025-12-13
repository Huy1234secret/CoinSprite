const fs = require('fs');
const path = require('path');

const HUNT_DATA_FILE = path.join(__dirname, '..', 'data', 'hunt_profiles.json');

const FIST_GEAR = {
  id: 'ITFist',
  name: 'Fist',
  emoji: '<:ITFist:1449009707355476069>',
  rarity: 'Common',
  type: 'Tool/Gear',
  value: 0,
  sellPrice: 0,
  tradable: false,
  durability: Infinity,
  maxDurability: Infinity,
  damage: { min: 1, max: 5 },
  info: 'Useable as a gear in Hunt, deal 1 - 5 damages per hit.'
};

const WOODEN_SWORD_GEAR = {
  id: 'ITWoodenSword',
  name: 'Wooden Sword',
  emoji: '<:ITWoodenSword:1448987035363704955>',
  rarity: 'Common',
  type: 'Tool/Gear',
  value: 13,
  sellPrice: 100,
  tradable: true,
  durability: 50,
  maxDurability: 50,
  damage: { min: 3, max: 8 },
  info: 'Useable as a gear in Hunt, deal 3 - 8 damages per hit. Lose 1 durability per hit.'
};

const UPGRADE_TOKEN_ITEM = {
  id: 'ITUpgradeToken',
  name: 'Upgrade Token',
  emoji: '<:ITUpgradeToken:1447502158059540481>',
  rarity: 'Rare',
  type: 'Material',
  value: 300,
  sellPrice: null,
  tradable: false,
  durability: null,
  info: 'Coming soon'
};

const KNOWN_GEAR = {
  [FIST_GEAR.name]: FIST_GEAR,
  [WOODEN_SWORD_GEAR.name]: WOODEN_SWORD_GEAR
};

const DEFAULT_PROFILE = {
  level: 1,
  xp: 0,
  next_level_xp: 100,
  health: 100,
  max_health: 100,
  defense: 0,
  coins: 0,
  upgrade_tokens: 0,
  gear_equipped: null,
  misc_equipped: null,
  gear_inventory: [],
  misc_inventory: [],
  inventory_capacity: 50
};

function loadProfiles() {
  if (!fs.existsSync(HUNT_DATA_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(HUNT_DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (error) {
    console.warn('Failed to read hunt profiles; starting fresh.', error);
    return {};
  }
}

function saveProfiles(profiles) {
  const safeProfiles = typeof profiles === 'object' && profiles !== null ? profiles : {};
  fs.mkdirSync(path.dirname(HUNT_DATA_FILE), { recursive: true });
  fs.writeFileSync(HUNT_DATA_FILE, JSON.stringify(safeProfiles));
}

function normalizeGearItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const lookupKey = item.name ?? item.id;
  const known = lookupKey ? KNOWN_GEAR[lookupKey] : null;
  const base = known ? { ...known } : { ...item };
  const durability = Number.isFinite(item.durability) ? item.durability : base.durability;

  return {
    ...base,
    ...item,
    durability,
    maxDurability:
      item.maxDurability ?? (Number.isFinite(base.maxDurability) ? base.maxDurability : durability),
  };
}

function normalizeGearInventory(list) {
  return list.map(normalizeGearItem).filter(Boolean);
}

function calculatePlayerMaxHealth(level, baseHealth = DEFAULT_PROFILE.max_health) {
  return Math.round(baseHealth * Math.pow(1.25, Math.max(0, level - 1)));
}

function ensureProfileShape(profile = {}) {
  const normalizedGearInventory = normalizeGearInventory(
    Array.isArray(profile.gear_inventory) ? profile.gear_inventory : []
  );
  const normalizedEquipped = profile.gear_equipped ? normalizeGearItem(profile.gear_equipped) : null;
  const gearEquipped = normalizedGearInventory.some((item) => item?.name === normalizedEquipped?.name)
    ? normalizedEquipped
    : normalizedGearInventory[0] || null;

  return {
    ...DEFAULT_PROFILE,
    ...profile,
    gear_equipped: gearEquipped,
    gear_inventory: normalizedGearInventory,
    misc_inventory: Array.isArray(profile.misc_inventory) ? profile.misc_inventory : [],
    max_health: typeof profile.max_health === 'number' ? profile.max_health : DEFAULT_PROFILE.max_health,
    coins: typeof profile.coins === 'number' ? profile.coins : DEFAULT_PROFILE.coins,
    upgrade_tokens:
      typeof profile.upgrade_tokens === 'number' ? profile.upgrade_tokens : DEFAULT_PROFILE.upgrade_tokens,
    inventory_capacity:
      typeof profile.inventory_capacity === 'number'
        ? profile.inventory_capacity
        : DEFAULT_PROFILE.inventory_capacity,
  };
}

function getUserProfile(userId) {
  const profiles = loadProfiles();
  const userKey = String(userId);
  const existing = ensureProfileShape(profiles[userKey]);
  const scaledHealth = calculatePlayerMaxHealth(existing.level, DEFAULT_PROFILE.max_health);
  existing.health = scaledHealth;
  existing.max_health = scaledHealth;
  profiles[userKey] = existing;
  saveProfiles(profiles);
  return existing;
}

function updateUserProfile(userId, profile) {
  const profiles = loadProfiles();
  profiles[String(userId)] = ensureProfileShape(profile);
  saveProfiles(profiles);
}

module.exports = {
  DEFAULT_PROFILE,
  FIST_GEAR,
  KNOWN_GEAR,
  UPGRADE_TOKEN_ITEM,
  WOODEN_SWORD_GEAR,
  calculatePlayerMaxHealth,
  getUserProfile,
  normalizeGearInventory,
  normalizeGearItem,
  updateUserProfile,
};
