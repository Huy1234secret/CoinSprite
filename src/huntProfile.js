const fs = require('fs');
const path = require('path');

const HUNT_DATA_FILE = path.join(__dirname, '..', 'data', 'hunt_profiles.json');
const {
  FIST_GEAR,
  KNOWN_GEAR,
  HUNT_UPGRADE_TOKEN_ITEM,
  CHAT_UPGRADE_TOKEN_ITEM,
  WOODEN_SWORD_GEAR,
  ITEMS,
  ITEMS_BY_ID,
} = require('./items');
const { DEFAULT_HUNT_UPGRADES, normalizeHuntUpgrades } = require('./huntUpgrades');

const CURRENT_UPGRADE_RESET_VERSION = 1;

function calculateNextLevelXp(level) {
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  const levelForRequirement = Math.min(safeLevel, 99);
  return 100 + levelForRequirement * 50;
}

const DEFAULT_PROFILE = {
  level: 0,
  xp: 0,
  next_level_xp: calculateNextLevelXp(0),
  health: 100,
  max_health: 100,
  defense: 0,
  coins: 0,
  upgrade_tokens: 0,
  hunt_upgrade_tokens_used: 0,
  hunt_upgrades: { ...DEFAULT_HUNT_UPGRADES },
  upgrade_reset_version: 0,
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
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  return Math.round(baseHealth + safeLevel * 25);
}

function applyUpgradeReset(profile) {
  const resetVersion = Number.isFinite(profile.upgrade_reset_version)
    ? profile.upgrade_reset_version
    : 0;

  if (resetVersion >= CURRENT_UPGRADE_RESET_VERSION) {
    return profile;
  }

  return {
    ...profile,
    upgrade_reset_version: CURRENT_UPGRADE_RESET_VERSION,
    hunt_upgrade_tokens_used: 0,
    hunt_upgrades: { ...DEFAULT_HUNT_UPGRADES },
  };
}

function ensureProfileShape(profile = {}) {
  const normalizedGearInventory = normalizeGearInventory(
    Array.isArray(profile.gear_inventory) ? profile.gear_inventory : []
  );
  const normalizedEquipped = profile.gear_equipped ? normalizeGearItem(profile.gear_equipped) : null;
  const matchedGear = normalizedGearInventory.find((item) => item?.name === normalizedEquipped?.name);
  const gearEquipped = matchedGear ?? (normalizedGearInventory[0] || null);
  const level = Math.min(100, Math.max(0, Math.floor(Number(profile.level) || DEFAULT_PROFILE.level)));
  const xpValue = Number(profile.xp);
  const xp = Math.max(0, Number.isFinite(xpValue) ? xpValue : DEFAULT_PROFILE.xp);
  const scaledHealth = calculatePlayerMaxHealth(level, DEFAULT_PROFILE.max_health);
  const currentHealth = Number.isFinite(profile.health) ? profile.health : scaledHealth;

  let normalized = {
    ...DEFAULT_PROFILE,
    ...profile,
    level,
    xp,
    next_level_xp: calculateNextLevelXp(level),
    gear_equipped: gearEquipped,
    gear_inventory: normalizedGearInventory,
    misc_inventory: Array.isArray(profile.misc_inventory) ? profile.misc_inventory : [],
    max_health: scaledHealth,
    health: Math.min(scaledHealth, currentHealth),
    coins: typeof profile.coins === 'number' ? profile.coins : DEFAULT_PROFILE.coins,
    upgrade_tokens:
      typeof profile.upgrade_tokens === 'number' ? profile.upgrade_tokens : DEFAULT_PROFILE.upgrade_tokens,
    hunt_upgrade_tokens_used:
      typeof profile.hunt_upgrade_tokens_used === 'number'
        ? profile.hunt_upgrade_tokens_used
        : DEFAULT_PROFILE.hunt_upgrade_tokens_used,
    hunt_upgrades: normalizeHuntUpgrades(profile.hunt_upgrades),
    inventory_capacity:
      typeof profile.inventory_capacity === 'number'
        ? profile.inventory_capacity
        : DEFAULT_PROFILE.inventory_capacity,
    upgrade_reset_version:
      typeof profile.upgrade_reset_version === 'number'
        ? profile.upgrade_reset_version
        : DEFAULT_PROFILE.upgrade_reset_version,
  };

  normalized = applyUpgradeReset(normalized);

  return normalized;
}

function addItemToInventory(profile, item, amount = 1) {
  if (!item || typeof item !== 'object') {
    return profile;
  }

  const safeAmount = Math.max(0, amount);
  if (safeAmount === 0) {
    return profile;
  }

  const miscInventory = Array.isArray(profile.misc_inventory) ? [...profile.misc_inventory] : [];
  const existingIndex = miscInventory.findIndex((entry) => entry?.name === item.name);

  if (existingIndex >= 0) {
    const existing = miscInventory[existingIndex];
    const currentAmount = Number.isFinite(existing.amount) ? existing.amount : 1;
    miscInventory[existingIndex] = { ...existing, ...item, amount: currentAmount + safeAmount };
  } else {
    miscInventory.push({ ...item, amount: safeAmount });
  }

  profile.misc_inventory = miscInventory;
  return profile;
}

function setInventoryItemAmount(profile, item, amount) {
  if (!item || typeof item !== 'object') {
    return profile;
  }

  const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
  const miscInventory = Array.isArray(profile.misc_inventory) ? [...profile.misc_inventory] : [];
  const existingIndex = miscInventory.findIndex((entry) => entry?.name === item.name);

  if (safeAmount === 0) {
    if (existingIndex >= 0) {
      miscInventory.splice(existingIndex, 1);
    }
    profile.misc_inventory = miscInventory;
    return profile;
  }

  if (existingIndex >= 0) {
    miscInventory[existingIndex] = { ...miscInventory[existingIndex], ...item, amount: safeAmount };
  } else {
    miscInventory.push({ ...item, amount: safeAmount });
  }

  profile.misc_inventory = miscInventory;
  return profile;
}

function ensureHuntUpgradeTokenBalance(profile) {
  if (!HUNT_UPGRADE_TOKEN_ITEM) {
    return profile;
  }

  const used = Number.isFinite(profile.hunt_upgrade_tokens_used) ? profile.hunt_upgrade_tokens_used : 0;
  const expected = Math.max(0, Math.floor(Number(profile.level) || 0) - used);
  profile.upgrade_tokens = expected;
  return setInventoryItemAmount(profile, HUNT_UPGRADE_TOKEN_ITEM, expected);
}

function getUserProfile(userId) {
  const profiles = loadProfiles();
  const userKey = String(userId);
  const existing = ensureHuntUpgradeTokenBalance(ensureProfileShape(profiles[userKey]));
  const scaledHealth = calculatePlayerMaxHealth(existing.level, DEFAULT_PROFILE.max_health);
  existing.health = scaledHealth;
  existing.max_health = scaledHealth;
  profiles[userKey] = existing;
  saveProfiles(profiles);
  return existing;
}

function updateUserProfile(userId, profile) {
  const profiles = loadProfiles();
  profiles[String(userId)] = ensureHuntUpgradeTokenBalance(ensureProfileShape(profile));
  saveProfiles(profiles);
}

module.exports = {
  DEFAULT_PROFILE,
  ITEMS,
  FIST_GEAR,
  KNOWN_GEAR,
  ITEMS_BY_ID,
  WOODEN_SWORD_GEAR,
  CHAT_UPGRADE_TOKEN_ITEM,
  calculatePlayerMaxHealth,
  calculateNextLevelXp,
  addItemToInventory,
  setInventoryItemAmount,
  ensureHuntUpgradeTokenBalance,
  getUserProfile,
  normalizeGearInventory,
  normalizeGearItem,
  updateUserProfile,
};
