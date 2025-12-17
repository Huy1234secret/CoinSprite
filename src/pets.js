const fs = require('fs');
const path = require('path');

const PET_DATA_FILE = path.join(__dirname, '..', 'data', 'pet_profiles.json');

const RARITY_EMOJIS = {
  Common: '<:SBCommon:1447459423185272952>',
  Rare: '<:SBRare:1447459432165408789>',
  Epic: '<:SBEpic:1447459425303527465>',
  Legendary: '<:SBLegendary:1447459428273098835>',
  Mythical: '<:SBMythical:1447459430760317172>',
  Secret: '<:SBSecret:1447459434677665874>',
};

const RARITY_MULTIPLIERS = {
  Common: 1,
  Rare: 1.25,
  Epic: 1.8,
  Legendary: 2.5,
  Mythical: 3.75,
  Secret: 5,
};

const PET_LEVEL_CAP = 100;
const PET_BASE_GROWTH = 1.069; // ~100 -> 100,000 over 100 levels

const PETS = [
  {
    id: 'PETUFO',
    name: 'UFO',
    emoji: '<:PETUFO:1450110098692112384>',
    rarity: 'Secret',
    rarityEmoji: RARITY_EMOJIS.Secret,
    value: 7777,
    sellable: false,
    tradable: false,
    adminOnly: true,
    baseHealth: 1000,
    attacks: [
      {
        name: 'Laser Beam',
        type: 'Singular',
        hits: 1,
        damage: { min: 300, max: 500 },
      },
    ],
  },
];

function loadPetProfiles() {
  if (!fs.existsSync(PET_DATA_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(PET_DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    console.warn('Failed to read pet profiles; starting fresh.', error);
    return {};
  }
}

function savePetProfiles(profiles) {
  const safeProfiles = typeof profiles === 'object' && profiles !== null ? profiles : {};
  fs.mkdirSync(path.dirname(PET_DATA_FILE), { recursive: true });
  fs.writeFileSync(PET_DATA_FILE, JSON.stringify(safeProfiles));
}

function getPetDefinition(id) {
  return PETS.find((pet) => pet.id === id) || null;
}

function getRarityEmoji(rarity) {
  return RARITY_EMOJIS[rarity] ?? '';
}

function getRarityMultiplier(rarity) {
  return RARITY_MULTIPLIERS[rarity] ?? 1;
}

function calculatePetXpRequirement(level, rarity) {
  if (level >= PET_LEVEL_CAP) {
    return null;
  }

  const base = Math.ceil(100 * Math.pow(PET_BASE_GROWTH, level));
  return Math.ceil(base * getRarityMultiplier(rarity));
}

function normalizePetInstance(pet) {
  if (!pet || typeof pet !== 'object') {
    return null;
  }

  const definition = getPetDefinition(pet.id) ?? {};
  const rarity = pet.rarity ?? definition.rarity ?? 'Common';
  const level = Math.max(0, Math.min(PET_LEVEL_CAP, pet.level ?? 0));
  const xp = Math.max(0, pet.xp ?? 0);
  const nextLevelXp = calculatePetXpRequirement(level, rarity);

  return {
    ...definition,
    ...pet,
    level,
    xp,
    rarity,
    rarityEmoji: definition.rarityEmoji ?? getRarityEmoji(rarity),
    nextLevelXp,
    instanceId: pet.instanceId ?? `pet-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };
}

function ensurePetProfile(profile = {}) {
  const inventory = Array.isArray(profile.inventory) ? profile.inventory.map(normalizePetInstance).filter(Boolean) : [];
  const team = Array.isArray(profile.team)
    ? profile.team.map((entry) => ({
        petInstanceId: entry?.petInstanceId ?? null,
        targetType: entry?.targetType ?? 'Random',
      }))
    : [{ petInstanceId: null, targetType: 'Random' }, { petInstanceId: null, targetType: 'Random' }, { petInstanceId: null, targetType: 'Random' }];

  return { inventory, team };
}

function getUserPetProfile(userId) {
  const profiles = loadPetProfiles();
  const userKey = String(userId);
  const profile = ensurePetProfile(profiles[userKey]);
  profiles[userKey] = profile;
  savePetProfiles(profiles);
  return profile;
}

function updateUserPetProfile(userId, profile) {
  const profiles = loadPetProfiles();
  profiles[String(userId)] = ensurePetProfile(profile);
  savePetProfiles(profiles);
  return profiles[String(userId)];
}

function addPetToInventory(userId, petId) {
  const profile = getUserPetProfile(userId);
  const definition = getPetDefinition(petId);
  if (!definition) {
    return profile;
  }

  const newPet = normalizePetInstance({ id: petId, level: 0, xp: 0 });
  profile.inventory.push(newPet);
  return updateUserPetProfile(userId, profile);
}

function findPetInstance(profile, instanceId) {
  return profile.inventory.find((pet) => pet.instanceId === instanceId) ?? null;
}

function scalePetHealth(base, level) {
  return Math.ceil(base * Math.pow(1.5, Math.max(0, level)));
}

function scalePetDamage(damage, level) {
  const min = Math.ceil((damage?.min ?? 1) * Math.pow(1.35, Math.max(0, level)));
  const max = Math.ceil((damage?.max ?? min) * Math.pow(1.35, Math.max(0, level)));
  return { min, max };
}

function buildBattlePet(petSlot, profile) {
  if (!petSlot?.petInstanceId) {
    return null;
  }

  const pet = findPetInstance(profile, petSlot.petInstanceId);
  if (!pet) {
    return null;
  }

  const definition = getPetDefinition(pet.id);
  if (!definition) {
    return null;
  }

  const baseAttack = definition.attacks?.[0];
  const damage = scalePetDamage(baseAttack?.damage ?? { min: 1, max: 1 }, pet.level);
  const maxHealth = scalePetHealth(definition.baseHealth ?? 1, pet.level);

  return {
    name: pet.name ?? definition.name,
    emoji: pet.emoji ?? definition.emoji,
    rarity: pet.rarity ?? definition.rarity,
    rarityEmoji: pet.rarityEmoji ?? definition.rarityEmoji,
    level: pet.level ?? 0,
    attackType: baseAttack?.type ?? 'Singular',
    hits: baseAttack?.hits ?? 1,
    damage,
    targetType: petSlot.targetType ?? 'Random',
    maxHealth,
    health: maxHealth,
    instanceId: pet.instanceId,
  };
}

function buildBattlePets(profile) {
  return (profile.team ?? []).map((slot) => buildBattlePet(slot, profile)).filter(Boolean);
}

module.exports = {
  PETS,
  PET_LEVEL_CAP,
  RARITY_EMOJIS,
  addPetToInventory,
  buildBattlePets,
  calculatePetXpRequirement,
  getPetDefinition,
  getRarityEmoji,
  getUserPetProfile,
  updateUserPetProfile,
  findPetInstance,
  buildBattlePet,
  scalePetHealth,
  scalePetDamage,
};
