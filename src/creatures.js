const { RARITY_EMOJIS } = require('./pets');

const DUNGEON_TOKEN_DROPS = [
  { itemId: 'ITDungeonToken', chance: 0.01 },
  { itemId: 'ITDungeonToken', chance: 0.002, amount: 2 },
  { itemId: 'ITDungeonToken', chance: 0.0006, amount: 3 },
];

const MOSSBACK_MONKEY = {
  name: 'Mossback Monkey',
  emoji: '<:MCMossbackMonkey:1450727551940038818>',
  image: 'https://i.ibb.co/27wm83LG/MCMossback-Monkey.png',
  baseHealth: 65,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  counter_chance: 24,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const VINE_SNAKE = {
  name: 'Vine Snake',
  emoji: '<:CMVineSnake:1450727558604914799>',
  image: 'https://i.ibb.co/CsPLyBCP/MCVine-Snake.png',
  baseHealth: 55,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  counter_chance: 18,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const THORNBACK_BOAR = {
  name: 'Thornback Boar',
  emoji: '<:MCThornbackBoar:1450727556449046569>',
  image: 'https://i.ibb.co/v0qkpLj/MCThornback-Boar.png',
  baseHealth: 55,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  counter_chance: 12,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const JUNGLE_BETTLE = {
  name: 'Jungle Beetle',
  emoji: '<:MCJungleBettle:1448989040509452338>',
  image: 'https://i.ibb.co/x8z2VRCr/MCJungle-Beetle.png',
  baseHealth: 90,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  counter_chance: 10,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const LEAF_FROG = {
  name: 'Leaf Frog',
  emoji: '<:CMLeafFrog:1450727549977231453>',
  image: 'https://i.ibb.co/tPC4bTKp/MCLeaf-Frog.png',
  baseHealth: 40,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  counter_chance: 20,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const CLAWFOOT_BIRD = {
  name: 'Clawfoot Bird',
  emoji: '<:MCClawfootBird:1450727539415842856>',
  image: 'https://i.ibb.co/JWGtnmLq/MCClawfoot-Bird.png',
  baseHealth: 60,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  counter_chance: 16,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const BRISTLE_JAGUAR = {
  name: 'Bristle Jaguar',
  emoji: '<:MRBristleJaguar:1450727571179442186>',
  image: 'https://i.ibb.co/d4R66wSL/MRBristle-Jaguar.png',
  baseHealth: 170,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  counter_chance: 22,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const SPOREBACK_TORTOISE = {
  name: 'Sporeback Tortoise',
  emoji: '<:MRSporebackTortoise:1450727579492548718>',
  image: 'https://i.ibb.co/LXrXSKJt/MRSporeback-Tortoise.png',
  baseHealth: 230,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  counter_chance: 22,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const RAZORWING_PARROT = {
  name: 'Razorwing Parrot',
  emoji: '<:MRRazorwingParrot:1450727575109238793>',
  image: 'https://i.ibb.co/nNcgPNmW/MRRazorwing-Parrot.png',
  baseHealth: 130,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  counter_chance: 18,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const MUDSCALE_LIZARD = {
  name: 'Mudscale Lizard',
  emoji: '<:MRMudscaleLizard:1450727572911689758>',
  image: 'https://i.ibb.co/chVwcV2b/MRMudscale-Lizard.png',
  baseHealth: 190,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  counter_chance: 18,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const ROOTED_APE = {
  name: 'Rooted Ape',
  emoji: '<:MRRootedApe:1450727577260920852>',
  image: 'https://i.ibb.co/v68Xg3vh/MRRooted-Ape.png',
  baseHealth: 210,
  rarity: 'Rare',
  rarityEmoji: RARITY_EMOJIS.Rare,
  rarityIcon: RARITY_EMOJIS.Rare,
  counter_chance: 20,
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
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const THUNDERFANG_PANTHER = {
  name: 'Thunderfang Panther',
  emoji: '<:METhunderfangPanther:1450727565185515594>',
  image: 'https://i.ibb.co/rfKSRfTc/METhunderfang-Panther.png',
  baseHealth: 420,
  rarity: 'Epic',
  rarityEmoji: RARITY_EMOJIS.Epic,
  rarityIcon: RARITY_EMOJIS.Epic,
  counter_chance: 28,
  attackType: 'Singular',
  reward: { coins: { min: 1700, max: 2000 }, xp: { min: 50, max: 70 } },
  actions: [
    {
      key: 'bite',
      name: 'Bite',
      chance: 0.4,
      damage: { min: 20, max: 25 },
      message: 'The Thunderfang Panther bites {target}, dealt {amount} damages',
    },
    {
      key: 'thunderstrike',
      name: 'Thunderstrike',
      chance: 0.25,
      damage: { min: 55, max: 70 },
      message:
        'The Thunderfang Panther release a thunderstorm striking everyone, dealt {amount} damages',
    },
    {
      key: 'petStun',
      name: 'Pet Stun',
      chance: 0.35,
      petStun: { duration: 1 },
      noDamage: true,
      message: "The Thunderfang Panther stunned all your pets, they can't attack for the next turn",
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.6 },
    { itemId: 'ITToughHideScrap', chance: 0.55 },
    { itemId: 'ITSharpFang', chance: 0.4 },
    { itemId: 'ITHunterPeltStrip', chance: 0.25 },
    { itemId: 'ITStormCoreShard', chance: 0.18 },
    { itemId: 'ITThundertraceClawband', chance: 0.07 },
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const BLOOM_SERPENT = {
  name: 'Bloom Serpent',
  emoji: '<:MEBloomSerpent:1450727560525647893>',
  image: 'https://i.ibb.co/mV2GgRmr/MEBloom-Serpent.png',
  baseHealth: 380,
  rarity: 'Epic',
  rarityEmoji: RARITY_EMOJIS.Epic,
  rarityIcon: RARITY_EMOJIS.Epic,
  counter_chance: 20,
  attackType: 'Singular',
  reward: { coins: { min: 1500, max: 1850 }, xp: { min: 45, max: 60 } },
  actions: [
    {
      key: 'bloomPoison',
      name: 'Bloom Poison',
      chance: 0.4,
      damage: { min: 30, max: 40 },
      poison: { percent: 0.35, duration: 3 },
      message: 'The Bloom serpent bites {target}, dealt {amount} damage and poison you for 3 turns',
    },
    {
      key: 'tailWipe',
      name: 'Tail wipe',
      chance: 0.6,
      damage: { min: 45, max: 55 },
      message: 'The Bloom serpent wipes {target} with it tail, dealt {amount} damage',
    },
  ],
  drops: [
    { itemId: 'ITVineFiber', chance: 0.6 },
    { itemId: 'ITPoisonSporeCluster', chance: 0.45 },
    { itemId: 'ITSharpFang', chance: 0.25 },
    { itemId: 'ITBloomPetalCluster', chance: 0.22 },
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const EMERALD_STALKER = {
  name: 'Emerald Stalker',
  emoji: '<:MEEmeraldStalker:1450727563105144944>',
  image: 'https://i.ibb.co/PGWd5r85/MEEmerald-Stalker.png',
  baseHealth: 360,
  rarity: 'Epic',
  rarityEmoji: RARITY_EMOJIS.Epic,
  rarityIcon: RARITY_EMOJIS.Epic,
  counter_chance: 22,
  attackType: 'Singular',
  defense: 0.5,
  reward: { coins: { min: 1800, max: 1950 }, xp: { min: 48, max: 65 } },
  actions: [
    {
      key: 'cruelBites',
      name: 'Cruel Bites',
      chance: 0.5,
      damage: { min: 80, max: 105 },
      message: 'The Emerald Stalker cruely bites {target}, dealing huge {amount} damages',
    },
    {
      key: 'emeraldSlap',
      name: 'Emerald Slap',
      chance: 0.5,
      damage: { min: 40, max: 60 },
      message: 'The Emerald Stalker strongly slap you with it emerald paw, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITSharpFang', chance: 0.4 },
    { itemId: 'ITHunterPeltStrip', chance: 0.25 },
    { itemId: 'ITBurrowerScale', chance: 0.2 },
    { itemId: 'ITSpiritMistEssence', chance: 0.2 },
    { itemId: 'ITWardenVeilShard', chance: 0.005 },
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const TOTEM_GUARDIAN = {
  name: 'Totem Guardian',
  emoji: '<:METotemGuardian:1450727567081341102>',
  image: 'https://i.ibb.co/cKKVcR9n/METotem-Guardian.png',
  baseHealth: 480,
  rarity: 'Epic',
  rarityEmoji: RARITY_EMOJIS.Epic,
  rarityIcon: RARITY_EMOJIS.Epic,
  counter_chance: 30,
  attackType: 'Singular',
  defense: 0.75,
  reward: { coins: { min: 2200, max: 2450 }, xp: { min: 65, max: 80 } },
  actions: [
    {
      key: 'stomp',
      name: 'Stomp',
      chance: 0.65,
      damage: { min: 65, max: 80 },
      message: 'The Totem Guardian jump and stomp on {target}, dealt {amount} damage',
    },
    {
      key: 'laser',
      name: 'Laser',
      chance: 0.35,
      damage: { min: 100, max: 125 },
      message: 'The Totem Guardian shoot laser from it eyes to {target}, dealt {amount} damage',
    },
  ],
  drops: [
    { itemId: 'ITRootbindingSplinter', chance: 0.5 },
    { itemId: 'ITTotemStoneChip', chance: 0.4 },
    { itemId: 'ITWorldrootFragment', chance: 0.25 },
    { itemId: 'ITGuardianCore', chance: 0.18 },
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const ANCIENT_HORNED_GORILLA = {
  name: 'Ancient Horned Gorilla',
  emoji: '<:MLAncientHornedGorilla:1452288493957943307>',
  image: 'https://i.ibb.co/wFxLCZvf/MLAncient-Horned-Gorilla.png',
  baseHealth: 750,
  rarity: 'Legendary',
  rarityEmoji: RARITY_EMOJIS.Legendary,
  rarityIcon: RARITY_EMOJIS.Legendary,
  counter_chance: 35,
  attackType: 'Singular',
  defense: 0.45,
  reward: { coins: { min: 3600, max: 3800 }, xp: { min: 110, max: 120 } },
  actions: [
    {
      key: 'stomp',
      name: 'Stomp',
      chance: 0.35,
      damage: { min: 55, max: 70 },
      message: 'The Ancient Horned Gorilla jump and stomp on {target}, dealt {amount} damage',
    },
    {
      key: 'punch',
      name: 'Punch',
      chance: 0.4,
      damage: { min: 50, max: 65 },
      message: 'The Ancient Horned Gorilla punch {target}, dealt {amount} damage',
    },
    {
      key: 'charge',
      name: 'Charge',
      chance: 0.25,
      damage: { min: 165, max: 200 },
      message:
        'The Ancient Horned Gorilla charged toward {target}, piercing it horn and dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.6 },
    { itemId: 'ITToughHideScrap', chance: 0.55 },
    { itemId: 'ITHeavyHornFragment', chance: 0.3 },
    { itemId: 'ITTotemStoneChip', chance: 0.35 },
    { itemId: 'ITGuardianCore', chance: 0.2 },
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const STORM_CANOPY_EAGLE = {
  name: 'Storm Canopy Eagle',
  emoji: '<:MLStormCanopyEagle:1452288496512270521>',
  image: 'https://i.ibb.co/M5J96MBN/MLStorm-Canopy-Eagle.png',
  baseHealth: 600,
  rarity: 'Legendary',
  rarityEmoji: RARITY_EMOJIS.Legendary,
  rarityIcon: RARITY_EMOJIS.Legendary,
  counter_chance: 30,
  attackType: 'Multi',
  defense: 0.25,
  reward: { coins: { min: 3000, max: 3300 }, xp: { min: 100, max: 115 } },
  actions: [
    {
      key: 'beakPierce',
      name: 'Beak Pierce',
      chance: 0.35,
      damage: { min: 100, max: 200 },
      message:
        'The Storm Canopy eagle charge at {target}, piercing with it beak. Deal {amount} damage',
    },
    {
      key: 'scratch',
      name: 'Scratch',
      chance: 0.35,
      damage: { min: 60, max: 80 },
      message: 'The Storm Canopy Eagly scratched {target}, dealt {amount} damage',
    },
    {
      key: 'lightningStrike',
      name: 'Lightning strike',
      chance: 0.3,
      damage: { min: 80, max: 120 },
      message: 'The Storm Canopy Eagly shoot a lightning at {target}, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITJungleFeather', chance: 0.65 },
    { itemId: 'ITRazorTalon', chance: 0.45 },
    { itemId: 'ITRazorfeatherQuill', chance: 0.28 },
    { itemId: 'ITStormCoreShard', chance: 0.22 },
    { itemId: 'ITThundertraceClawband', chance: 0.1 },
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const VINE_TITAN = {
  name: 'Vine Titan',
  emoji: '<:MLVineTitan:1452288498873929729>',
  image: 'https://i.ibb.co/dJDZGJ27/MLVine-Titan.png',
  baseHealth: 850,
  rarity: 'Legendary',
  rarityEmoji: RARITY_EMOJIS.Legendary,
  rarityIcon: RARITY_EMOJIS.Legendary,
  counter_chance: 35,
  attackType: 'Singular',
  defense: 0.55,
  reward: { coins: { min: 3600, max: 4000 }, xp: { min: 100, max: 120 } },
  actions: [
    {
      key: 'vinePierce',
      name: 'Vine Pierce',
      chance: 0.4,
      damage: { min: 115, max: 180 },
      message: 'The Vine Titan pierced {target} with sharp vine, dealt {amount} damages',
    },
    {
      key: 'vineTrap',
      name: 'Vine Trap',
      chance: 0.3,
      damage: { min: 40, max: 60 },
      actionPenalty: 1,
      message:
        'The Vine Titan trapped {target} in vine, dealt {amount} damages and lose 1 action',
    },
    {
      key: 'poisonSpike',
      name: 'Poison spike',
      chance: 0.3,
      damage: { min: 50, max: 70 },
      poison: { percent: 0.5, duration: 2 },
      message:
        'the Vine Titan wips {target} with poisonous spike vine, dealt {amount} damages and poisoned them for 2 turns',
    },
  ],
  drops: [
    { itemId: 'ITVineFiber', chance: 0.6 },
    { itemId: 'ITMossyShavings', chance: 0.55 },
    { itemId: 'ITResinLump', chance: 0.45 },
    { itemId: 'ITRootbindingSplinter', chance: 0.35 },
    { itemId: 'ITShellguardPlate', chance: 0.25 },
    { itemId: 'ITTotemStoneChip', chance: 0.22 },
    { itemId: 'ITWorldrootFragment', chance: 0.15 },
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const SOLAR_JAGUAR = {
  name: 'Solar Jaguar',
  emoji: '<:MMSolarJaguar:1450727569203658936>',
  image: 'https://i.ibb.co/wFLQDK7X/MMSolar-Jaguar.png',
  baseHealth: 1300,
  rarity: 'Mythical',
  rarityEmoji: RARITY_EMOJIS.Mythical,
  rarityIcon: RARITY_EMOJIS.Mythical,
  counter_chance: 100,
  attackType: 'Singular',
  defense: 0.7,
  reward: { coins: { min: 5500, max: 6000 }, xp: { min: 150, max: 170 } },
  actions: [
    {
      key: 'solarBeam',
      name: 'Solar Beam',
      chance: 0.5,
      damage: { min: 200, max: 250 },
      message: 'The Solar Jaguar burst {target} with high heat light beam, dealt {amount} damages',
    },
    {
      key: 'solarOrb',
      name: 'Solar Orb',
      chance: 0.5,
      damage: { min: 100, max: 125 },
      message: 'The Solar Jaguar shoot Solar orb at {target}, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITBloomPetalCluster', chance: 0.45 },
    { itemId: 'ITSpiritMistEssence', chance: 0.3 },
    { itemId: 'ITPhantomOrchidPetal', chance: 0.04 },
    { itemId: 'ITWardenVeilShard', chance: 0.01 },
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const PHANTOM_ORCHID_WARDEN = {
  name: 'Phantom Orchid Warden',
  emoji: '<:MSPhantomOrchidWarden:1450727585830015110>',
  image: 'https://i.ibb.co/x8MFwkRC/MSPhantom-Orchid-Warden.png',
  baseHealth: 3000,
  rarity: 'Secret',
  rarityEmoji: RARITY_EMOJIS.Secret,
  rarityIcon: RARITY_EMOJIS.Secret,
  counter_chance: 100,
  attackType: 'Multi',
  defense: 0.8,
  reward: { coins: { min: 5500, max: 6000 }, xp: { min: 150, max: 170 } },
  actions: [
    {
      key: 'petalDrain',
      name: 'Petal Drain',
      chance: 0.4,
      damage: { min: 120, max: 220 },
      message:
        'Ghostly orchid petals drift through the air and sink into {target}, dealt {amount} damages',
    },
    {
      key: 'veilOfTheWarden',
      name: 'Veil of the Warden',
      chance: 0.35,
      damage: { min: 100, max: 180 },
      message:
        'A thick violet mist blankets the area as floating petals slowly drain {target} and their allies',
    },
    {
      key: 'witheringSilence',
      name: 'Withering Silence',
      chance: 0.25,
      damage: { min: 280, max: 420 },
      message:
        'All petals collapse inward as the Warden releases a final breath of decay toward {target}.',
    },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.65 },
    { itemId: 'ITSharpFang', chance: 0.45 },
    { itemId: 'ITJaguarSoulFang', chance: 0.18 },
    { itemId: 'ITThundertraceClawband', chance: 0.15 },
    { itemId: 'ITSunfirePelt', chance: 0.04 },
    { itemId: 'ITSolarCore', chance: 0.002 },
    ...DUNGEON_TOKEN_DROPS,
  ],
};

const CORRUPTED_CUBE = {
  name: 'Corrupted Cube',
  emoji: '<:MSCorruptedCube:1450727554339311668>',
  image: 'https://i.ibb.co/svhfTTPy/MCorrupted-Cube.png',
  baseHealth: 1111,
  rarity: 'Secret',
  rarityEmoji: RARITY_EMOJIS.Secret,
  rarityIcon: RARITY_EMOJIS.Secret,
  counter_chance: 0,
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
    ...DUNGEON_TOKEN_DROPS,
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
  THUNDERFANG_PANTHER,
  BLOOM_SERPENT,
  EMERALD_STALKER,
  TOTEM_GUARDIAN,
  ANCIENT_HORNED_GORILLA,
  STORM_CANOPY_EAGLE,
  VINE_TITAN,
  SOLAR_JAGUAR,
  PHANTOM_ORCHID_WARDEN,
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
  THUNDERFANG_PANTHER,
  BLOOM_SERPENT,
  EMERALD_STALKER,
  TOTEM_GUARDIAN,
  ANCIENT_HORNED_GORILLA,
  STORM_CANOPY_EAGLE,
  VINE_TITAN,
  SOLAR_JAGUAR,
  PHANTOM_ORCHID_WARDEN,
  CORRUPTED_CUBE,
};
