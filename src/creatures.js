const { RARITY_EMOJIS } = require('./pets');

const MOSSBACK_MONKEY = {
  name: 'Mossback Monkey',
  emoji: '🐒',
  baseHealth: 65,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  counterChance: 0.144,
  reward: { coins: { min: 275, max: 450 }, xp: { min: 12, max: 24 } },
  levelDistribution: [
    { level: 1, chance: 0.4 },
    { level: 2, chance: 0.3 },
    { level: 3, chance: 0.2 },
    { level: 4, chance: 0.08 },
    { level: 5, chance: 0.02 },
  ],
  actions: [
    {
      key: 'rockThrow',
      name: 'Rock Throw',
      chance: 0.5,
      damage: { min: 5, max: 9 },
      message: 'The Mossback Monkey throws a rock at {name}, dealt {amount} damages',
    },
    {
      key: 'tailWipe',
      name: 'Tail Wipe',
      chance: 0.5,
      damage: { min: 3, max: 6 },
      message: 'The Mossback Monkey wipes it tail at {name}, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.55 },
    { itemId: 'ITMossyShavings', chance: 0.4 },
  ],
};

const VINE_SNAKE = {
  name: 'Vine Snake',
  emoji: '<:CMVineSnake:1450727558604914799>',
  baseHealth: 55,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  counterChance: 0.108,
  reward: { coins: { min: 300, max: 500 }, xp: { min: 25, max: 50 } },
  levelDistribution: [
    { level: 1, chance: 0.55 },
    { level: 2, chance: 0.3 },
    { level: 3, chance: 0.13 },
    { level: 4, chance: 0.015 },
    { level: 5, chance: 0.005 },
  ],
  actions: [
    {
      key: 'poisonousBite',
      name: 'Poison Bite',
      chance: 0.6,
      damage: { min: 10, max: 15 },
      damageIfPoisoned: { min: 12, max: 18 },
      poison: { percent: 0.25, duration: Infinity },
      message: 'The Vine Snake bites {name} with it poisonous teeth, dealt {amount} damages and poisoned you forever',
      alreadyPoisonedMessage: 'The Vine Snake bites {name} with it poisonous teeth, dealt {amount} damages',
    },
    {
      key: 'tailWipe',
      name: 'Tail Wipe',
      chance: 0.4,
      damage: { min: 5, max: 8 },
      message: 'The Vine Snake wipes it tail at {name}, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITVineFiber', chance: 0.5 },
    { itemId: 'ITWeakVenomGland', chance: 0.45 },
    { itemId: 'ITSharpFang', chance: 0.1 },
  ],
};

const THORNBACK_BOAR = {
  name: 'Thornback Boar',
  emoji: '🐗',
  baseHealth: 55,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  counterChance: 0.072,
  defense: 0.15,
  reward: { coins: { min: 250, max: 500 }, xp: { min: 15, max: 30 } },
  levelDistribution: [
    { level: 1, chance: 0.45 },
    { level: 2, chance: 0.3 },
    { level: 3, chance: 0.18 },
    { level: 4, chance: 0.06 },
    { level: 5, chance: 0.01 },
  ],
  actions: [
    {
      key: 'gored',
      name: 'Gored',
      chance: 1,
      damage: { min: 8, max: 15 },
      message: 'The Thornback Boar gored {name} with it spike horn. Dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.6 },
    { itemId: 'ITToughHideScrap', chance: 0.5 },
    { itemId: 'ITHeavyHornFragment', chance: 0.08 },
  ],
};

const JUNGLE_BEETLE = {
  name: 'Jungle Beetle',
  emoji: '<:MCJungleBettle:1448989040509452338>',
  baseHealth: 90,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  counterChance: 0.06,
  defense: 0.3,
  reward: { coins: { min: 350, max: 600 }, xp: { min: 10, max: 40 } },
  levelDistribution: [
    { level: 1, chance: 0.4 },
    { level: 2, chance: 0.35 },
    { level: 3, chance: 0.2 },
    { level: 4, chance: 0.045 },
    { level: 5, chance: 0.005 },
  ],
  actions: [
    {
      key: 'bite',
      name: 'Bite',
      chance: 1,
      damage: { min: 3, max: 7 },
      message: 'The Jungle Beetle bites {name}, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.4 },
    { itemId: 'ITMossyShavings', chance: 0.25 },
  ],
};

const LEAF_FROG = {
  name: 'Leaf Frog',
  emoji: '<:CMLeafFrog:1450727549977231453>',
  baseHealth: 40,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  counterChance: 0.12,
  reward: { coins: { min: 200, max: 350 }, xp: { min: 10, max: 30 } },
  levelDistribution: [
    { level: 1, chance: 0.5 },
    { level: 2, chance: 0.35 },
    { level: 3, chance: 0.1 },
    { level: 4, chance: 0.045 },
    { level: 5, chance: 0.005 },
  ],
  actions: [
    {
      key: 'poisonousLiquid',
      name: 'Poisonous Liquid',
      chance: 0.35,
      damage: { min: 0, max: 0 },
      poison: { percent: 0.1, duration: 3 },
      message: 'The Leaf Frog sprayed poisonous liquid at {name}, poisoned them for 3 turns',
    },
    {
      key: 'tongueHit',
      name: 'Tongue Hit',
      chance: 0.65,
      damage: { min: 3, max: 8 },
      damageIfPoisoned: { min: 5, max: 10 },
      message: 'The Leaf Frog hit {name} with it tounge, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.45 },
    { itemId: 'ITWeakVenomGland', chance: 0.4 },
  ],
};

const CLAWFOOT_BIRD = {
  name: 'Clawfoot Bird',
  emoji: '🐦',
  baseHealth: 60,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  counterChance: 0.096,
  reward: { coins: { min: 300, max: 450 }, xp: { min: 25, max: 40 } },
  levelDistribution: [
    { level: 1, chance: 0.4 },
    { level: 2, chance: 0.3 },
    { level: 3, chance: 0.2 },
    { level: 4, chance: 0.08 },
    { level: 5, chance: 0.02 },
  ],
  actions: [
    {
      key: 'clawScratch',
      name: 'Claw Scratch',
      chance: 0.5,
      damage: { min: 5, max: 8 },
      message: 'The Clawfoot Bird scratches {name} with it sharp foot, dealt {amount} damages',
    },
    {
      key: 'beakHit',
      name: 'Beak Hit',
      chance: 0.5,
      damage: { min: 10, max: 15 },
      message: 'The Clawfoot Bird strongly hit {name} with it beak, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITJungleFeather', chance: 0.5 },
    { itemId: 'ITRazorTalon', chance: 0.35 },
  ],
};

const CORRUPTED_CUBE = {
  name: 'Corrupted Cube',
  emoji: '<:MSCorruptedCube:1450727554339311668>',
  baseHealth: 1111,
  rarity: 'Secret',
  rarityEmoji: RARITY_EMOJIS.Secret,
  rarityIcon: RARITY_EMOJIS.Secret,
  attackType: 'Multi',
  reward: {
    coins: { min: 10000, max: 22222 },
    xp: { min: 1000, max: 2500 },
    diamonds: { min: 10, max: 250 },
    prismatic: { min: 1, max: 50, chance: 0.25 },
  },
  levelDistribution: [
    { level: 1, chance: 0.16 },
    { level: 2, chance: 0.14 },
    { level: 3, chance: 0.13 },
    { level: 4, chance: 0.12 },
    { level: 5, chance: 0.11 },
    { level: 6, chance: 0.1 },
    { level: 7, chance: 0.09 },
    { level: 8, chance: 0.08 },
    { level: 9, chance: 0.07 },
  ],
  actions: [
    {
      key: 'nullBeam',
      name: 'Null Beam',
      chance: 0.8,
      damage: { min: 75, max: 150 },
      damageIfPoisoned: { min: 100, max: 200 },
      message:
        'Corrupted Cube fires a null beam that tears through everything for {amount} damage!',
      alreadyPoisonedMessage:
        'Corrupted Cube amplifies its null beam on your corrupted body for {amount} damage!',
    },
    {
      key: 'corruption',
      name: 'Corruption',
      chance: 0.2,
      damage: { min: 0, max: 0 },
      poison: { percent: 0.9, duration: Infinity },
      message: 'Corrupted Cube infects you with endless corruption, poisoning you forever.',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 1, amount: { min: 15, max: 30 } },
  ],
};

const CREATURES = [
  MOSSBACK_MONKEY,
  VINE_SNAKE,
  THORNBACK_BOAR,
  JUNGLE_BEETLE,
  LEAF_FROG,
  CLAWFOOT_BIRD,
  CORRUPTED_CUBE,
];

module.exports = {
  CREATURES,
  MOSSBACK_MONKEY,
  JUNGLE_BEETLE,
  VINE_SNAKE,
  THORNBACK_BOAR,
  LEAF_FROG,
  CLAWFOOT_BIRD,
  CORRUPTED_CUBE,
};
