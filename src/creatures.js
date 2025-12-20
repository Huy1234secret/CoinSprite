const { RARITY_EMOJIS } = require('./pets');

const MOSSBACK_MONKEY = {
  name: 'Mossback Monkey',
  emoji: '<:MCMossbackMonkey:1450727551940038818>',
  baseHealth: 65,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  reward: { coins: { min: 275, max: 450 }, xp: { min: 12, max: 24 } },
  actions: [
    {
      key: 'rockThrow',
      name: 'Rock Throw',
      chance: 0.5,
      damage: { min: 5, max: 9 },
      message: 'The Mossback Monkey throws a rock at {target}, dealt {amount} damages',
    },
    {
      key: 'tailWipe',
      name: 'Tail Wipe',
      chance: 0.5,
      damage: { min: 3, max: 6 },
      message: 'The Mossback Monkey wipes it tail at {target}, dealt {amount} damages',
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
  reward: { coins: { min: 300, max: 500 }, xp: { min: 25, max: 50 } },
  actions: [
    {
      key: 'poisonousBite',
      name: 'Poisonous Bite',
      chance: 0.35,
      damage: { min: 10, max: 15 },
      damageIfPoisoned: { min: 12, max: 18 },
      poison: { percent: 0.25, duration: Infinity },
      message:
        'The Vine Snake bites {target} with it poisonous teeth, dealt {amount} damages and poisoned you forever',
      alreadyPoisonedMessage:
        'The Vine Snake bites {target} with it poisonous teeth, dealt {amount} damages',
    },
    {
      key: 'tailWipe',
      name: 'Tail Wipe',
      chance: 0.65,
      damage: { min: 5, max: 8 },
      message: 'The Vine Snake wipes it tail at {target}, dealt {amount} damages',
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
  emoji: '<:MCThornbackBoar:1450727556449046569>',
  baseHealth: 55,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  defense: 0.15,
  reward: { coins: { min: 250, max: 500 }, xp: { min: 15, max: 30 } },
  actions: [
    {
      key: 'gored',
      name: 'Gored',
      chance: 1,
      damage: { min: 8, max: 15 },
      message: 'The Thornback Boar gored {target} with it spike horn. Dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.6 },
    { itemId: 'ITToughHideScrap', chance: 0.5 },
    { itemId: 'ITHeavyHornFragment', chance: 0.08 },
  ],
};

const JUNGLE_BETTLE = {
  name: 'Jungle Beetle',
  emoji: '<:MCJungleBettle:1448989040509452338>',
  baseHealth: 90,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  defense: 0.3,
  reward: { coins: { min: 350, max: 600 }, xp: { min: 10, max: 40 } },
  actions: [
    {
      key: 'bite',
      name: 'Bite',
      chance: 1,
      damage: { min: 3, max: 7 },
      message: 'The Jungle Beetle bites {target}, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.4 },
    { itemId: 'ITMossyShavings', chance: 0.25 },
    { itemId: 'ITBeetleCarapaceShard', chance: 0.55 },
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
  reward: { coins: { min: 200, max: 350 }, xp: { min: 10, max: 30 } },
  actions: [
    {
      key: 'poisonousLiquid',
      name: 'Poisonous Liquid',
      chance: 0.35,
      damage: { min: 1, max: 1 },
      poison: { percent: 0.1, duration: 3 },
      message:
        'The Leaf Frog sprayed poisonous liquid at {target}, poisoned them for 3 turns',
    },
    {
      key: 'tongueHit',
      name: 'Tongue Hit',
      chance: 0.65,
      damage: { min: 3, max: 8 },
      damageIfPoisoned: { min: 5, max: 10 },
      message: 'The Leaf Frog hit {target} with it tounge, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.45 },
    { itemId: 'ITWeakVenomGland', chance: 0.4 },
  ],
};

const CLAWFOOT_BIRD = {
  name: 'Clawfoot Bird',
  emoji: '<:MCClawfootBird:1450727539415842856>',
  baseHealth: 60,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  reward: { coins: { min: 300, max: 450 }, xp: { min: 25, max: 40 } },
  actions: [
    {
      key: 'clawScratch',
      name: 'Claw Scratch',
      chance: 0.6,
      damage: { min: 5, max: 8 },
      message: 'The Clawfoot Bird scratches {target} with it sharp foot, dealt {amount} damages',
    },
    {
      key: 'beakHit',
      name: 'Beak Hit',
      chance: 0.4,
      damage: { min: 10, max: 15 },
      message: 'The Clawfoot Bird strongly hit {target} with it beak, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITJungleFeather', chance: 0.5 },
    { itemId: 'ITRazorTalon', chance: 0.35 },
  ],
};

const BRISTLE_JAGUAR = {
  name: 'Bristle Jaguar',
  emoji: '<:MRBristleJaguar:1450727571179442186>',
  baseHealth: 170,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  attackType: 'Singular',
  reward: { coins: { min: 700, max: 1000 }, xp: { min: 35, max: 50 } },
  actions: [
    {
      key: 'clawScratch',
      name: 'Claw Scratch',
      chance: 0.65,
      damage: { min: 15, max: 20 },
      message:
        'The Bristle Jarguar Scratched {target} with sharp fingers. Dealt {amount} damages',
    },
    {
      key: 'bite',
      name: 'Bite',
      chance: 0.35,
      damage: { min: 30, max: 45 },
      message:
        'The Bristle Jarguar Scratched strongly bites {target}. Dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.6 },
    { itemId: 'ITToughHideScrap', chance: 0.55 },
    { itemId: 'ITSharpFang', chance: 0.35 },
    { itemId: 'ITHunterPeltStrip', chance: 0.18 },
    { itemId: 'ITJaguarSoulFang', chance: 0.05 },
  ],
};

const SPOREBACK_TORTOISE = {
  name: 'Sporeback Tortoise',
  emoji: '<:MRSporebackTortoise:1450727579492548718>',
  baseHealth: 230,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  attackType: 'Singular',
  defense: 0.35,
  reward: { coins: { min: 700, max: 1000 }, xp: { min: 35, max: 50 } },
  actions: [
    {
      key: 'poisonGas',
      name: 'Poison Gas',
      chance: 0.3,
      damage: { min: 1, max: 1 },
      poison: { percent: 0.25, duration: 3 },
      message:
        'The Sporeback Tortoise release a poisonous gas from it mush. Poisoned everyone for 3 turns',
    },
    {
      key: 'bite',
      name: 'Bite',
      chance: 0.7,
      damage: { min: 15, max: 20 },
      damageIfPoisoned: { min: 20, max: 35 },
      message: 'The Sporeback Tortoise bite {target}. Deal {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.6 },
    { itemId: 'ITMossyShavings', chance: 0.5 },
    { itemId: 'ITPoisonSporeCluster', chance: 0.35 },
    { itemId: 'ITShellguardPlate', chance: 0.18 },
    { itemId: 'ITBeetleCarapaceShard', chance: 0.6 },
  ],
};

const RAZORWING_PARROT = {
  name: 'Razorwing Parrot',
  emoji: '<:MRRazorwingParrot:1450727575109238793>',
  baseHealth: 130,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  attackType: 'Singular',
  reward: { coins: { min: 500, max: 800 }, xp: { min: 33, max: 48 } },
  actions: [
    {
      key: 'throwSharpFeather',
      name: 'Throw Sharp Feather',
      chance: 0.34,
      damage: { min: 20, max: 30 },
      message: 'The Razorwing Parrot throws many sharp feather at {target}, dealt {amount} damages',
    },
    {
      key: 'scratch',
      name: 'Scratch',
      chance: 0.33,
      damage: { min: 8, max: 13 },
      message: 'The Razorwing Parrot scratched {target} with it sharp claw, dealt {amount} damages',
    },
    {
      key: 'bite',
      name: 'Bite',
      chance: 0.33,
      damage: { min: 15, max: 20 },
      message: 'The Razorwing Parrot bites {target}, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITJungleFeather', chance: 0.65 },
    { itemId: 'ITRazorTalon', chance: 0.45 },
    { itemId: 'ITRazorfeatherQuill', chance: 0.2 },
  ],
};

const MUDSCALE_LIZARD = {
  name: 'Mudscale Lizard',
  emoji: '<:MRMudscaleLizard:1450727572911689758>',
  baseHealth: 190,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  attackType: 'Singular',
  defense: 0.15,
  reward: { coins: { min: 600, max: 850 }, xp: { min: 35, max: 49 } },
  actions: [
    {
      key: 'bite',
      name: 'Bite',
      chance: 1,
      damage: { min: 10, max: 20 },
      damageIfPoisoned: { min: 20, max: 40 },
      poison: { percent: 0.2, duration: 2 },
      message:
        'The Mudscale Lizard bites {target}, dealt {amount} damages and poisoned {target} for 2 turns',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.55 },
    { itemId: 'ITWeakVenomGland', chance: 0.45 },
    { itemId: 'ITResinLump', chance: 0.4 },
    { itemId: 'ITBurrowerScale', chance: 0.18 },
  ],
};

const ROOTED_APE = {
  name: 'Rooted Ape',
  emoji: '<:MRRootedApe:1450727577260920852>',
  baseHealth: 210,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  attackType: 'Singular',
  defense: 0.5,
  reward: { coins: { min: 800, max: 1200 }, xp: { min: 45, max: 55 } },
  actions: [
    {
      key: 'stomp',
      name: 'Stomp',
      chance: 0.35,
      damage: { min: 20, max: 20 },
      message: 'The Rooted Ape crushed {target} with it leg, dealt {amount} damage',
    },
    {
      key: 'punch',
      name: 'Punch',
      chance: 0.4,
      damage: { min: 15, max: 25 },
      message: 'the Rooted Ape punched {target} strongly, dealt {amount} damages',
    },
    {
      key: 'rootTrap',
      name: 'Root Trap',
      chance: 0.25,
      damage: { min: 15, max: 15 },
      actionPenalty: 1,
      message:
        'The Rooted Ape summon roots and trapped {target}, dealt 15 damages and make them unable to do 1 action for the next turn',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.6 },
    { itemId: 'ITToughHideScrap', chance: 0.5 },
    { itemId: 'ITVineFiber', chance: 0.45 },
    { itemId: 'ITRootbindingSplinter', chance: 0.15 },
    { itemId: 'ITWorldrootFragment', chance: 0.03 },
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
  JUNGLE_BETTLE,
  LEAF_FROG,
  CLAWFOOT_BIRD,
  BRISTLE_JAGUAR,
  SPOREBACK_TORTOISE,
  RAZORWING_PARROT,
  MUDSCALE_LIZARD,
  ROOTED_APE,
  CORRUPTED_CUBE,
];

module.exports = {
  CREATURES,
  MOSSBACK_MONKEY,
  VINE_SNAKE,
  THORNBACK_BOAR,
  JUNGLE_BETTLE,
  LEAF_FROG,
  CLAWFOOT_BIRD,
  BRISTLE_JAGUAR,
  SPOREBACK_TORTOISE,
  RAZORWING_PARROT,
  MUDSCALE_LIZARD,
  ROOTED_APE,
  CORRUPTED_CUBE,
};
