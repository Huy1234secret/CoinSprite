const FISHING_ROD_ID = 'fishing_rod';
const WORM_ID = 'worm';
const BUCKET_OF_WORMS_ID = 'bucket_of_worms';

const RARITY_EMOJIS = {
  common: '<:SBCommon:1500170919614873720>',
  rare: '<:SBRare:1500170929794449642>',
  epic: '<:SBEpic:1500170921623945356>',
  legendary: '<:SBLegendary:1500170923398008882>',
  mythical: '<:SBMythical:1500170927378534621>',
  secret: '<:SBSecret:1500170932235276398>',
};

const RARITY_LABELS = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythical: 'Mythical',
  secret: 'Secret',
};

const SHOP_TYPES = {
  general: {
    label: 'General Shop',
    emoji: { id: '1497972406030176356', name: 'PRcoin' },
  },
  exclusive: {
    label: 'Exclusive Shop',
    emoji: { id: '1498172292511825950', name: 'JPcoin' },
  },
};

const ITEMS = [
  {
    id: FISHING_ROD_ID,
    name: 'Fishing rod',
    rarity: 'common',
    emoji: '<:ICFishingrod:1499589442518913296>',
    emojiObject: { id: '1499589442518913296', name: 'ICFishingrod' },
    stockMin: 1,
    stockMax: 3,
    price: 10_000,
    description: 'an item use for fishing',
    shop: 'general',
    type: 'Gear/Tool',
    gear: true,
    baseDurability: 100,
    baseStrength: 1,
  },
  {
    id: WORM_ID,
    name: 'Worm',
    rarity: 'common',
    emoji: '<:ICWorm:1499589444590768188>',
    emojiObject: { id: '1499589444590768188', name: 'ICWorm' },
    stockMin: null,
    stockMax: null,
    price: 100,
    baseValue: 100,
    description: 'an item use for fishing',
    shop: null,
    type: 'Ingredient',
  },
  {
    id: BUCKET_OF_WORMS_ID,
    name: 'Bucket of Worms',
    rarity: 'common',
    emoji: '<:ICBucketofworms:1499589440362905740>',
    emojiObject: { id: '1499589440362905740', name: 'ICBucketofworms' },
    stockMin: 5,
    stockMax: 10,
    price: 2_000,
    description: 'upon use /use on this item, player gain 5 - 10 worms',
    shop: 'general',
    type: 'Useable item',
    usable: true,
  },
];

const FISHES = [
  { id: 'fish_anchovy', name: 'Anchovy', rarity: 'common', emoji: '<:FCAnchovy:1499275834345783456>', baseValue: 100, chance: 16.00, durabilityDamage: 1, rodStrengthRequirement: 1 },
  { id: 'fish_herring', name: 'Herring', rarity: 'common', emoji: '<:FCHerring:1499275841237024818>', baseValue: 140, chance: 13.50, durabilityDamage: 1, rodStrengthRequirement: 2 },
  { id: 'fish_sardine', name: 'Sardine', rarity: 'common', emoji: '<:FCSardine:1499275844915560498>', baseValue: 180, chance: 11.50, durabilityDamage: 1, rodStrengthRequirement: 2 },
  { id: 'fish_mackerel', name: 'Mackerel', rarity: 'common', emoji: '<:FCMackerel:1499275843073998909>', baseValue: 220, chance: 9.50, durabilityDamage: 1, rodStrengthRequirement: 3 },
  { id: 'fish_clownfish', name: 'Clownfish', rarity: 'common', emoji: '<:FCClownfish:1499275838955323433>', baseValue: 260, chance: 8.00, durabilityDamage: 1, rodStrengthRequirement: 4 },
  { id: 'fish_blue_tang', name: 'Blue Tang', rarity: 'common', emoji: '<:FCBluetang:1499275836589867048>', baseValue: 300, chance: 6.50, durabilityDamage: 2, rodStrengthRequirement: 5 },
  { id: 'fish_sea_bass', name: 'Sea Bass', rarity: 'common', emoji: '<:FCSeabass:1499275846886752256>', baseValue: 350, chance: 5.00, durabilityDamage: 2, rodStrengthRequirement: 6 },
  { id: 'fish_needlefish', name: 'Needlefish', rarity: 'rare', emoji: '<:FRNeedlefish:1499276609327333436>', baseValue: 500, chance: 7.20, durabilityDamage: 2, rodStrengthRequirement: 10 },
  { id: 'fish_pufferfish', name: 'Pufferfish', rarity: 'rare', emoji: '<:FRPufferfish:1499276613655855264>', baseValue: 700, chance: 6.10, durabilityDamage: 2, rodStrengthRequirement: 12 },
  { id: 'fish_parrotfish', name: 'Parrotfish', rarity: 'rare', emoji: '<:FRParrotfish:1499276611348992120>', baseValue: 900, chance: 5.10, durabilityDamage: 3, rodStrengthRequirement: 14 },
  { id: 'fish_triggerfish', name: 'Triggerfish', rarity: 'rare', emoji: '<:FRTriggerfish:1499276615774109707>', baseValue: 1100, chance: 4.30, durabilityDamage: 3, rodStrengthRequirement: 16 },
  { id: 'fish_lionfish', name: 'Lionfish', rarity: 'rare', emoji: '<:FRLionfish:1499276607100026990>', baseValue: 1300, chance: 3.40, durabilityDamage: 4, rodStrengthRequirement: 19 },
  { id: 'fish_barracuda', name: 'Barracuda', rarity: 'rare', emoji: '<:FRBarracuda:1499276605149806682>', baseValue: 1500, chance: 2.90, durabilityDamage: 4, rodStrengthRequirement: 22 },
  { id: 'fish_moray_eel', name: 'Moray Eel', rarity: 'epic', emoji: '<:FEMorayeel:1499280516304601108>', baseValue: 3500, chance: 0.280, durabilityDamage: 6, rodStrengthRequirement: 35 },
  { id: 'fish_oarfish', name: 'Oarfish', rarity: 'epic', emoji: '<:FEOarfish:1499280518263607446>', baseValue: 4500, chance: 0.220, durabilityDamage: 7, rodStrengthRequirement: 40 },
  { id: 'fish_mahi_mahi', name: 'Mahi Mahi', rarity: 'epic', emoji: '<:FEMahimahi:1499280692004257894>', baseValue: 6000, chance: 0.180, durabilityDamage: 8, rodStrengthRequirement: 45 },
  { id: 'fish_swordfish', name: 'Swordfish', rarity: 'epic', emoji: '<:FESwordfish:1499280520037798008>', baseValue: 7500, chance: 0.140, durabilityDamage: 9, rodStrengthRequirement: 50 },
  { id: 'fish_giant_trevally', name: 'Giant Trevally', rarity: 'epic', emoji: '<:FEGianttrevally:1499280509509959801>', baseValue: 8500, chance: 0.100, durabilityDamage: 10, rodStrengthRequirement: 55 },
  { id: 'fish_hammerhead_shark', name: 'Hammerhead Shark', rarity: 'epic', emoji: '<:FEHammerheadshark:1499280511883808840>', baseValue: 10000, chance: 0.070, durabilityDamage: 12, rodStrengthRequirement: 60 },
  { id: 'fish_blue_marlin', name: 'Blue Marlin', rarity: 'legendary', emoji: '<:FLBluemarlin:1499288460052140042>', baseValue: 12500, chance: 0.00300, durabilityDamage: 18, rodStrengthRequirement: 80 },
  { id: 'fish_giant_squid', name: 'Giant Squid', rarity: 'legendary', emoji: '<:FLGiantsquid:1499288462191235192>', baseValue: 16500, chance: 0.00225, durabilityDamage: 22, rodStrengthRequirement: 90 },
  { id: 'fish_great_white_shark', name: 'Great White Shark', rarity: 'legendary', emoji: '<:FLGreatwhiteshark:1499288464330457108>', baseValue: 21000, chance: 0.00175, durabilityDamage: 26, rodStrengthRequirement: 100 },
  { id: 'fish_megamouth_shark', name: 'Megamouth Shark', rarity: 'legendary', emoji: '<:FLMegamouthshark:1499288466134143076>', baseValue: 26000, chance: 0.00125, durabilityDamage: 30, rodStrengthRequirement: 110 },
  { id: 'fish_whale_shark', name: 'Whale Shark', rarity: 'legendary', emoji: '<:FLWhaleshark:1499288468260393030>', baseValue: 35000, chance: 0.00125, durabilityDamage: 35, rodStrengthRequirement: 125 },
  { id: 'fish_crystal_angler', name: 'Crystal Angler', rarity: 'mythical', emoji: '<:FMCrystalangler:1499290934930571364>', baseValue: 50000, chance: 0.000155, durabilityDamage: 50, rodStrengthRequirement: 160 },
  { id: 'fish_moonfin_koi', name: 'Moonfin Koi', rarity: 'mythical', emoji: '<:FMMoonfinkoi:1499290937094967399>', baseValue: 85000, chance: 0.000120, durabilityDamage: 60, rodStrengthRequirement: 180 },
  { id: 'fish_phantom_ray', name: 'Phantom Ray', rarity: 'mythical', emoji: '<:FMPhantomray:1499290939007696976>', baseValue: 125000, chance: 0.000090, durabilityDamage: 75, rodStrengthRequirement: 210 },
  { id: 'fish_stormscale_tuna', name: 'Stormscale Tuna', rarity: 'mythical', emoji: '<:FMStormscaletuna:1499290940995797044>', baseValue: 185000, chance: 0.000070, durabilityDamage: 90, rodStrengthRequirement: 240 },
  { id: 'fish_abyssal_leviathan', name: 'Abyssal Leviathan Fish', rarity: 'mythical', emoji: '<:FMAbyssalLeviathanFish:1499290932779024434>', baseValue: 250000, chance: 0.000064, durabilityDamage: 120, rodStrengthRequirement: 300 },
  { id: 'fish_golden_kraken_fry', name: 'Golden Kraken Fry', rarity: 'secret', emoji: '<:FSGoldenkrakenfry:1499302542058717274>', baseValue: 450000, chance: 0.00000035, durabilityDamage: 180, rodStrengthRequirement: 450 },
  { id: 'fish_glitched_fish', name: 'Glitched Fish', rarity: 'secret', emoji: '<:FSGlitchedfish:1499302540087529472>', baseValue: 800000, chance: 0.00000025, durabilityDamage: 220, rodStrengthRequirement: 525 },
  { id: 'fish_void_fish', name: 'Void Fish', rarity: 'secret', emoji: '<:FSVoidfish:1499302544516841562>', baseValue: 1200000, chance: 0.00000018, durabilityDamage: 300, rodStrengthRequirement: 600 },
  { id: 'fish_celestial_coelacanth', name: 'Celestial Coelacanth', rarity: 'secret', emoji: '<:FSCelestialCoelacanth:1499302537390460958>', baseValue: 1600000, chance: 0.00000012, durabilityDamage: 400, rodStrengthRequirement: 750 },
  { id: 'fish_ancient_megalodon', name: 'Ancient Megalodon', rarity: 'secret', emoji: '<:FSAncientMegalodon:1499302534823542885>', baseValue: 2000000, chance: 0.00000010, durabilityDamage: 500, rodStrengthRequirement: 900 },
];

const ALL_COLLECTABLES = [
  ...ITEMS,
  ...FISHES.map((fish) => ({
    ...fish,
    description: `${RARITY_LABELS[fish.rarity]} rarity ✨ fish`,
    type: 'Fish',
    baseValue: fish.baseValue,
    price: null,
  })),
];

const ITEM_BY_ID = Object.fromEntries(ALL_COLLECTABLES.map((item) => [item.id, item]));
const FISH_BY_ID = Object.fromEntries(FISHES.map((fish) => [fish.id, fish]));

const FISHING_UPGRADES = {
  luck: {
    name: '<:SBLU:1499716437931982991> Luck Upgrade',
    perk: '+10% luck per tier',
    basePrice: 1_000,
    scaling: 1.25,
    maxTier: 50,
  },
  value: {
    name: '<:SBFV:1499716435562467409> Fish value',
    perk: '+15% fish value per tier',
    basePrice: 10_000,
    scaling: 1.65,
    maxTier: 25,
  },
  strength: {
    name: '<:SBFRS:1499716433473441912> Fishing rod strenght',
    perk: '+20 strength per tier',
    basePrice: 2_500,
    scaling: 1.275,
    maxTier: 45,
  },
  durability: {
    name: '<:SBFRD:1499716429568671775> Fishing rod durability',
    perk: 'Fixed durability tiers',
    maxTier: 5,
    fixedTiers: [
      { tier: 1, perk: '+25 durability', price: 4_500, bonus: 25 },
      { tier: 2, perk: '+100 durability', price: 59_999, bonus: 100 },
      { tier: 3, perk: '+400 durability', price: 347_500, bonus: 400 },
      { tier: 4, perk: '+1,065 durability', price: 7_500_000, bonus: 1065 },
      { tier: 5, perk: '+1,500 durability', price: 36_750_000, bonus: 1500 },
    ],
  },
};

const BASE_RARITY_TOTALS = {
  common: 70,
  rare: 29,
  epic: 0.99,
  legendary: 0.0095,
  mythical: 0.000499,
  secret: 0.000001,
};

const MAX_LUCK_RARITY_TOTALS = {
  common: 35,
  rare: 45,
  epic: 15,
  legendary: 0.1,
  mythical: 0.01,
  secret: 0.001,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomInt(min, max) {
  const safeMin = Math.ceil(min);
  const safeMax = Math.floor(max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function romanize(value) {
  const number = Math.max(0, Math.floor(Number(value) || 0));
  if (number <= 0) return '0';
  const numerals = [
    ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1],
  ];
  let remaining = number;
  let output = '';
  for (const [symbol, amount] of numerals) {
    while (remaining >= amount) {
      output += symbol;
      remaining -= amount;
    }
  }
  return output;
}

function getFishingUpgradePrice(key, currentTier) {
  const config = FISHING_UPGRADES[key];
  const tier = Math.max(0, Math.floor(Number(currentTier) || 0));
  if (!config || tier >= config.maxTier) return null;
  if (key === 'durability') return config.fixedTiers[tier]?.price ?? null;
  return Math.round(config.basePrice * (config.scaling ** tier));
}

function getDurabilityBonus(tier) {
  const safeTier = clamp(Math.floor(Number(tier) || 0), 0, FISHING_UPGRADES.durability.maxTier);
  if (safeTier <= 0) return 0;
  return FISHING_UPGRADES.durability.fixedTiers[safeTier - 1]?.bonus ?? 0;
}

function getMaxRodDurability(durabilityTier = 0) {
  return (ITEM_BY_ID[FISHING_ROD_ID]?.baseDurability ?? 100) + getDurabilityBonus(durabilityTier);
}

function getTotalRodStrength(strengthTier = 0) {
  return (ITEM_BY_ID[FISHING_ROD_ID]?.baseStrength ?? 1) + (20 * Math.max(0, Math.floor(Number(strengthTier) || 0)));
}

function getFishFinalValue(fish, valueTier = 0) {
  return Math.round((fish?.baseValue ?? 0) * (1 + (0.15 * Math.max(0, Math.floor(Number(valueTier) || 0)))));
}

function getCollectableBaseValue(itemId) {
  const item = ITEM_BY_ID[itemId];
  if (!item) return 0;
  if (Number.isFinite(item.price) && item.price > 0) return Math.round(item.price * 0.10);
  return Math.max(0, Math.round(Number(item.baseValue) || 0));
}

function getLuckAdjustedRarityTotals(luckTier = 0) {
  const t = clamp((Number(luckTier) || 0) / FISHING_UPGRADES.luck.maxTier, 0, 1);
  const eased = 1 - ((1 - t) ** 1.35);
  const totals = {};
  for (const rarity of Object.keys(BASE_RARITY_TOTALS)) {
    const base = BASE_RARITY_TOTALS[rarity];
    const target = MAX_LUCK_RARITY_TOTALS[rarity];
    totals[rarity] = base + ((target - base) * eased);
  }
  return totals;
}

function getLuckAdjustedFishWeights(luckTier = 0) {
  const rarityTotals = getLuckAdjustedRarityTotals(luckTier);
  return FISHES.map((fish) => ({
    fish,
    weight: fish.chance * ((rarityTotals[fish.rarity] ?? 0) / (BASE_RARITY_TOTALS[fish.rarity] || 1)),
  })).filter((entry) => entry.weight > 0);
}

function rollFish(luckTier = 0) {
  const weights = getLuckAdjustedFishWeights(luckTier);
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll <= 0) return entry.fish;
  }
  return weights[weights.length - 1]?.fish || FISHES[0];
}

function calculateFishingProgressGain(strength, requirement) {
  const s = Math.max(0.001, Number(strength) || 0.001);
  const r = Math.max(0.001, Number(requirement) || 0.001);
  const ratio = s / r;
  if (s < r) return clamp(5 * ratio, 0, 5);
  return clamp(5.1 + (9.9 * (1 - (r / s))), 5.1, 15);
}

function emojiUrl(emoji) {
  const match = String(emoji || '').match(/<a?:\w+:(\d+)>/);
  return match ? `https://cdn.discordapp.com/emojis/${match[1]}.png` : null;
}

function getNextHourlyBoundaryUtcPlus7(now = new Date()) {
  const shifted = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  shifted.setUTCMinutes(0, 0, 0);
  shifted.setUTCHours(shifted.getUTCHours() + 1);
  return new Date(shifted.getTime() - (7 * 60 * 60 * 1000));
}

module.exports = {
  FISHING_ROD_ID,
  WORM_ID,
  BUCKET_OF_WORMS_ID,
  RARITY_EMOJIS,
  RARITY_LABELS,
  SHOP_TYPES,
  ITEMS,
  FISHES,
  ALL_COLLECTABLES,
  ITEM_BY_ID,
  FISH_BY_ID,
  FISHING_UPGRADES,
  clamp,
  randomInt,
  romanize,
  getFishingUpgradePrice,
  getDurabilityBonus,
  getMaxRodDurability,
  getTotalRodStrength,
  getFishFinalValue,
  getCollectableBaseValue,
  getLuckAdjustedRarityTotals,
  getLuckAdjustedFishWeights,
  rollFish,
  calculateFishingProgressGain,
  emojiUrl,
  getNextHourlyBoundaryUtcPlus7,
};
