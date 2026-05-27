const FISH_EMOJI = '<:SBFish:1506659437165936690>';
const GOLDEN_FISH_EMOJI = '<:SBGoldenFish:1506659439502168245>';
const RAINBOW_FISH_EMOJI = '<a:SBRainbowFish:1506660311380398211>';

function normalizeId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripFishTier(value) {
  return String(value || '').replace(/\bF[1-7]\s+(?=[A-Z])/g, '');
}

const FISH = [
  ['<:F1Bluegill:1506653228245455039>', 'F1 Bluegill', 'common', 0.1, 1.0, 8, 10, 1, ['Freshwater', 'Lake', 'Pond', 'Small', 'Common', 'Surface', 'DayFish', 'Sunny', 'WarmWater']],
  ['<:F1CommonCarp:1506653230376030318>', 'F1 Common Carp', 'common', 1.0, 8.0, 12, 18, 1, ['Freshwater', 'Lake', 'Pond', 'Common', 'Peaceful', 'BottomFeeder', 'MuddyWater', 'Rain', 'Heat']],
  ['<:F1FatheadMinnow:1506653232146022531>', 'F1 Fathead Minnow', 'common', 0.02, 0.15, 5, 5, 1, ['Freshwater', 'Lake', 'Pond', 'River', 'Small', 'Common', 'BaitFish', 'Morning', 'CalmWater']],
  ['<:F1YellowPerch:1506653234419466290>', 'F1 Yellow Perch', 'common', 0.1, 1.5, 10, 12, 1, ['Freshwater', 'Lake', 'Common', 'SmallMedium', 'CoolWater', 'ColdWater', 'Fall', 'Winter', 'Snow']],
  ['<:F2BlackCrappie:1506653236512166019>', 'F2 Black Crappie', 'uncommon', 0.2, 2.0, 22, 25, 2, ['Freshwater', 'Lake', 'Pond', 'Uncommon', 'SmallMedium', 'LowLight', 'Fog', 'Night', 'Spring', 'Fall']],
  ['<:F2ChannelCatfish:1506653238605254798>', 'F2 Channel Catfish', 'uncommon', 1.5, 12.0, 30, 35, 2, ['Freshwater', 'Lake', 'River', 'Uncommon', 'BottomFeeder', 'MuddyWater', 'Night', 'Rain', 'Storm', 'Midnight']],
  ['<:F2RainbowTrout:1506653240756801708>', 'F2 Rainbow Trout', 'uncommon', 0.5, 4.0, 35, 40, 2, ['Freshwater', 'River', 'Lake', 'Uncommon', 'CoolWater', 'ColdWater', 'Rain', 'Fog', 'Storm', 'NoHeat']],
  ['<:F3LargemouthBass:1506653242506088478>', 'F3 Largemouth Bass', 'rare', 0.8, 6.0, 65, 65, 3, ['Freshwater', 'Lake', 'Pond', 'Rare', 'Predator', 'Large', 'WarmWater', 'DayFish', 'Sunny', 'Afternoon']],
  ['<:F3Walleye:1506653246255792198>', 'F3 Walleye', 'rare', 0.7, 5.5, 75, 75, 3, ['Freshwater', 'Lake', 'Rare', 'Predator', 'DeepWater', 'Night', 'Midnight', 'Fog', 'Storm', 'FullMoon']],
  ['<:F4NorthernPike:1506653248147292290>', 'F4 Northern Pike', 'epic', 2.0, 15.0, 140, 120, 5, ['Freshwater', 'Lake', 'River', 'Rare', 'Predator', 'Large', 'ColdWater', 'Wind', 'Snow', 'Fall', 'Winter']],
  ['<:F5LakeSturgeon:1506653250621935827>', 'F5 Lake Sturgeon', 'legendary', 8.0, 60.0, 350, 220, 8, ['Freshwater', 'Lake', 'VeryRare', 'AncientFish', 'Large', 'DeepWater', 'BottomFeeder', 'Night', 'Storm', 'Bloodmoon']],
  ['<:F6GoldenMahseer:1506653252530212975>', 'F6 Golden Mahseer', 'mythical', 3.0, 25.0, 850, 400, 12, ['Freshwater', 'River', 'Legendary', 'CurrentFish', 'FastWater', 'Rain', 'Storm', 'Thunder', 'Spring', 'Summer', 'NoWinter']],
  ['<:F7AsianArowana:1506653254677954700>', 'F7 Asian Arowana', 'secret', 2.0, 10.0, 2500, 750, 20, ['Freshwater', 'Lake', 'Legendary', 'Exotic', 'Surface', 'Predator', 'Tropical', 'Summer', 'Night', 'FullMoon', 'Bloodmoon']],
].map(([emoji, name, rarity, minWeight, maxWeight, sellValue, powerReq, durDamage, tags]) => ({
  id: normalizeId(name),
  emoji,
  name,
  displayName: stripFishTier(name),
  rarity,
  minWeight,
  maxWeight,
  sellValue,
  value: sellValue,
  powerReq,
  durDamage,
  tags: Array.isArray(tags) ? [...tags] : [],
  location: 'Calm Fishing Lake',
  obtainment: null,
  facts: null,
}));

const FISH_BY_ID = new Map(FISH.map((fish) => [fish.id, fish]));
const FISH_BY_NAME = new Map(FISH.map((fish) => [normalizeName(fish.name), fish]));
const RARITY_BUTTONS = { common: 2, uncommon: 3, rare: 4, epic: 6, legendary: 8, mythical: 10, secret: 15 };
const RARITY_WEIGHTS = { common: 65, uncommon: 22, rare: 9, epic: 3, legendary: 0.8, mythical: 0.18, secret: 0.02 };
const VARIANTS = [
  { key: 'Normal', emoji: FISH_EMOJI, chance: 89, multiplier: 1 },
  { key: 'Golden', emoji: GOLDEN_FISH_EMOJI, chance: 10, multiplier: 2 },
  { key: 'Rainbow', emoji: RAINBOW_FISH_EMOJI, chance: 1, multiplier: 5 },
];
const VARIANT_MULTIPLIER = Object.fromEntries(VARIANTS.map((variant) => [variant.key, variant.multiplier]));

module.exports = {
  FISH,
  FISH_BY_ID,
  FISH_BY_NAME,
  FISH_EMOJI,
  GOLDEN_FISH_EMOJI,
  RAINBOW_FISH_EMOJI,
  RARITY_BUTTONS,
  RARITY_WEIGHTS,
  VARIANTS,
  VARIANT_MULTIPLIER,
  normalizeId,
  normalizeName,
  stripFishTier,
};
