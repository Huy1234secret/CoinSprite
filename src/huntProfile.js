const fs = require('fs');
const path = require('path');

const HUNT_DATA_FILE = path.join(__dirname, '..', 'data', 'hunt_profiles.json');
const {
  FIST_GEAR,
  KNOWN_GEAR,
  UPGRADE_TOKEN_ITEM,
  WOODEN_SWORD_GEAR,
  ITEMS,
  ITEMS_BY_ID,
} = require('./items');

function calculateNextLevelXp(level) {
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  if (safeLevel >= 100) {
    return 1000;
  }
  return Math.min(1000, 100 + safeLevel * 50);
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

  return {
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
    inventory_capacity:
      typeof profile.inventory_capacity === 'number'
        ? profile.inventory_capacity
        : DEFAULT_PROFILE.inventory_capacity,
  };
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
  ITEMS,
  FIST_GEAR,
  KNOWN_GEAR,
  UPGRADE_TOKEN_ITEM,
  ITEMS_BY_ID,
  WOODEN_SWORD_GEAR,
  calculatePlayerMaxHealth,
  calculateNextLevelXp,
  addItemToInventory,
  getUserProfile,
  normalizeGearInventory,
  normalizeGearItem,
  updateUserProfile,
};
